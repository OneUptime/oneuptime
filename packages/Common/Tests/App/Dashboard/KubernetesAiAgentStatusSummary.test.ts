import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_AI_AGENT_NOUN,
  getKubernetesAiAgentConnectionState,
  getKubernetesAiAgentStatusSummary,
  getKubernetesAiAgentStatusSummaryDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatusSummary";
import {
  AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT,
  AI_AGENT_LEGACY_RUNNER_TEXT,
  AI_AGENT_PAGE_SUBTITLE,
  AiAgentAttention,
  AiAgentCardState,
  getAiAgentAttention,
  getAiAgentCardState,
  getAiAgentMetaParts,
  getAiAgentOverviewState,
  getAiAgentStateSentence,
  parseStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import {
  INVESTIGATION_ON_SENTENCE,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  AI_FIXES_MODE_TONES,
  getAiInvestigationOffSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import {
  AiAgentConnectionState,
  AiAgentStatusSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummary";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The cluster Overview's "AI agent" card at the bottom of the page, from
 * the status the cluster's AI agent page reads: for every state the AI
 * agent page tells apart (the agent connected or offline, not installed,
 * the chart's previous in-cluster Runner, a Runner an operator bound —
 * online or not), the investigation switch and every fixes mode. Each
 * answer is checked against the AI agent page's and the summary row's own
 * utils, which the card reuses.
 */

const AGENT_ID: string = "99999999-0000-4000-8000-000000000009";
const NOW: Date = new Date();

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function makeAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return {
    id: AGENT_ID,
    isOnline: true,
    connectionStatus: "connected",
    lastAliveAt: minutesAgo(1),
    lastRegisteredAt: minutesAgo(60),
    agentVersion: "14.1.0",
    posture: {
      clusterIdentifier: "prod-east",
      inCluster: true,
      allowWrites: false,
      writeNamespaces: [],
      podNamespace: "monitoring",
      kubectlVersion: "v1.31.2",
      allowNodeOperations: false,
    },
    ...overrides,
  };
}

function gap(
  code: KubernetesAiAccessGapCode,
  blocks: KubernetesAiAccessGap["blocks"] = "both",
): KubernetesAiAccessGap {
  return {
    code,
    title: `title of ${code}`,
    description: `description of ${code}`,
    nextStep: `next step for ${code}`,
    blocks,
  };
}

function agentStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  agent: KubernetesAiAgentSummary = makeAgent(),
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: "c1",
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: agent.id,
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: agent.isOnline,
      lastAliveAt: agent.lastAliveAt,
      canRunAiCommands: true,
      posture: agent.posture,
    },
    accessMethod: "in_cluster",
    aiAgent: agent,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function notInstalledStatus(): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: null,
    aiAgent: null,
    accessMethod: "none",
    isInvestigationReady: false,
    gaps: [gap("ai_agent_not_connected", "both")],
  });
}

function legacyStatus(
  isOnline: boolean = true,
): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: {
      id: "55555555-0000-4000-8000-000000000005",
      name: "kubernetes-agent/prod-east",
      isOnline,
      lastAliveAt: minutesAgo(2),
      canRunAiCommands: true,
      posture: {
        clusterIdentifier: "prod-east",
        inCluster: true,
        allowWrites: false,
        kubectlVersion: "v1.30.0",
      },
    },
    aiAgent: null,
  });
}

function advancedStatus(
  isOnline: boolean = true,
): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: {
      id: "55555555-0000-4000-8000-000000000006",
      name: "ops-runner",
      kind: "runner",
      isOnline,
      lastAliveAt: minutesAgo(3),
      canRunAiCommands: true,
      posture: { inCluster: false, kubectlVersion: "v1.29.1" },
    },
    accessMethod: "credential",
    credentialId: "cred-1",
    credentialName: "prod token",
  });
}

interface StateCase {
  state: AiAgentCardState;
  status: KubernetesClusterAiAccessStatus;
  connection: AiAgentConnectionState;
  badge: { text: string; tone: string };
  sentence: string;
}

const STATES: Array<StateCase> = [
  {
    state: "connected",
    status: agentStatus(),
    connection: "connected",
    badge: { text: "Connected", tone: "on" },
    sentence: `The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} is connected.`,
  },
  {
    state: "offline",
    status: agentStatus(
      { isInvestigationReady: false, gaps: [gap("ai_agent_offline")] },
      makeAgent({ isOnline: false, lastAliveAt: minutesAgo(45) }),
    ),
    connection: "offline",
    badge: { text: "Offline", tone: "danger" },
    sentence: `The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} is offline.`,
  },
  {
    state: "not_installed",
    status: notInstalledStatus(),
    connection: "not_installed",
    badge: { text: "Not installed", tone: "off" },
    sentence: `The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} is not installed yet.`,
  },
  {
    state: "legacy_runner",
    status: legacyStatus(),
    connection: "connected",
    badge: { text: "Connected", tone: "on" },
    sentence: AI_AGENT_LEGACY_RUNNER_TEXT,
  },
  {
    state: "legacy_runner_offline",
    status: legacyStatus(false),
    connection: "offline",
    badge: { text: "Offline", tone: "danger" },
    sentence: AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT,
  },
  {
    state: "advanced_runner",
    status: advancedStatus(),
    connection: "connected",
    badge: { text: "Connected", tone: "on" },
    sentence:
      'Reached through Runner "ops-runner" with credential "prod token".',
  },
  {
    state: "advanced_runner_offline",
    status: advancedStatus(false),
    connection: "offline",
    badge: { text: "Offline", tone: "danger" },
    sentence:
      'Reached through Runner "ops-runner" with credential "prod token". The Runner is offline.',
  },
];

describe("the cluster Overview's AI agent card, in every state the AI agent page tells apart", () => {
  test("covers every card state", () => {
    expect(
      STATES.map((item: StateCase): AiAgentCardState => {
        return getAiAgentCardState(item.status);
      }),
    ).toEqual(
      STATES.map((item: StateCase): AiAgentCardState => {
        return item.state;
      }),
    );
  });

  describe.each(STATES)("$state", (item: StateCase) => {
    const summary: AiAgentStatusSummary = getKubernetesAiAgentStatusSummary(
      item.status,
      NOW,
    );

    test("says Connected, Offline or Not installed, as the Overview's summary row does", () => {
      expect(getKubernetesAiAgentConnectionState(item.status)).toBe(
        item.connection,
      );
      expect(summary.connection).toEqual(item.badge);
      expect(summary.connection.text).toBe(
        getAiAgentOverviewState(item.status).text,
      );
    });

    test("says it in a sentence: the agent's own state, or the AI agent page's sentence for the Runner", () => {
      expect(summary.connectionSentence).toBe(item.sentence);

      if (
        item.state !== "connected" &&
        item.state !== "offline" &&
        item.state !== "not_installed"
      ) {
        expect(summary.connectionSentence).toBe(
          getAiAgentStateSentence(item.status, NOW),
        );
      }
    });

    test("shows the AI agent page's meta line under it", () => {
      expect(summary.connectionDetails).toEqual(
        getAiAgentMetaParts(item.status),
      );
    });

    test("the Needs attention headline is the AI agent page's", () => {
      const attention: AiAgentAttention | null = getAiAgentAttention(
        item.status,
        NOW,
      );

      expect(summary.attention).toBe(attention ? attention.title : null);
    });
  });

  test("a connected agent's meta line says when it was last seen, its version, kubectl's and what it may change", () => {
    const details: Array<string> = getKubernetesAiAgentStatusSummary(
      agentStatus(),
      NOW,
    ).connectionDetails;

    expect(details[0]).toMatch(/^last seen /);
    expect(details).toContain("agent v14.1.0");
    expect(details).toContain("kubectl v1.31.2");
    expect(details).toContain("Read-only");
  });

  test("nothing installed: nothing under it, and what OneUptime AI cannot do", () => {
    const summary: AiAgentStatusSummary = getKubernetesAiAgentStatusSummary(
      notInstalledStatus(),
      NOW,
    );

    expect(summary.connectionDetails).toEqual([]);
    expect(summary.attention).toBe(
      "OneUptime AI can't investigate this cluster",
    );
  });

  test("a connected agent with nothing missing needs no attention", () => {
    expect(
      getKubernetesAiAgentStatusSummary(agentStatus(), NOW).attention,
    ).toBeNull();
  });

  // Fixes being off is a choice: remediation_disabled is never attention.
  test("fixes off is not something that needs attention", () => {
    expect(
      getKubernetesAiAgentStatusSummary(
        agentStatus({ gaps: [gap("remediation_disabled", "remediation")] }),
        NOW,
      ).attention,
    ).toBeNull();
  });
});

describe("investigation with kubectl", () => {
  test("on by default: what AI may run, and that it changes nothing", () => {
    const summary: AiAgentStatusSummary = getKubernetesAiAgentStatusSummary(
      agentStatus(),
      NOW,
    );

    expect(summary.investigation).toEqual({ text: "On", tone: "on" });
    expect(summary.investigationSentence).toBe(INVESTIGATION_ON_SENTENCE);
  });

  test("off: AI runs nothing on the cluster but still investigates", () => {
    const summary: AiAgentStatusSummary = getKubernetesAiAgentStatusSummary(
      agentStatus({ isInvestigationEnabled: false }),
      NOW,
    );

    expect(summary.investigation).toEqual({ text: "Off", tone: "off" });
    expect(summary.investigationSentence).toBe(
      getAiInvestigationOffSentence("cluster"),
    );
  });

  test("a status from a server that does not say reads as Off", () => {
    const older: Partial<KubernetesClusterAiAccessStatus> = agentStatus();
    delete older.isInvestigationEnabled;

    expect(
      getKubernetesAiAgentStatusSummary(parseStatus(older)!, NOW).investigation
        .text,
    ).toBe("Off");
  });
});

describe("fixes", () => {
  test.each(Object.values(KubernetesAiRemediationMode))(
    "%s: the AI agent page's short name, tone and summary",
    (mode: KubernetesAiRemediationMode) => {
      const summary: AiAgentStatusSummary = getKubernetesAiAgentStatusSummary(
        agentStatus({ remediationMode: mode }),
        NOW,
      );

      expect(summary.fixes).toEqual({
        text: REMEDIATION_MODE_SHORT_NAMES[mode],
        tone: AI_FIXES_MODE_TONES[mode],
      });
      expect(summary.fixesSentence).toBe(REMEDIATION_MODE_SUMMARIES[mode]);
    },
  );

  test("the four modes are Off, Ask for approval, Automatic and Bypass approval", () => {
    expect(
      [
        KubernetesAiRemediationMode.Disabled,
        KubernetesAiRemediationMode.RequireApproval,
        KubernetesAiRemediationMode.Automatic,
        KubernetesAiRemediationMode.BypassApproval,
      ].map((mode: KubernetesAiRemediationMode): string => {
        return getKubernetesAiAgentStatusSummary(
          agentStatus({ remediationMode: mode }),
          NOW,
        ).fixes.text;
      }),
    ).toEqual(["Off", "Ask for approval", "Automatic", "Bypass approval"]);
  });

  test("a mode this build does not know reads as Off, as the server reads it", () => {
    expect(
      getKubernetesAiAgentStatusSummary(
        agentStatus({
          remediationMode: "SomethingNew" as KubernetesAiRemediationMode,
        }),
        NOW,
      ).fixes.text,
    ).toBe("Off");
  });
});

describe("the card's description", () => {
  test("is the AI agent page's subtitle, for a cluster", () => {
    expect(getKubernetesAiAgentStatusSummaryDescription()).toBe(
      AI_AGENT_PAGE_SUBTITLE,
    );
    expect(KUBERNETES_AI_AGENT_NOUN).toBe("cluster");
  });
});
