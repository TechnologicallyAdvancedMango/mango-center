const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

class Camera {
    constructor (position = {x:0, y:0, z:0}, rotation) {
        this.position = position;
        this.yaw = 0;
        this.pitch = 0;
        this.fov = 60;
    }
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

// Basis: look down -Z at yaw=0, pitch=0
function getCameraBasis(camera) {
    const cy = Math.cos(camera.yaw),  sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

    // Forward: -Z at yaw=0, pitch=0 (standard right-handed view)
    const forward = normalize({
        x: sy * cp,
        y: sp,
        z: -cy * cp
    });

    // Right: purely horizontal, depends only on yaw
    // Ensures no basis degeneracy when pitch ~ ±90°
    const right = normalize({
        x: cy,
        y: 0,
        z: sy
    });

    // Up: derived to keep orthonormality and handedness
    const up = normalize({
        x: right.y * forward.z - right.z * forward.y,
        y: right.z * forward.x - right.x * forward.z,
        z: right.x * forward.y - right.y * forward.x
    });

    return { forward, right, up };
}

const keys = {};

document.addEventListener("keydown", e => {
    keys[e.code] = true;
});

document.addEventListener("keyup", e => {
    keys[e.code] = false;
});

function moveCamera() {
    const { forward, right, up } = getCameraBasis(camera);
    const speed = 0.1; // smaller step for smoother motion

    if (keys["KeyW"]) {
        camera.position.x += forward.x * speed;
        camera.position.y += forward.y * speed;
        camera.position.z += forward.z * speed;
    }
    if (keys["KeyS"]) {
        camera.position.x -= forward.x * speed;
        camera.position.y -= forward.y * speed;
        camera.position.z -= forward.z * speed;
    }
    if (keys["KeyA"]) {
        camera.position.x -= right.x * speed;
        camera.position.y -= right.y * speed;
        camera.position.z -= right.z * speed;
    }
    if (keys["KeyD"]) {
        camera.position.x += right.x * speed;
        camera.position.y += right.y * speed;
        camera.position.z += right.z * speed;
    }
    if (keys["Space"]) { // up
        camera.position.x += up.x * speed;
        camera.position.y += up.y * speed;
        camera.position.z += up.z * speed;
    }
    if (keys["ShiftLeft"]) { // down
        camera.position.x -= up.x * speed;
        camera.position.y -= up.y * speed;
        camera.position.z -= up.z * speed;
    }
}

document.addEventListener("mousemove", e => {
    if (document.pointerLockElement === canvas) {
        camera.yaw   += e.movementX * 0.002 * Math.min(camera.fov / 60, 1);
        camera.pitch -= e.movementY * 0.002 * Math.min(camera.fov / 60, 1); // flip sign
        const maxPitch = Math.PI/2 - 0.01;
        camera.pitch = Math.max(-maxPitch, Math.min(maxPitch, camera.pitch));
    }
});

canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
});


function worldToCamera(v, cam) {
    const {forward, right, up} = getCameraBasis(cam);
    const rel = sub(v, cam.position);
    return {
        x: dot(rel, right),
        y: dot(rel, up),
        z: -dot(rel, forward)
    };
}

function projectVertex(v, cam) {
    // Camera-space transform
    const camSpace = worldToCamera(v, cam);
    const camZ = camSpace.z;           // negative when in front (we look down -Z)
    const zi = -camZ;                  // positive distance in front
    if (zi <= 0 || zi < 0.1) return null; // clip too close/behind to avoid blow-ups

    const fovRad = cam.fov * Math.PI / 180;
    const tanHalf = Math.tan(fovRad/2);

    // Perspective divide with -camZ
    const px = (camSpace.x / -camZ) * (canvas.width/2) / tanHalf;
    const py = (camSpace.y / -camZ) * (canvas.height/2) / tanHalf;

    return {
        x: canvas.width/2 + px,
        y: canvas.height/2 - py,
        zi,               // positive depth (distance along view)
        invZi: 1 / zi     // for perspective-correct interpolation
    };
}


function drawTriangle(tri) {
    const p0 = projectVertex(tri.verts[0], camera);
    const p1 = projectVertex(tri.verts[1], camera);
    const p2 = projectVertex(tri.verts[2], camera);
    if (!p0 || !p1 || !p2) return;

    ctx.fillStyle = `rgb(${tri.material.color.r},${tri.material.color.g},${tri.material.color.b})`;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fill();
}

class Material {
    constructor (color = {r:255,g:255,b:255}, emissionStrength = 0.0) {
        this.color = color;
        this.emissionStrength = emissionStrength;
    }
}

const whiteMat = new Material({r:255,g:255,b:255}, 0);
const redMat = new Material({r:255,g:0,b:0}, 0);
const greenMat = new Material({r:0,g:255,b:0}, 0);

const camera = new Camera({x:0, y:0, z:0});

let scene = {
    triangles: [
        { 
            verts: [ {x:1, y:-1, z:-2},
                {x:-1, y:1, z:-2},
                {x:-1, y:-1, z:-2}
            ], 
            material: whiteMat
        },
        { 
            verts: [ {x:1, y:-1, z:-2},
                {x:-1, y:1, z:-2},
                {x:1, y:1, z:-2}
            ], 
            material: redMat
        },
        { 
            verts: [ {x:1, y:-1, z:2},
                {x:-1, y:1, z:2},
                {x:-1, y:-1, z:2}
            ], 
            material: whiteMat
        },
        { 
            verts: [ {x:1, y:-1, z:2},
                {x:-1, y:1, z:2},
                {x:1, y:1, z:2}
            ], 
            material: greenMat
        }
    ]
};


const imageData = ctx.createImageData(canvas.width, canvas.height);
const depthBuffer = new Float32Array(canvas.width * canvas.height);

function clearBuffers() {
    depthBuffer.fill(Infinity);
    imageData.data.fill(0); // black background
}

function setPixel(x, y, depth, color) {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const idx = y * canvas.width + x;
    if (depth < depthBuffer[idx]) {
        depthBuffer[idx] = depth;
        const i = idx * 4;
        imageData.data[i+0] = color.r;
        imageData.data[i+1] = color.g;
        imageData.data[i+2] = color.b;
        imageData.data[i+3] = 255;
    }
}


// Barycentric rasterization
function drawTriangleZBuffer(tri) {
    const p0 = projectVertex(tri.verts[0], camera);
    const p1 = projectVertex(tri.verts[1], camera);
    const p2 = projectVertex(tri.verts[2], camera);
    if (!p0 || !p1 || !p2) return;

    // Optional backface culling (CCW front) (broken)
    const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
    if (denom === 0) return;
    // broken culling:
    //if (denom < 0) return;

    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(canvas.width  - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));

    const invZ0 = p0.invZi, invZ1 = p1.invZi, invZ2 = p2.invZi;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            // Barycentric weights w.r.t. triangle (p0,p1,p2)
            const w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) / denom;
            const w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) / denom;
            const w2 = 1 - w0 - w1;

            // Inside test (allow a small epsilon to reduce cracks)
            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                // Perspective-correct depth: interpolate invZ, invert
                const invZ = w0 * invZ0 + w1 * invZ1 + w2 * invZ2;
                const depth = 1 / invZ; // positive, smaller = closer

                setPixel(x, y, depth, tri.material.color);
            }
        }
    }
}

function renderFrame() {
    moveCamera();
    clearBuffers();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const tri of scene.triangles) {
        drawTriangleZBuffer(tri);
    }

    ctx.putImageData(imageData, 0, 0);
    requestAnimationFrame(renderFrame);
}
renderFrame();