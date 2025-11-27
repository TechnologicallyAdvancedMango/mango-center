// Utility math
function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
function normalize(v) {
    const len = Math.sqrt(dot(v,v));
    if (len === 0) return {x:0, y:0, z:-1}; // guard against NaN
    return {x:v.x/len, y:v.y/len, z:v.z/len};
}

// Ray-sphere intersection
function intersectSphere(ray, sphere) {
    const oc = sub(ray.origin, sphere.center);
    const a = dot(ray.dir, ray.dir);
    const b = 2.0 * dot(oc, ray.dir);
    const c = dot(oc, oc) - sphere.radius*sphere.radius;
    const disc = b*b - 4*a*c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2*a);
    if (t < 0) return null;

    // compute hit point and normal
    const hitPoint = {
        x: ray.origin.x + ray.dir.x * t,
        y: ray.origin.y + ray.dir.y * t,
        z: ray.origin.z + ray.dir.z * t
    };
    let normal = normalize(sub(hitPoint, sphere.center));
    // Face-forward for consistency
    if (dot(normal, ray.dir) > 0) {
        normal = { x:-normal.x, y:-normal.y, z:-normal.z };
    }
    return { t, color: sphere.color, hitPoint, normal };
}

// Ray-triangle intersection (Möller–Trumbore)
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
        // Face-forward: make sure normal opposes ray.dir
        if (dot(normal, ray.dir) > 0) {
            normal = { x:-normal.x, y:-normal.y, z:-normal.z };
        }
        return { t, color: tri.color, hitPoint, normal };
    }
    return null;
}

function reflect(dir, normal) {
    return normalize({
        x: dir.x - 2 * dot(dir, normal) * normal.x,
        y: dir.y - 2 * dot(dir, normal) * normal.y,
        z: dir.z - 2 * dot(dir, normal) * normal.z
    });
}

function randomInHemisphere(normal) {
    // random point in unit sphere
    let x, y, z;
    do {
        x = Math.random()*2 - 1;
        y = Math.random()*2 - 1;
        z = Math.random()*2 - 1;
    } while (x*x + y*y + z*z > 1);

    const v = {x, y, z};
    // flip if it's not in the same hemisphere as the normal
    return dot(v, normal) > 0 ? normalize(v) : normalize({x:-v.x, y:-v.y, z:-v.z});
}

function cosineSampleHemisphere(n) {
    // sample disk
    const r1 = Math.random();
    const r2 = Math.random();
    const r = Math.sqrt(r1);
    const theta = 2 * Math.PI * r2;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const z = Math.sqrt(Math.max(0, 1 - r1)); // cosine weight

    // build an orthonormal basis (tangent, bitangent, normal)
    const up = Math.abs(n.z) < 0.999 ? {x:0,y:0,z:1} : {x:1,y:0,z:0};
    const tangent = normalize(cross(up, n));
    const bitangent = normalize(cross(n, tangent));

    // transform to world
    return normalize({
        x: tangent.x * x + bitangent.x * y + n.x * z,
        y: tangent.y * x + bitangent.y * y + n.y * z,
        z: tangent.z * x + bitangent.z * y + n.z * z
    });
}

function perturbDirection(dir, roughness) {
    if (roughness <= 0) return dir; // perfect mirror

    // sample random vector in unit sphere
    let x, y, z;
    do {
        x = Math.random()*2 - 1;
        y = Math.random()*2 - 1;
        z = Math.random()*2 - 1;
    } while (x*x + y*y + z*z > 1);

    const rand = {x, y, z};
    // scale by roughness
    const perturbed = {
        x: dir.x + rand.x * roughness,
        y: dir.y + rand.y * roughness,
        z: dir.z + rand.z * roughness
    };
    return normalize(perturbed);
}

function cross(a,b){ return { x:a.y*b.z - a.z*b.y, y:a.z*b.x - a.x*b.z, z:a.x*b.y - a.y*b.x }; }

function trace(ray, scene, depth=0, throughput={r:1,g:1,b:1}, specDepth=0) {
    let closest = Infinity;
    let hitObj = null;
    let hitPoint = null;
    let normal = null;

    // Sphere intersections
    for (const sphere of scene.spheres) {
        const res = intersectSphere(ray, sphere);
        if (res && res.t < closest) {
            closest = res.t;
            hitObj = sphere;
            hitPoint = res.hitPoint;
            normal = res.normal;
        }
    }

    // Triangle intersections
    for (const tri of scene.triangles) {
        const res = intersectTriangle(ray, tri);
        if (res && res.t < closest) {
            closest = res.t;
            hitObj = tri;
            hitPoint = res.hitPoint;
            normal = res.normal;
        }
    }

    // Miss → black
    if (!hitObj) return { r:0, g:0, b:0 };

    // If we hit an emissive object, return its emission modulated by throughput
    if (hitObj.emissionStrength > 0) {
        return {
            r: throughput.r * (hitObj.emission.r / 255) * hitObj.emissionStrength,
            g: throughput.g * (hitObj.emission.g / 255) * hitObj.emissionStrength,
            b: throughput.b * (hitObj.emission.b / 255) * hitObj.emissionStrength
        };
    }

    // Depth cap
    if (depth >= maxRayBounces) {
        // terminate with the surface albedo contribution so objects don't fade to black
        const albedo = {
            r: (hitObj.color.r || 0) / 255,
            g: (hitObj.color.g || 0) / 255,
            b: (hitObj.color.b || 0) / 255
        };
        return {
            r: throughput.r * albedo.r,
            g: throughput.g * albedo.g,
            b: throughput.b * albedo.b
        };
    }

    // Russian roulette after rrStartDepth
    if (depth >= rrStartDepth) {
        // survival probability based on max channel of throughput (clamped)
        const p = Math.min(0.95, Math.max(0.05, Math.max(throughput.r, throughput.g, throughput.b)));
        if (Math.random() > p) return { r:0, g:0, b:0 };
        // compensate energy
        throughput = { r: throughput.r / p, g: throughput.g / p, b: throughput.b / p };
    }

    // Cosine-weighted diffuse bounce
    const bounceDir = cosineSampleHemisphere(normal);
    const origin = {
        x: hitPoint.x + normal.x * 1e-4,
        y: hitPoint.y + normal.y * 1e-4,
        z: hitPoint.z + normal.z * 1e-4
    };

    // Update throughput by surface albedo (0..1)
    const albedo = {
        r: (hitObj.color.r || 0) / 255,
        g: (hitObj.color.g || 0) / 255,
        b: (hitObj.color.b || 0) / 255
    };

    let nextThroughput = {
        r: throughput.r * albedo.r,
        g: throughput.g * albedo.g,
        b: throughput.b * albedo.b
    };

    let refl = hitObj.reflectivity != null ? hitObj.reflectivity : 0.0;
    refl = Math.max(0, Math.min(1, refl)); // clamp 0..1

    if (specDepth >= maxRayBounces) {
        // too many reflections → just diffuse
        const diffRay = { origin, dir: bounceDir };
        return trace(diffRay, scene, depth+1, nextThroughput, specDepth);
    }

    // Reflection ray
    const reflDir = perturbDirection(reflect(ray.dir, normal), hitObj.roughness || 0);
    const specRay = { origin, dir: reflDir };
    const specColor = trace(specRay, scene, depth+1, {
        r: throughput.r * refl,
        g: throughput.g * refl,
        b: throughput.b * refl
    }, specDepth+1);

    // Diffuse ray
    const diffRay = { origin, dir: bounceDir };
    const diffColor = trace(diffRay, scene, depth+1, {
        r: nextThroughput.r * (1 - refl),
        g: nextThroughput.g * (1 - refl),
        b: nextThroughput.b * (1 - refl)
    }, specDepth);

    // Blend them smoothly
    return {
        r: specColor.r + diffColor.r,
        g: specColor.g + diffColor.g,
        b: specColor.b + diffColor.b
    };
}

const maxRayBounces = 10; // Max reflection bounces, diffuse and specular
const rrStartDepth = 3; // start Russian roulette

const SAMPLES_PER_FRAME = 4; // tweak live

onmessage = function(e) {
    const { scene, camera, x, y, width, height, frameId, samplesPerPixel } = e.data;

    // Use provided samplesPerPixel if present; otherwise fall back to SAMPLES_PER_FRAME
    const SPP = (typeof samplesPerPixel === 'number' && samplesPerPixel > 0) ? samplesPerPixel : SAMPLES_PER_FRAME;

    // Float32 accumulation buffer (RGB)
    const accum = new Float32Array(width * height * 3);

    const aspect = camera.width / camera.height;
    const fovScale = Math.tan((camera.fov || 60) * 0.5 * Math.PI / 180);

    for (let s = 0; s < SPP; s++) {
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                // jitter for anti-aliasing / sampling
                const jitterX = Math.random() - 0.5;
                const jitterY = Math.random() - 0.5;

                const u = (((i + x) + jitterX) / camera.width * 2 - 1) * aspect * fovScale;
                const v = (((j + y) + jitterY) / camera.height * 2 - 1) * fovScale;

                const dir = normalize({
                    x: camera.forward.x + u * camera.right.x + v * camera.up.x,
                    y: camera.forward.y + u * camera.right.y + v * camera.up.y,
                    z: camera.forward.z + u * camera.right.z + v * camera.up.z
                });

                const ray = { origin: camera.position, dir };
                const col = trace(ray, scene, 0, { r: 1, g: 1, b: 1 }); // radiance in 0..255 space

                const idx = (j * width + i) * 3;
                accum[idx]     += col.r;
                accum[idx + 1] += col.g;
                accum[idx + 2] += col.b;
            }
        }
    }

    // Return float sums; main thread will keep running totals and divide by totalSamples
    postMessage({ x, y, width, height, accum, samples: SPP, frameId }, [accum.buffer]);
};
