import {
  AI_AGENT_POD_NAMESPACE_ENV,
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_COMPONENT,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
  KubernetesAgentPosture,
  KubernetesAgentRegistrationRefusalReason,
  KubernetesAiAccessGapCode,
  KubernetesAiAccessRunnerSummary,
  KubernetesAiAgentRegistrationRefusalReason,
  KubernetesAiAgentSummary,
  KubernetesClusterAiAccessStatus,
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  RUNNER_POD_NAMESPACE_ENV,
  TRANSIENT_KUBERNETES_AGENT_REGISTRATION_REFUSALS,
  TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS,
  getKubernetesAiAccessTargetKind,
  isInClusterPostureForCluster,
  isTransientKubernetesAgentRegistrationRefusal,
  isTransientKubernetesAiAgentRegistrationRefusal,
  parseKubernetesAgentPosture,
  parseKubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { RUNNER_ALIVE_WINDOW_IN_MINUTES } from "../../../Types/Runner/RunnerLiveStatus";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Kubernetes AI agent's half of the shared AI access vocabulary:
 *
 * - its posture is the Runner's posture, stored BARE, and parsed by
 *   parseKubernetesAgentPosture with exactly the validation the Runner's
 *   hostInfo wrapper has always had (parseKubernetesRunnerPosture is now a
 *   thin wrapper over it, so the two can never drift);
 * - an access target is an AI agent or a Runner, told apart ONLY by kind
 *   (accessMethod stays "in_cluster" for both);
 * - which registration refusals clear on their own, for the agent and for
 *   the legacy Runner (superseded_by_ai_agent);
 * - the names the chart, the agent image and the dashboard share;
 * - the file stays import-free, because the agent carries a byte-identical
 *   copy of it and builds without the rest of Common.
 */

const SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../Types/Kubernetes/KubernetesClusterAiAccess.ts",
);

const COMPLETE_POSTURE: Record<string, unknown> = {
  clusterIdentifier: "prod-us",
  inCluster: true,
  allowWrites: true,
  kubectlVersion: "v1.33.1",
  agentChartVersion: "14.1.0",
  writeNamespaces: ["web", "api"],
  podNamespace: "oneuptime-agent",
  allowNodeOperations: false,
};

describe("KubernetesClusterAiAccess.ts stays copyable into the agent", () => {
  it("has no imports and no requires", () => {
    const source: string = fs.readFileSync(SOURCE_PATH, "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/^\s*export\s+\*\s+from\s/m);
    expect(source).not.toMatch(/^\s*export\s+\{[^}]*\}\s+from\s/m);
  });
});

describe("parseKubernetesAgentPosture (bare)", () => {
  it("returns undefined for anything that is not an object", () => {
    for (const value of [undefined, null, "", "posture", 0, 42, true, false]) {
      expect(parseKubernetesAgentPosture(value)).toBeUndefined();
    }
  });

  it("parses a complete bare posture as the agent sends it", () => {
    expect(parseKubernetesAgentPosture(COMPLETE_POSTURE)).toEqual(
      COMPLETE_POSTURE,
    );
  });

  it("an empty object is a posture that claims nothing", () => {
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture({});

    expect(posture).toBeDefined();
    expect(posture?.inCluster).toBe(false);
    expect(posture?.allowWrites).toBe(false);
    expect(posture?.clusterIdentifier).toBeUndefined();
    expect(posture?.writeNamespaces).toBeUndefined();
    expect(posture?.allowNodeOperations).toBeUndefined();
  });

  it("accepts only literal true for inCluster and allowWrites", () => {
    for (const value of ["true", 1, "yes", {}, [], null]) {
      const posture: KubernetesAgentPosture | undefined =
        parseKubernetesAgentPosture({
          inCluster: value,
          allowWrites: value,
        });

      expect(posture?.inCluster).toBe(false);
      expect(posture?.allowWrites).toBe(false);
    }
  });

  it("keeps allowNodeOperations only when it is a boolean", () => {
    expect(
      parseKubernetesAgentPosture({ allowNodeOperations: true })
        ?.allowNodeOperations,
    ).toBe(true);
    expect(
      parseKubernetesAgentPosture({ allowNodeOperations: false })
        ?.allowNodeOperations,
    ).toBe(false);
    expect(
      parseKubernetesAgentPosture({ allowNodeOperations: "true" })
        ?.allowNodeOperations,
    ).toBeUndefined();
  });

  it("drops non-string identifiers and versions rather than coercing them", () => {
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture({
        clusterIdentifier: 42,
        kubectlVersion: {},
        agentChartVersion: ["14"],
        podNamespace: 7,
      });

    expect(posture?.clusterIdentifier).toBeUndefined();
    expect(posture?.kubectlVersion).toBeUndefined();
    expect(posture?.agentChartVersion).toBeUndefined();
    expect(posture?.podNamespace).toBeUndefined();
  });

  it("keeps only non-empty strings of writeNamespaces, and keeps an empty list (cluster-wide) as a list", () => {
    expect(
      parseKubernetesAgentPosture({
        writeNamespaces: ["web", "", 3, null, "api"],
      })?.writeNamespaces,
    ).toEqual(["web", "api"]);
    expect(
      parseKubernetesAgentPosture({ writeNamespaces: [] })?.writeNamespaces,
    ).toEqual([]);
    expect(
      parseKubernetesAgentPosture({ writeNamespaces: "web" })?.writeNamespaces,
    ).toBeUndefined();
  });

  it("treats an empty podNamespace as unknown", () => {
    expect(
      parseKubernetesAgentPosture({ podNamespace: "" })?.podNamespace,
    ).toBeUndefined();
  });

  /*
   * The bare parser does not unwrap: a hostInfo-shaped object handed to it
   * is read as a posture with none of the fields set, never as the posture
   * underneath. An agent row whose stored JSON is somehow wrapped must not
   * be treated as in-cluster.
   */
  it("does not unwrap a hostInfo-shaped object", () => {
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture({ kubernetes: COMPLETE_POSTURE });

    expect(posture?.inCluster).toBe(false);
    expect(posture?.clusterIdentifier).toBeUndefined();
    expect(isInClusterPostureForCluster(posture, "prod-us")).toBe(false);
  });

  it("a bare in-cluster posture is the in-cluster executor of its own cluster only", () => {
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(COMPLETE_POSTURE);

    expect(isInClusterPostureForCluster(posture, "prod-us")).toBe(true);
    expect(isInClusterPostureForCluster(posture, " PROD-US ")).toBe(true);
    expect(isInClusterPostureForCluster(posture, "staging")).toBe(false);
  });

  it("does not share state with its input", () => {
    const input: Record<string, unknown> = {
      ...COMPLETE_POSTURE,
      writeNamespaces: ["web"],
    };
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(input);

    (input["writeNamespaces"] as Array<string>).push("kube-system");

    expect(posture?.writeNamespaces).toEqual(["web"]);
  });
});

describe("parseKubernetesRunnerPosture is a thin wrapper over the bare parser", () => {
  const FIXTURES: Array<unknown> = [
    COMPLETE_POSTURE,
    {},
    { inCluster: "true", allowWrites: 1 },
    { writeNamespaces: ["web", "", 5] },
    { clusterIdentifier: 42, podNamespace: "" },
    { allowNodeOperations: "false" },
    [],
    "not-an-object",
    null,
    undefined,
  ];

  it.each(
    FIXTURES.map((fixture: unknown) => {
      return [fixture];
    }),
  )(
    "hostInfo.kubernetes = %p parses exactly like the bare value",
    (fixture: unknown) => {
      expect(parseKubernetesRunnerPosture({ kubernetes: fixture })).toEqual(
        parseKubernetesAgentPosture(fixture),
      );
    },
  );

  it("returns undefined for a hostInfo with no kubernetes key, and for a non-object hostInfo", () => {
    expect(parseKubernetesRunnerPosture(COMPLETE_POSTURE)).toBeUndefined();
    expect(parseKubernetesRunnerPosture({})).toBeUndefined();
    expect(parseKubernetesRunnerPosture(undefined)).toBeUndefined();
    expect(parseKubernetesRunnerPosture(null)).toBeUndefined();
    expect(parseKubernetesRunnerPosture("hostInfo")).toBeUndefined();
  });

  it("returns the same shape for both (the agent's posture IS a Runner's posture)", () => {
    const fromRunner: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({ kubernetes: COMPLETE_POSTURE });
    const fromAgent: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(COMPLETE_POSTURE);

    expect(fromRunner).toEqual(fromAgent);
    expect(Object.keys(fromRunner!).sort()).toEqual(
      Object.keys(fromAgent!).sort(),
    );
  });
});

describe("getKubernetesAiAccessTargetKind", () => {
  function summary(
    overrides: Partial<KubernetesAiAccessRunnerSummary>,
  ): KubernetesAiAccessRunnerSummary {
    return {
      id: "id-1",
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      ...overrides,
    };
  }

  it("is ai_agent only when the summary says so", () => {
    expect(
      getKubernetesAiAccessTargetKind(
        summary({ kind: "ai_agent", name: KUBERNETES_AI_AGENT_DISPLAY_NAME }),
      ),
    ).toBe("ai_agent");
  });

  it("reads an absent kind (every summary built before the agent) as runner", () => {
    expect(getKubernetesAiAccessTargetKind(summary({}))).toBe("runner");
    expect(getKubernetesAiAccessTargetKind(summary({ kind: "runner" }))).toBe(
      "runner",
    );
    expect(
      getKubernetesAiAccessTargetKind(
        summary({
          kind: "AI_AGENT" as unknown as KubernetesAiAccessRunnerSummary["kind"],
        }),
      ),
    ).toBe("runner");
  });

  it("is null when there is no target", () => {
    expect(getKubernetesAiAccessTargetKind(null)).toBeNull();
    expect(getKubernetesAiAccessTargetKind(undefined)).toBeNull();
  });
});

describe("Kubernetes AI agent constants", () => {
  it("names what the chart, the image and the dashboard share", () => {
    expect(AI_AGENT_POD_NAMESPACE_ENV).toBe("ONEUPTIME_AI_AGENT_POD_NAMESPACE");
    expect(KUBERNETES_AI_AGENT_COMPONENT).toBe("ai-agent");
    expect(KUBERNETES_AI_AGENT_IMAGE_REPOSITORY).toBe(
      "oneuptime/kubernetes-ai-agent",
    );
    expect(KUBERNETES_AI_AGENT_DISPLAY_NAME).toBe("Kubernetes AI agent");
    expect(KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(5);
  });

  it("the agent's pod namespace variable is its own, not the Runner's", () => {
    expect(AI_AGENT_POD_NAMESPACE_ENV).not.toBe(RUNNER_POD_NAMESPACE_ENV);
  });

  it("the agent reads the same kubectl write settings the Runner does", () => {
    expect(KUBECTL_ALLOW_WRITES_ENV).toBe("ONEUPTIME_KUBECTL_ALLOW_WRITES");
    expect(KUBECTL_WRITE_NAMESPACES_ENV).toBe(
      "ONEUPTIME_KUBECTL_WRITE_NAMESPACES",
    );
    expect(KUBECTL_ALLOW_NODE_OPERATIONS_ENV).toBe(
      "ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS",
    );
  });

  it("an agent is online for as long as a Runner would be", () => {
    expect(KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(
      RUNNER_ALIVE_WINDOW_IN_MINUTES,
    );
  });
});

describe("Kubernetes AI agent registration refusals", () => {
  const ALL_AGENT_REASONS: Array<KubernetesAiAgentRegistrationRefusalReason> = [
    "previous_instance_online",
    "legacy_runner_online",
    "cluster_name_invalid",
    "agent_cap_reached",
  ];

  it("clears on its own only while a previous instance or the legacy Runner is online", () => {
    expect(
      ALL_AGENT_REASONS.filter(
        (reason: KubernetesAiAgentRegistrationRefusalReason) => {
          return isTransientKubernetesAiAgentRegistrationRefusal(reason);
        },
      ),
    ).toEqual(["previous_instance_online", "legacy_runner_online"]);
    expect([...TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS]).toEqual([
      "previous_instance_online",
      "legacy_runner_online",
    ]);
  });

  it("needs an operator for an invalid cluster name or a reached cap", () => {
    expect(
      isTransientKubernetesAiAgentRegistrationRefusal("cluster_name_invalid"),
    ).toBe(false);
    expect(
      isTransientKubernetesAiAgentRegistrationRefusal("agent_cap_reached"),
    ).toBe(false);
  });

  /*
   * A 403 with no reason (a proxy in front of the server, or an older
   * server) or an unknown one must never be read as "wait, it clears".
   */
  it("never treats a missing, unknown or non-string reason as transient", () => {
    for (const value of [
      undefined,
      null,
      "",
      "PREVIOUS_INSTANCE_ONLINE",
      " previous_instance_online",
      "superseded_by_ai_agent",
      42,
      {},
      ["previous_instance_online"],
    ]) {
      expect(isTransientKubernetesAiAgentRegistrationRefusal(value)).toBe(
        false,
      );
    }
  });
});

describe("legacy Runner registration refusals", () => {
  const ALL_RUNNER_REASONS: Array<KubernetesAgentRegistrationRefusalReason> = [
    "previous_instance_online",
    "runner_holds_more_than_defaults",
    "runner_belongs_to_another_cluster",
    "superseded_by_ai_agent",
  ];

  /*
   * superseded_by_ai_agent is refused only WHILE the cluster's AI agent is
   * online: a rollback that stops the agent lets the legacy Runner register
   * again, so the Runner must keep retrying rather than wait for an
   * operator.
   */
  it("treats superseded_by_ai_agent as clearing on its own, like previous_instance_online", () => {
    expect(
      isTransientKubernetesAgentRegistrationRefusal("superseded_by_ai_agent"),
    ).toBe(true);
    expect(
      isTransientKubernetesAgentRegistrationRefusal("previous_instance_online"),
    ).toBe(true);
    expect(
      [...TRANSIENT_KUBERNETES_AGENT_REGISTRATION_REFUSALS].sort(),
    ).toEqual(["previous_instance_online", "superseded_by_ai_agent"].sort());
  });

  it("still needs an operator for the reasons that always did", () => {
    expect(
      ALL_RUNNER_REASONS.filter(
        (reason: KubernetesAgentRegistrationRefusalReason) => {
          return !isTransientKubernetesAgentRegistrationRefusal(reason);
        },
      ),
    ).toEqual([
      "runner_holds_more_than_defaults",
      "runner_belongs_to_another_cluster",
    ]);
  });

  it("never treats a missing, unknown or agent-only reason as transient", () => {
    for (const value of [
      undefined,
      null,
      "",
      "legacy_runner_online",
      "agent_cap_reached",
      42,
    ]) {
      expect(isTransientKubernetesAgentRegistrationRefusal(value)).toBe(false);
    }
  });
});

describe("the status contract", () => {
  it("names the three new gap codes and keeps the old ones", () => {
    // Compile-time: each literal must be a member of the union.
    const codes: Array<KubernetesAiAccessGapCode> = [
      "ai_agent_not_connected",
      "ai_agent_offline",
      "ai_balance_insufficient",
      "no_runner_bound",
      "runner_offline",
      "project_ai_command_execution_disabled",
      "remediation_write_access_missing",
    ];

    expect(new Set(codes).size).toBe(codes.length);
  });

  /*
   * Enable AI is the project's only AI switch. The gaps of the two switches
   * it replaced stay in the union, retired like no_runner_bound: the server
   * no longer produces them, but a status from an older server (and the
   * agent's byte-identical copy of this file) still type-checks, and the
   * union says why they are there.
   */
  it("keeps the gaps of the switches Enable AI replaced, marked retired", () => {
    // Compile-time: both are still members of the union.
    const retired: Array<KubernetesAiAccessGapCode> = [
      "project_auto_remediation_disabled",
      "project_ai_command_execution_disabled",
    ];

    expect(new Set(retired).size).toBe(2);

    const source: string = fs.readFileSync(SOURCE_PATH, "utf8");

    expect(source).toMatch(
      /Retired:[^|]*Enable AI[^|]*\|\s*"project_auto_remediation_disabled"\s*\|\s*"project_ai_command_execution_disabled"/,
    );
  });

  /*
   * Every status carries aiAgent (the agent row, or null when none ever
   * registered) and the project's automaticInvestigation opt-ins. The type
   * keeps both optional only until the producer sets them (see the comment
   * on the type), so these fixtures always set both: they must keep
   * type-checking once the two fields are required.
   */
  it("carries the AI agent row (or null) and the project opt-ins", () => {
    const base: KubernetesClusterAiAccessStatus = {
      clusterId: "c1",
      clusterName: "prod-us",
      runner: null,
      accessMethod: "none",
      aiAgent: null,
      automaticInvestigation: { incidents: false, alerts: false },
      kubectlAllowlist: [],
      isInvestigationEnabled: true,
      isInvestigationReady: false,
      remediationMode: KubernetesAiRemediationMode.Disabled,
      isRemediationReady: false,
      gaps: [],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    };

    const agent: KubernetesAiAgentSummary = {
      id: "agent-1",
      isOnline: true,
      connectionStatus: "connected",
      lastAliveAt: "2026-01-01T00:00:00.000Z",
      posture: parseKubernetesAgentPosture(COMPLETE_POSTURE),
    };

    const withAgent: KubernetesClusterAiAccessStatus = {
      ...base,
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
      automaticInvestigation: { incidents: true, alerts: false },
    };

    // No agent row is null, not absent.
    expect(base.aiAgent).toBeNull();
    expect(base.automaticInvestigation).toEqual({
      incidents: false,
      alerts: false,
    });
    expect(withAgent.aiAgent).toBe(agent);
    expect(withAgent.automaticInvestigation).toEqual({
      incidents: true,
      alerts: false,
    });
    expect(getKubernetesAiAccessTargetKind(withAgent.runner)).toBe("ai_agent");
    // The agent authenticates with its own ServiceAccount.
    expect(withAgent.accessMethod).toBe("in_cluster");
  });
});
