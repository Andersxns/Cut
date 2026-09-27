// Evaluated in the browser window: captures the window as a PNG data URL.
async function cutSnapshot() {
  const bitmap = await window.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas.toDataURL("image/png");
}
