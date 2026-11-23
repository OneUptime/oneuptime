import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../../../Server/Services/ProjectService";
import {
  FixIssueGroupInCloudAction,
  FixIssueGroupInCodeAction,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/IssueGroupFixActions";
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
