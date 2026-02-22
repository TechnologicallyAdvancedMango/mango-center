const memory = new Uint8Array(256);
const registers = new Uint8Array(8);
let pc = 0; // Program counter
let interval;

memory[0] = 0x01;
memory[1] = 0x02;
memory[2] = 0x01;

function clock() {
    const opCode = memory[pc];
    pc++;

    switch (opCode) {
        case 0x00:
            break;

        case 0xFF:
            console.log("HALT");
            clearInterval(interval);
            break;


        case 0x01:
            console.log("Hello World");
            break;

        case 0x02:
            console.log("I am a robot!");
            break;

        default:
            console.log("Unknown opcode:", opCode);
            break;
    }
}

interval = setInterval(clock, 1000);