export class LinearAlgebra {
  /**
   * Solve Ax = b using Gaussian elimination with partial pivoting.
   * A is an NxN matrix (array of arrays), b is an N-length array.
   * Returns x as an array.
   */
  static solve(A, b) {
    const n = A.length;
    // Augmented matrix
    const aug = A.map((row, i) => [...row, b[i]]);

    for (let k = 0; k < n; k++) {
      // Partial pivoting: find row with largest absolute value in column k
      let maxVal = Math.abs(aug[k][k]);
      let maxRow = k;
      for (let i = k + 1; i < n; i++) {
        if (Math.abs(aug[i][k]) > maxVal) {
          maxVal = Math.abs(aug[i][k]);
          maxRow = i;
        }
      }

      // Swap rows
      if (maxRow !== k) {
        const tmp = aug[k];
        aug[k] = aug[maxRow];
        aug[maxRow] = tmp;
      }

      if (Math.abs(aug[k][k]) < 1e-12) {
        throw new Error("Singular matrix in Gaussian elimination");
      }

      // Eliminate below
      for (let i = k + 1; i < n; i++) {
        const factor = aug[i][k] / aug[k][k];
        for (let j = k; j <= n; j++) {
          aug[i][j] -= factor * aug[k][j];
        }
      }
    }

    // Back substitution
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = aug[i][n];
      for (let j = i + 1; j < n; j++) {
        sum -= aug[i][j] * x[j];
      }
      x[i] = sum / aug[i][i];
    }

    return x;
  }

}
