const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

let backfaceCulling = false;
const lightDir = normalize({x: 1, y: 1, z: 1});

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

    const forward = normalize({
        x: sy * cp,
        y: sp,
        z: -cy * cp
    });

    const right = normalize({
        x: cy,
        y: 0,
        z: sy
    });

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
    const camSpace = worldToCamera(v, cam);
    const camZ = camSpace.z;
    const zi = -camZ;
    if (zi <= 0) return null; // reject behind-camera vertices

    const fovRad = cam.fov * Math.PI / 180;
    const tanHalf = Math.tan(fovRad / 2);
    const aspect = canvas.width / canvas.height;

    const px = (camSpace.x / -camZ) * (canvas.width / 2) / (tanHalf * aspect);
    const py = (camSpace.y / -camZ) * (canvas.height / 2) / tanHalf;

    return {
        x: canvas.width/2 + px,
        y: canvas.height/2 - py,
        zi,
        invZi: 1 / zi
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

function rectangularPrism(p1, p2, materials) {
    // p1 and p2 are opposite corners: {x,y,z}
    // materials = [front, back, left, right, top, bottom]

    const x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x);
    const y1 = Math.min(p1.y, p2.y), y2 = Math.max(p1.y, p2.y);
    const z1 = Math.min(p1.z, p2.z), z2 = Math.max(p1.z, p2.z);

    const [front, back, left, right, top, bottom] = materials;

    return [
        // Front (z2)
        { verts: [ {x:x1,y:y1,z:z2}, {x:x2,y:y1,z:z2}, {x:x2,y:y2,z:z2} ], material: front },
        { verts: [ {x:x1,y:y1,z:z2}, {x:x2,y:y2,z:z2}, {x:x1,y:y2,z:z2} ], material: front },

        // Back (z1)
        { verts: [ {x:x2,y:y1,z:z1}, {x:x1,y:y1,z:z1}, {x:x1,y:y2,z:z1} ], material: back },
        { verts: [ {x:x2,y:y1,z:z1}, {x:x1,y:y2,z:z1}, {x:x2,y:y2,z:z1} ], material: back },

        // Left (x1)
        { verts: [ {x:x1,y:y1,z:z1}, {x:x1,y:y1,z:z2}, {x:x1,y:y2,z:z2} ], material: left },
        { verts: [ {x:x1,y:y1,z:z1}, {x:x1,y:y2,z:z2}, {x:x1,y:y2,z:z1} ], material: left },

        // Right (x2)
        { verts: [ {x:x2,y:y1,z:z2}, {x:x2,y:y1,z:z1}, {x:x2,y:y2,z:z1} ], material: right },
        { verts: [ {x:x2,y:y1,z:z2}, {x:x2,y:y2,z:z1}, {x:x2,y:y2,z:z2} ], material: right },

        // Top (y2)
        { verts: [ {x:x1,y:y2,z:z2}, {x:x2,y:y2,z:z2}, {x:x2,y:y2,z:z1} ], material: top },
        { verts: [ {x:x1,y:y2,z:z2}, {x:x2,y:y2,z:z1}, {x:x1,y:y2,z:z1} ], material: top },

        // Bottom (y1)
        { verts: [ {x:x1,y:y1,z:z1}, {x:x2,y:y1,z:z1}, {x:x2,y:y1,z:z2} ], material: bottom },
        { verts: [ {x:x1,y:y1,z:z1}, {x:x2,y:y1,z:z2}, {x:x1,y:y1,z:z2} ], material: bottom }
    ];
}

const whiteMat = new Material({r:255,g:255,b:255}, 0);
const redMat = new Material({r:255,g:0,b:0}, 0);
const yellowMat = new Material({r:255,g:255,b:0}, 0);
const greenMat = new Material({r:0,g:255,b:0}, 0);
const blueMat = new Material({r:0,g:0,b:255}, 0);
const magentaMat = new Material({r:255,g:0,b:255}, 0);

const camera = new Camera({x:0, y:0, z:0});

let cube1 = rectangularPrism(
    { x: -1, y: -1, z: -3 },
    { x:  1, y:  1, z: -1 },
    [whiteMat, redMat, greenMat, blueMat, yellowMat, magentaMat]
);

let cube2 = rectangularPrism(
    { x: -1, y: -1, z: 1 },
    { x:  1, y:  1, z: 3 },
    [redMat, whiteMat, blueMat, greenMat, magentaMat, yellowMat]
);

let scene = {
    triangles: [
        ...cube1,
        ...cube2
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

// screen-space backface culling
function isBackfaceScreen(p0, p1, p2) {
    const area = (p1.x - p0.x) * (p2.y - p0.y) -
                 (p1.y - p0.y) * (p2.x - p0.x);
    return area <= 0; // CCW = front-facing
}

// Barycentric rasterization
function drawTriangleZBuffer(tri) {
    // Transform verts to camera space once
    const v0c = worldToCamera(tri.verts[0], camera);
    const v1c = worldToCamera(tri.verts[1], camera);
    const v2c = worldToCamera(tri.verts[2], camera);

    // Compute world-space normal
    const e1 = sub(tri.verts[1], tri.verts[0]);
    const e2 = sub(tri.verts[2], tri.verts[0]);
    const normal = normalize({
        x: e1.y * e2.z - e1.z * e2.y,
        y: e1.z * e2.x - e1.x * e2.z,
        z: e1.x * e2.y - e1.y * e2.x
    });

    let brightness = Math.max(0, dot(normal, lightDir));
    brightness = 0.2 + brightness * 0.8; // add ambient

    const base = tri.material.color;
    const shadedColor = {
        r: base.r * brightness,
        g: base.g * brightness,
        b: base.b * brightness
    };

    // Near-plane clipping in camera space (z < 0 is in front)
    const NEAR = 0.01; // distance in front of camera
    const verts = [v0c, v1c, v2c];
    const inside = [];
    const outside = [];

    for (let i = 0; i < 3; i++) {
        (verts[i].z < -NEAR ? inside : outside).push(verts[i]);
    }

    if (inside.length === 0) {
        // whole triangle is behind camera: discard
        return;
    }

    // intersection of edge (a->b) with z = 0 plane
    function intersect(a, b) {
        const targetZ = -NEAR; // plane at z = -NEAR (in front)
        const t = (a.z - targetZ) / (a.z - b.z); // solve a.z + t*(b.z - a.z) = targetZ
        return {
            x: a.x + t * (b.x - a.x),
            y: a.y + t * (b.y - a.y),
            z: targetZ
        };
    }

    // Build a list of 1 or 2 clipped triangles in camera space
    const clippedTris = [];

    if (inside.length === 3) {
        // no clipping needed
        clippedTris.push(inside);
    } else if (inside.length === 1 && outside.length === 2) {
        // one inside, two outside → one smaller triangle
        const v0 = inside[0];
        const v1 = intersect(v0, outside[0]);
        const v2 = intersect(v0, outside[1]);
        clippedTris.push([v0, v1, v2]);
    } else if (inside.length === 2 && outside.length === 1) {
        // two inside, one outside → quad split into two triangles
        const v0 = inside[0];
        const v1 = inside[1];
        const v2 = intersect(v0, outside[0]);
        const v3 = intersect(v1, outside[0]);
        clippedTris.push([v0, v1, v2], [v1, v3, v2]);
    }

    // project from camera space (avoid double worldToCamera)
    function projectFromCamSpace(camSpace, cam) {
        const camZ = camSpace.z;
        const zi = -camZ;
        if (zi <= 0) return null; // with clipping, zi will be >= NEAR
    
        const fovRad = cam.fov * Math.PI / 180;
        const tanHalf = Math.tan(fovRad / 2);
        const aspect = canvas.width / canvas.height;
    
        const px = (camSpace.x / -camZ) * (canvas.width / 2) / (tanHalf * aspect);
        const py = (camSpace.y / -camZ) * (canvas.height / 2) / tanHalf;
    
        return {
            x: canvas.width/2 + px,
            y: canvas.height/2 - py,
            zi,
            invZi: 1 / zi
        };
    }    

    // Rasterize each clipped triangle
    for (const cTri of clippedTris) {
        const p0 = projectFromCamSpace(cTri[0], camera);
        const p1 = projectFromCamSpace(cTri[1], camera);
        const p2 = projectFromCamSpace(cTri[2], camera);
        if (!p0 || !p1 || !p2) continue;

        // Optional backface culling in screen space
        if (backfaceCulling) {
            const area = (p1.x - p0.x) * (p2.y - p0.y) -
                         (p1.y - p0.y) * (p2.x - p0.x);
            if (area <= 0) continue;
        }

        let denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
        if (denom === 0) continue;
        const invDenom = 1 / denom;

        const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
        const maxX = Math.min(canvas.width  - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
        const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
        const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));

        const invZ0 = p0.invZi, invZ1 = p1.invZi, invZ2 = p2.invZi;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) * invDenom;
                const w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) * invDenom;
                const w2 = 1 - w0 - w1;

                if ((w0 >= 0 && w1 >= 0 && w2 >= 0) ||
                    (w0 <= 0 && w1 <= 0 && w2 <= 0)) {

                    const invZ = w0 * invZ0 + w1 * invZ1 + w2 * invZ2;
                    const depth = 1 / invZ;
                    setPixel(x, y, depth, shadedColor);
                }
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
