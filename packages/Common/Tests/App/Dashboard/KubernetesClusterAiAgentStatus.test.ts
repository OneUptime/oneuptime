import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  AI_AGENT_GONE_TEXT,
  AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT,
  AI_AGENT_LEGACY_RUNNER_TEXT,
  AI_AGENT_NOT_INSTALLED_TEXT,
  AI_AGENT_OTHER_RELEASE_TEXT,
  AI_AGENT_PAGE_SUBTITLE,
  AI_AGENT_PAGE_TITLE,
  AI_AGENT_READY_TEXT,
  AI_AGENT_SIGNED_OFF_TEXT,
  AI_AGENT_SILENT_TEXT,
  AI_AGENT_STATUS_POLL_INTERVAL_MS,
  ASK_PROJECT_ADMIN_TEXT,
  AUTOMATIC_INVESTIGATION_CONFIRMATIONS,
  AUTOMATIC_INVESTIGATION_LINE,
  AiAgentAttention,
  AiAgentAttentionStep,
  AiAgentCardState,
  AiAgentMeta,
  AiAgentOfflineReason,
  CHOICE_GAP_CODES,
  KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT,
  REFUSED_REGISTRATION_WARNING_WINDOW_MS,
  canSwitchToAiAgent,
  describeAiAgentNodeOperations,
  describeAiAgentWriteAccess,
  getAiAgentAttention,
  getAiAgentAttentionStepText,
  getAiAgentAttentionTitle,
  getAiAgentCardCommand,
  getAiAgentCardState,
  getAiAgentGapAction,
  getAiAgentMeta,
  getAiAgentMetaParts,
  getAiAgentOfflineReason,
  getAiAgentOverviewState,
  getAiAgentPodNamespace,
  getAiAgentStateSentence,
  getAiAgentStatusPill,
  getAiAgentSummary,
  getAttentionGaps,
  getAutomaticInvestigation,
  getAutomaticInvestigationConfirmation,
  getAutomaticInvestigationLine,
  getAutomaticInvestigationTurnOnChanges,
  getKubernetesAiSettingsSource,
  getRefusedRegistrationWarning,
  isAdvancedRunnerTarget,
  isInClusterTarget,
  isKubernetesAiSettingsSetByAgent,
  isLegacyRunnerTarget,
  parseStatus,
  shouldShowWriteAccessCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { KUBERNETES_AGENT_HELM_NAMESPACE } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { fillTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * The pure reading of the server's access status behind the cluster's AI
 * agent page and the Overview's "AI agent" card: which of its states the
 * card is in (the agent connected or offline, not installed, the previous
 * in-cluster Runner, an advanced Runner), the words and the one command for
 * each, the meta line, the refused-registration warning, which server gaps
 * the "Needs attention" card holds — as ONE item: a headline, then a short
 * step per gap with what it offers — when the write-access commands show,
 * and the automatic-investigation footer.
 */

const AGENT_ID: string = "99999999-0000-4000-8000-000000000009";
const LEGACY_RUNNER_ID: string = "55555555-0000-4000-8000-000000000005";
const ADVANCED_RUNNER_ID: string = "55555555-0000-4000-8000-000000000006";

const NOW: Date = new Date();

// AI_AGENT_SILENT_TEXT with the server's alive window in it.
const SILENT_SENTENCE: string =
  "The AI agent has not checked in for over 5 minutes. Check its pod:";

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

/*
 * The three ways an agent goes offline, as the server's isOnline rule
 * produces them: heartbeats stopped without a sign-off, a sign-off or reset
 * moments ago (a helm upgrade, "Reset agent"), and a sign-off it never came
 * back from.
 */
function silentAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return makeAgent({
    isOnline: false,
    lastAliveAt: minutesAgo(12),
    ...overrides,
  });
}

function signedOffAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return makeAgent({
    isOnline: false,
    connectionStatus: "disconnected",
    lastAliveAt: minutesAgo(0.25),
    ...overrides,
  });
}

function goneAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return makeAgent({
    isOnline: false,
    connectionStatus: "disconnected",
    lastAliveAt: minutesAgo(45),
    ...overrides,
  });
}

// A status whose resolved target is the cluster's Kubernetes AI agent.
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

// Nothing reaches the cluster and no agent ever registered.
function notInstalledStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: null,
    aiAgent: null,
    accessMethod: "none",
    isInvestigationReady: false,
    gaps: [gap("ai_agent_not_connected", "both")],
    ...overrides,
  });
}

// Still on the chart's previous in-cluster Runner (a 14.0.x install).
function legacyStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  isOnline: boolean = true,
): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: {
      id: LEGACY_RUNNER_ID,
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
    ...overrides,
  });
}

// Bound to a Runner outside the chart, with a Kubernetes credential.
function advancedStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  isOnline: boolean = true,
): KubernetesClusterAiAccessStatus {
  return agentStatus({
    runner: {
      id: ADVANCED_RUNNER_ID,
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
    ...overrides,
  });
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

describe("parseStatus", () => {
  test("accepts the status shape the API returns and nothing looser", () => {
    expect(parseStatus(agentStatus())).toEqual(agentStatus());
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
    expect(parseStatus("ready")).toBeNull();
    expect(parseStatus([agentStatus()])).toBeNull();
    expect(parseStatus({ ...agentStatus(), clusterId: 7 })).toBeNull();
    expect(parseStatus({ ...agentStatus(), gaps: null })).toBeNull();
  });

  test("a status from a server without the new fields still parses", () => {
    const older: Partial<KubernetesClusterAiAccessStatus> = agentStatus();
    delete older.aiAgent;
    delete older.automaticInvestigation;
    const parsed: KubernetesClusterAiAccessStatus | null = parseStatus(older);
    expect(parsed).not.toBeNull();
    // A missing aiAgent reads as null — never as a third state.
    expect(getAiAgentSummary(parsed!)).toBeNull();
    expect(getAutomaticInvestigation(parsed!)).toBeNull();
  });

  test("polls every 30 seconds, like the page always did", () => {
    expect(AI_AGENT_STATUS_POLL_INTERVAL_MS).toBe(30_000);
  });
});

describe("the card's state", () => {
  const CASES: Array<{
    name: string;
    status: KubernetesClusterAiAccessStatus;
    state: AiAgentCardState;
  }> = [
    { name: "the agent, online", status: agentStatus(), state: "connected" },
    {
      name: "the agent, offline",
      status: agentStatus({}, makeAgent({ isOnline: false })),
      state: "offline",
    },
    {
      name: "nothing installed",
      status: notInstalledStatus(),
      state: "not_installed",
    },
    {
      name: "the previous in-cluster Runner, online",
      status: legacyStatus(),
      state: "legacy_runner",
    },
    {
      name: "the previous in-cluster Runner, offline",
      status: legacyStatus({}, false),
      state: "legacy_runner_offline",
    },
    {
      name: "an advanced Runner, online",
      status: advancedStatus(),
      state: "advanced_runner",
    },
    {
      name: "an advanced Runner, offline",
      status: advancedStatus({}, false),
      state: "advanced_runner_offline",
    },
    // Defensive: a row but no target reads as the agent's own state.
    {
      name: "an agent row without a target",
      status: agentStatus({ runner: null }, makeAgent({ isOnline: false })),
      state: "offline",
    },
    {
      name: "an online agent row without a target",
      status: agentStatus({ runner: null }),
      state: "connected",
    },
  ];

  for (const testCase of CASES) {
    test(testCase.name, () => {
      expect(getAiAgentCardState(testCase.status)).toBe(testCase.state);
    });
  }

  /*
   * The legacy Runner is told apart from an advanced one the server's way:
   * the name marker, an agent posture, or the in-cluster access method —
   * never by the kind alone (both are "runner").
   */
  test("the previous in-cluster Runner is recognised by name, posture or access method", () => {
    expect(isLegacyRunnerTarget(legacyStatus())).toBe(true);
    // Renamed row, agent posture: still the chart's Runner.
    expect(
      isLegacyRunnerTarget(
        legacyStatus({
          accessMethod: "none",
          runner: {
            ...legacyStatus().runner!,
            name: "east-kubectl",
          },
        }),
      ),
    ).toBe(true);
    // Upper-case name marker, no posture.
    expect(
      isLegacyRunnerTarget(
        legacyStatus({
          accessMethod: "none",
          runner: {
            ...legacyStatus().runner!,
            name: "KUBERNETES-AGENT/prod-east",
            posture: undefined,
          },
        }),
      ),
    ).toBe(true);
    // Negative controls.
    expect(isLegacyRunnerTarget(advancedStatus())).toBe(false);
    expect(isLegacyRunnerTarget(agentStatus())).toBe(false);
    expect(isLegacyRunnerTarget(notInstalledStatus())).toBe(false);
  });

  test("an advanced Runner is a Runner target that is not the chart's", () => {
    expect(isAdvancedRunnerTarget(advancedStatus())).toBe(true);
    // A Runner with no credential (credential_missing) is still advanced.
    expect(
      isAdvancedRunnerTarget(
        advancedStatus({ accessMethod: "none", credentialName: undefined }),
      ),
    ).toBe(true);
    // A summary without `kind` is a Runner (the field's documented default).
    const withoutKind: KubernetesClusterAiAccessStatus = advancedStatus();
    delete withoutKind.runner!.kind;
    expect(isAdvancedRunnerTarget(withoutKind)).toBe(true);

    for (const status of [
      agentStatus(),
      legacyStatus(),
      notInstalledStatus(),
    ]) {
      expect(isAdvancedRunnerTarget(status)).toBe(false);
    }
  });

  test("the agent and the previous Runner run kubectl in the cluster; an advanced Runner does not", () => {
    expect(isInClusterTarget(agentStatus())).toBe(true);
    expect(isInClusterTarget(legacyStatus())).toBe(true);
    expect(isInClusterTarget(advancedStatus())).toBe(false);
    expect(isInClusterTarget(notInstalledStatus())).toBe(false);
  });
});

describe("the pill and the sentence", () => {
  test("say each state plainly", () => {
    expect(getAiAgentStatusPill(agentStatus())).toEqual({
      text: "Connected",
      tone: "success",
    });
    expect(
      getAiAgentStatusPill(agentStatus({}, makeAgent({ isOnline: false }))),
    ).toEqual({ text: "Offline", tone: "danger" });
    expect(getAiAgentStatusPill(notInstalledStatus())).toEqual({
      text: "Not installed",
      tone: "neutral",
    });
    expect(getAiAgentStatusPill(legacyStatus())).toEqual({
      text: "Connected through the previous in-cluster Runner",
      tone: "success",
    });
    expect(getAiAgentStatusPill(legacyStatus({}, false))).toEqual({
      text: "Offline",
      tone: "danger",
    });
    expect(getAiAgentStatusPill(advancedStatus())).toEqual({
      text: "Connected through Runner ops-runner (advanced)",
      tone: "success",
    });
    expect(getAiAgentStatusPill(advancedStatus({}, false))).toEqual({
      text: "Offline",
      tone: "danger",
    });
  });

  test("the not-installed card says what installing does, in the product owner's words", () => {
    expect(getAiAgentStateSentence(notInstalledStatus())).toBe(
      "Install the AI agent — it runs in your cluster, read-only, using your Kubernetes agent's key. This page updates within a minute.",
    );
    expect(AI_AGENT_NOT_INSTALLED_TEXT).toBe(
      getAiAgentStateSentence(notInstalledStatus()),
    );
    expect(AI_AGENT_OTHER_RELEASE_TEXT).toBe(
      "Installed under another release or namespace? Use yours.",
    );
  });

  test("the previous in-cluster Runner works today and upgrading carries the settings over", () => {
    expect(getAiAgentStateSentence(legacyStatus())).toBe(
      AI_AGENT_LEGACY_RUNNER_TEXT,
    );
    expect(AI_AGENT_LEGACY_RUNNER_TEXT).toBe(
      "Works today. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
    );
  });

  /*
   * Each of the previous Runner's sentences is one key with both of its
   * sentences in it, so a locale words them together. They end with the
   * same way forward, word for word.
   */
  test("online or offline, the previous Runner's way forward is the same", () => {
    const upgrade: string =
      "Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.";

    expect(AI_AGENT_LEGACY_RUNNER_TEXT).toBe(`Works today. ${upgrade}`);
    expect(AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT).toBe(
      `The previous in-cluster Runner is offline. ${upgrade}`,
    );
  });

  /*
   * An offline Runner does not work today: the sentence said "is offline.
   * Works today." in one breath. It keeps only the way forward.
   */
  test("an offline previous Runner is not said to work today", () => {
    const sentence: string = getAiAgentStateSentence(legacyStatus({}, false));
    expect(sentence).toBe(
      "The previous in-cluster Runner is offline. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
    );
    expect(sentence).toBe(AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT);
    expect(sentence).not.toContain("Works today");
    // Online, it still does.
    expect(getAiAgentStateSentence(legacyStatus())).toContain("Works today");
    // Offline or not, the same single command moves it to the agent.
    expect(getAiAgentCardCommand(legacyStatus({}, false))).toBe("install");
  });

  test("an advanced binding is display-only: which Runner, which credential", () => {
    expect(getAiAgentStateSentence(advancedStatus())).toBe(
      'Reached through Runner "ops-runner" with credential "prod token".',
    );
    expect(
      getAiAgentStateSentence(advancedStatus({ credentialName: undefined })),
    ).toBe('Reached through Runner "ops-runner".');
    expect(getAiAgentStateSentence(advancedStatus({}, false))).toBe(
      'Reached through Runner "ops-runner" with credential "prod token". The Runner is offline.',
    );
    expect(
      getAiAgentStateSentence(
        advancedStatus({ credentialName: undefined }, false),
      ),
    ).toBe('Reached through Runner "ops-runner". The Runner is offline.');
  });

  test("a Runner without a name reads as (unnamed), in the sentence and the pill", () => {
    const unnamed: KubernetesClusterAiAccessStatus = advancedStatus({
      runner: { ...advancedStatus().runner!, name: "" },
    });

    expect(getAiAgentStateSentence(unnamed)).toBe(
      'Reached through Runner "(unnamed)" with credential "prod token".',
    );
    expect(getAiAgentStatusPill(unnamed).text).toBe(
      "Connected through Runner (unnamed) (advanced)",
    );
  });

  // Names are the user's: they go in as written, never read as slots.
  test("a Runner's and a credential's names go into the sentence as written", () => {
    expect(
      getAiAgentStateSentence(
        advancedStatus({
          runner: { ...advancedStatus().runner!, name: "ops {{runner}}" },
          credentialName: "token {{credential}}",
        }),
      ),
    ).toBe(
      'Reached through Runner "ops {{runner}}" with credential "token {{credential}}".',
    );
  });

  test("the agent's own states", () => {
    expect(getAiAgentStateSentence(agentStatus())).toBe(
      "The AI agent is running in this cluster.",
    );
    expect(getAiAgentStateSentence(agentStatus({}, silentAgent()))).toBe(
      "The AI agent has not checked in for over 5 minutes. Check its pod:",
    );
    expect(getAiAgentStateSentence(agentStatus({}, signedOffAgent()))).toBe(
      "The AI agent signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its pod:",
    );
    expect(getAiAgentStateSentence(agentStatus({}, goneAgent()))).toBe(
      "The AI agent disconnected and has not come back. Check its pod:",
    );
  });

  test("the page's heading is worded like the AI Insights and AI Logs pages'", () => {
    expect(AI_AGENT_PAGE_TITLE).toBe("AI agent");
    expect(AI_AGENT_PAGE_SUBTITLE).toBe(
      "Whether OneUptime AI can reach this cluster, and what it may do there.",
    );
  });

  test("the ready line is the product owner's words", () => {
    expect(AI_AGENT_READY_TEXT).toBe(
      "Ready — AI will inspect this cluster with read-only kubectl when it investigates an incident or alert here.",
    );
  });
});

/*
 * The server calls the agent offline for two different reasons
 * (KubernetesAiAgentService.isOnline): it signed off or was reset
 * (connectionStatus "disconnected"), or its heartbeats went quiet for over
 * the alive window. The sentence used to blame the heartbeats every time,
 * so right after "Reset agent" or a helm upgrade the card said "has not
 * checked in for over 5 minutes" above a meta line reading "last seen a
 * few seconds ago".
 */
describe("why the agent is offline", () => {
  const NOW_DATE: Date = new Date(NOW.getTime());

  const CASES: Array<{
    name: string;
    agent: KubernetesAiAgentSummary;
    reason: AiAgentOfflineReason;
  }> = [
    {
      name: "heartbeats stopped without a sign-off",
      agent: silentAgent(),
      reason: "silent",
    },
    {
      name: "connected but never heard from",
      agent: silentAgent({ lastAliveAt: undefined }),
      reason: "silent",
    },
    {
      name: "a helm upgrade's pod signed off seconds ago",
      agent: signedOffAgent(),
      reason: "signed_off",
    },
    {
      name: "an admin reset it a minute ago",
      agent: signedOffAgent({ lastAliveAt: minutesAgo(1) }),
      reason: "signed_off",
    },
    {
      name: "signed off exactly at the edge of the alive window",
      agent: signedOffAgent({ lastAliveAt: minutesAgo(5) }),
      reason: "signed_off",
    },
    {
      name: "signed off just past the alive window",
      agent: signedOffAgent({
        lastAliveAt: new Date(
          NOW.getTime() - 5 * 60 * 1000 - 1000,
        ).toISOString(),
      }),
      reason: "gone",
    },
    {
      name: "a heartbeat stamped slightly ahead by another server's clock",
      agent: signedOffAgent({
        lastAliveAt: new Date(NOW.getTime() + 20 * 1000).toISOString(),
      }),
      reason: "signed_off",
    },
    {
      name: "signed off long ago and never came back",
      agent: goneAgent(),
      reason: "gone",
    },
    {
      name: "disconnected without a last-seen time",
      agent: goneAgent({ lastAliveAt: undefined }),
      reason: "gone",
    },
    {
      name: "disconnected with an unreadable last-seen time",
      agent: goneAgent({ lastAliveAt: "not a date" }),
      reason: "gone",
    },
  ];

  for (const testCase of CASES) {
    test(testCase.name, () => {
      const status: KubernetesClusterAiAccessStatus = agentStatus(
        {},
        testCase.agent,
      );
      expect(getAiAgentCardState(status)).toBe("offline");
      expect(getAiAgentOfflineReason(status, NOW_DATE)).toBe(testCase.reason);
    });
  }

  test("each reason has its own sentence, and every one hands over to the logs command", () => {
    const sentences: Record<AiAgentOfflineReason, string> = {
      silent: SILENT_SENTENCE,
      signed_off: AI_AGENT_SIGNED_OFF_TEXT,
      gone: AI_AGENT_GONE_TEXT,
    };
    for (const [agent, reason] of [
      [silentAgent(), "silent"],
      [signedOffAgent(), "signed_off"],
      [goneAgent(), "gone"],
    ] as Array<[KubernetesAiAgentSummary, AiAgentOfflineReason]>) {
      const status: KubernetesClusterAiAccessStatus = agentStatus({}, agent);
      expect(getAiAgentStateSentence(status, NOW_DATE)).toBe(sentences[reason]);
      expect(getAiAgentStateSentence(status, NOW_DATE)).toMatch(
        /check its pod:$/i,
      );
      expect(getAiAgentCardCommand(status)).toBe("logs");
    }
    expect(new Set(Object.values(sentences)).size).toBe(3);
  });

  /*
   * The regression itself: whenever the meta line can say the agent was
   * seen within the alive window, the sentence must not say it has been
   * silent for longer than that.
   */
  test("a recent sign-off never claims five silent minutes above 'last seen seconds ago'", () => {
    for (const agent of [
      signedOffAgent(),
      signedOffAgent({ lastAliveAt: minutesAgo(1) }),
      signedOffAgent({ lastAliveAt: minutesAgo(4) }),
    ]) {
      const status: KubernetesClusterAiAccessStatus = agentStatus({}, agent);
      expect(getAiAgentStateSentence(status, NOW_DATE)).not.toContain(
        "has not checked in",
      );
      expect(getAiAgentMetaParts(status)[0]).toMatch(/^last seen /);
    }
  });

  test("the same sign-off becomes 'has not come back' once the alive window passes", () => {
    const status: KubernetesClusterAiAccessStatus = agentStatus(
      {},
      signedOffAgent({ lastAliveAt: minutesAgo(1) }),
    );
    expect(getAiAgentOfflineReason(status, NOW_DATE)).toBe("signed_off");
    expect(
      getAiAgentOfflineReason(status, new Date(NOW.getTime() + 10 * 60 * 1000)),
    ).toBe("gone");
    expect(
      getAiAgentStateSentence(status, new Date(NOW.getTime() + 10 * 60 * 1000)),
    ).toBe(AI_AGENT_GONE_TEXT);
  });

  test("reads the current time when none is given", () => {
    expect(getAiAgentOfflineReason(agentStatus({}, signedOffAgent()))).toBe(
      "signed_off",
    );
    expect(getAiAgentStateSentence(agentStatus({}, signedOffAgent()))).toBe(
      AI_AGENT_SIGNED_OFF_TEXT,
    );
  });

  test("an agent row without a target still reads its own reason", () => {
    expect(
      getAiAgentOfflineReason(
        agentStatus({ runner: null }, signedOffAgent()),
        NOW_DATE,
      ),
    ).toBe("signed_off");
  });

  /*
   * A server that predates the agent row gives no connection status to
   * tell a sign-off apart; the heartbeat reading is the one that is true
   * either way.
   */
  test("without the agent row it falls back to the heartbeat reading", () => {
    const payload: Partial<KubernetesClusterAiAccessStatus> = agentStatus(
      {},
      signedOffAgent(),
    );
    delete payload.aiAgent;
    // An older server omits aiAgent, which the current type requires.
    const older: KubernetesClusterAiAccessStatus =
      payload as KubernetesClusterAiAccessStatus;
    expect(getAiAgentCardState(older)).toBe("offline");
    expect(getAiAgentOfflineReason(older, NOW_DATE)).toBe("silent");
    expect(getAiAgentStateSentence(older, NOW_DATE)).toBe(SILENT_SENTENCE);
  });

  /*
   * The window is a value in the sentence, not part of its key: a locale
   * words the sentence once and puts the number where its grammar wants
   * it.
   */
  test("the silent sentence quotes the server's alive window", () => {
    expect(AI_AGENT_SILENT_TEXT).toBe(
      "The AI agent has not checked in for over {{minutes}} minutes. Check its pod:",
    );
    expect(
      fillTemplate(AI_AGENT_SILENT_TEXT, {
        minutes: KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
      }),
    ).toBe(SILENT_SENTENCE);
    expect(SILENT_SENTENCE).toBe(
      "The AI agent has not checked in for over 5 minutes. Check its pod:",
    );
  });

  test("no other state reads an offline reason into its sentence", () => {
    for (const status of [
      agentStatus(),
      notInstalledStatus(),
      legacyStatus(),
      legacyStatus({}, false),
      advancedStatus(),
      advancedStatus({}, false),
    ]) {
      const sentence: string = getAiAgentStateSentence(status, NOW_DATE);
      for (const offline of [
        SILENT_SENTENCE,
        AI_AGENT_SIGNED_OFF_TEXT,
        AI_AGENT_GONE_TEXT,
      ]) {
        expect(sentence).not.toBe(offline);
      }
    }
  });
});

describe("the card's one command", () => {
  test("install where installing the agent is the step, logs where its pod is", () => {
    expect(getAiAgentCardCommand(notInstalledStatus())).toBe("install");
    expect(getAiAgentCardCommand(legacyStatus())).toBe("install");
    expect(getAiAgentCardCommand(legacyStatus({}, false))).toBe("install");
    expect(
      getAiAgentCardCommand(agentStatus({}, makeAgent({ isOnline: false }))),
    ).toBe("logs");
    for (const status of [
      agentStatus(),
      advancedStatus(),
      advancedStatus({}, false),
    ]) {
      expect(getAiAgentCardCommand(status)).toBeNull();
    }
  });

  test("the logs go to the namespace the agent reported, else the install namespace", () => {
    expect(getAiAgentPodNamespace(agentStatus())).toBe("monitoring");
    expect(
      getAiAgentPodNamespace(
        agentStatus(
          {},
          makeAgent({
            posture: { inCluster: true, podNamespace: undefined },
          }),
        ),
      ),
    ).toBe(KUBERNETES_AGENT_HELM_NAMESPACE);
    expect(getAiAgentPodNamespace(notInstalledStatus())).toBe(
      KUBERNETES_AGENT_HELM_NAMESPACE,
    );
    // A legacy Runner's pod namespace is not the agent's.
    expect(
      getAiAgentPodNamespace(
        legacyStatus({
          runner: {
            ...legacyStatus().runner!,
            posture: { inCluster: true, podNamespace: "old-ns" },
          },
        }),
      ),
    ).toBe(KUBERNETES_AGENT_HELM_NAMESPACE);
  });
});

describe("what the target may change", () => {
  test("read-only, a namespace list, or the whole cluster", () => {
    expect(describeAiAgentWriteAccess(undefined)).toBeNull();
    expect(describeAiAgentWriteAccess({ allowWrites: false })).toBe(
      "Read-only",
    );
    expect(describeAiAgentWriteAccess({})).toBe("Read-only");
    expect(
      describeAiAgentWriteAccess({ allowWrites: true, writeNamespaces: [] }),
    ).toBe("Can change: whole cluster");
    expect(
      describeAiAgentWriteAccess({
        allowWrites: true,
        writeNamespaces: ["web", "api"],
      }),
    ).toBe("Can change: web, api");
    // An older Runner that never said where.
    expect(describeAiAgentWriteAccess({ allowWrites: true })).toBe(
      "Can change the cluster",
    );
  });

  test("node operations are said only for a target that may write", () => {
    expect(
      describeAiAgentNodeOperations({
        allowWrites: true,
        allowNodeOperations: true,
      }),
    ).toBe("node operations on");
    expect(
      describeAiAgentNodeOperations({
        allowWrites: true,
        allowNodeOperations: false,
      }),
    ).toBe("node operations off");
    expect(describeAiAgentNodeOperations({ allowWrites: true })).toBeNull();
    expect(
      describeAiAgentNodeOperations({
        allowWrites: false,
        allowNodeOperations: true,
      }),
    ).toBeNull();
    expect(describeAiAgentNodeOperations(undefined)).toBeNull();
  });
});

describe("the meta line", () => {
  /*
   * The agent's version is drawn by the page with AgentVersion (an outdated
   * agent gets its sign and upgrade dialog), so the words leave it out and
   * say where it goes: after "last seen", for the cluster's own agent.
   */
  test("the agent: last seen, then its version (drawn by the page), kubectl's, and read-only", () => {
    expect(getAiAgentMetaParts(agentStatus())).toEqual([
      "last seen a minute ago",
      "kubectl v1.31.2",
      "Read-only",
    ]);

    const meta: AiAgentMeta = getAiAgentMeta(agentStatus());
    expect(meta.lastSeen).toBe("last seen a minute ago");
    expect(meta.showsAgentVersion).toBe(true);
    expect(meta.rest).toEqual(["kubectl v1.31.2", "Read-only"]);
  });

  test("the version is the agent's own: never shown for a Runner the cluster is reached through", () => {
    expect(getAiAgentMeta(legacyStatus()).showsAgentVersion).toBe(false);
    expect(getAiAgentMeta(advancedStatus()).showsAgentVersion).toBe(false);
    expect(getAiAgentMeta(notInstalledStatus())).toEqual({
      lastSeen: null,
      showsAgentVersion: false,
      rest: [],
    });
  });

  test("an agent row with nothing resolved yet still shows its version", () => {
    expect(
      getAiAgentMeta(agentStatus({ runner: null })).showsAgentVersion,
    ).toBe(true);
  });

  test("a writing agent names where it may change and whether nodes are included", () => {
    expect(
      getAiAgentMetaParts(
        agentStatus(
          {},
          makeAgent({
            agentVersion: "v14.2.0",
            posture: {
              inCluster: true,
              allowWrites: true,
              writeNamespaces: ["web", "api"],
              allowNodeOperations: true,
              kubectlVersion: "1.31.2",
            },
          }),
        ),
      ),
    ).toEqual([
      "last seen a minute ago",
      "kubectl v1.31.2",
      "Can change: web, api",
      "node operations on",
    ]);
  });

  test("the previous Runner has no agent version but the same scope reading", () => {
    expect(getAiAgentMetaParts(legacyStatus())).toEqual([
      "last seen 2 minutes ago",
      "kubectl v1.30.0",
      "Read-only",
    ]);
  });

  test("an advanced Runner shows no write scope: its credential's RBAC decides", () => {
    expect(getAiAgentMetaParts(advancedStatus())).toEqual([
      "last seen 3 minutes ago",
      "kubectl v1.29.1",
    ]);
  });

  test("nothing installed, nothing to say", () => {
    expect(getAiAgentMetaParts(notInstalledStatus())).toEqual([]);
  });

  test("an agent that never heartbeated has no last-seen part", () => {
    expect(
      getAiAgentMetaParts(
        agentStatus(
          {},
          makeAgent({
            lastAliveAt: undefined,
            agentVersion: undefined,
            posture: undefined,
          }),
        ),
      ),
    ).toEqual([]);
  });
});

/*
 * Where the cluster's investigation and fixes are set (status.
 * aiSettingsSource): while its Kubernetes AI agent sets them, the
 * "investigation off" step is changed on the chart, not with a Turn on
 * button the server would refuse.
 */
describe("settings the agent sets", () => {
  test.each([
    ["agent_configuration", "agent_configuration", true],
    ["agent_defaults", "agent_defaults", true],
    ["oneuptime", "oneuptime", false],
    // An older server sends nothing: the settings are edited here.
    [undefined, "oneuptime", false],
  ])(
    "status.aiSettingsSource %j reads as %s",
    (value: unknown, source: string, isSetByAgent: boolean) => {
      const status: KubernetesClusterAiAccessStatus = agentStatus({
        aiSettingsSource:
          value as KubernetesClusterAiAccessStatus["aiSettingsSource"],
      });

      expect(getKubernetesAiSettingsSource(status)).toBe(source);
      expect(isKubernetesAiSettingsSetByAgent(status)).toBe(isSetByAgent);
    },
  );

  test("investigation off, set by the agent: the step points at the chart and offers its command", () => {
    const investigationOff: KubernetesAiAccessGap = gap(
      "investigation_disabled",
      "investigation",
    );

    for (const source of ["agent_configuration", "agent_defaults"] as const) {
      const status: KubernetesClusterAiAccessStatus = agentStatus({
        aiSettingsSource: source,
        isInvestigationEnabled: false,
        gaps: [investigationOff],
      });

      expect(getAiAgentGapAction(investigationOff, status)).toBe(
        "set_investigation_in_agent",
      );
      expect(getAiAgentAttentionStepText(investigationOff, status)).toBe(
        KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT,
      );
      expect(KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT).toContain(
        "Kubernetes agent chart",
      );
    }
  });

  test("negative control: investigation off, chosen here, keeps the Turn on button", () => {
    const investigationOff: KubernetesAiAccessGap = gap(
      "investigation_disabled",
      "investigation",
    );
    const status: KubernetesClusterAiAccessStatus = agentStatus({
      aiSettingsSource: "oneuptime",
      isInvestigationEnabled: false,
      gaps: [investigationOff],
    });

    expect(getAiAgentGapAction(investigationOff, status)).toBe(
      "turn_on_investigation",
    );
    expect(getAiAgentAttentionStepText(investigationOff, status)).toBe(
      "Turn on AI investigation with kubectl.",
    );
  });
});

describe("the refused-registration warning", () => {
  test("warns about another agent that tried to register while this one was online", () => {
    const warning: string | null = getRefusedRegistrationWarning(
      makeAgent({
        lastRefusedRegistrationAt: minutesAgo(10),
        lastRefusedRegistrationReason: "previous_instance_online",
      }),
      NOW,
    );
    expect(warning).toMatch(
      /^Another agent tried to register for this cluster at .+ while this one was online\./,
    );
    expect(warning).toContain("clusterName");
  });

  test("an unknown reason still warns; the upgrade overlap with the previous Runner does not", () => {
    expect(
      getRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: minutesAgo(10) }),
        NOW,
      ),
    ).not.toBeNull();
    expect(
      getRefusedRegistrationWarning(
        makeAgent({
          lastRefusedRegistrationAt: minutesAgo(10),
          lastRefusedRegistrationReason: "legacy_runner_online",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  test("ages out, and says nothing without a refusal or an agent", () => {
    expect(
      getRefusedRegistrationWarning(
        makeAgent({
          lastRefusedRegistrationAt: new Date(
            NOW.getTime() - REFUSED_REGISTRATION_WARNING_WINDOW_MS - 1000,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toBeNull();
    expect(getRefusedRegistrationWarning(makeAgent(), NOW)).toBeNull();
    expect(getRefusedRegistrationWarning(null, NOW)).toBeNull();
    expect(
      getRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: "not a date" }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("the Needs attention card", () => {
  /*
   * One row per server gap, and no client-side checklist. Fixes being off
   * is a choice the "What AI may do" card shows with its own hint, so it is
   * the one gap left out — otherwise a default install could never read
   * "Ready".
   */
  test("lists every server gap except the fixes-off choice", () => {
    const status: KubernetesClusterAiAccessStatus = agentStatus({
      gaps: [
        gap("remediation_disabled", "remediation"),
        gap("investigation_disabled", "investigation"),
        gap("ai_balance_insufficient"),
      ],
    });
    expect(
      getAttentionGaps(status).map((item: KubernetesAiAccessGap): string => {
        return item.code;
      }),
    ).toEqual(["investigation_disabled", "ai_balance_insufficient"]);
    expect(CHOICE_GAP_CODES).toEqual(["remediation_disabled"]);
    expect(
      getAttentionGaps(
        agentStatus({ gaps: [gap("remediation_disabled", "remediation")] }),
      ),
    ).toEqual([]);
  });

  test("each row offers at most one action, the one that fixes it", () => {
    const status: KubernetesClusterAiAccessStatus = agentStatus();
    const expected: Array<[KubernetesAiAccessGapCode, string | null]> = [
      ["investigation_disabled", "turn_on_investigation"],
      ["project_ai_disabled", "open_ai_features"],
      /*
       * Retired: both switches were folded into Enable AI, but an older
       * server may still send them mid-rollout.
       */
      ["project_auto_remediation_disabled", "open_ai_features"],
      ["project_ai_command_execution_disabled", "open_ai_features"],
      ["llm_provider_missing", "open_llm_providers"],
      ["ai_balance_insufficient", "open_ai_credits"],
      ["last_access_check_failed", "test_connection"],
      // Already on the page as a command.
      ["ai_agent_not_connected", null],
      ["ai_agent_offline", null],
      ["remediation_write_access_missing", null],
      ["runner_missing", null],
      ["no_runner_bound", null],
    ];
    for (const [code, action] of expected) {
      expect({ code, action: getAiAgentGapAction(gap(code), status) }).toEqual({
        code,
        action,
      });
    }
  });

  test("Runner gaps link to the Runner only for an advanced binding", () => {
    for (const code of [
      "runner_offline",
      "runner_ai_commands_disabled",
      "runner_cluster_mismatch",
      "credential_missing",
      "credential_on_agent_runner",
    ] as Array<KubernetesAiAccessGapCode>) {
      expect(getAiAgentGapAction(gap(code), advancedStatus())).toBe(
        "view_runner",
      );
      // The previous in-cluster Runner is replaced by upgrading the chart.
      expect(getAiAgentGapAction(gap(code), legacyStatus())).toBeNull();
    }
  });

  test("nothing to test before anything can reach the cluster", () => {
    expect(
      getAiAgentGapAction(
        gap("last_access_check_failed"),
        notInstalledStatus(),
      ),
    ).toBeNull();
  });

  test("tells a user without permission who to ask", () => {
    expect(ASK_PROJECT_ADMIN_TEXT).toBe("Ask a project owner or admin.");
  });
});

/*
 * "Needs attention" as ONE item: a headline that says what OneUptime AI
 * cannot do on the cluster, then one short step per gap in this page's
 * words, each with the action its gap offers.
 */

// What each gap blocks, as KubernetesClusterAiAccessService sets it.
const SERVER_BLOCKS: Record<
  KubernetesAiAccessGapCode,
  KubernetesAiAccessGap["blocks"]
> = {
  ai_agent_not_connected: "both",
  ai_agent_offline: "both",
  ai_balance_insufficient: "both",
  runner_missing: "both",
  runner_offline: "both",
  runner_ai_commands_disabled: "both",
  runner_cluster_mismatch: "both",
  credential_missing: "both",
  investigation_disabled: "investigation",
  remediation_disabled: "remediation",
  remediation_write_access_missing: "remediation",
  project_ai_disabled: "both",
  llm_provider_missing: "both",
  // Kept in the union, no longer produced (an older server may send them).
  project_auto_remediation_disabled: "remediation",
  project_ai_command_execution_disabled: "remediation",
  no_runner_bound: "both",
  credential_on_agent_runner: "both",
  last_access_check_failed: "both",
};

const ALL_GAP_CODES: Array<KubernetesAiAccessGapCode> = Object.keys(
  SERVER_BLOCKS,
) as Array<KubernetesAiAccessGapCode>;

function serverGap(code: KubernetesAiAccessGapCode): KubernetesAiAccessGap {
  return gap(code, SERVER_BLOCKS[code]);
}

function stepTexts(attention: AiAgentAttention | null): Array<string> {
  return (attention?.steps || []).map((step: AiAgentAttentionStep): string => {
    return step.text;
  });
}

function stepCodes(
  attention: AiAgentAttention | null,
): Array<KubernetesAiAccessGapCode> {
  return (attention?.steps || []).map(
    (step: AiAgentAttentionStep): KubernetesAiAccessGapCode => {
      return step.gap.code;
    },
  );
}

const AGENT_NAME: string = KUBERNETES_AI_AGENT_DISPLAY_NAME;

const UPGRADE_STEP: string = `Upgrade the Kubernetes agent chart with the command above. The ${AGENT_NAME} replaces the previous in-cluster Runner.`;

const CHOOSE_CREDENTIAL_STEP: string = `With Change below, choose a Kubernetes credential the Runner may use, or clear the Runner to use the ${AGENT_NAME}.`;

describe("Needs attention, as one item", () => {
  test("nothing to show without gaps, or with only the fixes-off choice", () => {
    expect(getAiAgentAttention(agentStatus({ gaps: [] }), NOW)).toBeNull();
    expect(
      getAiAgentAttention(
        agentStatus({ gaps: [serverGap("remediation_disabled")] }),
        NOW,
      ),
    ).toBeNull();
  });

  test("a new cluster: one headline, two short steps", () => {
    const attention: AiAgentAttention | null = getAiAgentAttention(
      notInstalledStatus({
        isInvestigationEnabled: false,
        gaps: [
          serverGap("ai_agent_not_connected"),
          serverGap("investigation_disabled"),
          serverGap("remediation_disabled"),
        ],
      }),
      NOW,
    );

    expect(attention).toEqual({
      title: "OneUptime AI can't investigate this cluster",
      steps: [
        {
          gap: serverGap("ai_agent_not_connected"),
          text: "Install the Kubernetes AI agent with the command above.",
          action: null,
        },
        {
          gap: serverGap("investigation_disabled"),
          text: "Turn on AI investigation with kubectl.",
          action: "turn_on_investigation",
        },
      ],
    });
  });

  test("keeps the server's order and gives each step its gap's action", () => {
    const gaps: Array<KubernetesAiAccessGap> = [
      serverGap("ai_agent_offline"),
      serverGap("investigation_disabled"),
      serverGap("remediation_write_access_missing"),
      serverGap("project_ai_disabled"),
      serverGap("llm_provider_missing"),
      serverGap("ai_balance_insufficient"),
      serverGap("project_auto_remediation_disabled"),
    ];
    const status: KubernetesClusterAiAccessStatus = agentStatus(
      {
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps,
      },
      silentAgent(),
    );
    const attention: AiAgentAttention = getAiAgentAttention(status, NOW)!;

    expect(stepCodes(attention)).toEqual(
      gaps.map((item: KubernetesAiAccessGap): KubernetesAiAccessGapCode => {
        return item.code;
      }),
    );
    expect(
      attention.steps.map((step: AiAgentAttentionStep): string | null => {
        return step.action;
      }),
    ).toEqual([
      null,
      "turn_on_investigation",
      null,
      "open_ai_features",
      "open_llm_providers",
      "open_ai_credits",
      "open_ai_features",
    ]);
    for (const step of attention.steps) {
      expect(step.action).toBe(getAiAgentGapAction(step.gap, status));
      expect(step.text).toBe(
        getAiAgentAttentionStepText(step.gap, status, NOW),
      );
    }
    expect(attention.title).toBe(getAiAgentAttentionTitle(status));
  });

  test("an advanced Runner's steps link to the Runner", () => {
    const attention: AiAgentAttention | null = getAiAgentAttention(
      advancedStatus(
        {
          isInvestigationReady: false,
          gaps: [
            serverGap("runner_offline"),
            serverGap("runner_ai_commands_disabled"),
            serverGap("credential_missing"),
          ],
        },
        false,
      ),
      NOW,
    );

    expect(
      attention?.steps.map((step: AiAgentAttentionStep): string | null => {
        return step.action;
      }),
    ).toEqual(["view_runner", "view_runner", "view_runner"]);
  });

  test("one gap is one step", () => {
    const attention: AiAgentAttention | null = getAiAgentAttention(
      agentStatus({
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [serverGap("investigation_disabled")],
      }),
      NOW,
    );

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this cluster",
    );
    expect(stepTexts(attention)).toEqual([
      "Turn on AI investigation with kubectl.",
    ]);
  });

  test("reads the offline wording at the time it is given", () => {
    const status: KubernetesClusterAiAccessStatus = agentStatus(
      { isInvestigationReady: false, gaps: [serverGap("ai_agent_offline")] },
      signedOffAgent(),
    );

    expect(stepTexts(getAiAgentAttention(status, NOW))[0]).toMatch(
      /^Wait a few minutes/,
    );
    // Ten minutes on, the sign-off it never came back from.
    expect(
      stepTexts(
        getAiAgentAttention(status, new Date(NOW.getTime() + 10 * 60 * 1000)),
      )[0],
    ).toMatch(/^Bring the Kubernetes AI agent back online/);
  });
});

describe("Needs attention's headline", () => {
  test("investigation blocked, fixes off: only investigation is named", () => {
    expect(
      getAiAgentAttentionTitle(
        notInstalledStatus({
          gaps: [
            serverGap("ai_agent_not_connected"),
            serverGap("remediation_disabled"),
          ],
        }),
      ),
    ).toBe("OneUptime AI can't investigate this cluster");
  });

  test.each([
    KubernetesAiRemediationMode.RequireApproval,
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ])(
    "investigation and fixes blocked with fixes on (%s): both are named",
    (mode: KubernetesAiRemediationMode) => {
      expect(
        getAiAgentAttentionTitle(
          notInstalledStatus({
            remediationMode: mode,
            gaps: [serverGap("ai_agent_not_connected")],
          }),
        ),
      ).toBe("OneUptime AI can't investigate this cluster or run fixes on it");
    },
  );

  test("investigation off while fixes are on and working: only investigation", () => {
    expect(
      getAiAgentAttentionTitle(
        agentStatus({
          isInvestigationEnabled: false,
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          isRemediationReady: true,
          gaps: [serverGap("investigation_disabled")],
        }),
      ),
    ).toBe("OneUptime AI can't investigate this cluster");
  });

  test("a read-only agent while fixes are on: only fixes are named", () => {
    expect(
      getAiAgentAttentionTitle(
        agentStatus({
          remediationMode: KubernetesAiRemediationMode.Automatic,
          gaps: [serverGap("remediation_write_access_missing")],
        }),
      ),
    ).toBe("OneUptime AI can't run fixes on this cluster");
  });

  // The retired switches an older server may still send mid-rollout.
  test("retired project switches that only stopped fixes name only fixes", () => {
    expect(
      getAiAgentAttentionTitle(
        advancedStatus({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          gaps: [
            serverGap("project_auto_remediation_disabled"),
            serverGap("project_ai_command_execution_disabled"),
          ],
        }),
      ),
    ).toBe("OneUptime AI can't run fixes on this cluster");
  });

  test("a gap that blocks only fixes still says fixes when they are off", () => {
    expect(
      getAiAgentAttentionTitle(
        agentStatus({
          gaps: [
            serverGap("remediation_disabled"),
            serverGap("project_auto_remediation_disabled"),
          ],
        }),
      ),
    ).toBe("OneUptime AI can't run fixes on this cluster");
  });

  test("the fixes-off choice never counts toward the headline", () => {
    expect(
      getAiAgentAttentionTitle(
        agentStatus({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          gaps: [
            // Not what the server sends together, but the choice must not count.
            serverGap("remediation_disabled"),
            serverGap("investigation_disabled"),
          ],
        }),
      ),
    ).toBe("OneUptime AI can't investigate this cluster");
  });

  test("an unknown fixes mode reads as off", () => {
    expect(
      getAiAgentAttentionTitle(
        notInstalledStatus({
          remediationMode: "Sometimes" as KubernetesAiRemediationMode,
          gaps: [serverGap("ai_agent_not_connected")],
        }),
      ),
    ).toBe("OneUptime AI can't investigate this cluster");
  });

  test("a gap that blocks neither falls back to a plain sentence", () => {
    expect(
      getAiAgentAttentionTitle(
        agentStatus({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          gaps: [
            {
              ...serverGap("ai_agent_offline"),
              blocks: "nothing" as KubernetesAiAccessGap["blocks"],
            },
          ],
        }),
      ),
    ).toBe("OneUptime AI can't do all of its job on this cluster");
  });

  test("every target, the same three headlines", () => {
    for (const status of [
      agentStatus({ gaps: [serverGap("ai_agent_offline")] }, silentAgent()),
      legacyStatus({ gaps: [serverGap("runner_offline")] }, false),
      advancedStatus({ gaps: [serverGap("credential_missing")] }),
      notInstalledStatus(),
    ]) {
      expect(getAiAgentAttentionTitle(status)).toBe(
        "OneUptime AI can't investigate this cluster",
      );
      expect(
        getAiAgentAttentionTitle({
          ...status,
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ).toBe("OneUptime AI can't investigate this cluster or run fixes on it");
    }
  });
});

describe("Needs attention's steps", () => {
  const fixesOn: Partial<KubernetesClusterAiAccessStatus> = {
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
  };

  test.each([
    [
      "ai_agent_not_connected",
      "Install the Kubernetes AI agent with the command above.",
    ],
    ["investigation_disabled", "Turn on AI investigation with kubectl."],
    ["project_ai_disabled", "Turn on AI for this project."],
    // Retired: Enable AI covers both, so an older server's gap asks for it.
    ["project_auto_remediation_disabled", "Turn on AI for this project."],
    ["project_ai_command_execution_disabled", "Turn on AI for this project."],
    [
      "llm_provider_missing",
      "Add an AI provider for this project, or use OneUptime AI credits.",
    ],
    [
      "ai_balance_insufficient",
      "Add AI credits to this project, or turn on auto-recharge.",
    ],
    [
      "runner_missing",
      "Reload this page. The Runner this cluster was bound to was just deleted.",
    ],
  ])("%s: %s", (code: string, text: string) => {
    expect(
      getAiAgentAttentionStepText(
        serverGap(code as KubernetesAiAccessGapCode),
        agentStatus(),
        NOW,
      ),
    ).toBe(text);
  });

  test("an old server's no_runner_bound reads as the agent not installed", () => {
    expect(
      getAiAgentAttentionStepText(
        serverGap("no_runner_bound"),
        notInstalledStatus(),
        NOW,
      ),
    ).toBe("Install the Kubernetes AI agent with the command above.");
  });

  describe("an offline agent", () => {
    const BRING_BACK: string =
      "Bring the Kubernetes AI agent back online. Its logs say why it is offline (the command is above).";

    test("whose heartbeats stopped: bring it back, its logs say why", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("ai_agent_offline"),
          agentStatus({}, silentAgent()),
          NOW,
        ),
      ).toBe(BRING_BACK);
    });

    test("that signed off long ago: bring it back", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("ai_agent_offline"),
          agentStatus({}, goneAgent()),
          NOW,
        ),
      ).toBe(BRING_BACK);
    });

    /*
     * A helm upgrade's old pod signs off and the new one registers within
     * minutes: the card says it reconnects on its own, and so does the step.
     */
    test("right after a sign-off or reset: wait, then read its logs", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("ai_agent_offline"),
          agentStatus({}, signedOffAgent()),
          NOW,
        ),
      ).toBe(
        "Wait a few minutes for the Kubernetes AI agent to reconnect. If it does not, its logs say why (the command is above).",
      );
    });

    test("from an older server without the agent row: bring it back", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("ai_agent_offline"),
          agentStatus({ aiAgent: null }, silentAgent()),
          NOW,
        ),
      ).toBe(BRING_BACK);
    });
  });

  describe("the previous in-cluster Runner is replaced, not fixed", () => {
    test.each([
      "runner_offline",
      "runner_ai_commands_disabled",
      "runner_cluster_mismatch",
      "credential_missing",
      "credential_on_agent_runner",
    ])("%s: upgrade the chart with the command above", (code: string) => {
      for (const isOnline of [true, false]) {
        expect(
          getAiAgentAttentionStepText(
            serverGap(code as KubernetesAiAccessGapCode),
            legacyStatus({}, isOnline),
            NOW,
          ),
        ).toBe(UPGRADE_STEP);
      }
    });

    test("read-only with fixes on: upgrade to the agent with the write-access commands below", () => {
      const status: KubernetesClusterAiAccessStatus = legacyStatus(fixesOn);

      expect(shouldShowWriteAccessCommands(status)).toBe(true);
      expect(
        getAiAgentAttentionStepText(
          serverGap("remediation_write_access_missing"),
          status,
          NOW,
        ),
      ).toBe(
        "Upgrade to the Kubernetes AI agent with write access, using the commands below.",
      );
    });
  });

  describe("a Runner an operator bound", () => {
    test("offline: start it", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("runner_offline"),
          advancedStatus({}, false),
          NOW,
        ),
      ).toBe("Start the Runner and make sure it can reach your OneUptime URL.");
    });

    test("not accepting AI commands: turn them on, on the Runner", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("runner_ai_commands_disabled"),
          advancedStatus(),
          NOW,
        ),
      ).toBe('Turn on "Runs AI Remediation Commands" on the Runner.');
    });

    test("without a credential, or not saying which cluster it is in: choose a credential or clear it", () => {
      for (const code of [
        "credential_missing",
        "runner_cluster_mismatch",
      ] as Array<KubernetesAiAccessGapCode>) {
        expect(
          getAiAgentAttentionStepText(serverGap(code), advancedStatus(), NOW),
        ).toBe(CHOOSE_CREDENTIAL_STEP);
      }
    });

    test("an old server's credential_on_agent_runner: choose a dashboard Runner or clear it", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("credential_on_agent_runner"),
          advancedStatus(),
          NOW,
        ),
      ).toBe(
        "With Change below, choose a Runner created in the dashboard, or clear the Runner to use the Kubernetes AI agent.",
      );
    });

    test("read-only with fixes on: the setting on the Runner's host, not the chart's commands", () => {
      const status: KubernetesClusterAiAccessStatus = advancedStatus({
        ...fixesOn,
        runner: {
          ...advancedStatus().runner!,
          posture: { inCluster: true, allowWrites: false },
        },
      });

      expect(shouldShowWriteAccessCommands(status)).toBe(false);
      expect(
        getAiAgentAttentionStepText(
          serverGap("remediation_write_access_missing"),
          status,
          NOW,
        ),
      ).toBe(
        `Set ${KUBECTL_ALLOW_WRITES_ENV}=true on the Runner's host and restart it.`,
      );
    });
  });

  describe("the agent", () => {
    test("read-only with fixes on: the write-access commands below", () => {
      const status: KubernetesClusterAiAccessStatus = agentStatus(fixesOn);

      expect(shouldShowWriteAccessCommands(status)).toBe(true);
      expect(
        getAiAgentAttentionStepText(
          serverGap("remediation_write_access_missing"),
          status,
          NOW,
        ),
      ).toBe(
        "Give the Kubernetes AI agent write access with the commands below.",
      );
    });

    test("that has not reported this cluster: reset it", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("runner_cluster_mismatch"),
          agentStatus({ accessMethod: "none" }),
          NOW,
        ),
      ).toBe(
        "Reset the Kubernetes AI agent. It reconnects on its own within a few minutes.",
      );
    });
  });

  describe("a step this page has no words for keeps the server's", () => {
    test("a Runner gap without a Runner", () => {
      for (const code of [
        "runner_offline",
        "runner_ai_commands_disabled",
        "credential_missing",
        "credential_on_agent_runner",
      ] as Array<KubernetesAiAccessGapCode>) {
        for (const status of [agentStatus(), notInstalledStatus()]) {
          expect(
            getAiAgentAttentionStepText(serverGap(code), status, NOW),
          ).toBe(`next step for ${code}`);
        }
      }
      expect(
        getAiAgentAttentionStepText(
          serverGap("runner_cluster_mismatch"),
          notInstalledStatus(),
          NOW,
        ),
      ).toBe("next step for runner_cluster_mismatch");
    });

    test("write access while the page shows no commands for it", () => {
      // Fixes off, which the server never sends with this gap.
      expect(
        getAiAgentAttentionStepText(
          serverGap("remediation_write_access_missing"),
          agentStatus(),
          NOW,
        ),
      ).toBe("next step for remediation_write_access_missing");
    });

    test("a failed access check: test again, once there is something to test", () => {
      expect(
        getAiAgentAttentionStepText(
          serverGap("last_access_check_failed"),
          agentStatus(),
          NOW,
        ),
      ).toBe("Test the connection again.");
      expect(
        getAiAgentAttentionStepText(
          serverGap("last_access_check_failed"),
          notInstalledStatus(),
          NOW,
        ),
      ).toBe("next step for last_access_check_failed");
    });

    test("a gap this build does not know: the server's next step, or its title", () => {
      const unknown: KubernetesAiAccessGap = {
        ...serverGap("ai_agent_offline"),
        code: "something_new" as KubernetesAiAccessGapCode,
        title: "Something new is wrong",
        nextStep: "Do the new thing.",
      };

      expect(getAiAgentAttentionStepText(unknown, agentStatus(), NOW)).toBe(
        "Do the new thing.",
      );
      expect(
        getAiAgentAttentionStepText(
          { ...unknown, nextStep: "" },
          agentStatus(),
          NOW,
        ),
      ).toBe("Something new is wrong");
    });
  });

  /*
   * For every gap code, on every target it can come with, the step is this
   * page's own sentence: never the server's, never a pointer back to this
   * page, never the helm or kubectl command the card already shows.
   */
  test("every gap on its own target reads in this page's words", () => {
    const targetFor: (
      code: KubernetesAiAccessGapCode,
    ) => Array<KubernetesClusterAiAccessStatus> = (
      code: KubernetesAiAccessGapCode,
    ): Array<KubernetesClusterAiAccessStatus> => {
      switch (code) {
        case "ai_agent_not_connected":
        case "no_runner_bound":
        case "runner_missing":
          return [notInstalledStatus()];
        case "ai_agent_offline":
          return [
            agentStatus({}, silentAgent()),
            agentStatus({}, signedOffAgent()),
            agentStatus({}, goneAgent()),
          ];
        case "runner_offline":
          return [legacyStatus({}, false), advancedStatus({}, false)];
        case "runner_ai_commands_disabled":
        case "credential_missing":
        case "credential_on_agent_runner":
          return [legacyStatus(), advancedStatus()];
        case "runner_cluster_mismatch":
          return [agentStatus(), legacyStatus(), advancedStatus()];
        case "remediation_write_access_missing":
          return [
            agentStatus(fixesOn),
            legacyStatus(fixesOn),
            advancedStatus({
              ...fixesOn,
              runner: {
                ...advancedStatus().runner!,
                posture: { inCluster: true, allowWrites: false },
              },
            }),
          ];
        default:
          return [agentStatus(), legacyStatus(), advancedStatus()];
      }
    };

    for (const code of ALL_GAP_CODES) {
      if (CHOICE_GAP_CODES.includes(code)) {
        continue;
      }

      for (const status of targetFor(code)) {
        const text: string = getAiAgentAttentionStepText(
          serverGap(code),
          status,
          NOW,
        );

        expect({ code, text }).toEqual({
          code,
          text: expect.stringMatching(/^[A-Z].*\.$/),
        });
        expect({ code, text }).toEqual({
          code,
          text: expect.not.stringMatching(
            /next step for|title of|AI → Agent|AI agent page|helm |kubectl logs/,
          ),
        });
      }
    }
  });
});

describe("the write-access commands", () => {
  test("show when fixes are on and the in-cluster target is read-only", () => {
    for (const mode of [
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ]) {
      expect(
        shouldShowWriteAccessCommands(agentStatus({ remediationMode: mode })),
      ).toBe(true);
      // The previous Runner is replaced by the same aiAgent.* upgrade.
      expect(
        shouldShowWriteAccessCommands(legacyStatus({ remediationMode: mode })),
      ).toBe(true);
    }
  });

  test("never while fixes are off, the agent already writes, or the target is advanced or missing", () => {
    expect(shouldShowWriteAccessCommands(agentStatus())).toBe(false);
    expect(
      shouldShowWriteAccessCommands(
        agentStatus(
          { remediationMode: KubernetesAiRemediationMode.RequireApproval },
          makeAgent({ posture: { inCluster: true, allowWrites: true } }),
        ),
      ),
    ).toBe(false);
    expect(
      shouldShowWriteAccessCommands(
        advancedStatus({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ),
    ).toBe(false);
    expect(
      shouldShowWriteAccessCommands(
        notInstalledStatus({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ),
    ).toBe(false);
  });
});

describe("the automatic-investigation footer", () => {
  test("reads the project's two opt-ins, On or Off", () => {
    expect(
      getAutomaticInvestigationLine({ incidents: true, alerts: false }),
    ).toBe(
      "Automatic investigation for new incidents in this project: On · alerts: Off",
    );
    expect(
      getAutomaticInvestigationLine({ incidents: false, alerts: true }),
    ).toBe(
      "Automatic investigation for new incidents in this project: Off · alerts: On",
    );
  });

  /*
   * The line was built with "On" and "Off" glued in, so no locale file
   * could hold it. It is one sentence with a slot for each opt-in, and the
   * two states are translated along with it.
   */
  test("the line is one whole sentence with a slot for each opt-in", () => {
    expect(AUTOMATIC_INVESTIGATION_LINE).toBe(
      "Automatic investigation for new incidents in this project: {{incidents}} · alerts: {{alerts}}",
    );
    expect(
      getAutomaticInvestigationLine({ incidents: true, alerts: true }),
    ).toBe(
      "Automatic investigation for new incidents in this project: On · alerts: On",
    );
    expect(
      getAutomaticInvestigationLine({ incidents: false, alerts: false }),
    ).toBe(
      "Automatic investigation for new incidents in this project: Off · alerts: Off",
    );
  });

  test("a malformed or missing field is not shown", () => {
    expect(
      getAutomaticInvestigation(
        agentStatus({
          automaticInvestigation: {
            incidents: "yes",
            alerts: false,
          } as unknown as KubernetesClusterAiAccessStatus["automaticInvestigation"],
        }),
      ),
    ).toBeNull();
    expect(
      getAutomaticInvestigation(
        agentStatus({
          // An older server sends no opt-ins, which the current type requires.
          automaticInvestigation:
            undefined as unknown as KubernetesClusterAiAccessStatus["automaticInvestigation"],
        }),
      ),
    ).toBeNull();
    expect(getAutomaticInvestigation(agentStatus())).toEqual({
      incidents: false,
      alerts: false,
    });
  });

  test("Turn on writes only the flags that are off", () => {
    expect(
      getAutomaticInvestigationTurnOnChanges({
        incidents: false,
        alerts: false,
      }),
    ).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
    });
    expect(
      getAutomaticInvestigationTurnOnChanges({
        incidents: true,
        alerts: false,
      }),
    ).toEqual({ enableAutomaticAlertInvestigation: true });
    expect(
      getAutomaticInvestigationTurnOnChanges({
        incidents: false,
        alerts: true,
      }),
    ).toEqual({ enableAutomaticIncidentInvestigation: true });
    expect(
      getAutomaticInvestigationTurnOnChanges({ incidents: true, alerts: true }),
    ).toEqual({});
  });

  /*
   * The opt-in is project-wide, so the dialog says so before anything is
   * turned on, and points at where its limits live.
   */
  test("the confirmation says it applies to the whole project and where the limits are", () => {
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: false, alerts: false },
        projectName: "Acme",
      }),
    ).toBe(
      "This applies to every new incident and alert in Acme, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: false, alerts: true },
        projectName: "Acme",
      }),
    ).toBe(
      "This applies to every new incident in Acme, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: true, alerts: false },
        projectName: "Acme",
      }),
    ).toBe(
      "This applies to every new alert in Acme, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
  });

  /*
   * A sentence with the project's name already in it is no key a locale
   * file can hold, so it stayed English in every language. Each case is one
   * whole sentence with a {{project}} slot instead - never pieces glued
   * together - which a locale words its own way.
   */
  test("each case is one whole sentence with a {{project}} slot", () => {
    expect(AUTOMATIC_INVESTIGATION_CONFIRMATIONS).toEqual({
      incidentsAndAlerts:
        "This applies to every new incident and alert in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
      incidents:
        "This applies to every new incident in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
      alerts:
        "This applies to every new alert in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
    });
  });

  test("a project whose name the page does not know reads as this project", () => {
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: false, alerts: false },
      }),
    ).toBe(
      "This applies to every new incident and alert in this project, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: true, alerts: false },
        projectName: "",
      }),
    ).toBe(
      "This applies to every new alert in this project, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
  });

  // The name is the user's: it goes in as written, never read as a slot.
  test("the project's name goes into the sentence as written", () => {
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: false, alerts: true },
        projectName: "Ops {{project}}",
      }),
    ).toBe(
      "This applies to every new incident in Ops {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
    );
  });
});

describe("switching an advanced binding to the AI agent", () => {
  test("is offered only while the agent is online", () => {
    expect(canSwitchToAiAgent(advancedStatus())).toBe(true);
    expect(
      canSwitchToAiAgent(
        advancedStatus({ aiAgent: makeAgent({ isOnline: false }) }),
      ),
    ).toBe(false);
    expect(canSwitchToAiAgent(advancedStatus({ aiAgent: null }))).toBe(false);
    // Not an advanced binding: nothing to switch.
    expect(canSwitchToAiAgent(agentStatus())).toBe(false);
    expect(canSwitchToAiAgent(legacyStatus({ aiAgent: makeAgent() }))).toBe(
      false,
    );
  });
});

describe("the Overview's AI agent card", () => {
  test("Connected, Offline or Not installed", () => {
    expect(getAiAgentOverviewState(agentStatus())).toEqual({
      text: "Connected",
      tone: "success",
    });
    expect(getAiAgentOverviewState(legacyStatus())).toEqual({
      text: "Connected",
      tone: "success",
    });
    expect(getAiAgentOverviewState(advancedStatus())).toEqual({
      text: "Connected",
      tone: "success",
    });
    for (const status of [
      agentStatus({}, makeAgent({ isOnline: false })),
      legacyStatus({}, false),
      advancedStatus({}, false),
    ]) {
      expect(getAiAgentOverviewState(status)).toEqual({
        text: "Offline",
        tone: "danger",
      });
    }
    expect(getAiAgentOverviewState(notInstalledStatus())).toEqual({
      text: "Not installed",
      tone: "neutral",
    });
  });
});

/*
 * Everything this module puts on the AI agent page and the Overview's card
 * is looked up in the Dashboard's locale files (src/Locales/README.md): a
 * constant is a key, and a function answers with whole keyed sentences,
 * their values in {{placeholders}}. Most of it used to be plain strings and
 * template literals with the values glued in, which read English in every
 * language.
 *
 * A pseudo-locale wraps every en.json entry in ‹ ›, so a sentence that was
 * looked up comes back wrapped, and so does a word translated along with
 * it. These run last: they set up the global i18next instance the functions
 * read, which each jest file has to itself.
 */
describe("in the reader's language", () => {
  const ENGLISH: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const LOOKED_UP: RegExp = /^‹[^]*›$/;

  const fixesOn: Partial<KubernetesClusterAiAccessStatus> = {
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
  };

  // Every state, and each branch a step's wording depends on.
  const STATUSES: Array<KubernetesClusterAiAccessStatus> = [
    agentStatus(),
    agentStatus(fixesOn),
    agentStatus({ ...fixesOn, aiSettingsSource: "agent_configuration" }),
    agentStatus({}, silentAgent()),
    agentStatus({}, signedOffAgent()),
    agentStatus({}, goneAgent()),
    notInstalledStatus(),
    legacyStatus(fixesOn),
    legacyStatus({}, false),
    advancedStatus(fixesOn),
    advancedStatus({}, false),
    advancedStatus({ credentialName: undefined }),
    advancedStatus({ credentialName: undefined }, false),
    advancedStatus({ runner: { ...advancedStatus().runner!, name: "" } }),
    advancedStatus({
      ...fixesOn,
      runner: {
        ...advancedStatus().runner!,
        posture: { inCluster: true, allowWrites: false },
      },
    }),
  ];

  beforeAll(async () => {
    const pseudo: Record<string, string> = {};

    for (const [key, value] of Object.entries(ENGLISH)) {
      if (typeof value === "string") {
        pseudo[key] = `‹${value}›`;
      }
    }

    await i18next.init({
      lng: "xx",
      fallbackLng: "en",
      resources: { xx: { translation: pseudo } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("the page's constants are keys in en.json", () => {
    for (const key of [
      AI_AGENT_PAGE_TITLE,
      AI_AGENT_PAGE_SUBTITLE,
      AI_AGENT_READY_TEXT,
      AI_AGENT_NOT_INSTALLED_TEXT,
      AI_AGENT_OTHER_RELEASE_TEXT,
      AI_AGENT_LEGACY_RUNNER_TEXT,
      AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT,
      AI_AGENT_SIGNED_OFF_TEXT,
      AI_AGENT_GONE_TEXT,
      AI_AGENT_SILENT_TEXT,
      ASK_PROJECT_ADMIN_TEXT,
      KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT,
      AUTOMATIC_INVESTIGATION_LINE,
      ...Object.values(AUTOMATIC_INVESTIGATION_CONFIRMATIONS),
    ]) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("every state's sentence is looked up whole", () => {
    for (const status of STATUSES) {
      expect({
        state: getAiAgentCardState(status),
        sentence: getAiAgentStateSentence(status, NOW),
      }).toEqual({
        state: getAiAgentCardState(status),
        sentence: expect.stringMatching(LOOKED_UP),
      });
    }

    // The window goes in as a value; the unnamed Runner is translated too.
    expect(getAiAgentStateSentence(agentStatus({}, silentAgent()), NOW)).toBe(
      "‹The AI agent has not checked in for over 5 minutes. Check its pod:›",
    );
    expect(
      getAiAgentStateSentence(
        advancedStatus({ runner: { ...advancedStatus().runner!, name: "" } }),
        NOW,
      ),
    ).toBe(
      '‹Reached through Runner "‹(unnamed)›" with credential "prod token".›',
    );
  });

  test("the pill says a key the Pill looks up, or a sentence already looked up", () => {
    for (const status of STATUSES) {
      const text: string = getAiAgentStatusPill(status).text;

      expect(LOOKED_UP.test(text) || ENGLISH[text] === text).toBe(true);
    }
  });

  test("the meta line, except kubectl's own version", () => {
    for (const status of STATUSES) {
      for (const part of getAiAgentMetaParts(status)) {
        if (part.startsWith("kubectl v")) {
          continue;
        }

        expect(part).toMatch(LOOKED_UP);
      }
    }

    expect(
      getAiAgentMetaParts(
        agentStatus(
          {},
          makeAgent({
            posture: {
              ...makeAgent().posture!,
              allowWrites: true,
              writeNamespaces: ["web", "api"],
              allowNodeOperations: true,
            },
          }),
        ),
      ).slice(1),
    ).toEqual([
      "kubectl v1.31.2",
      "‹Can change: web, api›",
      "‹node operations on›",
    ]);
  });

  test("the headline and every step: the page's words looked up, or the server's untouched", () => {
    for (const status of STATUSES) {
      for (const code of ALL_GAP_CODES) {
        const text: string = getAiAgentAttentionStepText(
          serverGap(code),
          status,
          NOW,
        );

        expect({ code, text }).toEqual({
          code,
          text: LOOKED_UP.test(text) ? text : `next step for ${code}`,
        });
      }

      const attention: AiAgentAttention | null = getAiAgentAttention(
        { ...status, gaps: ALL_GAP_CODES.map(serverGap) },
        NOW,
      );

      expect(attention?.title).toMatch(LOOKED_UP);
    }

    // The agent's name is translated along with the step.
    expect(
      getAiAgentAttentionStepText(
        serverGap("ai_agent_not_connected"),
        notInstalledStatus(),
        NOW,
      ),
    ).toBe("‹Install the ‹Kubernetes AI agent› with the command above.›");
  });

  test("the warning, the opt-in line and the confirmation", () => {
    expect(
      getRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: minutesAgo(10) }),
        NOW,
      ),
    ).toMatch(LOOKED_UP);
    expect(
      getAutomaticInvestigationLine({ incidents: true, alerts: false }),
    ).toBe(
      "‹Automatic investigation for new incidents in this project: ‹On› · alerts: ‹Off››",
    );
    expect(
      getAutomaticInvestigationConfirmation({
        settings: { incidents: false, alerts: false },
        projectName: "Acme",
      }),
    ).toMatch(LOOKED_UP);
  });
});
