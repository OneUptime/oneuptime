import {
  buildResourceFullAutoPersona,
  buildResourceQuestion,
  buildResourceSuggestPersona,
  getResourceUndoExamples,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import {
  RESOURCE_ALLOWLIST_SUMMARY,
  RESOURCE_ALWAYS_ASKS_SUMMARY,
  RESOURCE_AUTOMATIC_MODE_SUMMARY,
  RESOURCE_BYPASS_MODE_SUMMARY,
  RESOURCE_EVERY_MODE_LIMITS_SUMMARY,
  RESOURCE_NEVER_RUNS_SUMMARY,
  RESOURCE_RISKIER_CHANGES_SUMMARY,
  RESOURCE_SAFE_CHANGES_SUMMARY,
  RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceAutoExecutionVerdict,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — every LLM-facing description of the resource
 * command tiers and the unattended resource modes says what the resource
 * command policy does NOW, the way RemediationKubectlCopyParity pins the
 * kubectl copy:
 *
 * - the shared summaries (AiRemediationCommandPlan's RESOURCE_*_SUMMARY)
 *   restate the canonical ResourceCommandTier / ResourceAiRemediationMode
 *   semantics: SafeWrite is ONE named object; stop, kill, scale to zero,
 *   power off and terminate are riskier; a node drain, a VM migration, host
 *   maintenance and killing a host process always need a human; destructive
 *   commands never run; the allowlist is word-wise;
 * - each example they name, and every undo a persona recommends, is tiered
 *   that way by ResourceCommandPolicy itself — so the copy cannot drift
 *   from the policy unnoticed;
 * - the resource personas and the question use those summaries, name the
 *   resource and its programs, and send reads to run_infrastructure_command.
 */

// Each phrase of the safe summary, as the model would write it, per resource type.
const SAFE_EXAMPLES: Array<[AiResourceType, string]> = [
  [AiResourceType.DockerHost, "docker restart web"],
  [AiResourceType.PodmanHost, "docker start web"],
  [AiResourceType.DockerSwarmCluster, "docker service update --force api"],
  [
    AiResourceType.ProxmoxCluster,
    "pvesh create /nodes/pve1/qemu/100/status/start",
  ],
  [AiResourceType.VMwareVCenter, "govc vm.power -on web-01"],
  [AiResourceType.CephCluster, "ceph osd in 3"],
  [AiResourceType.DatabaseServer, "db cancel-query 4242"],
  [AiResourceType.Host, "systemctl restart nginx"],
];

const RISKIER_EXAMPLES: Array<[AiResourceType, string]> = [
  [AiResourceType.DockerHost, "docker stop web"],
  [AiResourceType.DockerHost, "docker kill -s TERM web"],
  [AiResourceType.DockerHost, "docker pause web"],
  [AiResourceType.DockerHost, "docker update --memory 1g web"],
  [AiResourceType.DockerSwarmCluster, "docker service scale web=0"],
  [
    AiResourceType.ProxmoxCluster,
    "pvesh create /nodes/pve1/qemu/100/status/shutdown",
  ],
  [AiResourceType.VMwareVCenter, "govc vm.power -off web-01"],
  [AiResourceType.VMwareVCenter, "govc vm.power -reset web-01"],
  [AiResourceType.CephCluster, "ceph osd out 3"],
  [AiResourceType.Host, "systemctl stop nginx"],
  [AiResourceType.DatabaseServer, "db terminate-session 4242"],
  // Several objects at once.
  [AiResourceType.DockerHost, "docker restart web api"],
];

const ALWAYS_ASKS_EXAMPLES: Array<[AiResourceType, string]> = [
  [
    AiResourceType.DockerSwarmCluster,
    "docker node update --availability drain n1",
  ],
  [
    AiResourceType.ProxmoxCluster,
    "pvesh create /nodes/pve1/qemu/100/migrate --target pve2",
  ],
  [AiResourceType.VMwareVCenter, "govc host.maintenance.enter esx-01"],
  [AiResourceType.Host, "kill -TERM 1234"],
];

const NEVER_RUNS_EXAMPLES: Array<[AiResourceType, string]> = [
  [AiResourceType.DockerHost, "docker exec web sh"],
  [AiResourceType.DockerHost, "docker run alpine"],
  [AiResourceType.DockerHost, "docker rm web"],
  [AiResourceType.DockerHost, "docker system prune -f"],
  [AiResourceType.Host, "sudo systemctl restart nginx"],
  [AiResourceType.Host, "systemctl restart nginx | tee /tmp/x"],
  [AiResourceType.VMwareVCenter, "govc vm.destroy web-01"],
  [AiResourceType.CephCluster, "ceph auth get client.admin"],
];

function readyResource(
  resourceType: AiResourceType,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType,
    resourceId: "33333333-3333-4333-8333-333333333333",
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: "44444444-4444-4444-8444-444444444444",
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

describe("the shared resource tier summaries match what ResourceCommandPolicy does", () => {
  it.each(SAFE_EXAMPLES)(
    "a safe change is SafeWrite on a %s: %s",
    (resourceType: AiResourceType, command: string) => {
      expect(
        ResourceCommandPolicy.evaluateCommand({ resourceType, command }).tier,
      ).toBe(ResourceCommandTier.SafeWrite);
    },
  );

  it.each(RISKIER_EXAMPLES)(
    "a riskier change is RiskyWrite on a %s: %s",
    (resourceType: AiResourceType, command: string) => {
      expect(
        ResourceCommandPolicy.evaluateCommand({ resourceType, command }).tier,
      ).toBe(ResourceCommandTier.RiskyWrite);
    },
  );

  it.each(ALWAYS_ASKS_EXAMPLES)(
    "a change that always asks a human does so on a %s even bypassed and allowlisted: %s",
    (resourceType: AiResourceType, command: string) => {
      const verdict: ResourceAutoExecutionVerdict =
        ResourceCommandPolicy.evaluateForAutoExecution({
          resourceType,
          command,
          allowlistPatterns: [command],
          bypassApproval: true,
        });

      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
    },
  );

  it.each(NEVER_RUNS_EXAMPLES)(
    "a destructive command never runs on a %s: %s",
    (resourceType: AiResourceType, command: string) => {
      expect(
        ResourceCommandPolicy.evaluateCommand({ resourceType, command }).tier,
      ).toBe(ResourceCommandTier.Denied);
    },
  );

  it("the summaries name what each tier covers, in the canonical words", () => {
    expect(RESOURCE_SAFE_CHANGES_SUMMARY).toContain("exactly ONE named object");
    expect(RESOURCE_SAFE_CHANGES_SUMMARY).toContain(
      "never several objects at once",
    );
    for (const riskier of [
      "stop",
      "kill",
      "scale a service to zero",
      "power off",
      "terminate a session",
      "several objects at once",
    ]) {
      expect(RESOURCE_RISKIER_CHANGES_SUMMARY).toContain(riskier);
    }
    for (const asks of [
      "draining a Swarm node",
      "migrating a VM",
      "maintenance",
      "killing a process on a host",
      "in every mode — Bypass approval and the allowlist included",
    ]) {
      expect(RESOURCE_ALWAYS_ASKS_SUMMARY).toContain(asks);
    }
    for (const never of ["exec", "run", "rm", "prune", "credentials", "sudo"]) {
      expect(RESOURCE_NEVER_RUNS_SUMMARY).toContain(never);
    }
    expect(RESOURCE_ALLOWLIST_SUMMARY).toContain(
      "a * stands for exactly one whole word",
    );
  });

  it("the allowlist summary describes how the matcher really reads a pattern", () => {
    // Exactly one whole word, never part of one; same length.
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.DockerHost,
        command: "docker stop web",
        patterns: ["docker stop *"],
      }),
    ).toBe(true);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.DockerHost,
        command: "docker stop -t 5 web",
        patterns: ["docker stop *"],
      }),
    ).toBe(false);
    expect(
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: AiResourceType.DockerHost,
        command: "docker stop web-1",
        patterns: ["docker stop web-*"],
      }),
    ).toBe(false);
  });

  it("the every-mode clause names the agent's own write switches and ends with the proposal rule", () => {
    expect(RESOURCE_EVERY_MODE_LIMITS_SUMMARY).toContain(
      `${RESOURCE_AI_ALLOW_WRITES_ENV}=true`,
    );
    expect(RESOURCE_EVERY_MODE_LIMITS_SUMMARY).toContain(
      RESOURCE_AI_WRITE_TARGETS_ENV,
    );
    expect(
      RESOURCE_EVERY_MODE_LIMITS_SUMMARY.endsWith(
        `and ${RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY}.`,
      ),
    ).toBe(true);
    expect(RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY).toBe(
      "an unattended run becomes a proposal when the hourly per-resource circuit breaker trips or another unattended round already holds the resource",
    );
  });

  it("the Automatic and Bypass summaries state the canonical ResourceAiRemediationMode semantics", () => {
    expect(RESOURCE_AUTOMATIC_MODE_SUMMARY).toContain(
      "when the round could only find riskier fixes it ends by proposing exactly those for one-click approval",
    );
    expect(RESOURCE_AUTOMATIC_MODE_SUMMARY).toContain(
      "a riskier fix is proposed only if verification shows the safe ones did not recover the signal (the follow-up round, which asks)",
    );
    expect(RESOURCE_AUTOMATIC_MODE_SUMMARY).toContain(
      "Shapes on the resource's command allowlist run on their own.",
    );
    expect(RESOURCE_BYPASS_MODE_SUMMARY).toContain("AI does not ask.");
    expect(RESOURCE_BYPASS_MODE_SUMMARY).toContain(
      "Every change the policy allows — safe AND riskier — runs on its own, follow-up rounds included, except for what always needs a human.",
    );
    expect(RESOURCE_BYPASS_MODE_SUMMARY).not.toContain("below");
  });
});

describe("the undo every persona recommends is a safe change the policy accepts", () => {
  /*
   * A rollback runs unattended: on an Automatic resource the planner refuses
   * a riskier one. Every concrete undo the personas name must therefore be
   * a SafeWrite on ONE named object — filled in with sample names.
   */
  const SAMPLE_UNDOS: Array<[AiResourceType, string]> = [
    [AiResourceType.DockerHost, "docker start web"],
    [AiResourceType.DockerHost, "docker unpause web"],
    [AiResourceType.PodmanHost, "docker start web"],
    [AiResourceType.DockerSwarmCluster, "docker service rollback web"],
    [AiResourceType.DockerSwarmCluster, "docker service scale web=3"],
    [
      AiResourceType.ProxmoxCluster,
      "pvesh create /nodes/pve1/qemu/100/status/start",
    ],
    [AiResourceType.VMwareVCenter, "govc vm.power -on web-01"],
    [AiResourceType.CephCluster, "ceph osd in 3"],
    [AiResourceType.CephCluster, "ceph osd unset noout"],
    [AiResourceType.Host, "systemctl start nginx"],
  ];

  it.each(SAMPLE_UNDOS)(
    "%s: %s is SafeWrite",
    (resourceType: AiResourceType, command: string) => {
      expect(
        ResourceCommandPolicy.evaluateCommand({ resourceType, command }).tier,
      ).toBe(ResourceCommandTier.SafeWrite);
    },
  );

  it.each(ALL_AI_RESOURCE_TYPES)(
    "the %s undo examples start with the type's program (or say there is none)",
    (resourceType: AiResourceType) => {
      const examples: string = getResourceUndoExamples(resourceType);
      const programs: ReadonlyArray<string> =
        AI_RESOURCE_TYPE_INFO[resourceType].programs;

      if (resourceType === AiResourceType.DatabaseServer) {
        expect(examples).toContain("omit it");
        return;
      }

      const firstWord: string = examples.split(" ")[0] || "";
      expect(programs).toContain(firstWord);
    },
  );

  it("an unknown resource type gets advice, never a command", () => {
    expect(getResourceUndoExamples("Nope" as AiResourceType)).toContain(
      "omit the rollbackCommand",
    );
  });
});

describe("the resource personas use the shared summaries", () => {
  it.each(ALL_AI_RESOURCE_TYPES)(
    "the Automatic persona for a %s",
    (resourceType: AiResourceType) => {
      const resource: ResourceAiAccessStatus = readyResource(resourceType);
      const persona: string = buildResourceFullAutoPersona({
        bypassApproval: false,
        resource,
      });

      expect(persona).toContain(RESOURCE_AUTOMATIC_MODE_SUMMARY);
      expect(persona).toContain(RESOURCE_SAFE_CHANGES_SUMMARY);
      expect(persona).toContain(RESOURCE_RISKIER_CHANGES_SUMMARY);
      expect(persona).toContain(RESOURCE_ALWAYS_ASKS_SUMMARY);
      expect(persona).toContain(RESOURCE_ALLOWLIST_SUMMARY);
      expect(persona).toContain(
        ResourceCommandPolicy.getWriteCommandGuide(resourceType),
      );
      expect(persona).toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
      expect(persona).toContain("stepType ResourceCommand");
      expect(persona).toContain('"web-1"');
      expect(persona).toContain(
        AI_RESOURCE_TYPE_INFO[resourceType].agentDisplayName,
      );
      for (const program of AI_RESOURCE_TYPE_INFO[resourceType].programs) {
        expect(persona).toContain(program);
      }
      expect(persona).toContain(getResourceUndoExamples(resourceType));
      expect(persona).toContain(
        "A rollback must itself be a safe change on ONE named object",
      );
      // A resource's agent is never given a credential.
      expect(persona).not.toContain("credentialId");
      expect(persona).not.toContain("kubectl");
    },
  );

  it("the Bypass persona asks nothing but what always needs a human", () => {
    const persona: string = buildResourceFullAutoPersona({
      bypassApproval: true,
      resource: readyResource(AiResourceType.DockerHost, {
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    });

    expect(persona).toContain(RESOURCE_BYPASS_MODE_SUMMARY);
    expect(persona).toContain("EXCEPT that");
    expect(persona).toContain("proposes it to a human for one-click approval");
    expect(persona).toContain(
      RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
    );
    expect(persona).toContain("chose to bypass approvals entirely");
    expect(persona).not.toContain(RESOURCE_AUTOMATIC_MODE_SUMMARY);
  });

  it.each(ALL_AI_RESOURCE_TYPES)(
    "the planning persona for a %s proposes ResourceCommand steps, never runs them",
    (resourceType: AiResourceType) => {
      const persona: string = buildResourceSuggestPersona({
        resource: readyResource(resourceType),
      });

      expect(persona).toContain("REMEDIATION PLANNING");
      expect(persona).toContain(
        "NOTHING you propose executes until a human approves it",
      );
      expect(persona).toContain("propose_remediation_commands");
      expect(persona).toContain("stepType ResourceCommand");
      expect(persona).toContain(
        ResourceCommandPolicy.getWriteCommandGuide(resourceType),
      );
      expect(persona).toContain(getResourceUndoExamples(resourceType));
      expect(persona).not.toContain("execute_remediation_command");
    },
  );
});

describe("the resource round's question", () => {
  it("names the resource and its programs, and the mode's promise", () => {
    const automatic: string = buildResourceQuestion({
      resource: readyResource(AiResourceType.Host),
      mode: "FullAuto",
    });
    expect(automatic).toContain('Host "web-1"');
    expect(automatic).toContain("systemctl");
    expect(automatic).toContain(
      "a riskier fix never runs without a human's one-click approval",
    );
    expect(automatic).toContain("remediate now");

    const bypass: string = buildResourceQuestion({
      resource: readyResource(AiResourceType.DockerHost, {
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
      mode: "FullAuto",
    });
    expect(bypass).toContain("its operator bypassed approvals");
    expect(bypass).toContain(RESOURCE_ALWAYS_ASKS_SUMMARY);
    expect(bypass).toContain(
      "the round becomes a proposal if the hourly circuit breaker trips or another unattended round holds the resource",
    );

    const suggest: string = buildResourceQuestion({
      resource: readyResource(AiResourceType.CephCluster),
      mode: "Suggest",
    });
    expect(suggest).toContain('Ceph cluster "web-1"');
    expect(suggest).toContain("compose a plan for human approval");
    expect(suggest).not.toContain("remediate now");
  });
});

describe("the remediation tool's command examples are what they claim", () => {
  /*
   * RemediationCommandToolkit's ResourceCommand schema offers these as
   * examples of a change; each must parse as one argv and be a SafeWrite
   * for the type it is meant for.
   */
  it.each(SAFE_EXAMPLES)(
    "%s: %s tokenizes as one argv",
    (_resourceType: AiResourceType, command: string) => {
      expect(tokenizeResourceCommand(command).argv).toBeDefined();
    },
  );
});
