struct Sphere {
    center_radius : vec4<f32>,  // xyz = center, w = radius
    material      : vec4<u32>,  // x = materialId
};

struct Triangle {
    v0 : vec4<f32>,
    v1 : vec4<f32>,
    v2 : vec4<f32>,
    mat : vec4<u32>, // x = materialId
    uv0 : vec4<f32>,
    uv1 : vec4<f32>,
    uv2 : vec4<f32>,
};


struct Material {
    color    : vec4<f32>,   // rgb, a unused
    params   : vec4<f32>,   // x=reflectivity, y=roughness, z=ior, w unused
    emissive : vec4<f32>,   // rgb, w=strength
};

struct CameraData {
    pos_fov : vec4<f32>, // xyz = position, w = fov in degrees
    forward : vec4<f32>,
    right   : vec4<f32>,
    up      : vec4<f32>,
    spp     : vec4<u32>, // x = samplesPerPixel
    maxDepth: vec4<u32>, // x = max bounce depth
};

struct FrameData {
    frameIndex : u32,
};

// Each node: min/max bounds (vec3<f32> each), child indices, triangle range
struct BVHNode {
    min : vec3<f32>,
    max : vec3<f32>,
    left : u32,
    right : u32,
    firstTri : u32,
    triCount : u32,
};

struct Hit {
    t : f32,
    triIdx : u32,
};

@group(0) @binding(0) var<storage, read> spheres   : array<Sphere>;
@group(0) @binding(1) var<storage, read> triangles : array<Triangle>;
@group(0) @binding(2) var<uniform>       camera    : CameraData;
@group(0) @binding(3) var outImage : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read> materials : array<Material>;
@group(0) @binding(5) var<uniform> frame : FrameData;
@group(0) @binding(6) var prevImage : texture_2d<f32>;
@group(0) @binding(7) var samp : sampler;
@group(0) @binding(8) var<storage, read> bvhNodes : array<BVHNode>;
@group(0) @binding(9) var diffuseTex : texture_2d<f32>;
@group(0) @binding(10) var diffuseSampler : sampler;


// -----------------------------
// Math helpers
// -----------------------------
fn reflect3(d: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    return normalize(d - 2.0 * dot(d, n) * n);
}

fn refract3(d: vec3<f32>, n: vec3<f32>, etai: f32, etat: f32) -> vec3<f32> {
    var cosi = clamp(dot(d, n), -1.0, 1.0);
    var nn = n;
    if (cosi > 0.0) { nn = -n; }
    let eta = etai / etat;
    let k = 1.0 - eta * eta * (1.0 - cosi * cosi);
    if (k < 0.0) { return vec3<f32>(0.0,0.0,0.0); }
    return normalize(d * eta + nn * (eta * cosi - sqrt(k)));
}

fn fresnel_schlick(d: vec3<f32>, n: vec3<f32>, ior: f32) -> f32 {
    var cosi = clamp(dot(d, n), -1.0, 1.0);
    var etai = 1.0;
    var etat = ior;
    if (cosi > 0.0) {
        let tmp = etai;
        etai = etat;
        etat = tmp;
    }
    let sint = etai / etat * sqrt(max(0.0, 1.0 - cosi*cosi));
    if (sint >= 1.0) { return 1.0; }
    let cost = sqrt(max(0.0, 1.0 - sint*sint));
    cosi = abs(cosi);
    let Rs = ((etat*cosi)-(etai*cost))/((etat*cosi)+(etai*cost));
    let Rp = ((etai*cosi)-(etat*cost))/((etai*cosi)+(etat*cost));
    return (Rs*Rs + Rp*Rp)*0.5;
}

fn radians(deg: f32) -> f32 {
    return deg * 0.017453292519943295; // pi/180
}

fn hash(u: u32) -> f32 {
    var x = u;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return f32(x & 0x00FFFFFFu) / f32(0x00FFFFFFu);
}

fn hash2(u: u32, v: u32, frame: u32, sample: u32) -> u32 {
    var x = u * 374761393u + v * 668265263u + frame * 982451653u + sample * 2654435761u;
    x = (x ^ (x >> 13)) * 1274126177u;
    return x;
}

fn cosineSampleHemisphere(n: vec3<f32>, seed: u32) -> vec3<f32> {
    let r1 = hash(seed*1664525u+1013904223u);
    let r2 = hash(seed*747796405u+2891336453u);
    let r = sqrt(r1);
    let th = 6.2831853 * r2;
    let x = r * cos(th);
    let y = r * sin(th);
    let z = sqrt(max(0.0, 1.0-r1));
    let up = select(vec3<f32>(0.0,0.0,1.0), vec3<f32>(1.0,0.0,0.0), abs(n.z)>=0.999);
    let tangent = normalize(cross(up,n));
    let bitangent = normalize(cross(n,tangent));
    return normalize(tangent*x + bitangent*y + n*z);
}

// -----------------------------
// Intersections
// -----------------------------
fn intersectSphere(rayOrig: vec3<f32>, rayDir: vec3<f32>, s: Sphere) -> f32 {
    let oc = rayOrig - s.center_radius.xyz;
    let a = dot(rayDir, rayDir);
    let b = 2.0 * dot(oc, rayDir);
    let c = dot(oc, oc) - s.center_radius.w*s.center_radius.w;
    let disc = b*b - 4.0*a*c;
    if (disc < 0.0) { return -1.0; }
    let t = (-b - sqrt(disc))/(2.0*a);
    return select(-1.0, t, t >= 0.0);
}

fn intersectTriangle(rayOrig: vec3<f32>, rayDir: vec3<f32>, tri: Triangle) -> f32 {
    let EPS = 1e-5;
    let v0 = tri.v0.xyz;
    let v1 = tri.v1.xyz;
    let v2 = tri.v2.xyz;

    let e1 = v1 - v0;
    let e2 = v2 - v0;
    let h  = cross(rayDir, e2);
    let a  = dot(e1, h);

    if (abs(a) < EPS) { return -1.0; } // ray parallel to triangle

    let f = 1.0 / a;
    let s = rayOrig - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) { return -1.0; }

    let q = cross(s, e1);
    let v = f * dot(rayDir, q);
    if (v < 0.0 || u + v > 1.0) { return -1.0; }

    let t = f * dot(e2, q);
    if (t > EPS) {
        return t;
    }
    return -1.0;
}

fn offsetOrigin(p: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    // Scale epsilon by scene magnitude to avoid acne at large coordinates
    let scale = max(1.0, abs(p.x) + abs(p.y) + abs(p.z));
    let eps = 1e-2 * scale;
    return p + n * eps;
}

fn invSafe(x: f32) -> f32 {
    if (abs(x) < 1e-8) {
        // treat as "no intersection" by returning a huge number
        return 1e30;
    }
    return 1.0 / x;
}

fn project_to_pixel(p: vec3<f32>, dims: vec2<f32>) -> vec2<f32> {
    // Camera basis from uniforms
    let pos = camera.pos_fov.xyz;
    let fov = camera.pos_fov.w;
    let fwd = camera.forward.xyz;
    let right = camera.right.xyz;
    let up = camera.up.xyz;

    // Relative position
    let rel = p - pos;

    // Camera-space coords
    let fx = dot(rel, right);
    let fy = dot(rel, up);
    let fz = dot(rel, fwd);

    // Behind camera? Return off-screen sentinel (negative coords)
    if (fz <= 0.0001) {
        return vec2<f32>(-1.0, -1.0);
    }

    // Pinhole projection (same scale as your ray setup)
    let tanHalfFov = tan(radians(fov) * 0.5);
    let scale = 1.0 / tanHalfFov;

    // NDC (assumes symmetric frustum; aspect applied by your compute ray gen)
    let ndc_x = (fx / fz) * scale;
    let ndc_y = (fy / fz) * scale;

    // To pixel coords
    let px = (ndc_x * 0.5 + 0.5) * dims.x;
    let py = (ndc_y * 0.5 + 0.5) * dims.y;
    return vec2<f32>(px, py);
}

fn interpolateUV(tri: Triangle, p: vec3<f32>) -> vec2<f32> {
    let v0 = tri.v0.xyz;
    let v1 = tri.v1.xyz;
    let v2 = tri.v2.xyz;

    // Compute barycentrics via areas (robust for your setup)
    let area = length(cross(v1 - v0, v2 - v0));
    let w0 = length(cross(v1 - p,  v2 - p))  / area;
    let w1 = length(cross(v2 - p,  v0 - p))  / area;
    let w2 = length(cross(v0 - p,  v1 - p))  / area;

    return tri.uv0.xy * w0 + tri.uv1.xy * w1 + tri.uv2.xy * w2;
}

fn segment_dist_px(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    // If either endpoint is off-screen sentinel, treat as far
    if (a.x < 0.0 || a.y < 0.0 || b.x < 0.0 || b.y < 0.0) {
        return 1e9;
    }
    let ab = b - a;
    let ap = p - a;
    let ab2 = dot(ab, ab);
    if (ab2 <= 1e-8) {
        return length(ap); // degenerate
    }
    let t = clamp(dot(ap, ab) / ab2, 0.0, 1.0);
    let closest = a + t * ab;
    return length(p - closest);
}

fn draw_bvh_wireframe(gid: vec2<u32>) -> vec3<f32> {
    let dims_i = textureDimensions(outImage);
    let dims = vec2<f32>(f32(dims_i.x), f32(dims_i.y));
    let pix = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5);

    let bvhCount = arrayLength(&bvhNodes);

    // Edge indices for a box (12 segments)
    var edges: array<vec2<u32>, 12>;
    edges[0]  = vec2<u32>(0u,1u); edges[1]  = vec2<u32>(1u,2u); edges[2]  = vec2<u32>(2u,3u); edges[3]  = vec2<u32>(3u,0u);
    edges[4]  = vec2<u32>(4u,5u); edges[5]  = vec2<u32>(5u,6u); edges[6]  = vec2<u32>(6u,7u); edges[7]  = vec2<u32>(7u,4u);
    edges[8]  = vec2<u32>(0u,4u); edges[9]  = vec2<u32>(1u,5u); edges[10] = vec2<u32>(2u,6u); edges[11] = vec2<u32>(3u,7u);

    var col = vec3<f32>(0.0);
    let threshold_px = 1.5; // line thickness

    for (var idx = 0u; idx < bvhCount; idx = idx + 1u) {
        let node = bvhNodes[idx];
        // Skip invalid bounds
        if (!isFinite(node.min) || !isFinite(node.max)) { continue; }

        // 8 corners in world space
        var c: array<vec3<f32>, 8>;
        let mn = node.min;
        let mx = node.max;
        c[0] = vec3<f32>(mn.x, mn.y, mn.z);
        c[1] = vec3<f32>(mx.x, mn.y, mn.z);
        c[2] = vec3<f32>(mx.x, mx.y, mn.z);
        c[3] = vec3<f32>(mn.x, mx.y, mn.z);
        c[4] = vec3<f32>(mn.x, mn.y, mx.z);
        c[5] = vec3<f32>(mx.x, mn.y, mx.z);
        c[6] = vec3<f32>(mx.x, mx.y, mx.z);
        c[7] = vec3<f32>(mn.x, mx.y, mx.z);

        // Project to pixel coords
        var p2: array<vec2<f32>, 8>;
        for (var i = 0u; i < 8u; i = i + 1u) {
            p2[i] = project_to_pixel(c[i], dims);
        }

        // Wireframe color: cyan for leaves, orange for internals
        let isLeaf = node.triCount > 0u;
        let base = select(vec3<f32>(1.0, 0.5, 0.0), vec3<f32>(0.0, 1.0, 1.0), isLeaf);

        // Accumulate if near any edge
        for (var e = 0u; e < 12u; e = e + 1u) {
            let a = p2[edges[e].x];
            let b = p2[edges[e].y];
            let d = segment_dist_px(pix, a, b);
            if (d <= threshold_px) {
                // Blend with minor falloff
                let w = clamp((threshold_px - d) / threshold_px, 0.0, 1.0);
                col = col + base * w;
            }
        }
    }

    // Clamp final color to [0,1]
    return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hitAABB(rayOrig: vec3<f32>, rayDir: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> bool {
    var tmin = -1e9;
    var tmax =  1e9;
    for (var i = 0; i < 3; i = i + 1) {
        let invD = 1.0 / rayDir[i];
        var t0 = (bmin[i] - rayOrig[i]) * invD;
        var t1 = (bmax[i] - rayOrig[i]) * invD;
        if (invD < 0.0) {
            let tmp = t0; t0 = t1; t1 = tmp;
        }
        tmin = max(tmin, t0);
        tmax = min(tmax, t1);
        if (tmax <= tmin) { return false; }
    }
    return true;
}

fn isFinite1(x: f32) -> bool {
    // treat values with huge magnitude as invalid
    return abs(x) < 1e30;
}

fn isFinite(v: vec3<f32>) -> bool {
    return isFinite1(v.x) && isFinite1(v.y) && isFinite1(v.z);
}

fn scanLeavesNoTraversal(rayOrig: vec3<f32>, rayDir: vec3<f32>) -> Hit {
    var closestT = 1e9;
    var hitId    = 0xFFFFFFFFu;

    let bvhCount      = arrayLength(&bvhNodes);
    let triCountTotal = arrayLength(&triangles);

    for (var idx = 0u; idx < bvhCount; idx = idx + 1u) {
        let node = bvhNodes[idx];
        if (node.triCount == 0u) { continue; }
        if (node.firstTri >= triCountTotal) { continue; }

        let end = min(node.firstTri + node.triCount, triCountTotal);
        for (var i = node.firstTri; i < end; i = i + 1u) {
            let t = intersectTriangle(rayOrig, rayDir, triangles[i]);
            if (t > 0.0 && t < closestT) {
                closestT = t;
                hitId    = i;
            }
        }
    }
    return Hit(closestT, select(0u, hitId, hitId != 0xFFFFFFFFu));
}

fn traverseBVH(rayOrig: vec3<f32>, rayDir: vec3<f32>) -> Hit {
    var stack: array<u32, 64>;
    var sp: u32 = 0u;

    // push root
    stack[sp] = 0u;
    sp = sp + 1u;

    var closestT = 1e9;
    var hitId    = 0u;

    let bvhCount      = arrayLength(&bvhNodes);
    let triCountTotal = arrayLength(&triangles);

    var visits: u32 = 0u;
    let maxVisits: u32 = 4096u; // much smaller cap

    while (sp > 0u) {
        if (visits >= maxVisits) { break; }
        visits = visits + 1u;

        // pop
        sp = sp - 1u;
        let idx = stack[sp];

        if (idx >= bvhCount) { continue; }
        let node = bvhNodes[idx];
        if (!isFinite(node.min) || !isFinite(node.max)) { continue; }

        // AABB test
        let eps  = 1e-5;
        let bmin = node.min - vec3<f32>(eps);
        let bmax = node.max + vec3<f32>(eps);
        if (!hitAABB(rayOrig, rayDir, bmin, bmax)) { continue; }

        if (node.triCount > 0u) {
            let first = node.firstTri;
            var end   = first + node.triCount;

            // strict guards
            if (first >= triCountTotal) { continue; }
            if (end > triCountTotal) { end = triCountTotal; }

            for (var i = first; i < end; i = i + 1u) {
                let t = intersectTriangle(rayOrig, rayDir, triangles[i]);
                if (t > 0.0 && t < closestT) {
                    closestT = t;
                    hitId    = i;
                }
            }
        } else {
            if (node.left  != 0xFFFFFFFFu && node.left  < bvhCount && sp < 64u) {
                stack[sp] = node.left;  sp = sp + 1u;
            }
            if (node.right != 0xFFFFFFFFu && node.right < bvhCount && sp < 64u) {
                stack[sp] = node.right; sp = sp + 1u;
            }
        }
    }

    return Hit(closestT, hitId);
}

fn bruteForceTriangles(rayOrig: vec3<f32>, rayDir: vec3<f32>) -> Hit {
    var closestT = 1e9;
    var hitId    = 0u;

    let triCount = arrayLength(&triangles);

    for (var i = 0u; i < triCount; i = i + 1u) {
        let t = intersectTriangle(rayOrig, rayDir, triangles[i]);
        if (t > 0.0 && t < closestT) {
            closestT = t;
            hitId = i;
        }
    }

    return Hit(closestT, hitId);
}

fn debug_totals_color() -> vec3<f32> {
    let triTotal = arrayLength(&triangles);
    let nodeTotal = arrayLength(&bvhNodes);
    if (triTotal == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }  // red: triangles buffer empty
    if (nodeTotal == 0u) { return vec3<f32>(1.0, 0.5, 0.0); } // orange: BVH buffer empty
    return vec3<f32>(0.0, 1.0, 0.0);                           // green: both nonzero
}

fn debug_leaf_ranges_color() -> vec3<f32> {
    let triTotal = arrayLength(&triangles);
    let nodeTotal = arrayLength(&bvhNodes);

    var hasLeaf: bool = false;
    var hasValidRange: bool = false;

    for (var i = 0u; i < nodeTotal; i = i + 1u) {
        let n = bvhNodes[i];
        if (n.triCount > 0u) {
            hasLeaf = true;
            if (n.firstTri < triTotal && (n.firstTri + n.triCount) <= triTotal) {
                hasValidRange = true;
                break;
            }
        }
    }

    if (!hasLeaf)        { return vec3<f32>(1.0, 1.0, 0.0); } // yellow: no leaves in BVH
    if (!hasValidRange)  { return vec3<f32>(1.0, 0.0, 1.0); } // magenta: all leaves OOB
    return vec3<f32>(0.0, 1.0, 1.0);                          // cyan: at least one valid leaf range
}

fn debug_valid_leaf_count() -> vec3<f32> {
    let triTotal = arrayLength(&triangles);
    let nodeTotal = arrayLength(&bvhNodes);
    var validLeaves: u32 = 0u;

    for (var i = 0u; i < nodeTotal; i = i + 1u) {
        let n = bvhNodes[i];
        if (n.triCount > 0u &&
            n.firstTri < triTotal &&
            (n.firstTri + n.triCount) <= triTotal) {
            validLeaves = validLeaves + 1u;
        }
    }
    let g = clamp(f32(min(validLeaves, 255u)) / 255.0, 0.0, 1.0);
    return vec3<f32>(g, g, g);
}

fn debug_scan_count(rayOrig: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
    var tested: u32 = 0u;
    let bvhCount = arrayLength(&bvhNodes);
    let triTotal = arrayLength(&triangles);

    for (var idx = 0u; idx < bvhCount; idx = idx + 1u) {
        let n = bvhNodes[idx];
        if (n.triCount == 0u) { continue; }
        if (n.firstTri >= triTotal) { continue; }
        let end = min(n.firstTri + n.triCount, triTotal);
        for (var i = n.firstTri; i < end; i = i + 1u) {
            tested = tested + 1u;
            _ = intersectTriangle(rayOrig, rayDir, triangles[i]);
        }
    }
    let g = clamp(f32(min(tested, 255u)) / 255.0, 0.0, 1.0);
    return vec3<f32>(g,g,g);
}

// -----------------------------
// Material stubs
// -----------------------------
fn get_albedo(matId:u32)->vec3<f32>{
    switch matId {
        case 0u: { return vec3<f32>(1.0,1.0,1.0); }
        case 1u: { return vec3<f32>(0.0,1.0,0.0); }
        case 2u: { return vec3<f32>(1.0,0.0,0.0); }
        default: { return vec3<f32>(0.8,0.8,0.8); }
    }
}
fn get_reflectivity(matId:u32)->f32{
    switch matId {
        case 3u: { return 1.0; }
        default: { return 0.05; }
    }
}
fn get_roughness(matId:u32)->f32{
    switch matId {
        case 3u: { return 0.0; }
        default: { return 0.3; }
    }
}
fn get_ior(matId:u32)->f32{
    return select(0.0,1.5,matId==4u);
}
fn get_emission_strength(matId:u32)->f32{
    return select(0.0,2.0,matId==9u);
}
fn get_emission_rgb(matId:u32)->vec3<f32>{
    return vec3<f32>(1.0,1.0,1.0);
}

// -----------------------------
// Trace loop
// -----------------------------
const RR_START_DEPTH  : u32 = 3u;

fn trace(rayOrig_in: vec3<f32>, rayDir_in: vec3<f32>, seed: u32) -> vec3<f32> {
    var rayOrig    = rayOrig_in;
    var rayDir     = normalize(rayDir_in);
    var throughput = vec3<f32>(1.0);
    var color      = vec3<f32>(0.0);
    var specDepth  = 0u;

    let MAX_RAY_BOUNCES: u32 = camera.maxDepth.x;

    for (var depth = 0u; depth <= MAX_RAY_BOUNCES; depth = depth + 1u) {
        var closestT   = 1e9;
        var hitIsSphere = false;
        var hitSphereIdx = 0u;
        var hitTriIdx    = 0u;

        // --- Sphere intersection (still brute force)
        for (var i = 0u; i < arrayLength(&spheres); i = i + 1u) {
            let t = intersectSphere(rayOrig, rayDir, spheres[i]);
            if (t > 0.0 && t < closestT) {
                closestT     = t;
                hitIsSphere  = true;
                hitSphereIdx = i;
            }
        }

        // --- Triangle intersection via BVH
        let hit = bruteForceTriangles(rayOrig, rayDir);
        //let hit = traverseBVH(rayOrig, rayDir);
        //let hit = scanLeavesNoTraversal(rayOrig, rayDir);
        if (hit.t > 0.0 && hit.t < closestT) {
            closestT = hit.t;
            hitIsSphere = false;
            hitTriIdx = hit.triIdx;
        }

        // --- Miss
        if (closestT == 1e9) {
            color = color + throughput * vec3<f32>(0.0);
            break;
        }

        // --- Hit point and material
        var hitPoint = rayOrig + rayDir * closestT;
        var normal   = vec3<f32>(0.0);
        var matId    = 0u;

        if (hitIsSphere) {
            let s = spheres[hitSphereIdx];
            normal = normalize(hitPoint - s.center_radius.xyz);
            matId  = u32(s.material.x);
        } else {
            let tri = triangles[hitTriIdx];
            let e1  = tri.v1.xyz - tri.v0.xyz;
            let e2  = tri.v2.xyz - tri.v0.xyz;
            normal  = normalize(cross(e1, e2));
            if (dot(normal, rayDir) > 0.0) { normal = -normal; }
            matId   = u32(tri.mat.x);
        }

        // --- Shading
        let mat        = materials[matId];
        var albedo     = mat.color.rgb;
        let refl       = mat.params.x;
        let rough      = mat.params.y;
        let ior        = mat.params.z;
        let emRGB      = mat.emissive.rgb;
        let emStrength = mat.emissive.w;

        if (!hitIsSphere && mat.params.w > 0.5) {
            let tri = triangles[hitTriIdx];
            let uv = interpolateUV(tri, hitPoint);
            albedo = textureSampleLevel(diffuseTex, diffuseSampler, uv, 0.0).rgb;
        }

        if (emStrength > 0.0) {
            color = color + throughput * (emRGB * emStrength);
            break;
        }

        // Depth cap
        if (depth >= MAX_RAY_BOUNCES) {
            // terminate with no contribution
            break;
        }

        // Russian roulette
        if (depth >= RR_START_DEPTH) {
            let p = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.95);
            let survive = hash(seed * 911u + depth * 131u);
            if (survive > p) { break; }
            throughput = throughput / p;
        }

        // Dielectric (glass): Fresnel split with roughness scattering
        if (ior > 0.0) {
            let entering = dot(rayDir, normal) < 0.0;
            let etai = select(ior, 1.0, entering); // 1.0 if entering, else ior
            let etat = select(1.0, ior, entering); // ior if entering, else 1.0

            // Fresnel reflectance at interface
            let kr = fresnel_schlick(rayDir, normal, ior);

            // Base reflection/refraction directions
            var reflDir = normalize(reflect3(rayDir, normal));
            var refrDir = refract3(rayDir, normal, etai, etat);

            // If rough > 0, blend reflection with diffuse sample for frosted glass
            if (rough > 0.0) {
                let diffuseDir = cosineSampleHemisphere(normal, seed * 997u + depth * 883u);
                reflDir = normalize(mix(reflDir, diffuseDir, rough));
            }

            let doReflect = (hash(seed * 313u + depth) < kr) || (length(refrDir) == 0.0);

            if (doReflect) {
                // reflection ray: offset outward
                rayOrig = offsetOrigin(hitPoint, normal);
                rayDir  = reflDir;
                // tint reflection by albedo if desired
                throughput = throughput * albedo;
                specDepth  = specDepth + 1u;
            } else {
                // refraction ray: offset inward if entering, outward if exiting
                if (entering) {
                    rayOrig = offsetOrigin(hitPoint, -normal);
                } else {
                    rayOrig = offsetOrigin(hitPoint, normal);
                }
                rayDir  = refrDir;
                // tint transmission by albedo if desired
                throughput = throughput * albedo;
            }
            continue;
        }

        // Non‑dielectric: specular + diffuse blend
        let nextThroughput = throughput * albedo;

        var specDir = normalize(reflect3(rayDir, normal));
        specDir = normalize(mix(specDir,
            cosineSampleHemisphere(normal, seed * 997u + depth * 883u),
            rough));

        let specShare = clamp(refl, 0.0, 1.0);
        let diffShare = 1.0 - specShare;

        // Take specular direction as the next ray
        rayOrig = offsetOrigin(hitPoint, normal);
        rayDir     = specDir;
        throughput = throughput * specShare;
        specDepth  = specDepth + 1u;

        // Accumulate diffuse energy into throughput budget
        throughput = throughput + (nextThroughput * diffShare);
    }

    return color;
}

// -----------------------------
// Entry point
// -----------------------------
@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let dims = textureDimensions(outImage);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    // Pixel-centered NDC
    let ndc_x = (f32(gid.x) + 0.5) / f32(dims.x) * 2.0 - 1.0;
    let ndc_y = (f32(gid.y) + 0.5) / f32(dims.y) * 2.0 - 1.0;

    let aspect = f32(dims.x) / f32(dims.y);
    let tanHalfFov = tan(radians(camera.pos_fov.w) * 0.5);

    let u = ndc_x * aspect * tanHalfFov;
    let v = ndc_y * tanHalfFov;

    let rayOrig = camera.pos_fov.xyz;
    let rayDir  = normalize(
        camera.forward.xyz +
        u * camera.right.xyz +
        v * camera.up.xyz
    );

    // Use the same variable name for both modes
    var col = vec3<f32>(0.0);

    let showBVH = false; // toggle debug BVH overlay
    if (showBVH) {
        col = draw_bvh_wireframe(gid.xy);
    }

    // Debug output at center pixel
    if (gid.x == dims.x/2u && gid.y == dims.y/2u) {
        var c = vec3<f32>(0.0, 0.0, 0.0);
        // pick one at a time to read a clear result
        // let c = debug_totals_color();
        // let c = debug_leaf_ranges_color();
        // let c = debug_valid_leaf_count();
        if (any(c != vec3<f32>(0.0))) { 
            textureStore(outImage, vec2<i32>(gid.xy), vec4<f32>(c,1.0));
            return;
        }
    }


    let spp = camera.spp.x;
    for (var i = 0u; i < spp; i = i + 1u) {
        let seed = hash2(gid.x, gid.y, u32(frame.frameIndex * 32847553) + u32(abs(camera.pos_fov.x * 32348971 + camera.forward.x * 23498768)), i);
        col = col + trace(rayOrig, rayDir, seed);
    }
    col = col / f32(spp);

    // Progressive accumulation
    let uv = vec2<f32>((f32(gid.x) + 0.5) / f32(dims.x),
                       (f32(gid.y) + 0.5) / f32(dims.y));
    let fi = f32(frame.frameIndex);
    var accum = col;
    if (fi > 0.0) {
        let prev = textureSampleLevel(prevImage, samp, uv, 0).rgb;
        accum = (prev * fi + col) / (fi + 1.0);
    }
    textureStore(outImage, vec2<i32>(gid.xy), vec4<f32>(accum, 1.0));
}