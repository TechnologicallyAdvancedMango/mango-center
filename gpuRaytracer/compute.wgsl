struct Sphere {
    center_radius : vec4<f32>,  // xyz = center, w = radius
    material      : vec4<u32>,  // x = materialId
};

struct Triangle {
    v0 : vec4<f32>,
    v1 : vec4<f32>,
    v2 : vec4<f32>,
    mat : vec4<u32>,            // x = materialId
};

struct Material {
    color    : vec4<f32>,   // rgb, a unused
    params   : vec4<f32>,   // x=reflectivity, y=roughness, z=ior, w unused
    emissive : vec4<f32>,   // rgb, w=strength
};

struct CameraData {
    pos_fov : vec4<f32>,        // xyz = position, w = fov
    forward : vec4<f32>,
    right   : vec4<f32>,
    up      : vec4<f32>,
    spp     : vec4<u32>,        // x = samplesPerPixel
};

struct FrameData {
    frameIndex : u32,
};

@group(0) @binding(0) var<storage, read> spheres   : array<Sphere>;
@group(0) @binding(1) var<storage, read> triangles : array<Triangle>;
@group(0) @binding(2) var<uniform>       camera    : CameraData;
@group(0) @binding(3) var outImage : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read> materials : array<Material>;
@group(0) @binding(5) var<uniform> frame : FrameData;
@group(0) @binding(6) var prevImage : texture_2d<f32>;
@group(0) @binding(7) var samp : sampler;

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
    let EPS = 1e-6;
    let v0 = tri.v0.xyz;
    let v1 = tri.v1.xyz;
    let v2 = tri.v2.xyz;
    let e1 = v1-v0;
    let e2 = v2-v0;
    let h = cross(rayDir,e2);
    let a = dot(e1,h);
    if (abs(a)<EPS) { return -1.0; }
    let f = 1.0/a;
    let s = rayOrig-v0;
    let u = f*dot(s,h);
    if (u<0.0 || u>1.0) { return -1.0; }
    let q = cross(s,e1);
    let v = f*dot(rayDir,q);
    if (v<0.0 || u+v>1.0) { return -1.0; }
    let t = f*dot(e2,q);
    return select(-1.0,t,t>EPS);
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
const MAX_RAY_BOUNCES : u32 = 10u;
const RR_START_DEPTH  : u32 = 3u;

fn trace(rayOrig_in: vec3<f32>, rayDir_in: vec3<f32>, seed: u32) -> vec3<f32> {
    var rayOrig     = rayOrig_in;
    var rayDir      = normalize(rayDir_in);
    var throughput  = vec3<f32>(1.0, 1.0, 1.0);
    var specDepth   = 0u;
    var color       = vec3<f32>(0.0, 0.0, 0.0);

    for (var depth = 0u; depth <= MAX_RAY_BOUNCES; depth = depth + 1u) {
        var closestT     = 1e9;
        var hitIsSphere  = false;
        var hitSphereIdx = 0u;
        var hitTriIdx    = 0u;

        // Intersect
        for (var i = 0u; i < arrayLength(&spheres); i = i + 1u) {
            let t = intersectSphere(rayOrig, rayDir, spheres[i]);
            if (t > 0.0 && t < closestT) {
                closestT     = t;
                hitIsSphere  = true;
                hitSphereIdx = i;
            }
        }
        for (var j = 0u; j < arrayLength(&triangles); j = j + 1u) {
            let t = intersectTriangle(rayOrig, rayDir, triangles[j]);
            if (t > 0.0 && t < closestT) {
                closestT   = t;
                hitIsSphere = false;
                hitTriIdx   = j;
            }
        }

        // Miss → background (black)
        if (closestT == 1e9) {
            color = color + throughput * vec3<f32>(0, 0, 0);
            break;
        }

        let hitPoint = rayOrig + rayDir * closestT;
        var normal   = vec3<f32>(0.0, 1.0, 0.0);
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

        // Material
        let mat        = materials[matId];
        let albedo     = mat.color.rgb;
        let refl       = mat.params.x;
        let rough      = mat.params.y;
        let ior        = mat.params.z;
        let emRGB      = mat.emissive.rgb;
        let emStrength = mat.emissive.w;

        // Emissive
        if (emStrength > 0.0) {
            color = color + throughput * (emRGB * emStrength);
            break;
        }

        // Depth cap
        if (depth >= MAX_RAY_BOUNCES) {
            color = color + throughput * albedo;
            break;
        }

        // Russian roulette
        if (depth >= RR_START_DEPTH) {
            let p = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.95);
            let survive = hash(seed * 911u + depth * 131u);
            if (survive > p) { break; }
            throughput = throughput / p;
        }

        // Dielectric (glass): Fresnel split only (no diffuse)
        if (ior > 0.0) {
            let entering = dot(rayDir, normal) < 0.0;
            let etai = select(ior, 1.0, entering); // returns 1.0 if entering==true, else ior
            let etat = select(1.0, ior, entering); // returns ior if entering==true, else 1.0

            // Fresnel reflectance at interface
            let kr = fresnel_schlick(rayDir, normal, ior);

            let reflDir = normalize(reflect3(rayDir, normal));
            let refrDir = refract3(rayDir, normal, etai, etat);
            let doReflect = (hash(seed * 313u + depth) < kr) || (length(refrDir) == 0.0);

            if (doReflect) {
                rayOrig    = hitPoint + normal * 1e-4;
                rayDir     = reflDir;
                // For clear glass, do NOT tint reflection by albedo; use spec multiplier if desired
                throughput = throughput * mix(vec3<f32>(1.0), albedo, 0.0);
                specDepth  = specDepth + 1u;
            } else {
                // Step slightly inside when refracting
                rayOrig    = hitPoint - normal * 1e-4;
                rayDir     = refrDir;
                // Transmission: for clear glass, leave throughput unchanged (or apply Beer-Lambert absorption later)
                throughput = throughput * mix(vec3<f32>(1.0), albedo, 0.0);
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
        rayOrig    = hitPoint + normal * 1e-4;
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

    // Aspect and vertical scale from FOV
    let aspect = f32(dims.x) / f32(dims.y);
    let tanHalfFov = tan(radians(camera.pos_fov.w) * 0.5);

    // Scale image plane: horizontal gets aspect * tanHalfFov, vertical gets tanHalfFov
    let u = ndc_x * aspect * tanHalfFov;
    let v = ndc_y * tanHalfFov;

    let rayOrig = camera.pos_fov.xyz;
    let rayDir  = normalize(
        camera.forward.xyz +
        u * camera.right.xyz +
        v * camera.up.xyz
    );

    let spp = camera.spp.x;
    var col = vec3<f32>(0.0);
    for (var i = 0u; i < spp; i = i + 1u) {
        let seed = hash2(gid.x, gid.y, frame.frameIndex, i);
        col = col + trace(rayOrig, rayDir, seed);
    }
    col = col / f32(spp);

    // Progressive accumulation
    let uv = vec2<f32>(f32(gid.x) / f32(dims.x), f32(gid.y) / f32(dims.y));
    let prev = textureSampleLevel(prevImage, samp, uv, 0).rgb;

    let fi = f32(frame.frameIndex);
    let accum = (prev * fi + col) / (fi + 1.0);

    textureStore(outImage, vec2<i32>(gid.xy), vec4<f32>(accum, 1.0));
}