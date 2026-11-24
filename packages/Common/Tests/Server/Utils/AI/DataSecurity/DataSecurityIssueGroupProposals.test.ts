import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../../../Server/Services/ProjectService";
import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import {
  FixIssueGroupInCloudAction,
  FixIssueGroupInCodeAction,
  readStoreActions,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/IssueGroupFixActions";
import DataSecurityIssueGroupTimelines from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupTimelines";
import DataSecurityIssueGroupFix from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionReason,
} from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import * as ResponseActionCatalog from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataSecurityResponseAction } from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../../Types/JSON";
import { DataSecurityAiPlannedChange } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityIssueGroupProposals, {
  getIssueGroupPlanKey,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupProposals";
import DataSecurityIssueGrouper from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import {
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import ObjectID from "../../../../../Types/ObjectID";
import {
  GroupFixCalls,
  installGroupFixStubs,
} from "../../DataSecurity/IssueGroupFixStubs";
import IssueGroupsWorld, {
  WorldIssue,
  WorldStore,
} from "../../DataSecurity/IssueGroupsWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONEUPTIME AI PROPOSES EACH GROUP'S FIX UNDER THE PROJECT'S AI RULES
 * (#10364, #10370): out of the box the pull request is proposed and waits,
 * a rule that sets Fix to Without asking opens it on its own, and a change
 * through the cloud connections always asks - whatever a rule says.
 */

interface Proposed {
  kind: DataSecurityAiProposalKind;
  change: DataSecurityAiPlannedChange;
  work: DataSecurityAiWorkDecision;
  verdict: DataSecurityAiWithoutAskingVerdict;
  groupId: string;
}

const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";

let world: IssueGroupsWorld;
let calls: GroupFixCalls;
let proposed: Array<Proposed>;
let project: { enableAi: boolean; enableAutomaticDataSecurityAi: boolean };
let rules: Array<AutoRemediationRule> | null;

function moduleBuckets(count: number): void {
  for (let index: number = 1; index <= count; index++) {
    world.addStoreWithIssue({
      name: `site-${index}-assets`,
      cloudTags: { module: "static-site", "managed-by": "terraform" },
    });
  }
}

function consoleBuckets(count: number): Array<{
  store: WorldStore;
  issue: WorldIssue;
}> {
  const made: Array<{ store: WorldStore; issue: WorldIssue }> = [];

  for (let index: number = 1; index <= count; index++) {
    made.push(
      world.addStoreWithIssue(
        { name: `acme-exports-${index}`, cloudConnectionId: CONNECTION_ID },
        { checkId: "public-read", severity: "Critical", riskScore: 80 + index },
      ),
    );
  }

  return made;
}

// A grouping, which proposes each open group's fix as it ends: how many were proposed.
async function groupAndPropose(): Promise<number> {
  const before: number = proposed.length;

  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });

  return proposed.length - before;
}

function rule(fix: DataSecurityAiAutonomy): AutoRemediationRule {
  const made: AutoRemediationRule = new AutoRemediationRule();

  made._id = "55555555-5555-4555-8555-555555555555";
  made.name = "Fix what modules make";
  made.isEnabled = true;
  (made as unknown as Record<string, unknown>)["dataSecurityFix"] = fix;

  return made;
}

beforeEach(() => {
  world = new IssueGroupsWorld();
  world.install();
  calls = installGroupFixStubs({ connections: [{ id: CONNECTION_ID }] });
  // The grouping's own hook is the real one here.
  (
    DataSecurityIssueGroupProposals.proposeForGroups as unknown as {
      mockRestore: () => void;
    }
  ).mockRestore();
  proposed = [];
  project = { enableAi: true, enableAutomaticDataSecurityAi: true };
  rules = [];

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const row: Project = new Project();

    row.enableAi = project.enableAi;
    row.enableAutomaticDataSecurityAi = project.enableAutomaticDataSecurityAi;
    row.requireTwoApprovalsForRiskierFixes = false;

    return row;
  }) as never);
  jest
    .spyOn(DataSecurityAiEngine, "readRules")
    .mockImplementation((async () => {
      return rules;
    }) as never);
  jest.spyOn(DataSecurityAiEngine, "readDataTypes").mockResolvedValue({
    namer: undefined,
    categoryOf: new Map(),
  } as never);
  jest.spyOn(DataSecurityAiEngine, "readRuleIssue").mockResolvedValue({
    checkId: "access-not-logged",
  } as never);
  jest
    .spyOn(DataSecurityAiEngine, "countChangesWithoutAskingThisHour")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(DataSecurityAiProposals, "propose")
    .mockImplementation((async (data: {
      action: { kind: DataSecurityAiProposalKind };
      change: DataSecurityAiPlannedChange;
      work: DataSecurityAiWorkDecision;
      verdict: DataSecurityAiWithoutAskingVerdict;
      group?: { id?: ObjectID } | null;
    }) => {
      proposed.push({
        kind: data.action.kind,
        change: data.change,
        work: data.work,
        verdict: data.verdict,
        groupId: data.group?.id?.toString() || "",
      });

      return {};
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("out of the box", () => {
  test("the pull request is proposed for a person, in the repository the grouping found", async () => {
    moduleBuckets(12);

    expect(await groupAndPropose()).toBe(1);
    expect(proposed).toHaveLength(1);

    const made: Proposed = proposed[0]!;

    expect(made.kind).toBe(DataSecurityAiProposalKind.FixIssueGroupInCode);
    expect(made.groupId).toBe(world.groups[0]!.id);
    expect(made.work.autonomy).toBe(DataSecurityAiAutonomy.Suggest);
    expect(made.verdict.runWithoutAsking).toBe(false);
    expect(made.change.safety).toBe(
      DataSecurityAiChangeSafety.OpensPullRequest,
    );
    expect(made.change.plan["storeIds"]).toHaveLength(12);
    expect(made.change.plan["repositoryId"]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(made.change.title).toContain("12 issues");
    // Names, places and counts only: the stores by name, never a value.
    expect(made.change.changeMarkdown).toContain("site-1-assets");
    expect(calls.queued).toHaveLength(0);
  });

  test("the change through the cloud connections waits for a person, leaving out what the fix leaves out", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      consoleBuckets(4);

    world.stores.find((store: WorldStore): boolean => {
      return store.id === buckets[3]!.store.id;
    })!.isPublicByDesign = true;

    await groupAndPropose();

    expect(proposed).toHaveLength(1);

    const made: Proposed = proposed[0]!;

    expect(made.kind).toBe(DataSecurityAiProposalKind.FixIssueGroupInCloud);
    expect(made.change.safety).toBe(DataSecurityAiChangeSafety.ChangesAccess);
    expect(made.verdict.runWithoutAsking).toBe(false);
    expect(made.change.plan["storeIds"]).toHaveLength(3);
    expect(made.change.plan["leftOutStoreIds"]).toEqual([buckets[3]!.store.id]);
    expect(made.change.changeMarkdown).toContain("Public By Design");
    expect(calls.responses).toHaveLength(0);
  });
});

describe("under the project's AI rules", () => {
  test("a rule whose Fix is Without asking opens the pull request on its own", async () => {
    rules = [rule(DataSecurityAiAutonomy.WithoutAsking)];
    jest.spyOn(DataSecurityAiEngine, "matchRules").mockReturnValue([
      {
        _id: "55555555-5555-4555-8555-555555555555",
        name: "Fix what modules make",
        dataSecurityFix: DataSecurityAiAutonomy.WithoutAsking,
      },
    ] as never);
    moduleBuckets(6);

    await groupAndPropose();

    expect(proposed[0]!.work.autonomy).toBe(
      DataSecurityAiAutonomy.WithoutAsking,
    );
    expect(proposed[0]!.verdict).toEqual({
      runWithoutAsking: true,
      askReason: null,
    });
  });

  test("even then, a change through the cloud connections asks", async () => {
    rules = [rule(DataSecurityAiAutonomy.WithoutAsking)];
    jest.spyOn(DataSecurityAiEngine, "matchRules").mockReturnValue([
      {
        _id: "55555555-5555-4555-8555-555555555555",
        name: "Fix everything",
        dataSecurityFix: DataSecurityAiAutonomy.WithoutAsking,
      },
    ] as never);
    consoleBuckets(3);
    // A protection rather than an exposure: a setting of the cloud's.
    for (const issue of world.issues) {
      issue.checkId = "deleted-data-not-recoverable";
    }

    await groupAndPropose();

    expect(proposed[0]!.kind).toBe(
      DataSecurityAiProposalKind.FixIssueGroupInCloud,
    );
    expect(proposed[0]!.change.safety).toBe(
      DataSecurityAiChangeSafety.ChangesCloudSettings,
    );
    expect(proposed[0]!.verdict).toEqual({
      runWithoutAsking: false,
      askReason: DataSecurityAiAskReason.AlwaysAsks,
    });
  });

  test("a rule that turns Fix off, or none that matches, proposes nothing", async () => {
    rules = [rule(DataSecurityAiAutonomy.Off)];
    jest.spyOn(DataSecurityAiEngine, "matchRules").mockReturnValue([
      {
        _id: "55555555-5555-4555-8555-555555555555",
        name: "Only analyze",
        dataSecurityFix: DataSecurityAiAutonomy.Off,
      },
    ] as never);
    moduleBuckets(6);

    expect(await groupAndPropose()).toBe(0);

    jest.spyOn(DataSecurityAiEngine, "matchRules").mockReturnValue([] as never);

    expect(await groupAndPropose()).toBe(0);
    expect(proposed).toHaveLength(0);
  });

  test("rules that could not be read keep OneUptime AI from proposing anything", async () => {
    rules = null;
    moduleBuckets(6);

    expect(await groupAndPropose()).toBe(0);
  });
});

describe("with the project's AI off", () => {
  test("nothing is proposed, with either switch off", async () => {
    moduleBuckets(6);
    project = { enableAi: false, enableAutomaticDataSecurityAi: true };

    expect(await groupAndPropose()).toBe(0);

    project = { enableAi: true, enableAutomaticDataSecurityAi: false };

    expect(await groupAndPropose()).toBe(0);
    expect(proposed).toHaveLength(0);
  });
});

describe("the same fix, proposed once", () => {
  test("its key is the group's stores and what it runs, however they are read", () => {
    const groupId: string = "66666666-6666-4666-8666-666666666666";
    const key: string = getIssueGroupPlanKey({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      groupId,
      storeIds: ["B", "a"],
      extra: "repo",
    });

    expect(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
        groupId,
        storeIds: ["A", "b"],
        extra: "repo",
      }),
    ).toBe(key);
    // A store more is a new proposal, which replaces the one still waiting.
    expect(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
        groupId,
        storeIds: ["a", "b", "c"],
        extra: "repo",
      }),
    ).not.toBe(key);
    expect(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
        groupId,
        storeIds: ["a", "b"],
        extra: "repo",
      }),
    ).not.toBe(key);
    expect(key.length).toBeLessThanOrEqual(100);
  });

  test("a pull request already on its way is not proposed again", async () => {
    moduleBuckets(6);
    rules = null;
    await DataSecurityIssueGrouper.groupProject({
      projectId: new ObjectID(world.projectId),
    });
    rules = [];
    world.groups[0]!.codeTaskId = "77777777-7777-4777-8777-777777777777";
    jest
      .spyOn(
        (
          await import(
            "../../../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix"
          )
        ).default,
        "readFixState",
      )
      .mockResolvedValue({
        taskId: "77777777-7777-4777-8777-777777777777",
        state: "writing",
      } as never);

    expect(
      await DataSecurityIssueGroupProposals.proposeForGroups({
        projectId: new ObjectID(world.projectId),
        groupIds: [new ObjectID(world.groups[0]!.id)],
      }),
    ).toBe(0);
  });
});

describe("approving a group's proposal", () => {
  test("is held to the permission the part itself takes", () => {
    expect(
      FixIssueGroupInCodeAction.getApproveRefusal({
        props: { isRoot: true },
      } as never),
    ).toBeNull();
    expect(
      FixIssueGroupInCodeAction.getApproveRefusal({
        props: { userId: new ObjectID("88888888-8888-4888-8888-888888888888") },
      } as never),
    ).toBeTruthy();
    expect(
      FixIssueGroupInCloudAction.getApproveRefusal({
        props: { userId: new ObjectID("88888888-8888-4888-8888-888888888888") },
      } as never),
    ).toBeTruthy();
  });

  test("is never undone from here: a pull request is closed where it was opened", () => {
    expect(FixIssueGroupInCodeAction.getUndoRefusal({} as never)).toBeTruthy();
    expect(FixIssueGroupInCloudAction.getUndoRefusal({} as never)).toBeTruthy();
    expect(FixIssueGroupInCodeAction.appliesToCheck("public-read")).toBe(false);
  });
});

describe("each issue told when a group's fix waits (#10741)", () => {
  let told: Array<JSONObject>;
  let order: Array<string>;
  let toldAlready: Set<string>;

  // What the store answers for the group's proposal: whether it waits.
  function proposeAnswers(entry: DataSecurityAiDecisionEntry): void {
    jest
      .spyOn(DataSecurityAiProposals, "propose")
      .mockImplementation((async (data: {
        action: { kind: DataSecurityAiProposalKind };
        change: DataSecurityAiPlannedChange;
        work: DataSecurityAiWorkDecision;
        verdict: DataSecurityAiWithoutAskingVerdict;
        group?: { id?: ObjectID } | null;
      }) => {
        order.push("propose");
        proposed.push({
          kind: data.action.kind,
          change: data.change,
          work: data.work,
          verdict: data.verdict,
          groupId: data.group?.id?.toString() || "",
        });

        return entry;
      }) as never);
  }

  beforeEach(() => {
    told = [];
    order = [];
    toldAlready = new Set(["10741000-0000-4000-8000-0000000000a9"]);
    jest
      .spyOn(DataSecurityIssueGroupTimelines, "readWaitingIssueIds")
      .mockImplementation((async () => {
        order.push("read waiting");

        return toldAlready;
      }) as never);
    jest
      .spyOn(DataSecurityIssueGroupTimelines, "onProposed")
      .mockImplementation((async (data: JSONObject) => {
        order.push("tell");
        told.push(data);

        return 0;
      }) as never);
  });

  test("a proposal that waits tells each issue, all but those the one it replaced told already", async () => {
    proposeAnswers({
      work: DataSecurityAiWork.Fix,
      reason: DataSecurityAiDecisionReason.Proposed,
      proposalId: "10741000-0000-4000-8000-0000000000f1",
    });
    moduleBuckets(6);

    await groupAndPropose();

    // What was told before is read before the new one replaces it.
    expect(order).toEqual(["read waiting", "propose", "tell"]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      proposalId: "10741000-0000-4000-8000-0000000000f1",
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      plan: proposed[0]!.change.plan,
      toldAlready,
    });
    expect(String(told[0]!["groupId"])).toBe(world.groups[0]!.id);
    // The plan lists the issues it is for: what each line is written on.
    expect(proposed[0]!.change.plan["issueIds"]).toHaveLength(6);
  });

  test("the one approval that waits tells its issues too", async () => {
    proposeAnswers({
      work: DataSecurityAiWork.Fix,
      reason: DataSecurityAiDecisionReason.Proposed,
      proposalId: "10741000-0000-4000-8000-0000000000f3",
    });
    consoleBuckets(3);

    await groupAndPropose();

    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      proposalId: "10741000-0000-4000-8000-0000000000f3",
    });
    expect((told[0]!["plan"] as JSONObject)["issueIds"]).toHaveLength(3);
  });

  test.each([
    DataSecurityAiDecisionReason.AlreadyProposed,
    DataSecurityAiDecisionReason.AppliedWithoutAsking,
    DataSecurityAiDecisionReason.ApplyFailed,
  ])(
    "a proposal that does not wait (%s) tells no issue here",
    async (reason: DataSecurityAiDecisionReason) => {
      proposeAnswers({
        work: DataSecurityAiWork.Fix,
        reason,
        proposalId: "10741000-0000-4000-8000-0000000000f2",
      });
      moduleBuckets(6);

      await groupAndPropose();

      expect(proposed).toHaveLength(1);
      expect(told).toHaveLength(0);
    },
  );
});

describe("the one approval's proposal, kind by kind (#10742)", () => {
  const VERSIONING: DataSecurityResponseAction =
    DataSecurityResponseAction.TurnOnVersioning;
  const RECOVERY: DataSecurityResponseAction =
    DataSecurityResponseAction.TurnOnPointInTimeRecovery;

  // A catalog of tomorrow: one check two kinds of one cloud fail, each fixed its own way.
  function catalogOfTwoKinds(): void {
    jest
      .spyOn(ResponseActionCatalog, "getDataSecurityResponseActionForIssue")
      .mockImplementation(
        (
          checkId: string | undefined,
          kind: string | undefined,
        ): DataSecurityResponseAction | undefined => {
          if (checkId !== "deleted-data-not-recoverable") {
            return undefined;
          }

          return kind === "AWS DynamoDB Table"
            ? RECOVERY
            : kind === "AWS S3 Bucket"
              ? VERSIONING
              : undefined;
        },
      );
  }

  function ordersStores(buckets: number, tables: number): void {
    for (let index: number = 1; index <= buckets + tables; index++) {
      world.addStoreWithIssue(
        {
          name:
            index <= buckets
              ? `orders-bucket-${index}`
              : `orders-table-${index}`,
          kind: index <= buckets ? "AWS S3 Bucket" : "AWS DynamoDB Table",
          cloudConnectionId: CONNECTION_ID,
          cloudTags: { component: "orders" },
        },
        { checkId: "deleted-data-not-recoverable", severity: "Medium" },
      );
    }
  }

  test("its preview names each kind's action, what it does and costs, and its stores", async () => {
    catalogOfTwoKinds();
    ordersStores(2, 2);

    await groupAndPropose();

    expect(proposed).toHaveLength(1);

    const change: DataSecurityAiPlannedChange = proposed[0]!.change;

    expect(proposed[0]!.kind).toBe(
      DataSecurityAiProposalKind.FixIssueGroupInCloud,
    );
    expect(change.title).toContain(`${RECOVERY} and ${VERSIONING}`);
    expect(change.title).toContain("4 stores made in the console");
    expect(change.changeMarkdown).toContain(
      "One approval makes each kind of store's own change",
    );
    expect(change.changeMarkdown).toContain(`**${VERSIONING}**`);
    expect(change.changeMarkdown).toContain(`**${RECOVERY}**`);
    // What each costs, as Fix it from here says it.
    expect(change.changeMarkdown).toContain("billed");
    expect(change.changeMarkdown).toContain("bills it by the table's size");
    expect(change.changeMarkdown).toContain("orders-bucket-1");
    expect(change.changeMarkdown).toContain("orders-table-4");
    expect(change.reasonMarkdown).toContain(
      "each kind of store with its own change",
    );
    // A setting of the cloud's, never access: it always asks.
    expect(change.safety).toBe(DataSecurityAiChangeSafety.ChangesCloudSettings);
    expect(proposed[0]!.verdict.runWithoutAsking).toBe(false);
  });

  test("its plan says which store and issue takes which action", async () => {
    catalogOfTwoKinds();
    ordersStores(2, 2);

    await groupAndPropose();

    const plan: JSONObject = proposed[0]!.change.plan;
    const actions: Array<JSONObject> = plan["actions"] as Array<JSONObject>;
    const tables: Array<WorldStore> = world.stores.filter(
      (store: WorldStore): boolean => {
        return store.kind === "AWS DynamoDB Table";
      },
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      action: RECOVERY,
      kind: "AWS DynamoDB Table",
    });
    expect([...(actions[0]!["storeIds"] as Array<string>)].sort()).toEqual(
      tables
        .map((store: WorldStore): string => {
          return store.id;
        })
        .sort(),
    );
    expect(actions[0]!["issueIds"]).toHaveLength(2);
    expect(plan["issueIds"]).toHaveLength(4);
    expect(plan["storeIds"]).toHaveLength(4);
    // An approval holds each store to the action it lists.
    expect(Object.values(readStoreActions(plan)).sort()).toEqual([
      RECOVERY,
      RECOVERY,
      VERSIONING,
      VERSIONING,
    ]);
  });

  test("one action reads as it always did: its key is the one a waiting proposal of before has", async () => {
    consoleBuckets(3);

    await groupAndPropose();

    const change: DataSecurityAiPlannedChange = proposed[0]!.change;

    expect(change.changeMarkdown).toMatch(
      /^\*\*Block public access\*\* on each of these stores, through its cloud connection\. Turns on the bucket's four Block Public Access settings/,
    );
    expect(change.changeMarkdown).toContain("stops working");
    expect(change.planKey).toBe(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
        groupId: world.groups[0]!.id,
        storeIds: change.plan["storeIds"] as Array<string>,
        extra: DataSecurityResponseAction.BlockPublicAccess,
      }),
    );
    // A change of access, as before.
    expect(change.safety).toBe(DataSecurityAiChangeSafety.ChangesAccess);
  });

  test("several actions are a key of their own: the same stores taking one action are another proposal", async () => {
    catalogOfTwoKinds();
    ordersStores(1, 1);

    await groupAndPropose();

    const change: DataSecurityAiPlannedChange = proposed[0]!.change;

    expect(change.planKey).not.toBe(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
        groupId: world.groups[0]!.id,
        storeIds: change.plan["storeIds"] as Array<string>,
        extra: VERSIONING,
      }),
    );
    expect(change.planKey).toBe(
      getIssueGroupPlanKey({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
        groupId: world.groups[0]!.id,
        storeIds: change.plan["storeIds"] as Array<string>,
        extra: [RECOVERY, VERSIONING].sort().join(","),
      }),
    );
  });
});

describe("approving the one approval (#10742)", () => {
  const VERSIONING: DataSecurityResponseAction =
    DataSecurityResponseAction.TurnOnVersioning;
  const RECOVERY: DataSecurityResponseAction =
    DataSecurityResponseAction.TurnOnPointInTimeRecovery;

  test("runs each store with the action the proposal listed for it, and keeps what each did", async () => {
    const bucket: string = "10742000-0000-4000-8000-0000000000b1";
    const table: string = "10742000-0000-4000-8000-0000000000b2";
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();

    proposal.dataSecurityIssueGroupId = new ObjectID(
      "10742000-0000-4000-8000-0000000000c1",
    );
    proposal.plan = {
      groupId: "10742000-0000-4000-8000-0000000000c1",
      action: VERSIONING,
      actions: [
        { action: VERSIONING, kind: "AWS S3 Bucket", storeIds: [bucket] },
        { action: RECOVERY, kind: "AWS DynamoDB Table", storeIds: [table] },
      ],
      storeIds: [bucket, table],
      leftOutStoreIds: [],
    };

    const run: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataSecurityIssueGroupFix, "run")
      .mockResolvedValue({
        leftOut: 0,
        cloud: {
          action: VERSIONING,
          actions: [
            { action: VERSIONING, changed: 1, unchanged: 0, failed: 0 },
            { action: RECOVERY, changed: 0, unchanged: 1, failed: 0 },
          ],
          changed: 1,
          unchanged: 1,
          failed: [],
          changedIssueIds: ["10742000-0000-4000-8000-0000000000a1"],
        },
      } as never);
    const made: { result: JSONObject; summaryMarkdown: string } =
      (await FixIssueGroupInCloudAction.apply({
        projectId: new ObjectID(world.projectId),
        proposal,
        actor: { props: { isRoot: true } },
      })) as { result: JSONObject; summaryMarkdown: string };

    expect(run.mock.calls[0]![0]).toMatchObject({
      onlyDataStoreIds: [bucket, table],
      onlyStoreActions: { [bucket]: VERSIONING, [table]: RECOVERY },
    });
    expect(made.result).toEqual({
      action: VERSIONING,
      actions: [
        { action: VERSIONING, changed: 1, unchanged: 0, failed: 0 },
        { action: RECOVERY, changed: 0, unchanged: 1, failed: 0 },
      ],
      changed: 1,
      unchanged: 1,
      failed: 0,
      changedIssueIds: ["10742000-0000-4000-8000-0000000000a1"],
    });
    expect(made.summaryMarkdown).toContain(`**${VERSIONING}**`);
    expect(made.summaryMarkdown).toContain(`**${RECOVERY}**`);
    expect(made.summaryMarkdown).toContain("1 already as they should be");
  });

  test("a proposal from before it listed its actions holds every store it named to its one action", () => {
    const storeIds: Array<string> = [
      "10742000-0000-4000-8000-0000000000b3",
      "10742000-0000-4000-8000-0000000000b4",
    ];

    expect(
      readStoreActions({
        action: DataSecurityResponseAction.BlockPublicAccess,
        storeIds,
      }),
    ).toEqual({
      [storeIds[0]!]: DataSecurityResponseAction.BlockPublicAccess,
      [storeIds[1]!]: DataSecurityResponseAction.BlockPublicAccess,
    });
    // Nothing that is not an action, nor any id that is not one.
    expect(
      readStoreActions({
        actions: [
          { action: "Delete the bucket", storeIds },
          { action: VERSIONING, storeIds: ["not-an-id"] },
        ],
      }),
    ).toEqual({});
    expect(readStoreActions(null)).toEqual({});
    expect(readStoreActions([] as never)).toEqual({});
  });
});
