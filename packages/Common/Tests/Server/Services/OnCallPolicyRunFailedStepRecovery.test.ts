import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import logger from "../../../Server/Utils/Logger";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock, SpyInstance } from "jest-mock";

/*
 * A RUN'S STEP THAT FAILED AFTER ITS CLAIM, PUT RIGHT FOR ITS NEXT TRY
 * (issue #8167).
 *
 * Two of the steps the policy-run worker tries again are claimed with one
 * atomic UPDATE before they page anybody, and a failure after the claim
 * used to leave the run where no try could reach it:
 *
 *   - a run that waited, started (Waiting to Started) and then failing,
 *     stayed Started, which no tick reads: it was timed out having paged
 *     nobody. It is handed to its escalation (handStartedRunToEscalation).
 *   - a move on, claimed and then failing before its next rule started,
 *     left the rule's wait started afresh: the next try came a whole wait
 *     later. The claim is given back (giveBackEscalationAdvance).
 *
 * Both only while nobody can have been paged twice for it, and neither
 * throws. Pinned here against the run table's own UPDATE ... WHERE.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "81679999-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "81679999-0000-4000-8000-000000000002",
);
const RUN_ID: ObjectID = new ObjectID("81679999-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "81679999-0000-4000-8000-000000000004",
);
const RULE_ID: ObjectID = new ObjectID("81679999-0000-4000-8000-000000000005");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "81679999-0000-4000-8000-000000000006",
);

const MOMENT: Date = new Date("2026-11-15T09:00:00.000Z");
const NOW: Date = new Date("2026-11-15T09:02:00.000Z");
const CLAIMED_AT: Date = new Date("2026-11-15T09:30:00.000Z");
const READ_AT: Date = new Date("2026-11-15T09:20:00.000Z");

type RepositoryUpdate = Mock<
  (
    where: Record<string, unknown>,
    values: Record<string, unknown>,
  ) => Promise<{ affected: number }>
>;

let repositoryUpdate: RepositoryUpdate;
let errors: Array<string>;

function waitingRun(): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN_ID;
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = POLICY_ID;
  run.status = OnCallDutyPolicyStatus.Waiting;
  run.pagingStartsAt = MOMENT;
  run.triggeredByIncidentId = INCIDENT_ID;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  return run;
}

// A run as the database holds it now, for the give back's read.
function storedRun(
  data: Partial<OnCallDutyPolicyExecutionLog> = {},
): OnCallDutyPolicyExecutionLog {
  return Object.assign(new OnCallDutyPolicyExecutionLog(), {
    id: RUN_ID,
    status: OnCallDutyPolicyStatus.Executing,
    lastEscalationRuleExecutedAt: CLAIMED_AT,
    lastExecutedEscalationRuleId: RULE_ID,
    onCallPolicyExecutionRepeatCount: 1,
    ...data,
  });
}

function giveBack(): Promise<boolean> {
  return OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance({
    executionLogId: RUN_ID,
    claimedLastEscalationRuleExecutedAt: CLAIMED_AT,
    previousLastEscalationRuleExecutedAt: READ_AT,
    lastExecutedEscalationRuleId: RULE_ID,
    onCallPolicyExecutionRepeatCount: 1,
  });
}

beforeEach(() => {
  errors = [];

  repositoryUpdate = jest.fn(async (): Promise<{ affected: number }> => {
    return { affected: 1 };
  }) as unknown as RepositoryUpdate;

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "getRepository")
    .mockReturnValue({ update: repositoryUpdate } as never);
  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(OnCallDutyPolicyService, "findOneById").mockResolvedValue(null);
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run that waited, whose start fails after its claim", () => {
  function firstRule(): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.id = RULE_ID;
    return rule;
  }

  test("REGRESSION: is handed to its escalation, due when its page was, and the failure goes on to the worker", async () => {
    const failure: Error = new Error("Connection terminated unexpectedly");
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockRejectedValue(failure as never);
    const handOver: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation
    > = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "handStartedRunToEscalation",
    );

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: waitingRun(),
        now: NOW,
      }),
    ).rejects.toBe(failure);

    // Its page was due at its moment, however late the worker got to it.
    expect(handOver).toHaveBeenCalledWith({
      executionLogId: RUN_ID,
      dueAt: MOMENT,
    });

    // The claim, then the hand over from its first rule.
    expect(
      repositoryUpdate.mock.calls.map((call: Array<unknown>) => {
        return call[1];
      }),
    ).toEqual([
      expect.objectContaining({ status: OnCallDutyPolicyStatus.Started }),
      {
        status: OnCallDutyPolicyStatus.Executing,
        lastEscalationRuleExecutedAt: MOMENT,
        executeNextEscalationRuleInMinutes: 0,
      },
    ]);
  });

  test("failing as its first rule pages is handed over the same way", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(firstRule());
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockRejectedValue(new Error("Connection is closed.") as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: waitingRun(),
        now: NOW,
      }),
    ).rejects.toThrow("Connection is closed.");

    expect(repositoryUpdate).toHaveBeenCalledTimes(2);
  });

  test("a claim it lost hands nothing over: another tick has it", async () => {
    repositoryUpdate.mockResolvedValue({ affected: 0 });
    const handOver: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation
    > = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "handStartedRunToEscalation",
    );

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: waitingRun(),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(handOver).not.toHaveBeenCalled();
  });

  test("a claim that fails hands nothing over: the run still waits", async () => {
    repositoryUpdate.mockRejectedValue(
      new Error("Connection terminated unexpectedly") as never,
    );
    const handOver: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation
    > = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "handStartedRunToEscalation",
    );

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: waitingRun(),
        now: NOW,
      }),
    ).rejects.toThrow("Connection terminated unexpectedly");

    expect(handOver).not.toHaveBeenCalled();
  });

  test("a start that goes through hands nothing over", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(firstRule());
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      } as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const handOver: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation
    > = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "handStartedRunToEscalation",
    );

    await expect(
      OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: waitingRun(),
        now: NOW,
      }),
    ).resolves.toBe(true);

    expect(handOver).not.toHaveBeenCalled();
  });
});

describe("handing a run whose start failed to its escalation", () => {
  test("a start that got nowhere: from its first rule, at once, in one conditional update", async () => {
    await expect(
      OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
        executionLogId: RUN_ID,
        dueAt: MOMENT,
      }),
    ).resolves.toBe(true);

    expect(repositoryUpdate).toHaveBeenCalledTimes(1);

    const [where, values] = repositoryUpdate.mock.calls[0]!;

    expect(where["_id"]).toBe(RUN_ID.toString());
    expect(where["status"]).toBe(OnCallDutyPolicyStatus.Started);
    // No rule started yet, and no moment of one.
    expect(
      (where["lastExecutedEscalationRuleId"] as { type?: unknown }).type,
    ).toBe("isNull");
    expect(
      (where["lastEscalationRuleExecutedAt"] as { type?: unknown }).type,
    ).toBe("isNull");
    expect(values).toEqual({
      status: OnCallDutyPolicyStatus.Executing,
      lastEscalationRuleExecutedAt: MOMENT,
      executeNextEscalationRuleInMinutes: 0,
    });
    expect(OnCallPolicyRunMessage.refresh).toHaveBeenCalledWith(RUN_ID);
  });

  test("a start whose first rule started goes on from that rule: only its status changes", async () => {
    repositoryUpdate
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await expect(
      OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
        executionLogId: RUN_ID,
        dueAt: MOMENT,
      }),
    ).resolves.toBe(true);

    expect(repositoryUpdate.mock.calls[1]).toEqual([
      { _id: RUN_ID.toString(), status: OnCallDutyPolicyStatus.Started },
      { status: OnCallDutyPolicyStatus.Executing },
    ]);
  });

  test("a run no longer Started is left as it is", async () => {
    repositoryUpdate.mockResolvedValue({ affected: 0 });

    await expect(
      OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
        executionLogId: RUN_ID,
        dueAt: MOMENT,
      }),
    ).resolves.toBe(false);

    expect(OnCallPolicyRunMessage.refresh).not.toHaveBeenCalled();
  });

  test("never throws: a run that cannot be handed over stays Started, and says so in the log", async () => {
    repositoryUpdate.mockRejectedValue(new Error("still down") as never);

    await expect(
      OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
        executionLogId: RUN_ID,
        dueAt: MOMENT,
      }),
    ).resolves.toBe(false);

    expect(errors.join("\n")).toContain(
      "to its escalation after its start failed",
    );
  });
});

describe("giving back a claim to move a run on that paged nobody", () => {
  test("REGRESSION: puts the run's moment back as it was read, while the run is as the claim left it", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(storedRun());

    await expect(giveBack()).resolves.toBe(true);

    expect(repositoryUpdate).toHaveBeenCalledWith(
      {
        _id: RUN_ID.toString(),
        status: OnCallDutyPolicyStatus.Executing,
        lastEscalationRuleExecutedAt: CLAIMED_AT,
      },
      { lastEscalationRuleExecutedAt: READ_AT },
    );
  });

  test("a run read with no moment of its own gets none back", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        storedRun({
          lastExecutedEscalationRuleId: undefined,
        } as Partial<OnCallDutyPolicyExecutionLog>),
      );

    await expect(
      OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance({
        executionLogId: RUN_ID,
        claimedLastEscalationRuleExecutedAt: CLAIMED_AT,
        previousLastEscalationRuleExecutedAt: null,
        lastExecutedEscalationRuleId: null,
        onCallPolicyExecutionRepeatCount: 1,
      }),
    ).resolves.toBe(true);

    expect(repositoryUpdate.mock.calls[0]![1]).toEqual({
      lastEscalationRuleExecutedAt: null,
    });
  });

  test.each([
    {
      why: "its next rule started - some of whose people may be paged",
      now: { lastExecutedEscalationRuleId: OTHER_RULE_ID },
    },
    {
      why: "its policy began again",
      now: { onCallPolicyExecutionRepeatCount: 2 },
    },
    {
      why: "somebody else moved it on since",
      now: { lastEscalationRuleExecutedAt: new Date(CLAIMED_AT.getTime() + 5) },
    },
    {
      why: "it ended",
      now: { status: OnCallDutyPolicyStatus.Completed },
    },
    {
      why: "it ended in error",
      now: { status: OnCallDutyPolicyStatus.Error },
    },
  ])(
    "keeps its claim when $why",
    async (data: { now: Partial<OnCallDutyPolicyExecutionLog> }) => {
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
        .mockResolvedValue(storedRun(data.now));

      await expect(giveBack()).resolves.toBe(false);

      expect(repositoryUpdate).not.toHaveBeenCalled();
    },
  );

  test("keeps its claim for a run that is gone", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null);

    await expect(giveBack()).resolves.toBe(false);

    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  test("a run moved on between the read and the update keeps what the other move wrote", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(storedRun());
    repositoryUpdate.mockResolvedValue({ affected: 0 });

    await expect(giveBack()).resolves.toBe(false);
  });

  test("never throws: a claim that cannot be given back is kept, and the log says so", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));

    await expect(giveBack()).resolves.toBe(false);

    expect(errors.join("\n")).toContain("Could not give back the claim");
  });
});
