import {
  CapturedLogs,
  captureLogs,
  eventually,
  recordingSleep,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import { AddressInfo } from "net";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import ResourceAiAgent from "../Agent";
import AgentStatus, { AgentStatusSnapshot } from "../AgentStatus";
import { AgentConfig, ParsedConfig, parseConfig } from "../Config";
import PrepareGuard, { GuardResult } from "../Executors/PrepareGuard";
import {
  ExecutorOptions,
  ResourceExecutor,
} from "../Executors/ResourceExecutor";
import { AgentPosture, buildPosture, normalizeProbe } from "../Posture";
import FakeBinary, { makeTempDir } from "./Helpers/FakeBinary";
import FakeExecutor, {
  DEFAULT_FAKE_PROBE,
  fakePolicy,
} from "./Helpers/FakeExecutor";
import FakeOneUptime, { testPayload } from "./Helpers/FakeOneUptime";
import {
  ResourceAiAgentPosture,
  ResourceCommandTier,
  parseResourceAiAgentPosture,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * "These options should depend on the agent itself ... You can have a
 * values.yaml for the agent which says what level of fixes you need."
 *
 * A resource AI agent takes ONEUPTIME_AI_INVESTIGATION and
 * ONEUPTIME_AI_FIXES from the .env it shares with its collector, reports
 * them on registration and every heartbeat (the posture's aiSettings) so
 * OneUptime applies them to the resource, shows them on /status, and —
 * with fixes off — refuses every write itself. An agent whose .env names
 * neither reports its defaults with isConfigured false: OneUptime applies
 * those only to a resource whose settings nobody chose on its AI agent
 * page.
 */

const URL: string = "https://oneuptime.example.com";

const VALID: Record<string, string> = {
  ONEUPTIME_URL: URL,
  ONEUPTIME_SERVICE_TOKEN: "ingestion-key",
  ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
  DOCKER_HOST_NAME: "web-host-1",
};

function parse(env: Record<string, string | undefined>): ParsedConfig {
  return parseConfig({ ...VALID, ...env });
}

describe("reading the settings from the .env", () => {
  test("an .env that names neither reports the defaults, unconfigured, and the write switch alone decides", () => {
    const parsed: ParsedConfig = parse({ ONEUPTIME_AI_ALLOW_WRITES: "true" });

    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: true,
      fixes: "RequireApproval",
      isConfigured: false,
    });
    assert.deepStrictEqual(parse({}).config.aiSettings, {
      investigation: true,
      fixes: "Disabled",
      isConfigured: false,
    });
    assert.strictEqual(parsed.config.allowWrites, true);
    assert.strictEqual(parsed.config.writesOffByFixes, false);
    assert.deepStrictEqual(parsed.warnings, []);
  });

  test("every fixes level the dialog offers is read", () => {
    const cases: Array<[string, string]> = [
      ["off", "Disabled"],
      ["ask-for-approval", "RequireApproval"],
      ["automatic", "Automatic"],
      ["bypass-approval", "BypassApproval"],
    ];

    for (const [setting, mode] of cases) {
      const parsed: ParsedConfig = parse({
        ONEUPTIME_AI_INVESTIGATION: "true",
        ONEUPTIME_AI_FIXES: setting,
        ONEUPTIME_AI_ALLOW_WRITES: setting === "off" ? "false" : "true",
      });

      assert.deepStrictEqual(
        parsed.config.aiSettings,
        { investigation: true, fixes: mode, isConfigured: true },
        setting,
      );
      assert.strictEqual(parsed.config.allowWrites, setting !== "off");
      assert.deepStrictEqual(parsed.warnings, [], setting);
    }
  });

  test("investigation off, on its own", () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_INVESTIGATION: "false" }).config.aiSettings,
      { investigation: false, fixes: "Disabled", isConfigured: true },
    );
  });

  test("unset fixes follow the write switch once either setting is named", () => {
    assert.deepStrictEqual(
      parse({
        ONEUPTIME_AI_INVESTIGATION: "true",
        ONEUPTIME_AI_ALLOW_WRITES: "true",
      }).config.aiSettings,
      { investigation: true, fixes: "RequireApproval", isConfigured: true },
    );
  });

  test("a value the agent cannot read fails closed, and the agent stays read-only", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_INVESTIGATION: "maybe",
      ONEUPTIME_AI_FIXES: "yolo",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });

    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: false,
      fixes: "Disabled",
      isConfigured: true,
    });
    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.warnings.length >= 2, true);
  });

  test("fixes off override the write switch; fixes on without it say no fix can run", () => {
    const off: ParsedConfig = parse({
      ONEUPTIME_AI_FIXES: "off",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });
    assert.strictEqual(off.config.allowWrites, false);
    assert.strictEqual(off.config.writesOffByFixes, true);

    const noSwitch: ParsedConfig = parse({ ONEUPTIME_AI_FIXES: "automatic" });
    assert.strictEqual(noSwitch.config.allowWrites, false);
    assert.ok(
      noSwitch.warnings.some((warning: string): boolean => {
        return (
          warning.includes("ONEUPTIME_AI_ALLOW_WRITES") &&
          warning.includes("no fix can run")
        );
      }),
    );
  });

  test("a write-target list over the bounds still keeps the agent read-only", () => {
    const targets: string = Array.from(
      { length: 65 },
      (_: unknown, i: number) => {
        return `t-${i}`;
      },
    ).join(",");
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_FIXES: "automatic",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: targets,
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: true,
      fixes: "Automatic",
      isConfigured: true,
    });
  });
});

describe("the posture carries what the .env allows", () => {
  function postureFor(env: Record<string, string>): AgentPosture {
    const config: AgentConfig = testConfig(URL, env);

    return buildPosture({
      config,
      resourceType: config.resourceType!,
      resourceIdentifier: config.resourceIdentifier || "web-host-1",
      probe: normalizeProbe({ ...DEFAULT_FAKE_PROBE }),
      now: new Date("2026-10-05T08:00:00.000Z"),
    });
  }

  test("named settings are sent, and OneUptime's own parser reads them back", () => {
    const sent: AgentPosture = postureFor({
      ONEUPTIME_AI_INVESTIGATION: "true",
      ONEUPTIME_AI_FIXES: "bypass-approval",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });

    assert.deepStrictEqual(sent.aiSettings, {
      investigation: true,
      fixes: "BypassApproval",
      isConfigured: true,
    });

    const read: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
      JSON.parse(JSON.stringify(sent)),
    );
    assert.deepStrictEqual(read?.aiSettings, {
      investigation: true,
      fixes: "BypassApproval",
      isConfigured: true,
    });
  });

  test("an .env that names neither sends the defaults, marked unconfigured", () => {
    const sent: AgentPosture = postureFor({});
    const expected: Record<string, unknown> = {
      investigation: true,
      fixes: "Disabled",
      isConfigured: false,
    };

    assert.deepStrictEqual(sent.aiSettings, expected);
    assert.deepStrictEqual(
      parseResourceAiAgentPosture(JSON.parse(JSON.stringify(sent)))?.aiSettings,
      expected,
    );
  });

  test("/status shows them as the .env spells them", () => {
    const status: AgentStatus = new AgentStatus();
    status.posture = postureFor({
      ONEUPTIME_AI_INVESTIGATION: "true",
      ONEUPTIME_AI_FIXES: "automatic",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });

    const snapshot: AgentStatusSnapshot = status.snapshot();
    assert.strictEqual(snapshot.aiInvestigation, true);
    assert.strictEqual(snapshot.aiFixes, "automatic");
    assert.strictEqual(snapshot.aiSettingsConfigured, true);

    status.posture = postureFor({});
    assert.strictEqual(status.snapshot().aiFixes, "off");
    assert.strictEqual(status.snapshot().aiSettingsConfigured, false);

    status.posture = null;
    assert.strictEqual(status.snapshot().aiInvestigation, null);
    assert.strictEqual(status.snapshot().aiFixes, null);
    assert.strictEqual(status.snapshot().aiSettingsConfigured, null);
  });
});

describe("the agent refuses writes while fixes are off", () => {
  const POLICY: ReturnType<typeof fakePolicy> = fakePolicy({
    "docker ps": ResourceCommandTier.Read,
    "docker restart web-1": ResourceCommandTier.SafeWrite,
  });

  function check(
    env: Record<string, string>,
    argv: Array<string>,
    origin: "AiInvestigation" | "AiRemediation",
  ): GuardResult {
    return PrepareGuard.check({
      config: testConfig(URL, env),
      request: {
        payload: testPayload({
          program: argv[0],
          args: argv.slice(1),
          displayCommand: argv.join(" "),
          tier:
            argv[1] === "ps"
              ? ResourceCommandTier.Read
              : ResourceCommandTier.SafeWrite,
        }),
        origin,
        timeoutInMs: 30_000,
      },
      policy: POLICY,
    });
  }

  test("a fix is refused with a reason that names ONEUPTIME_AI_FIXES, not the write switch", () => {
    const result: GuardResult = check(
      { ONEUPTIME_AI_FIXES: "off", ONEUPTIME_AI_ALLOW_WRITES: "true" },
      ["docker", "restart", "web-1"],
      "AiRemediation",
    );

    assert.ok(result.refusal);
    assert.match(
      result.refusal!,
      /AI fixes are off in this agent's configuration \(ONEUPTIME_AI_FIXES=off\)/,
    );
    assert.match(result.refusal!, /ONEUPTIME_AI_FIXES=ask-for-approval/);
    assert.ok(!result.refusal!.includes("this agent is read-only"));
  });

  test("with fixes on and the write switch on, the same fix passes the guard", () => {
    const result: GuardResult = check(
      { ONEUPTIME_AI_FIXES: "automatic", ONEUPTIME_AI_ALLOW_WRITES: "true" },
      ["docker", "restart", "web-1"],
      "AiRemediation",
    );

    assert.strictEqual(result.refusal, null);
  });

  test("reads still run with fixes off", () => {
    const result: GuardResult = check(
      { ONEUPTIME_AI_FIXES: "off" },
      ["docker", "ps"],
      "AiInvestigation",
    );

    assert.strictEqual(result.refusal, null);
  });
});

describe("the whole agent reports them on registration and every heartbeat", () => {
  let server: FakeOneUptime;
  let docker: FakeBinary;
  let tmpDir: string;
  let logs: CapturedLogs;
  const agents: Array<ResourceAiAgent> = [];

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
    docker = new FakeBinary("docker");
  });

  after(async (): Promise<void> => {
    await server.stop();
    docker.cleanup();
  });

  beforeEach((): void => {
    server.reset();
    docker.setBehaviour({ stdout: "web-1\n" });
    tmpDir = makeTempDir("agent-ai-settings-");
    logs = captureLogs();
  });

  afterEach(async (): Promise<void> => {
    for (const agent of agents.splice(0)) {
      await agent.shutdown("test");
    }
    logs.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createAgent(env: Record<string, string>): ResourceAiAgent {
    const agent: ResourceAiAgent = new ResourceAiAgent({
      env: {
        PATH: docker.getPath(),
        ONEUPTIME_URL: server.url,
        ONEUPTIME_SERVICE_TOKEN: "ingestion-key-1",
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
        DOCKER_HOST_NAME: "web-host-1",
        APP_VERSION: "14.0.15",
        ...env,
      },
      tmpDir,
      healthPort: 0,
      healthHost: "127.0.0.1",
      sleep: recordingSleep().sleep,
      enableProxy: false,
      createExecutor: (options: ExecutorOptions): ResourceExecutor => {
        return new FakeExecutor(options, {
          guardPolicy: fakePolicy({ "docker ps": ResourceCommandTier.Read }),
          spawnBinary: "docker",
        });
      },
    });
    agents.push(agent);
    return agent;
  }

  test("the .env's settings reach OneUptime with the posture, and the heartbeat repeats them", async () => {
    const agent: ResourceAiAgent = createAgent({
      ONEUPTIME_AI_INVESTIGATION: "false",
      ONEUPTIME_AI_FIXES: "ask-for-approval",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    });

    await agent.start();
    const [registration] = await server.waitFor("/register");

    assert.deepStrictEqual(
      (registration!.body["posture"] as Record<string, unknown>)["aiSettings"],
      { investigation: false, fixes: "RequireApproval", isConfigured: true },
    );

    await eventually((): boolean => {
      return Boolean(agent.getSession()?.getIdentity());
    });
    await agent.getHeartbeat()!.tick();

    const [heartbeat] = server.requestsTo("/heartbeat");
    assert.deepStrictEqual(
      (heartbeat!.body["posture"] as Record<string, unknown>)["aiSettings"],
      { investigation: false, fixes: "RequireApproval", isConfigured: true },
    );

    const port: number = (agent.getHealthServer()!.address() as AddressInfo)
      .port;
    const snapshot: AgentStatusSnapshot = (await (
      await fetch(`http://127.0.0.1:${port}/status`)
    ).json()) as AgentStatusSnapshot;
    assert.strictEqual(snapshot.aiInvestigation, false);
    assert.strictEqual(snapshot.aiFixes, "ask-for-approval");
  });

  test("an .env that names neither registers its defaults, unconfigured, and says what that means", async () => {
    const agent: ResourceAiAgent = createAgent({});

    await agent.start();
    const [registration] = await server.waitFor("/register");

    assert.deepStrictEqual(
      (registration!.body["posture"] as Record<string, unknown>)["aiSettings"],
      { investigation: true, fixes: "Disabled", isConfigured: false },
    );
    await eventually((): boolean => {
      return logs.records.some((record: Record<string, unknown>): boolean => {
        return (
          String(record["message"]).startsWith("What OneUptime AI may do on") &&
          String(record["setBy"]).includes("AI agent page keeps them")
        );
      });
    });
  });
});
