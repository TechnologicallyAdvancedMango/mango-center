struct ScreenData {
    canvasSize : vec2<f32>,
};

@group(0) @binding(0) var inputTex   : texture_2d<f32>;
@group(0) @binding(1) var samplerTex : sampler;
@group(0) @binding(2) var<uniform> screen : ScreenData;

@fragment
fn fs_main(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
    // Normalize to [0,1] across the canvas
    let uv = pos.xy / screen.canvasSize;
    return textureSampleLevel(inputTex, samplerTex, uv, 0);
}
