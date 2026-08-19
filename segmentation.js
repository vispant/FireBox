import {
  ImageSegmenter,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Real background replacement: a second MediaPipe model classifies every pixel
// as "person" or "not person" each frame. We use that as an alpha mask to cut
// just the player out of the camera feed, so a drawn scene can stand in for
// their actual room instead of just being blended underneath it.
export function createPersonSegmenter() {
  let segmenter = null;
  let latestMask = null;
  let lastVideoTime = -1;
  const alphaCanvas = document.createElement("canvas");
  const cutoutCanvas = document.createElement("canvas");

  async function init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      runningMode: "VIDEO",
    };
    try {
      segmenter = await ImageSegmenter.createFromOptions(vision, options);
    } catch (err) {
      console.warn("GPU segmentation delegate unavailable, falling back to CPU.", err);
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
  }

  function maskToAlphaCanvas(mask) {
    const w = mask.width;
    const h = mask.height;
    const data = mask.getAsFloat32Array();
    alphaCanvas.width = w;
    alphaCanvas.height = h;
    const actx = alphaCanvas.getContext("2d");
    const imgData = actx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      imgData.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
    }
    actx.putImageData(imgData, 0, 0);
    return alphaCanvas;
  }

  function update(video, timestampMs) {
    if (!segmenter || !video || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    segmenter.segmentForVideo(video, timestampMs, (result) => {
      latestMask = result.confidenceMasks && result.confidenceMasks[0] ? result.confidenceMasks[0] : null;
    });
  }

  // Returns a canvas containing just the player (transparent elsewhere), mirrored
  // to match the rest of the game's mirrored camera view. Null if not ready yet.
  function getPersonCutout(video, width, height) {
    if (!latestMask || !video || video.readyState < 2 || !width || !height) return null;

    const alpha = maskToAlphaCanvas(latestMask);

    cutoutCanvas.width = width;
    cutoutCanvas.height = height;
    const octx = cutoutCanvas.getContext("2d");
    octx.clearRect(0, 0, width, height);

    octx.save();
    octx.translate(width, 0);
    octx.scale(-1, 1);
    octx.drawImage(video, 0, 0, width, height);
    octx.restore();

    octx.globalCompositeOperation = "destination-in";
    octx.save();
    octx.translate(width, 0);
    octx.scale(-1, 1);
    octx.drawImage(alpha, 0, 0, width, height);
    octx.restore();
    octx.globalCompositeOperation = "source-over";

    return cutoutCanvas;
  }

  return {
    init,
    update,
    getPersonCutout,
    isReady: () => !!segmenter,
  };
}
