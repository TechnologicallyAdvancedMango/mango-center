const memory = new Uint8Array(256);
const registers = new Uint8Array(8);
let pc = 0; // Program counter
let interval;

memory[1] = 0x10;
memory[2] = 0x00;
memory[3] = 69;

memory[4] = 0x40;
memory[5] = 0x00;

memory[6] = 0xFF;

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

        case 0x10: { // LOAD r, immediate
            const r = memory[pc++];
            const value = memory[pc++];
            registers[r] = value;
            break;
        }

        case 0x11: { // LOAD r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            registers[r] = memory[addr];
            break;
        }

        case 0x12: { // STORE r, addr
            const r = memory[pc++];
            const addr = memory[pc++];
            memory[addr] = registers[r];
            break;
        }

        case 0x40: { // PRINT r
            const r = memory[pc++];
            console.log(registers[r]);
            break;
        }        

        default:
            console.log("Unknown opcode:", opCode);
            break;
    }
}

interval = setInterval(clock, 1000);