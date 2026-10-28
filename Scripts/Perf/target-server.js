// The HTTP and TCP target of the seeded Website, API and Port monitors.
// /ok/... answers 200 with a small page, /down/... 500, /slow/... 200 after
// 300 ms, /api/... a little JSON. The Probe refuses loopback targets, so it
// listens on the docker bridge by default.
//
// Usage: node target-server.js [port] [host]   (3373, 172.17.0.1)
"use strict";

const http = require("http");

const port = Number(process.argv[2] || "3373");
const host = process.argv[3] || "172.17.0.1";
const page = `<!doctype html><html><head><title>Target</title></head><body><h1>OK</h1><p>${"lorem ipsum ".repeat(200)}</p></body></html>`;

let served = 0;

const server = http.createServer((req, res) => {
  served++;
  const path = new URL(req.url, "http://target").pathname;

  if (path.startsWith("/down")) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("down");
    return;
  }

  if (path.startsWith("/slow")) {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page);
    }, 300);
    return;
  }

  if (path.startsWith("/api")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", served, items: [1, 2, 3] }));
    return;
  }

  res.writeHead(200, { "content-type": "text/html" });
  res.end(page);
});

server.keepAliveTimeout = 5000;
server.listen(port, host, () => {
  console.log(`target listening on ${host}:${port}`);
});

setInterval(() => {
  console.log(`${new Date().toISOString()} served ${served}`);
}, 60000).unref();
