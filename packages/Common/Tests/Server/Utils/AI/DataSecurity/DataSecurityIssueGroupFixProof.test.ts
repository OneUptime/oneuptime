import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataSecurityFixTarget from "../../../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import DataSecurityIssueGroupFixProof, {
  MAX_GROUP_FIXES_PROVEN_PER_RUN,
  PROVE_APPLIED_WITHIN_DAYS,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupFixProof";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { IssueGroupFixProofStanding } from "../../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueResolution from "../../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityResponseAction } from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A GROUP'S FIX, PROVEN BY ITS ISSUES' OWN CHECKS (#10738).
 *
 * After each grouping, every group fix OneUptime AI made lately and not yet
 * proven is read with the issues it fixed: the pull request's, as its
 * task lists them; the one approval's, the issues whose store it changed. It
 * is proven - and AI Results counts it among the changes that worked - once
 * each of them was closed by the fix itself. Nothing else proves it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10738000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10738000-0000-4000-8000-000000000002",
);
const TASK_ID: string = "10738000-0000-4000-8000-0000000000a1";
const GROUP_ID: string = "10738000-0000-4000-8000-0000000000b1";
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const APPLIED_AT: Date = new Date("2026-11-20T12:00:00.000Z");
const AFTER: Date = new Date("2026-11-21T12:00:00.000Z");
const BEFORE: Date = new Date("2026-11-19T12:00:00.000Z");
const VERSIONING: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnVersioning;
const RECOVERY: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnPointInTimeRecovery;

let next: number = 0;

function makeId(): string {
  next++;

  return `10738000-0000-4000-8000-${next.toString(16).padStart(12, "0")}`;
}

interface IssueRow {
  id: string;
  status: DataSecurityIssueStatus;
  resolution?: DataSecurityIssueResolution | undefined;
  resolvedAt?: Date | undefined;
  resolutionDetails?: JSONObject | undefined;
  dataStoreId?: string | undefined;
}

let proposals: Array<DataSecurityAiProposal>;
let issues: Array<IssueRow>;
let proven: Array<string>;
let proposalQueries: Array<JSONObject>;
let issueQueries: Array<JSONObject>;

function proposal(data: {
  kind: DataSecurityAiProposalKind;
  plan?: JSONObject;
  result?: JSONObject;
}): DataSecurityAiProposal {
  const made: DataSecurityAiProposal = new DataSecurityAiProposal();

  made.id = new ObjectID(makeId());
  made.kind = data.kind;
  made.status = DataSecurityAiProposalStatus.Applied;
  made.plan = data.plan || {};
  made.result = data.result || {};
  made.appliedAt = APPLIED_AT;
  made.dataSecurityIssueGroupId = new ObjectID(GROUP_ID);
  proposals.push(made);

  return made;
}

function issue(row: Omit<IssueRow, "id"> & { id?: string }): IssueRow {
  const made: IssueRow = { id: row.id || makeId(), ...row };

  issues.push(made);

  return made;
}

function fixedInCode(taskId: string = TASK_ID): Omit<IssueRow, "id"> {
  return {
    status: DataSecurityIssueStatus.Resolved,
    resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
    resolvedAt: AFTER,
    resolutionDetails: {
      at: AFTER.toISOString(),
      fix: { pullRequestId: makeId(), taskId },
    },
  };
}

function fixedFromHere(
  action: DataSecurityResponseAction = VERSIONING,
  resolvedAt: Date = AFTER,
): Omit<IssueRow, "id"> {
  return {
    status: DataSecurityIssueStatus.Resolved,
    resolution: DataSecurityIssueResolution.FixedFromHere,
    resolvedAt,
    resolutionDetails: { at: resolvedAt.toISOString(), responseAction: action },
  };
}

// The pull request's task, in a project, listing these issues.
function taskListing(
  issueIds: Array<string>,
  projectId: ObjectID = PROJECT_ID,
): void {
  const task: AIRun = new AIRun();

  task.id = new ObjectID(TASK_ID);
  task.projectId = projectId;
  jest
    .spyOn(DataSecurityFixTarget, "readTask")
    .mockResolvedValue(task as never);
  jest
    .spyOn(DataSecurityFixTarget, "issueIdsOfTask")
    .mockReturnValue(issueIds as never);
}

async function prove(): Promise<number> {
  return await DataSecurityIssueGroupFixProof.proveForProject({
    projectId: PROJECT_ID,
    now: NOW,
  });
}

function ids(values: unknown): Array<string> {
  const raw: {
    objectLiteralParameters?: Record<string, unknown>;
  } = values as { objectLiteralParameters?: Record<string, unknown> };

  return (
    Object.values(raw.objectLiteralParameters || {}).flat() as Array<unknown>
  ).map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

beforeEach(() => {
  proposals = [];
  issues = [];
  proven = [];
  proposalQueries = [];
  issueQueries = [];

  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      proposalQueries.push(findBy as unknown as JSONObject);

      return proposals;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "markGroupFixProven")
    .mockImplementation((async (data: { proposalId: ObjectID; at: Date }) => {
      proven.push(data.proposalId.toString());
      expect(data.at).toEqual(NOW);

      return 1;
    }) as never);
  jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      issueQueries.push(findBy.query);

      const asked: Array<string> = findBy.query["_id"]
        ? ids(findBy.query["_id"])
        : [];
      const stores: Array<string> = findBy.query["dataStoreId"]
        ? ids(findBy.query["dataStoreId"])
        : [];

      return issues
        .filter((row: IssueRow): boolean => {
          return (
            (asked.length === 0 || asked.includes(row.id)) &&
            (stores.length === 0 ||
              stores.includes((row.dataStoreId || "").toLowerCase()))
          );
        })
        .map((row: IssueRow): DataSecurityIssue => {
          const model: DataSecurityIssue = new DataSecurityIssue();

          model.id = new ObjectID(row.id);
          model.status = row.status;

          if (row.resolution) {
            model.resolution = row.resolution;
          }

          if (row.resolvedAt) {
            model.resolvedAt = row.resolvedAt;
          }

          if (row.resolutionDetails) {
            model.resolutionDetails = row.resolutionDetails;
          }

          return model;
        });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which group fixes are looked at", () => {
  test("the project's applied group fixes of the last 90 days not proven yet, the newest first, a few at a time", async () => {
    await prove();

    expect(proposalQueries).toHaveLength(1);

    const read: JSONObject = proposalQueries[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(ids(query["kind"])).toEqual([
      DataSecurityAiProposalKind.FixIssueGroupInCode.toLowerCase(),
      DataSecurityAiProposalKind.FixIssueGroupInCloud.toLowerCase(),
    ]);
    expect(ids(query["status"])).toEqual([
      DataSecurityAiProposalStatus.Applied.toLowerCase(),
      DataSecurityAiProposalStatus.AppliedWithoutAsking.toLowerCase(),
    ]);
    expect(query["verifiedAt"]).toBeDefined();
    expect(query["appliedAt"]).toBeDefined();
    expect(read["limit"]).toBe(MAX_GROUP_FIXES_PROVEN_PER_RUN);
    expect(read["props"]).toEqual({ isRoot: true });
    expect(PROVE_APPLIED_WITHIN_DAYS).toBe(90);
  });

  test("with none, nothing is proven and no issue is read", async () => {
    expect(await prove()).toBe(0);
    expect(issueQueries).toHaveLength(0);
  });
});

describe("a group's pull request", () => {
  test("is proven once every issue its task lists resolved as Fixed in infrastructure code by that task", async () => {
    const fixed: Array<IssueRow> = [issue(fixedInCode()), issue(fixedInCode())];
    const made: DataSecurityAiProposal = proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });

    taskListing(
      fixed.map((row: IssueRow): string => {
        return row.id;
      }),
    );

    expect(await prove()).toBe(1);
    expect(proven).toEqual([made.id!.toString()]);
  });

  test("waits while one of its issues is still open", async () => {
    const rows: Array<IssueRow> = [
      issue(fixedInCode()),
      issue({ status: DataSecurityIssueStatus.Open }),
    ];

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });
    taskListing(
      rows.map((row: IssueRow): string => {
        return row.id;
      }),
    );

    expect(await prove()).toBe(0);
    expect(proven).toEqual([]);
  });

  test.each([
    ["accepted", { status: DataSecurityIssueStatus.Accepted }],
    ["not an issue", { status: DataSecurityIssueStatus.NotAnIssue }],
    [
      "marked resolved by a person",
      {
        status: DataSecurityIssueStatus.Resolved,
        resolution: DataSecurityIssueResolution.ResolvedByPerson,
        resolvedAt: AFTER,
      },
    ],
    [
      "passing for no change OneUptime knows of",
      {
        status: DataSecurityIssueStatus.Resolved,
        resolution: DataSecurityIssueResolution.CheckPassed,
        resolvedAt: AFTER,
      },
    ],
    [
      "no longer checked",
      {
        status: DataSecurityIssueStatus.Resolved,
        resolution: DataSecurityIssueResolution.NoLongerChecked,
        resolvedAt: AFTER,
      },
    ],
    [
      "archived with its store",
      {
        status: DataSecurityIssueStatus.Resolved,
        resolution: DataSecurityIssueResolution.StoreArchived,
        resolvedAt: AFTER,
      },
    ],
  ])(
    "is never proven by an issue %s",
    async (_name: string, row: Omit<IssueRow, "id">) => {
      const rows: Array<IssueRow> = [issue(fixedInCode()), issue(row)];

      proposal({
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
        result: { aiRunId: TASK_ID },
      });
      taskListing(
        rows.map((entry: IssueRow): string => {
          return entry.id;
        }),
      );

      expect(await prove()).toBe(0);
    },
  );

  test("is not proven by an issue another pull request fixed", async () => {
    const rows: Array<IssueRow> = [
      issue(fixedInCode()),
      issue(fixedInCode(makeId())),
    ];

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });
    taskListing(
      rows.map((row: IssueRow): string => {
        return row.id;
      }),
    );

    expect(await prove()).toBe(0);
  });

  test("an issue a person deleted since proves nothing", async () => {
    const fixed: IssueRow = issue(fixedInCode());

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });
    taskListing([fixed.id, makeId()]);

    expect(await prove()).toBe(0);
  });

  test("a task gone, of another project, or none at all, has nothing to prove", async () => {
    const fixed: IssueRow = issue(fixedInCode());

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });

    jest
      .spyOn(DataSecurityFixTarget, "readTask")
      .mockResolvedValue(null as never);
    expect(await prove()).toBe(0);

    taskListing([fixed.id], OTHER_PROJECT_ID);
    expect(await prove()).toBe(0);

    proposals = [];
    proposal({ kind: DataSecurityAiProposalKind.FixIssueGroupInCode });
    expect(await prove()).toBe(0);
    expect(proven).toEqual([]);
  });

  test("its standing reads as the proof's", async () => {
    const fixed: IssueRow = issue(fixedInCode());
    const made: DataSecurityAiProposal = proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });

    taskListing([fixed.id]);

    expect(
      await DataSecurityIssueGroupFixProof.read({
        projectId: PROJECT_ID,
        proposal: made,
      }),
    ).toEqual({
      standing: IssueGroupFixProofStanding.Proven,
      issueIds: [fixed.id],
    });
  });
});

describe("a group's one approval", () => {
  function approval(
    changed: Array<IssueRow>,
    actions: Array<{ action: string; issueIds: Array<string> }>,
  ): DataSecurityAiProposal {
    return proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      plan: {
        groupId: GROUP_ID,
        action: VERSIONING,
        actions: actions.map(
          (entry: { action: string; issueIds: Array<string> }) => {
            return {
              action: entry.action,
              kind: "AWS S3 Bucket",
              storeIds: [],
              issueIds: entry.issueIds,
            };
          },
        ),
      },
      result: {
        changedIssueIds: changed.map((row: IssueRow): string => {
          return row.id;
        }),
      },
    });
  }

  test("is proven once every issue whose store it changed resolved as Fixed from here, by that store's own action", async () => {
    const bucket: IssueRow = issue(fixedFromHere(VERSIONING));
    const table: IssueRow = issue(fixedFromHere(RECOVERY));
    const made: DataSecurityAiProposal = approval(
      [bucket, table],
      [
        { action: VERSIONING, issueIds: [bucket.id] },
        { action: RECOVERY, issueIds: [table.id] },
      ],
    );

    expect(await prove()).toBe(1);
    expect(proven).toEqual([made.id!.toString()]);
  });

  test("is not proven by a store fixed from here by another action, or before it ran", async () => {
    const bucket: IssueRow = issue(fixedFromHere(RECOVERY));

    approval([bucket], [{ action: VERSIONING, issueIds: [bucket.id] }]);
    expect(await prove()).toBe(0);

    proposals = [];
    issues = [];

    const early: IssueRow = issue(fixedFromHere(VERSIONING, BEFORE));

    approval([early], [{ action: VERSIONING, issueIds: [early.id] }]);
    expect(await prove()).toBe(0);
  });

  test("a store it found already as it should be is no part of what it proves", async () => {
    // Only the changed store's issue is kept on the proposal: the unchanged one passed for no change.
    issue({
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.CheckPassed,
      resolvedAt: AFTER,
    });

    const changed: IssueRow = issue(fixedFromHere(VERSIONING));

    approval([changed], [{ action: VERSIONING, issueIds: [changed.id] }]);

    expect(await prove()).toBe(1);
  });

  test("one that changed no store has nothing to prove", async () => {
    approval([], []);

    expect(await prove()).toBe(0);
    expect(issueQueries).toHaveLength(0);
  });

  test("one from before it kept the issues it changed is proven by the issues of the stores it listed", async () => {
    const storeIds: Array<string> = [makeId(), makeId()];

    issue({ ...fixedFromHere(VERSIONING), dataStoreId: storeIds[0] });
    issue({ ...fixedFromHere(VERSIONING), dataStoreId: storeIds[1] });
    issue({ status: DataSecurityIssueStatus.Open, dataStoreId: makeId() });

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      plan: { groupId: GROUP_ID, action: VERSIONING, storeIds },
      result: { action: VERSIONING, changed: 2, unchanged: 0, failed: 0 },
    });

    expect(await prove()).toBe(1);
    // Its group's issues on the stores it listed.
    expect(issueQueries[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataSecurityIssueGroupId: new ObjectID(GROUP_ID),
      }),
    );
  });
});

describe("a run", () => {
  test("proves each fix on its own: one that cannot be read stops no other", async () => {
    const fixed: IssueRow = issue(fixedFromHere(VERSIONING));
    const broken: DataSecurityAiProposal = proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      result: { aiRunId: TASK_ID },
    });
    const good: DataSecurityAiProposal = proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      plan: {
        groupId: GROUP_ID,
        action: VERSIONING,
        issueIds: [fixed.id],
      },
      result: { changedIssueIds: [fixed.id] },
    });

    jest
      .spyOn(DataSecurityFixTarget, "readTask")
      .mockRejectedValue(new Error("The database went away.") as never);

    expect(await prove()).toBe(1);
    expect(proven).toEqual([good.id!.toString()]);
    expect(proven).not.toContain(broken.id!.toString());
  });

  test("a fix someone proved at the same moment counts once", async () => {
    const fixed: IssueRow = issue(fixedFromHere(VERSIONING));

    proposal({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      plan: { groupId: GROUP_ID, action: VERSIONING },
      result: { changedIssueIds: [fixed.id] },
    });
    jest
      .spyOn(DataSecurityAiProposalService, "markGroupFixProven")
      .mockResolvedValue(0 as never);

    expect(await prove()).toBe(0);
  });

  test("never throws: a grouping ends whatever the proof could read", async () => {
    jest
      .spyOn(DataSecurityAiProposalService, "findBy")
      .mockRejectedValue(new Error("The database went away.") as never);

    expect(await prove()).toBe(0);
  });
});

describe("the claim", () => {
  test("proves only a group's fix that still stands, and only once", async () => {
    (
      DataSecurityAiProposalService.markGroupFixProven as unknown as {
        mockRestore: () => void;
      }
    ).mockRestore();

    const conditions: Array<{ sql: string; values: JSONObject | undefined }> =
      [];
    let set: JSONObject | null = null;
    const builder: Record<string, unknown> = {
      update: () => {
        return builder;
      },
      set: (values: JSONObject) => {
        set = values;
        return builder;
      },
      where: (sql: string, values?: JSONObject) => {
        conditions.push({ sql, values });
        return builder;
      },
      andWhere: (sql: string, values?: JSONObject) => {
        conditions.push({ sql, values });
        return builder;
      },
      execute: async () => {
        return { affected: 1 };
      },
    };

    jest.spyOn(DataSecurityAiProposalService, "getRepository").mockReturnValue({
      createQueryBuilder: () => {
        return builder;
      },
    } as never);

    const proposalId: ObjectID = new ObjectID(makeId());

    expect(
      await DataSecurityAiProposalService.markGroupFixProven({
        proposalId,
        at: NOW,
      }),
    ).toBe(1);
    expect(set).toEqual({ verifiedAt: NOW });
    expect(conditions).toEqual([
      { sql: '"_id" = :id', values: { id: proposalId.toString() } },
      {
        sql: '"kind" IN (:...kinds)',
        values: {
          kinds: [
            DataSecurityAiProposalKind.FixIssueGroupInCode,
            DataSecurityAiProposalKind.FixIssueGroupInCloud,
          ],
        },
      },
      {
        sql: '"status" IN (:...statuses)',
        values: {
          statuses: [
            DataSecurityAiProposalStatus.Applied,
            DataSecurityAiProposalStatus.AppliedWithoutAsking,
          ],
        },
      },
      { sql: '"verifiedAt" IS NULL', values: undefined },
      { sql: '"deletedAt" IS NULL', values: undefined },
    ]);
  });
});
