import { PointUtils } from "./point-utils.js";

const DETECT_MAX_SIZE = 400;
const GAUSSIAN_KERNEL = [0.0702, 0.249, 0.3616, 0.249, 0.0702];
const HOUGH_PEAK_COUNT = 15;
const HOUGH_SUPPRESSION_RHO = 10;
const HOUGH_SUPPRESSION_THETA = 10;
const MIN_QUAD_AREA_RATIO = 0.05;
const ANGLE_CLUSTER_THRESHOLD = 15; // degrees

export class CornerDetector {
  /**
   * Detect document corners in an image.
   * Returns 4 corner points sorted TL→TR→BR→BL, or null if detection fails.
   *
   * @param {HTMLImageElement|HTMLCanvasElement} sourceImage
   * @returns {Array<{x: number, y: number}>|null}
   */
  static detect(sourceImage) {
    const { canvas, ratio } = CornerDetector._downscale(sourceImage, DETECT_MAX_SIZE);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    const gray = CornerDetector._toGrayscale(imageData);
    const blurred = CornerDetector._gaussianBlur(gray, w, h);
    const { magnitude, direction } = CornerDetector._sobelGradient(blurred, w, h);
    const nms = CornerDetector._nonMaxSuppression(magnitude, direction, w, h);
    const edges = CornerDetector._cannyThreshold(nms, w, h);
    const lines = CornerDetector._houghLines(edges, w, h);

    if (lines.length < 4) {
      return null;
    }

    const quad = CornerDetector._findBestQuadrilateral(lines, w, h);
    if (!quad) {
      return null;
    }

    // Scale back to source image coordinates
    return quad.map((p) => ({
      x: p.x * ratio,
      y: p.y * ratio,
    }));
  }

  static _downscale(image, maxSize) {
    const srcW = image.naturalWidth || image.width;
    const srcH = image.naturalHeight || image.height;
    const scale = Math.min(maxSize / Math.max(srcW, srcH), 1);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, w, h);

    return { canvas, ratio: 1 / scale };
  }

  static _toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const j = i * 4;
      gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
    return gray;
  }

  static _gaussianBlur(gray, w, h) {
    const k = GAUSSIAN_KERNEL;
    const r = Math.floor(k.length / 2);

    // Horizontal pass
    const temp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let ki = 0; ki < k.length; ki++) {
          const sx = Math.min(Math.max(x + ki - r, 0), w - 1);
          sum += gray[y * w + sx] * k[ki];
        }
        temp[y * w + x] = sum;
      }
    }

    // Vertical pass
    const result = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let ki = 0; ki < k.length; ki++) {
          const sy = Math.min(Math.max(y + ki - r, 0), h - 1);
          sum += temp[sy * w + x] * k[ki];
        }
        result[y * w + x] = sum;
      }
    }

    return result;
  }

  static _sobelGradient(gray, w, h) {
    const magnitude = new Float32Array(w * h);
    // Direction quantized: 0=horizontal, 1=diagonal(45), 2=vertical, 3=diagonal(135)
    const direction = new Uint8Array(w * h);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const tl = gray[(y - 1) * w + (x - 1)];
        const tc = gray[(y - 1) * w + x];
        const tr = gray[(y - 1) * w + (x + 1)];
        const ml = gray[y * w + (x - 1)];
        const mr = gray[y * w + (x + 1)];
        const bl = gray[(y + 1) * w + (x - 1)];
        const bc = gray[(y + 1) * w + x];
        const br = gray[(y + 1) * w + (x + 1)];

        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

        magnitude[idx] = Math.sqrt(gx * gx + gy * gy);

        // Quantize angle to 4 directions
        let angle = Math.atan2(gy, gx) * (180 / Math.PI);
        if (angle < 0) {
          angle += 180;
        }

        if (angle < 22.5 || angle >= 157.5) {
          direction[idx] = 0; // horizontal edge → check left/right
        } else if (angle < 67.5) {
          direction[idx] = 1; // 45° → check top-right/bottom-left
        } else if (angle < 112.5) {
          direction[idx] = 2; // vertical edge → check top/bottom
        } else {
          direction[idx] = 3; // 135° → check top-left/bottom-right
        }
      }
    }

    return { magnitude, direction };
  }

  static _nonMaxSuppression(magnitude, direction, w, h) {
    const result = new Float32Array(w * h);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const mag = magnitude[idx];
        if (mag === 0) {
          continue;
        }

        let n1 = 0;
        let n2 = 0;

        switch (direction[idx]) {
          case 0: // horizontal → compare left/right
            n1 = magnitude[idx - 1];
            n2 = magnitude[idx + 1];
            break;
          case 1: // 45° → compare top-right/bottom-left
            n1 = magnitude[(y - 1) * w + (x + 1)];
            n2 = magnitude[(y + 1) * w + (x - 1)];
            break;
          case 2: // vertical → compare top/bottom
            n1 = magnitude[(y - 1) * w + x];
            n2 = magnitude[(y + 1) * w + x];
            break;
          case 3: // 135° → compare top-left/bottom-right
            n1 = magnitude[(y - 1) * w + (x - 1)];
            n2 = magnitude[(y + 1) * w + (x + 1)];
            break;
        }

        if (mag >= n1 && mag >= n2) {
          result[idx] = mag;
        }
      }
    }

    return result;
  }

  static _cannyThreshold(nms, w, h) {
    // Compute automatic thresholds from median of non-zero magnitudes
    const nonZero = [];
    for (let i = 0; i < nms.length; i++) {
      if (nms[i] > 0) {
        nonZero.push(nms[i]);
      }
    }

    if (nonZero.length === 0) {
      return new Uint8Array(w * h);
    }

    nonZero.sort((a, b) => a - b);
    const median = nonZero[Math.floor(nonZero.length / 2)];
    let lowThreshold = Math.max(0.33 * median, 10);
    let highThreshold = Math.min(1.5 * median, 200);
    if (highThreshold <= lowThreshold) {
      highThreshold = lowThreshold * 1.5;
    }

    // Classify pixels: 0=suppressed, 1=weak, 2=strong
    const classified = new Uint8Array(w * h);
    for (let i = 0; i < nms.length; i++) {
      if (nms[i] >= highThreshold) {
        classified[i] = 2;
      } else if (nms[i] >= lowThreshold) {
        classified[i] = 1;
      }
    }

    // Hysteresis: BFS from strong edges to promote connected weak edges
    const edges = new Uint8Array(w * h);
    const queue = [];

    for (let i = 0; i < classified.length; i++) {
      if (classified[i] === 2) {
        edges[i] = 255;
        queue.push(i);
      }
    }

    while (queue.length > 0) {
      const idx = queue.pop();
      const px = idx % w;
      const py = (idx - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const neighbor = ny * w + nx;
          if (classified[neighbor] === 1 && edges[neighbor] === 0) {
            edges[neighbor] = 255;
            classified[neighbor] = 2;
            queue.push(neighbor);
          }
        }
      }
    }

    return edges;
  }

  static _houghLines(edges, w, h) {
    const diagonal = Math.ceil(Math.sqrt(w * w + h * h));
    const thetaSteps = 180;
    const rhoMax = diagonal;
    const accWidth = thetaSteps;
    const accHeight = 2 * rhoMax + 1;
    const accumulator = new Int32Array(accHeight * accWidth);

    // Precompute sin/cos tables
    const cosTable = new Float32Array(thetaSteps);
    const sinTable = new Float32Array(thetaSteps);
    for (let t = 0; t < thetaSteps; t++) {
      const theta = (t * Math.PI) / 180;
      cosTable[t] = Math.cos(theta);
      sinTable[t] = Math.sin(theta);
    }

    // Vote
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x] === 0) {
          continue;
        }
        for (let t = 0; t < thetaSteps; t++) {
          const rho = Math.round(x * cosTable[t] + y * sinTable[t]);
          accumulator[(rho + rhoMax) * accWidth + t]++;
        }
      }
    }

    // Find peaks with non-maximum suppression
    const peaks = [];
    for (let ri = 0; ri < accHeight; ri++) {
      for (let ti = 0; ti < accWidth; ti++) {
        const votes = accumulator[ri * accWidth + ti];
        if (votes < 20) {
          continue;
        }
        peaks.push({ rho: ri - rhoMax, thetaDeg: ti, votes });
      }
    }

    peaks.sort((a, b) => b.votes - a.votes);

    // Suppress nearby peaks
    const selected = [];
    for (const peak of peaks) {
      if (selected.length >= HOUGH_PEAK_COUNT) {
        break;
      }
      let tooClose = false;
      for (const s of selected) {
        const thetaDiff = Math.abs(s.thetaDeg - peak.thetaDeg);
        const wrappedThetaDiff = Math.min(thetaDiff, 180 - thetaDiff);
        if (
          Math.abs(s.rho - peak.rho) < HOUGH_SUPPRESSION_RHO &&
          wrappedThetaDiff < HOUGH_SUPPRESSION_THETA
        ) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        selected.push(peak);
      }
    }

    return selected.map((p) => ({
      rho: p.rho,
      theta: (p.thetaDeg * Math.PI) / 180,
      thetaDeg: p.thetaDeg,
      votes: p.votes,
    }));
  }

  static _findBestQuadrilateral(lines, w, h) {
    // Cluster lines by angle
    const clusters = [];
    for (const line of lines) {
      let placed = false;
      for (const cluster of clusters) {
        const diff = Math.abs(cluster.angle - line.thetaDeg);
        const wrappedDiff = Math.min(diff, 180 - diff);
        if (wrappedDiff < ANGLE_CLUSTER_THRESHOLD) {
          cluster.lines.push(line);
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ angle: line.thetaDeg, lines: [line] });
      }
    }

    // Need at least 2 clusters with 2+ lines each
    const validClusters = clusters
      .filter((c) => c.lines.length >= 2)
      .sort((a, b) => {
        const aVotes = a.lines.reduce((s, l) => s + l.votes, 0);
        const bVotes = b.lines.reduce((s, l) => s + l.votes, 0);
        return bVotes - aVotes;
      });

    if (validClusters.length < 2) {
      return null;
    }

    // Try pairs of clusters that are roughly perpendicular
    let bestQuad = null;
    let bestScore = 0;

    for (let ci = 0; ci < validClusters.length - 1; ci++) {
      for (let cj = ci + 1; cj < validClusters.length; cj++) {
        const clusterA = validClusters[ci];
        const clusterB = validClusters[cj];

        const angleDiff = Math.abs(clusterA.angle - clusterB.angle);
        const wrappedDiff = Math.min(angleDiff, 180 - angleDiff);
        if (wrappedDiff < 30 || wrappedDiff > 150) {
          continue; // Skip near-parallel clusters
        }

        // Pick the two most separated lines from each cluster
        const pairsA = CornerDetector._bestLinePair(clusterA.lines);
        const pairsB = CornerDetector._bestLinePair(clusterB.lines);

        if (!pairsA || !pairsB) {
          continue;
        }

        // Compute 4 intersections
        const corners = [];
        for (const la of pairsA) {
          for (const lb of pairsB) {
            const pt = CornerDetector._lineIntersection(la, lb);
            if (!pt) {
              continue;
            }
            // Allow slight out-of-bounds (5% margin)
            const margin = Math.max(w, h) * 0.05;
            if (pt.x >= -margin && pt.x <= w + margin && pt.y >= -margin && pt.y <= h + margin) {
              corners.push(pt);
            }
          }
        }

        if (corners.length !== 4) {
          continue;
        }

        const sorted = PointUtils.sortCorners(corners);
        if (!PointUtils.isConvex(sorted)) {
          continue;
        }

        // Check minimum area
        const area = CornerDetector._quadArea(sorted);
        if (area < w * h * MIN_QUAD_AREA_RATIO) {
          continue;
        }

        const score =
          pairsA[0].votes + pairsA[1].votes + pairsB[0].votes + pairsB[1].votes;
        if (score > bestScore) {
          bestScore = score;
          bestQuad = sorted;
        }
      }
    }

    return bestQuad;
  }

  /**
   * Pick the two most separated lines (by rho) from a cluster.
   */
  static _bestLinePair(lines) {
    if (lines.length < 2) {
      return null;
    }

    let maxDist = 0;
    let bestPair = null;
    for (let i = 0; i < lines.length - 1; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const dist = Math.abs(lines[i].rho - lines[j].rho);
        if (dist > maxDist) {
          maxDist = dist;
          bestPair = [lines[i], lines[j]];
        }
      }
    }
    return bestPair;
  }

  /**
   * Intersect two lines in (rho, theta) form.
   */
  static _lineIntersection(l1, l2) {
    const ct1 = Math.cos(l1.theta);
    const st1 = Math.sin(l1.theta);
    const ct2 = Math.cos(l2.theta);
    const st2 = Math.sin(l2.theta);
    const det = ct1 * st2 - ct2 * st1;

    if (Math.abs(det) < 1e-8) {
      return null; // Parallel lines
    }

    return {
      x: (l1.rho * st2 - l2.rho * st1) / det,
      y: (l2.rho * ct1 - l1.rho * ct2) / det,
    };
  }

  /**
   * Compute area of a quadrilateral using the shoelace formula.
   */
  static _quadArea(corners) {
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += corners[i].x * corners[j].y;
      area -= corners[j].x * corners[i].y;
    }
    return Math.abs(area) / 2;
  }
}
