import IncomingRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import OneUptimeDate from "../../../../../Types/Date";
import Dictionary from "../../../../../Types/Dictionary";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * CheckOn.RequestHeader and CheckOn.RequestHeaderValue on an Incoming
 * Request monitor: "the ping must carry x-api-key", "the ping must NOT
 * carry a header saying maintenance".
 *
 * Both are whole-token comparisons against the header map - a header is
 * present or it is not - and both are case-insensitive on BOTH sides, which
 * is the half that used to be missing: a filter typed the way HTTP headers
 * are written ("X-Api-Key") was compared against a list that had already
 * been lower-cased, so Contains never fired and NotContains fired on every
 * request.
 */

function buildRequest(headers: Dictionary<string> | undefined): DataToProcess {
  const now: Date = OneUptimeDate.getCurrentDate();

  const request: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    requestBody: "",
    requestHeaders: headers,
    incomingRequestReceivedAt: now,
    checkedAt: now,
  };

  return request as DataToProcess;
}

function evaluate(
  headers: Dictionary<string> | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildRequest(headers),
    criteriaFilter,
  });
}

function headerFilter(
  filterType: FilterType,
  value: string | undefined,
): CriteriaFilter {
  return { checkOn: CheckOn.RequestHeader, filterType, value };
}

function headerValueFilter(
  filterType: FilterType,
  value: string | undefined,
): CriteriaFilter {
  return { checkOn: CheckOn.RequestHeaderValue, filterType, value };
}

const HEADERS: Dictionary<string> = {
  "X-Api-Key": "SecretToken",
  "content-type": "application/json",
};

describe("IncomingRequestCriteria - CheckOn.RequestHeader", () => {
  describe("Contains", () => {
    test("a header the request carries matches, however either side is cased", async () => {
      for (const typed of ["x-api-key", "X-Api-Key", "X-API-KEY"]) {
        expect(
          await evaluate(HEADERS, headerFilter(FilterType.Contains, typed)),
        ).toContain("Request header contains");
      }
    });

    test("the message quotes the filter as it was typed, not as it was compared", async () => {
      expect(
        await evaluate(HEADERS, headerFilter(FilterType.Contains, "X-Api-Key")),
      ).toBe("Request header contains X-Api-Key.");
    });

    test("a header the request does not carry does not match", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerFilter(FilterType.Contains, "authorization"),
        ),
      ).toBeNull();
    });

    test("a prefix of a header name does not match: this compares whole names", async () => {
      expect(
        await evaluate(HEADERS, headerFilter(FilterType.Contains, "x-api")),
      ).toBeNull();
    });

    test("a request with no headers at all matches nothing", async () => {
      expect(
        await evaluate(
          undefined,
          headerFilter(FilterType.Contains, "x-api-key"),
        ),
      ).toBeNull();
      expect(
        await evaluate({}, headerFilter(FilterType.Contains, "x-api-key")),
      ).toBeNull();
    });

    test("a filter with no value cannot decide, so it does not match", async () => {
      expect(
        await evaluate(HEADERS, headerFilter(FilterType.Contains, undefined)),
      ).toBeNull();
      expect(
        await evaluate(HEADERS, headerFilter(FilterType.Contains, "")),
      ).toBeNull();
    });
  });

  describe("Not Contains", () => {
    test("a header the request does not carry matches", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerFilter(FilterType.NotContains, "authorization"),
        ),
      ).toContain("Request header does not contain");
    });

    test("a header the request DOES carry does not match, whatever its casing", async () => {
      for (const typed of ["x-api-key", "X-Api-Key", "X-API-KEY"]) {
        expect(
          await evaluate(HEADERS, headerFilter(FilterType.NotContains, typed)),
        ).toBeNull();
      }
    });

    test("Contains and Not Contains never agree on the same header", async () => {
      for (const name of ["X-Api-Key", "authorization", "content-type"]) {
        const contains: string | null = await evaluate(
          HEADERS,
          headerFilter(FilterType.Contains, name),
        );
        const notContains: string | null = await evaluate(
          HEADERS,
          headerFilter(FilterType.NotContains, name),
        );

        expect(Boolean(contains)).not.toBe(Boolean(notContains));
      }
    });
  });

  test("a filter type this check does not support does not match", async () => {
    expect(
      await evaluate(HEADERS, headerFilter(FilterType.EqualTo, "x-api-key")),
    ).toBeNull();
  });
});

describe("IncomingRequestCriteria - CheckOn.RequestHeaderValue", () => {
  describe("Contains", () => {
    test("a value the request carries matches, however either side is cased", async () => {
      for (const typed of ["secrettoken", "SecretToken", "SECRETTOKEN"]) {
        expect(
          await evaluate(
            HEADERS,
            headerValueFilter(FilterType.Contains, typed),
          ),
        ).toContain("Request header value contains");
      }
    });

    test("a value no header carries does not match", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerValueFilter(FilterType.Contains, "text/html"),
        ),
      ).toBeNull();
    });

    test("a substring of a value does not match: this compares whole values", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerValueFilter(FilterType.Contains, "secret"),
        ),
      ).toBeNull();
    });

    test("a request with no headers at all matches nothing", async () => {
      expect(
        await evaluate(
          undefined,
          headerValueFilter(FilterType.Contains, "secrettoken"),
        ),
      ).toBeNull();
    });
  });

  describe("Not Contains", () => {
    test("a value no header carries matches", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerValueFilter(FilterType.NotContains, "text/html"),
        ),
      ).toContain("Request header value does not contain");
    });

    test("a value a header DOES carry does not match, whatever its casing", async () => {
      for (const typed of ["secrettoken", "SecretToken"]) {
        expect(
          await evaluate(
            HEADERS,
            headerValueFilter(FilterType.NotContains, typed),
          ),
        ).toBeNull();
      }
    });

    test("a filter with no value cannot decide, so it does not match", async () => {
      expect(
        await evaluate(
          HEADERS,
          headerValueFilter(FilterType.NotContains, undefined),
        ),
      ).toBeNull();
    });
  });
});
