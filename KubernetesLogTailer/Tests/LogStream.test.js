process.env.ONEUPTIME_URL = "http://test.invalid";
process.env.ONEUPTIME_API_KEY = "test-key";
process.env.CLUSTER_NAME = "test-cluster";
process.env.LOG_LEVEL = "error";

const assert = require("node:assert/strict");
const test = require("node:test");
const { LogStream } = require("../build/dist/LogStream");

const context = {
  namespace: "payments",
  podName: "api-123",
  podUID: "pod-uid",
  containerName: "api",
  nodeName: "worker-1",
  labels: { app: "api" },
  serviceName: "api",
};

const flush = () => {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
};

test("uses the v2 log options and aborts an active stream on stop", async () => {
  const controller = new AbortController();
  const calls = [];
  const logClient = {
    log: async (...args) => {
      calls.push(args);
      return controller;
    },
  };
  const stream = new LogStream({}, context, { enqueue: () => {} }, logClient);

  stream.start();
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "payments");
  assert.equal(calls[0][1], "api-123");
  assert.equal(calls[0][2], "api");
  assert.deepEqual(calls[0][4], {
    follow: true,
    timestamps: true,
    sinceSeconds: 10,
  });
  assert.equal(controller.signal.aborted, false);

  stream.stop();
  assert.equal(controller.signal.aborted, true);
});

test("aborts a stream that resolves after stop", async () => {
  const controller = new AbortController();
  let resolveRequest;
  const logClient = {
    log: () => {
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  };
  const stream = new LogStream({}, context, { enqueue: () => {} }, logClient);

  stream.start();
  await flush();
  stream.stop();
  resolveRequest(controller);
  await flush();

  assert.equal(controller.signal.aborted, true);
});
