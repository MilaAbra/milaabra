export class Downloader {
  /**
   * Download a canvas as an image file.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   * @param {string} format - "image/png" or "image/jpeg"
   * @param {number} quality - JPEG quality (0-1), ignored for PNG
   */
  static download(canvas, filename = "squared.png", format = "image/png", quality = 0.85) {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      format,
      quality,
    );
  }
}
