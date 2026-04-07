export class PointUtils {
  static distance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Sort 4 points into consistent order: top-left, top-right, bottom-right, bottom-left.
   * Uses angle from centroid to determine position.
   */
  static sortCorners(points) {
    const cx = points.reduce((sum, p) => sum + p.x, 0) / 4;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / 4;

    const withAngles = points.map((p) => ({
      ...p,
      angle: Math.atan2(p.y - cy, p.x - cx),
    }));

    withAngles.sort((a, b) => a.angle - b.angle);

    // atan2 gives angles: right=0, bottom=π/2, left=±π, top=-π/2
    // After sorting by angle: right, bottom, left-bottom, left-top, top
    // We want: TL, TR, BR, BL
    // Find the top-left: smallest x+y sum
    let tlIndex = 0;
    let minSum = Infinity;
    for (let i = 0; i < 4; i++) {
      const sum = withAngles[i].x + withAngles[i].y;
      if (sum < minSum) {
        minSum = sum;
        tlIndex = i;
      }
    }

    const sorted = [];
    for (let i = 0; i < 4; i++) {
      const idx = (tlIndex + i) % 4;
      sorted.push({ x: withAngles[idx].x, y: withAngles[idx].y });
    }

    // Verify order: TL, TR, BR, BL (clockwise)
    // If the second point is below the first, we're going counter-clockwise — reverse
    if (sorted.length === 4) {
      const cross =
        (sorted[1].x - sorted[0].x) * (sorted[2].y - sorted[0].y) -
        (sorted[1].y - sorted[0].y) * (sorted[2].x - sorted[0].x);
      if (cross < 0) {
        // Counter-clockwise, reverse to make clockwise
        const tmp = sorted[1];
        sorted[1] = sorted[3];
        sorted[3] = tmp;
      }
    }

    return sorted;
  }

  /**
   * Check if 4 points form a convex quadrilateral.
   */
  static isConvex(points) {
    const n = points.length;
    if (n !== 4) {
      return false;
    }

    let sign = 0;
    for (let i = 0; i < n; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % n];
      const p2 = points[(i + 2) % n];
      const cross =
        (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      if (cross !== 0) {
        if (sign === 0) {
          sign = cross > 0 ? 1 : -1;
        } else if ((cross > 0 ? 1 : -1) !== sign) {
          return false;
        }
      }
    }
    return true;
  }
}
