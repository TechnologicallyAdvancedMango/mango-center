const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


let fps = 60;
let frameMultiplier = 1;

let circleFill = "white";
let circleStroke = "black";
let circleStrokeWidth = 3;

let objects = [];

class Circle {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    
    this.vx = 0;
    this.vy = 0;
    
    this.radius = radius;

    objects.push(this);
  }
}

function simulate() {
  
}

function drawCircles() {
  ctx.fillStyle = circleFill;
  ctx.strokeStyle = circleStroke;
  ctx.lineWidth = circleStrokeWidth;
  
  for(const circle of objects) {
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSprings() {
  
}

function render() {
  drawCircles();
  drawSprings();
}

function clearScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

let circle1 = new Circle(200, 200, 100);

function mainLoop() {
  clearScreen();
  
  for(let i = 0; i < frameMultiplier; i++) {
    simulate();
  }
  
  render();
}

setInterval(mainLoop, 1000 / fps);
