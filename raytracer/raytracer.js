const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth / 2);
canvas.height = Math.floor(canvas.clientHeight / 2);

// how many samples each worker computes per pixel, per batch
const samplesPerPixel = 1; // 1–4 for speed, higher for quality
const tileSize = 64;

let autoPreview = false;      // automatic preview on movement
let manualPreview = false;   // manual toggle when autoPreview is false

function isPreviewMode() {
    return autoPreview ? true : manualPreview;
}

class Camera {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.position = {x:0, y:0, z:0};
        this.yaw = 0;   // left/right rotation
        this.pitch = 0; // up/down rotation
        this.speed = 0.1;
        this.fov = 60; // also set in workers
    }

    getDirection(u, v) {
        const { forward, right, up } = getCameraBasis(this);
        const aspect = this.width / this.height;
        const fovScale = Math.tan((this.fov * Math.PI / 180) * 0.5);

        const px = u * aspect * fovScale;
        const py = v * fovScale;

        return normalize({
            x: forward.x + px * right.x + py * up.x,
            y: forward.y + px * right.y + py * up.y,
            z: forward.z + px * right.z + py * up.z
        });
    }
}

function getCameraBasis(camera) {
  const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch), sinPitch = Math.sin(camera.pitch);

  // Forward vector
  const forward = {
    x: cosPitch * sinYaw,
    y: -sinPitch,
    z: -cosPitch * cosYaw
  };

  // Right vector (cross of forward with world up)
  const upWorld = {x:0,y:1,z:0};
  const right = normalize({
    x: forward.z*upWorld.y - forward.y*upWorld.z,
    y: forward.x*upWorld.z - forward.z*upWorld.x,
    z: forward.y*upWorld.x - forward.x*upWorld.y
  });

  // Up vector (cross of right and forward)
  const up = normalize({
    x: right.y*forward.z - right.z*forward.y,
    y: right.z*forward.x - right.x*forward.z,
    z: right.x*forward.y - right.y*forward.x
  });

  return {forward, right, up};
}

// Utility math
function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
function normalize(v) {
    const len = Math.sqrt(dot(v,v));
    if (len === 0) return {x:0, y:0, z:-1}; // guard against NaN
    return {x:v.x/len, y:v.y/len, z:v.z/len};
}

// scene
const scene = {
    spheres: [
        { // red sphere
            center:{x:0,y:0,z:-5}, radius:1,
            color:{r:255,g:0,b:0}, reflectivity:0.2, roughness:0.2,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },

        { // green matte sphere
            center:{x:6,y:0,z:-5}, radius:1,
            color:{r:0,g:255,b:0}, reflectivity:0.1, roughness:0.7,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },

        { // white shiny sphere
            center:{x:9,y:0,z:-5}, radius:1,
            color:{r:255,g:255,b:255}, reflectivity:0.2, roughness:0.0,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },

        { // mirror sphere
            center:{x:3,y:0,z:-5}, radius:1,
            color:{r:0,g:0,b:0}, reflectivity:1.0, roughness:0.0,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },

        { // glowing cyan
            center:{x:-3,y:0,z:-5}, radius:1,
            color:{r:0,g:255,b:255}, reflectivity:0.0, roughness:0.3,
            emission:{r:0,g:255,b:255}, emissionStrength:2
        },

        { // glowing magenta
            center:{x:-5.5,y:0,z:-5}, radius:1,
            color:{r:255,g:0,b:255}, reflectivity:0.0, roughness:0.3,
            emission:{r:255,g:0,b:255}, emissionStrength:2
        },

        { // sun
            center:{x:3,y:15,z:-5}, radius:10, 
            color:{r:255,g:255,b:255}, reflectivity:0, roughness:0,
            emission:{r:255,g:255,b:255}, emissionStrength:1
        }
    ],
    triangles: [
        { // ground
            v0:{x:100,y:0,z:-100}, v1:{x:-100,y:0,z:-100}, v2:{x:0,y:0,z:100}, 
            color:{r:255,g:255,b:255}, reflectivity:0.2, roughness:0.5,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },
        { // mirror 1
            v0:{x:-1,y:-1,z:-7}, v1:{x:-3,y:-1,z:-7}, v2:{x:-2,y:1,z:-7},
            color:{r:0,g:0,b:0}, reflectivity:0.9, roughness:0.0,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        },
        { // mirror 2
            v0:{x:-1,y:-1,z:-8}, v1:{x:-3,y:-1,z:-8}, v2:{x:-2,y:1,z:-8},
            color:{r:0,g:0,b:0}, reflectivity:0.9, roughness:0.0,
            emission:{r:0,g:0,b:0}, emissionStrength:0.0
        }
    ]
};

const camera = new Camera(canvas.width, canvas.height);

const keys = {};

function markInput() {
    lastInputAt = performance.now();
    needReset = true;
}

let isMoving = false;
let cameraChanged = false;

document.addEventListener("keydown", e => {
    if (e.key === "r" || e.key === "R") {
        manualPreview = !manualPreview;

        if (!manualPreview) {
            // just turned preview OFF, reset immediately
            resetAccumulation();
        }

        return;
    }

    // allow input in preview
    if (!isPreviewMode()) return;

    keys[e.key] = true;
    lastInputAt = performance.now();
    needReset = true;
    cameraChanged = true;
});

document.addEventListener("keyup", e => {
    if (!(isPreviewMode())) return;

    keys[e.key] = false;
    lastInputAt = performance.now();
    needReset = true;
    cameraChanged = true;
});

document.addEventListener("mousemove", e => {
    if (!(isPreviewMode())) return;
    if (document.pointerLockElement === canvas) {
        camera.yaw   -= e.movementX * 0.002;
        camera.pitch += e.movementY * 0.002;
        const maxPitch = Math.PI/2 - 0.01;
        camera.pitch = Math.max(-maxPitch, Math.min(maxPitch, camera.pitch));
        cameraChanged = true; // mark once
    }
});


canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
});


function updateCamera() {
    const { forward, right, up } = getCameraBasis(camera);
    const speed = camera.speed;

    if (keys["w"]) {
        camera.position.x += forward.x * speed;
        camera.position.y += forward.y * speed;
        camera.position.z += forward.z * speed;
    }
    if (keys["s"]) {
        camera.position.x -= forward.x * speed;
        camera.position.y -= forward.y * speed;
        camera.position.z -= forward.z * speed;
    }
    if (keys["a"]) {
        camera.position.x -= right.x * speed;
        camera.position.y -= right.y * speed;
        camera.position.z -= right.z * speed;
    }
    if (keys["d"]) {
        camera.position.x += right.x * speed;
        camera.position.y += right.y * speed;
        camera.position.z += right.z * speed;
    }
    // NEW: vertical relative to camera up
    if (keys[" "]) { // Space
        camera.position.x -= up.x * speed;
        camera.position.y -= up.y * speed;
        camera.position.z -= up.z * speed;
    }
    if (keys["Shift"]) { // Shift
        camera.position.x += up.x * speed;
        camera.position.y += up.y * speed;
        camera.position.z += up.z * speed;
    }
}

function renderOneFrameNow() {
    // create a temporary buffer
    const img = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const basis = getCameraBasis(camera);

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            // normalize screen coords to [-1,1]
            const u = (2 * (x + 0.5) / canvas.width - 1);
            const v = (2 * (y + 0.5) / canvas.height - 1);

            // get ray direction from camera
            const dir = camera.getDirection(u, v);

            // trace one ray (replace with your own trace function)
            const color = traceRay(camera.position, dir, scene);

            // gamma correct
            let r = Math.pow(Math.max(0, Math.min(1, color.r)), 1/2.2) * 255;
            let g = Math.pow(Math.max(0, Math.min(1, color.g)), 1/2.2) * 255;
            let b = Math.pow(Math.max(0, Math.min(1, color.b)), 1/2.2) * 255;

            const idx = (y * canvas.width + x) * 4;
            img[idx]   = r|0;
            img[idx+1] = g|0;
            img[idx+2] = b|0;
            img[idx+3] = 255;
        }
    }

    ctx.putImageData(new ImageData(img, canvas.width, canvas.height), 0, 0);
}

function traceRay(origin, dir, scene) {
    let closest = Infinity;
    let hitColor = {r:0, g:0, b:0};

    // sphere intersection
    for (const s of scene.spheres) {
        const oc = sub(origin, s.center);
        const a = dot(dir, dir);
        const b = 2 * dot(oc, dir);
        const c = dot(oc, oc) - s.radius * s.radius;
        const discriminant = b*b - 4*a*c;
        if (discriminant > 0) {
            const t = (-b - Math.sqrt(discriminant)) / (2*a);
            if (t > 0.001 && t < closest) {
                closest = t;
                hitColor = {r:s.color.r/255, g:s.color.g/255, b:s.color.b/255};
            }
        }
    }

    // triangle intersection (very simple, no shading)
    for (const tri of scene.triangles) {
        const edge1 = sub(tri.v1, tri.v0);
        const edge2 = sub(tri.v2, tri.v0);
        const h = {
            x: dir.y*edge2.z - dir.z*edge2.y,
            y: dir.z*edge2.x - dir.x*edge2.z,
            z: dir.x*edge2.y - dir.y*edge2.x
        };
        const a = dot(edge1, h);
        if (Math.abs(a) > 1e-6) {
            const f = 1/a;
            const s = sub(origin, tri.v0);
            const u = f * dot(s, h);
            if (u >= 0 && u <= 1) {
                const q = {
                    x: s.y*edge1.z - s.z*edge1.y,
                    y: s.z*edge1.x - s.x*edge1.z,
                    z: s.x*edge1.y - s.y*edge1.x
                };
                const v = f * dot(dir, q);
                if (v >= 0 && u+v <= 1) {
                    const t = f * dot(edge2, q);
                    if (t > 0.001 && t < closest) {
                        closest = t;
                        hitColor = {r:tri.color.r/255, g:tri.color.g/255, b:tri.color.b/255};
                    }
                }
            }
        }
    }

    return hitColor; // black if nothing hit
}

function resetAccumulation() {
    accumRGB.fill(0);
    sampleCount.fill(0);
    currentGen++;
    needReset = false;
    requeueAll(); // workers start accumulating
}


let currentGen = 0;
let lastInputAt = 0;
let needReset = true; // initial reset at boot
let previewing = false;
const idleDelayMs = 60; // small debounce so movement doesn’t thrash

const accumRGB = new Float32Array(canvas.width * canvas.height * 3);
const sampleCount = new Uint32Array(canvas.width * canvas.height);

const numWorkers = navigator.hardwareConcurrency || 4;
const workers = [];
let frameId = 0;
let currentFrameId = 1;
let frameBuffer = new Uint8ClampedArray(canvas.width * canvas.height * 4);
let tilesDone = 0;
let camPayload = null;

function startWorkers() {
    const basis = getCameraBasis(camera);
    camPayload = {
        position: { ...camera.position },
        width: canvas.width,
        height: canvas.height,
        fov: 60,
        forward: basis.forward,
        right: basis.right,
        up: basis.up
    };

    // one full-frame job per worker
    for (let i = 0; i < numWorkers; i++) {
        workers[i].postMessage({
            scene,
            camera: camPayload,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
            frameId: currentGen,
            samplesPerPixel
        });
    }
}

for (let i=0; i<numWorkers; i++) {
    workers[i] = new Worker("raytracer-worker.js");
    workers[i].onmessage = (e) => {
        const { x, y, width, height, accum, samples, frameId } = e.data;
        if (frameId !== currentGen) return;

        onTile({ x, y, width, height, accum, samples });

        workers[i].postMessage({
            scene,
            camera: camPayload,
            x, y, width, height,
            frameId: currentGen,
            samplesPerPixel
        });
    };
}

function displayFrame() {
    const img = new Uint8ClampedArray(canvas.width * canvas.height * 4);

    for (let p=0, q=0; p<sampleCount.length; p++, q+=4) {
        const s = Math.max(1, sampleCount[p]);
        let r = accumRGB[p*3]   / s;
        let g = accumRGB[p*3+1] / s;
        let b = accumRGB[p*3+2] / s;

        // gamma correction
        r = Math.pow(Math.max(0, Math.min(1, r)), 1/2.2) * 255;
        g = Math.pow(Math.max(0, Math.min(1, g)), 1/2.2) * 255;
        b = Math.pow(Math.max(0, Math.min(1, b)), 1/2.2) * 255;


        img[q]   = r|0;
        img[q+1] = g|0;
        img[q+2] = b|0;
        img[q+3] = 255;
    }

    ctx.putImageData(new ImageData(img, canvas.width, canvas.height), 0, 0);
}

function onTile({x, y, width, height, accum, samples}) {
    // accumulate
    for (let j=0; j<height; j++) {
        for (let i=0; i<width; i++) {
            const dstIdx = ((j + y) * canvas.width + (i + x)) * 3;
            const srcIdx = (j * width + i) * 3;
            accumRGB[dstIdx]   += accum[srcIdx];
            accumRGB[dstIdx+1] += accum[srcIdx+1];
            accumRGB[dstIdx+2] += accum[srcIdx+2];
            sampleCount[(j + y) * canvas.width + (i + x)] += samples;
        }
    }

    // only paint accumulated frame when NOT previewing
    if (!previewing) {
        displayFrame();
    }
}


function requeueAll() {
    const basis = getCameraBasis(camera);
    camPayload = {
        position: { ...camera.position },
        width: canvas.width,
        height: canvas.height,
        fov: 60,
        forward: basis.forward,
        right: basis.right,
        up: basis.up
    };

    for (let i = 0; i < numWorkers; i++) {
        workers[i].postMessage({
            scene,
            camera: camPayload,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
            frameId: currentGen,
            samplesPerPixel
        });
    }
}

function tick() {
    if (isPreviewMode()) {
        updateCamera();
    }

    previewing = autoPreview ? (performance.now() - lastInputAt) < 50 : manualPreview;

    if (previewing) {
        renderOneFrameNow();
    } else if (needReset) {
        resetAccumulation();
    } else {
        displayFrame();
    }

    requestAnimationFrame(tick);
}

startWorkers();
resetAccumulation(); // start accumulation immediately
tick();
