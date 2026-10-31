export const POSE = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

// How many internal canvas pixels are needed to reserve `desiredRealPx` of
// actual on-screen clearance below the DOM HUD bar. The internal canvas
// resolution now adapts to each device's aspect ratio (see main.js's
// computeViewportResolution), so a fixed pixel offset that looked right on a
// landscape laptop can end up far too thin — or, on a very wide canvas, overly
// generous — once the internal-px-per-real-px ratio changes. Games that draw
// UI near the top of the canvas (HUD-adjacent panels, game boards) should
// derive their top clearance from this instead of a bare constant.
export function hudClearance(canvas, desiredRealPx) {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.height > 0 ? canvas.height / rect.height : 1;
  return desiredRealPx * scale;
}

export function toCanvasCoords(landmark, canvasWidth, canvasHeight) {
  // Landmarks are normalized [0,1] against the raw (unmirrored) video.
  // The camera feed is drawn mirrored, so flip x to match what the player sees.
  return {
    x: (1 - landmark.x) * canvasWidth,
    y: landmark.y * canvasHeight,
  };
}

// Hand-drawn (not an image/emoji-font) smiley that tracks and covers the
// player's face each frame, sized from ear-to-ear distance when both ears
// are visible, falling back to a fixed size (still centered on the nose)
// when the head is turned and an ear drops out of view.
export function drawFaceEmoji(ctx, landmarks, canvasWidth, canvasHeight) {
  if (!landmarks) return;
  const nose = landmarks[POSE.NOSE];
  if (!nose) return;

  const center = toCanvasCoords(nose, canvasWidth, canvasHeight);

  let radius = 55;
  const leftEar = landmarks[POSE.LEFT_EAR];
  const rightEar = landmarks[POSE.RIGHT_EAR];
  const earVisible = (l) => !!l && (l.visibility === undefined || l.visibility > 0.4);
  if (earVisible(leftEar) && earVisible(rightEar)) {
    const l = toCanvasCoords(leftEar, canvasWidth, canvasHeight);
    const r = toCanvasCoords(rightEar, canvasWidth, canvasHeight);
    const earDist = Math.hypot(l.x - r.x, l.y - r.y);
    radius = Math.max(40, Math.min(150, earDist * 0.85));
  }

  const x = center.x;
  const y = center.y;

  const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
  grad.addColorStop(0, "#fde68a");
  grad.addColorStop(1, "#facc15");
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(120,53,15,0.6)";
  ctx.lineWidth = Math.max(2, radius * 0.04);
  ctx.stroke();

  ctx.fillStyle = "rgba(248,113,113,0.45)";
  ctx.beginPath();
  ctx.arc(x - radius * 0.55, y + radius * 0.15, radius * 0.16, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.55, y + radius * 0.15, radius * 0.16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(x - radius * 0.32, y - radius * 0.15, radius * 0.09, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.32, y - radius * 0.15, radius * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = Math.max(2, radius * 0.07);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.05, radius * 0.45, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}
