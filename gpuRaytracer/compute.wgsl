struct Sphere {
    center_radius : vec4<f32>,   // xyz = center, w = radius
    material      : vec4<u32>,   // x = materialId, y/z/w unused
};

@group(0) @binding(0) var<storage, read> spheres : array<Sphere>;

struct Triangle {
    v0 : vec4<f32>,  // xyz = v0, w unused
    v1 : vec4<f32>,  // xyz = v1, w unused
    v2 : vec4<f32>,  // xyz = v2, w unused
    mat : vec4<u32>, // x = materialId, y/z/w unused
};

@group(0) @binding(1) var<storage, read> triangles : array<Triangle>;

struct CameraData {
    pos_fov   : vec4<f32>,  // xyz = position, w = fov
    forward   : vec4<f32>,  // xyz = forward
    right     : vec4<f32>,  // xyz = right
    up        : vec4<f32>,  // xyz = up
    spp       : vec4<u32>,  // x = samplesPerPixel
};

@group(0) @binding(2) var<uniform> camera : CameraData;

@group(0) @binding(3) var outImage : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let dims = textureDimensions(outImage);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    // Just a gradient, ignoring spheres/triangles/camera
    let color = vec4<f32>(
        f32(gid.x) / f32(dims.x),
        f32(gid.y) / f32(dims.y),
        0.5,
        1.0
    );
    textureStore(outImage, vec2<i32>(gid.xy), color);
}