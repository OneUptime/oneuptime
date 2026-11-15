import { describe, expect, test } from "@jest/globals";
import {
  getOnCallPageAgainStatusMessage,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  getOnCallDirectPagePagingMessage,
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  OnCallLogLine,
  OnCallLogLineCode,
  readOnCallLogLine,
} from "../../../Types/OnCallDutyPolicy/OnCallLogLine";
import { ON_CALL_PAGE_SENT_STATUS_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ON_CALL_POLICY_RUN_RECORD_KINDS,
  OnCallPolicyRunRecordKind,
  readOnCallPolicyRunLine,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunLine";
import {
  getOnCallPolicyRunOutOfTriesMessage,
  getUserOnCallLogOutOfTriesMessage,
  ON_CALL_POLICY_RUN_MAX_TRIES,
  OnCallPolicyRunFailures,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import {
  getUserOnCallLogHandedOverMessage,
  ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
  ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
  ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
  ON_CALL_RUN_PAGING_STARTED_MESSAGE,
  ON_CALL_RUN_SCHEDULED_MESSAGE,
  readUserOnCallLogHandedOverMinutes,
  USER_LOG_TIMED_OUT_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallRunStart";
import {
  EMAIL_SENT_STATUS_MESSAGE,
  getCallIdStatusMessage,
  getMessageIdStatusMessage,
  getWorkspaceMessageSentMessage,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  PUSH_NOTIFICATION_SENT_MESSAGE,
  readProviderIdStatusMessage,
  readWorkspaceMessageSentMessage,
  TELEGRAM_MESSAGE_SENT_MESSAGE,
  WHATSAPP_MESSAGE_SENT_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import {
  getOnCallTestPagePagingMessage,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { readOnCallTestPageStepLine } from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";

/*
 * THE REST OF AN ON-CALL LOG'S OWN LINES, READ BACK INTO CODES (#8434),
 * from the very constants and builders their writers write them with: a
 * run on its way, a direct page's, a page again's, a run or a page that
 * timed out or ran out of tries, a step skipped by escalating, a person's
 * page, a notification that went out or was acknowledged. Any other line
 * reads as none, to be drawn as written.
 */

const MINUTE_IN_MS: number = 60 * 1000;

function failures(data: {
  tries: number;
  minutes: number;
  error: string;
}): OnCallPolicyRunFailures {
  const startedAt: Date = new Date("2026-11-15T09:00:00.000Z");
  const lastFailedAt: Date = new Date(
    startedAt.getTime() + data.minutes * MINUTE_IN_MS,
  );

  return {
    failedTries: data.tries,
    firstFailedAt: startedAt,
    lastFailedAt: lastFailedAt,
    retryAt: new Date(lastFailedAt.getTime() + 5 * MINUTE_IN_MS),
    lastError: data.error,
  };
}

describe("lines that are one constant each", () => {
  test.each([
    [ON_CALL_RUN_SCHEDULED_MESSAGE, OnCallLogLineCode.RunScheduled],
    [ON_CALL_RUN_EXECUTION_STARTED_MESSAGE, OnCallLogLineCode.RunStarted],
    [ON_CALL_RUN_PAGING_STARTED_MESSAGE, OnCallLogLineCode.RunPagingStarted],
    [ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE, OnCallLogLineCode.RunTimedOut],
    [
      ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
      OnCallLogLineCode.RunNeverStarted,
    ],
    [
      ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
      OnCallLogLineCode.DirectPageNobodyPaged,
    ],
    [
      ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
      OnCallLogLineCode.DirectPageTimedOut,
    ],
    [
      ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
      OnCallLogLineCode.DirectPageNeverStarted,
    ],
    [
      ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
      OnCallLogLineCode.TestPageSentToFirstLevel,
    ],
    [
      ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      OnCallLogLineCode.LevelSkippedByEscalation,
    ],
    [
      ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      OnCallLogLineCode.SkippedAsEscalated,
    ],
    [
      LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      OnCallLogLineCode.SkippedAsEscalated,
    ],
    [
      ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
      OnCallLogLineCode.DirectPageNobodyToPage,
    ],
    [ON_CALL_PAGE_SENT_STATUS_MESSAGE, OnCallLogLineCode.PageSent],
    [ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE, OnCallLogLineCode.PageEscalated],
    [
      LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      OnCallLogLineCode.PageEscalated,
    ],
    [USER_LOG_TIMED_OUT_STATUS_MESSAGE, OnCallLogLineCode.PageTimedOut],
    [
      ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      OnCallLogLineCode.NotificationAcknowledged,
    ],
    [
      ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
      OnCallLogLineCode.NotificationEscalatedFrom,
    ],
    [EMAIL_SENT_STATUS_MESSAGE, OnCallLogLineCode.EmailSent],
    [PUSH_NOTIFICATION_SENT_MESSAGE, OnCallLogLineCode.PushSent],
    [TELEGRAM_MESSAGE_SENT_MESSAGE, OnCallLogLineCode.TelegramSent],
    [WHATSAPP_MESSAGE_SENT_MESSAGE, OnCallLogLineCode.WhatsAppSent],
  ] as Array<[string, OnCallLogLineCode]>)(
    "%s",
    (line: string, code: OnCallLogLineCode) => {
      expect(readOnCallLogLine(line)).toEqual({ code: code });
      // Read with the spaces a column may keep around it.
      expect(readOnCallLogLine(`  ${line}\n`)).toEqual({ code: code });
    },
  );

  test("the words they are written with, as the workers have always written them", () => {
    expect(ON_CALL_RUN_SCHEDULED_MESSAGE).toBe("Scheduled.");
    expect(ON_CALL_RUN_EXECUTION_STARTED_MESSAGE).toBe("Execution started...");
    expect(ON_CALL_RUN_PAGING_STARTED_MESSAGE).toBe("Paging started...");
    expect(ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE).toBe(
      "Policy Execution timed out.",
    );
    expect(ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE).toBe(
      "Policy Execution never started (stuck in Scheduled) and was timed out.",
    );
    expect(USER_LOG_TIMED_OUT_STATUS_MESSAGE).toBe("Rule execution timed out.");
    expect(ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE).toBe(
      "Notification Acknowledged",
    );
    expect(PUSH_NOTIFICATION_SENT_MESSAGE).toBe(
      "Push notification sent successfully",
    );
    expect(TELEGRAM_MESSAGE_SENT_MESSAGE).toBe(
      "Telegram message sent successfully",
    );
    expect(WHATSAPP_MESSAGE_SENT_MESSAGE).toBe(
      "WhatsApp message sent successfully",
    );
    expect(EMAIL_SENT_STATUS_MESSAGE).toBe(
      "Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.",
    );
    expect(getUserOnCallLogHandedOverMessage(5)).toBe(
      "This page did not finish starting within 5 minutes, so its notifications are sent from here.",
    );
    expect(getWorkspaceMessageSentMessage("Slack")).toBe(
      "Message sent on Slack.",
    );
    expect(getMessageIdStatusMessage("SM0123")).toBe("Message ID: SM0123");
    expect(getCallIdStatusMessage("CA0123")).toBe("Call ID: CA0123");
  });
});

describe("a direct page's and a test page's paging lines: how many they paged", () => {
  test.each([1, 2, 7, 100])("a direct page that paged %i", (count: number) => {
    expect(readOnCallLogLine(getOnCallDirectPagePagingMessage(count))).toEqual({
      code: OnCallLogLineCode.DirectPagePaged,
      count: count,
    });
  });

  test.each([1, 2, 12])("a test page sent to %i", (count: number) => {
    expect(readOnCallLogLine(getOnCallTestPagePagingMessage(count))).toEqual({
      code: OnCallLogLineCode.TestPageSent,
      count: count,
    });
  });

  test("words its builder never writes are no line of it", () => {
    // The builder says "1 person", never "1 people", nor "2 person".
    expect(readOnCallLogLine("1 people were paged.")).toBeNull();
    expect(readOnCallLogLine("2 person was paged.")).toBeNull();
    expect(readOnCallLogLine("Test page sent to 3 person.")).toBeNull();
    expect(readOnCallLogLine("people were paged.")).toBeNull();
  });
});

describe("a page again's paging line: which of how many, and the policy's timeout", () => {
  test.each([5, 30, 60, 90, 1440])("%i minutes", (minutes: number) => {
    for (const number of [1, ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN]) {
      expect(
        readOnCallLogLine(
          getOnCallPageAgainStatusMessage({
            pageAgainNumber: number,
            minutes: minutes,
          }),
        ),
      ).toEqual({
        code: OnCallLogLineCode.PagingAgain,
        pageAgainNumber: number,
        pagesAgainAtMost: ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
        minutes: minutes,
      });
    }
  });

  test("a line that starts like one but is not its builder's is none", () => {
    expect(
      readOnCallLogLine("Paging again (1 of 5): because somebody asked."),
    ).toBeNull();
    expect(
      readOnCallLogLine(
        "Paging again (1 of 5): still not resolved 1 minutes after it was acknowledged.",
      ),
    ).toBeNull();
  });
});

describe("a person's page handed over once it did not finish starting", () => {
  test("its minutes are read back", () => {
    expect(readOnCallLogLine(getUserOnCallLogHandedOverMessage(5))).toEqual({
      code: OnCallLogLineCode.PageHandedOver,
      minutes: 5,
    });
    expect(readUserOnCallLogHandedOverMinutes("Something else.")).toBeNull();
    expect(
      readUserOnCallLogHandedOverMinutes(
        "This page did not finish starting within five minutes, so its notifications are sent from here.",
      ),
    ).toBeNull();
  });
});

describe("a run, or a person's page, that ran out of tries (OnCallPolicyRunRetry)", () => {
  const ERROR: string = "Connection terminated unexpectedly.";

  test.each([
    [true, OnCallPolicyRunRecordKind.Incident],
    [false, OnCallPolicyRunRecordKind.Alert],
    [false, OnCallPolicyRunRecordKind.IncidentEpisode],
    [true, OnCallPolicyRunRecordKind.AlertEpisode],
  ] as Array<[boolean, OnCallPolicyRunRecordKind]>)(
    "a run (waiting: %s) about an %s",
    (wasWaiting: boolean, recordKind: OnCallPolicyRunRecordKind) => {
      const message: string = getOnCallPolicyRunOutOfTriesMessage({
        failures: failures({
          tries: ON_CALL_POLICY_RUN_MAX_TRIES,
          minutes: 37,
          error: ERROR,
        }),
        wasWaiting: wasWaiting,
        recordKind: recordKind,
      });

      expect(readOnCallLogLine(message)).toEqual({
        code: OnCallLogLineCode.RunOutOfTries,
        tries: ON_CALL_POLICY_RUN_MAX_TRIES,
        minutes: 37,
        wasWaiting: wasWaiting,
        words: ERROR,
        recordKind: recordKind,
      });
    },
  );

  test("every record kind a run names is read, for a run and for a page", () => {
    for (const recordKind of ON_CALL_POLICY_RUN_RECORD_KINDS) {
      const page: OnCallLogLine | null = readOnCallLogLine(
        getUserOnCallLogOutOfTriesMessage({
          failures: failures({ tries: 10, minutes: 1, error: ERROR }),
          recordKind: recordKind,
        }),
      );

      expect(page).toEqual({
        code: OnCallLogLineCode.PageOutOfTries,
        tries: 10,
        minutes: 1,
        words: ERROR,
        recordKind: recordKind,
      });
    }
  });

  test("tries in under a minute are none, and an error with no full stop is given one, as the builder gives it", () => {
    expect(
      readOnCallLogLine(
        getOnCallPolicyRunOutOfTriesMessage({
          failures: failures({ tries: 3, minutes: 0, error: "timeout" }),
          wasWaiting: false,
        }),
      ),
    ).toEqual({
      code: OnCallLogLineCode.RunOutOfTries,
      tries: 3,
      minutes: 0,
      wasWaiting: false,
      words: "timeout.",
    });
  });

  test("no record named: nothing after the error", () => {
    expect(
      readOnCallLogLine(
        getUserOnCallLogOutOfTriesMessage({
          failures: failures({ tries: 10, minutes: 37, error: ERROR }),
        }),
      ),
    ).toEqual({
      code: OnCallLogLineCode.PageOutOfTries,
      tries: 10,
      minutes: 37,
      words: ERROR,
    });
  });

  test("an error that names a record itself stays the error's words", () => {
    const error: string =
      "If the incident still needs somebody, page them again.";

    expect(
      readOnCallLogLine(
        getOnCallPolicyRunOutOfTriesMessage({
          failures: failures({ tries: 10, minutes: 37, error: error }),
          wasWaiting: true,
          recordKind: "alert",
        }),
      ),
    ).toEqual({
      code: OnCallLogLineCode.RunOutOfTries,
      tries: 10,
      minutes: 37,
      wasWaiting: true,
      words: error,
      recordKind: OnCallPolicyRunRecordKind.Alert,
    });
  });

  test("a very long error the builder clipped is read as clipped", () => {
    const longError: string = "x".repeat(20000);
    const message: string = getOnCallPolicyRunOutOfTriesMessage({
      failures: failures({ tries: 10, minutes: 37, error: longError }),
      wasWaiting: false,
      recordKind: "incident",
    });
    const line: OnCallLogLine | null = readOnCallLogLine(message);

    expect(line?.code).toBe(OnCallLogLineCode.RunOutOfTries);
    expect(line?.words?.endsWith("...")).toBe(true);
    expect(line?.recordKind).toBe(OnCallPolicyRunRecordKind.Incident);
  });

  test("words the builder never writes are none", () => {
    expect(
      readOnCallLogLine(
        "OneUptime tried 10 times in 37 minutes to start this run, and every try failed, so nobody was paged.",
      ),
    ).toBeNull();
    expect(
      readOnCallLogLine(
        "OneUptime tried 10 times in 1 minutes to start this run, and every try failed, so nobody was paged. The last try failed with: x.",
      ),
    ).toBeNull();
  });
});

describe("a notification that went out", () => {
  test("on a workspace, by its name", () => {
    for (const name of ["Slack", "Microsoft Teams", "Mattermost"]) {
      expect(readOnCallLogLine(getWorkspaceMessageSentMessage(name))).toEqual({
        code: OnCallLogLineCode.WorkspaceMessageSent,
        name: name,
      });
    }

    expect(readWorkspaceMessageSentMessage("Message sent on .")).toBeNull();
  });

  test("by the id its provider gave it: a message, or a call", () => {
    expect(readOnCallLogLine(getMessageIdStatusMessage("SM0123"))).toEqual({
      code: OnCallLogLineCode.SentWithMessageId,
      id: "SM0123",
    });
    expect(readOnCallLogLine(getCallIdStatusMessage("CA0123"))).toEqual({
      code: OnCallLogLineCode.CallPlaced,
      id: "CA0123",
    });
    // An id is one word: anything longer is some other line.
    expect(
      readProviderIdStatusMessage("Message ID: SM0123 was refused"),
    ).toBeNull();
    expect(readProviderIdStatusMessage("Message ID: ")).toBeNull();
  });
});

describe("any other line is none, to be drawn as written", () => {
  test.each([
    "",
    "   ",
    "Twilio: 21614 'To' number +15550100 is not a valid mobile number.",
    "Error: connect ECONNREFUSED 10.0.0.7:5432",
    "Scheduled",
    "Alert sent",
    "Paging started",
  ])("%j", (line: string) => {
    expect(readOnCallLogLine(line)).toBeNull();
  });

  test("null and undefined", () => {
    expect(readOnCallLogLine(null)).toBeNull();
    expect(readOnCallLogLine(undefined)).toBeNull();
  });

  /*
   * The readers that came first keep their lines: a run's ending, a test
   * page's, a step's. This one reads only what none of them reads.
   */
  test("lines the other readers read are not read here", () => {
    for (const line of [
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
    ]) {
      expect(readOnCallLogLine(line)).toBeNull();
    }

    expect(
      readOnCallPolicyRunLine(ON_CALL_RUN_EXECUTION_STARTED_MESSAGE),
    ).toBeNull();
    expect(
      readOnCallTestPageStepLine({
        statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      }),
    ).toBeNull();
  });
});
