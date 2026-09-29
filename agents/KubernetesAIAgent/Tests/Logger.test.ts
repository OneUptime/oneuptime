import { captureLogs, CapturedLogs } from "./Helpers/TestSupport";
import assert from "assert";
import { test } from "node:test";
import Logger, { LogRecord, parseLogLevel } from "../Logger";

test("parseLogLevel falls back to info", () => {
  assert.strictEqual(parseLogLevel("debug"), "debug");
  assert.strictEqual(parseLogLevel(" WARN "), "warn");
  assert.strictEqual(parseLogLevel("verbose"), "info");
  assert.strictEqual(parseLogLevel(undefined), "info");
});

test("records are JSON-ready objects with level, message, time and extra fields", () => {
  const logs: CapturedLogs = captureLogs();

  Logger.warn("something happened", { jobId: "job-1" });
  logs.restore();

  const [record] = logs.records as Array<LogRecord>;
  assert.strictEqual(record!.level, "warn");
  assert.strictEqual(record!.message, "something happened");
  assert.strictEqual(record!["jobId"], "job-1");
  assert.ok(!Number.isNaN(Date.parse(record!.ts)));
});

test("extra fields cannot overwrite the level or message", () => {
  const logs: CapturedLogs = captureLogs();

  Logger.info("real message", { level: "error", message: "fake" });
  logs.restore();

  assert.strictEqual(logs.records[0]!.level, "info");
  assert.strictEqual(logs.records[0]!.message, "real message");
});

test("the level filters what is emitted", () => {
  const logs: CapturedLogs = captureLogs();

  Logger.setLevel("warn");
  Logger.debug("no");
  Logger.info("no");
  Logger.warn("yes");
  Logger.error("yes");
  Logger.setLevel("silent");
  Logger.error("no");
  logs.restore();

  assert.deepStrictEqual(logs.messages(), ["yes", "yes"]);
});
