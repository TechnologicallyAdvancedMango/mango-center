@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var samplerTex : sampler;

@fragment
fn fs_main(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
    let uv = pos.xy / vec2<f32>(textureDimensions(inputTex));
    return textureSample(inputTex, samplerTex, uv);
}