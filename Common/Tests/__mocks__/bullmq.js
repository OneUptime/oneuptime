/*
 * bullmq ships ESM and pulls in msgpackr, which is also ESM. Neither is listed
 * in transformIgnorePatterns, so the moment any module under test reaches
 * Server/Infrastructure/Queue the suite dies before a single test runs with
 * "SyntaxError: Unexpected token 'export'" pointing at msgpackr/index.js.
 *
 * That import edge is not exotic: enqueueing a job is ordinary service code, so
 * any service that schedules background work drags bullmq into the graph of
 * every test that touches it, however indirectly. Mapping the package here -
 * the same mechanism this config already uses for uuid, yaml, locter, otpauth
 * and friends - fixes it once for every current and future test, instead of
 * making each one repeat a hoisted jest.mock factory.
 *
 * The surface below is only what the real Queue wrapper calls. A test that
 * needs to assert on queue behaviour should still declare its own
 * jest.mock("bullmq", ...) with a richer factory, which takes precedence over
 * this mapping - Common/Tests/Server/Infrastructure/Queue.test.ts does exactly
 * that.
 */

class Queue {
  constructor() {
    this.add = jest.fn().mockResolvedValue({});
    this.getRepeatableJobs = jest.fn().mockResolvedValue([]);
    this.removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    this.getJob = jest.fn().mockResolvedValue(undefined);
    this.clean = jest.fn().mockResolvedValue([]);
    this.close = jest.fn().mockResolvedValue(undefined);
    this.client = Promise.resolve({ on: jest.fn() });
  }
}

class Worker {
  constructor() {
    this.on = jest.fn();
    this.close = jest.fn().mockResolvedValue(undefined);
  }
}

class QueueEvents {
  constructor() {
    this.on = jest.fn();
    this.close = jest.fn().mockResolvedValue(undefined);
  }
}

class Job {}

module.exports = {
  __esModule: true,
  Queue,
  Worker,
  QueueEvents,
  Job,
};
