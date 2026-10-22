import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import URL from "../../../Types/API/URL";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService, {
  Service as OnCallDutyPolicyServiceClass,
} from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import BadDataException from "../../../Types/Exception/BadDataException";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL } from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PAGE AGAIN, AS ITS RUN STARTS (OnCallDutyPolicyExecutionLogService
 * .startPageAgain), AND AN ON-CALL POLICY'S TIMEOUT AS THE API TAKES IT.
 *
 * The worker decided the policy pages again (OnCallAcknowledgementTimeout):
 * this creates the run - numbered, about the same record - says why in the
 * record's feed, and pages the rule that was paging, with the person who
 * acknowledged it first. What the API, Terraform or a workflow may write as
 * the policy's timeout is held to one rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-000000000003",
);
const LEVEL_2: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-000000000004",
);
const LEVEL_1: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-000000000005",
);
const ANA: ObjectID = new ObjectID("8b000000-0000-4000-8000-0000000000a1");
const NEW_RUN_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-0000000000f1",
);

interface Recorded {
  created: Array<OnCallDutyPolicyExecutionLog>;
  updates: Array<{ status?: string; statusMessage?: string }>;
  feed: Array<string>;
  started: Array<{ ruleId: string; options: Record<string, unknown> }>;
  ruleQueries: Array<{ query: Record<string, unknown>; sort?: unknown }>;
}

let recorded: Recorded;
let rules: Array<OnCallDutyPolicyEscalationRule>;
let createdStatus: OnCallDutyPolicyStatus;

function rule(id: ObjectID, order: number): OnCallDutyPolicyEscalationRule {
  const row: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  row.id = id;
  row.order = order;
  return row;
}

beforeEach(() => {
  recorded = {
    created: [],
    updates: [],
    feed: [],
    started: [],
    ruleQueries: [],
  };
  rules = [rule(LEVEL_1, 1), rule(LEVEL_2, 2)];
  createdStatus = OnCallDutyPolicyStatus.Scheduled;

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "create")
    .mockImplementation((async (data: { data: OnCallDutyPolicyExecutionLog }) => {
      recorded.created.push(data.data);
      const created: OnCallDutyPolicyExecutionLog = data.data;
      created.id = NEW_RUN_ID;
      created.status = createdStatus;
      return created;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockImplementation((async (data: {
      data: { status?: string; statusMessage?: string };
    }) => {
      recorded.updates.push(data.data);
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockImplementation((async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = POLICY_ID;
      policy.projectId = PROJECT_ID;
      policy.name = "Payments";
      return policy;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async () => {
      return URL.fromString("https://oneuptime.test/dashboard/p/policy");
    }) as never);

  jest.spyOn(UserService, "getUserMarkdownString").mockImplementation((async () => {
    return FeedMarkdown.link("Ana Lopez", "https://oneuptime.test/users/ana");
  }) as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      recorded.feed.push(data.feedInfoInMarkdown);
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      sort?: unknown;
    }) => {
      recorded.ruleQueries.push(data);
      const id: unknown = data.query["_id"];

      if (id) {
        return (
          rules.find((row: OnCallDutyPolicyEscalationRule) => {
            return row.id!.toString() === String(id);
          }) || null
        );
      }

      return (
        [...rules].sort(
          (a: OnCallDutyPolicyEscalationRule, b: OnCallDutyPolicyEscalationRule) => {
            return (a.order || 0) - (b.order || 0);
          },
        )[0] || null
      );
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
    .mockImplementation((async (
      ruleId: ObjectID,
      options: Record<string, unknown>,
    ) => {
      recorded.started.push({ ruleId: ruleId.toString(), options: options });
      return { paged: [], notPaged: [], hadScheduleGap: false, movesOnAtOnce: false };
    }) as never);

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function startPageAgain(
  overrides: Partial<{
    startAtRuleId: ObjectID | undefined;
    acknowledgedByUserId: ObjectID | undefined;
  }> = {},
): Promise<ObjectID | null> {
  return await OnCallDutyPolicyExecutionLogService.startPageAgain({
    projectId: PROJECT_ID,
    onCallDutyPolicyId: POLICY_ID,
    triggeredByIncidentId: INCIDENT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    pageAgainNumber: 2,
    minutes: 45,
    recordKind: "incident",
    startAtRuleId: LEVEL_2,
    acknowledgedByUserId: ANA,
    ...overrides,
  });
}

describe("starting a page again", () => {
  test("creates a run of its own: the same policy and incident, numbered", async () => {
    await expect(startPageAgain()).resolves.toEqual(NEW_RUN_ID);

    expect(recorded.created).toHaveLength(1);

    const run: OnCallDutyPolicyExecutionLog = recorded.created[0]!;

    expect(run.pageAgainNumber).toBe(2);
    expect(run.projectId).toEqual(PROJECT_ID);
    expect(run.onCallDutyPolicyId).toEqual(POLICY_ID);
    expect(run.triggeredByIncidentId).toEqual(INCIDENT_ID);
    expect(run.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
  });

  test("says why in the incident's feed, naming who acknowledged it", async () => {
    await startPageAgain();

    expect(recorded.feed).toEqual([
      "On-call policy **[Payments](https://oneuptime.test/dashboard/p/policy)** is paging again (2 of 5): the incident is still not resolved 45 minutes after **[Ana Lopez](https://oneuptime.test/users/ana)** acknowledged it.",
    ]);
  });

  test("pages the rule it was on, with the person who acknowledged it first", async () => {
    await startPageAgain();

    expect(recorded.started).toHaveLength(1);
    expect(recorded.started[0]!.ruleId).toBe(LEVEL_2.toString());
    expect(recorded.started[0]!.options).toMatchObject({
      projectId: PROJECT_ID,
      onCallPolicyId: POLICY_ID,
      onCallPolicyExecutionLogId: NEW_RUN_ID,
      triggeredByIncidentId: INCIDENT_ID,
      alsoPageUserIds: [ANA],
    });
  });

  test("moves from started to paging, saying it pages again and why", async () => {
    await startPageAgain();

    expect(recorded.updates).toEqual([
      {
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: "Execution started...",
      },
      {
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage:
          "Paging again (2 of 5): still not resolved 45 minutes after it was acknowledged.",
      },
    ]);
  });

  test("with nobody acknowledged by name, pages the rule's people alone", async () => {
    await startPageAgain({ acknowledgedByUserId: undefined });

    expect(recorded.started[0]!.options["alsoPageUserIds"]).toEqual([]);
    expect(recorded.feed[0]).toContain("45 minutes after it was acknowledged.");
  });

  test("the rule it was on is gone: starts at the policy's first, by order", async () => {
    rules = [rule(LEVEL_1, 1)];

    await startPageAgain();

    expect(recorded.started[0]!.ruleId).toBe(LEVEL_1.toString());
    expect(recorded.ruleQueries[1]!.sort).toEqual({
      order: SortOrder.Ascending,
    });
    // Both reads are held to the policy and its project.
    for (const read of recorded.ruleQueries) {
      expect(read.query["projectId"]).toEqual(PROJECT_ID);
      expect(read.query["onCallDutyPolicyId"]).toEqual(POLICY_ID);
    }
  });

  test("no rule it was on to name: the policy's first", async () => {
    await startPageAgain({ startAtRuleId: undefined });

    expect(recorded.ruleQueries).toHaveLength(1);
    expect(recorded.started[0]!.ruleId).toBe(LEVEL_1.toString());
  });

  test("a policy with no rules left says so on the run, as every run does", async () => {
    rules = [];

    await expect(startPageAgain()).resolves.toEqual(NEW_RUN_ID);

    expect(recorded.started).toEqual([]);
    expect(recorded.updates).toEqual([
      {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage:
          "No Escalation Rules in Policy. Please add escalation rules to this policy.",
      },
    ]);
  });

  test("a policy archived in the meantime pages nobody: its run says it was not executed", async () => {
    createdStatus = OnCallDutyPolicyStatus.Error;

    await expect(startPageAgain()).resolves.toBeNull();

    expect(recorded.started).toEqual([]);
    expect(recorded.feed).toEqual([]);
    expect(recorded.updates).toEqual([]);
  });

  test("a rule that fails to page leaves the run saying what went wrong", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockImplementation((async () => {
        throw new BadDataException("Rule could not page.");
      }) as never);

    await expect(startPageAgain()).rejects.toThrow("Rule could not page.");

    expect(recorded.updates[recorded.updates.length - 1]).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: "Rule could not page.",
    });
  });

  test("a feed that cannot be written does not stop the page", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async () => {
        throw new Error("feed is down");
      }) as never);

    await expect(startPageAgain()).resolves.toEqual(NEW_RUN_ID);

    expect(recorded.started).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test("an alert's page again writes the alert's feed", async () => {
    const alertFeed: Array<string> = [];

    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
        alertFeed.push(data.feedInfoInMarkdown);
      }) as never);

    await OnCallDutyPolicyExecutionLogService.startPageAgain({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: POLICY_ID,
      triggeredByAlertId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.AlertCreated,
      pageAgainNumber: 1,
      minutes: 30,
      recordKind: "alert",
      startAtRuleId: LEVEL_1,
      acknowledgedByUserId: ANA,
    });

    expect(recorded.feed).toEqual([]);
    expect(alertFeed).toHaveLength(1);
    expect(alertFeed[0]).toContain("the alert is still not resolved 30 minutes");
    expect(recorded.started[0]!.options["triggeredByAlertId"]).toEqual(
      INCIDENT_ID,
    );
  });
});

describe("a page again, as it is created", () => {
  test("is not started at the policy's first rule by the create hook: its caller starts it", async () => {
    const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
    run.id = NEW_RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.status = OnCallDutyPolicyStatus.Scheduled;
    run.pageAgainNumber = 1;

    await (
      OnCallDutyPolicyExecutionLogService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          created: OnCallDutyPolicyExecutionLog,
        ) => Promise<OnCallDutyPolicyExecutionLog>;
      }
    ).onCreateSuccess(
      {
        createBy: { data: run, props: { isRoot: true } },
        carryForward: { isPolicyArchived: false },
      },
      run,
    );

    expect(recorded.started).toEqual([]);
    expect(recorded.feed).toEqual([]);
    expect(recorded.updates).toEqual([]);
  });
});

describe("the clock's own writes", () => {
  test("start the clock with one hook-free write of the one column", async () => {
    const write: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.updateColumnsByIdWithoutHooks
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    const at: Date = new Date("2026-10-22T03:05:00.000Z");

    await OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock({
      executionLogId: NEW_RUN_ID,
      startedAt: at,
    });

    expect(write).toHaveBeenCalledWith({
      id: NEW_RUN_ID,
      data: { acknowledgementTimeoutStartedAt: at },
      skipUpdateDateColumn: true,
    });
  });

  test("stop it only if it still reads what was read: one atomic compare-and-set", async () => {
    const cas: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.compareAndSetColumnsByIdWithoutHooks
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "compareAndSetColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(false);

    const read: Date = new Date("2026-10-22T03:05:00.000Z");

    await expect(
      OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock({
        executionLogId: NEW_RUN_ID,
        expectedStartedAt: read,
      }),
    ).resolves.toBe(false);

    expect(cas).toHaveBeenCalledWith({
      id: NEW_RUN_ID,
      data: { acknowledgementTimeoutStartedAt: null },
      expectedData: { acknowledgementTimeoutStartedAt: read },
      skipUpdateDateColumn: true,
    });
  });
});

describe("an on-call policy's acknowledgement timeout, as the API takes it", () => {
  type CheckWrite = (write: { data: unknown }) => Promise<void>;

  const checkCreate: CheckWrite = (
    write: { data: unknown },
  ): Promise<void> => {
    return (
      OnCallDutyPolicyService as unknown as {
        checkCreateBeforeReferences: CheckWrite;
      }
    ).checkCreateBeforeReferences(write);
  };

  const checkUpdate: CheckWrite = (
    write: { data: unknown },
  ): Promise<void> => {
    return (
      OnCallDutyPolicyService as unknown as {
        checkUpdateBeforeReferences: CheckWrite;
      }
    ).checkUpdateBeforeReferences(write);
  };

  test.each([null, undefined, 5, 30, 1440])(
    "%p is taken on create and update",
    async (value: number | null | undefined) => {
      await expect(
        checkCreate({ data: { acknowledgementTimeoutInMinutes: value } }),
      ).resolves.toBeUndefined();
      await expect(
        checkUpdate({ data: { acknowledgementTimeoutInMinutes: value } }),
      ).resolves.toBeUndefined();
    },
  );

  test("a write that leaves it out is untouched", async () => {
    await expect(checkCreate({ data: { name: "Payments" } })).resolves.toBe(
      undefined,
    );
    await expect(checkUpdate({ data: {} })).resolves.toBeUndefined();
  });

  test.each([0, 4, 1441, 30.5, -30, "", "soon", true])(
    "%p is refused on create and update, before anything is read",
    async (value: unknown) => {
      await expect(
        checkCreate({ data: { acknowledgementTimeoutInMinutes: value } }),
      ).rejects.toThrow(ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL);
      await expect(
        checkUpdate({ data: { acknowledgementTimeoutInMinutes: value } }),
      ).rejects.toThrow(ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL);
    },
  );

  test("a refusal is a bad request, not an error", () => {
    expect(() => {
      OnCallDutyPolicyServiceClass.assertAcknowledgementTimeout({
        acknowledgementTimeoutInMinutes: 2,
      });
    }).toThrow(BadDataException);
  });
});
