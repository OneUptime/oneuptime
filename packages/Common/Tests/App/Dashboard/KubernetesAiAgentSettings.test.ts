import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_AI_SETTINGS_CLUSTER_WIDE_LABEL,
  KUBERNETES_AI_SETTINGS_FIXES_OFF_NOTE,
  KUBERNETES_AI_SETTINGS_SCOPED_LABEL,
  KUBERNETES_AI_SETTINGS_SET_BY_TEXT,
  canKubernetesAgentSetAiSettings,
  getKubernetesAiSettingsChoice,
  getKubernetesAiSettingsInstructions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentSettings";
import {
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentScopedCommandNote,
  getAiAgentWriteDisclosure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  AGENT_AI_SETTINGS_FIXES_ORDER,
  AgentAiSettingsInstructions,
  AgentAiSettingsWay,
  areFixesOn,
  getInitialAgentAiSettingsChoice,
  isSameAgentAiSettingsChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AgentAiSettingsInstructions";
import { AgentAiSettingsChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { AGENT_AI_FIXES_MODES } from "../../../Types/AI/AgentAiSettings";
import {
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The cluster AI agent page's "Change what AI may do" for settings its
 * Kubernetes AI agent sets: which clusters can take their settings from
 * the agent, what is in effect as a choice, and the chart command for each
 * choice — the page's own helm upgrades (getAiAgentHelmCommands), with the
 * write-access variants exactly when fixes need write access the agent
 * does not have yet.
 */

function makeAgent(allowWrites: boolean): KubernetesAiAgentSummary {
  return {
    id: "agent-1",
    isOnline: true,
    connectionStatus: "connected",
    lastAliveAt: new Date().toISOString(),
    agentVersion: "14.2.0",
    posture: {
      clusterIdentifier: "prod-east",
      inCluster: true,
      allowWrites,
      kubectlVersion: "v1.31.2",
    },
  };
}

function agentStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  allowWrites: boolean = false,
): KubernetesClusterAiAccessStatus {
  const agent: KubernetesAiAgentSummary = makeAgent(allowWrites);

  return {
    clusterId: "c1",
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: agent.id,
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: true,
      lastAliveAt: agent.lastAliveAt,
      canRunAiCommands: true,
      posture: agent.posture,
    },
    accessMethod: "in_cluster",
    aiAgent: agent,
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    automaticInvestigation: { incidents: false, alerts: false },
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const LEGACY_RUNNER: KubernetesClusterAiAccessStatus["runner"] = {
  id: "runner-1",
  name: "kubernetes-agent/prod-east",
  isOnline: true,
  canRunAiCommands: true,
  posture: { clusterIdentifier: "prod-east", inCluster: true },
};

const ADVANCED_RUNNER: KubernetesClusterAiAccessStatus["runner"] = {
  id: "runner-2",
  name: "ops-runner",
  kind: "runner",
  isOnline: true,
  canRunAiCommands: true,
  posture: { inCluster: false },
};

describe("which clusters can take their settings from the agent", () => {
  test("a cluster its own Kubernetes AI agent serves", () => {
    expect(canKubernetesAgentSetAiSettings(agentStatus())).toBe(true);
    // An agent row with nothing resolved yet is still the agent's.
    expect(canKubernetesAgentSetAiSettings(agentStatus({ runner: null }))).toBe(
      true,
    );
  });

  test("not without an agent, nor while a Runner runs its commands", () => {
    expect(
      canKubernetesAgentSetAiSettings(
        agentStatus({ aiAgent: null, runner: null }),
      ),
    ).toBe(false);
    expect(
      canKubernetesAgentSetAiSettings(
        agentStatus({ runner: LEGACY_RUNNER, accessMethod: "in_cluster" }),
      ),
    ).toBe(false);
    expect(
      canKubernetesAgentSetAiSettings(
        agentStatus({ runner: ADVANCED_RUNNER, accessMethod: "credential" }),
      ),
    ).toBe(false);
  });
});

describe("what is in effect, as a choice", () => {
  test("the status's switch and mode", () => {
    expect(
      getKubernetesAiSettingsChoice(
        agentStatus({
          isInvestigationEnabled: false,
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ),
    ).toEqual({ investigation: false, fixes: "BypassApproval" });
  });

  test("a mode this build does not know reads as Off", () => {
    expect(
      getKubernetesAiSettingsChoice(
        agentStatus({
          remediationMode: "Everything" as KubernetesAiRemediationMode,
        }),
      ).fixes,
    ).toBe("Disabled");
  });

  test("the dialog starts on what is in effect, or with investigation on when a step asked", () => {
    const current: AgentAiSettingsChoice = {
      investigation: false,
      fixes: "Automatic",
    };

    expect(getInitialAgentAiSettingsChoice({ current })).toEqual(current);
    expect(
      getInitialAgentAiSettingsChoice({ current, turnOnInvestigation: true }),
    ).toEqual({ investigation: true, fixes: "Automatic" });
    expect(
      isSameAgentAiSettingsChoice(current, {
        investigation: false,
        fixes: "Automatic",
      }),
    ).toBe(true);
    expect(
      isSameAgentAiSettingsChoice(current, {
        investigation: true,
        fixes: "Automatic",
      }),
    ).toBe(false);
  });

  test("the dialog lists every mode, least autonomy first", () => {
    expect([...AGENT_AI_SETTINGS_FIXES_ORDER]).toEqual([
      ...AGENT_AI_FIXES_MODES,
    ]);
    expect(areFixesOn({ investigation: true, fixes: "Disabled" })).toBe(false);
    expect(areFixesOn({ investigation: true, fixes: "RequireApproval" })).toBe(
      true,
    );
  });
});

describe("the chart command for each choice", () => {
  test.each(["RequireApproval", "Automatic", "BypassApproval"] as const)(
    "fixes %s on a read-only agent: the write-access upgrades, scoped first, with the disclosure",
    (fixes: "RequireApproval" | "Automatic" | "BypassApproval") => {
      const choice: AgentAiSettingsChoice = { investigation: true, fixes };
      const instructions: AgentAiSettingsInstructions =
        getKubernetesAiSettingsInstructions({ choice, status: agentStatus() });
      const commands: ReturnType<typeof getAiAgentHelmCommands> =
        getAiAgentHelmCommands(choice);

      expect(instructions.steps).toHaveLength(1);
      expect(
        instructions.steps[0]!.ways.map((way: AgentAiSettingsWay) => {
          return [way.label, way.code, way.note];
        }),
      ).toEqual([
        [
          KUBERNETES_AI_SETTINGS_SCOPED_LABEL,
          commands.enableRemediationScoped,
          getAiAgentScopedCommandNote(),
        ],
        [
          KUBERNETES_AI_SETTINGS_CLUSTER_WIDE_LABEL,
          commands.enableRemediation,
          getAiAgentClusterWideCommandNote(),
        ],
      ]);
      expect(instructions.notes).toEqual([
        {
          text: getAiAgentWriteDisclosure(),
          dataTestId: "agent-ai-settings-write-disclosure",
        },
      ]);
    },
  );

  test("fixes off on a read-only agent: one upgrade that sets the two values", () => {
    const choice: AgentAiSettingsChoice = {
      investigation: false,
      fixes: "Disabled",
    };
    const instructions: AgentAiSettingsInstructions =
      getKubernetesAiSettingsInstructions({ choice, status: agentStatus() });

    expect(
      instructions.steps[0]!.ways.map((way: AgentAiSettingsWay) => {
        return way.code;
      }),
    ).toEqual([getAiAgentHelmCommands(choice).applySettings]);
    expect(instructions.notes).toEqual([]);
  });

  test("an agent that may write already: one upgrade for any mode, keeping its write scope", () => {
    const choice: AgentAiSettingsChoice = {
      investigation: true,
      fixes: "Automatic",
    };
    const instructions: AgentAiSettingsInstructions =
      getKubernetesAiSettingsInstructions({
        choice,
        status: agentStatus({}, true),
      });

    expect(
      instructions.steps[0]!.ways.map((way: AgentAiSettingsWay) => {
        return way.code;
      }),
    ).toEqual([getAiAgentHelmCommands(choice).applySettings]);
    expect(instructions.steps[0]!.ways[0]!.code).not.toContain(
      "aiAgent.remediation.namespaces",
    );
    expect(instructions.notes).toEqual([]);
  });

  test("fixes off on an agent that may write: told the write role goes too", () => {
    const instructions: AgentAiSettingsInstructions =
      getKubernetesAiSettingsInstructions({
        choice: { investigation: true, fixes: "Disabled" },
        status: agentStatus({}, true),
      });

    expect(instructions.notes).toEqual([
      {
        text: KUBERNETES_AI_SETTINGS_FIXES_OFF_NOTE,
        dataTestId: "agent-ai-settings-fixes-off-note",
      },
    ]);
  });
});

describe("the line above the rows", () => {
  test("names the chart values for every source", () => {
    for (const text of Object.values(KUBERNETES_AI_SETTINGS_SET_BY_TEXT)) {
      expect(text).toContain("aiAgent.investigation");
      expect(text).toContain("aiAgent.fixes");
    }
    expect(KUBERNETES_AI_SETTINGS_SET_BY_TEXT.agent_configuration).toContain(
      "configuration",
    );
    expect(KUBERNETES_AI_SETTINGS_SET_BY_TEXT.agent_defaults).toContain(
      "defaults",
    );
    expect(KUBERNETES_AI_SETTINGS_SET_BY_TEXT.oneuptime).toContain(
      "Chosen on this page",
    );
  });
});
