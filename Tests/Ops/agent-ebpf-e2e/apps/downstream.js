"use strict";

// The app's HTTP dependency: answers GET /ping.
const http = require("http");

http
  .createServer((req, res) => {
    if (req.url === "/ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pong");
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(8080, "0.0.0.0", () => {
    console.log(
      `downstream node ${process.version} pid ${process.pid} on 8080`,
    );
  });
