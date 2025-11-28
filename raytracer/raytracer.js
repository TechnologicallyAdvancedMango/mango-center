const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

// Preview resolution (fast, interactive)
const PREVIEW_WIDTH  = Math.floor(canvas.clientWidth / 12);
const PREVIEW_HEIGHT = Math.floor(canvas.clientHeight / 12);

// Render resolution (higher quality)
const RENDER_WIDTH  = Math.floor(canvas.clientWidth / 2);
const RENDER_HEIGHT = Math.floor(canvas.clientHeight / 2);

// how many samples each worker computes per pixel, per batch
const samplesPerPixel = 1; // 1–4 for speed, higher for quality

let autoPreview = false;    // automatic preview on movement
let manualPreview = true;   // manual toggle when autoPreview is false

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

function translationMatrix(tx, ty, tz) {
    return [1,0,0,0,
            0,1,0,0,
            0,0,1,0,
            tx,ty,tz,1];
}

function rotationY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [ c,0,-s,0,
             0,1, 0,0,
             s,0, c,0,
             0,0, 0,1];
}

function applyMatrix(v, m) {
    return {
        x: v.x*m[0] + v.y*m[4] + v.z*m[8]  + m[12],
        y: v.x*m[1] + v.y*m[5] + v.z*m[9]  + m[13],
        z: v.x*m[2] + v.y*m[6] + v.z*m[10] + m[14]
    };
}

function applyTransform(v, pos, rot, scale) {
    // scale first
    let x = v.x * scale.x;
    let y = v.y * scale.y;
    let z = v.z * scale.z;

    // rotation (Euler XYZ)
    const cx = Math.cos(degToRad(rot.x)), sx = Math.sin(degToRad(rot.x));
    const cy = Math.cos(degToRad(rot.y)), sy = Math.sin(degToRad(rot.y));
    const cz = Math.cos(degToRad(rot.z)), sz = Math.sin(degToRad(rot.z));

    // rotate around X
    let y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    y = y1; z = z1;

    // rotate around Y
    let x2 = x * cy + z * sy;
    let z2 = -x * sy + z * cy;
    x = x2; z = z2;

    // rotate around Z
    let x3 = x * cz - y * sz;
    let y3 = x * sz + y * cz;
    x = x3; y = y3;

    // translate
    return { x: x + pos.x, y: y + pos.y, z: z + pos.z };
}

class Mesh {
    constructor(vertices = [], faces = [], material = null, transform = null) {
        // apply transform if provided
        const verts = transform
            ? vertices.map(v => applyMatrix(v, transform))
            : vertices;

        this.triangles = faces.map(face => {
            const [i0, i1, i2] = face;
            return {
                v0: verts[i0],
                v1: verts[i1],
                v2: verts[i2],
                material
            };
        });
    }
}

// Same as in raytracer-worker.js
class BVHNode {
    constructor(triangles) {
        this.triangles = triangles;
        this.left = null;
        this.right = null;
        this.bounds = computeBounds(triangles);
    }
}

function computeBounds(tris) {
    const min = {x:Infinity,y:Infinity,z:Infinity};
    const max = {x:-Infinity,y:-Infinity,z:-Infinity};
    for (const t of tris) {
        for (const v of [t.v0, t.v1, t.v2]) {
            min.x = Math.min(min.x, v.x);
            min.y = Math.min(min.y, v.y);
            min.z = Math.min(min.z, v.z);
            max.x = Math.max(max.x, v.x);
            max.y = Math.max(max.y, v.y);
            max.z = Math.max(max.z, v.z);
        }
    }
    return {min, max};
}

function buildBVH(tris, depth=0) {
    if (tris.length <= 4 || depth > 16) {
        return new BVHNode(tris); // leaf
    }

    // choose split axis (longest)
    const bounds = computeBounds(tris);
    const size = {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z
    };
    const axis = size.x > size.y && size.x > size.z ? 'x' :
                 size.y > size.z ? 'y' : 'z';

    // sort and split
    tris.sort((a,b) => {
        const ca = (a.v0[axis]+a.v1[axis]+a.v2[axis])/3;
        const cb = (b.v0[axis]+b.v1[axis]+b.v2[axis])/3;
        return ca - cb;
    });
    const mid = Math.floor(tris.length/2);

    const node = new BVHNode([]);
    node.bounds = bounds;
    node.left = buildBVH(tris.slice(0,mid), depth+1);
    node.right = buildBVH(tris.slice(mid), depth+1);
    return node;
}

function hitAABB(rayOrig, rayDir, bounds) {
    let tmin = (bounds.min.x - rayOrig.x) / rayDir.x;
    let tmax = (bounds.max.x - rayOrig.x) / rayDir.x;
    if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

    let tymin = (bounds.min.y - rayOrig.y) / rayDir.y;
    let tymax = (bounds.max.y - rayOrig.y) / rayDir.y;
    if (tymin > tymax) [tymin, tymax] = [tymax, tymin];

    if (tmin > tymax || tymin > tmax) return false;
    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;

    let tzmin = (bounds.min.z - rayOrig.z) / rayDir.z;
    let tzmax = (bounds.max.z - rayOrig.z) / rayDir.z;
    if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

    if (tmin > tzmax || tzmin > tmax) return false;
    return true;
}

function traverseBVH(node, rayOrig, rayDir) {
    const stack = [node];
    let best = null;

    while (stack.length) {
        const current = stack.pop();
        if (!hitAABB(rayOrig, rayDir, current.bounds)) continue;

        if (current.triangles.length) {
            // leaf: test triangles
            for (const tri of current.triangles) {
                const res = intersectTriangle({ origin: rayOrig, dir: rayDir }, tri);
                if (res && (!best || res.t < best.t)) {
                    best = res;
                }
            }
        } else {
            if (current.left) stack.push(current.left);
            if (current.right) stack.push(current.right);
        }
    }
    return best;
}

function intersectTriangle(ray, tri) {
    const EPS = 1e-6;
    const edge1 = sub(tri.v1, tri.v0);
    const edge2 = sub(tri.v2, tri.v0);

    // Möller–Trumbore
    const h = {
        x: ray.dir.y*edge2.z - ray.dir.z*edge2.y,
        y: ray.dir.z*edge2.x - ray.dir.x*edge2.z,
        z: ray.dir.x*edge2.y - ray.dir.y*edge2.x
    };
    const a = dot(edge1, h);
    if (Math.abs(a) < EPS) return null;

    const f = 1.0 / a;
    const s = sub(ray.origin, tri.v0);
    const u = f * dot(s, h);
    if (u < 0 || u > 1) return null;

    const q = {
        x: s.y*edge1.z - s.z*edge1.y,
        y: s.z*edge1.x - s.x*edge1.z,
        z: s.x*edge1.y - s.y*edge1.x
    };
    const v = f * dot(ray.dir, q);
    if (v < 0 || u + v > 1) return null;

    const t = f * dot(edge2, q);
    if (t > EPS) {
        const hitPoint = {
            x: ray.origin.x + ray.dir.x * t,
            y: ray.origin.y + ray.dir.y * t,
            z: ray.origin.z + ray.dir.z * t
        };

        // Geometric normal
        let normal = normalize({
            x: edge1.y*edge2.z - edge1.z*edge2.y,
            y: edge1.z*edge2.x - edge1.x*edge2.z,
            z: edge1.x*edge2.y - edge1.y*edge2.x
        });

        // Determine front vs back
        const frontFace = dot(ray.dir, normal) < 0;
        if (!frontFace && !tri.material.doubleSided) {
            return null; // cull backfaces if not double-sided
        }

        // Flip normal so it always opposes the ray (for consistent shading)
        if (!frontFace) {
            normal = { x:-normal.x, y:-normal.y, z:-normal.z };
        }

        return { t, hitPoint, normal, material: tri.material, frontFace };
    }
    return null;
}

function traceRayPreview(origin, dir, scene) {
    let closest = Infinity;
    let hitColor = {r:0,g:0,b:0};

    // spheres (keep brute force for now)
    for (const s of scene.spheres) {
        const oc = sub(origin, s.center);
        const a = dot(dir, dir);
        const b = 2 * dot(oc, dir);
        const c = dot(oc, oc) - s.radius * s.radius;
        const disc = b*b - 4*a*c;
        if (disc > 0) {
            const t = (-b - Math.sqrt(disc)) / (2*a);
            if (t > 0.001 && t < closest) {
                closest = t;
                hitColor = {
                    r: s.material.color.r/255,
                    g: s.material.color.g/255,
                    b: s.material.color.b/255
                };
            }
        }
    }

    // triangles via BVH
    const resTri = traverseBVH(bvhRootPreview, origin, dir);
    if (resTri && resTri.t < closest) {
        closest = resTri.t;
        hitColor = {
            r: resTri.material.color.r/255,
            g: resTri.material.color.g/255,
            b: resTri.material.color.b/255
        };
    }

    return hitColor;
}

class RectangularPrism {
    constructor(min, max, material) {
        // Corner indices
        //  z=min (front)             z=max (back)
        //  0----1                     4----5
        //  |    |                     |    |
        //  3----2                     7----6

        const v = [
            {x:min.x, y:min.y, z:min.z}, // 0
            {x:max.x, y:min.y, z:min.z}, // 1
            {x:max.x, y:max.y, z:min.z}, // 2
            {x:min.x, y:max.y, z:min.z}, // 3
            {x:min.x, y:min.y, z:max.z}, // 4
            {x:max.x, y:min.y, z:max.z}, // 5
            {x:max.x, y:max.y, z:max.z}, // 6
            {x:min.x, y:max.y, z:max.z}  // 7
        ];

        this.triangles = [
            // front (z = min.z), outward normal (0,0,-1)
            { v0:v[0], v1:v[3], v2:v[2], material },
            { v0:v[2], v1:v[1], v2:v[0], material },

            // back (z = max.z), outward normal (0,0,1)
            { v0:v[4], v1:v[5], v2:v[6], material },
            { v0:v[6], v1:v[7], v2:v[4], material },

            // left (x = min.x), outward normal (-1,0,0)
            { v0:v[0], v1:v[4], v2:v[7], material },
            { v0:v[7], v1:v[3], v2:v[0], material },

            // right (x = max.x), outward normal (1,0,0)
            { v0:v[1], v1:v[2], v2:v[6], material },
            { v0:v[6], v1:v[5], v2:v[1], material },

            // bottom (y = min.y), outward normal (0,-1,0)
            { v0:v[0], v1:v[1], v2:v[5], material },
            { v0:v[5], v1:v[4], v2:v[0], material },

            // top (y = max.y), outward normal (0,1,0)
            { v0:v[3], v1:v[7], v2:v[6], material },
            { v0:v[6], v1:v[2], v2:v[3], material }
        ];
    }
}

async function loadOBJ(url, material, {
    position = {x:0,y:0,z:0},
    rotation = {x:0,y:0,z:0}, // degrees
    scale = {x:1,y:1,z:1}
} = {}) {
    const text = await fetch(url).then(r => r.text());
    const lines = text.split('\n');
    const vertices = [];
    const faces = [];

    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'v') {
            vertices.push({
                x: parseFloat(parts[1]),
                y: parseFloat(parts[2]),
                z: parseFloat(parts[3])
            });
        } else if (parts[0] === 'f') {
            const idx = parts.slice(1).map(p => parseInt(p.split('/')[0], 10) - 1);
            if (idx.length === 3) faces.push(idx);
            else if (idx.length === 4) {
                faces.push([idx[0], idx[1], idx[2]]);
                faces.push([idx[0], idx[2], idx[3]]);
            }
        }
    }

    // apply transform
    const transformed = vertices.map(v => applyTransform(v, position, rotation, scale));

    return new Mesh(transformed, faces, material);
}

class Material {
    constructor({
        color = {r:255,g:255,b:255},
        reflectivity = 0.0,
        roughness = 0.0,
        ior = null, // index of refraction (null = opaque)
        emission = {r:0,g:0,b:0},
        emissionStrength = 0.0,
        doubleSided = false
    } = {}) {
        this.color = color;
        this.reflectivity = reflectivity;
        this.roughness = roughness;
        this.ior = ior;
        this.emission = emission;
        this.emissionStrength = emissionStrength;
        this.doubleSided = doubleSided;
    }
}

const ground = new Material({
    color: {r:255,g:255,b:255},
    reflectivity: 0.1,
    roughness: 0.8,
    ior: null
});

const glass = new Material({
    color: {r:200,g:200,b:200},
    reflectivity: 0.05,
    roughness: 0.0,
    ior: 1.5, // glass
    doubleSided: true
});

const mirror = new Material({
    color: {r:0,g:0,b:0},
    reflectivity: 1,
    roughness: 0.0,
    ior: null
});

const light = new Material({
    color: {r:255,g:255,b:255},
    reflectivity: 0,
    roughness: 0.0,
    ior: null,
    emission: {r:255,g:255,b:255},
    emissionStrength: 1
});

const sun = new Material({
    color: {r:255,g:255,b:255},
    reflectivity: 0,
    roughness: 0.0,
    ior: null,
    emission: {r:255,g:255,b:255},
    emissionStrength: 2
});

const redMat = new Material({
    color:{r:255,g:0,b:0},
    reflectivity:0.2,
    roughness:0.2
});

const greenMat = new Material({
    color:{r:0,g:255,b:0},
    reflectivity:0.1,
    roughness:0.7
});

const whiteMat = new Material({
    color:{r:255,g:255,b:255},
    reflectivity:0.2,
    roughness:0.0
});

const mirrorMat = new Material({
    color:{r:0,g:0,b:0},
    reflectivity:1.0,
    roughness:0.0
});

const cyanGlow = new Material({
    color:{r:0,g:255,b:255},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:0,g:255,b:255},
    emissionStrength:2
});

const magentaGlow = new Material({
    color:{r:255,g:0,b:255},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:255,g:0,b:255},
    emissionStrength:2
});

const redGlow = new Material({
    color:{r:255,g:0,b:0},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:255,g:0,b:0},
    emissionStrength:2
});

const red = new Material({
    color:{r:255,g:0,b:0},
    reflectivity:0.1,
    roughness:0.5
});
const green = new Material({
    color:{r:0,g:255,b:0},
    reflectivity:0.1,
    roughness:0.5
});
const blue = new Material({
    color:{r:0,g:0,b:255},
    reflectivity:0.1,
    roughness:0.5
});


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
function degToRad(deg) { return deg * Math.PI / 180; }
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
        { center:{x:0,y:0,z:-5}, radius:1, material: glass }, // glass balls
        { center:{x:0,y:0,z:-8}, radius:1, material: glass }, 
        { center:{x:6,y:0,z:-5}, radius:1, material: greenMat },
        { center:{x:9,y:0,z:-5}, radius:1, material: whiteMat },
        { center:{x:3,y:0,z:-5}, radius:1, material: mirrorMat }, // mirror balls
         { center:{x:3,y:0,z:-8}, radius:1, material: mirrorMat },
        { center:{x:-3,y:0,z:-5}, radius:1, material: cyanGlow },
        { center:{x:-5.5,y:0,z:-5}, radius:1, material: magentaGlow },
        { center:{x:12,y:0,z:-5}, radius:1, material: redGlow },

        { center:{x:30,y:40,z:-70}, radius:30, material: sun } // sun
    ],
    triangles: [
        { v0:{x:100,y:-1,z:-100}, v1:{x:-100,y:-1,z:-100}, v2:{x:0,y:-1,z:100}, material: ground } // ground
    ]
};

// Glass wall
const box = new RectangularPrism(
    {x:10,y:-1,z:-2}, // min corner
    {x:15,y:2,z:-1},  // max corner
    glass
);
scene.triangles.push(...box.triangles);

scene.triangles.push(...new RectangularPrism(
    {x:17,y:-1,z:-2}, // min corner
    {x:18,y:2,z:-1},  // max corner
    cyanGlow
).triangles);

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
    // vertical relative to camera up
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
    const previewCam = new Camera(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    previewCam.position = {...camera.position};
    previewCam.yaw = camera.yaw;
    previewCam.pitch = camera.pitch;
    previewCam.fov = camera.fov;

    const img = new Uint8ClampedArray(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
    const basis = getCameraBasis(previewCam);

    for (let y = 0; y < PREVIEW_HEIGHT; y++) {
        for (let x = 0; x < PREVIEW_WIDTH; x++) {
            const u = (2 * (x + 0.5) / PREVIEW_WIDTH - 1);
            const v = (2 * (y + 0.5) / PREVIEW_HEIGHT - 1);

            const dir = previewCam.getDirection(u, v);
            const color = traceRayPreview(previewCam.position, dir, scene);

            const idx = (y * PREVIEW_WIDTH + x) * 4;
            img[idx]   = Math.pow(color.r, 1/2.2) * 255 | 0;
            img[idx+1] = Math.pow(color.g, 1/2.2) * 255 | 0;
            img[idx+2] = Math.pow(color.b, 1/2.2) * 255 | 0;
            img[idx+3] = 255;
        }
    }

    const previewImage = new ImageData(img, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const offscreen = document.createElement("canvas");
    offscreen.width = PREVIEW_WIDTH;
    offscreen.height = PREVIEW_HEIGHT;
    offscreen.getContext("2d").putImageData(previewImage, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
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
        width: RENDER_WIDTH,
        height: RENDER_HEIGHT,
        fov: 60,
        forward: basis.forward,
        right: basis.right,
        up: basis.up
    };

    const sliceHeight = Math.floor(canvas.height / numWorkers);

    for (let i = 0; i < numWorkers; i++) {
        const yStart = i * sliceHeight;
        const h = (i === numWorkers-1) ? canvas.height - yStart : sliceHeight;

        workers[i].postMessage({
            scene,
            camera: camPayload,
            x: 0,
            y: yStart,
            width: canvas.width,
            height: h,
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
    // Canvas dimensions at full render resolution
    canvas.width  = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;

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

function boxBlur(src, width, height, radius=1) {
    const channels = 4;
    const tmp = new Float32Array(src.length);
    const dst = new Uint8ClampedArray(src.length);

    // Horizontal pass
    for (let y=0; y<height; y++) {
        for (let x=0; x<width; x++) {
            let r=0,g=0,b=0,a=0,count=0;
            for (let dx=-radius; dx<=radius; dx++) {
                const nx = x+dx;
                if (nx>=0 && nx<width) {
                    const idx = (y*width+nx)*channels;
                    r+=src[idx]; g+=src[idx+1]; b+=src[idx+2]; a+=src[idx+3];
                    count++;
                }
            }
            const outIdx = (y*width+x)*channels;
            tmp[outIdx]   = r/count;
            tmp[outIdx+1] = g/count;
            tmp[outIdx+2] = b/count;
            tmp[outIdx+3] = a/count;
        }
    }

    // Vertical pass
    for (let y=0; y<height; y++) {
        for (let x=0; x<width; x++) {
            let r=0,g=0,b=0,a=0,count=0;
            for (let dy=-radius; dy<=radius; dy++) {
                const ny = y+dy;
                if (ny>=0 && ny<height) {
                    const idx = (ny*width+x)*channels;
                    r+=tmp[idx]; g+=tmp[idx+1]; b+=tmp[idx+2]; a+=tmp[idx+3];
                    count++;
                }
            }
            const outIdx = (y*width+x)*channels;
            dst[outIdx]   = r/count;
            dst[outIdx+1] = g/count;
            dst[outIdx+2] = b/count;
            dst[outIdx+3] = a/count;
        }
    }

    return dst;
}

function applyBloom(src, width, height, threshold=0.8, radius=2) {
    const channels = 4;
    const bright = new Float32Array(src.length);

    // 1. Extract bright areas
    for (let i=0; i<src.length; i+=channels) {
        const r = src[i]/255, g = src[i+1]/255, b = src[i+2]/255;
        const brightness = Math.max(r, g, b); // instead of luminance
        if (brightness > threshold) {
            bright[i]   = src[i];
            bright[i+1] = src[i+1];
            bright[i+2] = src[i+2];
            bright[i+3] = 255;
        }
    }

    // 2. Blur bright buffer (simple box blur)
    const blurred = boxBlur(bright, width, height, radius);

    // 3. Additive blend back
    const dst = new Uint8ClampedArray(src.length);
    for (let i=0; i<src.length; i+=channels) {
        dst[i]   = Math.min(255, src[i]   + blurred[i]);
        dst[i+1] = Math.min(255, src[i+1] + blurred[i+1]);
        dst[i+2] = Math.min(255, src[i+2] + blurred[i+2]);
        dst[i+3] = 255;
    }
    return dst;
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
        width: RENDER_WIDTH,
        height: RENDER_HEIGHT,
        fov: 60,
        forward: basis.forward,
        right: basis.right,
        up: basis.up
    };

    const sliceHeight = Math.floor(canvas.height / numWorkers);

    for (let i = 0; i < numWorkers; i++) {
        const yStart = i * sliceHeight;
        const h = (i === numWorkers - 1) ? canvas.height - yStart : sliceHeight;

        workers[i].postMessage({
            scene,
            camera: camPayload,
            x: 0,
            y: yStart,
            width: canvas.width,
            height: h,
            frameId: currentGen,
            samplesPerPixel
        });
    }
}

async function loadModelsAndBuildBVH() {
    // Load all async models
    const suzanne = await loadOBJ("objects/suzanne.obj", whiteMat, {
        position: {x:-10, y:1, z:-10},
        rotation: {x:0, y:135, z:0}, // degrees
        scale: {x:2, y:2, z:2}
    })
    /*
    const teapot = await loadOBJ("objects/teapot.obj", whiteMat, {
        position: {x:10, y:1, z:-10},
        rotation: {x:0, y:0, z:0}, // degrees
        scale: {x:0.05, y:0.05, z:0.05}
    })
    */

    // Push them into the scene
    scene.triangles.push(...suzanne.triangles);
    //scene.triangles.push(...teapot.triangles);
    

    // Rebuild BVH once all models are loaded
    bvhRootPreview = buildBVH(scene.triangles);
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

let bvhRootPreview;
loadModelsAndBuildBVH().then(() => {
    startWorkers();
    resetAccumulation();
    tick();
});