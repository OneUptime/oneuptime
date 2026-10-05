import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import { AgentConfig } from "../Config";
import {
  ExecutorOptions,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import {
  AgentPosture,
  DEFAULT_PROBE_REFRESH_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  NormalizedProbe,
  PostureProbe,
  buildPosture,
  normalizeProbe,
} from "../Posture";
import FakeExecutor, { DEFAULT_FAKE_PROBE } from "./Helpers/FakeExecutor";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAgentPosture,
  parseResourceAiAgentPosture,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

const URL: string = "https://oneuptime.example.com";
const NOW: Date = new Date("2026-09-29T08:00:00.000Z");

function probe(overrides: Partial<NormalizedProbe> = {}): NormalizedProbe {
  return normalizeProbe({ ...DEFAULT_FAKE_PROBE, ...overrides });
}

function posture(
  env: Record<string, string> = {},
  probeOverrides: Partial<NormalizedProbe> = {},
): AgentPosture {
  const config: AgentConfig = testConfig(URL, env);

  return buildPosture({
    config,
    resourceType: config.resourceType!,
    resourceIdentifier: config.resourceIdentifier || "resolved-name",
    probe: probe(probeOverrides),
    now: NOW,
  });
}

function executorOptions(): ExecutorOptions {
  return {
    config: testConfig(URL),
    env: {},
    tmpDir: "/tmp",
    logger: recordingLogger(),
  };
}

describe("the reported posture", () => {
  test("read-only by default, with every field the server reads", () => {
    assert.deepStrictEqual(posture(), {
      resourceType: "DockerHost",
      resourceIdentifier: "web-host-1",
      agentVersion: "14.0.8",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: ["oneuptime-docker-ai-agent"],
      toolVersion: "29.4.3",
      reachable: true,
      details: { engine: "docker" },
      reportedAt: "2026-09-29T08:00:00.000Z",
      aiSettings: {
        investigation: true,
        fixes: "Disabled",
        isConfigured: false,
      },
    });
  });

  test("the server's own parser reads it back unchanged", () => {
    const sent: AgentPosture = posture({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: "web-*",
    });
    const read: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      JSON.parse(JSON.stringify(sent)),
    );

    assert.ok(read);
    assert.strictEqual(read.allowWrites, true);
    assert.deepStrictEqual(read.writeTargets, ["web-*"]);
    assert.deepStrictEqual(read.protectedTargets, sent.protectedTargets);
    assert.strictEqual(read.resourceIdentifier, "web-host-1");
    assert.strictEqual(read.reportedAt, sent.reportedAt);
  });

  test("writes, their targets and the raw switch as configured", () => {
    const writable: AgentPosture = posture({
      ONEUPTIME_AI_ALLOW_WRITES: "TRUE",
      ONEUPTIME_AI_WRITE_TARGETS: "web-*,api",
    });

    assert.strictEqual(writable.allowWrites, true);
    assert.strictEqual(writable.allowWritesSetting, "TRUE");
    assert.deepStrictEqual(writable.writeTargets, ["web-*", "api"]);

    const typo: AgentPosture = posture({ ONEUPTIME_AI_ALLOW_WRITES: "yes" });
    assert.strictEqual(typo.allowWrites, false);
    assert.strictEqual(typo.allowWritesSetting, "yes");
  });

  test("configured and probed protected targets are merged without duplicates", () => {
    assert.deepStrictEqual(
      posture(
        {
          ONEUPTIME_AI_PROTECTED_TARGETS: "traefik, oneuptime-docker-ai-agent",
        },
        {
          protectedTargets: [
            "oneuptime-docker-ai-agent",
            "oneuptime-docker-agent",
          ],
        },
      ).protectedTargets,
      ["traefik", "oneuptime-docker-ai-agent", "oneuptime-docker-agent"],
    );
  });

  test("too many protected targets in all: reported read-only, as the server would read it", () => {
    const many: Array<string> = Array.from(
      { length: 70 },
      (_: unknown, i: number): string => {
        return `c-${i}`;
      },
    );
    const sent: AgentPosture = posture(
      { ONEUPTIME_AI_ALLOW_WRITES: "true" },
      { protectedTargets: many },
    );

    assert.strictEqual(sent.allowWrites, false);
    assert.strictEqual(sent.protectedTargets.length, 64);
  });

  test("an unreachable resource carries the reason; a reachable one none", () => {
    const down: AgentPosture = posture(
      {},
      { reachable: false, reachError: "Cannot connect to the Docker daemon" },
    );
    assert.strictEqual(down.reachable, false);
    assert.strictEqual(down.reachError, "Cannot connect to the Docker daemon");
    assert.strictEqual("reachError" in posture(), false);
  });

  test("the configuration's identity facts win over the executor's details", () => {
    const sent: AgentPosture = posture(
      {
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
        DATABASE_SYSTEM: "postgresql",
        DATABASE_SERVER_ADDRESS: "orders-db.internal",
        DATABASE_SERVER_PORT: "5432",
      },
      {
        details: {
          serverAddress: "something-else",
          databaseSystem: "postgresql",
          maxConnections: 100,
        },
      },
    );

    assert.strictEqual(sent.resourceType, AiResourceType.DatabaseServer);
    assert.strictEqual(
      sent.resourceIdentifier,
      "postgresql|orders-db.internal:5432",
    );
    assert.deepStrictEqual(sent.details, {
      serverAddress: "orders-db.internal",
      databaseSystem: "postgresql",
      maxConnections: 100,
      serverPort: 5432,
    });
  });

  test("unknown fields are left out", () => {
    const sent: AgentPosture = posture(
      { APP_VERSION: "" },
      { toolVersion: null },
    );

    assert.strictEqual("agentVersion" in sent, false);
    assert.strictEqual("toolVersion" in sent, false);
    assert.strictEqual("allowWritesSetting" in sent, false);
  });
});

describe("normalizeProbe", () => {
  test("whatever an executor returns becomes well-formed fields", () => {
    assert.deepStrictEqual(normalizeProbe(null), {
      toolVersion: null,
      reachable: false,
      reachError: "The agent could not tell whether it can reach the resource.",
      details: {},
      protectedTargets: [],
    });

    assert.deepStrictEqual(
      normalizeProbe({
        toolVersion: `  ${"v".repeat(300)}  `,
        reachable: "yes",
        reachError: "  ",
        details: {
          ok: "x",
          n: 3,
          nan: Number.NaN,
          flag: true,
          none: null,
          nested: { a: 1 },
          list: [1],
        },
        protectedTargets: [" a ", 5, "", "a", "x".repeat(300)],
      }),
      {
        toolVersion: "v".repeat(256),
        reachable: false,
        reachError:
          "The agent could not tell whether it can reach the resource.",
        details: { ok: "x", n: 3, flag: true, none: null },
        protectedTargets: ["a"],
      },
    );
  });

  test("a reachable probe carries no error", () => {
    assert.strictEqual(
      normalizeProbe({ reachable: true, reachError: "stale" }).reachError,
      null,
    );
  });
});

describe("PostureProbe", () => {
  test("probes once, then reuses the answer until it is stale", async () => {
    const executor: FakeExecutor = new FakeExecutor(executorOptions());
    let now: number = 1_000_000;
    const postureProbe: PostureProbe = new PostureProbe({
      executor,
      refreshMs: 60_000,
      nowMs: (): number => {
        return now;
      },
    });

    assert.strictEqual(postureProbe.getLast(), null);
    const first: NormalizedProbe = await postureProbe.get();
    await postureProbe.get();
    assert.strictEqual(executor.probes, 1);
    assert.strictEqual(first.toolVersion, "29.4.3");
    assert.strictEqual(postureProbe.getLast(), first);

    now += 60_001;
    await postureProbe.get();
    assert.strictEqual(executor.probes, 2);

    postureProbe.invalidate();
    await postureProbe.get();
    assert.strictEqual(executor.probes, 3);
  });

  test("concurrent callers share one probe", async () => {
    let release: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        release = resolve;
      },
    );
    const executor: FakeExecutor = new FakeExecutor(executorOptions(), {
      probe: async (): Promise<ResourcePostureProbe> => {
        await gate;
        return DEFAULT_FAKE_PROBE;
      },
    });
    const postureProbe: PostureProbe = new PostureProbe({ executor });

    const both: Promise<Array<NormalizedProbe>> = Promise.all([
      postureProbe.get(),
      postureProbe.get(),
    ]);
    release();
    const [a, b] = await both;

    assert.strictEqual(executor.probes, 1);
    assert.strictEqual(a, b);
  });

  test("a probe that throws or rejects is an unreachable resource, never an exception", async () => {
    const rejecting: PostureProbe = new PostureProbe({
      executor: new FakeExecutor(executorOptions(), {
        probe: (): Promise<ResourcePostureProbe> => {
          return Promise.reject(new Error("socket refused"));
        },
      }),
    });
    const rejected: NormalizedProbe = await rejecting.get();
    assert.strictEqual(rejected.reachable, false);
    assert.strictEqual(
      rejected.reachError,
      "Checking the resource failed: socket refused",
    );

    const throwingExecutor: FakeExecutor = new FakeExecutor(executorOptions());
    throwingExecutor.probePosture = (): never => {
      throw new Error("sync boom");
    };
    const thrown: NormalizedProbe = await new PostureProbe({
      executor: throwingExecutor,
    }).get();
    assert.strictEqual(
      thrown.reachError,
      "Checking the resource failed: sync boom",
    );
  });

  test("a probe that takes too long counts as unreachable", async () => {
    const slow: PostureProbe = new PostureProbe({
      executor: new FakeExecutor(executorOptions(), {
        probe: (): Promise<ResourcePostureProbe> => {
          return new Promise<ResourcePostureProbe>(
            (resolve: (value: ResourcePostureProbe) => void): void => {
              setTimeout((): void => {
                resolve(DEFAULT_FAKE_PROBE);
              }, 2_000).unref();
            },
          );
        },
      }),
      timeoutMs: 50,
    });

    const started: number = Date.now();
    const answer: NormalizedProbe = await slow.get();

    assert.ok(Date.now() - started < 1_000);
    assert.strictEqual(answer.reachable, false);
    assert.match(
      answer.reachError!,
      /took longer than 50ms, so it counts as unreachable for now/,
    );
  });

  test("the defaults: a minute between probes, 15 seconds for one", () => {
    assert.strictEqual(DEFAULT_PROBE_REFRESH_MS, 60_000);
    assert.strictEqual(DEFAULT_PROBE_TIMEOUT_MS, 15_000);
  });
});
