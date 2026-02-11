class Neuron {
    constructor (numInputs, isOutput = false) {
        this.isOutput = isOutput;
        const scale = Math.sqrt(2 / numInputs);
        this.weights = Array.from({ length: numInputs }, () => (Math.random() * 2 - 1) * scale);
        this.bias = 0;
        this.z = 0;

        this.output = 0;
        this.delta = 0;
    }

    activate(x) { return this.isOutput ? x : (x > 0 ? x : 0); }
    derivative(x) { return this.isOutput ? 1 : (x > 0 ? 1 : 0); }

    forward(inputs) {
        let sum = this.bias;
        for (let i = 0; i < this.weights.length; i++) {
            sum += this.weights[i] * inputs[i];
        }
        this.z = sum;
        this.output = this.activate(sum);
        return this.output;
    }
}

class Layer {
    constructor(numNeurons, numInputsPerNeuron, isOutput = false) {
        this.isOutput = isOutput;
        this.neurons = Array.from({ length: numNeurons }, () => new Neuron(numInputsPerNeuron, isOutput));
        this.output = [];
    }

    forward(inputs) {
        this.output = this.neurons.map(n => n.forward(inputs));
        return this.output;
    }

    backward(nextLayer) {
        if (this.isOutput) {
            for (let i = 0; i < this.neurons.length; i++) {
                let n = this.neurons[i];
                n.delta = (n.output - this.target[i]) * n.derivative(n.z); 
            }
        } else {
            for (let i = 0; i < this.neurons.length; i++) {
                let n = this.neurons[i];
                let sum = 0;
                for (let nextNeuron of nextLayer.neurons) {
                    sum += nextNeuron.weights[i] * nextNeuron.delta;
                }
                n.delta = sum * n.derivative(n.z);
            }
        }
    }

    updateWeights(prevOutput, lr) {
        for (let neuron of this.neurons) {
            for (let w = 0; w < neuron.weights.length; w++) {
                neuron.weights[w] -= lr * neuron.delta * prevOutput[w];
            }
            neuron.bias -= lr * neuron.delta;
        }
    }
}

class Network {
    constructor(layerSizes) {
        this.layers = [];
        for (let i = 1; i < layerSizes.length; i++) {
            this.layers.push(new Layer(layerSizes[i], layerSizes[i-1], i === layerSizes.length - 1));
        }
    }

    forward(inputs) {
        this.input = inputs;
        let output = inputs;
        for (let layer of this.layers) {
            output = layer.forward(output);
        }
        return output;
    }

    predict(inputs) { return this.forward(inputs); }
    
    backward(targets) {
        let last = this.layers[this.layers.length - 1];
        last.target = targets;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            this.layers[i].backward(this.layers[i + 1] || null);
        }
    }
    updateWeights(lr) {
        for (let i = 0; i < this.layers.length; i++) {
            let prevOutput = (i === 0) ? this.input : this.layers[i - 1].output;
            this.layers[i].updateWeights(prevOutput, lr);
        }
    }

    train(inputs, targets, lr = 0.1) {
        this.forward(inputs);
        this.backward(targets);
        this.updateWeights(lr);
    }
}

let jeff = new Network([2, 32, 32, 1]);
const norm = 255;

function xorTask() {
    let a = Math.round(Math.random()), b = Math.round(Math.random());
    return {
        input: [a, b], target: [a ^ b]
    };
}

function addTask() {
    let a = Math.random() * (norm/2), b = Math.random() * (norm/2);
    return {
        input: [a/norm, b/norm],
        target: [(a + b)/norm]
    };
}

async function runTraining() {
    const type = document.getElementById("taskSelect").value;
    const task = type === 'xor' ? xorTask : addTask;
    const lr = type === 'xor' ? 0.1 : 0.01;

    for (let i = 0; i <= 10000; i++) {
        let ex = task();
        jeff.train(ex.input, ex.target, lr);
        if (i % 1000 === 0) await new Promise(r => setTimeout(r, 0));
    }
    alert("Training finished");
}

document.getElementById("predictBtn").onclick = () => {
    const v1 = parseFloat(document.getElementById("num1").value);
    const v2 = parseFloat(document.getElementById("num2").value);
    const type = document.getElementById("taskSelect").value;
    const ans = document.getElementById("answer");
    
    if (type === 'xor') {
        ans.innerText = jeff.predict([v1, v2])[0].toFixed(4);
    } else {
        ans.innerText = (jeff.predict([v1/norm, v2/norm])[0] * norm).toFixed(2);
    }
};