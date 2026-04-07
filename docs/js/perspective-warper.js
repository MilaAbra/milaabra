import { HomographyMatrix } from "./homography-matrix.js";
import { PointUtils } from "./point-utils.js";

const DEFAULT_SUBDIVISIONS = 16;

export class PerspectiveWarper {
  /**
   * Warp the source image using perspective correction.
   *
   * @param {HTMLImageElement|HTMLCanvasElement} sourceImage - The source image
   * @param {Array<{x: number, y: number}>} srcCorners - 4 corners in source image (TL, TR, BR, BL)
   * @param {number|null} aspectRatio - Optional aspect ratio (w/h). null = natural proportions.
   * @returns {HTMLCanvasElement} Canvas with the warped result
   */
  static warp(sourceImage, srcCorners, aspectRatio = null) {
    const { width: outW, height: outH } = PerspectiveWarper._computeOutputSize(srcCorners, aspectRatio);

    const dstCorners = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];

    // Homography: dst → src (inverse mapping)
    const H = HomographyMatrix.compute(dstCorners, srcCorners);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    PerspectiveWarper._renderTriangleGrid(ctx, sourceImage, H, outW, outH, DEFAULT_SUBDIVISIONS);

    return canvas;
  }

  /**
   * Determine output dimensions from source quadrilateral.
   *
   * @param {Array<{x: number, y: number}>} corners
   * @param {number|null} aspectRatio - Optional aspect ratio (w/h). null = natural proportions.
   */
  static _computeOutputSize(corners, aspectRatio = null) {
    const topLen = PointUtils.distance(corners[0], corners[1]);
    const bottomLen = PointUtils.distance(corners[3], corners[2]);
    const leftLen = PointUtils.distance(corners[0], corners[3]);
    const rightLen = PointUtils.distance(corners[1], corners[2]);

    let width = Math.round((topLen + bottomLen) / 2);
    let height = Math.round((leftLen + rightLen) / 2);

    if (aspectRatio !== null) {
      const isLandscape = width >= height;
      let ratio = aspectRatio;

      // If landscape but ratio < 1 (portrait ratio), invert it
      if (isLandscape && ratio < 1) {
        ratio = 1 / ratio;
      }
      // If portrait but ratio > 1 (landscape ratio), invert it
      if (!isLandscape && ratio > 1) {
        ratio = 1 / ratio;
      }

      // Fix the larger dimension, compute the smaller one
      if (width >= height) {
        height = Math.round(width / ratio);
      } else {
        width = Math.round(height * ratio);
      }
    }

    return { width: Math.max(width, 1), height: Math.max(height, 1) };
  }

  /**
   * Render using triangle subdivision with canvas affine transforms.
   */
  static _renderTriangleGrid(ctx, sourceImage, H, outW, outH, subdivisions) {
    const cellW = outW / subdivisions;
    const cellH = outH / subdivisions;

    for (let row = 0; row < subdivisions; row++) {
      for (let col = 0; col < subdivisions; col++) {
        // Destination quad corners for this cell
        const x0 = col * cellW;
        const y0 = row * cellH;
        const x1 = (col + 1) * cellW;
        const y1 = (row + 1) * cellH;

        const dstTL = { x: x0, y: y0 };
        const dstTR = { x: x1, y: y0 };
        const dstBR = { x: x1, y: y1 };
        const dstBL = { x: x0, y: y1 };

        // Map to source using homography
        const srcTL = HomographyMatrix.transformPoint(H, x0, y0);
        const srcTR = HomographyMatrix.transformPoint(H, x1, y0);
        const srcBR = HomographyMatrix.transformPoint(H, x1, y1);
        const srcBL = HomographyMatrix.transformPoint(H, x0, y1);

        // Two triangles per cell
        PerspectiveWarper._drawTriangle(
          ctx,
          sourceImage,
          [srcTL, srcTR, srcBL],
          [dstTL, dstTR, dstBL],
        );
        PerspectiveWarper._drawTriangle(
          ctx,
          sourceImage,
          [srcTR, srcBR, srcBL],
          [dstTR, dstBR, dstBL],
        );
      }
    }
  }

  /**
   * Draw a single triangle by computing the affine transform from src to dst
   * and using canvas setTransform + clip + drawImage.
   */
  static _drawTriangle(ctx, img, src, dst) {
    // Compute affine transform: dst = T * src
    // For 3 point pairs, solve:
    //   u = a*x + c*y + e
    //   v = b*x + d*y + f
    const [s0, s1, s2] = src;
    const [d0, d1, d2] = dst;

    const det = (s0.x - s2.x) * (s1.y - s2.y) - (s1.x - s2.x) * (s0.y - s2.y);
    if (Math.abs(det) < 1e-8) {
      return; // Degenerate triangle
    }

    const invDet = 1 / det;

    // Solve for affine coefficients
    // setTransform(a, b, c, d, e, f) where:
    //   x_screen = a * x_source + c * y_source + e
    //   y_screen = b * x_source + d * y_source + f
    // But we need: source → destination, used with drawImage
    // Canvas setTransform maps canvas coords to screen coords
    // We need: for each dst pixel, find the source pixel
    // Actually, setTransform + drawImage works as:
    //   The transform maps source image coords → canvas (destination) coords
    // So we need T such that T * src_point = dst_point

    const a = ((d0.x - d2.x) * (s1.y - s2.y) - (d1.x - d2.x) * (s0.y - s2.y)) * invDet;
    const c = ((d1.x - d2.x) * (s0.x - s2.x) - (d0.x - d2.x) * (s1.x - s2.x)) * invDet;
    const e = d0.x - a * s0.x - c * s0.y;

    const b = ((d0.y - d2.y) * (s1.y - s2.y) - (d1.y - d2.y) * (s0.y - s2.y)) * invDet;
    const d = ((d1.y - d2.y) * (s0.x - s2.x) - (d0.y - d2.y) * (s1.x - s2.x)) * invDet;
    const f = d0.y - b * s0.x - d * s0.y;

    ctx.save();

    // Clip to destination triangle (with 0.5px expansion to avoid seams)
    ctx.beginPath();
    PerspectiveWarper._expandedTrianglePath(ctx, d0, d1, d2, 0.5);
    ctx.closePath();
    ctx.clip();

    // Apply affine transform and draw
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);

    ctx.restore();
  }

  /**
   * Create a triangle path expanded outward by `expand` pixels to avoid seams.
   */
  static _expandedTrianglePath(ctx, p0, p1, p2, expand) {
    if (expand <= 0) {
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      return;
    }

    // Compute centroid
    const cx = (p0.x + p1.x + p2.x) / 3;
    const cy = (p0.y + p1.y + p2.y) / 3;

    // Push each vertex away from centroid
    const expandPoint = (p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) {
        return p;
      }
      return {
        x: p.x + (dx / len) * expand,
        y: p.y + (dy / len) * expand,
      };
    };

    const e0 = expandPoint(p0);
    const e1 = expandPoint(p1);
    const e2 = expandPoint(p2);

    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.lineTo(e2.x, e2.y);
  }
}
