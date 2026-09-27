// Cut Browser installer and uninstaller for Windows.
//
// Built by lib/installer-win.mjs with the C# compiler that ships with the
// .NET Framework, so it needs nothing beyond Windows itself. The same source
// builds two programs: Setup (with the browser embedded as Payload.zip) and
// uninstall.exe (without it, defined UNINSTALLER).
//
// Installs per user into %LOCALAPPDATA%\Programs\Cut Browser, so it never
// asks for administrator rights. Command line:
//   Setup.exe [/S] [/D=<folder>] [/NoShortcut] [/NoLaunch]
//   uninstall.exe [/S] [/RemoveData]

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Shell;
using Microsoft.Win32;

[assembly: AssemblyTitle("Cut Browser Setup")]
[assembly: AssemblyProduct("Cut Browser")]
[assembly: AssemblyCompany("Cut")]
[assembly: AssemblyCopyright("Cut Browser is built on Mozilla Firefox (MPL 2.0)")]
[assembly: AssemblyVersion("@VERSION@.0")]
[assembly: AssemblyFileVersion("@VERSION@.0")]
[assembly: AssemblyInformationalVersion("@VERSION@")]

namespace CutBrowserSetup
{
    static class Product
    {
        public const string Name = "Cut Browser";
        public const string Vendor = "Cut";
        public const string Exe = "cut.exe";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CutBrowser";
        public const string Description = "A private web browser with Cut Search built in.";
        public static string Version = "@VERSION@";
        public static string FirefoxVersion = "@FIREFOX_VERSION@";
    }

    // ------------------------------------------------------------------ Options

    class Options
    {
        public bool Silent;
        public bool Uninstall;
        public bool RemoveData;
        public bool DesktopShortcut = true;
        public bool Launch = true;
        public string InstallDir;
        public string TempUninstallFor; // set when the uninstaller runs from %TEMP%

        public static Options Parse(string[] args)
        {
            var o = new Options();
#if UNINSTALLER
            o.Uninstall = true;
#endif
            foreach (var raw in args)
            {
                var a = raw.Trim();
                var lower = a.ToLowerInvariant();
                if (lower == "/s" || lower == "--silent") o.Silent = true;
                else if (lower == "/removedata") o.RemoveData = true;
                else if (lower == "/noshortcut") o.DesktopShortcut = false;
                else if (lower == "/nolaunch") o.Launch = false;
                else if (lower.StartsWith("/d=")) o.InstallDir = a.Substring(3).Trim('"');
                else if (lower.StartsWith("/uninstall-for=")) { o.Uninstall = true; o.TempUninstallFor = a.Substring(15).Trim('"'); }
            }
            if (o.Silent) o.Launch = false;
            return o;
        }
    }

    // ------------------------------------------------------------------ Installer logic

    static class Installer
    {
        public static string DefaultDir
        {
            get
            {
                return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product.Name);
            }
        }

        public static string InstalledDir()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(Product.UninstallKey))
            {
                var dir = key == null ? null : key.GetValue("InstallLocation") as string;
                return dir != null && File.Exists(System.IO.Path.Combine(dir, Product.Exe)) ? dir : null;
            }
        }

        // The taskbar and default-apps identity. Cut Browser reads it from
        // HKCU\Software\Mozilla\Cut\TaskBarIDs, keyed by install folder, and
        // names its file and link handlers after it (FirefoxURL-<id>, ...).
        public static string AppId(string dir)
        {
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(dir.TrimEnd('\\').ToLowerInvariant()));
                return "CutBrowser-" + BitConverter.ToString(hash, 0, 4).Replace("-", "");
            }
        }

        static IEnumerable<Process> RunningFrom(string dir)
        {
            var list = new List<Process>();
            foreach (var name in new[] { "cut", "cut-search" })
            {
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try
                    {
                        if (p.MainModule.FileName.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase)) list.Add(p);
                    }
                    catch
                    {
                        // Not ours to inspect; not ours to close either.
                    }
                }
            }
            return list;
        }

        public static bool IsRunning(string dir)
        {
            return RunningFrom(dir).Any();
        }

        public static void CloseRunning(string dir)
        {
            foreach (var p in RunningFrom(dir))
            {
                try
                {
                    p.CloseMainWindow();
                }
                catch { }
            }
            Thread.Sleep(1500);
            foreach (var p in RunningFrom(dir))
            {
                try
                {
                    p.Kill();
                    p.WaitForExit(5000);
                }
                catch { }
            }
        }

        // Extracts the embedded browser next to the install folder, then swaps
        // it in, so a failed install never leaves a half-updated browser.
        public static void Install(string dir, Options options, Action<double, string> progress)
        {
            dir = System.IO.Path.GetFullPath(dir.TrimEnd('\\'));
            var staging = dir + ".new";
            var previous = dir + ".old";
            DeleteDir(staging);
            DeleteDir(previous);
            Directory.CreateDirectory(staging);

            progress(0, "Unpacking Cut Browser…");
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload.zip");
            if (stream == null) throw new InvalidOperationException("This installer is incomplete (no browser inside).");
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                long total = zip.Entries.Sum(e => e.Length);
                long done = 0;
                var buffer = new byte[1 << 20];
                foreach (var entry in zip.Entries)
                {
                    var target = System.IO.Path.GetFullPath(System.IO.Path.Combine(staging, entry.FullName));
                    if (!target.StartsWith(staging + "\\", StringComparison.OrdinalIgnoreCase)) continue;
                    if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target));
                    using (var input = entry.Open())
                    using (var output = File.Create(target))
                    {
                        int read;
                        while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            output.Write(buffer, 0, read);
                            done += read;
                            progress(0.9 * done / Math.Max(1, total), "Unpacking Cut Browser…");
                        }
                    }
                }
            }

            progress(0.92, "Closing the old version…");
            CloseRunning(dir);
            if (Directory.Exists(dir)) Directory.Move(dir, previous);
            Directory.Move(staging, dir);
            DeleteDir(previous);

            progress(0.95, "Adding Cut Browser to Windows…");
            Register(dir, options);
            progress(1, "Done");
        }

        public static void Register(string dir, Options options)
        {
            var exe = System.IO.Path.Combine(dir, Product.Exe);
            var id = AppId(dir);
            var command = "\"" + exe + "\" -osint -url \"%1\"";
            long sizeKb = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length) / 1024;
            var hkcu = Registry.CurrentUser;

            // Apps & features.
            using (var key = hkcu.CreateSubKey(Product.UninstallKey))
            {
                key.SetValue("DisplayName", Product.Name);
                key.SetValue("DisplayVersion", Product.Version);
                key.SetValue("DisplayIcon", exe + ",0");
                key.SetValue("Publisher", Product.Vendor);
                key.SetValue("Comments", Product.Description + " Built on Firefox " + Product.FirefoxVersion + ".");
                key.SetValue("InstallLocation", dir);
                key.SetValue("UninstallString", "\"" + System.IO.Path.Combine(dir, "uninstall.exe") + "\"");
                key.SetValue("QuietUninstallString", "\"" + System.IO.Path.Combine(dir, "uninstall.exe") + "\" /S");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeKb), RegistryValueKind.DWord);
                key.SetValue("AppId", id);
            }

            // Taskbar identity (read by the browser itself).
            using (var key = hkcu.CreateSubKey(@"Software\Mozilla\Cut\TaskBarIDs"))
                key.SetValue(dir, id);

            // "Run" box and command line: typing "cut" opens the browser.
            using (var key = hkcu.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + Product.Exe))
            {
                key.SetValue("", exe);
                key.SetValue("Path", dir);
            }

            // Link and file handlers, named the way the browser looks for them.
            RegisterProgId("FirefoxURL-" + id, "Cut Browser URL", exe, "-1", command, true);
            RegisterProgId("FirefoxHTML-" + id, "Cut Browser HTML Document", exe, "-2", command, false);
            RegisterProgId("FirefoxPDF-" + id, "Cut Browser PDF Document", exe, "-6", command, false);

            var client = @"Software\Clients\StartMenuInternet\" + id;
            using (var key = hkcu.CreateSubKey(client))
            {
                key.SetValue("", Product.Name);
                using (var icon = key.CreateSubKey("DefaultIcon")) icon.SetValue("", exe + ",0");
                using (var cmd = key.CreateSubKey(@"shell\open\command")) cmd.SetValue("", "\"" + exe + "\"");
                using (var caps = key.CreateSubKey("Capabilities"))
                {
                    caps.SetValue("ApplicationName", Product.Name);
                    caps.SetValue("ApplicationDescription", Product.Description);
                    caps.SetValue("ApplicationIcon", exe + ",0");
                    using (var start = caps.CreateSubKey("StartMenu")) start.SetValue("StartMenuInternet", id);
                    using (var urls = caps.CreateSubKey("URLAssociations"))
                    {
                        urls.SetValue("http", "FirefoxURL-" + id);
                        urls.SetValue("https", "FirefoxURL-" + id);
                    }
                    using (var files = caps.CreateSubKey("FileAssociations"))
                    {
                        foreach (var ext in new[] { ".htm", ".html", ".shtml", ".xht", ".xhtml", ".svg", ".webp", ".avif" })
                            files.SetValue(ext, "FirefoxHTML-" + id);
                        files.SetValue(".pdf", "FirefoxPDF-" + id);
                    }
                }
            }
            using (var key = hkcu.CreateSubKey(@"Software\RegisteredApplications"))
                key.SetValue(Product.Name, client + @"\Capabilities");

            // "Open with" lists.
            foreach (var ext in new[] { ".htm", ".html", ".shtml", ".xht", ".xhtml", ".svg", ".webp", ".avif", ".pdf" })
            {
                using (var key = hkcu.CreateSubKey(@"Software\Classes\" + ext + @"\OpenWithProgids"))
                    key.SetValue((ext == ".pdf" ? "FirefoxPDF-" : "FirefoxHTML-") + id, "");
            }

            // Shortcuts carry the same identity, so a pinned taskbar icon and the
            // running browser group together.
            var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            Shortcuts.Create(System.IO.Path.Combine(programs, Product.Name + ".lnk"), exe, dir, id, Product.Description);
            if (options.DesktopShortcut)
            {
                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                Shortcuts.Create(System.IO.Path.Combine(desktop, Product.Name + ".lnk"), exe, dir, id, Product.Description);
            }

            Native.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); // SHCNE_ASSOCCHANGED
        }

        static void RegisterProgId(string progId, string name, string exe, string iconId, string command, bool isUrl)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + progId))
            {
                key.SetValue("", name);
                key.SetValue("FriendlyTypeName", name);
                if (isUrl) key.SetValue("URL Protocol", "");
                key.SetValue("EditFlags", 2, RegistryValueKind.DWord);
                using (var icon = key.CreateSubKey("DefaultIcon")) icon.SetValue("", exe + "," + iconId);
                using (var cmd = key.CreateSubKey(@"shell\open\command")) cmd.SetValue("", command);
                using (var app = key.CreateSubKey("Application"))
                {
                    app.SetValue("ApplicationName", Product.Name);
                    app.SetValue("ApplicationIcon", exe + ",0");
                    app.SetValue("ApplicationDescription", Product.Description);
                }
            }
        }

        public static void Uninstall(string dir, Options options, Action<double, string> progress)
        {
            dir = dir.TrimEnd('\\');
            var id = AppId(dir);
            progress(0.05, "Closing Cut Browser…");
            CloseRunning(dir);

            progress(0.2, "Removing Cut Browser from Windows…");
            var hkcu = Registry.CurrentUser;
            foreach (var key in new[] {
                @"Software\Classes\FirefoxURL-" + id,
                @"Software\Classes\FirefoxHTML-" + id,
                @"Software\Classes\FirefoxPDF-" + id,
                @"Software\Clients\StartMenuInternet\" + id,
                @"Software\Microsoft\Windows\CurrentVersion\App Paths\" + Product.Exe,
                Product.UninstallKey })
            {
                try { hkcu.DeleteSubKeyTree(key, false); } catch { }
            }
            DeleteValue(@"Software\RegisteredApplications", Product.Name);
            DeleteValue(@"Software\Mozilla\Cut\TaskBarIDs", dir);
            DeleteKeyIfEmpty(@"Software\Mozilla\Cut\TaskBarIDs");
            DeleteKeyIfEmpty(@"Software\Mozilla\Cut");
            foreach (var ext in new[] { ".htm", ".html", ".shtml", ".xht", ".xhtml", ".svg", ".webp", ".avif", ".pdf" })
                DeleteValue(@"Software\Classes\" + ext + @"\OpenWithProgids", (ext == ".pdf" ? "FirefoxPDF-" : "FirefoxHTML-") + id);

            foreach (var folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory })
            {
                try { File.Delete(System.IO.Path.Combine(Environment.GetFolderPath(folder), Product.Name + ".lnk")); } catch { }
            }

            progress(0.45, "Deleting files…");
            DeleteDir(dir);

            if (options.RemoveData)
            {
                progress(0.8, "Deleting your browsing data…");
                DeleteDir(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Cut"));
                DeleteDir(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cut"));
                try { hkcu.DeleteSubKeyTree(@"Software\Mozilla\Cut", false); } catch { }
            }
            Native.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
            progress(1, "Done");
        }

        static void DeleteKeyIfEmpty(string keyPath)
        {
            try
            {
                bool empty;
                using (var key = Registry.CurrentUser.OpenSubKey(keyPath))
                    empty = key != null && key.ValueCount == 0 && key.SubKeyCount == 0;
                if (empty) Registry.CurrentUser.DeleteSubKey(keyPath, false);
            }
            catch { }
        }

        static void DeleteValue(string keyPath, string name)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(keyPath, true))
                    if (key != null) key.DeleteValue(name, false);
            }
            catch { }
        }

        public static void DeleteDir(string dir)
        {
            for (int attempt = 0; attempt < 10 && Directory.Exists(dir); attempt++)
            {
                try { Directory.Delete(dir, true); }
                catch { Thread.Sleep(500); }
            }
        }

        public static void Launch(string dir)
        {
            try { Process.Start(new ProcessStartInfo(System.IO.Path.Combine(dir, Product.Exe)) { UseShellExecute = true, WorkingDirectory = dir }); }
            catch { }
        }

        public static void OpenDefaultAppsSettings()
        {
            try { Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(Product.Name)) { UseShellExecute = true }); }
            catch
            {
                try { Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true }); } catch { }
            }
        }
    }

    // ------------------------------------------------------------------ Shortcuts with an app ID

    static class Shortcuts
    {
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        class ShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr data, int flags);
            void GetIDList(out IntPtr idList);
            void SetIDList(IntPtr idList);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short hotkey);
            void SetHotkey(short hotkey);
            void GetShowCmd(out int showCmd);
            void SetShowCmd(int showCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
            void Resolve(IntPtr hwnd, int flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        interface IPropertyStore
        {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
        interface IPersistFile
        {
            void GetClassID(out Guid classId);
            [PreserveSig] int IsDirty();
            void Load([MarshalAs(UnmanagedType.LPWStr)] string file, int mode);
            void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
            void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
            void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PropertyKey
        {
            public Guid FormatId;
            public uint PropertyId;
        }

        [StructLayout(LayoutKind.Explicit, Size = 16)]
        struct PropVariant
        {
            [FieldOffset(0)] public ushort Type;
            [FieldOffset(8)] public IntPtr Pointer;
        }

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant value);

        public static void Create(string lnk, string target, string workDir, string appId, string description)
        {
            var link = (IShellLinkW)new ShellLink();
            link.SetPath(target);
            link.SetWorkingDirectory(workDir);
            link.SetDescription(description);
            link.SetIconLocation(target, 0);
            var store = (IPropertyStore)link;
            var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
            var value = new PropVariant { Type = 31 /* VT_LPWSTR */, Pointer = Marshal.StringToCoTaskMemUni(appId) };
            try
            {
                store.SetValue(ref key, ref value);
                store.Commit();
            }
            finally
            {
                PropVariantClear(ref value);
            }
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(lnk));
            ((IPersistFile)link).Save(lnk, true);
            Marshal.ReleaseComObject(link);
        }
    }

    static class Native
    {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        // Dark title bar and rounded corners on Windows 11.
        public static void StyleWindow(Window window)
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            int dark = 1, round = 2;
            try
            {
                DwmSetWindowAttribute(hwnd, 20, ref dark, 4);
                DwmSetWindowAttribute(hwnd, 33, ref round, 4);
            }
            catch { }
        }
    }

    // ------------------------------------------------------------------ The window

    class SetupWindow : Window
    {
        static readonly Color Accent = Color.FromRgb(0xE0, 0x55, 0x2B);
        static readonly Brush Background1 = new SolidColorBrush(Color.FromRgb(0x15, 0x15, 0x17));
        static readonly Brush Surface = new SolidColorBrush(Color.FromRgb(0x20, 0x20, 0x24));
        static readonly Brush Text1 = new SolidColorBrush(Color.FromRgb(0xEC, 0xEC, 0xEF));
        static readonly Brush Text2 = new SolidColorBrush(Color.FromRgb(0xA5, 0xA5, 0xAD));
        static readonly Brush AccentBrush = new SolidColorBrush(Accent);
        static readonly FontFamily Font = new FontFamily("Segoe UI Variable Display, Segoe UI");

        readonly Options options;
        readonly StackPanel body = new StackPanel();
        string installDir;

        public SetupWindow(Options options)
        {
            this.options = options;
            Title = Product.Name + (options.Uninstall ? " Uninstall" : " Setup");
            Width = 560;
            Height = 410;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = Background1;
            FontFamily = Font;
            Foreground = Text1;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            WindowChrome.SetWindowChrome(this, new WindowChrome { CaptionHeight = 40, GlassFrameThickness = new Thickness(0), ResizeBorderThickness = new Thickness(0), CornerRadius = new CornerRadius(0), UseAeroCaptionButtons = false });
            SourceInitialized += delegate { Native.StyleWindow(this); };

            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(40) });
            root.RowDefinitions.Add(new RowDefinition());
            var close = new Button { Content = "", FontFamily = new FontFamily("Segoe MDL2 Assets, Segoe Fluent Icons"), FontSize = 10, Width = 46, Height = 40, HorizontalAlignment = HorizontalAlignment.Right, Foreground = Text2, Background = Brushes.Transparent, BorderThickness = new Thickness(0), Template = FlatButton(Color.FromRgb(0xC4, 0x2B, 0x1C)) };
            WindowChrome.SetIsHitTestVisibleInChrome(close, true);
            close.Click += delegate { Close(); };
            root.Children.Add(close);
            body.Margin = new Thickness(40, 4, 40, 32);
            Grid.SetRow(body, 1);
            root.Children.Add(body);
            Content = root;

            installDir = options.Uninstall ? (options.TempUninstallFor ?? Installer.InstalledDir()) : (options.InstallDir ?? Installer.InstalledDir() ?? Installer.DefaultDir);
            if (options.Uninstall) ShowUninstallWelcome();
            else ShowWelcome();
        }

        public static void Render(Options options, string file, string page)
        {
            NoAnimation = true;
            var window = new SetupWindow(options);
            if (page == "done") window.ShowDone();
            else if (page == "uninstall") window.ShowUninstallWelcome();
            else if (page == "progress") { window.ShowProgress("Installing Cut Browser"); window.progressText.Text = "Unpacking Cut Browser…"; }
            var root = (FrameworkElement)window.Content;
            window.Content = null;
            var frame = new Border { Background = Background1, Width = window.Width, Height = window.Height, Child = root };
            frame.Measure(new Size(window.Width, window.Height));
            frame.Arrange(new Rect(0, 0, window.Width, window.Height));
            frame.UpdateLayout();
            if (page == "progress") { window.progressFill.Width = window.progressTrack.ActualWidth * 0.62; frame.UpdateLayout(); }
            var bitmap = new System.Windows.Media.Imaging.RenderTargetBitmap((int)window.Width * 2, (int)window.Height * 2, 192, 192, PixelFormats.Pbgra32);
            bitmap.Render(frame);
            var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
            encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bitmap));
            using (var stream = File.Create(file)) encoder.Save(stream);
        }

        // ---- Building blocks

        static ControlTemplate FlatButton(Color hover)
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border), "bg");
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(0));
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            var trigger = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            trigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(hover), "bg"));
            trigger.Setters.Add(new Setter(Control.ForegroundProperty, Brushes.White));
            template.Triggers.Add(trigger);
            return template;
        }

        static ControlTemplate PillButton(Brush background, Brush hover)
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border), "bg");
            border.SetValue(Border.BackgroundProperty, background);
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
            border.SetValue(Border.PaddingProperty, new Thickness(22, 10, 22, 11));
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            var over = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            over.Setters.Add(new Setter(Border.BackgroundProperty, hover, "bg"));
            template.Triggers.Add(over);
            var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
            disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
            template.Triggers.Add(disabled);
            return template;
        }

        Button Primary(string label)
        {
            return new Button { Content = label, FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White, Cursor = Cursors.Hand, Template = PillButton(AccentBrush, new SolidColorBrush(Color.FromRgb(0xEE, 0x66, 0x3C))), Margin = new Thickness(0, 0, 10, 0) };
        }

        Button Secondary(string label)
        {
            return new Button { Content = label, FontSize = 14, Foreground = Text1, Cursor = Cursors.Hand, Template = PillButton(Surface, new SolidColorBrush(Color.FromRgb(0x2C, 0x2C, 0x31))), Margin = new Thickness(0, 0, 10, 0) };
        }

        static UIElement Mark(double size)
        {
            var path = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M34.238 6.836A17.8 17.8 0 0 0 10.036 31.038Z M39.564 15.362A17.8 17.8 0 0 1 15.362 39.564Z"),
                Fill = AccentBrush,
                Stroke = AccentBrush,
                StrokeThickness = 6.4,
                StrokeLineJoin = PenLineJoin.Round,
            };
            var canvas = new Canvas { Width = 48, Height = 48 };
            canvas.Children.Add(path);
            return new Viewbox { Width = size, Height = size, Child = canvas, HorizontalAlignment = HorizontalAlignment.Left };
        }

        TextBlock Heading(string text)
        {
            return new TextBlock { Text = text, FontSize = 26, FontWeight = FontWeights.SemiBold, Foreground = Text1, Margin = new Thickness(0, 18, 0, 6) };
        }

        TextBlock Paragraph(string text)
        {
            return new TextBlock { Text = text, FontSize = 14, Foreground = Text2, TextWrapping = TextWrapping.Wrap, LineHeight = 21, Margin = new Thickness(0, 0, 0, 14) };
        }

        CheckBox Check(string label, bool value)
        {
            return new CheckBox { Content = new TextBlock { Text = label, FontSize = 13.5, Foreground = Text1, Margin = new Thickness(4, -1, 0, 0) }, IsChecked = value, Margin = new Thickness(0, 4, 0, 6), Foreground = Text1 };
        }

        StackPanel Row(params UIElement[] children)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 18, 0, 0) };
            foreach (var c in children) row.Children.Add(c);
            return row;
        }

        static bool NoAnimation;

        void Fade()
        {
            if (NoAnimation) return;
            body.Opacity = 0;
            body.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));
        }

        // ---- Pages

        void ShowWelcome()
        {
            body.Children.Clear();
            var existing = Installer.InstalledDir();
            body.Children.Add(Mark(56));
            body.Children.Add(Heading(existing != null ? "Update Cut Browser" : "Install Cut Browser"));
            body.Children.Add(Paragraph("A private browser with Cut Search built in. It sends no telemetry, blocks trackers and ads, and searches without handing your queries to a search company."));
            var folder = new TextBlock { Text = installDir, FontSize = 12.5, Foreground = Text2, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 0, 12) };
            body.Children.Add(folder);
            var desktop = Check("Add a shortcut to the desktop", options.DesktopShortcut);
            body.Children.Add(desktop);
            var install = Primary(existing != null ? "Update" : "Install");
            var cancel = Secondary("Cancel");
            install.Click += delegate
            {
                options.DesktopShortcut = desktop.IsChecked == true;
                RunInstall();
            };
            cancel.Click += delegate { Close(); };
            body.Children.Add(Row(install, cancel));
            Fade();
        }

        void ShowProgress(string title)
        {
            body.Children.Clear();
            body.Children.Add(Mark(56));
            body.Children.Add(Heading(title));
            var status = Paragraph("Getting ready…");
            status.Name = "status";
            body.Children.Add(status);
            var track = new Border { Height = 6, CornerRadius = new CornerRadius(3), Background = Surface, Margin = new Thickness(0, 10, 0, 0) };
            var fill = new Border { Height = 6, CornerRadius = new CornerRadius(3), Background = AccentBrush, HorizontalAlignment = HorizontalAlignment.Left, Width = 0 };
            track.Child = fill;
            body.Children.Add(track);
            progressFill = fill;
            progressTrack = track;
            progressText = status;
            Fade();
        }

        Border progressFill;
        Border progressTrack;
        TextBlock progressText;

        void Report(double fraction, string message)
        {
            Dispatcher.BeginInvoke(new Action(delegate
            {
                if (progressFill == null) return;
                progressFill.Width = Math.Max(0, progressTrack.ActualWidth * Math.Min(1, fraction));
                progressText.Text = message;
            }));
        }

        async void RunInstall()
        {
            if (Installer.IsRunning(installDir))
            {
                var answer = MessageBox.Show(this, "Cut Browser is open. Setup will close it to continue; your tabs are restored the next time it starts.", Title, MessageBoxButton.OKCancel, MessageBoxImage.Information);
                if (answer != MessageBoxResult.OK) return;
            }
            ShowProgress("Installing Cut Browser");
            try
            {
                var dir = installDir;
                await Task.Run(() => Installer.Install(dir, options, Report));
                ShowDone();
            }
            catch (Exception e)
            {
                ShowError("Cut Browser couldn't be installed", e.Message);
            }
        }

        void ShowDone()
        {
            body.Children.Clear();
            body.Children.Add(Mark(56));
            body.Children.Add(Heading("Cut Browser is ready"));
            body.Children.Add(Paragraph("Find it in the Start menu. You can make it your default browser in Windows Settings at any time."));
            var launch = Primary("Open Cut Browser");
            var makeDefault = Secondary("Make default…");
            var done = Secondary("Close");
            launch.Click += delegate { Installer.Launch(installDir); Close(); };
            makeDefault.Click += delegate { Installer.OpenDefaultAppsSettings(); };
            done.Click += delegate { Close(); };
            body.Children.Add(Row(launch, makeDefault, done));
            Fade();
        }

        void ShowError(string title, string detail)
        {
            body.Children.Clear();
            body.Children.Add(Mark(56));
            body.Children.Add(Heading(title));
            body.Children.Add(Paragraph(detail));
            var close = Secondary("Close");
            close.Click += delegate { Close(); };
            body.Children.Add(Row(close));
            Fade();
        }

        void ShowUninstallWelcome()
        {
            body.Children.Clear();
            body.Children.Add(Mark(56));
            body.Children.Add(Heading("Uninstall Cut Browser"));
            body.Children.Add(Paragraph("This removes Cut Browser from this computer. Your bookmarks, history and passwords are kept unless you choose to delete them."));
            var data = Check("Also delete my browsing data (bookmarks, history, passwords, settings)", options.RemoveData);
            body.Children.Add(data);
            var remove = Primary("Uninstall");
            var cancel = Secondary("Cancel");
            remove.Click += async delegate
            {
                options.RemoveData = data.IsChecked == true;
                ShowProgress("Uninstalling Cut Browser");
                try
                {
                    var dir = installDir;
                    await Task.Run(() => Installer.Uninstall(dir, options, Report));
                    body.Children.Clear();
                    body.Children.Add(Mark(56));
                    body.Children.Add(Heading("Cut Browser was removed"));
                    body.Children.Add(Paragraph(options.RemoveData ? "Your browsing data was deleted too." : "Your browsing data is still in your user folder, in case you install Cut Browser again."));
                    var close = Secondary("Close");
                    close.Click += delegate { Close(); };
                    body.Children.Add(Row(close));
                    Fade();
                }
                catch (Exception e)
                {
                    ShowError("Cut Browser couldn't be removed", e.Message);
                }
            };
            cancel.Click += delegate { Close(); };
            body.Children.Add(Row(remove, cancel));
            Fade();
        }
    }

    // ------------------------------------------------------------------ Entry point

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            var options = Options.Parse(args);

            // Build self-test: draw a page to a PNG without showing a window.
            //   Setup.exe /render=out.png [/page=welcome|done|uninstall|progress]
            var render = args.FirstOrDefault(a => a.StartsWith("/render=", StringComparison.OrdinalIgnoreCase));
            if (render != null)
            {
                var page = args.FirstOrDefault(a => a.StartsWith("/page=", StringComparison.OrdinalIgnoreCase));
                SetupWindow.Render(options, render.Substring(8).Trim('"'), page == null ? "welcome" : page.Substring(6));
                return 0;
            }

            // The uninstaller can't delete the folder it runs from, so it
            // copies itself to %TEMP% and continues from there.
            if (options.Uninstall && options.TempUninstallFor == null)
            {
                var dir = System.IO.Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                var copy = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "CutBrowserUninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                File.Copy(Assembly.GetExecutingAssembly().Location, copy, true);
                var passthrough = string.Join(" ", args.Select(a => "\"" + a + "\""));
                Process.Start(new ProcessStartInfo(copy, passthrough + " \"/uninstall-for=" + dir + "\"") { UseShellExecute = false });
                return 0;
            }

            int exitCode = 0;
            if (options.Silent)
            {
                try
                {
                    if (options.Uninstall) Installer.Uninstall(options.TempUninstallFor, options, (f, m) => { });
                    else Installer.Install(options.InstallDir ?? Installer.InstalledDir() ?? Installer.DefaultDir, options, (f, m) => { });
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine(e.Message);
                    exitCode = 1;
                }
            }
            else
            {
                var app = new Application();
                app.Run(new SetupWindow(options));
            }

            if (options.TempUninstallFor != null) ScheduleSelfDelete();
            return exitCode;
        }

        static void ScheduleSelfDelete()
        {
            var self = Assembly.GetExecutingAssembly().Location;
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul & del /f /q \"" + self + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch { }
        }
    }
}
