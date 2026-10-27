import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import URL from "../../../Types/API/URL";
import { Blue500, Yellow500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import {
  ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH,
  ON_CALL_POLICY_RUN_WAITING_MESSAGE_START,
  getOnCallPolicyRunEndedWhileWaitingMessage,
  getOnCallPolicyRunWaitingMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * A RUN THAT WAITS TO PAGE (OnCallDutyPolicyRunWait).
 *
 * executePolicy holds a run until the moment it is handed - an on-call rule
 * that pages only during working hours hands the moment its hours begin. The
 * run is created Waiting, says so in its record's feed and pages nobody: no
 * escalation rule is looked up or started. When its moment comes the worker
 * starts it at its first escalation rule (startWaitingRun), or ends it
 * there, unpaged, if its record was handled in the meantime (endWaitingRun).
 * Both are claimed with one conditional UPDATE from Waiting, so two ticks
 * never page it twice, and never page one another tick has just ended.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000003");
const RUN_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000004");
const RULE_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000005");

const HOUR: number = 60 * 60 * 1000;

const WORKING_HOURS_MESSAGE: string =
  "Waiting for working hours. Paging starts Tue 09:00 (Europe/London).";

interface CreateArgs {
  data: OnCallDutyPolicyExecutionLog;
  props: { isRoot?: boolean; ignoreHooks?: boolean };
}

type BeforeCreateResult = {
  createBy: { data: OnCallDutyPolicyExecutionLog };
  carryForward: unknown;
};

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<BeforeCreateResult>;
  onCreateSuccess: (
    onCreate: unknown,
    createdItem: OnCallDutyPolicyExecutionLog,
  ) => Promise<OnCallDutyPolicyExecutionLog>;
};

const hooks: Hooks = OnCallDutyPolicyExecutionLogService as unknown as Hooks;

function livePolicy(): OnCallDutyPolicy {
  const row: OnCallDutyPolicy = new OnCallDutyPolicy();
  row.id = POLICY_ID;
  row.projectId = PROJECT_ID;
  row.name = "Platform on-call";
  row.isArchived = false;
  return row;
}

type RecordKind = "alert" | "incident" | "alert episode" | "incident episode";

function run(data: {
  status: OnCallDutyPolicyStatus;
  statusMessage?: string | undefined;
  pagingStartsAt?: Date | undefined;
  recordKind?: RecordKind | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = RUN_ID;
  log.projectId = PROJECT_ID;
  log.onCallDutyPolicyId = POLICY_ID;
  log.status = data.status;
  log.statusMessage = data.statusMessage || "";

  if (data.pagingStartsAt) {
    log.pagingStartsAt = data.pagingStartsAt;
  }

  switch (data.recordKind || "alert") {
    case "incident":
      log.triggeredByIncidentId = ALERT_ID;
      log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
      break;
    case "alert episode":
      log.triggeredByAlertEpisodeId = ALERT_ID;
      log.userNotificationEventType =
        UserNotificationEventType.AlertEpisodeCreated;
      break;
    case "incident episode":
      log.triggeredByIncidentEpisodeId = ALERT_ID;
      log.userNotificationEventType =
        UserNotificationEventType.IncidentEpisodeCreated;
      break;
    default:
      log.triggeredByAlertId = ALERT_ID;
      log.userNotificationEventType = UserNotificationEventType.AlertCreated;
  }

  return log;
}

// The repository's update: the claim from Waiting.
type RepositoryUpdate = Mock<
  (...args: Array<unknown>) => Promise<{ affected: number }>
>;

interface Stubs {
  repositoryUpdate: RepositoryUpdate;
  updateOneById: jest.SpyInstance;
  ruleFindOneBy: jest.SpyInstance;
  startRuleExecution: jest.SpyInstance;
  alertFeed: jest.SpyInstance;
  incidentFeed: jest.SpyInstance;
  alertEpisodeFeed: jest.SpyInstance;
  incidentEpisodeFeed: jest.SpyInstance;
  refresh: jest.SpyInstance;
}

function stub(options?: {
  claimWins?: boolean;
  hasFirstRule?: boolean;
}): Stubs {
  const repositoryUpdate: RepositoryUpdate = jest.fn<
    (...args: Array<unknown>) => Promise<{ affected: number }>
  >(async (): Promise<{ affected: number }> => {
    return { affected: options?.claimWins === false ? 0 : 1 };
  });

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "getRepository")
    .mockReturnValue({ update: repositoryUpdate } as never);

  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(livePolicy());
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}`,
      ),
    );

  const firstRule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  firstRule.id = RULE_ID;

  return {
    repositoryUpdate: repositoryUpdate,
    updateOneById: jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance,
    ruleFindOneBy: jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(
        options?.hasFirstRule === false ? null : firstRule,
      ) as unknown as jest.SpyInstance,
    startRuleExecution: jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      } as never) as unknown as jest.SpyInstance,
    alertFeed: jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance,
    incidentFeed: jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance,
    alertEpisodeFeed: jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance,
    incidentEpisodeFeed: jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance,
    refresh: jest
      .spyOn(OnCallPolicyRunMessage, "refresh")
      .mockImplementation(() => {
        return undefined;
      }) as unknown as jest.SpyInstance,
  };
}

function feedTexts(spy: jest.SpyInstance): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

beforeEach(() => {
  // The records a log names belong to its project (checked elsewhere).
  jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("executePolicy with a moment to start paging", () => {
  function stubCreate(): jest.SpyInstance {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(livePolicy());

    return jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation(async (args: unknown) => {
        return (args as CreateArgs).data;
      }) as unknown as jest.SpyInstance;
  }

  test("later than now, creates the run waiting, with the moment and what it says", async () => {
    const create: jest.SpyInstance = stubCreate();
    const pagingStartsAt: Date = new Date(Date.now() + 7 * HOUR);

    await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
      triggeredByAlertId: ALERT_ID,
      userNotificationEventType: UserNotificationEventType.AlertCreated,
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: WORKING_HOURS_MESSAGE,
    });

    const args: CreateArgs = create.mock.calls[0]![0] as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(args.data.pagingStartsAt).toEqual(pagingStartsAt);
    expect(args.data.statusMessage).toBe(WORKING_HOURS_MESSAGE);
    // Through the log service's hooks, as every run: they hold the rules.
    expect(args.props.isRoot).toBe(true);
    expect(args.props.ignoreHooks).toBeUndefined();
  });

  test("now or earlier, pages straight away, as every run did before", async () => {
    const create: jest.SpyInstance = stubCreate();

    await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
      triggeredByAlertId: ALERT_ID,
      userNotificationEventType: UserNotificationEventType.AlertCreated,
      pagingStartsAt: new Date(Date.now() - 1000),
      waitingStatusMessage: WORKING_HOURS_MESSAGE,
    });

    const args: CreateArgs = create.mock.calls[0]![0] as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(args.data.statusMessage).toBe("Scheduled.");
    expect(args.data.pagingStartsAt).toBeUndefined();
  });
});

describe("creating a run that waits", () => {
  beforeEach(() => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(livePolicy());
  });

  test("keeps it waiting, with the words it was given", async () => {
    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(Date.now() + 7 * HOUR),
      }),
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(onCreate.createBy.data.statusMessage).toBe(WORKING_HOURS_MESSAGE);
    expect(onCreate.carryForward).toEqual({ isPolicyArchived: false });
  });

  test("with a moment and no status, waits, and says until when", async () => {
    const log: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Scheduled,
      pagingStartsAt: new Date(Date.now() + 7 * HOUR),
    });
    (log as unknown as Record<string, unknown>)["status"] = undefined;

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: log,
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(onCreate.createBy.data.statusMessage).toMatch(
      new RegExp(`^${ON_CALL_POLICY_RUN_WAITING_MESSAGE_START}Paging starts `),
    );
  });

  test("asked to wait with no moment to wait for, pages now", async () => {
    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
      }),
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
    expect(onCreate.createBy.data.statusMessage).toBe("Scheduled.");
  });

  test("asked to wait for a moment that is past, pages now, and keeps no moment", async () => {
    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(Date.now() - HOUR),
      }),
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
    expect(onCreate.createBy.data.pagingStartsAt).toBeUndefined();
  });

  test("for an archived policy, pages no one, as any run of one", async () => {
    const archived: OnCallDutyPolicy = livePolicy();
    archived.isArchived = true;
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(archived);

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(Date.now() + 7 * HOUR),
      }),
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(onCreate.createBy.data.statusMessage).toBe(
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    );
  });
});

describe("a run created waiting", () => {
  test("says in its alert's feed that it is not paging yet, and why and until when", async () => {
    const stubs: Stubs = stub();

    await hooks.onCreateSuccess(
      { carryForward: { isPolicyArchived: false } },
      run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(Date.now() + 7 * HOUR),
      }),
    );

    expect(stubs.alertFeed).toHaveBeenCalledTimes(1);

    const item: { displayColor: unknown; feedInfoInMarkdown: string } = stubs
      .alertFeed.mock.calls[0]![0] as {
      displayColor: unknown;
      feedInfoInMarkdown: string;
    };

    expect(item.feedInfoInMarkdown).toContain("is not paging yet.");
    expect(item.feedInfoInMarkdown).toContain("Platform on-call");
    expect(item.feedInfoInMarkdown).toContain(
      "Waiting for working hours. Paging starts Tue 09:00",
    );
    expect(item.displayColor).toEqual(Blue500);
  });

  test("pages nobody: no escalation rule is looked up or started", async () => {
    const stubs: Stubs = stub();

    await hooks.onCreateSuccess(
      { carryForward: { isPolicyArchived: false } },
      run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(Date.now() + 7 * HOUR),
      }),
    );

    expect(stubs.ruleFindOneBy).not.toHaveBeenCalled();
    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    expect(stubs.updateOneById).not.toHaveBeenCalled();
    // Its Slack and Teams message says it waits (OnCallPolicyRunMessage).
    expect(stubs.refresh).toHaveBeenCalledWith(RUN_ID);
  });

  test.each([
    ["incident", "incidentFeed"],
    ["alert episode", "alertEpisodeFeed"],
    ["incident episode", "incidentEpisodeFeed"],
  ] as Array<[RecordKind, keyof Stubs]>)(
    "for an %s, says it in that record's feed",
    async (kind: RecordKind, feed: keyof Stubs) => {
      const stubs: Stubs = stub();

      await hooks.onCreateSuccess(
        { carryForward: { isPolicyArchived: false } },
        run({
          status: OnCallDutyPolicyStatus.Waiting,
          statusMessage: WORKING_HOURS_MESSAGE,
          pagingStartsAt: new Date(Date.now() + 7 * HOUR),
          recordKind: kind,
        }),
      );

      expect(feedTexts(stubs[feed] as jest.SpyInstance)).toEqual([
        expect.stringContaining("is not paging yet."),
      ]);
      expect(stubs.alertFeed).not.toHaveBeenCalled();
    },
  );

  test("a run that pages straight away starts its first rule, as it always has", async () => {
    const stubs: Stubs = stub();

    await hooks.onCreateSuccess(
      { carryForward: { isPolicyArchived: false } },
      run({ status: OnCallDutyPolicyStatus.Scheduled }),
    );

    expect(feedTexts(stubs.alertFeed)).toEqual([
      expect.stringContaining("started paging."),
    ]);
    expect(stubs.startRuleExecution).toHaveBeenCalledTimes(1);
    expect(stubs.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: RUN_ID,
        data: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: "Execution started...",
        },
      }),
    );
  });
});

describe("starting a run whose moment came", () => {
  test("claims it from Waiting, moving its moment to now, in one conditional update", async () => {
    const stubs: Stubs = stub();
    const now: Date = new Date();

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({
          status: OnCallDutyPolicyStatus.Waiting,
          pagingStartsAt: new Date(now.getTime() - 1000),
        }),
        now: now,
      }),
    ).resolves.toBe(true);

    expect(stubs.repositoryUpdate).toHaveBeenCalledWith(
      { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Waiting },
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Execution started...",
        pagingStartsAt: now,
      },
    );
  });

  test("says in the feed that it started paging, and pages its first escalation rule", async () => {
    const stubs: Stubs = stub();

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
    });

    expect(feedTexts(stubs.alertFeed)).toEqual([
      expect.stringContaining("started paging."),
    ]);
    expect(
      (stubs.alertFeed.mock.calls[0]![0] as { displayColor: unknown })
        .displayColor,
    ).toEqual(Yellow500);

    // Its policy's first rule.
    expect(
      (
        stubs.ruleFindOneBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query,
    ).toEqual({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: POLICY_ID,
      order: 1,
    });
    expect(stubs.startRuleExecution).toHaveBeenCalledWith(
      RULE_ID,
      expect.objectContaining({
        projectId: PROJECT_ID,
        triggeredByAlertId: ALERT_ID,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
        onCallPolicyExecutionLogId: RUN_ID,
        onCallPolicyId: POLICY_ID,
      }),
    );

    // Started by the claim already; executing once the rule paged.
    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    expect(stubs.updateOneById).toHaveBeenCalledWith({
      id: RUN_ID,
      data: {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: "First escalation rule executed...",
      },
      props: { isRoot: true },
    });
    expect(stubs.refresh).toHaveBeenCalledWith(RUN_ID);
  });

  test("lost to another tick, does nothing more: its first rule pages once", async () => {
    const stubs: Stubs = stub({ claimWins: false });

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({ status: OnCallDutyPolicyStatus.Waiting }),
        now: new Date(),
      }),
    ).resolves.toBe(false);

    expect(stubs.alertFeed).not.toHaveBeenCalled();
    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });

  test("of a policy with no escalation rules, ends with the error any such run gets", async () => {
    const stubs: Stubs = stub({ hasFirstRule: false });

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
    });

    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    expect(stubs.updateOneById).toHaveBeenCalledWith({
      id: RUN_ID,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage:
          "No Escalation Rules in Policy. Please add escalation rules to this policy.",
      },
      props: { isRoot: true },
    });
  });

  test("pages even when its feed entry cannot be written", async () => {
    const stubs: Stubs = stub();
    stubs.alertFeed.mockRejectedValue(new Error("Feed is down"));

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
    });

    expect(stubs.startRuleExecution).toHaveBeenCalledTimes(1);
  });

  /*
   * Started before its moment: its record changed and now matches an on-call
   * rule that pages right away (WaitingRunsOnRecordChange).
   */
  test("started early, keeps why on the run, in the same claim", async () => {
    const stubs: Stubs = stub();
    const now: Date = new Date();

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({
          status: OnCallDutyPolicyStatus.Waiting,
          pagingStartsAt: new Date(now.getTime() + 8 * HOUR),
        }),
        now: now,
        startedEarlyReason:
          'The alert now matches on-call rule "P1 alerts", which pages right away.',
      }),
    ).resolves.toBe(true);

    expect(stubs.repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(stubs.repositoryUpdate).toHaveBeenCalledWith(
      { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Waiting },
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Execution started...",
        pagingStartsAt: now,
        pagingStartedEarlyReason:
          'The alert now matches on-call rule "P1 alerts", which pages right away.',
      },
    );
  });

  test("started early, says so in its record's feed, and why, and pages its first rule", async () => {
    const stubs: Stubs = stub();

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
      startedEarlyReason:
        'The alert now matches on-call rule "P1 alerts", which pages right away.',
    });

    expect(feedTexts(stubs.alertFeed)).toEqual([
      expect.stringMatching(
        /started paging early\. The alert now matches on-call rule "P1 alerts", which pages right away\.$/,
      ),
    ]);
    expect(stubs.startRuleExecution).toHaveBeenCalledTimes(1);
    expect(stubs.refresh).toHaveBeenCalledWith(RUN_ID);
  });

  test("a reason too long for its column is cut to fit", async () => {
    const stubs: Stubs = stub();

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
      startedEarlyReason: "x".repeat(2000),
    });

    const values: Record<string, unknown> = stubs.repositoryUpdate.mock
      .calls[0]![1] as Record<string, unknown>;

    expect(values["pagingStartedEarlyReason"]).toBe(
      "x".repeat(ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH),
    );
  });

  test("a blank reason is no reason: it started paging, as at its moment", async () => {
    const stubs: Stubs = stub();

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({ status: OnCallDutyPolicyStatus.Waiting }),
      now: new Date(),
      startedEarlyReason: "   ",
    });

    expect(
      Object.keys(
        stubs.repositoryUpdate.mock.calls[0]![1] as Record<string, unknown>,
      ),
    ).not.toContain("pagingStartedEarlyReason");
    expect(feedTexts(stubs.alertFeed)).toEqual([
      expect.stringMatching(/started paging\.$/),
    ]);
  });

  test("started early, lost to another tick, keeps no reason and pages once", async () => {
    const stubs: Stubs = stub({ claimWins: false });

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({ status: OnCallDutyPolicyStatus.Waiting }),
        now: new Date(),
        startedEarlyReason:
          'The alert now matches on-call rule "P1 alerts", which pages right away.',
      }),
    ).resolves.toBe(false);

    expect(stubs.alertFeed).not.toHaveBeenCalled();
    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });
});

describe("ending a run that waited, before it paged", () => {
  test("claims it from Waiting, and says in the feed that it paged nobody, and why", async () => {
    const stubs: Stubs = stub();
    const message: string = getOnCallPolicyRunEndedWhileWaitingMessage("alert");

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        run({
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: message,
        }),
      );

    await expect(
      OnCallDutyPolicyExecutionLogService.endWaitingRun({
        executionLogId: RUN_ID,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: message,
      }),
    ).resolves.toBe(true);

    expect(stubs.repositoryUpdate).toHaveBeenCalledWith(
      { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Waiting },
      { status: OnCallDutyPolicyStatus.Completed, statusMessage: message },
    );
    expect(feedTexts(stubs.alertFeed)).toEqual([
      expect.stringContaining(
        "did not page anyone because the alert is acknowledged or resolved.",
      ),
    ]);
    expect(stubs.refresh).toHaveBeenCalledWith(RUN_ID);
    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
  });

  test("lost to a tick that started it, leaves it to page, and says nothing", async () => {
    const stubs: Stubs = stub({ claimWins: false });

    await expect(
      OnCallDutyPolicyExecutionLogService.endWaitingRun({
        executionLogId: RUN_ID,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
      }),
    ).resolves.toBe(false);

    expect(stubs.alertFeed).not.toHaveBeenCalled();
    expect(stubs.refresh).not.toHaveBeenCalled();
  });
});

/*
 * THE RECORD'S FIRST PAGE (FirstPagedAt): "Time to acknowledge after paging"
 * counts from the first page that went out about the record - the first
 * step of a run that names who it paged and says the page went out. A run
 * that waits pages nobody until its hours begin, so an alert raised at night
 * is first paged in the morning: the step its first escalation rule writes
 * when the worker starts the run, not the moment the alert was raised.
 */
describe("a run that waited, and its record's first page", () => {
  // An alert raised at 02:00 in London, paged at 09:00.
  const NIGHT: Date = new Date("2026-10-20T01:00:00.000Z");
  const MORNING: Date = new Date("2026-10-20T08:00:00.000Z");

  interface FirstPageWrite {
    id: ObjectID;
    data: Record<string, unknown>;
    expectedData: Record<string, unknown>;
    skipUpdateDateColumn?: boolean;
  }

  type TimelineHook = (...args: Array<unknown>) => Promise<unknown>;

  const timelineOnCreateSuccess: TimelineHook = (
    OnCallDutyPolicyExecutionLogTimelineService as unknown as Record<
      string,
      TimelineHook
    >
  )["onCreateSuccess"]!.bind(OnCallDutyPolicyExecutionLogTimelineService);

  function watchFirstPages(): Array<FirstPageWrite> {
    const writes: Array<FirstPageWrite> = [];

    jest
      .spyOn(AlertService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation((async (write: FirstPageWrite): Promise<boolean> => {
        writes.push(write);
        return true;
      }) as never);
    jest
      .spyOn(AlertMeasurementValueService, "recomputeForAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "addToIncidentOrAlertFeed",
      )
      .mockResolvedValue(undefined as never);

    return writes;
  }

  // The step the first escalation rule writes when it pages somebody.
  function pageThatWentOut(at: Date): OnCallDutyPolicyExecutionLogTimeline {
    const step: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    step.id = ObjectID.generate();
    step.projectId = PROJECT_ID;
    step.onCallDutyPolicyExecutionLogId = RUN_ID;
    step.alertSentToUserId = ObjectID.generate();
    step.triggeredByAlertId = ALERT_ID;
    step.status = OnCallDutyExecutionLogTimelineStatus.NotificationSent;
    step.createdAt = at;
    return step;
  }

  test("pages nobody at night, so the night records no first page", async () => {
    const stubs: Stubs = stub();
    const firstPages: Array<FirstPageWrite> = watchFirstPages();

    await hooks.onCreateSuccess(
      { carryForward: { isPolicyArchived: false } },
      run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: MORNING,
      }),
    );

    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    expect(firstPages).toEqual([]);
  });

  test("the morning page is the alert's first, at the moment it went out", async () => {
    const stubs: Stubs = stub();
    const firstPages: Array<FirstPageWrite> = watchFirstPages();

    // Its first escalation rule pages somebody, and writes the step that says so.
    stubs.startRuleExecution.mockImplementation((async (): Promise<unknown> => {
      const step: OnCallDutyPolicyExecutionLogTimeline =
        pageThatWentOut(MORNING);

      await timelineOnCreateSuccess(
        { createBy: { data: step, props: { isRoot: true } } },
        step,
      );

      return {
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      };
    }) as never);

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({
          status: OnCallDutyPolicyStatus.Waiting,
          statusMessage: WORKING_HOURS_MESSAGE,
          pagingStartsAt: MORNING,
        }),
        now: MORNING,
      }),
    ).resolves.toBe(true);

    expect(firstPages).toEqual([
      {
        id: ALERT_ID,
        data: { firstPagedAt: MORNING },
        expectedData: { firstPagedAt: null },
        skipUpdateDateColumn: true,
      },
    ]);
    // Not when the alert was raised.
    expect(firstPages[0]!.data["firstPagedAt"]).not.toEqual(NIGHT);
  });
});

/*
 * A RUN ONEUPTIME AI HOLDS (OnCallPolicyAiHold): created waiting, as a
 * working-hours run is, and marked Holding; the claim that moves it on from
 * Waiting says how its hold ended, so its outcome and its status never
 * disagree. A run with no hold writes no outcome.
 */
describe("a run OneUptime AI holds", () => {
  const AI_HOLD_MESSAGE: string = getOnCallPolicyRunWaitingMessage({
    pagingStartsAt: new Date("2026-10-27T10:40:00.000Z"),
    isWaitingForOneUptimeAI: true,
  });

  function stubCreate(): jest.SpyInstance {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(livePolicy());

    return jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation(async (args: unknown) => {
        return (args as CreateArgs).data;
      }) as unknown as jest.SpyInstance;
  }

  function claimed(stubs: Stubs): Record<string, unknown> {
    expect(stubs.repositoryUpdate).toHaveBeenCalledTimes(1);
    return stubs.repositoryUpdate.mock.calls[0]![1] as Record<string, unknown>;
  }

  test("is created waiting, marked Holding, saying it waits for OneUptime AI", async () => {
    const create: jest.SpyInstance = stubCreate();
    const pagingStartsAt: Date = new Date(Date.now() + 10 * 60 * 1000);

    await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
      triggeredByIncidentId: ALERT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: AI_HOLD_MESSAGE,
      isAiHold: true,
    });

    const args: CreateArgs = create.mock.calls[0]![0] as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(args.data.pagingStartsAt).toEqual(pagingStartsAt);
    expect(args.data.statusMessage).toBe(AI_HOLD_MESSAGE);
    expect(args.data.aiHoldOutcome).toBe(OnCallPolicyAiHoldOutcome.Holding);
  });

  test("a working-hours wait is no AI hold", async () => {
    const create: jest.SpyInstance = stubCreate();

    await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
      triggeredByAlertId: ALERT_ID,
      userNotificationEventType: UserNotificationEventType.AlertCreated,
      pagingStartsAt: new Date(Date.now() + 7 * HOUR),
      waitingStatusMessage: WORKING_HOURS_MESSAGE,
    });

    const args: CreateArgs = create.mock.calls[0]![0] as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(args.data.aiHoldOutcome).toBeUndefined();
  });

  test("whose moment is already past pages at once, holding nothing", async () => {
    const create: jest.SpyInstance = stubCreate();

    await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
      triggeredByIncidentId: ALERT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      pagingStartsAt: new Date(Date.now() - 1000),
      waitingStatusMessage: AI_HOLD_MESSAGE,
      isAiHold: true,
    });

    const args: CreateArgs = create.mock.calls[0]![0] as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(args.data.aiHoldOutcome).toBeUndefined();
  });

  test("created to page now keeps no hold, whatever it was handed", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(livePolicy());

    const log: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Waiting,
      statusMessage: AI_HOLD_MESSAGE,
    });
    log.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: log,
      props: { isRoot: true },
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
    expect(onCreate.createBy.data.aiHoldOutcome).toBeUndefined();
  });

  test("started when its hold time ran out, says so in the same claim", async () => {
    const stubs: Stubs = stub();
    const now: Date = new Date();

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: run({
          status: OnCallDutyPolicyStatus.Waiting,
          statusMessage: AI_HOLD_MESSAGE,
          pagingStartsAt: new Date(now.getTime() - 1000),
        }),
        now: now,
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
      }),
    ).resolves.toBe(true);

    expect(stubs.repositoryUpdate).toHaveBeenCalledWith(
      { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Waiting },
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Execution started...",
        pagingStartsAt: now,
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
      },
    );
    expect(stubs.startRuleExecution).toHaveBeenCalledTimes(1);
  });

  test("handed off early, keeps why and that it was handed off, in the same claim", async () => {
    const stubs: Stubs = stub();
    const now: Date = new Date();
    const why: string = "OneUptime AI found no fix it may run on its own.";

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: AI_HOLD_MESSAGE,
        pagingStartsAt: new Date(now.getTime() + 8 * 60 * 1000),
      }),
      now: now,
      startedEarlyReason: why,
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.HandedOff,
    });

    expect(claimed(stubs)).toEqual({
      status: OnCallDutyPolicyStatus.Started,
      statusMessage: "Execution started...",
      pagingStartsAt: now,
      pagingStartedEarlyReason: why,
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.HandedOff,
    });
  });

  test.each([
    OnCallPolicyAiHoldOutcome.ResolvedByAI,
    OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn,
    OnCallPolicyAiHoldOutcome.HandledByPerson,
  ])(
    "ended unpaged, says how (%s) in the same claim",
    async (outcome: OnCallPolicyAiHoldOutcome) => {
      const stubs: Stubs = stub();
      const message: string =
        getOnCallPolicyRunEndedWhileWaitingMessage("incident");

      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
        .mockResolvedValue(
          run({
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: message,
            recordKind: "incident",
          }),
        );

      await expect(
        OnCallDutyPolicyExecutionLogService.endWaitingRun({
          executionLogId: RUN_ID,
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: message,
          aiHoldOutcome: outcome,
        }),
      ).resolves.toBe(true);

      expect(stubs.repositoryUpdate).toHaveBeenCalledWith(
        { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Waiting },
        {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: message,
          aiHoldOutcome: outcome,
        },
      );
      expect(stubs.startRuleExecution).not.toHaveBeenCalled();
    },
  );

  test("ended by its archived policy, is no hold any more", async () => {
    const stubs: Stubs = stub();

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        run({
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
        }),
      );

    await OnCallDutyPolicyExecutionLogService.endWaitingRun({
      executionLogId: RUN_ID,
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      aiHoldOutcome: null,
    });

    // Null, written: neither paged nor resolved, it is left Holding nowhere.
    expect(claimed(stubs)).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      aiHoldOutcome: null,
    });
  });

  test("a run with no hold writes no outcome as it ends or starts", async () => {
    const stubs: Stubs = stub();
    const now: Date = new Date();

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        run({
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
        }),
      );

    await OnCallDutyPolicyExecutionLogService.endWaitingRun({
      executionLogId: RUN_ID,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
    });
    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run({
        status: OnCallDutyPolicyStatus.Waiting,
        statusMessage: WORKING_HOURS_MESSAGE,
        pagingStartsAt: new Date(now.getTime() - 1000),
      }),
      now: now,
    });

    for (const call of stubs.repositoryUpdate.mock.calls) {
      expect(Object.keys(call[1] as Record<string, unknown>)).not.toContain(
        "aiHoldOutcome",
      );
    }
  });

  test("lost to another tick, writes no outcome and pages nobody", async () => {
    const stubs: Stubs = stub({ claimWins: false });

    await expect(
      OnCallDutyPolicyExecutionLogService.endWaitingRun({
        executionLogId: RUN_ID,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("incident"),
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
      }),
    ).resolves.toBe(false);

    expect(stubs.incidentFeed).not.toHaveBeenCalled();
    expect(stubs.refresh).not.toHaveBeenCalled();
    expect(stubs.startRuleExecution).not.toHaveBeenCalled();
  });
});
