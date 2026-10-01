import { CapturedLogs, captureLogs } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, test } from "node:test";
import ResourceAiAgent from "../Agent";
import {
  DEFAULT_HEALTH_HOST,
  HEALTH_HOST_ENV,
  ParsedConfig,
  parseConfig,
  parseHealthHost,
} from "../Config";
import { ExecutorOptions } from "../Executors/ResourceExecutor";
import UnavailableExecutor from "../Executors/UnavailableExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";

/*
 * Regression: the health server listened on every address. The Host AI
 * agent runs on the host's network (network_mode: host), and so does a
 * Ceph or database agent whose network_mode: host is uncommented, so
 * anyone who could reach port 3877 on the host could read /status: the
 * agent id, the resource, the write switch and targets, the protected
 * targets, the running job and the last errors. Every documented check
 * (the compose healthcheck, `docker exec ... wget 127.0.0.1`, `curl
 * 127.0.0.1` on the host) uses loopback, so that is the default now.
 */

describe("parseHealthHost", () => {
  test("loopback when unset or blank", () => {
    assert.strictEqual(DEFAULT_HEALTH_HOST, "127.0.0.1");
    assert.deepStrictEqual(parseHealthHost(undefined), {
      host: "127.0.0.1",
      problem: null,
    });
    assert.deepStrictEqual(parseHealthHost("  "), {
      host: "127.0.0.1",
      problem: null,
    });
  });

  test("any IPv4 or IPv6 address, brackets allowed", () => {
    for (const [value, host] of [
      ["0.0.0.0", "0.0.0.0"],
      [" 10.0.0.5 ", "10.0.0.5"],
      ["::", "::"],
      ["[::1]", "::1"],
      ["fe80::1", "fe80::1"],
    ] as Array<[string, string]>) {
      assert.deepStrictEqual(parseHealthHost(value), { host, problem: null });
    }
  });

  test("anything else stays on loopback, and says so", () => {
    for (const value of ["localhost", "all", "0.0.0.0:3877", "*"]) {
      const parsed: { host: string; problem: string | null } =
        parseHealthHost(value);

      assert.strictEqual(parsed.host, "127.0.0.1", value);
      assert.ok(parsed.problem, value);
      assert.ok(parsed.problem.startsWith(`${HEALTH_HOST_ENV}="${value}"`));
    }
  });

  test("parseConfig: the default, a setting, and a warning for nonsense", () => {
    assert.strictEqual(parseConfig({}).config.healthHost, "127.0.0.1");
    assert.strictEqual(
      parseConfig({ [HEALTH_HOST_ENV]: "0.0.0.0" }).config.healthHost,
      "0.0.0.0",
    );

    const parsed: ParsedConfig = parseConfig({ [HEALTH_HOST_ENV]: "all" });
    assert.strictEqual(parsed.config.healthHost, "127.0.0.1");
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return warning.startsWith(`${HEALTH_HOST_ENV}="all"`);
      }),
    );
  });
});

describe("the agent's health server", () => {
  let tmpDir: string;
  let logs: CapturedLogs;
  let agent: ResourceAiAgent | null = null;

  beforeEach((): void => {
    tmpDir = makeTempDir("health-host-");
    logs = captureLogs();
  });

  afterEach(async (): Promise<void> => {
    if (agent) {
      await agent.shutdown("test");
      agent = null;
    }
    logs.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function listeningAddress(
    env: NodeJS.ProcessEnv,
  ): Promise<AddressInfo> {
    agent = new ResourceAiAgent({
      env,
      tmpDir,
      healthPort: 0,
      enableProxy: false,
      shutdownGraceMs: 0,
      createExecutor: (options: ExecutorOptions): UnavailableExecutor => {
        return new UnavailableExecutor(options);
      },
    });

    await agent.start();

    return agent.getHealthServer()!.address() as AddressInfo;
  }

  test("listens on loopback only unless told otherwise", async () => {
    assert.strictEqual((await listeningAddress({})).address, "127.0.0.1");
  });

  test(`${HEALTH_HOST_ENV}=0.0.0.0 serves it on every interface`, async () => {
    assert.strictEqual(
      (await listeningAddress({ [HEALTH_HOST_ENV]: "0.0.0.0" })).address,
      "0.0.0.0",
    );
  });
});
