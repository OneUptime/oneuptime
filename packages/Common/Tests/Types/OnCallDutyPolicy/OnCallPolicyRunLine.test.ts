import { describe, expect, test } from "@jest/globals";
import {
  ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
  ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
  LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { getOnCallPolicyRunWaitingMessage } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import { ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  ON_CALL_POLICY_RUN_RECORD_KINDS,
  OnCallPolicyRunLine,
  OnCallPolicyRunLineCode,
  OnCallPolicyRunRecordKind,
  readOnCallPolicyRunLine,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunLine";
import {
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";

/*
 * AN ON-CALL POLICY RUN'S OWN LINE, READ BACK AS A CODE (#8330).
 *
 * The worker that ends a run writes how it ended in English, from
 * OnCallDutyPolicyRunEnding and OnCallDutyPolicyArchive. The Dashboard
 * words the code in the reader's language. Every line read here is built
 * with the writer's own constants and builders, so a line that changes is
 * read the same way, or not at all - never mistaken for another.
 */

describe("readOnCallPolicyRunLine", () => {
  test("a run that went through every escalation rule", () => {
    expect(
      readOnCallPolicyRunLine(
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      ),
    ).toEqual({ code: OnCallPolicyRunLineCode.WentThroughEveryRule });
    // The English as the worker writes it, byte for byte.
    expect(ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE).toBe(
      "Execution completed.",
    );
  });

  test("everybody it paged escalated it, in today's words and in the words of before", () => {
    for (const message of [
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    ]) {
      expect(readOnCallPolicyRunLine(message)).toEqual({
        code: OnCallPolicyRunLineCode.EverybodyEscalated,
      });
    }
  });

  test("nobody notified, in today's words and in the words of before", () => {
    for (const message of [
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    ]) {
      expect(readOnCallPolicyRunLine(message)).toEqual({
        code: OnCallPolicyRunLineCode.NobodyNotified,
      });
    }
  });

  test("an archived policy: not run, or stopped while it escalated", () => {
    expect(
      readOnCallPolicyRunLine(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE),
    ).toEqual({ code: OnCallPolicyRunLineCode.PolicyArchivedNotRun });
    expect(
      readOnCallPolicyRunLine(
        ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
      ),
    ).toEqual({ code: OnCallPolicyRunLineCode.PolicyArchivedStopped });
  });

  test("a policy with no escalation rules", () => {
    expect(
      readOnCallPolicyRunLine(ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE),
    ).toEqual({ code: OnCallPolicyRunLineCode.PolicyHasNoRules });
  });

  test.each([...ON_CALL_POLICY_RUN_RECORD_KINDS])(
    "a run that stopped because its %s was acknowledged or resolved names it",
    (recordKind: OnCallPolicyRunRecordKind) => {
      expect(
        readOnCallPolicyRunLine(
          getOnCallPolicyRunRecordHandledMessage(recordKind),
        ),
      ).toEqual({
        code: OnCallPolicyRunLineCode.RecordHandled,
        recordKind: recordKind,
      });
    },
  );

  test.each([...ON_CALL_POLICY_RUN_RECORD_KINDS])(
    "a page again that stopped because its %s was resolved names it",
    (recordKind: OnCallPolicyRunRecordKind) => {
      expect(
        readOnCallPolicyRunLine(
          getOnCallPolicyRunRecordResolvedMessage(recordKind),
        ),
      ).toEqual({
        code: OnCallPolicyRunLineCode.RecordResolved,
        recordKind: recordKind,
      });
    },
  );

  test("the four kinds are the ones the worker names", () => {
    expect([...ON_CALL_POLICY_RUN_RECORD_KINDS].sort()).toEqual(
      ["alert", "alert episode", "incident", "incident episode"].sort(),
    );
    expect(Object.values(OnCallPolicyRunRecordKind).sort()).toEqual(
      [...ON_CALL_POLICY_RUN_RECORD_KINDS].sort(),
    );
  });

  test("a line read with its surrounding white space is read the same", () => {
    expect(
      readOnCallPolicyRunLine(
        `  ${getOnCallPolicyRunRecordHandledMessage("incident")}\n`,
      ),
    ).toEqual({
      code: OnCallPolicyRunLineCode.RecordHandled,
      recordKind: OnCallPolicyRunRecordKind.Incident,
    });
  });

  test("a record kind the worker never names is no ending", () => {
    expect(
      readOnCallPolicyRunLine(
        getOnCallPolicyRunRecordHandledMessage("monitor"),
      ),
    ).toBeNull();
    expect(
      readOnCallPolicyRunLine(
        `${ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START}incident was handled.`,
      ),
    ).toBeNull();
  });

  test("any other line is none: a run still paging, a waiting one, an error, a test's, a direct page's", () => {
    for (const message of [
      "Scheduled.",
      "Execution started...",
      "Paging started...",
      "Execution completed",
      "execution completed.",
      "Error: connect ECONNREFUSED 127.0.0.1:5432",
      ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
      ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
      ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: new Date("2026-11-18T09:00:00.000Z"),
        now: new Date("2026-11-17T09:00:00.000Z"),
        timezone: "Europe/London",
        isWaitingForWorkingHours: true,
      }),
      `${ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE} And then some.`,
    ]) {
      expect([message, readOnCallPolicyRunLine(message)]).toEqual([
        message,
        null,
      ]);
    }
  });

  test("no line at all is none", () => {
    for (const message of [undefined, null, "", "   "]) {
      expect(readOnCallPolicyRunLine(message)).toBeNull();
    }
  });

  test("every code is read from some line the worker writes", () => {
    const lines: Array<string> = [
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
      ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
      getOnCallPolicyRunRecordHandledMessage("alert"),
      getOnCallPolicyRunRecordResolvedMessage("alert"),
    ];
    const codes: Array<OnCallPolicyRunLineCode> = lines.map(
      (line: string): OnCallPolicyRunLineCode => {
        return (readOnCallPolicyRunLine(line) as OnCallPolicyRunLine).code;
      },
    );

    expect(codes.sort()).toEqual(Object.values(OnCallPolicyRunLineCode).sort());
  });
});
