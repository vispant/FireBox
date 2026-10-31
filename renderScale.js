// Full-resolution rendering for the game canvases.
//
// Every game draws in a fixed *logical* coordinate space (e.g. 960x540) and
// reads canvas.width / canvas.height to lay itself out. The canvas is then
// CSS-stretched to fill the screen, so on a 1080p or hi-DPI display a 960x540
// backing store gets upscaled and everything (text, edges, sprites) looks soft.
//
// enableSupersampling() keeps canvas.width / canvas.height reporting the
// logical size (so no game needs to change) but allocates a larger backing
// store matching the real on-screen pixel size, and installs a matching
// context transform so all existing draw calls stay in logical units.

const MAX_SCALE = 3;
const MAX_BACKING_PIXELS = 2560 * 1440; // keep 4K screens from becoming a fill-rate problem

const widthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
const heightDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height");

let currentScale = 1;

export function getRenderScale() {
  return currentScale;
}

function computeRenderScale(logicalW, logicalH) {
  if (!logicalW || !logicalH) return 1;
  const dpr = window.devicePixelRatio || 1;
  // The canvas is displayed with object-fit: cover over the whole viewport.
  const cssScale = Math.max(window.innerWidth / logicalW, window.innerHeight / logicalH);
  let s = Math.min(MAX_SCALE, Math.max(1, cssScale * dpr));
  const pixels = logicalW * logicalH * s * s;
  if (pixels > MAX_BACKING_PIXELS) s = Math.max(1, Math.sqrt(MAX_BACKING_PIXELS / (logicalW * logicalH)));
  return s;
}

export function enableSupersampling(canvas, ctx) {
  let logicalW = canvas.width;
  let logicalH = canvas.height;

  function applyBacking() {
    const s = computeRenderScale(logicalW, logicalH);
    const bw = Math.max(1, Math.round(logicalW * s));
    const bh = Math.max(1, Math.round(logicalH * s));
    widthDesc.set.call(canvas, bw);
    heightDesc.set.call(canvas, bh);
    // resizing the backing store resets all context state
    ctx.setTransform(bw / logicalW, 0, 0, bh / logicalH, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    currentScale = s;
  }

  Object.defineProperty(canvas, "width", {
    configurable: true,
    get: () => logicalW,
    set: (v) => {
      logicalW = v;
      applyBacking();
    },
  });
  Object.defineProperty(canvas, "height", {
    configurable: true,
    get: () => logicalH,
    set: (v) => {
      logicalH = v;
      applyBacking();
    },
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyBacking, 200);
  });

  applyBacking();
}
