export interface LineArtOptions {
  closingRadius?: number;
  minRegionArea?: number;
  lineThickness?: number;
}

export interface LineArtQuality {
  score: number;
  lineCoverage: number;
  enclosedRegions: number;
  tinyRegions: number;
}

export function computeEdgeMagnitudes(imageData: ImageData): {
  magnitudes: Float32Array;
  width: number;
  height: number;
} {
  const { width, height, data } = imageData;
  const n = width * height;

  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const enhanced = autoContrast(gray);
  const blurred = separableBlur(enhanced, width, height, 2.5);

  const mag = new Float32Array(n);
  const dir = new Float32Array(n);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = blurred[(y - 1) * width + (x - 1)];
      const tc = blurred[(y - 1) * width + x];
      const tr = blurred[(y - 1) * width + (x + 1)];
      const ml = blurred[y * width + (x - 1)];
      const mr = blurred[y * width + (x + 1)];
      const bl = blurred[(y + 1) * width + (x - 1)];
      const bc = blurred[(y + 1) * width + x];
      const br = blurred[(y + 1) * width + (x + 1)];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      const idx = y * width + x;
      mag[idx] = Math.sqrt(gx * gx + gy * gy);
      dir[idx] = Math.atan2(gy, gx);
    }
  }

  const nms = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const m = mag[idx];
      if (m === 0) continue;

      let angle = dir[idx] * (180 / Math.PI);
      if (angle < 0) angle += 180;

      let m1 = 0;
      let m2 = 0;

      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        m1 = mag[y * width + (x + 1)];
        m2 = mag[y * width + (x - 1)];
      } else if (angle >= 22.5 && angle < 67.5) {
        m1 = mag[(y - 1) * width + (x + 1)];
        m2 = mag[(y + 1) * width + (x - 1)];
      } else if (angle >= 67.5 && angle < 112.5) {
        m1 = mag[(y - 1) * width + x];
        m2 = mag[(y + 1) * width + x];
      } else {
        m1 = mag[(y - 1) * width + (x - 1)];
        m2 = mag[(y + 1) * width + (x + 1)];
      }

      nms[idx] = (m >= m1 && m >= m2) ? m : 0;
    }
  }

  let max = 0;
  for (let i = 0; i < n; i++) {
    if (nms[i] > max) max = nms[i];
  }
  if (max > 0) {
    for (let i = 0; i < n; i++) {
      nms[i] = (nms[i] / max) * 255;
    }
  }

  return { magnitudes: nms, width, height };
}

export function magnitudesToLineArt(
  magnitudes: Float32Array,
  width: number,
  height: number,
  threshold: number,
  options?: LineArtOptions
): ImageData {
  const { closingRadius = 0, minRegionArea = 0, lineThickness = 0 } = options || {};
  const hasPostProcessing = closingRadius > 0 || minRegionArea > 0 || lineThickness > 0;
  const n = width * height;

  const highThresh = threshold;
  const lowThresh = highThresh * 0.4;

  const strong = new Uint8Array(n);
  const weak = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (magnitudes[i] > highThresh) {
      strong[i] = 1;
    } else if (magnitudes[i] > lowThresh) {
      weak[i] = 1;
    }
  }

  let binary = new Uint8Array(n);
  const visited = new Uint8Array(n);
  const stack: number[] = [];

  for (let i = 0; i < n; i++) {
    if (strong[i] && !visited[i]) {
      visited[i] = 1;
      binary[i] = 1;
      stack.push(i);

      while (stack.length > 0) {
        const ci = stack.pop()!;
        const cx = ci % width;
        const cy = (ci - cx) / width;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (visited[ni]) continue;
            if (strong[ni] || weak[ni]) {
              visited[ni] = 1;
              binary[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
    }
  }

  for (let t = 0; t < lineThickness; t++) {
    binary = dilate(binary, width, height);
  }

  if (closingRadius > 0) {
    binary = morphClose(binary, width, height, closingRadius);
  }

  if (minRegionArea > 0) {
    binary = removeSmallRegions(binary, width, height, minRegionArea);
  }

  if (hasPostProcessing) {
    binary = smoothLines(binary, width, height);
  }

  const output = new ImageData(width, height);
  for (let i = 0; i < n; i++) {
    const v = binary[i] ? 0 : 255;
    output.data[i * 4] = v;
    output.data[i * 4 + 1] = v;
    output.data[i * 4 + 2] = v;
    output.data[i * 4 + 3] = 255;
  }
  return output;
}

export function generateBoundaryMask(canvasCtx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const imgData = canvasCtx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = (imgData.data[i * 4 + 3] > 128 && imgData.data[i * 4] < 128) ? 1 : 0;
  }
  return mask;
}

export function assessLineArtQuality(lineArt: ImageData, tinyRegionLimit = 90): LineArtQuality {
  const { width, height, data } = lineArt;
  const size = width * height;
  const lineMask = new Uint8Array(size);
  let linePixels = 0;

  for (let i = 0; i < size; i++) {
    const brightness = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    if (brightness < 140) {
      lineMask[i] = 1;
      linePixels++;
    }
  }

  const visited = new Uint8Array(size);
  let enclosedRegions = 0;
  let tinyRegions = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || lineMask[start]) continue;

      const stack: number[] = [x, y];
      visited[start] = 1;
      let regionArea = 0;
      let touchesBorder = false;

      while (stack.length > 0) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        const idx = cy * width + cx;
        regionArea++;

        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
          touchesBorder = true;
        }

        const neighbors = [
          [cx - 1, cy], [cx + 1, cy],
          [cx, cy - 1], [cx, cy + 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni] || lineMask[ni]) continue;
          visited[ni] = 1;
          stack.push(nx, ny);
        }
      }

      if (!touchesBorder) {
        enclosedRegions++;
        if (regionArea < tinyRegionLimit) tinyRegions++;
      }
    }
  }

  const lineCoverage = linePixels / size;
  const tinyRatio = enclosedRegions > 0 ? tinyRegions / enclosedRegions : 0;
  const densityPenalty = lineCoverage < 0.04
    ? (0.04 - lineCoverage) * 900
    : lineCoverage > 0.35
      ? (lineCoverage - 0.35) * 500
      : 0;
  const tinyPenalty = tinyRatio * 55;
  const score = Math.max(0, Math.min(100, 100 - densityPenalty - tinyPenalty));

  return {
    score,
    lineCoverage,
    enclosedRegions,
    tinyRegions,
  };
}

function autoContrast(gray: Float32Array): Float32Array {
  const n = gray.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    hist[Math.round(Math.min(255, Math.max(0, gray[i])))]++;
  }

  const target1 = Math.floor(n * 0.01);
  const target99 = Math.floor(n * 0.99);
  let cum = 0;
  let lo = 0;
  let hi = 255;
  let foundLo = false;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (!foundLo && cum >= target1) {
      lo = i;
      foundLo = true;
    }
    if (cum >= target99) {
      hi = i;
      break;
    }
  }

  const range = hi - lo || 1;
  const output = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    output[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255));
  }
  return output;
}

function makeGaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / s2);
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

function separableBlur(input: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const kernel = makeGaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;

  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const px = Math.min(w - 1, Math.max(0, x + k));
        sum += input[y * w + px] * kernel[k + radius];
      }
      temp[y * w + x] = sum;
    }
  }

  const output = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const py = Math.min(h - 1, Math.max(0, y + k));
        sum += temp[py * w + x] * kernel[k + radius];
      }
      output[y * w + x] = sum;
    }
  }

  return output;
}

function dilate(binary: Uint8Array, w: number, h: number): Uint8Array {
  const output = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && binary[ny * w + nx]) {
            hit = true;
          }
        }
      }
      output[y * w + x] = hit ? 1 : 0;
    }
  }
  return output;
}

function erode(binary: Uint8Array, w: number, h: number): Uint8Array {
  const output = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allSet = true;
      for (let dy = -1; dy <= 1 && allSet; dy++) {
        for (let dx = -1; dx <= 1 && allSet; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !binary[ny * w + nx]) {
            allSet = false;
          }
        }
      }
      output[y * w + x] = allSet ? 1 : 0;
    }
  }
  return output;
}

function morphClose(binary: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  let result = binary;
  for (let i = 0; i < radius; i++) result = dilate(result, w, h);
  for (let i = 0; i < radius; i++) result = erode(result, w, h);
  return result;
}

function removeSmallRegions(binary: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const result = Uint8Array.from(binary);
  const visited = new Uint8Array(w * h);

  for (let startY = 0; startY < h; startY++) {
    for (let startX = 0; startX < w; startX++) {
      const startIdx = startY * w + startX;
      if (visited[startIdx] || result[startIdx] === 1) continue;

      const region: number[] = [];
      const stack: number[] = [startX, startY];
      visited[startIdx] = 1;
      let touchesBorder = false;

      while (stack.length > 0) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        const ci = cy * w + cx;
        region.push(ci);

        if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) {
          touchesBorder = true;
        }

        const neighbors = [
          [cx - 1, cy], [cx + 1, cy],
          [cx, cy - 1], [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni] || result[ni] === 1) continue;
          visited[ni] = 1;
          stack.push(nx, ny);
        }
      }

      if (!touchesBorder && region.length < minArea) {
        for (const idx of region) {
          result[idx] = 1;
        }
      }
    }
  }

  return result;
}

function smoothLines(binary: Uint8Array, w: number, h: number): Uint8Array {
  const floatImg = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) floatImg[i] = binary[i] * 255;

  const blurred = separableBlur(floatImg, w, h, 0.7);

  const output = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    output[i] = blurred[i] > 127 ? 1 : 0;
  }
  return output;
}
