const memory = new Uint8Array(256);
const registers = new Uint8Array(8);
let pc = 0; // Program counter

function clock() {
    const opCode = memory[pc];
    pc++;

    switch (opcode) {
        case 0x01: 
            console.log("Hello World");
            break;

        case 0x02:
            console.log("I am a robot!");
            break;

        default:
            console.log("Unknown opcode:", opcode);
            break;
    }
}

setInterval(clock, 1000);