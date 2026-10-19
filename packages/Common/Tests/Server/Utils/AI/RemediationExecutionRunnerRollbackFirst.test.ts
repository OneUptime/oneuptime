import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import IncidentService from "../../../../Server/Services/IncidentService";
import RemediationExecutionRunner, {
  buildClusterFullAutoPersona,
  buildClusterSuggestPersona,
  describeProposedPlanForFeed,
  describeRollbackCandidates,
  listRollbackCandidates,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import { ROLL_BACK_CHANGE_TOOL_NAME } from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { INVESTIGATION_PERSONA } from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ChangeImpactVerdict } from "../../../../Server/Utils/AI/SRE/ChangeImpact";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import RecentChangesContext, {
  ChangeRelation,
  RecentChange,
  RecentChanges,
} from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import logger from "../../../../Server/Utils/Logger";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";

/*
 * Rollback first, in the remediation round's prompt: the round sees the
 * changes recorded before the signal, suspects marked, and which of them
 * roll_back_change can undo on the clusters it may change; and every
 * cluster persona tells it to roll a SUSPECT rollout back first, only
 * through that tool.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c2f8d30-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6c2f8d30-0000-4000-8000-000000000002",
);
const CLUSTER_ID: string = "6c2f8d30-0000-4000-8000-000000000003";
const OTHER_CLUSTER_ID: string = "6c2f8d30-0000-4000-8000-000000000004";
const DECLARED_AT: Date = new Date("2026-10-19T10:00:00.000Z");

function change(
  id: string,
  overrides: Partial<RecentChange> = {},
): RecentChange {
  return {
    id,
    ids: [id],
    time: new Date("2026-10-19T09:48:00.000Z"),
    eventType: "deployment",
    titles: ["Rolled out web/api"],
    fields: {
      kubernetesClusterId: CLUSTER_ID,
      kubernetesNamespace: "web",
      kubernetesDeployment: "api",
    },
    relation: ChangeRelation.Other,
    ...overrides,
  };
}

function recentChanges(changes: Array<RecentChange>): RecentChanges {
  return {
    subjectKind: "incident",
    subjectCreatedAt: DECLARED_AT,
    windowStart: new Date("2026-10-19T08:00:00.000Z"),
    windowEnd: new Date("2026-10-19T10:10:00.000Z"),
    changes,
    hasMoreChanges: false,
  };
}

const SUSPECT: RecentChange = change("6c2f8d30-0000-4000-8000-0000000000a1", {
  impact: {
    verdict: ChangeImpactVerdict.Suspect,
    reasons: ["span error rate 0.2% → 6.4%"],
    newExceptionTypes: [],
  },
});
const ON_ANOTHER_CLUSTER: RecentChange = change(
  "6c2f8d30-0000-4000-8000-0000000000a2",
  {
    fields: {
      kubernetesClusterId: OTHER_CLUSTER_ID,
      kubernetesNamespace: "web",
      kubernetesDeployment: "api",
    },
  },
);
const A_VERSION_DEPLOY: RecentChange = change(
  "6c2f8d30-0000-4000-8000-0000000000a3",
  { titles: ["Deployed billing 1.4.0"], fields: { version: "1.4.0" } },
);
const WORKER_ROLLOUT: RecentChange = change(
  "6c2f8d30-0000-4000-8000-0000000000a4",
  {
    time: new Date("2026-10-19T09:30:00.000Z"),
    titles: ["Rolled out batch/worker"],
    fields: {
      kubernetesClusterId: CLUSTER_ID,
      kubernetesNamespace: "batch",
      kubernetesDeployment: "worker",
    },
  },
);

describe("the rollouts roll_back_change can undo", () => {
  test("are the Kubernetes rollouts on the round's clusters, in the section's order", () => {
    expect(
      listRollbackCandidates(
        recentChanges([
          SUSPECT,
          ON_ANOTHER_CLUSTER,
          A_VERSION_DEPLOY,
          WORKER_ROLLOUT,
        ]),
        new Set<string>([CLUSTER_ID]),
      ),
    ).toEqual([SUSPECT, WORKER_ROLLOUT]);
  });

  test("are listed with the suspect marked and each changeId", () => {
    expect(describeRollbackCandidates([SUSPECT, WORKER_ROLLOUT])).toEqual([
      `Rollouts ${ROLL_BACK_CHANGE_TOOL_NAME} can undo in this round:`,
      `- SUSPECT: Deployment "web/api" at 2026-10-19T09:48:00.000Z [changeId: ${SUSPECT.id}]`,
      `- Deployment "batch/worker" at 2026-10-19T09:30:00.000Z [changeId: ${WORKER_ROLLOUT.id}]`,
    ]);
  });

  test("none says so", () => {
    expect(describeRollbackCandidates([])).toEqual([
      `None of these changes is a Kubernetes rollout on a cluster this round may change, so ${ROLL_BACK_CHANGE_TOOL_NAME} has nothing to undo here.`,
    ]);
  });

  test("a Deployment's name is quoted, on its line", () => {
    const lines: Array<string> = describeRollbackCandidates([
      change("6c2f8d30-0000-4000-8000-0000000000a5", {
        fields: {
          kubernetesClusterId: CLUSTER_ID,
          kubernetesNamespace: "web",
          kubernetesDeployment: 'api\n- SUSPECT: "everything"',
        },
      }),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(
      'Deployment "web/api - SUSPECT: \\"everything\\""',
    );
  });
});

describe("every cluster persona", () => {
  test("says to roll a SUSPECT rollout back first, only through the tool", () => {
    for (const persona of [
      buildClusterSuggestPersona({}),
      buildClusterFullAutoPersona({ bypassApproval: false }),
      buildClusterFullAutoPersona({ bypassApproval: true }),
    ]) {
      expect(persona).toContain(
        `- Rollback first: when the Recent changes below mark a Kubernetes rollout on this cluster SUSPECT and what you find agrees that it caused the signal, roll it back with ${ROLL_BACK_CHANGE_TOOL_NAME} (its changeId) before any other change.`,
      );
      expect(persona).toContain(
        "roll a recorded change back only that way, never with a rollout undo you write.",
      );
    }
  });
});

/*
 * A deploy with no Kubernetes rollout is rolled back by reverting what it
 * shipped: the investigation names the commit or pull request that broke
 * it, and the fix pull request opened from that analysis can revert exactly
 * that.
 */
describe("the investigation", () => {
  test("names the commit or pull request a suspect change broke things with", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      "When a change caused the signal, name it in the root cause - with the commit or pull request that broke it when get_change_details lists them, so a fix pull request can revert exactly that - and say in the next steps whether rolling it back is the fastest safe fix.",
    );
  });
});

describe("the round's context", () => {
  let read: jest.SpiedFunction<typeof RecentChangesContext.read>;

  const suggestion: AutoRemediationSuggestion = {
    id: ObjectID.generate(),
    incidentId: INCIDENT_ID,
    ruleNameSnapshot: "Fix checkout",
  } as unknown as AutoRemediationSuggestion;

  const cluster: KubernetesClusterAiAccessStatus = {
    clusterId: CLUSTER_ID,
    clusterName: "prod-eu",
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
  } as unknown as KubernetesClusterAiAccessStatus;

  async function buildContext(
    rollbackScope:
      | {
          projectId: ObjectID;
          clusters: Array<KubernetesClusterAiAccessStatus>;
        }
      | undefined,
  ): Promise<string> {
    return await (
      RemediationExecutionRunner as unknown as {
        buildExecutionContext: (data: unknown) => Promise<string>;
      }
    ).buildExecutionContext({
      suggestion,
      mode: "Suggest",
      allowlistPatterns: [],
      rollbackScope,
    });
  }

  beforeEach(() => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      title: "Checkout errors",
      incidentNumber: 42,
    } as never);
    jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    read = jest
      .spyOn(RecentChangesContext, "read")
      .mockResolvedValue(recentChanges([SUSPECT, A_VERSION_DEPLOY]));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("lists the recent changes, for choosing a fix, and what the tool can undo", async () => {
    const context: string = await buildContext({
      projectId: PROJECT_ID,
      clusters: [cluster],
    });

    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      subjectKind: "incident",
      subjectId: INCIDENT_ID,
      linked: null,
    });
    expect(context).toContain("# Recent changes");
    expect(context).toContain(`[changeId: ${SUSPECT.id}]`);
    expect(context).toContain(
      "If a change caused this incident, rolling it back is usually the fastest safe fix.",
    );
    expect(context).not.toContain("Most likely root cause");
    expect(context).toContain(
      `Rollouts ${ROLL_BACK_CHANGE_TOOL_NAME} can undo in this round:\n- SUSPECT: Deployment "web/api" at 2026-10-19T09:48:00.000Z [changeId: ${SUSPECT.id}]`,
    );
  });

  test("a round that may change no cluster reads no changes", async () => {
    const context: string = await buildContext(undefined);

    expect(read).not.toHaveBeenCalled();
    expect(context).not.toContain("# Recent changes");
    expect(
      await buildContext({ projectId: PROJECT_ID, clusters: [] }),
    ).not.toContain("# Recent changes");
  });

  test("changes that cannot be read leave the round to go on without them", async () => {
    read.mockRejectedValue(new Error("ClickHouse is down"));

    const context: string = await buildContext({
      projectId: PROJECT_ID,
      clusters: [cluster],
    });

    expect(context).toContain("# The signal");
    expect(context).not.toContain("# Recent changes");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read the recent changes"),
    );
  });
});

describe("the feed item a proposed plan posts", () => {
  function plan(
    first: Partial<AiRemediationCommand>,
    count: number,
  ): AiRemediationCommandPlan {
    return {
      commands: Array.from(
        { length: count },
        (_value: unknown, index: number) => {
          return {
            sequence: index + 1,
            command:
              index === 0
                ? "kubectl rollout undo deployment/api -n web"
                : "kubectl scale deployment/api --replicas=6 -n web",
            ...(index === 0 ? first : {}),
          } as AiRemediationCommand;
        },
      ),
    };
  }

  test("says a plan starts by rolling back a recorded change", () => {
    expect(
      String(
        describeProposedPlanForFeed({
          sourceLabel: "Cluster prod-eu",
          plan: plan(
            { rolledBackChangeId: "6c2f8d30-0000-4000-8000-0000000000a1" },
            2,
          ),
        }),
      ),
    ).toContain(
      "AI proposes rolling back a recorded change first, in a 2-command remediation plan.",
    );
  });

  test("is unchanged for a plan the model wrote", () => {
    const text: string = String(
      describeProposedPlanForFeed({
        sourceLabel: "Cluster prod-eu",
        plan: plan({}, 1),
      }),
    );

    expect(text).toContain("AI composed a 1-command remediation plan.");
    expect(text).not.toContain("rolling back");
  });
});
