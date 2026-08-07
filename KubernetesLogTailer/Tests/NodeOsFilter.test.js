const assert = require("node:assert/strict");
const test = require("node:test");
const NodeOsFilterModule = require("../build/dist/NodeOsFilter");

const NodeOsFilter = NodeOsFilterModule.default;

const readerFromMap = (map, calls) => {
  return (nodeName) => {
    if (calls) {
      calls.push(nodeName);
    }
    if (nodeName in map) {
      return Promise.resolve(map[nodeName]);
    }
    return Promise.reject(new Error(`node ${nodeName} not found`));
  };
};

test("an empty include list is inactive and allows every node", () => {
  const filter = new NodeOsFilter([], readerFromMap({}));

  assert.equal(filter.isActive(), false);
  assert.equal(filter.lookup("any-node"), "allowed");
  assert.equal(filter.lookup(""), "allowed");
});

test("blank include entries are dropped, keeping the filter inactive", () => {
  const filter = new NodeOsFilter(["", "  "], readerFromMap({}));

  assert.equal(filter.isActive(), false);
});

test("lookup answers unknown before resolve and a verdict after", async () => {
  const filter = new NodeOsFilter(
    ["windows"],
    readerFromMap({ win1: "windows", lin1: "linux" }),
  );

  assert.equal(filter.lookup("win1"), "unknown");
  assert.equal(await filter.resolve("win1"), true);
  assert.equal(filter.lookup("win1"), "allowed");

  assert.equal(await filter.resolve("lin1"), true);
  assert.equal(filter.lookup("lin1"), "denied");
});

test("matching is case-insensitive on both sides", async () => {
  const filter = new NodeOsFilter(
    ["Windows"],
    readerFromMap({ win1: "WINDOWS" }),
  );

  await filter.resolve("win1");
  assert.equal(filter.lookup("win1"), "allowed");
});

test("a node missing the os label caches as denied", async () => {
  const calls = [];
  const filter = new NodeOsFilter(
    ["windows"],
    readerFromMap({ old1: "" }, calls),
  );

  assert.equal(await filter.resolve("old1"), true);
  assert.equal(filter.lookup("old1"), "denied");

  // Cached: a second resolve must not hit the reader again.
  assert.equal(await filter.resolve("old1"), true);
  assert.equal(calls.length, 1);
});

test("a failed read is not cached and can be retried", async () => {
  const calls = [];
  const map = {};
  const filter = new NodeOsFilter(["windows"], readerFromMap(map, calls));

  assert.equal(await filter.resolve("flaky"), false);
  assert.equal(filter.lookup("flaky"), "unknown");

  // The node becomes readable; the retry succeeds and caches.
  map["flaky"] = "windows";
  assert.equal(await filter.resolve("flaky"), true);
  assert.equal(filter.lookup("flaky"), "allowed");
  assert.equal(calls.length, 2);
});

test("concurrent resolves for one node share a single read", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const filter = new NodeOsFilter(["windows"], (nodeName) => {
    calls.push(nodeName);
    return gate.then(() => {
      return "windows";
    });
  });

  const first = filter.resolve("win1");
  const second = filter.resolve("win1");
  release();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls.length, 1);
  assert.equal(filter.lookup("win1"), "allowed");
});
