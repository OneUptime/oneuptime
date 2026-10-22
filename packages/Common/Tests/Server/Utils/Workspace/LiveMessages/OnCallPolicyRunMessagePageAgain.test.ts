import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_OUTCOME,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A PAGE AGAIN, IN SLACK AND MICROSOFT TEAMS (issue #5123).
 *
 * A policy whose acknowledgement timeout ran out pages again about a record
 * somebody acknowledged earlier (OnCallAcknowledgementTimeout): a run of its
 * own, with a message of its own in the record's channels. It says it pages
 * AGAIN, and why, right under its headline - for as long as the run is told,
 * as a run that started early says so - and, when nobody answers it, does
 * not claim that nobody acknowledged the record: somebody did, earlier.
 */

const POLICY_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/x";
const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-2";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/incidents/42";

const POLICY: string = `**[Payments](${POLICY_URL})**`;
const RECORD: string = `**[Incident INC-42](${RECORD_URL})**`;

function run(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "Payments",
    policyUrl: POLICY_URL,
    runUrl: RUN_URL,
    recordLabel: "Incident INC-42",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 2,
    escalateAfterInMinutes: 30,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [],
    notPaged: [],
    pageAgainNumber: 1,
    ...overrides,
  };
}

describe("the message of a page again", () => {
  test("its headline says the policy is paging AGAIN for the record", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run()).split("\n\n")[0]).toBe(
      `📟 ${POLICY} is paging again for ${RECORD}`,
    );
  });

  test("says why right under the headline: which time, and that it is still not resolved", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run()).split("\n\n")[1]).toBe(
      "**Paged again** (1 of 5): still not resolved after it was acknowledged.",
    );
  });

  test("the fifth says it is the last", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(run({ pageAgainNumber: 5 })),
    ).toContain(
      "**Paged again** (5 of 5, the last time): still not resolved after it was acknowledged.",
    );
  });

  test("its notification line says it pages again", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(run())).toBe(
      "Payments is paging again for Incident INC-42",
    );
  });

  test("keeps saying why once it is answered", () => {
    const answered: string = OnCallPolicyRunMessageView.getMarkdown(
      run({
        outcome: OnCallPolicyRunOutcome.Acknowledged,
        acknowledgedByName: "Ana Lopez",
      }),
    );

    expect(
      answered
        .split("\n\n")[0]!
        .startsWith(`✅ **Ana Lopez** acknowledged ${RECORD}, so `),
    ).toBe(true);
    expect(answered).toContain("**Paged again** (1 of 5)");
  });

  test("raises no alarm while it pages, nor once it is answered", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(run())).toEqual([]);
    expect(
      OnCallPolicyRunMessageView.getAlarms(
        run({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Ana Lopez",
        }),
      ),
    ).toEqual([]);
  });
});

describe("a page again nobody answered", () => {
  const unanswered: OnCallPolicyRun = run({
    outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
    paged: [
      {
        name: "Ana Lopez",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
    ],
  });

  test("says nobody answered the page again - not that nobody ever acknowledged the record", () => {
    const headline: string =
      OnCallPolicyRunMessageView.getMarkdown(unanswered).split("\n\n")[0]!;

    expect(headline).toBe(
      `⚠️ ${POLICY} paged again for ${RECORD} and nobody answered`,
    );
    expect(headline).not.toContain("nobody acknowledged");
  });

  test("its notification line says the same", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(unanswered)).toBe(
      "Nobody answered the page again for Incident INC-42",
    );
  });

  test("raises one alarm: it is still not resolved, and someone needs to take it", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(unanswered);

    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.key).toBe(ON_CALL_RUN_ALARM_OUTCOME);
    expect(alarms[0]!.markdown.startsWith(
      `⚠️ Nobody answered the page again for ${RECORD}: it is still not resolved.`,
    )).toBe(true);
    expect(alarms[0]!.markdown.endsWith("Someone needs to take it.")).toBe(
      true,
    );
    expect(alarms[0]!.markdown).not.toContain("Nobody has acknowledged");
    expect(alarms[0]!.text).toBe(
      "Nobody answered the page again for Incident INC-42: someone needs to take it",
    );
  });

  test("a first run nobody acknowledged still says so, as before", () => {
    const first: OnCallPolicyRun = run({
      outcome: OnCallPolicyRunOutcome.NobodyAcknowledged,
      pageAgainNumber: undefined,
    });

    expect(OnCallPolicyRunMessageView.getMarkdown(first).split("\n\n")[0]).toBe(
      `⚠️ ${POLICY} went through every escalation rule for ${RECORD} and nobody acknowledged`,
    );
    expect(OnCallPolicyRunMessageView.getPlainText(first)).toBe(
      "Nobody acknowledged Incident INC-42",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(first)[0]!.markdown).toContain(
      `⚠️ Nobody has acknowledged ${RECORD}.`,
    );
  });
});

describe("a run that is not a page again", () => {
  test("says nothing of paging again", () => {
    const first: string = OnCallPolicyRunMessageView.getMarkdown(
      run({ pageAgainNumber: undefined }),
    );

    expect(first).not.toContain("Paged again");
    expect(first).not.toContain("paging again");
    expect(first.split("\n\n")[0]).toBe(
      `📟 ${POLICY} is paging for ${RECORD}`,
    );
  });
});

describe("a page again, read for its message", () => {
  function pageAgainLog(
    pageAgainNumber: number | undefined,
  ): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log.id = ObjectID.generate();
    log.projectId = ObjectID.generate();
    log.onCallDutyPolicyId = ObjectID.generate();
    log.triggeredByIncidentId = ObjectID.generate();
    log.status = OnCallDutyPolicyStatus.Executing;
    log.statusMessage =
      "Paging again (2 of 5): still not resolved 30 minutes after it was acknowledged.";
    log.onCallPolicyExecutionRepeatCount = 1;

    if (pageAgainNumber !== undefined) {
      log.pageAgainNumber = pageAgainNumber;
    }

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "Payments";
    log.onCallDutyPolicy = policy;

    return log;
  }

  function build(log: OnCallDutyPolicyExecutionLog): OnCallPolicyRun {
    const first: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    first.id = ObjectID.generate();
    first.order = 1;
    first.escalateAfterInMinutes = 30;

    return OnCallPolicyRunMessage.buildRun({
      executionLog: log,
      rules: [first],
      timeline: [],
      deliveries: [],
      policyUrl: POLICY_URL,
      runUrl: RUN_URL,
      recordLabel: "Incident INC-42",
      recordUrl: RECORD_URL,
    });
  }

  test("carries which time it pages again", () => {
    expect(build(pageAgainLog(2)).pageAgainNumber).toBe(2);
  });

  test("a run that is not one carries none", () => {
    expect("pageAgainNumber" in build(pageAgainLog(undefined))).toBe(false);
    expect("pageAgainNumber" in build(pageAgainLog(0))).toBe(false);
  });

  test("reads which time with the rest of the run", async () => {
    const findOneById: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.findOneById
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null);

    try {
      await expect(
        OnCallPolicyRunMessage.readRun(ObjectID.generate()),
      ).resolves.toBeNull();

      expect(findOneById.mock.calls[0]![0].select).toMatchObject({
        pageAgainNumber: true,
      });
    } finally {
      findOneById.mockRestore();
    }
  });
});
