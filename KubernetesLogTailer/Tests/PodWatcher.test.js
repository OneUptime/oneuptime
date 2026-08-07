// Config reads these at require time; PodWatcher pulls NODE_OS_INCLUDE from it.
process.env.ONEUPTIME_URL = "http://test.invalid";
process.env.ONEUPTIME_API_KEY = "test-key";
process.env.CLUSTER_NAME = "test-cluster";
process.env.NODE_OS_INCLUDE = "windows";
process.env.LOG_LEVEL = "error";

const assert = require("node:assert/strict");
const test = require("node:test");
const PodWatcherModule = require("../build/dist/PodWatcher");

const PodWatcher = PodWatcherModule.PodWatcher;

const makePod = (uid, nodeName) => {
  return {
    metadata: { name: `pod-${uid}`, namespace: "default", uid },
    spec: { nodeName, containers: [{ name: "app" }] },
    status: {},
  };
};

/*
 * Regression test: a pod parked for an unresolvable node (e.g. the node was
 * deleted from the cluster, so readNode 404s forever) and then deleted must
 * tear down its parked entry AND end the 30s readNode retry loop — an empty
 * parked map used to keep the retry alive for the life of the process.
 */
test("deleting the last parked pod ends the node-OS retry loop", async () => {
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    timers.push(fn);
    return { unref: () => {} };
  };

  try {
    let readNodeCalls = 0;
    const fakeCoreApi = {
      readNode: () => {
        readNodeCalls++;
        return Promise.reject(new Error("nodes \"gone-node\" not found"));
      },
    };
    const fakeKubeConfig = { makeApiClient: () => fakeCoreApi };
    const watcher = new PodWatcher(fakeKubeConfig, {});
    const flush = () => {
      return new Promise((resolve) => {
        setImmediate(resolve);
      });
    };

    // Pod arrives on an unknown node: parked, one failed read, one retry armed.
    watcher["handleAddOrUpdate"](makePod("u1", "gone-node"));
    await flush();
    assert.equal(readNodeCalls, 1);
    assert.equal(timers.length, 1);
    assert.equal(watcher["parkedByNode"].get("gone-node").size, 1);

    // The pod is deleted while parked: the whole node entry must go with it.
    watcher["handleDelete"](makePod("u1", "gone-node"));
    assert.equal(watcher["parkedByNode"].has("gone-node"), false);

    // The armed retry fires: nothing waits, so no new read and no new timer.
    timers[0]();
    await flush();
    assert.equal(readNodeCalls, 1);
    assert.equal(timers.length, 1);

    // A new pod on the same node parks and resolves afresh — no stall.
    watcher["handleAddOrUpdate"](makePod("u2", "gone-node"));
    await flush();
    assert.equal(readNodeCalls, 2);
    assert.equal(timers.length, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
