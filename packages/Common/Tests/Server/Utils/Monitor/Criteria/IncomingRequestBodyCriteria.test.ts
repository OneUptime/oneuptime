import IncomingRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * CheckOn.RequestBody is what the Incoming Request monitor's default
 * criteria now run on: "body contains error" takes the monitor offline,
 * "body does not contain error" brings it back online. These tests cover
 * that pair against every body shape the ingest endpoint can hand over —
 * JSON objects (stringified before matching), plain strings, and the
 * bodiless heartbeat ping, which must read as "no error present" rather
 * than as "unknown".
 */

const KEYWORD: string =
  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

function buildRequest(
  requestBody: string | JSONObject | undefined,
): DataToProcess {
  const now: Date = OneUptimeDate.getCurrentDate();

  const request: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    requestBody: requestBody,
    requestHeaders: {},
    incomingRequestReceivedAt: now,
    checkedAt: now,
  };

  return request as DataToProcess;
}

function evaluate(
  requestBody: string | JSONObject | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildRequest(requestBody),
    criteriaFilter,
  });
}

const CONTAINS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.RequestBody,
  filterType: FilterType.Contains,
  value: KEYWORD,
};

const NOT_CONTAINS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.RequestBody,
  filterType: FilterType.NotContains,
  value: KEYWORD,
};

describe("IncomingRequestCriteria - CheckOn.RequestBody", () => {
  describe("Contains (the default offline criteria)", () => {
    test("a JSON body reporting an error matches", async () => {
      const result: string | null = await evaluate(
        { status: "error", detail: "disk full" },
        CONTAINS_ERROR,
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Request body contains");
      expect(result).toContain(KEYWORD);
    });

    test("a healthy JSON body does not match", async () => {
      expect(
        await evaluate({ status: "ok", detail: "all good" }, CONTAINS_ERROR),
      ).toBeNull();
    });

    test("a plain-string body reporting an error matches", async () => {
      expect(
        await evaluate("error: queue backed up", CONTAINS_ERROR),
      ).toBeTruthy();
    });

    test("a body carrying the keyword inside a longer word still matches (substring semantics)", async () => {
      expect(await evaluate({ code: "errored" }, CONTAINS_ERROR)).toBeTruthy();
    });

    test("an empty object body does not match", async () => {
      expect(await evaluate({}, CONTAINS_ERROR)).toBeNull();
    });

    test("an empty string body does not match", async () => {
      expect(await evaluate("", CONTAINS_ERROR)).toBeNull();
    });

    test("a missing body does not match", async () => {
      expect(await evaluate(undefined, CONTAINS_ERROR)).toBeNull();
    });

    test("nested values are searched because the body is compared as JSON", async () => {
      expect(
        await evaluate(
          { alerts: [{ labels: { severity: "error" } }] },
          CONTAINS_ERROR,
        ),
      ).toBeTruthy();
    });

    test("matching is case sensitive", async () => {
      expect(await evaluate({ status: "ERROR" }, CONTAINS_ERROR)).toBeNull();
    });
  });

  describe("Not Contains (the default online criteria)", () => {
    test("a healthy JSON body matches", async () => {
      const result: string | null = await evaluate(
        { status: "ok" },
        NOT_CONTAINS_ERROR,
      );

      expect(result).toBeTruthy();
      expect(result).toContain("Request body does not contain");
      expect(result).toContain(KEYWORD);
    });

    test("a JSON body reporting an error does not match", async () => {
      expect(
        await evaluate({ status: "error" }, NOT_CONTAINS_ERROR),
      ).toBeNull();
    });

    /*
     * A bodiless heartbeat POST is the single most common Incoming Request
     * payload. It has to satisfy the default online criteria, otherwise a
     * brand-new monitor could never report itself healthy.
     */
    test("an empty object body matches", async () => {
      expect(await evaluate({}, NOT_CONTAINS_ERROR)).toBeTruthy();
    });

    test("an empty string body matches", async () => {
      expect(await evaluate("", NOT_CONTAINS_ERROR)).toBeTruthy();
    });

    test("a missing body matches", async () => {
      expect(await evaluate(undefined, NOT_CONTAINS_ERROR)).toBeTruthy();
    });

    test("a plain-string body without the keyword matches", async () => {
      expect(
        await evaluate("all systems nominal", NOT_CONTAINS_ERROR),
      ).toBeTruthy();
    });
  });

  describe("Contains and Not Contains are mutually exclusive", () => {
    const bodies: Array<string | JSONObject | undefined> = [
      { status: "error" },
      { status: "ok" },
      "error",
      "ok",
      "",
      {},
      undefined,
    ];

    test.each(bodies)(
      "exactly one of the two default filters matches body %p",
      async (body: string | JSONObject | undefined) => {
        const contains: boolean = Boolean(await evaluate(body, CONTAINS_ERROR));
        const notContains: boolean = Boolean(
          await evaluate(body, NOT_CONTAINS_ERROR),
        );

        expect(contains).not.toBe(notContains);
      },
    );
  });

  describe("filters that cannot decide", () => {
    test("a Contains filter with no value does not match", async () => {
      expect(
        await evaluate(
          { status: "error" },
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: undefined,
          },
        ),
      ).toBeNull();
    });

    test("a Not Contains filter with no value does not match", async () => {
      expect(
        await evaluate(
          { status: "ok" },
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.NotContains,
            value: undefined,
          },
        ),
      ).toBeNull();
    });

    test("an unsupported filter type on the body does not match", async () => {
      expect(
        await evaluate(
          { status: "ok" },
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.EqualTo,
            value: KEYWORD,
          },
        ),
      ).toBeNull();
    });
  });

  /*
   * The heartbeat check is no longer part of the defaults, but users can
   * still add it by hand, so it must keep working alongside the body check.
   */
  describe("CheckOn.IncomingRequest still works when added manually", () => {
    function buildAgedRequest(minutesAgo: number): DataToProcess {
      const checkedAt: Date = OneUptimeDate.getCurrentDate();

      const request: IncomingMonitorRequest = {
        projectId: ObjectID.generate(),
        monitorId: ObjectID.generate(),
        requestBody: {},
        incomingRequestReceivedAt: OneUptimeDate.addRemoveMinutes(
          checkedAt,
          -minutesAgo,
        ),
        checkedAt: checkedAt,
      };

      return request as DataToProcess;
    }

    test("Not Recieved In Minutes fires once the window has elapsed", async () => {
      const result: string | null =
        await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildAgedRequest(45),
          criteriaFilter: {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.NotRecievedInMinutes,
            value: 30,
          },
        });

      expect(result).toBeTruthy();
    });

    test("Recieved In Minutes fires while the window is still open", async () => {
      const result: string | null =
        await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildAgedRequest(5),
          criteriaFilter: {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.RecievedInMinutes,
            value: 30,
          },
        });

      expect(result).toBeTruthy();
    });
  });
});
