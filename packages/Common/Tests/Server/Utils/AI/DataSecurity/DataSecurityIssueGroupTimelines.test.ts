import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataSecurityIssueGroupTimelines, {
  GroupProposalExpiry,
  MAX_TIMELINE_BATCH,
  MAX_TIMELINE_ISSUES,
  getGroupDismissedLine,
  getGroupExpiredLine,
  getGroupProposedLine,
  getProposalActionOfIssues,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupTimelines";
import logger from "../../../../../Server/Utils/Logger";
import { Gray500, Purple500 } from "../../../../../Types/BrandColors";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
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
 * EACH ISSUE'S TIMELINE SAYS WHEN ONEUPTIME AI PROPOSES ITS GROUP'S FIX
 * (#10741), AND WHEN IT IS DISMISSED OR EXPIRES.
 *
 * A group's proposal has no issue of its own, so its issues said nothing
 * until a person made the fix. Each open issue it is for is told now - one
 * line, written a batch at a time; never on more than a few hundred (a
 * large group is quiet); never again for a newer proposal of the same kind
 * that replaces one still waiting - and is told when a person dismisses it,
 * or it expires. A line says nothing but its own issue's store and cause:
 * a reader held to labels reads it too (#10739).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10741000-0000-4000-8000-000000000001",
);
const GROUP_ID: ObjectID = new ObjectID("10741000-0000-4000-8000-0000000000b1");
const USER_ID: ObjectID = new ObjectID("10741000-0000-4000-8000-0000000000e1");
const AI_PAGE: string =
  "https://oneuptime.example/dashboard/p/data-security/ai";

let next: number = 0;

function makeId(): string {
  next++;

  return `10741000-0000-4000-8000-${next.toString(16).padStart(12, "0")}`;
}

interface Line {
  issueId: string;
  eventType: string;
  markdown: string;
  color: string;
  userId?: string | undefined;
  proposalId?: string | undefined;
}

let issues: Array<{ id: string; status: string; dataStoreId: string }>;
let lines: Array<Line>;
let inFlight: number;
let mostInFlight: number;
let waiting: Array<DataSecurityAiProposal>;
let claims: Array<{ proposalId: string; set: JSONObject }>;
let claimWins: boolean;

function addIssues(
  count: number,
  status: string = DataSecurityIssueStatus.Open,
): Array<string> {
  const ids: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    const id: string = makeId();

    issues.push({ id, status, dataStoreId: makeId() });
    ids.push(id);
  }

  return ids;
}

function readIds(value: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Record<string, unknown> } = value as {
    objectLiteralParameters?: Record<string, unknown>;
  };

  return (
    Object.values(raw?.objectLiteralParameters || {}).flat() as Array<unknown>
  ).map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

function proposalOf(
  kind: DataSecurityAiProposalKind,
  plan: JSONObject,
): DataSecurityAiProposal {
  const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();

  proposal.id = new ObjectID(makeId());
  proposal.kind = kind;
  proposal.plan = plan;
  proposal.status = DataSecurityAiProposalStatus.Proposed;
  proposal.dataSecurityIssueGroupId = GROUP_ID;

  return proposal;
}

// A line, with its link's address taken out: what a reader reads of it.
function words(line: string): string {
  return line.replace(/\]\([^)]*\)/g, "]");
}

beforeEach(() => {
  issues = [];
  lines = [];
  inFlight = 0;
  mostInFlight = 0;
  waiting = [];
  claims = [];
  claimWins = true;

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const asked: Array<string> = findBy.query["_id"]
        ? readIds(findBy.query["_id"])
        : [];
      const stores: Array<string> = findBy.query["dataStoreId"]
        ? readIds(findBy.query["dataStoreId"])
        : [];

      return issues
        .filter((row: { id: string; status: string; dataStoreId: string }) => {
          return (
            (asked.length === 0 || asked.includes(row.id)) &&
            (stores.length === 0 || stores.includes(row.dataStoreId)) &&
            (!findBy.query["status"] || findBy.query["status"] === row.status)
          );
        })
        .map((row: { id: string }): DataSecurityIssue => {
          const issue: DataSecurityIssue = new DataSecurityIssue();

          issue.id = new ObjectID(row.id);

          return issue;
        });
    }) as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockImplementation((async (data: {
      dataSecurityIssueId: ObjectID;
      eventType: string;
      feedInfoInMarkdown: string;
      displayColor: { toString: () => string };
      userId?: ObjectID;
      dataSecurityAiProposalId?: ObjectID;
    }) => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      lines.push({
        issueId: data.dataSecurityIssueId.toString().toLowerCase(),
        eventType: data.eventType,
        markdown: data.feedInfoInMarkdown,
        color: data.displayColor.toString(),
        userId: data.userId?.toString(),
        proposalId: data.dataSecurityAiProposalId?.toString(),
      });
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async () => {
      return waiting;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: {
      proposalId: ObjectID;
      fromStatuses: Array<string>;
      set: JSONObject;
    }) => {
      expect(data.fromStatuses).toEqual([
        DataSecurityAiProposalStatus.Proposed,
      ]);
      claims.push({ proposalId: data.proposalId.toString(), set: data.set });

      return claimWins ? 1 : 0;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lines", () => {
  test("a pull request proposed: the code that declares the issue's store, and where it waits, linked", () => {
    const line: string = getGroupProposedLine({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      aiPageUrl: AI_PAGE,
    }).toString();

    expect(line).toContain(
      "OneUptime AI proposes one pull request that fixes this issue's cause",
    );
    expect(line).toContain("the code that declares its store");
    expect(line).toContain(`(${AI_PAGE})`);
    expect(words(line)).not.toMatch(/\d/);
  });

  test("the one approval proposed: the action its own store would take, and that it always asks", () => {
    const line: string = getGroupProposedLine({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      action: DataSecurityResponseAction.TurnOnVersioning,
      aiPageUrl: AI_PAGE,
    }).toString();

    expect(line).toContain("**Turn on versioning**");
    expect(line).toContain("always waits for a person");
    expect(line).toContain(`(${AI_PAGE})`);

    const withNoAction: string = getGroupProposedLine({
      kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
      aiPageUrl: AI_PAGE,
    }).toString();

    expect(withNoAction).toContain("through its store's cloud connection");
    expect(withNoAction).not.toContain("**");
  });

  test("dismissed: never the reason, which a person wrote about the whole group", () => {
    const line: string = getGroupDismissedLine({
      aiPageUrl: AI_PAGE,
    }).toString();

    expect(line).toContain(
      "Dismissed OneUptime AI's proposal to fix this issue's cause",
    );
    expect(line).toContain(`(${AI_PAGE})`);
    expect(words(line)).not.toMatch(/\d/);
  });

  test("expired: why, in words that name no other issue", () => {
    const lines: Array<string> = [
      getGroupExpiredLine({ why: GroupProposalExpiry.NoLongerNeeded }),
      getGroupExpiredLine({
        why: GroupProposalExpiry.FixAskedForAnotherWay,
        byPerson: true,
      }),
      getGroupExpiredLine({
        why: GroupProposalExpiry.FixAskedForAnotherWay,
        byPlaybook: true,
      }),
      getGroupExpiredLine({ why: GroupProposalExpiry.FixAskedForAnotherWay }),
    ].map((line: { toString: () => string }): string => {
      return line.toString();
    });

    expect(lines[0]).toContain("it is no longer needed");
    expect(lines[1]).toContain("from the Issues list");
    expect(lines[2]).toContain("a security playbook asked for the fix");
    expect(lines[3]).toContain("asked for another way");

    for (const line of lines) {
      expect(line).toContain(
        "OneUptime AI's proposal to fix this issue's cause expired",
      );
      expect(line).not.toMatch(/\d/);
      expect(line.toLowerCase()).not.toContain("group");
    }
  });

  test("the action each issue's store takes is read from the plan's actions", () => {
    const [bucket, table]: Array<string> = [makeId(), makeId()];

    expect(
      getProposalActionOfIssues({
        actions: [
          {
            action: DataSecurityResponseAction.TurnOnVersioning,
            issueIds: [bucket!.toUpperCase()],
          },
          {
            action: DataSecurityResponseAction.TurnOnPointInTimeRecovery,
            issueIds: [table],
          },
          { action: "Delete everything", issueIds: [makeId()] },
          "not an entry",
        ],
      } as unknown as JSONObject),
    ).toEqual(
      new Map([
        [bucket, DataSecurityResponseAction.TurnOnVersioning],
        [table, DataSecurityResponseAction.TurnOnPointInTimeRecovery],
      ]),
    );
    expect(getProposalActionOfIssues({})).toEqual(new Map());
    expect(getProposalActionOfIssues(null)).toEqual(new Map());
  });
});

describe("when OneUptime AI proposes a group's fix that waits", () => {
  async function proposed(
    kind: DataSecurityAiProposalKind,
    plan: JSONObject,
    toldAlready?: Set<string>,
  ): Promise<number> {
    return await DataSecurityIssueGroupTimelines.onProposed({
      projectId: PROJECT_ID,
      proposalId: "10741000-0000-4000-8000-0000000000f1",
      kind,
      plan,
      groupId: GROUP_ID,
      ...(toldAlready ? { toldAlready } : {}),
    });
  }

  test("each open issue it is for says so, once, with the proposal behind the line", async () => {
    const open: Array<string> = addIssues(3);
    const closed: Array<string> = addIssues(
      1,
      DataSecurityIssueStatus.Resolved,
    );

    expect(
      await proposed(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: [...open, ...closed],
      }),
    ).toBe(3);
    expect(
      lines.map((line: Line): string => {
        return line.issueId;
      }),
    ).toEqual(open);

    for (const line of lines) {
      expect(line.eventType).toBe(DataSecurityIssueFeedEventType.AiProposed);
      expect(line.color).toBe(Purple500.toString());
      expect(line.userId).toBeUndefined();
      expect(line.proposalId).toBe("10741000-0000-4000-8000-0000000000f1");
      expect(line.markdown).toContain("/data-security/ai");
    }
  });

  test("the one approval's line names the action of its own store", async () => {
    const [bucket, table]: Array<string> = addIssues(2);

    await proposed(DataSecurityAiProposalKind.FixIssueGroupInCloud, {
      issueIds: [bucket!, table!],
      actions: [
        {
          action: DataSecurityResponseAction.TurnOnVersioning,
          issueIds: [bucket!],
        },
        {
          action: DataSecurityResponseAction.TurnOnPointInTimeRecovery,
          issueIds: [table!],
        },
      ],
    });

    expect(
      lines.find((line: Line): boolean => {
        return line.issueId === bucket;
      })?.markdown,
    ).toContain("**Turn on versioning**");
    expect(
      lines.find((line: Line): boolean => {
        return line.issueId === table;
      })?.markdown,
    ).toContain("**Turn on point-in-time recovery**");
  });

  test("a newer proposal that replaces one still waiting tells only the issues not told yet", async () => {
    const told: Array<string> = addIssues(3);
    const joined: Array<string> = addIssues(1);

    expect(
      await proposed(
        DataSecurityAiProposalKind.FixIssueGroupInCode,
        { issueIds: [...told, ...joined] },
        new Set(told),
      ),
    ).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.issueId).toBe(joined[0]);
  });

  test("a large group is quiet: more open issues than the cap, and no line at all", async () => {
    const open: Array<string> = addIssues(MAX_TIMELINE_ISSUES + 1);

    expect(
      await proposed(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: open,
      }),
    ).toBe(0);
    expect(lines).toHaveLength(0);
  });

  test("as many as the cap are each told, a batch at a time", async () => {
    const open: Array<string> = addIssues(MAX_TIMELINE_ISSUES);

    expect(
      await proposed(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: open,
      }),
    ).toBe(MAX_TIMELINE_ISSUES);
    expect(lines).toHaveLength(MAX_TIMELINE_ISSUES);
    expect(mostInFlight).toBeLessThanOrEqual(MAX_TIMELINE_BATCH);
    expect(mostInFlight).toBeGreaterThan(1);
  });

  test("a one approval proposed before it listed its issues is for the group's issues on its stores", async () => {
    addIssues(2);

    const storeIds: Array<string> = issues.map(
      (row: { dataStoreId: string }): string => {
        return row.dataStoreId;
      },
    );

    expect(
      await proposed(DataSecurityAiProposalKind.FixIssueGroupInCloud, {
        storeIds,
      }),
    ).toBe(2);
  });

  test("never throws: a proposal stands whatever its issues' timelines say", async () => {
    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockRejectedValue(new Error("The database went away.") as never);

    expect(
      await proposed(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: [makeId()],
      }),
    ).toBe(0);
  });

  test("the issues the group's waiting proposals of a kind are for: what a newer one need not tell again", async () => {
    const first: Array<string> = addIssues(2);
    const second: Array<string> = addIssues(1);

    waiting = [
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: first,
      }),
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: second,
      }),
    ];

    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataSecurityAiProposalService,
      "findBy",
    );

    expect(
      await DataSecurityIssueGroupTimelines.readWaitingIssueIds({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      }),
    ).toEqual(new Set([...first, ...second]));
    expect((findBy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual({
      projectId: PROJECT_ID,
      dataSecurityIssueGroupId: GROUP_ID,
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      status: DataSecurityAiProposalStatus.Proposed,
    });

    jest
      .spyOn(DataSecurityAiProposalService, "findBy")
      .mockRejectedValue(new Error("The database went away.") as never);

    expect(
      await DataSecurityIssueGroupTimelines.readWaitingIssueIds({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      }),
    ).toEqual(new Set());
  });
});

describe("when a person dismisses a group's proposal", () => {
  test("each issue it was for says so, with who, whatever it stands at now", async () => {
    const open: Array<string> = addIssues(2);
    const closed: Array<string> = addIssues(
      1,
      DataSecurityIssueStatus.Resolved,
    );
    const proposal: DataSecurityAiProposal = proposalOf(
      DataSecurityAiProposalKind.FixIssueGroupInCode,
      { issueIds: [...open, ...closed] },
    );

    expect(
      await DataSecurityIssueGroupTimelines.onDismissed({
        projectId: PROJECT_ID,
        proposal,
        userId: USER_ID,
      }),
    ).toBe(3);

    for (const line of lines) {
      expect(line.eventType).toBe(
        DataSecurityIssueFeedEventType.AiProposalDismissed,
      );
      expect(line.color).toBe(Gray500.toString());
      expect(line.userId).toBe(USER_ID.toString());
      expect(line.proposalId).toBe(proposal.id!.toString());
    }
  });

  test("a large group is quiet", async () => {
    const proposal: DataSecurityAiProposal = proposalOf(
      DataSecurityAiProposalKind.FixIssueGroupInCode,
      { issueIds: addIssues(MAX_TIMELINE_ISSUES + 1) },
    );

    expect(
      await DataSecurityIssueGroupTimelines.onDismissed({
        projectId: PROJECT_ID,
        proposal,
        userId: USER_ID,
      }),
    ).toBe(0);
    expect(lines).toHaveLength(0);
  });
});

describe("when what a group's fix still waited for expires", () => {
  test("each waiting proposal is claimed on its own, and each issue it was for says why", async () => {
    const code: Array<string> = addIssues(2);
    const cloud: Array<string> = addIssues(1);
    const at: Date = new Date("2026-11-24T12:00:00.000Z");

    waiting = [
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: code,
      }),
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCloud, {
        issueIds: cloud,
      }),
    ];

    expect(
      await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        at,
        why: GroupProposalExpiry.NoLongerNeeded,
      }),
    ).toBe(2);
    expect(claims).toEqual([
      {
        proposalId: waiting[0]!.id!.toString(),
        set: { status: DataSecurityAiProposalStatus.Expired, expiredAt: at },
      },
      {
        proposalId: waiting[1]!.id!.toString(),
        set: { status: DataSecurityAiProposalStatus.Expired, expiredAt: at },
      },
    ]);
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      expect(line.eventType).toBe(
        DataSecurityIssueFeedEventType.AiProposalExpired,
      );
      expect(line.markdown).toContain("it is no longer needed");
      expect(line.userId).toBeUndefined();
    }
  });

  test("one a person approved at that very moment is theirs: nothing is said of it", async () => {
    waiting = [
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: addIssues(2),
      }),
    ];
    claimWins = false;

    expect(
      await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        at: new Date(),
        why: GroupProposalExpiry.NoLongerNeeded,
      }),
    ).toBe(0);
    expect(lines).toHaveLength(0);
  });

  test("the fix asked for another way says who: a person from the Issues list, or a playbook", async () => {
    waiting = [
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: addIssues(1),
      }),
    ];

    await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      kinds: [DataSecurityAiProposalKind.FixIssueGroupInCode],
      at: new Date(),
      why: GroupProposalExpiry.FixAskedForAnotherWay,
      userId: USER_ID,
    });

    expect(lines[0]!.markdown).toContain("from the Issues list");
    expect(lines[0]!.userId).toBe(USER_ID.toString());

    lines = [];
    await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      kinds: [DataSecurityAiProposalKind.FixIssueGroupInCode],
      at: new Date(),
      why: GroupProposalExpiry.FixAskedForAnotherWay,
      byPlaybook: true,
    });

    expect(lines[0]!.markdown).toContain("a security playbook");
    expect(lines[0]!.userId).toBeUndefined();
  });

  test("only the kinds asked, and none when no kind is", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataSecurityAiProposalService,
      "findBy",
    );

    await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      kinds: [DataSecurityAiProposalKind.FixIssueGroupInCloud],
      at: new Date(),
      why: GroupProposalExpiry.NoLongerNeeded,
    });

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(query["dataSecurityIssueGroupId"]).toEqual(GROUP_ID);
    expect(readIds(query["kind"])).toEqual([
      DataSecurityAiProposalKind.FixIssueGroupInCloud.toLowerCase(),
    ]);

    findBy.mockClear();

    expect(
      await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        kinds: [],
        at: new Date(),
        why: GroupProposalExpiry.NoLongerNeeded,
      }),
    ).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a large group's proposal still expires, quietly", async () => {
    waiting = [
      proposalOf(DataSecurityAiProposalKind.FixIssueGroupInCode, {
        issueIds: addIssues(MAX_TIMELINE_ISSUES + 1),
      }),
    ];

    expect(
      await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        at: new Date(),
        why: GroupProposalExpiry.NoLongerNeeded,
      }),
    ).toBe(1);
    expect(lines).toHaveLength(0);
  });

  test("never throws", async () => {
    jest
      .spyOn(DataSecurityAiProposalService, "findBy")
      .mockRejectedValue(new Error("The database went away.") as never);

    expect(
      await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
        projectId: PROJECT_ID,
        groupId: GROUP_ID,
        at: new Date(),
        why: GroupProposalExpiry.NoLongerNeeded,
      }),
    ).toBe(0);
  });
});
