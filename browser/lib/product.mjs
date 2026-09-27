import fs from 'node:fs';

// Names and identifiers shared by every Cut Browser package.

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const PRODUCT = {
  name: 'Cut Browser',
  vendor: 'Cut',
  version: pkg.version, // Cut Browser's own version (browser/package.json); the Firefox base is reported separately
  description: 'A private web browser with Cut Search built in.',
  linuxName: 'cut-browser', // package, command and desktop-file name on Linux
};

// Compiled into the executable in place of Mozilla/Firefox/firefox. Each must
// fit in the space of the original string (7 characters).
//  - vendor "" and name "Cut": profiles live in %APPDATA%\Cut and ~/.cut
//  - remoting name "cut": single-instance name, and the window class on Linux
export const IDENTITY = { vendor: '', name: 'Cut', remotingName: 'cut' };

// Each Cut Browser build gets its own build ID (UTC time, 14 digits).
export const buildStamp = (date = new Date()) => date.toISOString().replace(/\D/g, '').slice(0, 14);

// application.ini isn't read by the browser (its identity is compiled in),
// but tools do read it, so it describes Cut Browser too.
export function appIni(original, { buildID } = {}) {
  const keep = (key) => original.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
  return `; Cut Browser. The browser doesn't read this file; its identity is built
; into the executable. It is here for tools that report version details.
[App]
Vendor=${PRODUCT.vendor}
Name=${IDENTITY.name}
RemotingName=${IDENTITY.remotingName}
Version=${keep('Version')}
BuildID=${buildID || keep('BuildID')}
SourceRepository=${keep('SourceRepository')}
SourceStamp=${keep('SourceStamp')}
ID=${keep('ID')}

[Gecko]
MinVersion=${keep('MinVersion')}
MaxVersion=${keep('MaxVersion')}

[XRE]
EnableProfileMigrator=1

[Crash Reporter]
Enabled=0
`;
}
