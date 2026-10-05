"use strict";

/**
 * Front door of the sink, which stands in for OneUptime. The agent posts to
 * OneUptime's paths: <url>/otlp/v1/{traces,metrics,logs} through its collector
 * and, from the profiler, <url>/otlp/v1/profiles. The sink collector serves
 * traces/metrics/logs on those paths itself (traces_url_path & co), but its
 * OTLP receiver has no setting for the profiles path -- it is hardcoded to
 * /v1development/profiles -- so this proxy maps that one path and passes
 * everything else through unchanged.
 */

const http = require("http");

/*
 * Keep idle keep-alive connections open longer than the exporters' (Go's
 * default 90s idle timeout): Node closes them after 5s by default, and an
 * exporter reusing one just as it closes gets EOF / connection reset and has
 * to retry.
 */
const KEEP_ALIVE_MS = 120000;
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 4320);
let profilesPosts = 0;
const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

const server = http
  .createServer((req, res) => {
    let path = req.url;
    if (path.split("?")[0] === "/otlp/v1/profiles") {
      path = "/v1development/profiles";
      profilesPosts++;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: UPSTREAM_PORT,
        method: req.method,
        path,
        headers: req.headers,
        agent: upstreamAgent,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      res.writeHead(502);
      res.end(String(err));
    });
    req.pipe(upstream);
  })
  .listen(4318, "0.0.0.0", () => {
    console.log("sink proxy on 4318 ->", UPSTREAM_PORT);
  });
server.keepAliveTimeout = KEEP_ALIVE_MS;
server.headersTimeout = KEEP_ALIVE_MS + 1000;

setInterval(() => {
  console.log(JSON.stringify({ profilesPosts }));
}, 30000).unref();
