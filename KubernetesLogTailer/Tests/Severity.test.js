// Config reads these at require time; OTLPBatcher pulls MIN_SEVERITY from it.
process.env.ONEUPTIME_URL = "http://test.invalid";
process.env.ONEUPTIME_API_KEY = "test-key";
process.env.CLUSTER_NAME = "test-cluster";
process.env.LOG_LEVEL = "error";

const assert = require("node:assert/strict");
const test = require("node:test");
const OTLPBatcherModule = require("../build/dist/OTLPBatcher");

const deriveSeverity = OTLPBatcherModule.deriveSeverity;

// The Kubernetes pods/log API merges stdout and stderr, so LogStream always
// reports "stdout" in this mode. Every case below therefore uses "stdout":
// anything the regex fails to read off the body lands on INFO, unparsed.
const derive = (body) => {
  return deriveSeverity(body, "stdout");
};

const parsedAs = (body, text) => {
  const result = derive(body);

  assert.equal(result.text, text, `body: ${body}`);
  assert.equal(result.parsed, true, `body: ${body}`);
};

const notParsed = (body) => {
  const result = derive(body);

  assert.equal(result.parsed, false, `body: ${body}`);
  assert.equal(result.text, "INFO", `body: ${body}`);
};

test("reads the level out of PSR-3 / Monolog lines", () => {
  parsedAs(
    `[2026-08-31 07:25:04] app.INFO: user logged in {"id":7} []`,
    "INFO",
  );
  parsedAs("[2026-08-31 07:25:04] request.WARNING: slow response", "WARNING");
  parsedAs("[2026-08-31 07:25:04] app.ERROR: connection refused", "ERROR");
  parsedAs("[2026-08-31 07:25:04] doctrine.DEBUG: SELECT 1", "DEBUG");
  parsedAs("[2026-08-31 07:25:04] php.CRITICAL: out of memory", "CRITICAL");
});

test("reads the level out of zap / logrus / slog JSON lines", () => {
  parsedAs(`{"level":"info","ts":1756628704.1,"msg":"started"}`, "INFO");
  parsedAs(`{"level":"warn","ts":1756628704.1,"msg":"retrying"}`, "WARN");
  parsedAs(`{"level":"error","ts":1756628704.1,"msg":"conn refused"}`, "ERROR");
  parsedAs(
    `{"level":"info","msg":"hello","time":"2026-08-31T07:25:04Z"}`,
    "INFO",
  );
  parsedAs(
    `{"time":"2026-08-31T07:25:04Z","level":"INFO","msg":"ready"}`,
    "INFO",
  );
});

test("still reads the shapes that already worked", () => {
  parsedAs("[ERROR] something bad happened", "ERROR");
  parsedAs("WARN: disk almost full", "WARN");
  parsedAs("2026-08-31 07:25:04 INFO starting up", "INFO");
  parsedAs("[INFO] plugin/reload: Running configuration MD5", "INFO");
  parsedAs("2026/08/31 07:25:04 [error] 12#12: *1 open() failed", "ERROR");
  parsedAs("2026-08-31 07:25:04,123 - myapp - INFO - ready", "INFO");
  parsedAs("07:25:04.123 [main] INFO  c.e.App - started", "INFO");
  parsedAs("info: Microsoft.Hosting.Lifetime[14]", "INFO");
});

test("leaves a line with no level unparsed so the threshold cannot drop it", () => {
  notParsed("Server listening on port 8080");
  notParsed("    at com.example.Foo.bar(Foo.java:42)");
  notParsed("GET https://api.example.com/v1/errors?x=1 200");
  notParsed("there were 3 errors");
  notParsed("informational message");
  notParsed("loaded config from /etc/app/warning.yaml");
  notParsed("service.warning.example.com resolved");
  // klog's single-letter prefix needs its own letter-to-level mapping.
  notParsed("I0831 07:25:04.123456       1 server.go:100] Serving");
});

test("maps every alias onto the OTel severity number for its level", () => {
  assert.equal(derive("[WARN] x").number, derive("[WARNING] x").number);
  assert.equal(derive("[ERR] x").number, derive("[ERROR] x").number);
  assert.equal(derive("[CRIT] x").number, derive("[CRITICAL] x").number);
  assert.equal(derive("[PANIC] x").number, derive("[FATAL] x").number);
  assert.equal(derive("[TRACE] x").number, 1);
  assert.equal(derive("[DEBUG] x").number, 5);
  assert.equal(derive("[INFO] x").number, 9);
  assert.equal(derive("[NOTICE] x").number, 10);
});

test("falls back to the stream when the body carries no level", () => {
  const stderr = deriveSeverity("no level here", "stderr");

  assert.equal(stderr.text, "ERROR");
  assert.equal(stderr.parsed, false);
});
