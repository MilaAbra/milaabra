import { LinearAlgebra } from "./linear-algebra.js";

export class HomographyMatrix {
  /**
   * Compute a 3x3 homography matrix from 4 source→destination point correspondences.
   * Uses the Direct Linear Transform (DLT) algorithm.
   *
   * srcPoints and dstPoints are arrays of 4 objects with {x, y}.
   * Returns a flat 9-element array representing the 3x3 matrix.
   */
  static compute(srcPoints, dstPoints) {
    // Build the 8x8 system: A * h = b
    // For each point pair (x,y) → (u,v):
    //   Row 1: [x, y, 1, 0, 0, 0, -u*x, -u*y] * h = u
    //   Row 2: [0, 0, 0, x, y, 1, -v*x, -v*y] * h = v
    const A = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
      const { x, y } = srcPoints[i];
      const { x: u, y: v } = dstPoints[i];

      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);

      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }

    const h = LinearAlgebra.solve(A, b);

    // h = [h0, h1, h2, h3, h4, h5, h6, h7], h8 = 1
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  /**
   * Apply homography to a point. Returns the transformed {x, y}.
   */
  static transformPoint(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return {
      x: (H[0] * x + H[1] * y + H[2]) / w,
      y: (H[3] * x + H[4] * y + H[5]) / w,
    };
  }

}
