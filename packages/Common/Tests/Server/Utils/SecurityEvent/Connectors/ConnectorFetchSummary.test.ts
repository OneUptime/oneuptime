import {
  ConnectorFetchFailureSummary,
  attachConnectorChecks,
  attachConnectorFetchSummary,
  readConnectorChecks,
  readConnectorFetchSummary,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { describe, expect, test } from "@jest/globals";

/*
 * attachConnectorFetchSummary / readConnectorFetchSummary: how a connector
 * that reads in passes hands what those passes gathered (warnings, request
 * and record counts, provider details) to the poller on the error it
 * throws. What is pinned is that the original error is never changed in
 * type or message, never gains an enumerable property, never turns into a
 * TypeError when it cannot take the property, and that the poller only
 * ever reads a well-formed summary back.
 */

const SUMMARY: ConnectorFetchFailureSummary = {
  warnings: [
    "Curated rule detections could not be read (HTTP 403); this tenant may not have curated rule access. Rule detections and the alerts view were still read.",
  ],
  requestCount: 3,
  fetchedCount: 2,
  details: {
    basis: "created-time",
    sourceCounts: { ruleDetections: 2, curatedDetections: 0, alertsView: 0 },
    includeNonAlertingDetections: false,
  },
};

const PROPERTY: string = "oneuptimeConnectorFetchSummary";

describe("attachConnectorFetchSummary and readConnectorFetchSummary", () => {
  test("a summary attached to an error reads back equal, and the error keeps its identity, type and message", () => {
    const original: APIException = new APIException(
      "Google SecOps alerts fetch failed (HTTP 500): internal",
    );

    const returned: APIException = attachConnectorFetchSummary(
      original,
      SUMMARY,
    );

    expect(returned).toBe(original);
    expect(returned).toBeInstanceOf(APIException);
    expect(returned.message).toBe(
      "Google SecOps alerts fetch failed (HTTP 500): internal",
    );
    expect(readConnectorFetchSummary(returned)).toEqual(SUMMARY);
  });

  test("the summary stays off the error's enumerable properties and out of its JSON", () => {
    const error: Error = attachConnectorFetchSummary(
      new Error("boom"),
      SUMMARY,
    );

    expect(Object.keys(error)).not.toContain(PROPERTY);
    expect(JSON.stringify({ ...error })).not.toContain("Curated");
  });

  test("a summary with no details reads back without a details key", () => {
    const error: Error = attachConnectorFetchSummary(new Error("boom"), {
      warnings: [],
      requestCount: 1,
      fetchedCount: 0,
    });

    const summary: ConnectorFetchFailureSummary | undefined =
      readConnectorFetchSummary(error);

    expect(summary).toEqual({ warnings: [], requestCount: 1, fetchedCount: 0 });
    expect(summary).not.toHaveProperty("details");
  });

  test("the read is a copy: appending to its warnings leaves what the error carries unchanged", () => {
    const error: Error = attachConnectorFetchSummary(new Error("boom"), {
      warnings: ["first"],
      requestCount: 1,
      fetchedCount: 0,
    });

    readConnectorFetchSummary(error)!.warnings.push("appended by a caller");

    expect(readConnectorFetchSummary(error)!.warnings).toEqual(["first"]);
  });

  test("checks and a summary ride on the same error independently", () => {
    const checks: Array<SecurityConnectorCheck> = [
      {
        key: "read-alerts-view",
        name: "Read alerts view by detection time",
        status: "fail",
        durationMs: 1,
        message: "boom",
      },
    ];
    const error: Error = attachConnectorFetchSummary(
      attachConnectorChecks(new Error("boom"), checks),
      SUMMARY,
    );

    expect(readConnectorChecks(error)).toEqual(checks);
    expect(readConnectorFetchSummary(error)).toEqual(SUMMARY);
  });

  test("an error that never had a summary reads undefined", () => {
    expect(readConnectorFetchSummary(new Error("boom"))).toBeUndefined();
    expect(
      readConnectorFetchSummary(attachConnectorChecks(new Error("boom"), [])),
    ).toBeUndefined();
  });

  test.each<[string, unknown]>([
    ["a string", "socket hang up"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["false", false],
  ])(
    "a thrown value that is %s is returned as it was and reads undefined",
    (_label: string, thrown: unknown) => {
      expect(attachConnectorFetchSummary(thrown, SUMMARY)).toBe(thrown);
      expect(readConnectorFetchSummary(thrown)).toBeUndefined();
    },
  );

  test("a frozen error cannot take the summary: attaching neither throws nor replaces the error, and reading finds nothing", () => {
    const original: Error = Object.freeze(new Error("frozen"));

    let returned: Error | undefined = undefined;
    expect(() => {
      returned = attachConnectorFetchSummary(original, SUMMARY);
    }).not.toThrow();

    expect(returned).toBe(original);
    expect(readConnectorFetchSummary(original)).toBeUndefined();
  });

  test("a non-extensible error is handled like a frozen one", () => {
    const original: Error = Object.preventExtensions(new Error("sealed"));

    expect(attachConnectorFetchSummary(original, SUMMARY)).toBe(original);
    expect(readConnectorFetchSummary(original)).toBeUndefined();
  });

  test.each<[string, Error]>([
    ["frozen", Object.freeze(new Error("frozen"))],
    ["non-extensible", Object.preventExtensions(new Error("sealed"))],
  ])(
    "attachConnectorChecks on a %s error neither throws nor replaces it, so the connector rethrows the original",
    (_label: string, original: Error) => {
      const checks: Array<SecurityConnectorCheck> = [
        {
          key: "read-rule-detections",
          name: "Read rule detections by created time",
          status: "fail",
          durationMs: 1,
          message: "boom",
        },
      ];

      let returned: Error | undefined = undefined;
      expect(() => {
        returned = attachConnectorChecks(original, checks);
      }).not.toThrow();

      expect(returned).toBe(original);
      expect(readConnectorChecks(original)).toBeUndefined();
    },
  );

  test.each<[string, unknown]>([
    ["null", null],
    ["a string", "summary"],
    ["an array", [SUMMARY]],
    [
      "warnings that are not an array",
      { warnings: "one warning", requestCount: 1, fetchedCount: 0 },
    ],
    ["no warnings", { requestCount: 1, fetchedCount: 0 }],
    ["no requestCount", { warnings: [], fetchedCount: 0 }],
    ["no fetchedCount", { warnings: [], requestCount: 1 }],
    [
      "a requestCount that is a string",
      { warnings: [], requestCount: "3", fetchedCount: 0 },
    ],
    [
      "a negative fetchedCount",
      { warnings: [], requestCount: 1, fetchedCount: -1 },
    ],
    [
      "a requestCount that is not a number",
      { warnings: [], requestCount: Number.NaN, fetchedCount: 0 },
    ],
    [
      "an infinite fetchedCount",
      {
        warnings: [],
        requestCount: 1,
        fetchedCount: Number.POSITIVE_INFINITY,
      },
    ],
  ])(
    "a stored summary with %s is ignored",
    (_label: string, stored: unknown) => {
      const error: Error = attachConnectorFetchSummary(
        new Error("boom"),
        stored as ConnectorFetchFailureSummary,
      );

      expect(readConnectorFetchSummary(error)).toBeUndefined();
    },
  );

  test("warnings that are not strings are dropped and the rest are kept in order", () => {
    const error: Error = attachConnectorFetchSummary(new Error("boom"), {
      warnings: ["first", 7, null, { text: "no" }, "second"],
      requestCount: 2,
      fetchedCount: 1,
    } as unknown as ConnectorFetchFailureSummary);

    expect(readConnectorFetchSummary(error)).toEqual({
      warnings: ["first", "second"],
      requestCount: 2,
      fetchedCount: 1,
    });
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["a string", "created-time"],
    ["an array", [{ basis: "created-time" }]],
    ["a number", 3],
  ])(
    "details that are %s are left out while the rest of the summary is kept",
    (_label: string, details: unknown) => {
      const error: Error = attachConnectorFetchSummary(new Error("boom"), {
        warnings: ["kept"],
        requestCount: 1,
        fetchedCount: 0,
        details: details as JSONObject,
      });

      const summary: ConnectorFetchFailureSummary | undefined =
        readConnectorFetchSummary(error);

      expect(summary).toEqual({
        warnings: ["kept"],
        requestCount: 1,
        fetchedCount: 0,
      });
      expect(summary).not.toHaveProperty("details");
    },
  );
});
