const canvas = document.getElementById("canvas");
const context = canvas.getContext("webgpu");

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
    device,
    format: presentationFormat
});

// Read URL parameters
const params = new URLSearchParams(window.location.search);

const resDiv = parseInt(params.get("resDiv")) || 1;
const samplesPerPixel = parseInt(params.get("spp")) || 2; // 1–4 for speed, higher for quality

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

// Preview resolution (fast, interactive)
const PREVIEW_WIDTH  = Math.floor(canvas.clientWidth / 8);
const PREVIEW_HEIGHT = Math.floor(canvas.clientHeight / 8);

// Render resolution (higher quality)
const RENDER_WIDTH  = Math.floor(canvas.clientWidth / resDiv);
const RENDER_HEIGHT = Math.floor(canvas.clientHeight / resDiv);

let autoPreview = false;    // automatic preview on movement
let manualPreview = true;   // manual toggle when autoPreview is false

const WORKGROUP_SIZE_X = 8;
const WORKGROUP_SIZE_Y = 8;

if (params.get("autoRender") === "true") manualPreview = false; // Render immediately

let frameIndex = 0;

function isPreviewMode() {
    return autoPreview ? true : manualPreview;
}

let width  = isPreviewMode() ? PREVIEW_WIDTH  : RENDER_WIDTH;
let height = isPreviewMode() ? PREVIEW_HEIGHT : RENDER_HEIGHT;
width = Math.floor(width);
height = Math.floor(height);

function updateDimensions() {
    width  = isPreviewMode() ? PREVIEW_WIDTH  : RENDER_WIDTH;
    height = isPreviewMode() ? PREVIEW_HEIGHT : RENDER_HEIGHT;
    width = Math.floor(width);
    height = Math.floor(height);

    accumTex = device.createTexture({
        size: [width, height],
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
    prevTex = device.createTexture({
        size: [width, height],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
}

async function loadShaderModule(device, url) {
    const code = await fetch(url).then(res => res.text());
    return device.createShaderModule({ code });
}

let accumTex;
let prevTex;
let computePipeline, renderPipeline;
let computeBindGroup, renderBindGroup;
let sampler;

console.log(await fetch("compute.wgsl").then(r => r.text()));

const computeModule  = await loadShaderModule(device, "compute.wgsl");
const fragmentModule = await loadShaderModule(device, "fragment.wgsl");
const vertexModule   = device.createShaderModule({
    code: `
    @vertex
    fn vs_main(@builtin(vertex_index) VertexIndex : u32)
        -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 3.0, -1.0),
            vec2<f32>(-1.0,  3.0)
        );
        return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
    }`
});


class Camera {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.position = {x:0, y:0, z:0};
        this.yaw = 0;   // left/right rotation
        this.pitch = 0; // up/down rotation
        this.speed = 0.1;
        this.fov = 60;
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

function buildBVHIndices(tris, depth=0) {
    const idxs = tris.map((_, i) => i);
    function split(indices, depth) {
        const node = { triangles:[], left:null, right:null, bounds:computeBounds(indices.map(i=>tris[i])) };
        if (indices.length <= 4 || depth > 16) {
            node.triangles = indices.slice();
            return node;
        }
        const size = {
            x: node.bounds.max.x - node.bounds.min.x,
            y: node.bounds.max.y - node.bounds.min.y,
            z: node.bounds.max.z - node.bounds.min.z
        };
        const axis = size.x > size.y && size.x > size.z ? 'x' : (size.y > size.z ? 'y' : 'z');
        indices.sort((a,b) => {
            const ta = tris[a], tb = tris[b];
            const ca = (ta.v0[axis]+ta.v1[axis]+ta.v2[axis])/3;
            const cb = (tb.v0[axis]+tb.v1[axis]+tb.v2[axis])/3;
            return ca - cb;
        });
        const mid = Math.floor(indices.length/2);
        node.left  = split(indices.slice(0, mid), depth+1);
        node.right = split(indices.slice(mid),     depth+1);
        return node;
    }
    return split(idxs, depth);
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

function parseOBJ(objText, materialsDict) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const triangles = [];
    let currentMtl = null;

    function resolveIndex(idx, arr) {
        let i = parseInt(idx, 10);
        if (i < 0) i = arr.length + i + 1;
        return arr[i - 1];
    }

    for (const raw of objText.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === 'v') {
            positions.push({x:+parts[1], y:+parts[2], z:+parts[3]});
        } else if (tag === 'vn') {
            normals.push({x:+parts[1], y:+parts[2], z:+parts[3]});
        } else if (tag === 'vt') {
            uvs.push({u:parseFloat(parts[1]), v:parseFloat(parts[2])});
        } else if (tag === 'usemtl') {
            currentMtl = parts[1];
        } else if (tag === 'f') {
            const verts = parts.slice(1).map(tok => {
                const [vi, vti, vni] = tok.split('/');
                return {
                    pos: resolveIndex(vi, positions),
                    uv: vti ? resolveIndex(vti, uvs) : {u:0, v:0},  // default UV
                    nrm: vni ? resolveIndex(vni, normals) : null
                };
            });
            for (let i=1; i<verts.length-1; i++) {
                triangles.push({
                    v0: verts[0].pos,
                    v1: verts[i].pos,
                    v2: verts[i+1].pos,
                    uv0: verts[0].uv,
                    uv1: verts[i].uv,
                    uv2: verts[i+1].uv,
                    material: materialsDict[currentMtl] || new Material()
                });
            }
        }
    }
    return { triangles };
}

let materials = [];

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

        materials.push(this);
    }
}

function parseMTL(mtlText) {
    const materials = {};
    let current = null;

    for (const raw of mtlText.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === 'newmtl') {
            current = new Material(); // use your Material class defaults
            current.name = parts[1];
            materials[current.name] = current;
        } else if (!current) {
            continue;
        } else if (tag === 'Kd') {
            current.color = {
                r: Math.round(parseFloat(parts[1]) * 255),
                g: Math.round(parseFloat(parts[2]) * 255),
                b: Math.round(parseFloat(parts[3]) * 255)
            };
        } else if (tag === 'Ks') {
            const ks = parts.slice(1).map(parseFloat);
            current.reflectivity = Math.max(...ks);
        } else if (tag === 'Ns') {
            const ns = parseFloat(parts[1]);
            current.roughness = Math.max(0, Math.min(1, 1 - ns/1000));
        } else if (tag === 'Ni') {
            const ni = parseFloat(parts[1]);
            current.ior = (ni === 1.0) ? null : ni;
        } else if (tag === 'd') {
            const alpha = parseFloat(parts[1]);
            current.opacity = alpha;
            if (alpha < 1 && current.ior == null) current.ior = 1.5;
        } else if (tag === 'Ke') {
            const r = parseFloat(parts[1]);
            const g = parseFloat(parts[2]);
            const b = parseFloat(parts[3]);
            current.emission = {
                r: r, g: g, b: b
            };
            current.emissionStrength = Math.max(r,g,b); // intensity
        } else if (tag === 'map_Kd') {
            current.map_Kd = parts[1]; // store texture filename
        }
    }
    return materials;
}

const ground = new Material({
    color: {r:255,g:255,b:255},
    reflectivity: 0.1,
    roughness: 0.8,
    ior: null
});

const glass = new Material({
    color: { r:255, g:255, b:255 },   // no tint
    reflectivity: 0.0,                // let Fresnel govern specular; this value is for metals
    roughness: 0.0,
    ior: 1.5,
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
    emissionStrength: 4
});

const sun = new Material({
    color: {r:255,g:255,b:255},
    reflectivity: 0,
    roughness: 0.0,
    ior: null,
    emission: {r:255,g:255,b:255},
    emissionStrength: 2
});

const redWall = new Material({
    color:{r:255,g:0,b:0},
    reflectivity:0,
    roughness:0.8
});
const greenWall = new Material({
    color:{r:0,g:255,b:0},
    reflectivity:0,
    roughness:0.8
});
const whiteWall = new Material({
    color:{r:255,g:255,b:255},
    reflectivity:0,
    roughness:0.8
});

const greenMat = new Material({
    color:{r:0,g:255,b:0},
    reflectivity:0.1,
    roughness:0.7
});

const whiteMat = new Material({
    color:{r:250,g:250,b:250},
    reflectivity:0.1,
    roughness:0.3
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

const yellowGlow = new Material({
    color:{r:255,g:255,b:0},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:255,g:255,b:0},
    emissionStrength:2
});

const redGlow = new Material({
    color:{r:255,g:0,b:0},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:255,g:0,b:0},
    emissionStrength:2
});

const greenGlow = new Material({
    color:{r:0,g:255,b:0},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:0,g:255,b:0},
    emissionStrength:2
});

const blueGlow = new Material({
    color:{r:0,g:0,b:255},
    reflectivity:0.0,
    roughness:0.3,
    emission:{r:0,g:0,b:255},
    emissionStrength:2
});

materials.forEach((mat, i) => mat.id = i);

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
        // { center:{x:1.5,y:5,z:-6.5}, radius:1, material: light }, // light above the four reflective ones
        // { center:{x:-10,y:10,z:10}, radius:3, material: light }, // light above rock
        { center:{x:-3,y:0,z:-5}, radius:1, material: cyanGlow },
        { center:{x:-5.5,y:0,z:-5}, radius:1, material: magentaGlow },
        { center:{x:12,y:0,z:-5}, radius:1, material: redGlow },

        // { center:{x:30,y:40,z:-70}, radius:30, material: sun } // sun
    ],
    triangles: [
        { v0:{x:10000,y:-1,z:-10000}, v1:{x:-10000,y:-1,z:-10000}, v2:{x:0,y:-1,z:10000}, material: ground } // ground
    ]
};

// Light above everything
const skyLight = new RectangularPrism(
    {x:-50,y:50,z:-50}, // min corner
    {x:-20,y:51,z:-20},  // max corner
    light
);
scene.triangles.push(...skyLight.triangles);

// Glass wall
const wall = new RectangularPrism(
    {x:10,y:-1,z:-2}, // min corner
    {x:15,y:2,z:-1},  // max corner
    glass
);
scene.triangles.push(...wall.triangles);

// Glowing cyan pillar
scene.triangles.push(...new RectangularPrism(
    {x:17,y:-1,z:-2}, // min corner
    {x:18,y:2,z:-1},  // max corner
    cyanGlow
).triangles);

// Glowing red cube
scene.triangles.push(...new RectangularPrism(
    {x:9,y:1,z:9}, // min corner
    {x:10,y:2,z:10},  // max corner
    redGlow
).triangles);

// Glass cube
scene.triangles.push(...new RectangularPrism(
    {x:9,y:1,z:7}, // min corner
    {x:10,y:2,z:8},  // max corner
    glass
).triangles);

// Glowing green cube
scene.triangles.push(...new RectangularPrism(
    {x:11,y:1,z:7}, // min corner
    {x:12,y:2,z:8},  // max corner
    greenGlow
).triangles);

// Glowing blue cube
scene.triangles.push(...new RectangularPrism(
    {x:9,y:-1,z:7}, // min corner
    {x:10,y:0,z:8},  // max corner
    blueGlow
).triangles);

const camera = new Camera(canvas.width, canvas.height);
camera.position.y = 1; // move up on start

// Sphere buffer: 8 floats per sphere
const sphereData = new Float32Array(scene.spheres.length * 8);
scene.spheres.forEach((s, i) => {
    sphereData.set([
        s.center.x, s.center.y, s.center.z, s.radius,
        s.material.id, 0, 0, 0
    ], i * 8);
});

// Triangle buffer: 16 floats per triangle
const triData = new Float32Array(scene.triangles.length * 16);
scene.triangles.forEach((t, i) => {
    triData.set([
        t.v0.x, t.v0.y, t.v0.z, 0,
        t.v1.x, t.v1.y, t.v1.z, 0,
        t.v2.x, t.v2.y, t.v2.z, 0,
        t.material.id, 0, 0, 0
    ], i * 16);
});

// Camera buffer: 20 floats

const basis = getCameraBasis(camera);
const camData = new Float32Array([
    camera.position.x, camera.position.y, camera.position.z, camera.fov,
    basis.forward.x, basis.forward.y, basis.forward.z, 0,
    basis.right.x, basis.right.y, basis.right.z, 0,
    basis.up.x, basis.up.y, basis.up.z, 0,
    samplesPerPixel, width, height, 0 // width/height of accumTex
]);

const matData = new Float32Array(materials.length * 12);
materials.forEach((m, i) => {
    const base = i * 12;

    // color
    matData[base + 0]  = (m.color.r ?? 255) / 255;
    matData[base + 1]  = (m.color.g ?? 255) / 255;
    matData[base + 2]  = (m.color.b ?? 255) / 255;
    matData[base + 3]  = 1.0;

    // params: reflectivity, roughness, ior, unused
    matData[base + 4]  = m.reflectivity ?? 0.0;
    matData[base + 5]  = m.roughness ?? 0.0;
    matData[base + 6]  = m.ior ?? 0.0;
    matData[base + 7]  = 0.0;

    // emissive: rgb + strength
    matData[base + 8]  = (m.emission?.r ?? 0) / 255;
    matData[base + 9]  = (m.emission?.g ?? 0) / 255;
    matData[base + 10] = (m.emission?.b ?? 0) / 255;
    matData[base + 11] = m.emissionStrength ?? 0.0;
});

// Always 16-byte slots for each vec4
function packSpheres(spheres) {
    const strideBytes = 32; // center_radius (vec4<f32>) + material (vec4<u32>)
    const buf = new ArrayBuffer(spheres.length * strideBytes);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < spheres.length; i++) {
        const s = spheres[i];
        const base = (i * strideBytes) >>> 2; // float/u32 index
        // center_radius at base + 0..3
        f32[base + 0] = s.center.x;
        f32[base + 1] = s.center.y;
        f32[base + 2] = s.center.z;
        f32[base + 3] = s.radius;
        // material vec4<u32> at base + 4..7
        u32[base + 4] = s.material.id >>> 0;
        u32[base + 5] = 0;
        u32[base + 6] = 0;
        u32[base + 7] = 0;
    }
    return buf;
}

function packTriangles(tris) {
    const strideBytes = 64; // v0,v1,v2 (vec4<f32> each) + mat (vec4<u32>)
    const buf = new ArrayBuffer(tris.length * strideBytes);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const base = (i * strideBytes) >>> 2;
        // v0
        f32[base + 0] = t.v0.x;
        f32[base + 1] = t.v0.y;
        f32[base + 2] = t.v0.z;
        f32[base + 3] = 0;
        // v1
        f32[base + 4] = t.v1.x;
        f32[base + 5] = t.v1.y;
        f32[base + 6] = t.v1.z;
        f32[base + 7] = 0;
        // v2
        f32[base + 8]  = t.v2.x;
        f32[base + 9]  = t.v2.y;
        f32[base + 10] = t.v2.z;
        f32[base + 11] = 0;
        // mat
        u32[base + 12] = t.material.id >>> 0;
        u32[base + 13] = 0;
        u32[base + 14] = 0;
        u32[base + 15] = 0;
    }
    return buf;
}

function packCamera(camera, basis, samplesPerPixel) {
    const strideBytes = 6 * 16; // 96 bytes
    const buf = new ArrayBuffer(strideBytes);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    // pos_fov
    f32[0] = camera.position.x;
    f32[1] = camera.position.y;
    f32[2] = camera.position.z;
    f32[3] = camera.fov;

    // forward
    f32[4] = basis.forward.x;
    f32[5] = basis.forward.y;
    f32[6] = basis.forward.z;
    f32[7] = 0;

    // right
    f32[8]  = basis.right.x;
    f32[9]  = basis.right.y;
    f32[10] = basis.right.z;
    f32[11] = 0;

    // up
    f32[12] = basis.up.x;
    f32[13] = basis.up.y;
    f32[14] = basis.up.z;
    f32[15] = 0;

    // spp + counts
    u32[16] = samplesPerPixel >>> 0;              // x = spp
    u32[17] = scene.triangles.length >>> 0;       // y = triCount
    u32[18] = scene.spheres.length >>> 0;         // z = sphereCount
    u32[19] = materials.length >>> 0;             // w = materialCount
    return buf;
}

let sphereBuffer;
let triangleBuffer;
let cameraBuffer;
let materialBuffer
let screenBuffer;
let bvhBuffer;

function rebuildBuffers() {
    const bvhTree   = buildBVHIndices(scene.triangles);
    const { nodes, reordered } = flattenBVHWithRanges(bvhTree, scene.triangles);

    console.log("BVH nodes count:", nodes.length);
    nodes.forEach((n,i) => {
        if (n.left === 0xFFFFFFFF && n.right === 0xFFFFFFFF) {
            if (n.triCount === 0) {
                console.warn("Leaf node with zero triangles!", i, n);
            }
            if (n.firstTri + n.triCount > reordered.length) {
                console.error("Leaf node points past triangle array!", i, n);
            }
        }
    });


    // Pack data using globals
    const sphereBufPacked = packSpheres(scene.spheres);
    const triBufPacked = packTriangles(reordered);
    const camBufPacked    = packCamera(camera, getCameraBasis(camera), samplesPerPixel);
    const bvhBufPacked = packBVH(nodes);
    const matData         = new Float32Array(materials.length * 12);
    materials.forEach((m, i) => {
        const base = i * 12;
        matData[base + 0]  = (m.color.r ?? 255) / 255;
        matData[base + 1]  = (m.color.g ?? 255) / 255;
        matData[base + 2]  = (m.color.b ?? 255) / 255;
        matData[base + 3]  = 1.0;
        matData[base + 4]  = m.reflectivity ?? 0.0;
        matData[base + 5]  = m.roughness ?? 0.0;
        matData[base + 6]  = m.ior ?? 0.0;
        matData[base + 7]  = 0.0;
        matData[base + 8]  = (m.emission?.r ?? 0) / 255;
        matData[base + 9]  = (m.emission?.g ?? 0) / 255;
        matData[base + 10] = (m.emission?.b ?? 0) / 255;
        matData[base + 11] = m.emissionStrength ?? 0.0;
    });

    // Recreate buffers
    sphereBuffer = device.createBuffer({
        size: sphereBufPacked.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    triangleBuffer = device.createBuffer({
        size: triBufPacked.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    cameraBuffer = device.createBuffer({
        size: 256, // uniform buffer must be padded
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    materialBuffer = device.createBuffer({
        size: matData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    screenBuffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    bvhBuffer = device.createBuffer({
        size: bvhBufPacked.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Write data
    device.queue.writeBuffer(sphereBuffer, 0, sphereBufPacked);
    device.queue.writeBuffer(triangleBuffer, 0, triBufPacked);
    device.queue.writeBuffer(cameraBuffer, 0, camBufPacked);
    device.queue.writeBuffer(materialBuffer, 0, matData);
    device.queue.writeBuffer(bvhBuffer, 0, bvhBufPacked);

    // Debug logs
    console.log("sphereBuffer size:", sphereBufPacked.byteLength);
    console.log("triangleBuffer size:", triBufPacked.byteLength);
    console.log("cameraBuffer size:", 256);
    console.log("materialBuffer size:", matData.byteLength);
    console.log("screenBuffer size:", 256);
    console.log("bvhBuffer size:", bvhBufPacked.byteLength);

    console.log("sphereBuffer object:", sphereBuffer);
    console.log("triangleBuffer object:", triangleBuffer);
    console.log("cameraBuffer object:", cameraBuffer);
    console.log("materialBuffer object:", materialBuffer);
    console.log("screenBuffer object:", screenBuffer);
    console.log("bvhBuffer object:", bvhBuffer);

    // Rebuild bind groups so they point to the new buffers
    initPipelines();
}


const keys = {};

function markInput() {
    lastInputAt = performance.now();
    needReset = true;
}

let cameraChanged = false;

let stopRequested = false;

function emergencyStop() {
    stopRequested = true;
}

document.addEventListener("keydown", e => {
    if (e.code === "KeyR") {
        manualPreview = !manualPreview;

        // Always reset accumulation immediately when toggling
        resetAccumulation();
        updateCameraUniform();
        return;
    }
    if (e.code === "KeyQ") emergencyStop(); // stop immediately

    if (!isPreviewMode()) return;

    keys[e.code] = true;
    lastInputAt = performance.now();
    needReset = true;
    cameraChanged = true;
});

document.addEventListener("keyup", e => {
    if (!(isPreviewMode())) return;

    keys[e.code] = false;
    lastInputAt = performance.now();
    needReset = true;
    cameraChanged = true;
});

window.addEventListener('wheel', (event) => {
    if (!isPreviewMode()) return;
    if (document.pointerLockElement === canvas) {
        // Check the scroll direction
        if (event.deltaY > 0) {
            // down: zoom out
            camera.fov *= 1.1; // higher fov
            // limit to 180
            if (camera.fov > 180) camera.fov = 180;
        } else if (event.deltaY < 0) {
            // up: zoom in
            camera.fov *= 0.9; // lower fov
        }

        // prevent default browser scrolling behavior
        event.preventDefault(); 
    }
});

document.addEventListener("mousemove", e => {
    if (!isPreviewMode()) return;
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

    if (keys["KeyW"] || keys["KeyA"] || keys["KeyS"] || keys["KeyD"] || keys["Space"] || keys["ShiftLeft"]) {
        lastInputAt = performance.now();
        needReset = true;
        cameraChanged = true;
    }

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
    // vertical relative to camera up
    if (keys["Space"]) { // Space
        camera.position.x -= up.x * speed;
        camera.position.y -= up.y * speed;
        camera.position.z -= up.z * speed;
    }
    if (keys["ShiftLeft"]) { // Shift
        camera.position.x += up.x * speed;
        camera.position.y += up.y * speed;
        camera.position.z += up.z * speed;
    }

    if (cameraChanged) {
        resetAccumulation();       // clear prevTex, reset frameIndex
        updateCameraUniform();     // rewrite cameraBuffer with new basis
        cameraChanged = false;     // consume the flag
    }
}

function updateCameraUniform() {
    const basis = getCameraBasis(camera);

    // Force spp=1 in preview mode
    const sppValue = isPreviewMode() ? 1 : samplesPerPixel;

    // CameraData = 5 vec4s = 80 bytes
    const strideBytes = 5 * 16;
    const buf = new ArrayBuffer(strideBytes);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    // pos_fov
    f32[0] = camera.position.x;
    f32[1] = camera.position.y;
    f32[2] = camera.position.z;
    f32[3] = camera.fov;

    // forward
    f32[4] = basis.forward.x;
    f32[5] = basis.forward.y;
    f32[6] = basis.forward.z;
    f32[7] = 0;

    // right
    f32[8]  = basis.right.x;
    f32[9]  = basis.right.y;
    f32[10] = basis.right.z;
    f32[11] = 0;

    // up
    f32[12] = basis.up.x;
    f32[13] = basis.up.y;
    f32[14] = basis.up.z;
    f32[15] = 0;

    // spp vec4<u32>
    u32[16] = sppValue >>> 0;
    u32[17] = 0;
    u32[18] = 0;
    u32[19] = 0;

    device.queue.writeBuffer(cameraBuffer, 0, buf);
}

function renderOneFrameNow() {
  startComputePass();
}

function resetAccumulation() {
    updateDimensions()
    // Update before rendering
    const screenData = new Float32Array([canvas.clientWidth, canvas.clientHeight]);
    device.queue.writeBuffer(screenBuffer, 0, screenData);

    // Recreate accumulation texture (clears it)
    accumTex = device.createTexture({
        size: [width, height],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST
    });

    prevTex = device.createTexture({
        size: [width, height],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    sampler = device.createSampler({
        magFilter: "nearest",
        minFilter: "nearest"
    });


    rebuildBindGroups();

    // Reset frame counter
    frameIndex = 0;
    currentGen = 0;
    needReset = false;
    return accumTex;
}

// Create pipelines once
function initPipelines() {
    sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    const computeLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },  // spheres
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },  // triangles
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },                // camera
            { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },    // outImage
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },  // materials
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },                // frame (frameIndex)
            { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },           // prevImage
            { binding: 7, visibility: GPUShaderStage.COMPUTE, sampler: {} },                             // samp
            { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } } // BVH
        ]
    });

    computePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
        compute: { module: computeModule, entryPoint: "cs_main" }
    });

    renderPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: vertexModule, entryPoint: "vs_main" },
        fragment: {
            module: fragmentModule,
            entryPoint: "fs_main",
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: "triangle-list" }
    });

    rebuildBindGroups();
}

// Build or rebuild bind groups whenever accumTex changes
function rebuildBindGroups() {
    if (!computePipeline || !renderPipeline || !accumTex) {
        return; // pipelines not ready yet
    }

    computeBindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sphereBuffer } },
            { binding: 1, resource: { buffer: triangleBuffer } },
            { binding: 2, resource: { buffer: cameraBuffer } },
            { binding: 3, resource: accumTex.createView() },
            { binding: 4, resource: { buffer: materialBuffer } },
            { binding: 5, resource: { buffer: frameBuffer } },
            { binding: 6, resource: prevTex.createView() },
            { binding: 7, resource: sampler },
            { binding: 8, resource: { buffer: bvhBuffer } }
        ]
    });

    renderBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: accumTex.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: screenBuffer } }
        ]
    });
}

let currentGen = 0;
let lastInputAt = 0;
let needReset = true; // initial reset at boot
let previewing = false;
const idleDelayMs = 60; // small debounce so movement doesn’t thrash

function startComputePass() {
    const encoder = device.createCommandEncoder();

    // Compute
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    const groupsX = Math.ceil(width / WORKGROUP_SIZE_X);
    const groupsY = Math.ceil(height / WORKGROUP_SIZE_Y);
    computePass.dispatchWorkgroups(groupsX, groupsY);
    computePass.end();

    // Render
    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }]
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    // Accum → prev for progressive averaging
    encoder.copyTextureToTexture(
        { texture: accumTex },
        { texture: prevTex },
        [width, height, 1]
    );

    device.queue.submit([encoder.finish()]);
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

function requeueAll() {
    const basis = getCameraBasis(camera);
    camPayload = {
        position: { ...camera.position },
        width: canvas.width,
        height: canvas.height,
        fov: camera.fov,
        forward: basis.forward,
        right: basis.right,
        up: basis.up
    };
}

function flattenBVH(root) {
    const nodes = [];
    function recurse(node) {
        const idx = nodes.length;
        const flat = {
            min: node.bounds.min,
            max: node.bounds.max,
            left: 0xFFFFFFFF,
            right: 0xFFFFFFFF,
            firstTri: 0,
            triCount: 0
        };
        nodes.push(flat);
        if (node.left) flat.left = recurse(node.left);
        if (node.right) flat.right = recurse(node.right);
        return idx;
    }
    recurse(root);
    return nodes;
}

function flattenBVHWithRanges(root, tris) {
    const nodes = [];
    const reordered = [];
    function emitLeaf(leafIdxs) {
        const start = reordered.length;
        for (const i of leafIdxs) reordered.push(tris[i]);
        return { firstTri:start, triCount:leafIdxs.length };
    }
    function recurse(node) {
        const idx = nodes.length;
        const flat = {
            min: node.bounds.min,
            max: node.bounds.max,
            left: 0xFFFFFFFF,
            right: 0xFFFFFFFF,
            firstTri: 0,
            triCount: 0
        };
        nodes.push(flat);
        if (node.triangles.length) {
            const range = emitLeaf(node.triangles);
            flat.firstTri = range.firstTri;
            flat.triCount = range.triCount;
        } else {
            flat.left  = recurse(node.left);
            flat.right = recurse(node.right);
        }
        return idx;
    }
    recurse(root);
    return { nodes, reordered };
}

function packBVH(nodes) {
    const stride = 48;
    const buf = new ArrayBuffer(nodes.length * stride);
    const dv = new DataView(buf);

    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const base = i * stride;

        // min vec3<f32> (16 bytes slot)
        dv.setFloat32(base + 0,  n.min.x, true);
        dv.setFloat32(base + 4,  n.min.y, true);
        dv.setFloat32(base + 8,  n.min.z, true);
        // pad at base+12

        // max vec3<f32> (16 bytes slot)
        dv.setFloat32(base + 16, n.max.x, true);
        dv.setFloat32(base + 20, n.max.y, true);
        dv.setFloat32(base + 24, n.max.z, true);
        // pad at base+28

        // children + tri info
        dv.setUint32(base + 32, n.left >>> 0, true);
        dv.setUint32(base + 36, n.right >>> 0, true);
        dv.setUint32(base + 40, n.firstTri >>> 0, true);
        dv.setUint32(base + 44, n.triCount >>> 0, true);
    }
    return buf;
}

// models = [
//   { obj:"path/to.obj", mtl:"path/to.mtl", transform:{...}, material: customMaterial },
//   { obj:"...", mtl:"...", ... }
// ]
async function loadModelsAndBuildBVH(models) {
    const allTriangles = [];

    for (const m of models) {
        const [objText, mtlText] = await Promise.all([
            fetch(m.obj).then(r => r.text()),
            m.mtl ? fetch(m.mtl).then(r => r.text()) : Promise.resolve("")
        ]);

        const materials = mtlText ? parseMTL(mtlText) : {};

        for (const name in materials) {
            const mat = materials[name];
            if (mat.map_Kd) {
                mat.textureImage = await loadTexture("../objects/" + mat.map_Kd);
            }
        }

        const { triangles } = parseOBJ(objText, materials);

        if (m.material) {
            for (const tri of triangles) {
                tri.material = m.material;
            }
        }

        if (m.transform) {
            for (const tri of triangles) {
                tri.v0 = applyTransform(tri.v0, m.transform.position, m.transform.rotation, m.transform.scale);
                tri.v1 = applyTransform(tri.v1, m.transform.position, m.transform.rotation, m.transform.scale);
                tri.v2 = applyTransform(tri.v2, m.transform.position, m.transform.rotation, m.transform.scale);
            }
        }

        allTriangles.push(...triangles);
    }

    // Merge into scene
    scene.triangles.push(...allTriangles);

    // Build BVH
    bvhRootPreview = buildBVH(scene.triangles);

    // Rebuild buffers
    rebuildBuffers();
}

async function loadTexture(url) {
    const img = new Image();
    img.src = url;
    await img.decode();

    // Use a temporary canvas just to extract pixels
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;

    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    console.log("Loaded", url, img.width, img.height);
    return ctx.getImageData(0, 0, img.width, img.height);
}

// Frame buffer: pad to 256 bytes
const frameBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

function drawUI() {
    
}

function tick() {
    if (stopRequested) return; // bail immediately
    // write current frame index
    // frameIndex write
    device.queue.writeBuffer(frameBuffer, 0, new Uint32Array([frameIndex]));
    frameIndex++;

    // Update camera only when previewing (auto or manual)
    const isAuto = autoPreview && (performance.now() - lastInputAt) < 50;
    const previewActive = isAuto || manualPreview;

    if (previewActive) {
        updateCamera();
        updateCameraUniform();
    }

    // Always render
    startComputePass();

    drawUI();

    requestAnimationFrame(tick);
}


let bvhRootPreview;
loadModelsAndBuildBVH([
    { obj: "../objects/Rock1.obj", mtl: "../objects/Rock1.mtl", transform: { 
        position:{x:-15,y:0,z:5}, rotation:{x:0,y:90,z:0}, scale:{x:2,y:2,z:2} 
    }},
    { obj: "../objects/suzanne.obj", material: whiteMat, transform: { 
        position:{x:-0.5,y:0,z:-14}, rotation:{x:0,y:0,z:0}, scale:{x:1.5,y:1.5,z:1.5},
    }},
    // { obj:"../objects/cornellBox.obj", mtl:"../objects/cornellBox.mtl" }
]).then(() => {
    initPipelines();      // creates pipelines and (re)bind groups safely
    resetAccumulation();  // creates accumTex and bind groups
    tick();               // now the loop can call renderOneFrameNow safely
});