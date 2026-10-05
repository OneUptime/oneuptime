import {
  CapturedLogs,
  captureLogs,
  eventually,
  recordingSleep,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import { AddressInfo } from "net";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import KubernetesAiAgent, { AgentOptions } from "../Agent";
import AgentStatus, { AgentStatusSnapshot } from "../AgentStatus";
import { ParsedConfig, parseConfig } from "../Config";
import KubectlExecutor, {
  KubectlExecutorSettings,
  PreparedKubectlCommand,
} from "../KubectlExecutor";
import { AgentPosture, buildPosture } from "../Posture";
import FakeKubectl, {
  FakeServiceAccount,
  makeTempDir,
} from "./Helpers/FakeKubectl";
import FakeOneUptime from "./Helpers/FakeOneUptime";

/*
 * "These options should depend on the agent itself. If I say
 * investigation = true, the agent should be turned on automatically here.
 * The same with the fixes."
 *
 * The chart hands the agent ONEUPTIME_AI_INVESTIGATION and
 * ONEUPTIME_AI_FIXES (from aiAgent.investigation and aiAgent.fixes). The
 * agent reads them (Config), reports them on registration and every
 * heartbeat (the posture's aiSettings) so OneUptime applies them to the
 * cluster, shows them on /status, and — with fixes off — refuses every
 * write itself, whatever it is sent. A chart release that names neither
 * reports the agent's defaults with isConfigured false: OneUptime applies
 * those only to a cluster whose settings nobody chose on its AI agent page.
 */

const VALID: Record<string, string> = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_API_KEY: "ingestion-key",
  ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
};

function parse(env: Record<string, string | undefined>): ParsedConfig {
  return parseConfig({ ...VALID, ...env });
}

describe("reading the settings from the chart's environment", () => {
  test("a release that names neither reports the agent's defaults, unconfigured, and the write switch alone decides", () => {
    const readOnly: ParsedConfig = parse({});
    assert.deepStrictEqual(readOnly.config.aiSettings, {
      investigation: true,
      fixes: "Disabled",
      isConfigured: false,
    });
    assert.strictEqual(readOnly.config.allowWrites, false);
    assert.strictEqual(readOnly.config.writesOffByFixes, false);
    assert.deepStrictEqual(readOnly.warnings, []);

    // With write RBAC, the default is what OneUptime picked for such a cluster.
    const writing: ParsedConfig = parse({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });
    assert.deepStrictEqual(writing.config.aiSettings, {
      investigation: true,
      fixes: "RequireApproval",
      isConfigured: false,
    });
    assert.strictEqual(writing.config.allowWrites, true);
    assert.deepStrictEqual(writing.warnings, []);
  });

  test("empty and whitespace-only values count as not set", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_INVESTIGATION: " ",
      ONEUPTIME_AI_FIXES: "",
    });

    assert.strictEqual(parsed.config.aiSettings.isConfigured, false);
  });

  test("the chart's values are read: investigation on, each fixes level", () => {
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
        ONEUPTIME_KUBECTL_ALLOW_WRITES: setting === "off" ? "false" : "true",
      });

      assert.deepStrictEqual(parsed.config.aiSettings, {
        investigation: true,
        fixes: mode,
        isConfigured: true,
      });
      assert.strictEqual(parsed.config.allowWrites, setting !== "off");
      assert.deepStrictEqual(parsed.warnings, [], setting);
    }
  });

  test("investigation can be turned off on its own", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_INVESTIGATION: "false",
      ONEUPTIME_AI_FIXES: "off",
    });

    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: false,
      fixes: "Disabled",
      isConfigured: true,
    });
  });

  test("naming one setting configures both: investigation defaults on, fixes follow the write switch", () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_FIXES: "automatic" }).config.aiSettings,
      { investigation: true, fixes: "Automatic", isConfigured: true },
    );
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_INVESTIGATION: "true" }).config.aiSettings,
      { investigation: true, fixes: "Disabled", isConfigured: true },
    );
    assert.deepStrictEqual(
      parse({
        ONEUPTIME_AI_INVESTIGATION: "true",
        ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
      }).config.aiSettings,
      { investigation: true, fixes: "RequireApproval", isConfigured: true },
    );
  });

  test("spelling does not matter: case, spaces, underscores and the stored mode names", () => {
    for (const setting of [
      "Ask for approval",
      "ASK_FOR_APPROVAL",
      " RequireApproval ",
    ]) {
      assert.strictEqual(
        parse({
          ONEUPTIME_AI_FIXES: setting,
          ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
        }).config.aiSettings?.fixes,
        "RequireApproval",
        setting,
      );
    }

    assert.strictEqual(
      parse({ ONEUPTIME_AI_INVESTIGATION: " TRUE " }).config.aiSettings
        ?.investigation,
      true,
    );
  });

  test("a value the agent cannot read fails closed and says so once", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_INVESTIGATION: "yes",
      ONEUPTIME_AI_FIXES: "always",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });

    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: false,
      fixes: "Disabled",
      isConfigured: true,
    });
    // Fixes read as off, so the agent does not write either.
    assert.strictEqual(parsed.config.allowWrites, false);
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return (
          warning.includes('ONEUPTIME_AI_INVESTIGATION="yes"') &&
          warning.includes("stays off")
        );
      }),
      parsed.warnings.join("\n"),
    );
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return (
          warning.includes('ONEUPTIME_AI_FIXES="always"') &&
          warning.includes("off, ask-for-approval, automatic, bypass-approval")
        );
      }),
      parsed.warnings.join("\n"),
    );
  });

  test("fixes off keep the agent read-only even with the write switch on", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_FIXES: "off",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.writesOffByFixes, true);
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return warning.includes("the agent stays read-only");
      }),
    );
  });

  test("fixes on without the write switch say no fix can run", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_FIXES: "bypass-approval",
    });

    assert.deepStrictEqual(parsed.config.aiSettings, {
      investigation: true,
      fixes: "BypassApproval",
      isConfigured: true,
    });
    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.writesOffByFixes, false);
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return (
          warning.includes("ONEUPTIME_KUBECTL_ALLOW_WRITES") &&
          warning.includes("no fix can run")
        );
      }),
    );
  });
});

describe("the posture carries what the chart allows", () => {
  let serviceAccount: FakeServiceAccount;

  before((): void => {
    serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
  });

  after((): void => {
    serviceAccount.cleanup();
  });

  function postureFor(env: Record<string, string>): AgentPosture {
    return buildPosture({
      config: parse(env).config,
      env: { KUBERNETES_SERVICE_HOST: "10.96.0.1", KUBERNETES_SERVICE_PORT: "443" },
      serviceAccount: serviceAccount.paths(),
      kubectlVersion: "v1.36.4",
    });
  }

  test("named settings are sent as aiSettings", () => {
    const posture: AgentPosture = postureFor({
      ONEUPTIME_AI_INVESTIGATION: "true",
      ONEUPTIME_AI_FIXES: "automatic",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });

    assert.deepStrictEqual(posture.aiSettings, {
      investigation: true,
      fixes: "Automatic",
      isConfigured: true,
    });
    assert.strictEqual(posture.allowWrites, true);
  });

  test("a release that names neither sends the defaults, marked unconfigured", () => {
    const posture: AgentPosture = postureFor({});

    assert.deepStrictEqual(posture.aiSettings, {
      investigation: true,
      fixes: "Disabled",
      isConfigured: false,
    });
  });

  test("fixes off report read-only, so OneUptime never plans a write", () => {
    const posture: AgentPosture = postureFor({
      ONEUPTIME_AI_FIXES: "off",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
      ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS: "true",
    });

    assert.strictEqual(posture.allowWrites, false);
    assert.strictEqual(posture.allowNodeOperations, false);
    assert.deepStrictEqual(posture.aiSettings, {
      investigation: true,
      fixes: "Disabled",
      isConfigured: true,
    });
  });

  test("/status shows them as the chart spells them", () => {
    const status: AgentStatus = new AgentStatus();
    status.posture = postureFor({
      ONEUPTIME_AI_INVESTIGATION: "false",
      ONEUPTIME_AI_FIXES: "bypass-approval",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });

    const snapshot: AgentStatusSnapshot = status.snapshot();
    assert.strictEqual(snapshot.aiInvestigation, false);
    assert.strictEqual(snapshot.aiFixes, "bypass-approval");
    assert.strictEqual(snapshot.aiSettingsConfigured, true);

    status.posture = postureFor({});
    assert.strictEqual(status.snapshot().aiInvestigation, true);
    assert.strictEqual(status.snapshot().aiFixes, "off");
    assert.strictEqual(status.snapshot().aiSettingsConfigured, false);

    status.posture = null;
    assert.strictEqual(status.snapshot().aiInvestigation, null);
    assert.strictEqual(status.snapshot().aiFixes, null);
    assert.strictEqual(status.snapshot().aiSettingsConfigured, null);
  });
});

describe("the agent refuses writes while fixes are off", () => {
  let kubectl: FakeKubectl;
  let serviceAccount: FakeServiceAccount;
  let tmpDir: string;

  before((): void => {
    kubectl = new FakeKubectl();
    serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
    tmpDir = makeTempDir("agent-ai-settings-");
  });

  after((): void => {
    kubectl.cleanup();
    serviceAccount.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function executorFor(env: Record<string, string>): KubectlExecutor {
    const parsed: ParsedConfig = parse(env);
    const settings: KubectlExecutorSettings = {
      clusterName: "prod-us",
      allowWrites: parsed.config.allowWrites,
      allowWritesSetting: parsed.config.allowWritesSetting,
      writesOffByFixes: parsed.config.writesOffByFixes,
      allowNodeOperations: parsed.config.allowNodeOperations,
      allowNodeOperationsSetting: parsed.config.allowNodeOperationsSetting,
      writeNamespaces: [],
      podNamespace: "oneuptime-agent",
      env: {
        PATH: kubectl.getPath(),
        KUBERNETES_SERVICE_HOST: "10.96.0.1",
        KUBERNETES_SERVICE_PORT: "443",
      },
      serviceAccount: serviceAccount.paths(),
      tmpDir,
    };
    return new KubectlExecutor(settings);
  }

  const RESTART: Array<string> = [
    "rollout",
    "restart",
    "deployment/web",
    "-n",
    "web",
  ];

  test("a fix is refused with a reason that names aiAgent.fixes, never the RBAC switch", () => {
    const prepared: PreparedKubectlCommand = executorFor({
      ONEUPTIME_AI_FIXES: "off",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    }).prepare({
      payload: {
        args: RESTART,
        clusterIdentifier: "prod-us",
        kubernetesClusterId: "cluster-1",
      },
      timeoutInMs: 30_000,
      origin: "AiRemediation",
    });

    assert.ok(prepared.refusal, "refused");
    assert.match(
      prepared.refusal!,
      /AI fixes are off in this agent's configuration \(ONEUPTIME_AI_FIXES=off\)/,
    );
    assert.match(prepared.refusal!, /--set aiAgent\.fixes=ask-for-approval/);
    assert.ok(!prepared.refusal!.includes("installed read-only"));
  });

  test("with fixes on, the same write is allowed", () => {
    const prepared: PreparedKubectlCommand = executorFor({
      ONEUPTIME_AI_FIXES: "ask-for-approval",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    }).prepare({
      payload: {
        args: RESTART,
        clusterIdentifier: "prod-us",
        kubernetesClusterId: "cluster-1",
      },
      timeoutInMs: 30_000,
      origin: "AiRemediation",
    });

    assert.strictEqual(prepared.refusal, null);
  });

  test("reads still run with fixes off: investigation is its own setting", () => {
    const prepared: PreparedKubectlCommand = executorFor({
      ONEUPTIME_AI_FIXES: "off",
    }).prepare({
      payload: {
        args: ["get", "pods", "-n", "web"],
        clusterIdentifier: "prod-us",
        kubernetesClusterId: "cluster-1",
      },
      timeoutInMs: 30_000,
      origin: "AiInvestigation",
    });

    assert.strictEqual(prepared.refusal, null);
  });
});

describe("the whole agent reports them on registration and every heartbeat", () => {
  let server: FakeOneUptime;
  let kubectl: FakeKubectl;
  let serviceAccount: FakeServiceAccount;
  let tmpDir: string;
  let logs: CapturedLogs;
  const agents: Array<KubernetesAiAgent> = [];

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
    kubectl = new FakeKubectl();
    serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
  });

  after(async (): Promise<void> => {
    await server.stop();
    kubectl.cleanup();
    serviceAccount.cleanup();
  });

  beforeEach((): void => {
    server.reset();
    kubectl.setBehaviour({ stdout: "pods\n", clientVersion: "v1.36.4" });
    tmpDir = makeTempDir("agent-ai-settings-e2e-");
    logs = captureLogs();
  });

  afterEach(async (): Promise<void> => {
    for (const agent of agents.splice(0)) {
      await agent.shutdown("test");
    }
    logs.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createAgent(env: Record<string, string>): KubernetesAiAgent {
    const options: AgentOptions = {
      env: {
        PATH: kubectl.getPath(),
        ONEUPTIME_URL: server.url,
        ONEUPTIME_API_KEY: "ingestion-key-1",
        ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
        ONEUPTIME_AI_AGENT_POD_NAMESPACE: "oneuptime-agent",
        APP_VERSION: "14.0.15",
        KUBERNETES_SERVICE_HOST: "10.96.0.1",
        KUBERNETES_SERVICE_PORT: "443",
        ...env,
      },
      serviceAccount: serviceAccount.paths(),
      tmpDir,
      healthPort: 0,
      healthHost: "127.0.0.1",
      sleep: recordingSleep().sleep,
      enableProxy: false,
    };
    const agent: KubernetesAiAgent = new KubernetesAiAgent(options);
    agents.push(agent);
    return agent;
  }

  test("the chart's settings reach OneUptime with the posture, and the heartbeat repeats them", async () => {
    const agent: KubernetesAiAgent = createAgent({
      ONEUPTIME_AI_INVESTIGATION: "true",
      ONEUPTIME_AI_FIXES: "bypass-approval",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
    });

    await agent.start();
    const [registration] = await server.waitFor("/register");
    const posture: Record<string, unknown> = registration!.body[
      "posture"
    ] as Record<string, unknown>;

    assert.deepStrictEqual(posture["aiSettings"], {
      investigation: true,
      fixes: "BypassApproval",
      isConfigured: true,
    });

    await eventually((): boolean => {
      return Boolean(agent.getSession()?.getIdentity());
    });
    await agent.getHeartbeat()!.tick();

    const [heartbeat] = server.requestsTo("/heartbeat");
    assert.deepStrictEqual(
      (heartbeat!.body["posture"] as Record<string, unknown>)["aiSettings"],
      { investigation: true, fixes: "BypassApproval", isConfigured: true },
    );

    // Said once at start-up, in the chart's own words.
    assert.ok(
      logs.records.some((record: Record<string, unknown>): boolean => {
        return (
          record["message"] === "What OneUptime AI may do on this cluster" &&
          record["investigation"] === "on" &&
          record["fixes"] === "bypass-approval" &&
          String(record["setBy"]).includes("aiAgent.fixes")
        );
      }),
    );

    const port: number = (agent.getHealthServer()!.address() as AddressInfo)
      .port;
    const snapshot: AgentStatusSnapshot = (await (
      await fetch(`http://127.0.0.1:${port}/status`)
    ).json()) as AgentStatusSnapshot;
    assert.strictEqual(snapshot.aiInvestigation, true);
    assert.strictEqual(snapshot.aiFixes, "bypass-approval");
    assert.strictEqual(snapshot.aiSettingsConfigured, true);
  });

  test("a release that names neither registers its defaults, unconfigured, and says what that means", async () => {
    const agent: KubernetesAiAgent = createAgent({});

    await agent.start();
    const [registration] = await server.waitFor("/register");

    assert.deepStrictEqual(
      (registration!.body["posture"] as Record<string, unknown>)["aiSettings"],
      { investigation: true, fixes: "Disabled", isConfigured: false },
    );
    assert.ok(
      logs.records.some((record: Record<string, unknown>): boolean => {
        return (
          record["message"] === "What OneUptime AI may do on this cluster" &&
          String(record["setBy"]).includes("AI agent page keeps them")
        );
      }),
    );
  });
});
