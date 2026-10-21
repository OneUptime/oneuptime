/*
 * Listens on UDP ports and writes every datagram it receives, in arrival
 * order, as one hex line to <outDir>/<label>.hex. Usage:
 *   node capture.js <outDir> <label>:<port> [<label>:<port> ...]
 * Stops after IDLE_MS without a datagram once at least one arrived, or after
 * MAX_MS.
 */
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");

const outDir = process.argv[2];
const specs = process.argv.slice(3);
const IDLE_MS = Number(process.env.IDLE_MS || 4000);
const MAX_MS = Number(process.env.MAX_MS || 60000);

let last = 0;
let received = 0;
const started = Date.now();

for (const spec of specs) {
  const [label, port] = spec.split(":");
  const file = path.join(outDir, `${label}.hex`);
  fs.writeFileSync(file, "");
  const socket = dgram.createSocket("udp4");
  socket.on("message", (msg) => {
    fs.appendFileSync(file, msg.toString("hex") + "\n");
    last = Date.now();
    received++;
  });
  socket.bind(Number(port), "127.0.0.1");
}

const timer = setInterval(() => {
  const now = Date.now();
  if ((received > 0 && now - last > IDLE_MS) || now - started > MAX_MS) {
    console.log(`captured ${received} datagram(s)`);
    clearInterval(timer);
    process.exit(0);
  }
}, 250);
