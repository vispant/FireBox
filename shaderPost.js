// A full-screen WebGL fragment-shader pass applied over every game's 2D
// canvas, every frame: a cheap bloom glow on bright areas, gentle cinematic
// colour grading, a subtle chromatic-aberration lens effect toward the
// screen edges, and fine animated film grain. No game file needs to know
// this exists -- it just re-renders whatever `sourceCanvas` already drew
// (unchanged) onto `targetCanvas`, which sits on top of it in the DOM.
//
// Written in WebGL1-compatible GLSL ES 1.00 (no array constructors, no
// dynamic loop bounds) for the widest possible device support.

const VERTEX_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center);
  vec2 dir = dist > 0.0001 ? center / dist : vec2(0.0);

  // chromatic aberration: sample R/G/B at offsets that grow toward the edges
  float aberration = dist * 0.0022;
  float r = texture2D(uTex, clamp(vUv + dir * aberration, 0.0, 1.0)).r;
  float g = texture2D(uTex, vUv).g;
  float b = texture2D(uTex, clamp(vUv - dir * aberration, 0.0, 1.0)).b;
  vec3 color = vec3(r, g, b);

  // cheap bloom: 4 taps in a cross, weighted toward bright pixels, added back in softly
  vec2 o = uTexel * 2.8;
  vec3 s0 = texture2D(uTex, vUv + vec2( o.x,  0.0)).rgb;
  vec3 s1 = texture2D(uTex, vUv + vec2(-o.x,  0.0)).rgb;
  vec3 s2 = texture2D(uTex, vUv + vec2( 0.0,  o.y)).rgb;
  vec3 s3 = texture2D(uTex, vUv + vec2( 0.0, -o.y)).rgb;
  float w0 = smoothstep(0.62, 1.0, max(max(s0.r, s0.g), s0.b));
  float w1 = smoothstep(0.62, 1.0, max(max(s1.r, s1.g), s1.b));
  float w2 = smoothstep(0.62, 1.0, max(max(s2.r, s2.g), s2.b));
  float w3 = smoothstep(0.62, 1.0, max(max(s3.r, s3.g), s3.b));
  vec3 bloom = s0 * w0 + s1 * w1 + s2 * w2 + s3 * w3;
  float bloomWeight = w0 + w1 + w2 + w3;
  if (bloomWeight > 0.0) bloom /= bloomWeight;
  color += bloom * 0.2;

  // gentle cinematic grade: soft S-curve contrast, a touch more saturation,
  // a faint cool/warm split-tone between shadows and highlights
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 graded = mix(color, color * color * (3.0 - 2.0 * color), 0.18);
  graded += (luma - 0.5) * 0.06 * vec3(0.08, 0.02, -0.08);
  float satLuma = dot(graded, vec3(0.299, 0.587, 0.114));
  graded = mix(vec3(satLuma), graded, 1.08);
  color = graded;

  // fine animated film grain + a soft vignette so edges recede slightly
  float grain = (hash(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * 0.028;
  color += grain;
  color *= 1.0 - dist * dist * 0.18;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("Post-process shader failed to compile:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createPostProcessor(sourceCanvas, targetCanvas) {
  const glOpts = {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    depth: false,
    stencil: false,
    desynchronized: true,
    powerPreference: "high-performance",
  };
  const gl = targetCanvas.getContext("webgl", glOpts) || targetCanvas.getContext("experimental-webgl", glOpts);
  if (!gl) {
    console.warn("WebGL unavailable -- skipping the post-process shader layer.");
    return { render: () => {}, ok: false };
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = gl.createProgram();
  if (vs && fs) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  if (!vs || !fs || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Post-process shader program failed to link:", gl.getProgramInfoLog(program));
    return { render: () => {}, ok: false };
  }
  gl.useProgram(program);

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Canvas/image sources upload row-0-first, but WebGL texture space has
  // (0,0) at the bottom-left -- without this every frame renders upside down.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uTex = gl.getUniformLocation(program, "uTex");
  const uTexel = gl.getUniformLocation(program, "uTexel");
  const uTime = gl.getUniformLocation(program, "uTime");

  let lastW = 0;
  let lastH = 0;
  const start = performance.now();

  // Some devices (seen on Chromebooks under memory pressure) can report a
  // "working" WebGL context that later loses its GPU backing, or silently
  // emits GL errors instead of throwing -- either way the result is an
  // opaque black canvas sitting on top of the real game forever, since this
  // canvas has alpha:false. Treat any of that as fatal and permanently fall
  // back to the plain 2D canvas underneath rather than risk a black screen.
  let disabled = false;
  let frameCount = 0;
  function disableSelf(reason) {
    if (disabled) return;
    disabled = true;
    console.warn("Post-process shader disabled (" + reason + ") -- falling back to the plain canvas.");
    targetCanvas.classList.add("hidden");
  }
  targetCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    disableSelf("context lost");
  });

  function render() {
    if (disabled) return;
    try {
      if (gl.isContextLost()) {
        disableSelf("context lost");
        return;
      }
      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      if (!w || !h) return;
      if (targetCanvas.width !== w || targetCanvas.height !== h) {
        targetCanvas.width = w;
        targetCanvas.height = h;
      }
      if (w !== lastW || h !== lastH) {
        gl.viewport(0, 0, w, h);
        lastW = w;
        lastH = h;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uTexel, 1 / w, 1 / h);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Checking gl.getError() forces a GPU sync, so only sample it
      // occasionally rather than every frame.
      frameCount++;
      if (frameCount % 30 === 0 && gl.getError() !== gl.NO_ERROR) {
        disableSelf("GL error");
      }
    } catch (err) {
      disableSelf(err.message || "render threw");
    }
  }

  return { render, ok: true };
}
