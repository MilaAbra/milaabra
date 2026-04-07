import { PointUtils } from "./point-utils.js";

const HANDLE_RADIUS = 28;
const HIT_RADIUS = 56;
const FILL_COLOR = "rgba(74, 144, 217, 0.15)";
const STROKE_COLOR = "rgba(74, 144, 217, 0.8)";
const HANDLE_FILL = "rgba(74, 144, 217, 0.6)";
const HANDLE_FILL_ACTIVE = "rgba(74, 144, 217, 0.9)";
const HANDLE_STROKE = "#fff";
const LOUPE_SIZE = 100;
const LOUPE_ZOOM = 3;
const LOUPE_OFFSET = 60;

export class CornerSelector {
  /**
   * @param {HTMLCanvasElement} overlayCanvas - Transparent overlay canvas for drawing handles
   * @param {HTMLImageElement|HTMLCanvasElement} sourceImage - The source image for loupe
   * @param {HTMLCanvasElement} imageCanvas - The canvas showing the image (for coordinate mapping)
   */
  constructor(overlayCanvas, sourceImage, imageCanvas) {
    this._overlay = overlayCanvas;
    this._ctx = overlayCanvas.getContext("2d");
    this._sourceImage = sourceImage;
    this._imageCanvas = imageCanvas;
    this._corners = [];
    this._pointers = new Map();
    this._lastMovedCorner = -1;
    this._onChange = null;
    this._enabled = false;
  }

  set onChange(callback) {
    this._onChange = callback;
  }

  get corners() {
    return this._corners.map((c) => ({ ...c }));
  }

  /**
   * Initialize with default corner positions (20% inset from edges).
   */
  init(imageWidth, imageHeight) {
    const insetX = imageWidth * 0.2;
    const insetY = imageHeight * 0.2;

    this._corners = [
      { x: insetX, y: insetY }, // TL
      { x: imageWidth - insetX, y: insetY }, // TR
      { x: imageWidth - insetX, y: imageHeight - insetY }, // BR
      { x: insetX, y: imageHeight - insetY }, // BL
    ];

    this._imageWidth = imageWidth;
    this._imageHeight = imageHeight;
    this._enabled = true;

    this._bindEvents();
    this._draw();
  }

  reset() {
    if (this._imageWidth && this._imageHeight) {
      this.init(this._imageWidth, this._imageHeight);
    }
  }

  setCorners(corners) {
    if (!this._enabled || corners.length !== 4) {
      return;
    }
    this._corners = PointUtils.sortCorners(
      corners.map((c) => ({
        x: Math.max(0, Math.min(this._imageWidth, c.x)),
        y: Math.max(0, Math.min(this._imageHeight, c.y)),
      })),
    );
    this._draw(null);
    if (this._onChange) {
      this._onChange(this.corners);
    }
  }

  disable() {
    this._enabled = false;
    this._pointers.clear();
    this._lastMovedCorner = -1;
    this._ctx.clearRect(0, 0, this._overlay.width, this._overlay.height);
  }

  destroy() {
    this.disable();
    if (this._bound) {
      this._overlay.removeEventListener("pointerdown", this._onPointerDownBound);
      this._overlay.removeEventListener("pointermove", this._onPointerMoveBound);
      this._overlay.removeEventListener("pointerup", this._onPointerUpBound);
      this._overlay.removeEventListener("pointercancel", this._onPointerUpBound);
    }
    if (this._preventTouchMove) {
      document.removeEventListener("touchmove", this._preventTouchMove);
    }
  }

  _bindEvents() {
    if (this._bound) {
      return;
    }
    this._bound = true;

    this._onPointerDownBound = (e) => this._onPointerDown(e);
    this._onPointerMoveBound = (e) => this._onPointerMove(e);
    this._onPointerUpBound = (e) => this._onPointerUp(e);

    this._overlay.addEventListener("pointerdown", this._onPointerDownBound);
    this._overlay.addEventListener("pointermove", this._onPointerMoveBound);
    this._overlay.addEventListener("pointerup", this._onPointerUpBound);
    this._overlay.addEventListener("pointercancel", this._onPointerUpBound);

    // Block browser touch gestures (scroll, pull-to-refresh, swipe-back)
    // while a corner is being dragged. Must be non-passive to allow preventDefault.
    this._preventTouchMove = (e) => {
      if (this._pointers.size > 0) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", this._preventTouchMove, { passive: false });
  }

  _canvasToImage(clientX, clientY) {
    const rect = this._overlay.getBoundingClientRect();
    const scaleX = this._overlay.width / rect.width;
    const scaleY = this._overlay.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  _onPointerDown(e) {
    if (!this._enabled) {
      return;
    }
    e.preventDefault();

    const pos = this._canvasToImage(e.clientX, e.clientY);

    // Collect corners already captured by other pointers
    const captured = new Set(this._pointers.values());

    // Find closest corner within hit radius that is not already captured
    let minDist = Infinity;
    let closestIdx = -1;
    for (let i = 0; i < this._corners.length; i++) {
      if (captured.has(i)) {
        continue;
      }
      const dist = PointUtils.distance(pos, this._corners[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    // Scale hit radius to image coordinates: canvas pixels / CSS pixels
    const cssScale = this._overlay.width / this._overlay.getBoundingClientRect().width;
    const scaledHitRadius = HIT_RADIUS * cssScale;

    if (closestIdx !== -1 && minDist <= scaledHitRadius) {
      this._pointers.set(e.pointerId, closestIdx);
      this._lastMovedCorner = closestIdx;
      this._overlay.setPointerCapture(e.pointerId);
      this._draw(pos);
    }
  }

  _onPointerMove(e) {
    if (!this._enabled) {
      return;
    }
    const cornerIdx = this._pointers.get(e.pointerId);
    if (cornerIdx === undefined) {
      return;
    }
    e.preventDefault();

    const pos = this._canvasToImage(e.clientX, e.clientY);

    // Clamp to image bounds
    this._corners[cornerIdx] = {
      x: Math.max(0, Math.min(this._imageWidth, pos.x)),
      y: Math.max(0, Math.min(this._imageHeight, pos.y)),
    };

    this._lastMovedCorner = cornerIdx;
    this._lastPointerPos = pos;
    this._draw(pos);

    if (this._onChange) {
      this._onChange(this.corners);
    }
  }

  _onPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) {
      return;
    }
    e.preventDefault();
    this._pointers.delete(e.pointerId);
    this._overlay.releasePointerCapture(e.pointerId);

    if (this._pointers.size === 0) {
      // Auto-sort corners to maintain TL, TR, BR, BL order
      this._corners = PointUtils.sortCorners(this._corners);
      this._lastMovedCorner = -1;
      this._lastPointerPos = null;
      this._draw(null);
    } else {
      this._draw(this._lastPointerPos);
    }

    if (this._onChange) {
      this._onChange(this.corners);
    }
  }

  _draw(pointerPos) {
    const ctx = this._ctx;
    const w = this._overlay.width;
    const h = this._overlay.height;
    ctx.clearRect(0, 0, w, h);

    if (this._corners.length !== 4) {
      return;
    }

    // Draw filled quadrilateral
    ctx.beginPath();
    ctx.moveTo(this._corners[0].x, this._corners[0].y);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(this._corners[i].x, this._corners[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = FILL_COLOR;
    ctx.fill();

    // Draw edges
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw handles
    const capturedCorners = new Set(this._pointers.values());
    for (let i = 0; i < 4; i++) {
      const c = this._corners[i];
      const isActive = capturedCorners.has(i);

      ctx.beginPath();
      ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? HANDLE_FILL_ACTIVE : HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = HANDLE_STROKE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw magnifier loupe for the last moved corner
    if (this._lastMovedCorner !== -1 && pointerPos) {
      this._drawLoupe(ctx, this._corners[this._lastMovedCorner], pointerPos);
    }
  }

  _drawLoupe(ctx, cornerPos, pointerPos) {
    // Position loupe above and to the right of the pointer
    let loupeX = pointerPos.x + LOUPE_OFFSET;
    let loupeY = pointerPos.y - LOUPE_OFFSET - LOUPE_SIZE;

    // Keep loupe within canvas bounds
    if (loupeX + LOUPE_SIZE > this._overlay.width) {
      loupeX = pointerPos.x - LOUPE_OFFSET - LOUPE_SIZE;
    }
    if (loupeY < 0) {
      loupeY = pointerPos.y + LOUPE_OFFSET;
    }

    const halfLoupe = LOUPE_SIZE / 2;

    ctx.save();

    // Circular clip
    ctx.beginPath();
    ctx.arc(loupeX + halfLoupe, loupeY + halfLoupe, halfLoupe, 0, Math.PI * 2);
    ctx.clip();

    // Draw zoomed portion of source image
    const srcX = cornerPos.x - halfLoupe / LOUPE_ZOOM;
    const srcY = cornerPos.y - halfLoupe / LOUPE_ZOOM;
    const srcSize = LOUPE_SIZE / LOUPE_ZOOM;

    ctx.drawImage(
      this._sourceImage,
      srcX,
      srcY,
      srcSize,
      srcSize,
      loupeX,
      loupeY,
      LOUPE_SIZE,
      LOUPE_SIZE,
    );

    // Draw crosshair
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(loupeX + halfLoupe, loupeY);
    ctx.lineTo(loupeX + halfLoupe, loupeY + LOUPE_SIZE);
    ctx.moveTo(loupeX, loupeY + halfLoupe);
    ctx.lineTo(loupeX + LOUPE_SIZE, loupeY + halfLoupe);
    ctx.stroke();

    // Draw loupe border
    ctx.restore();
    ctx.beginPath();
    ctx.arc(loupeX + halfLoupe, loupeY + halfLoupe, halfLoupe, 0, Math.PI * 2);
    ctx.strokeStyle = HANDLE_STROKE;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
