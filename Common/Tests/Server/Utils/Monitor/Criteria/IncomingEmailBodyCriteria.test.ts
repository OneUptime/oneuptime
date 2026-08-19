import IncomingEmailCriteria from "../../../../../Server/Utils/Monitor/Criteria/IncomingEmailCriteria";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import OneUptimeDate from "../../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "../../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * CheckOn.EmailBody is what the Incoming Email monitor's default criteria
 * now run on: "body contains error" takes the monitor offline, "body does
 * not contain error" brings it back online. These tests cover that pair,
 * the case-insensitive matching the email evaluator does, and the
 * onlyCheckForIncomingEmailReceivedAt guard — the flag the every-30-seconds
 * cron sets, which must stop the cron from re-judging a stale email body.
 */

const KEYWORD: string =
  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

function buildEmail(input: {
  emailBody: string;
  onlyCheckForIncomingEmailReceivedAt?: boolean | undefined;
  minutesAgo?: number | undefined;
}): DataToProcess {
  const checkedAt: Date = OneUptimeDate.getCurrentDate();

  const email: IncomingEmailMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    emailFrom: "alerts@example.com",
    emailTo: "monitor@inbound.oneuptime.com",
    emailSubject: "Nightly job report",
    emailBody: input.emailBody,
    emailReceivedAt: OneUptimeDate.addRemoveMinutes(
      checkedAt,
      -(input.minutesAgo ?? 0),
    ),
    checkedAt: checkedAt,
    onlyCheckForIncomingEmailReceivedAt:
      input.onlyCheckForIncomingEmailReceivedAt,
  };

  return email as DataToProcess;
}

function evaluate(
  emailBody: string,
  criteriaFilter: CriteriaFilter,
  onlyCheckForIncomingEmailReceivedAt?: boolean,
): Promise<string | null> {
  return IncomingEmailCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildEmail({
      emailBody,
      onlyCheckForIncomingEmailReceivedAt,
    }),
    criteriaFilter,
  });
}

const CONTAINS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.EmailBody,
  filterType: FilterType.Contains,
  value: KEYWORD,
};

const NOT_CONTAINS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.EmailBody,
  filterType: FilterType.NotContains,
  value: KEYWORD,
};

describe("IncomingEmailCriteria - CheckOn.EmailBody", () => {
  describe("Contains (the default offline criteria)", () => {
    test("a body reporting an error matches", async () => {
      const result: string | null = await evaluate(
        "The nightly backup finished with an error.",
        CONTAINS_ERROR,
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Email body contains");
      expect(result).toContain(KEYWORD);
    });

    test("a healthy body does not match", async () => {
      expect(
        await evaluate("The nightly backup finished cleanly.", CONTAINS_ERROR),
      ).toBeNull();
    });

    test("matching is case insensitive", async () => {
      expect(await evaluate("ERROR: disk full", CONTAINS_ERROR)).toBeTruthy();
      expect(await evaluate("Error: disk full", CONTAINS_ERROR)).toBeTruthy();
    });

    test("an empty body does not match", async () => {
      expect(await evaluate("", CONTAINS_ERROR)).toBeNull();
    });
  });

  describe("Not Contains (the default online criteria)", () => {
    test("a healthy body matches", async () => {
      const result: string | null = await evaluate(
        "All checks passed.",
        NOT_CONTAINS_ERROR,
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Email body does not contain");
      expect(result).toContain(KEYWORD);
    });

    test("a body reporting an error does not match", async () => {
      expect(
        await evaluate("Job failed with error 500", NOT_CONTAINS_ERROR),
      ).toBeNull();
    });

    test("a differently-cased error still blocks the online criteria", async () => {
      expect(await evaluate("FATAL ERROR", NOT_CONTAINS_ERROR)).toBeNull();
    });

    test("an empty body matches", async () => {
      expect(await evaluate("", NOT_CONTAINS_ERROR)).toBeTruthy();
    });
  });

  describe("Contains and Not Contains are mutually exclusive", () => {
    const bodies: Array<string> = [
      "error",
      "ERROR",
      "all good",
      "",
      "there was an Error in stage 2",
    ];

    test.each(bodies)(
      "exactly one of the two default filters matches body %p",
      async (body: string) => {
        const contains: boolean = Boolean(await evaluate(body, CONTAINS_ERROR));
        const notContains: boolean = Boolean(
          await evaluate(body, NOT_CONTAINS_ERROR),
        );

        expect(contains).not.toBe(notContains);
      },
    );
  });

  /*
   * CheckOnlineStatus runs every 30 seconds and replays the LAST email that
   * arrived, with onlyCheckForIncomingEmailReceivedAt set. Body checks are
   * skipped on that path, so the cron cannot re-open an incident from an old
   * email — and, since the defaults no longer include an Email Received
   * filter, a monitor on the defaults is only judged when mail actually lands.
   */
  describe("onlyCheckForIncomingEmailReceivedAt guard", () => {
    test("the body Contains filter is skipped on the cron path", async () => {
      expect(
        await evaluate("ERROR: disk full", CONTAINS_ERROR, true),
      ).toBeNull();
    });

    test("the body Not Contains filter is skipped on the cron path", async () => {
      expect(await evaluate("all good", NOT_CONTAINS_ERROR, true)).toBeNull();
    });

    test("the same body is evaluated when the email actually arrives", async () => {
      expect(
        await evaluate("ERROR: disk full", CONTAINS_ERROR, false),
      ).toBeTruthy();
    });
  });

  describe("filters that cannot decide", () => {
    test("a Contains filter with no value does not match", async () => {
      expect(
        await evaluate("error", {
          checkOn: CheckOn.EmailBody,
          filterType: FilterType.Contains,
          value: undefined,
        }),
      ).toBeNull();
    });

    test("a Not Contains filter with no value does not match", async () => {
      expect(
        await evaluate("all good", {
          checkOn: CheckOn.EmailBody,
          filterType: FilterType.NotContains,
          value: undefined,
        }),
      ).toBeNull();
    });
  });

  /*
   * The arrival-clock check is no longer part of the defaults, but users can
   * still add it by hand, so it must keep working alongside the body check.
   */
  describe("CheckOn.EmailReceivedAt still works when added manually", () => {
    test("Not Recieved In Minutes fires once the window has elapsed", async () => {
      const result: string | null =
        await IncomingEmailCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildEmail({
            emailBody: "all good",
            minutesAgo: 45,
            onlyCheckForIncomingEmailReceivedAt: true,
          }),
          criteriaFilter: {
            checkOn: CheckOn.EmailReceivedAt,
            filterType: FilterType.NotRecievedInMinutes,
            value: 30,
          },
        });

      expect(result).toBeTruthy();
    });

    test("Recieved In Minutes fires while the window is still open", async () => {
      const result: string | null =
        await IncomingEmailCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildEmail({
            emailBody: "all good",
            minutesAgo: 5,
            onlyCheckForIncomingEmailReceivedAt: true,
          }),
          criteriaFilter: {
            checkOn: CheckOn.EmailReceivedAt,
            filterType: FilterType.RecievedInMinutes,
            value: 30,
          },
        });

      expect(result).toBeTruthy();
    });
  });
});
