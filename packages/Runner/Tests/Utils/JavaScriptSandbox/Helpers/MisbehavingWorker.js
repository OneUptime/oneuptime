"use strict";

/*
 * A step's worker that does not keep to the protocol, in the way the
 * request's args.mode says, for SandboxProcess's tests:
 *
 *   hang         reads the request and never answers or exits
 *   silent       exits 0 without answering
 *   crash        exits 3 without answering
 *   wrong-nonce  answers, with another request's nonce
 *   garbage      answers with text that is not JSON
 *   flood        answers with more than a reply may hold
 *   echo-pid     answers with its own pid, as a well-behaved worker would
 */

const net = require("net");

function readRequest() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    });
  });
}

function reply(text) {
  const channel = new net.Socket({ fd: 3, readable: false, writable: true });
  channel.on("error", () => {
    process.exit(0);
  });
  channel.end(text, () => {
    process.exit(0);
  });
}

async function main() {
  const request = await readRequest();
  const mode = (request.args || {}).mode;

  if (mode === "hang") {
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === "silent") {
    process.exit(0);
  }

  if (mode === "crash") {
    process.exit(3);
  }

  if (mode === "wrong-nonce") {
    reply(
      JSON.stringify({
        version: 1,
        nonce: "ffffffffffffffffffffffffffffffff",
        success: true,
        output: "not this request's",
      }),
    );
    return;
  }

  if (mode === "garbage") {
    reply("this is not JSON");
    return;
  }

  if (mode === "flood") {
    reply("x".repeat(2 * 1024 * 1024));
    return;
  }

  reply(
    JSON.stringify({
      version: 1,
      nonce: request.nonce,
      success: true,
      output: String(process.pid),
    }),
  );
}

void main();
