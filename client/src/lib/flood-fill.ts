export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

export function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number },
  boundaryMask: Uint8Array | null,
  tolerance: number = 32
): ImageData {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data);

  const sx = Math.round(startX);
  const sy = Math.round(startY);

  if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
    return new ImageData(output, width, height);
  }

  if (boundaryMask && boundaryMask[sy * width + sx]) {
    return new ImageData(output, width, height);
  }

  const startIdx = (sy * width + sx) * 4;
  const targetR = output[startIdx];
  const targetG = output[startIdx + 1];
  const targetB = output[startIdx + 2];

  if (
    Math.abs(targetR - fillColor.r) <= tolerance &&
    Math.abs(targetG - fillColor.g) <= tolerance &&
    Math.abs(targetB - fillColor.b) <= tolerance
  ) {
    return new ImageData(output, width, height);
  }

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  stack.push(sx, sy);

  const matches = (idx: number): boolean => {
    return (
      Math.abs(output[idx] - targetR) <= tolerance &&
      Math.abs(output[idx + 1] - targetG) <= tolerance &&
      Math.abs(output[idx + 2] - targetB) <= tolerance
    );
  };

  const canFill = (x: number, y: number): boolean => {
    const pi = y * width + x;
    if (visited[pi]) return false;
    if (boundaryMask && boundaryMask[pi]) return false;
    return matches(pi * 4);
  };

  let iterations = 0;
  const maxIterations = width * height;

  while (stack.length > 0 && iterations < maxIterations) {
    const y = stack.pop()!;
    let x = stack.pop()!;

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (!canFill(x, y)) continue;

    let left = x;
    while (left > 0 && canFill(left - 1, y)) left--;

    let right = x;
    while (right < width - 1 && canFill(right + 1, y)) right++;

    for (let fx = left; fx <= right; fx++) {
      const fi = y * width + fx;
      visited[fi] = 1;
      const di = fi * 4;
      output[di] = fillColor.r;
      output[di + 1] = fillColor.g;
      output[di + 2] = fillColor.b;
      output[di + 3] = 255;
    }

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      let spanStart = -1;
      for (let fx = left; fx <= right; fx++) {
        if (canFill(fx, ny)) {
          if (spanStart === -1) spanStart = fx;
        } else {
          if (spanStart !== -1) {
            stack.push(spanStart, ny);
            spanStart = -1;
          }
        }
      }
      if (spanStart !== -1) {
        stack.push(spanStart, ny);
      }
    }

    iterations++;
  }

  return new ImageData(output, width, height);
}
