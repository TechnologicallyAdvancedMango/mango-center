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
    return { t, hitPoint, normal, material: sphere.material };
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

function reflect(dir, normal) {
    return normalize({
        x: dir.x - 2 * dot(dir, normal) * normal.x,
        y: dir.y - 2 * dot(dir, normal) * normal.y,
        z: dir.z - 2 * dot(dir, normal) * normal.z
    });
}

function refract(dir, normal, etai, etat) {
    let cosi = Math.max(-1, Math.min(1, dot(dir, normal)));
    let n = normal;
    if (cosi < 0) {
        cosi = -cosi;
    } else {
        // exiting: flip normal
        n = {x:-normal.x, y:-normal.y, z:-normal.z};
    }
    const eta = etai / etat;
    const k = 1 - eta*eta*(1 - cosi*cosi);
    if (k < 0) return null; // total internal reflection
    return normalize({
        x: dir.x*eta + n.x*(eta*cosi - Math.sqrt(k)),
        y: dir.y*eta + n.y*(eta*cosi - Math.sqrt(k)),
        z: dir.z*eta + n.z*(eta*cosi - Math.sqrt(k))
    });
}


function fresnel(dir, normal, ior) {
    let cosi = Math.max(-1, Math.min(1, dot(dir, normal)));
    let etai = 1, etat = ior;
    if (cosi > 0) [etai, etat] = [etat, etai];
    // Compute sine of transmission angle using Snell's law
    const sint = etai / etat * Math.sqrt(Math.max(0, 1 - cosi*cosi));
    if (sint >= 1) return 1; // total internal reflection
    const cost = Math.sqrt(Math.max(0, 1 - sint*sint));
    cosi = Math.abs(cosi);
    const Rs = ((etat * cosi) - (etai * cost)) / ((etat * cosi) + (etai * cost));
    const Rp = ((etai * cosi) - (etat * cost)) / ((etai * cosi) + (etat * cost));
    return (Rs*Rs + Rp*Rp) / 2;
}

function applyAbsorption(color, dist, absorptionColor, density=0.2) {
    return {
        r: color.r * Math.exp(-density * dist * (1 - absorptionColor.r/255)),
        g: color.g * Math.exp(-density * dist * (1 - absorptionColor.g/255)),
        b: color.b * Math.exp(-density * dist * (1 - absorptionColor.b/255))
    };
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
    if (tris.length <= 8 || depth > 16) {
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

    // Triangle intersections via BVH
    const resTri = traverseBVH(bvhRoot, ray.origin, ray.dir);
    if (resTri && resTri.t < closest) {
        closest = resTri.t;
        hitObj = { material: resTri.material };
        hitPoint = resTri.hitPoint;
        normal = resTri.normal;
    }

    // Miss → background color
    if (!hitObj) {
        return {
            r: 0.0 * throughput.r, // to add background
            g: 0.0 * throughput.g,
            b: 0.0 * throughput.b
        };
    }


    const mat = hitObj.material;

    // If we hit an emissive object, return its emission modulated by throughput
    if (mat.emissionStrength > 0) {
        return {
            r: throughput.r * (mat.emission.r / 255) * mat.emissionStrength,
            g: throughput.g * (mat.emission.g / 255) * mat.emissionStrength,
            b: throughput.b * (mat.emission.b / 255) * mat.emissionStrength
        };
    }

    // Depth cap
    if (depth >= maxRayBounces) {
        // terminate with the surface albedo contribution so objects don't fade to black
        const albedo = {
            r: (mat.color.r || 0) / 255,
            g: (mat.color.g || 0) / 255,
            b: (mat.color.b || 0) / 255
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
    const EPS = 1e-4;
    const origin = {
        x: hitPoint.x + normal.x * EPS,
        y: hitPoint.y + normal.y * EPS,
        z: hitPoint.z + normal.z * EPS
    };

    // Albedo
    const albedo = {
        r: (mat.color.r || 0) / 255,
        g: (mat.color.g || 0) / 255,
        b: (mat.color.b || 0) / 255
    };

    const cosTheta = Math.max(0.0, dot(bounceDir, normal));
    let nextThroughput = {
        r: throughput.r * albedo.r * cosTheta,
        g: throughput.g * albedo.g * cosTheta,
        b: throughput.b * albedo.b * cosTheta
    };

    let refl = mat.reflectivity != null ? mat.reflectivity : 0.0;
    refl = Math.max(0, Math.min(1, refl)); // clamp 0..1

    if (specDepth >= maxRayBounces) {
        // too many reflections → just diffuse
        const diffRay = { origin, dir: bounceDir };
        return trace(diffRay, scene, depth+1, nextThroughput, specDepth);
    }

    if (mat.ior) {
        const entering = dot(ray.dir, normal) < 0;
        const etai = entering ? 1.0 : mat.ior;
        const etat = entering ? mat.ior : 1.0;

        const kr = fresnel(ray.dir, normal, mat.ior);
        const refrDir = refract(ray.dir, normal, etai, etat);

        const EPS = 1e-4;

        // Reflection ray
        const reflOrigin = {
            x: hitPoint.x + normal.x * EPS,
            y: hitPoint.y + normal.y * EPS,
            z: hitPoint.z + normal.z * EPS
        };
        const reflDir = perturbDirection(reflect(ray.dir, normal), mat.roughness || 0);
        const reflRay = { origin: reflOrigin, dir: reflDir };
        const reflCol = trace(reflRay, scene, depth+1, {
            r: throughput.r * kr,
            g: throughput.g * kr,
            b: throughput.b * kr
        }, specDepth+1);

        // Refraction ray
        let refrCol = {r:0,g:0,b:0};
        if (refrDir) {
            const refrOrigin = entering
                ? { x: hitPoint.x - normal.x * EPS,
                    y: hitPoint.y - normal.y * EPS,
                    z: hitPoint.z - normal.z * EPS }
                : { x: hitPoint.x + normal.x * EPS,
                    y: hitPoint.y + normal.y * EPS,
                    z: hitPoint.z + normal.z * EPS };

            const refrRay = { origin: refrOrigin, dir: refrDir };
            const rawCol = trace(refrRay, scene, depth+1, {
                r: throughput.r * (1-kr),
                g: throughput.g * (1-kr),
                b: throughput.b * (1-kr)
            }, specDepth);

            // Apply absorption only while inside
            refrCol = entering ? applyAbsorption(rawCol, closest, mat.color) : rawCol;
        }

        return {
            r: reflCol.r + refrCol.r,
            g: reflCol.g + refrCol.g,
            b: reflCol.b + refrCol.b
        };
    }

    // Reflection ray
    const reflDir = perturbDirection(reflect(ray.dir, normal), mat.roughness || 0);
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

const SAMPLES_PER_FRAME = 1;

let bvhRoot = null;
let accum = null;

onmessage = function(e) {
    const { scene, camera, x, y, width, height, frameId, samplesPerPixel } = e.data;

    if (!bvhRoot) {
        bvhRoot = buildBVH(scene.triangles);
    }

    // Use provided samplesPerPixel if present; otherwise fall back to SAMPLES_PER_FRAME
    const SPP = (typeof samplesPerPixel === 'number' && samplesPerPixel > 0) ? samplesPerPixel : SAMPLES_PER_FRAME;

    // Float32 accumulation buffer (RGB)
    if (!accum || accum.length !== width * height * 3) {
        accum = new Float32Array(width * height * 3);
    }
    // clear it before reuse
    accum.fill(0);

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
