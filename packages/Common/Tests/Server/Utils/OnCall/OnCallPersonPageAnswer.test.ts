import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import logger from "../../../../Server/Utils/Logger";
import OnCallPersonPageAnswer, {
  OnCallPersonPageRecordKind,
} from "../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A PERSON'S PAGE IS ANSWERED BY ACKNOWLEDGING ITS RECORD (OnCallPersonPageAnswer).
 *
 * A page a person asked for goes on until somebody it paged answers it
 * (OnCallPersonPage) - and acknowledging the incident is answering it, for
 * the person who does: Nitin, paged by Jane from INC-8's channel, presses
 * Acknowledge Incident there, and is not called ten minutes later. These
 * hold whose pages a state change answers - only its author's, only
 * person's pages nobody answered, only while the record is acknowledged and
 * not resolved - and that it never throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000002",
);
const NITIN: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000003");
const JANE: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000004");
const WORKFLOW: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000005");
const POLICY: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000006");

let findBy: SpyInstance<typeof UserOnCallLogService.findBy>;
let acknowledgePage: SpyInstance<
  typeof UserOnCallLogTimelineService.acknowledgePage
>;
let logs: Array<UserOnCallLog>;
let nextId: number;

function id(): ObjectID {
  nextId++;
  return new ObjectID(
    `7b000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
  );
}

// One of Nitin's pages still going out to him, of a run started as `run` says.
function page(run: {
  startedBy: "person" | "workflow" | "policy";
  answered?: boolean;
  kind?: OnCallPersonPageRecordKind;
  noTimelineRow?: boolean;
}): UserOnCallLog {
  const executionLog: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  executionLog.triggeredByUserId = JANE;

  if (run.startedBy === "workflow") {
    executionLog.triggeredByWorkflowId = WORKFLOW;
  }

  if (run.startedBy === "policy") {
    executionLog.onCallDutyPolicyId = POLICY;
  }

  if (run.answered) {
    executionLog.acknowledgedAt = new Date();
  }

  const log: UserOnCallLog = new UserOnCallLog();
  log.id = id();
  log.onCallDutyPolicyExecutionLogId = id();

  if (!run.noTimelineRow) {
    log.onCallDutyPolicyExecutionLogTimelineId = id();
  }

  if ((run.kind || "incident") === "incident") {
    log.triggeredByIncidentId = RECORD_ID;
  } else {
    log.triggeredByAlertId = RECORD_ID;
  }

  log.onCallDutyPolicyExecutionLog = executionLog;
  return log;
}

function stateChange(
  overrides: Partial<
    Parameters<typeof OnCallPersonPageAnswer.onRecordStateChanged>[0]
  > = {},
): Parameters<typeof OnCallPersonPageAnswer.onRecordStateChanged>[0] {
  return {
    kind: "incident",
    recordId: RECORD_ID,
    projectId: PROJECT_ID,
    changedByUserId: NITIN,
    isAcknowledged: true,
    isResolved: false,
    ...overrides,
  };
}

beforeEach(() => {
  nextId = 100;
  logs = [];
  findBy = jest
    .spyOn(UserOnCallLogService, "findBy")
    .mockImplementation((async () => {
      return logs;
    }) as never);
  acknowledgePage = jest
    .spyOn(UserOnCallLogTimelineService, "acknowledgePage")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whose pages a state change answers", () => {
  test("its author's person's page about the incident: acknowledged as theirs, now", async () => {
    const nitins: UserOnCallLog = page({ startedBy: "person" });
    logs = [nitins];
    const before: number = Date.now();

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(stateChange()),
    ).resolves.toBe(1);

    expect(acknowledgePage).toHaveBeenCalledTimes(1);

    const answer: {
      userOnCallLogId: ObjectID;
      userId: ObjectID;
      onCallDutyPolicyExecutionLogId: ObjectID;
      onCallDutyPolicyExecutionLogTimelineId: ObjectID;
      triggeredByIncidentId: ObjectID;
      acknowledgedAt: Date;
    } = acknowledgePage.mock.calls[0]![0] as never;

    expect(answer).toMatchObject({
      userOnCallLogId: nitins.id,
      userId: NITIN,
      onCallDutyPolicyExecutionLogId: nitins.onCallDutyPolicyExecutionLogId,
      onCallDutyPolicyExecutionLogTimelineId:
        nitins.onCallDutyPolicyExecutionLogTimelineId,
      triggeredByIncidentId: RECORD_ID,
    });
    expect(answer.acknowledgedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("only the author's own pages still going out about this record are read", async () => {
    await OnCallPersonPageAnswer.onRecordStateChanged(stateChange());

    const asked: {
      query: Record<string, unknown>;
      props: unknown;
    } = findBy.mock.calls[0]![0] as never;

    expect(asked.query).toEqual({
      projectId: PROJECT_ID,
      userId: NITIN,
      status: expect.anything(),
      triggeredByIncidentId: RECORD_ID,
    });
    expect(JSON.stringify(asked.query["status"])).toContain(
      UserNotificationExecutionStatus.Executing,
    );
    expect(JSON.stringify(asked.query["status"])).not.toContain(
      UserNotificationExecutionStatus.Completed,
    );
    expect(asked.props).toEqual({ isRoot: true });
  });

  test("an alert's: read by the alert's column", async () => {
    logs = [page({ startedBy: "person", kind: "alert" })];

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(
        stateChange({ kind: "alert" }),
      ),
    ).resolves.toBe(1);

    const asked: { query: Record<string, unknown> } = findBy.mock
      .calls[0]![0] as never;

    expect(asked.query["triggeredByAlertId"]).toEqual(RECORD_ID);
    expect(asked.query["triggeredByIncidentId"]).toBeUndefined();
    expect(
      (acknowledgePage.mock.calls[0]![0] as { triggeredByAlertId: ObjectID })
        .triggeredByAlertId,
    ).toEqual(RECORD_ID);
  });

  test("a workflow's direct page, a policy's run and a page somebody answered already are left as they are", async () => {
    const person: UserOnCallLog = page({ startedBy: "person" });
    logs = [
      page({ startedBy: "workflow" }),
      page({ startedBy: "policy" }),
      page({ startedBy: "person", answered: true }),
      person,
    ];

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(stateChange()),
    ).resolves.toBe(1);

    expect(acknowledgePage).toHaveBeenCalledTimes(1);
    expect(
      (acknowledgePage.mock.calls[0]![0] as { userOnCallLogId: ObjectID })
        .userOnCallLogId,
    ).toEqual(person.id);
  });

  test("a page whose run's line for them is missing cannot be answered here: left for its own link", async () => {
    logs = [page({ startedBy: "person", noTimelineRow: true })];

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(stateChange()),
    ).resolves.toBe(0);
    expect(acknowledgePage).not.toHaveBeenCalled();
  });
});

describe("state changes that answer nothing, and read nothing", () => {
  test.each([
    [
      "OneUptime's own change, with nobody behind it",
      { changedByUserId: undefined },
    ],
    [
      "a change into a state that is not acknowledged",
      { isAcknowledged: false },
    ],
    [
      "a resolve: it ends every page of the record already",
      { isAcknowledged: true, isResolved: true },
    ],
  ] as Array<
    [
      string,
      Partial<
        Parameters<typeof OnCallPersonPageAnswer.onRecordStateChanged>[0]
      >,
    ]
  >)(
    "%s",
    async (
      _name: string,
      overrides: Partial<
        Parameters<typeof OnCallPersonPageAnswer.onRecordStateChanged>[0]
      >,
    ) => {
      logs = [page({ startedBy: "person" })];

      await expect(
        OnCallPersonPageAnswer.onRecordStateChanged(stateChange(overrides)),
      ).resolves.toBe(0);
      expect(findBy).not.toHaveBeenCalled();
      expect(acknowledgePage).not.toHaveBeenCalled();
    },
  );
});

describe("never throws", () => {
  test("a read that fails is logged, and the state change goes on", async () => {
    findBy.mockRejectedValue(new Error("database is gone") as never);

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(stateChange()),
    ).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("one page that cannot be answered is logged; the next is still answered", async () => {
    logs = [page({ startedBy: "person" }), page({ startedBy: "person" })];
    acknowledgePage
      .mockRejectedValueOnce(new Error("timeline row is gone") as never)
      .mockResolvedValueOnce(undefined as never);

    await expect(
      OnCallPersonPageAnswer.onRecordStateChanged(stateChange()),
    ).resolves.toBe(1);
    expect(acknowledgePage).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });
});

/*
 * ACKNOWLEDGE PRESSED ON A RECORD SOMEBODY ELSE ACKNOWLEDGED (UI review of
 * block 31): the press a person paged into INC-8 makes in its channel. The
 * incident's state does not move, so no state change hands anything on -
 * the press answers the presser's own person's pages all the same.
 */
describe("Acknowledge pressed on a record acknowledged already", () => {
  test("answers the presser's own person's page about it", async () => {
    const nitins: UserOnCallLog = page({ startedBy: "person" });
    logs = [nitins];

    await expect(
      OnCallPersonPageAnswer.onAcknowledgePressed({
        kind: "incident",
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
        pressedByUserId: NITIN,
        isResolved: false,
      }),
    ).resolves.toBe(1);

    const asked: { query: Record<string, unknown> } = findBy.mock
      .calls[0]![0] as never;

    expect(asked.query["userId"]).toEqual(NITIN);
    expect(asked.query["triggeredByIncidentId"]).toEqual(RECORD_ID);
    expect(
      (acknowledgePage.mock.calls[0]![0] as { userOnCallLogId: ObjectID })
        .userOnCallLogId,
    ).toEqual(nitins.id);
  });

  test("an alert's, by the alert's column", async () => {
    logs = [page({ startedBy: "person", kind: "alert" })];

    await expect(
      OnCallPersonPageAnswer.onAcknowledgePressed({
        kind: "alert",
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
        pressedByUserId: NITIN,
        isResolved: false,
      }),
    ).resolves.toBe(1);
    expect(
      (findBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
        "triggeredByAlertId"
      ],
    ).toEqual(RECORD_ID);
  });

  test("a resolved record, or a press nobody can be told for, answers nothing and reads nothing", async () => {
    logs = [page({ startedBy: "person" })];

    for (const press of [
      { pressedByUserId: NITIN, isResolved: true },
      { pressedByUserId: undefined, isResolved: false },
      { pressedByUserId: null, isResolved: false },
    ]) {
      await expect(
        OnCallPersonPageAnswer.onAcknowledgePressed({
          kind: "incident",
          recordId: RECORD_ID,
          projectId: PROJECT_ID,
          ...press,
        }),
      ).resolves.toBe(0);
    }

    expect(findBy).not.toHaveBeenCalled();
    expect(acknowledgePage).not.toHaveBeenCalled();
  });

  test("a workflow's or a policy's page is left to its own link, as for a state change", async () => {
    logs = [page({ startedBy: "workflow" }), page({ startedBy: "policy" })];

    await expect(
      OnCallPersonPageAnswer.onAcknowledgePressed({
        kind: "incident",
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
        pressedByUserId: NITIN,
        isResolved: false,
      }),
    ).resolves.toBe(0);
    expect(acknowledgePage).not.toHaveBeenCalled();
  });
});
