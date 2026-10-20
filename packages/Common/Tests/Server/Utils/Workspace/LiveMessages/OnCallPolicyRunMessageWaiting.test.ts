import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import WorkspaceMessageTime from "../../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import ObjectID from "../../../../../Types/ObjectID";
import { getOnCallPolicyRunEndedWhileWaitingMessage } from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { WorkspaceLiveMessageRunEnding } from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";

/*
 * A RUN THAT WAITS TO PAGE, IN SLACK AND MICROSOFT TEAMS.
 *
 * Held until working hours, a run pages nobody, and its one message says so
 * - posted when the run is created, so the channel knows nobody is being
 * paged yet - with when paging starts, in each reader's own time. When the
 * hours begin the same message is edited into a paging run's: waiting is not
 * an ending, so nothing keeps it. A record handled while it waits ends it
 * with nobody paged: no alarm, somebody is on it.
 */

const POLICY_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/x";
const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/alerts/12";

const POLICY: string = `**[PolicyX](${POLICY_URL})**`;
const RECORD: string = `**[Alert #12](${RECORD_URL})**`;

const PAGING_STARTS_AT: Date = new Date("2026-10-21T08:00:00Z");

const WAITING_MESSAGE: string =
  "Waiting for working hours. Paging starts Wed 09:00 (Europe/London).";

function run(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "PolicyX",
    policyUrl: POLICY_URL,
    runUrl: RUN_URL,
    recordLabel: "Alert #12",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Waiting,
    ruleCount: 2,
    escalateAfterInMinutes: 10,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [],
    notPaged: [],
    pagingStartsAt: PAGING_STARTS_AT,
    isWaitingForWorkingHours: true,
    ...overrides,
  };
}

describe("the message of a run waiting for working hours", () => {
  test("says the policy is waiting to page, and when paging starts in the reader's own time", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run())).toBe(
      [
        `⏳ ${POLICY} is waiting to page for ${RECORD}`,
        `**Waiting for working hours.** Paging starts ${WorkspaceMessageTime.dateAndTime(PAGING_STARTS_AT).toString()}.`,
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("says nothing of escalation rules: none has started", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run())).not.toMatch(
      /escalation rule/i,
    );
  });

  test("in Slack, the moment is a Slack date each reader sees in their own zone", () => {
    expect(
      WorkspaceMessageTime.toSlack(
        OnCallPolicyRunMessageView.getMarkdown(run()),
      ),
    ).toContain(
      `<!date^${Math.floor(PAGING_STARTS_AT.getTime() / 1000)}^{time}|08:00 UTC>`,
    );
  });

  test("its notification line says it waits", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(run())).toBe(
      "PolicyX is waiting to page for Alert #12",
    );
  });

  test("raises no alarm: nothing is wrong, nobody has to act", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(run())).toEqual([]);
  });

  test("not knowing when, still says it waits for working hours", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ pagingStartsAt: undefined }),
      ),
    ).toContain("**Waiting for working hours.**");
  });

  test("held for another reason, says when paging starts", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        run({ isWaitingForWorkingHours: false }),
      ),
    ).toContain(
      `Paging starts ${WorkspaceMessageTime.dateAndTime(PAGING_STARTS_AT).toString()}.`,
    );
  });
});

describe("the message of a run whose record was handled while it waited", () => {
  const handled: OnCallPolicyRun = run({
    outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
    outcomeDetail: "Resolved",
  });

  test("says the record moved on, so the policy did not page anyone", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(handled).split("\n\n")[0],
    ).toBe(
      `✅ ${RECORD} moved to **Resolved**, so ${POLICY} did not page anyone`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(handled)).toBe(
      "Alert #12 moved to Resolved, so PolicyX did not page anyone",
    );
  });

  test("without the state's name, says the record is being handled", () => {
    const noDetail: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
    });

    expect(
      OnCallPolicyRunMessageView.getMarkdown(noDetail).split("\n\n")[0],
    ).toBe(`✅ ${RECORD} is being handled, so ${POLICY} did not page anyone`);
    expect(OnCallPolicyRunMessageView.getPlainText(noDetail)).toBe(
      "PolicyX did not page anyone for Alert #12",
    );
  });

  test("raises no alarm: somebody is on it", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(handled)).toEqual([]);
  });

  test("never says paging stopped: it never began", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(handled)).not.toContain(
      "stopped paging",
    );
  });
});

describe("a waiting run, read for its message", () => {
  function waitingLog(): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log.id = ObjectID.generate();
    log.projectId = ObjectID.generate();
    log.onCallDutyPolicyId = ObjectID.generate();
    log.triggeredByAlertId = ObjectID.generate();
    log.status = OnCallDutyPolicyStatus.Waiting;
    log.statusMessage = WAITING_MESSAGE;
    log.pagingStartsAt = PAGING_STARTS_AT;
    log.onCallPolicyExecutionRepeatCount = 1;

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "PolicyX";
    log.onCallDutyPolicy = policy;

    return log;
  }

  function rules(): Array<OnCallDutyPolicyEscalationRule> {
    const first: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    first.id = ObjectID.generate();
    first.order = 1;
    first.escalateAfterInMinutes = 10;
    return [first];
  }

  function build(log: OnCallDutyPolicyExecutionLog): OnCallPolicyRun {
    return OnCallPolicyRunMessage.buildRun({
      executionLog: log,
      rules: rules(),
      timeline: [],
      deliveries: [],
      policyUrl: POLICY_URL,
      runUrl: RUN_URL,
      recordLabel: "Alert #12",
      recordUrl: RECORD_URL,
    });
  }

  type GetOutcome = (data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    record: { stateName?: string; isAcknowledged: () => Promise<boolean> };
  }) => Promise<{ outcome: OnCallPolicyRunOutcome; detail?: string }>;

  type KeepEnding = (
    run: OnCallPolicyRun,
    kept: Array<WorkspaceLiveMessage>,
  ) => WorkspaceLiveMessageRunEnding | undefined;

  const getOutcome: GetOutcome = (
    OnCallPolicyRunMessage as unknown as { getOutcome: GetOutcome }
  ).getOutcome.bind(OnCallPolicyRunMessage);

  const keepEnding: KeepEnding = (
    OnCallPolicyRunMessage as unknown as { keepEnding: KeepEnding }
  ).keepEnding.bind(OnCallPolicyRunMessage);

  test("knows when paging starts, and that it waits for working hours", () => {
    const built: OnCallPolicyRun = build(waitingLog());

    expect(built.pagingStartsAt).toEqual(PAGING_STARTS_AT);
    expect(built.isWaitingForWorkingHours).toBe(true);
  });

  test("a run that is not waiting carries neither", () => {
    const log: OnCallDutyPolicyExecutionLog = waitingLog();
    log.status = OnCallDutyPolicyStatus.Executing;

    const built: OnCallPolicyRun = build(log);

    expect("pagingStartsAt" in built).toBe(false);
    expect("isWaitingForWorkingHours" in built).toBe(false);
  });

  test("stands as waiting", async () => {
    await expect(
      getOutcome({
        executionLog: waitingLog(),
        record: {
          isAcknowledged: async (): Promise<boolean> => {
            return false;
          },
        },
      }),
    ).resolves.toEqual({ outcome: OnCallPolicyRunOutcome.Waiting });
  });

  test("ended while it waited, because its record was handled: did not page anyone, with the record's state", async () => {
    const log: OnCallDutyPolicyExecutionLog = waitingLog();
    log.status = OnCallDutyPolicyStatus.Completed;
    log.statusMessage = getOnCallPolicyRunEndedWhileWaitingMessage("alert");

    await expect(
      getOutcome({
        executionLog: log,
        record: {
          stateName: "Acknowledged",
          isAcknowledged: async (): Promise<boolean> => {
            return true;
          },
        },
      }),
    ).resolves.toEqual({
      outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
      detail: "Acknowledged",
    });
  });

  test("waiting is not an ending: nothing is kept, so the message turns into a paging run's", () => {
    const waiting: OnCallPolicyRun = run();

    expect(keepEnding(waiting, [])).toBeUndefined();
    expect(waiting.outcome).toBe(OnCallPolicyRunOutcome.Waiting);
  });

  test("an ending kept as waiting - should one ever be - is never applied", () => {
    const kept: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    kept.messageData = {
      endedAs: { outcome: OnCallPolicyRunOutcome.Waiting },
    };

    const ended: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
    });

    expect(keepEnding(ended, [kept])).toEqual({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
    });
    expect(ended.outcome).toBe(OnCallPolicyRunOutcome.NobodyAcknowledged);
  });

  test("a handled-while-waiting ending is kept as it was first told", () => {
    const handled: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
      outcomeDetail: "Acknowledged",
    });

    expect(keepEnding(handled, [])).toEqual({
      outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
      detail: "Acknowledged",
    });
  });
});
