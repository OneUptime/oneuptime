import KubernetesClusterAiAccessService, {
  AI_AGENT_INSTALL_COMMAND,
  AI_AGENT_NOT_CONNECTED_NEXT_STEP,
  CLUSTER_AI_AGENT_PAGE,
  CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  KubernetesClusterAiAccessProjectGates,
  LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  getAiAgentLogsCommand,
  getRemediationWriteAccessNextStep,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the next step of every readiness gap is written for
 * wherever it is shown. The cluster's AI agent page shows it, and so does
 * the investigation panel on an incident or alert page (verbatim, for a
 * viewer who may read the cluster). So a next step never says "this page"
 * or "here", which on an incident page would point at the incident; one
 * that sends the operator to the cluster's page names it: "the cluster's AI
 * agent page (AI → Agent)" — never the retired "cluster's AI page".
 *
 * Every gap is produced by the real status computation, one scenario per
 * branch (the Kubernetes AI agent, the previous in-cluster Runner, an
 * advanced Runner, nothing at all), so a next step added or reworded later
 * is checked too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const AGENT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

const CLOSED_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: false,
  hasLlmProvider: false,
  aiBalanceBlocker: "This project's AI credit balance is used up.",
};

// "this page" / "on this page" / "here" read as the incident on an incident page.
const PAGE_RELATIVE_WORDING: RegExp = /\bthis page\b|\bhere\b/i;

// Any mention of the cluster's page must say whose, and which one.
const AI_PAGE_MENTION: RegExp = /\bAI (agent )?page\b/;

function cluster(overrides: Record<string, unknown> = {}): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function agent(overrides: Record<string, unknown> = {}): KubernetesAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      inCluster: true,
      allowWrites: true,
      clusterIdentifier: "prod-us",
      podNamespace: "oneuptime-agent",
    },
    ...overrides,
  } as unknown as KubernetesAiAgent;
}

function agentRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunAiCommands: true,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

function dashboardRunner(overrides: Record<string, unknown> = {}): Runner {
  return agentRunner({
    name: "office-runner",
    hostInfo: {},
    ...overrides,
  });
}

interface Scenario {
  label: string;
  cluster: KubernetesCluster;
  // What the bound Runner lookup answers.
  runner: Runner | null;
  // The cluster's Kubernetes AI agent row.
  agent: KubernetesAiAgent | null;
  gates?: KubernetesClusterAiAccessProjectGates | undefined;
}

const SCENARIOS: Array<Scenario> = [
  {
    label: "no agent and no Runner",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
    agent: null,
  },
  {
    label: "the agent stopped reporting",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
    agent: agent({ lastAliveAt: OneUptimeDate.getSomeMinutesAgo(30) }),
  },
  {
    label: "the agent signed off",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
    agent: agent({ connectionStatus: "disconnected" }),
  },
  {
    label: "the agent reports another cluster",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
    agent: agent({
      posture: { inCluster: true, allowWrites: true, clusterIdentifier: "x" },
    }),
  },
  {
    label: "a read-only agent asked to remediate",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
    agent: agent({
      posture: {
        inCluster: true,
        allowWrites: false,
        clusterIdentifier: "prod-us",
      },
    }),
  },
  {
    label: "the bound Runner was just deleted",
    cluster: cluster(),
    runner: null,
    agent: null,
  },
  {
    label: "the previous in-cluster Runner signed off",
    cluster: cluster(),
    runner: agentRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
    }),
    agent: null,
  },
  {
    label: "the previous in-cluster Runner is offline",
    cluster: cluster(),
    runner: agentRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
    agent: null,
  },
  {
    label: "a dashboard Runner signed off",
    cluster: cluster(),
    runner: dashboardRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
    }),
    agent: null,
  },
  {
    label: "a Runner that never connected",
    cluster: cluster(),
    runner: dashboardRunner({ lastAlive: undefined }),
    agent: null,
  },
  {
    label: "a Runner without the AI-commands capability",
    cluster: cluster(),
    runner: agentRunner({ canRunAiCommands: false }),
    agent: null,
  },
  {
    label: "an external Runner whose credential is gone",
    cluster: cluster({ aiAccessCredentialId: CREDENTIAL_ID }),
    runner: dashboardRunner(),
    agent: null,
  },
  {
    label: "an external Runner without a credential",
    cluster: cluster(),
    runner: dashboardRunner(),
    agent: null,
  },
  {
    label: "a pod Runner that never said which cluster it runs in",
    cluster: cluster(),
    runner: dashboardRunner({
      hostInfo: { kubernetes: { inCluster: true, allowWrites: false } },
    }),
    agent: null,
  },
  {
    label: "a read-only previous in-cluster Runner asked to remediate",
    cluster: cluster(),
    runner: agentRunner({
      hostInfo: {
        kubernetes: {
          inCluster: true,
          allowWrites: false,
          clusterIdentifier: "prod-us",
        },
      },
    }),
    agent: null,
  },
  {
    label: "both switches off, every project gate closed, an advanced Runner",
    cluster: cluster({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    }),
    runner: dashboardRunner(),
    agent: null,
    gates: CLOSED_GATES,
  },
];

// Every gap the status computation can produce today.
const PRODUCED_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "ai_agent_not_connected",
  "ai_agent_offline",
  "ai_balance_insufficient",
  "runner_missing",
  "runner_offline",
  "runner_ai_commands_disabled",
  "runner_cluster_mismatch",
  "credential_missing",
  "investigation_disabled",
  "remediation_disabled",
  "remediation_write_access_missing",
  "project_ai_disabled",
  "llm_provider_missing",
];

/*
 * Codes kept in the union for compatibility that the status no longer
 * produces: the AI agent replaced "bind a Runner" (no_runner_bound), a
 * kubernetes-agent row is never an advanced Runner any more
 * (credential_on_agent_runner), last_access_check_failed never was, and
 * the project's "Enable auto-remediation" and "Enable AI command
 * execution" switches were folded into Enable AI (project_ai_disabled),
 * so their gaps went with them.
 */
const RETIRED_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "no_runner_bound",
  "credential_on_agent_runner",
  "last_access_check_failed",
  "project_auto_remediation_disabled",
  "project_ai_command_execution_disabled",
];

describe("KubernetesClusterAiAccessService gap next steps", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function gapsOf(
    scenario: Scenario,
  ): Promise<Array<KubernetesAiAccessGap>> {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(scenario.runner);
    jest
      .spyOn(KubernetesAiAgentService, "findForCluster")
      .mockResolvedValue(scenario.agent);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: scenario.cluster,
        gates: scenario.gates || READY_GATES,
      });

    return status.gaps;
  }

  async function everyGap(): Promise<
    Array<{ scenario: string; gap: KubernetesAiAccessGap }>
  > {
    const all: Array<{ scenario: string; gap: KubernetesAiAccessGap }> = [];

    for (const scenario of SCENARIOS) {
      const gaps: Array<KubernetesAiAccessGap> = await gapsOf(scenario);

      if (gaps.length === 0) {
        throw new Error(`Scenario "${scenario.label}" produced no gap.`);
      }

      for (const gap of gaps) {
        all.push({ scenario: scenario.label, gap });
      }
    }

    return all;
  }

  it("the scenarios reach every gap the status can produce", async () => {
    const codes: Set<string> = new Set(
      (await everyGap()).map(
        (entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
          return entry.gap.code;
        },
      ),
    );

    expect([...codes].sort()).toEqual([...PRODUCED_GAP_CODES].sort());
  });

  it("never produces a retired code", async () => {
    for (const entry of await everyGap()) {
      expect(RETIRED_GAP_CODES).not.toContain(entry.gap.code);
    }
  });

  it('no next step says "this page" or "here"', async () => {
    const offenders: Array<string> = (await everyGap())
      .filter((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
        return PAGE_RELATIVE_WORDING.test(entry.gap.nextStep);
      })
      .map((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
        return `${entry.scenario} / ${entry.gap.code}: ${entry.gap.nextStep}`;
      });

    expect(offenders).toEqual([]);
  });

  it("a next step that sends the operator to the cluster's page names it as the AI agent page (AI → Agent)", async () => {
    const entries: Array<{ scenario: string; gap: KubernetesAiAccessGap }> = (
      await everyGap()
    ).filter((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
      return AI_PAGE_MENTION.test(entry.gap.nextStep);
    });

    // Most cluster-level steps are taken on the AI agent page.
    expect(entries.length).toBeGreaterThanOrEqual(8);

    for (const entry of entries) {
      expect(`${entry.gap.code}: ${entry.gap.nextStep}`).toContain(
        CLUSTER_AI_AGENT_PAGE,
      );
      expect(entry.gap.nextStep).not.toContain("the cluster's AI page");
      expect(entry.gap.nextStep).not.toContain("this cluster's AI");
    }
  });

  it("every step taken on the AI agent page names it", async () => {
    const onTheAiAgentPage: Array<KubernetesAiAccessGapCode> = [
      "runner_missing",
      "runner_cluster_mismatch",
      "credential_missing",
      "investigation_disabled",
      "remediation_disabled",
      "remediation_write_access_missing",
    ];

    for (const entry of await everyGap()) {
      /*
       * A Runner outside the chart is given writes on its own host, not on
       * the page (see the read-only gap's tests below).
       */
      const isRunnerHostStep: boolean =
        entry.gap.nextStep ===
        CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP;

      if (onTheAiAgentPage.includes(entry.gap.code) && !isRunnerHostStep) {
        expect(`${entry.scenario}: ${entry.gap.nextStep}`).toContain(
          "the cluster's AI agent page (AI → Agent)",
        );
      }
    }
  });

  it("the project-level steps name Project Settings → AI Features, never AI Credits for a switch", async () => {
    const gaps: Array<KubernetesAiAccessGap> = await gapsOf(
      SCENARIOS[SCENARIOS.length - 1]!,
    );

    const stepOf: (code: KubernetesAiAccessGapCode) => string = (
      code: KubernetesAiAccessGapCode,
    ): string => {
      return (
        gaps.find((gap: KubernetesAiAccessGap) => {
          return gap.code === code;
        })?.nextStep || ""
      );
    };

    expect(stepOf("project_ai_disabled")).toBe(
      "Enable AI under Project Settings → AI Features.",
    );
    // Enable AI is the one switch on AI Features: nothing else sends there.
    expect(
      gaps
        .filter((gap: KubernetesAiAccessGap) => {
          return gap.nextStep.includes("AI Features");
        })
        .map((gap: KubernetesAiAccessGap) => {
          return gap.code;
        }),
    ).toEqual(["project_ai_disabled"]);
    // Credits are still bought where credits live.
    expect(stepOf("ai_balance_insufficient")).toBe(
      "Add AI credits under Project Settings → AI Credits (or enable auto-recharge).",
    );
  });

  it("no next step names a switch Enable AI replaced", async () => {
    for (const entry of await everyGap()) {
      const text: string = `${entry.scenario}: ${entry.gap.title} ${entry.gap.description} ${entry.gap.nextStep}`;

      expect(text).not.toContain("Enable AI Command Execution");
      expect(text).not.toMatch(/auto-remediation/i);
      expect(text).not.toMatch(/command execution/i);
    }
  });

  it("no next step still tells anyone to turn aiAccess on", async () => {
    for (const entry of await everyGap()) {
      expect(`${entry.scenario}: ${entry.gap.nextStep}`).not.toContain(
        "aiAccess.enabled",
      );
    }
  });
});

describe("the shared install and logs commands", () => {
  it("prints the install command exactly as every surface prints it", () => {
    expect(AI_AGENT_INSTALL_COMMAND).toBe(
      [
        "helm repo update",
        "helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\",
        "  --namespace oneuptime-agent --reset-then-reuse-values \\",
        "  --set aiAgent.enabled=true",
      ].join("\n"),
    );
  });

  it("the not-connected step carries the install command verbatim and the logs command", () => {
    expect(AI_AGENT_NOT_CONNECTED_NEXT_STEP).toContain(
      AI_AGENT_INSTALL_COMMAND,
    );
    expect(AI_AGENT_NOT_CONNECTED_NEXT_STEP).toContain(
      "kubectl logs -n <namespace> -l component=ai-agent --tail=100",
    );
    expect(AI_AGENT_NOT_CONNECTED_NEXT_STEP).toContain(
      "use your own release name and namespace",
    );
  });

  it("the logs command names the agent's own namespace when it is known", () => {
    expect(getAiAgentLogsCommand("oneuptime-agent")).toBe(
      "kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100",
    );
    expect(getAiAgentLogsCommand("  monitoring  ")).toBe(
      "kubectl logs -n monitoring -l component=ai-agent --tail=100",
    );
    expect(getAiAgentLogsCommand(undefined)).toBe(
      "kubectl logs -n <namespace> -l component=ai-agent --tail=100",
    );
    expect(getAiAgentLogsCommand("   ")).toBe(
      "kubectl logs -n <namespace> -l component=ai-agent --tail=100",
    );
  });
});

/*
 * The read-only gap says what grants writes where the executor is
 * configured: the AI agent's chart values, the upgrade to the AI agent for
 * the previous in-cluster Runner, a Runner's own environment otherwise.
 * The complete command lives on the AI agent page, so the step names it.
 */
describe("the read-only gap's next step, by who runs kubectl", () => {
  it("the AI agent: aiAgent.fixes, aiAgent.remediation.* and the AI agent page", () => {
    expect(getRemediationWriteAccessNextStep("ai_agent")).toBe(
      REMEDIATION_WRITE_ACCESS_NEXT_STEP,
    );
    /*
     * Fixes are the agent's setting: the chart's aiAgent.fixes turns them on
     * and grants the write access they need, so the step names it (and its
     * other on modes) rather than the older remediation.enabled switch.
     */
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "--set aiAgent.fixes=ask-for-approval",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain("automatic");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain("bypass-approval");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain(
      "aiAgent.remediation.enabled",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAgent.remediation.namespaces",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAgent.remediation.nodeOperations=false",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain("cluster-wide");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(CLUSTER_AI_AGENT_PAGE);
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain("aiAccess");
  });

  it("the previous in-cluster Runner: upgrade the chart to the AI agent, with aiAgent.fixes", () => {
    expect(getRemediationWriteAccessNextStep("legacy_runner")).toBe(
      LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
    );
    expect(LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "Upgrade the Kubernetes agent chart",
    );
    expect(LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "the Kubernetes AI agent replaces this Runner",
    );
    expect(LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "--set aiAgent.fixes=ask-for-approval",
    );
    expect(LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain(
      "aiAgent.remediation.enabled",
    );
    expect(LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain(
      "aiAccess",
    );
  });

  it("a Runner with a credential: its own environment", () => {
    expect(getRemediationWriteAccessNextStep("credential_runner")).toBe(
      CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP,
    );
    expect(CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "ONEUPTIME_KUBECTL_ALLOW_WRITES=true",
    );
    expect(CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "ONEUPTIME_KUBECTL_WRITE_NAMESPACES",
    );
    expect(CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain(
      "helm",
    );
  });
});
