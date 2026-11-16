"use strict";

/*
 * A step's worker that does not keep to the protocol, in the way the
 * request's args.mode says, for SandboxProcess's tests:
 *
 *   hang          reads the request and never answers or exits
 *   silent        exits 0 without answering
 *   crash         exits 3 without answering
 *   wrong-nonce   answers, with another request's nonce
 *   garbage       answers with text that is not JSON
 *   flood         answers with more than a reply may hold
 *   http-garbage  writes a line that is not an HTTP call on its HTTP channel
 *   http-flood    writes more on its HTTP channel than a step may send
 *   echo-pid      answers with its own pid, as a well-behaved worker would
 *
 * The request is the first line of standard input (SandboxProtocol v2);
 * everything is written as a file (fs), not a socket, because the step's
 * process may use no network API (Node's permission model).
 */

const fs = require("fs");

// fd 4, the HTTP channel.
const httpChannel = fs.createWriteStream("", { fd: 4, autoClose: false });

function readRequest() {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        process.stdin.off("data", onData);
        resolve(JSON.parse(buffer.slice(0, newline)));
      }
    };
    process.stdin.on("data", onData);
  });
}

function reply(text) {
  const channel = fs.createWriteStream("", { fd: 3 });
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
        version: 2,
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

  if (mode === "http-garbage") {
    // A line the Runner will not read as one of the step's HTTP calls.
    httpChannel.write(`${JSON.stringify({ not: "a call" })}\n`);
    return;
  }

  if (mode === "http-flood") {
    // One huge line on the HTTP channel, past what a step may send in all.
    httpChannel.write(`${"z".repeat(40 * 1024 * 1024)}\n`);
    return;
  }

  reply(
    JSON.stringify({
      version: 2,
      nonce: request.nonce,
      success: true,
      output: String(process.pid),
    }),
  );
}

void main();
