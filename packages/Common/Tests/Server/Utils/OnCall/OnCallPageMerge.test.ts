import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import logger from "../../../../Server/Utils/Logger";
import OnCallPageMerge, {
  OnCallMergedPageReading,
  OnCallMergedPageStanding,
  OnCallPageCover,
} from "../../../../Server/Utils/OnCall/OnCallPageMerge";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import { meetsCondition } from "../../TestingUtils/QueryConditions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE READS BEHIND ONE PAGE FOR SOMEBODY TWO POLICIES PAGE (issue #7837,
 * Server/Utils/OnCall/OnCallPageMerge).
 *
 * findCovers: as Billing's level pages Ana and Bob about an incident, which
 * of them has an open page about it from another policy's run - Payments' -
 * that their page in Billing's run is merged into. readMergedPage: where the
 * page a merged one stands on is, each minute. findMergedPagesToAnswer: a
 * person's merged pages about a record, answered with the page they answer.
 */

const PROJECT: ObjectID = new ObjectID("78371000-0000-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("78371000-0000-4000-8000-000000000002");
const BILLING_RUN: ObjectID = new ObjectID(
  "78371000-0000-4000-8000-000000000003",
);
const PAYMENTS_RUN: ObjectID = new ObjectID(
  "78371000-0000-4000-8000-000000000004",
);
const ANA: ObjectID = new ObjectID("78371000-0000-4000-8000-000000000005");
const BOB: ObjectID = new ObjectID("78371000-0000-4000-8000-000000000006");
const POLICY: ObjectID = new ObjectID("78371000-0000-4000-8000-000000000007");

let nextLog: number = 0;

function run(
  data: Partial<OnCallDutyPolicyExecutionLog>,
): OnCallDutyPolicyExecutionLog {
  const row: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  row.onCallDutyPolicyId = POLICY;
  row.status = OnCallDutyPolicyStatus.Executing;
  Object.assign(row, data);
  return row;
}

// A person's page, as the cover read hands it back: with its run and policy.
function page(data: {
  userId: ObjectID;
  runId?: ObjectID | undefined;
  status?: UserNotificationExecutionStatus | undefined;
  minutesAgo?: number | undefined;
  eventType?: UserNotificationEventType | undefined;
  run?: OnCallDutyPolicyExecutionLog | null | undefined;
  policyName?: string | undefined;
}): UserOnCallLog {
  nextLog++;
  const log: UserOnCallLog = new UserOnCallLog();
  log.id = new ObjectID(
    `78371000-0000-4000-9000-${String(nextLog).padStart(12, "0")}`,
  );
  log.userId = data.userId;
  log.status = data.status || UserNotificationExecutionStatus.Executing;
  log.createdAt = new Date(Date.now() - (data.minutesAgo || 1) * 60 * 1000);
  log.userNotificationEventType =
    data.eventType || UserNotificationEventType.IncidentCreated;
  log.onCallDutyPolicyExecutionLogId = data.runId || PAYMENTS_RUN;

  if (data.run !== null) {
    log.onCallDutyPolicyExecutionLog = data.run || run({});
  }

  log.onCallDutyPolicy = { name: data.policyName ?? "Payments" } as never;

  return log;
}

let billingRun: OnCallDutyPolicyExecutionLog | null;
let pages: Array<UserOnCallLog>;
let pageReads: Array<Record<string, unknown>>;
let errors: Array<string>;

async function coversOf(
  userIds: Array<ObjectID> = [ANA, BOB],
): Promise<Map<string, OnCallPageCover>> {
  return await OnCallPageMerge.findCovers({
    projectId: PROJECT,
    executionLogId: BILLING_RUN,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    record: { triggeredByIncidentId: INCIDENT },
    userIds: userIds,
  });
}

function coverOf(
  covers: Map<string, OnCallPageCover>,
  userId: ObjectID,
): OnCallPageCover | undefined {
  return covers.get(OnCallPageMerge.getUserKey(userId));
}

beforeEach(() => {
  nextLog = 0;
  billingRun = run({});
  pages = [];
  pageReads = [];
  errors = [];

  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockImplementation((async () => {
      return billingRun;
    }) as never);

  jest.spyOn(UserOnCallLogService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    pageReads.push(data.query);

    // The read's conditions, as Postgres answers them.
    return pages.filter((row: UserOnCallLog): boolean => {
      return (
        meetsCondition(data.query["userId"], row.userId!.toString()) &&
        meetsCondition(data.query["status"], row.status) &&
        !row.acknowledgedAt
      );
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the open pages a level merges its people's pages into", () => {
  test("one read for the level: the people's pages about the record, still open and not answered", async () => {
    pages = [page({ userId: ANA })];

    const covers: Map<string, OnCallPageCover> = await coversOf();

    expect(pageReads).toHaveLength(1);
    expect(pageReads[0]!["projectId"]).toEqual(PROJECT);
    expect(pageReads[0]!["triggeredByIncidentId"]).toEqual(INCIDENT);
    expect(coverOf(covers, ANA)).toEqual({
      userOnCallLogId: pages[0]!.id,
      executionLogId: PAYMENTS_RUN,
      policyName: "Payments",
    });
    expect(coverOf(covers, BOB)).toBeUndefined();
  });

  test("of two open pages, the person's first", async () => {
    const later: UserOnCallLog = page({ userId: ANA, minutesAgo: 1 });
    const first: UserOnCallLog = page({ userId: ANA, minutesAgo: 9 });
    pages = [later, first];

    expect(coverOf(await coversOf(), ANA)?.userOnCallLogId).toEqual(first.id);
  });

  test("this run's own pages of them are its own, not another's", async () => {
    pages = [page({ userId: ANA, runId: BILLING_RUN })];

    expect(coverOf(await coversOf(), ANA)).toBeUndefined();
  });

  test("a page of another kind is no page of this", async () => {
    pages = [
      page({
        userId: ANA,
        eventType: UserNotificationEventType.IncidentEpisodeCreated,
      }),
    ];

    expect(coverOf(await coversOf(), ANA)).toBeUndefined();
  });

  test.each([
    [UserNotificationExecutionStatus.Scheduled, true],
    [UserNotificationExecutionStatus.Started, true],
    [UserNotificationExecutionStatus.Executing, true],
    [UserNotificationExecutionStatus.PassedOn, false],
    [UserNotificationExecutionStatus.Error, false],
    [UserNotificationExecutionStatus.AlreadyPaged, false],
  ])(
    "a page that is %s is open: %s",
    async (status: UserNotificationExecutionStatus, isOpen: boolean) => {
      pages = [page({ userId: ANA, status: status })];

      expect(Boolean(coverOf(await coversOf(), ANA))).toBe(isOpen);
    },
  );

  test.each([
    [OnCallDutyPolicyStatus.Executing, true],
    [OnCallDutyPolicyStatus.Started, true],
    [OnCallDutyPolicyStatus.Completed, false],
    [OnCallDutyPolicyStatus.Error, false],
  ])(
    "a page whose notifications all went out is open while its run is %s: %s",
    async (runStatus: OnCallDutyPolicyStatus, isOpen: boolean) => {
      pages = [
        page({
          userId: ANA,
          status: UserNotificationExecutionStatus.Completed,
          run: run({ status: runStatus }),
        }),
      ];

      expect(Boolean(coverOf(await coversOf(), ANA))).toBe(isOpen);
    },
  );

  test("an answered page is not open", async () => {
    const answered: UserOnCallLog = page({ userId: ANA });
    answered.acknowledgedAt = new Date();

    expect(OnCallPageMerge.isOpen(answered)).toBe(false);
  });

  test.each([
    ["an observer's page", run({ isObserverPage: true }), false],
    ["a page again", run({ pageAgainNumber: 1 }), true],
    ["a policy started by hand", run({ triggeredByUserId: BOB }), true],
    [
      "a direct page",
      Object.assign(new OnCallDutyPolicyExecutionLog(), {
        status: OnCallDutyPolicyStatus.Executing,
        triggeredByUserId: BOB,
      }),
      false,
    ],
    [
      "a test page",
      run({ userNotificationEventType: UserNotificationEventType.TestPage }),
      false,
    ],
  ])(
    "their page in %s may stand for theirs here: %s",
    async (
      _name: string,
      theirRun: OnCallDutyPolicyExecutionLog,
      isACover: boolean,
    ) => {
      pages = [page({ userId: ANA, run: theirRun })];

      expect(Boolean(coverOf(await coversOf(), ANA))).toBe(isACover);
    },
  );

  test("a page whose run cannot be read stands for nothing", async () => {
    pages = [page({ userId: ANA, run: null })];

    expect(coverOf(await coversOf(), ANA)).toBeUndefined();
  });

  test("a policy with no name is named as none", async () => {
    pages = [page({ userId: ANA, policyName: "  " })];

    expect(coverOf(await coversOf(), ANA)?.policyName).toBeNull();
  });

  test.each([
    ["a page again", run({ pageAgainNumber: 2 })],
    ["a policy started by hand", run({ triggeredByUserId: BOB })],
    ["an observer's page", run({ isObserverPage: true })],
    [
      "a test page",
      run({ userNotificationEventType: UserNotificationEventType.TestPage }),
    ],
  ])(
    "%s pages everybody itself: no page is read for it",
    async (_name: string, thisRun: OnCallDutyPolicyExecutionLog) => {
      billingRun = thisRun;
      pages = [page({ userId: ANA })];

      expect((await coversOf()).size).toBe(0);
      expect(pageReads).toEqual([]);
    },
  );

  test("a page about no record, or nobody to page, reads nothing", async () => {
    pages = [page({ userId: ANA })];

    expect(
      (
        await OnCallPageMerge.findCovers({
          projectId: PROJECT,
          executionLogId: BILLING_RUN,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          record: {},
          userIds: [ANA],
        })
      ).size,
    ).toBe(0);
    expect((await coversOf([])).size).toBe(0);
    expect(pageReads).toEqual([]);
  });

  test("a read that fails merges nothing: everybody is paged as before, and it is logged", async () => {
    jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockRejectedValue(new Error("connection reset") as never);

    expect((await coversOf()).size).toBe(0);
    expect(errors.join("\n")).toContain("paging everybody as before");
  });
});

describe("where the page a merged one stands on is, each minute", () => {
  function mergedPage(into: ObjectID | undefined): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();
    log.id = new ObjectID("78371000-0000-4000-8000-0000000000aa");
    log.status = UserNotificationExecutionStatus.AlreadyPaged;

    if (into) {
      log.mergedIntoUserOnCallLogId = into;
    }

    return log;
  }

  async function reading(
    cover: UserOnCallLog | null,
  ): Promise<OnCallMergedPageReading> {
    jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(cover as never);

    return await OnCallPageMerge.readMergedPage(
      mergedPage(
        cover?.id || new ObjectID("78371000-0000-4000-8000-0000000000bb"),
      ),
    );
  }

  const SENT: JSONObject = {
    "push-rule": "2026-11-16T03:00:00.000Z",
    "push-rule:repeat:1": "2026-11-16T03:03:00.000Z",
  };

  test("still sending: the merged page waits", async () => {
    expect((await reading(page({ userId: ANA }))).standing).toBe(
      OnCallMergedPageStanding.Waits,
    );
  });

  test("answered by them: the merged page is answered with it, at that moment", async () => {
    const cover: UserOnCallLog = page({
      userId: ANA,
      status: UserNotificationExecutionStatus.Completed,
    });
    cover.acknowledgedAt = new Date("2026-11-16T03:04:00.000Z");

    expect(await reading(cover)).toEqual({
      standing: OnCallMergedPageStanding.Answered,
      acknowledgedAt: new Date("2026-11-16T03:04:00.000Z"),
      claimsSent: {},
      policyName: "Payments",
    });
  });

  test("escalated by them: the merged page takes the page over, counting what it sent", async () => {
    const cover: UserOnCallLog = page({
      userId: ANA,
      status: UserNotificationExecutionStatus.PassedOn,
    });
    cover.executedNotificationRules = SENT;

    expect(await reading(cover)).toEqual({
      standing: OnCallMergedPageStanding.TakesOver,
      claimsSent: SENT,
      policyName: "Payments",
    });
  });

  test("failed: the merged page takes the page over, counting nothing as sent", async () => {
    const cover: UserOnCallLog = page({
      userId: ANA,
      status: UserNotificationExecutionStatus.Error,
    });
    cover.executedNotificationRules = SENT;

    expect((await reading(cover)).claimsSent).toEqual({});
    expect((await reading(cover)).standing).toBe(
      OnCallMergedPageStanding.TakesOver,
    );
  });

  test("its run stopped, with everything sent: the merged page takes the page over, with it all counted", async () => {
    const cover: UserOnCallLog = page({
      userId: ANA,
      status: UserNotificationExecutionStatus.Completed,
      run: run({ status: OnCallDutyPolicyStatus.Completed }),
    });
    cover.executedNotificationRules = SENT;

    expect(await reading(cover)).toMatchObject({
      standing: OnCallMergedPageStanding.TakesOver,
      claimsSent: SENT,
    });
  });

  test("gone: the merged page takes the page over from the start", async () => {
    expect(await reading(null)).toEqual({
      standing: OnCallMergedPageStanding.TakesOver,
      claimsSent: {},
      policyName: null,
    });
  });

  test("a merged page that names no page takes it over without a read", async () => {
    const findOneById: jest.SpiedFunction<
      typeof UserOnCallLogService.findOneById
    > = jest.spyOn(UserOnCallLogService, "findOneById");

    expect(
      (await OnCallPageMerge.readMergedPage(mergedPage(undefined))).standing,
    ).toBe(OnCallMergedPageStanding.TakesOver);
    expect(findOneById).not.toHaveBeenCalled();
  });
});

describe("a person's merged pages about a record, answered with their answer", () => {
  test("reads their Already Paged pages about it, in the answer's project", async () => {
    await OnCallPageMerge.findMergedPagesToAnswer({
      projectId: PROJECT,
      userId: ANA,
      record: { triggeredByAlertId: INCIDENT },
    });

    expect(pageReads).toEqual([
      {
        projectId: PROJECT,
        userId: ANA,
        triggeredByAlertId: INCIDENT,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      },
    ]);
  });

  test("an answer that does not know its project reads by the record alone", async () => {
    await OnCallPageMerge.findMergedPagesToAnswer({
      userId: ANA,
      record: { triggeredByIncidentEpisodeId: INCIDENT },
    });

    expect(pageReads[0]).toEqual({
      userId: ANA,
      triggeredByIncidentEpisodeId: INCIDENT,
      status: UserNotificationExecutionStatus.AlreadyPaged,
    });
  });

  test("a page about no record has none", async () => {
    expect(
      await OnCallPageMerge.findMergedPagesToAnswer({
        userId: ANA,
        record: {},
      }),
    ).toEqual([]);
    expect(pageReads).toEqual([]);
  });
});
