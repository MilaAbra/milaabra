import { ImageLoader } from "./image-loader.js";
import { CornerSelector } from "./corner-selector.js";
import { CornerDetector } from "./corner-detector.js";
import { PerspectiveWarper } from "./perspective-warper.js";
import { Downloader } from "./downloader.js";

const MAX_PREVIEW_SIZE = 2048;

class App {
  constructor() {
    this._imageCanvas = document.getElementById("image-canvas");
    this._overlayCanvas = document.getElementById("overlay-canvas");
    this._canvasContainer = document.getElementById("canvas-container");
    this._placeholder = document.getElementById("placeholder");
    this._fileInput = document.getElementById("file-input");
    this._applyBtn = document.getElementById("apply-btn");
    this._resetBtn = document.getElementById("reset-btn");
    this._downloadBtn = document.getElementById("download-btn");

    this._ratioBar = document.getElementById("ratio-bar");

    this._imageCtx = this._imageCanvas.getContext("2d");
    this._sourceImage = null;
    this._fullResImage = null;
    this._resultCanvas = null;
    this._cornerSelector = null;
    this._state = "idle"; // idle | selecting | result
    this._selectedRatio = null; // null = auto
    this._lastCorners = null;
    this._previewScale = 1;

    this._initImageLoader();
    this._initButtons();
  }

  _initImageLoader() {
    this._imageLoader = new ImageLoader(this._fileInput);
    this._imageLoader.onLoad = (image) => this._onImageLoaded(image);
    this._imageLoader.init();
  }

  _initButtons() {
    this._applyBtn.addEventListener("click", () => this._apply());
    this._resetBtn.addEventListener("click", () => this._reset());
    this._downloadBtn.addEventListener("click", () => this._download());

    this._ratioBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".ratio-bar__btn");
      if (!btn) {
        return;
      }

      for (const b of this._ratioBar.querySelectorAll(".ratio-bar__btn")) {
        b.classList.remove("ratio-bar__btn--active");
      }
      btn.classList.add("ratio-bar__btn--active");

      const value = btn.dataset.ratio;
      if (value === "auto") {
        this._selectedRatio = null;
      } else {
        const [w, h] = value.split(":").map(Number);
        this._selectedRatio = w / h;
      }

      this._reapply();
    });
  }

  _onImageLoaded(image) {
    // image is either an Image or a Canvas (if EXIF-corrected)
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;

    // Store full-res for final warp
    this._fullResImage = image;

    // Downscale for preview if needed
    if (w > MAX_PREVIEW_SIZE || h > MAX_PREVIEW_SIZE) {
      const scale = MAX_PREVIEW_SIZE / Math.max(w, h);
      const previewW = Math.round(w * scale);
      const previewH = Math.round(h * scale);

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = previewW;
      previewCanvas.height = previewH;
      const pCtx = previewCanvas.getContext("2d");
      pCtx.drawImage(image, 0, 0, previewW, previewH);

      this._sourceImage = previewCanvas;
      this._previewScale = scale;
    } else {
      this._sourceImage = image;
      this._previewScale = 1;
    }

    this._showImage();
    this._startCornerSelection();
  }

  _showImage() {
    const img = this._sourceImage;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    this._imageCanvas.width = w;
    this._imageCanvas.height = h;
    this._overlayCanvas.width = w;
    this._overlayCanvas.height = h;

    this._imageCtx.drawImage(img, 0, 0);

    this._placeholder.classList.add("placeholder--hidden");
  }

  _startCornerSelection() {
    const img = this._sourceImage;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (this._cornerSelector) {
      this._cornerSelector.destroy();
    }
    this._cornerSelector = new CornerSelector(
      this._overlayCanvas,
      this._sourceImage,
      this._imageCanvas,
    );
    this._cornerSelector.init(w, h);

    // Auto-detect document corners
    const detected = CornerDetector.detect(this._sourceImage);
    if (detected) {
      this._cornerSelector.setCorners(detected);
    }

    this._state = "selecting";
    this._applyBtn.disabled = false;
    this._resetBtn.disabled = false;
    this._downloadBtn.disabled = true;
    this._resultCanvas = null;

    // Hide ratio bar and reset to auto
    this._ratioBar.classList.add("ratio-bar--hidden");
    this._selectedRatio = null;
    this._lastCorners = null;
    for (const btn of this._ratioBar.querySelectorAll(".ratio-bar__btn")) {
      btn.classList.toggle("ratio-bar__btn--active", btn.dataset.ratio === "auto");
    }
  }

  _apply() {
    if (this._state !== "selecting" || !this._cornerSelector) {
      return;
    }

    let corners = this._cornerSelector.corners;

    // Scale corners back to full-res if we downscaled
    if (this._previewScale !== 1) {
      const invScale = 1 / this._previewScale;
      corners = corners.map((c) => ({
        x: c.x * invScale,
        y: c.y * invScale,
      }));
    }

    this._lastCorners = corners;

    let resultCanvas;
    try {
      resultCanvas = PerspectiveWarper.warp(this._fullResImage, corners, this._selectedRatio);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Не удалось выполнить трансформацию:", err);
      return;
    }

    this._resultCanvas = resultCanvas;

    // Show result
    this._cornerSelector.disable();
    this._imageCanvas.width = this._resultCanvas.width;
    this._imageCanvas.height = this._resultCanvas.height;
    this._overlayCanvas.width = this._resultCanvas.width;
    this._overlayCanvas.height = this._resultCanvas.height;
    this._imageCtx.drawImage(this._resultCanvas, 0, 0);

    this._state = "result";
    this._applyBtn.disabled = true;
    this._downloadBtn.disabled = false;
    this._ratioBar.classList.remove("ratio-bar--hidden");
  }

  _reapply() {
    if (!this._lastCorners || !this._fullResImage) {
      return;
    }

    let resultCanvas;
    try {
      resultCanvas = PerspectiveWarper.warp(this._fullResImage, this._lastCorners, this._selectedRatio);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Не удалось выполнить трансформацию:", err);
      return;
    }

    this._resultCanvas = resultCanvas;

    this._imageCanvas.width = this._resultCanvas.width;
    this._imageCanvas.height = this._resultCanvas.height;
    this._overlayCanvas.width = this._resultCanvas.width;
    this._overlayCanvas.height = this._resultCanvas.height;
    this._imageCtx.drawImage(this._resultCanvas, 0, 0);
  }

  _reset() {
    if (this._state === "result" && this._sourceImage) {
      this._showImage();
      this._startCornerSelection();
    } else if (this._state === "selecting" && this._cornerSelector) {
      this._cornerSelector.reset();
    }
  }

  _download() {
    if (!this._resultCanvas) {
      return;
    }
    Downloader.download(this._resultCanvas, "squared.png");
  }
}

new App();
