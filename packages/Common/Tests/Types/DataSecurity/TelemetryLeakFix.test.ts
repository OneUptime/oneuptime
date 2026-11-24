import { describe, expect, test } from "@jest/globals";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  MAX_CALL_SITE_PLACES,
  MAX_PLACES_PER_TELEMETRY_LEAK,
  MAX_TELEMETRY_LEAK_START_FILES,
  MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH,
  SERVICE_TELEMETRY_STORE_KINDS,
  TelemetryLeakFixDecision,
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
  decideTelemetryLeakFix,
  getTelemetryLeakFixFingerprint,
  getTelemetryLeakFixLane,
  getTelemetryLeakFixPlanKey,
  getTelemetryLeakPlaceKey,
  getTelemetryLeakPlaceKeys,
  getTelemetryLeakSignal,
  getTelemetryLeakStartFiles,
  readTelemetryLeakFixIssue,
  readTelemetryLeakFixLeak,
  readTelemetryLeakPlace,
  readTelemetryLeakTexts,
} from "../../../Types/DataSecurity/TelemetryLeakFix";

/*
 * HOW A SERVICE'S TELEMETRY LEAKS ARE FIXED IN ITS CODE (#10367).
 *
 * The decision the person is shown and the agent is handed: a leak written
 * in a handful of places is fixed where it is written; written in more -
 * or masked at ingest by a scrub rule already - it goes to one redaction
 * step. The places are counted once each, across the service; the files
 * the agent starts from are the ones the records name most; the plan's key
 * and fingerprint are the same every time for the same leaks.
 */

const SERVICE_ID: string = "5E000000-0000-4000-8000-000000000001";
const REPOSITORY_ID: string = "C0DE0000-0000-4000-8000-000000000001";

type Leak = Omit<TelemetryLeakFixLeak, "handling">;

function leak(data: Partial<Leak> & Pick<Leak, "places">): Leak {
  return {
    issueId: "15000000-0000-4000-8000-000000000101",
    dataStoreId: "51000000-0000-4000-8000-000000000101",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    signal: TelemetryLeakSignal.Spans,
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    isSecret: false,
    location: "attributes.user.email",
    key: "user.email",
    isMaskedByScrubRule: false,
    ...data,
  };
}

function at(
  file: string,
  line: number,
  recordCount: number = 1,
): TelemetryLeakPlace {
  return { filePath: file, lineNumber: line, recordCount };
}

describe("the signals a service's leaks are found in", () => {
  test("each of a service's telemetry stores, never a session replay's", () => {
    expect(
      SERVICE_TELEMETRY_STORE_KINDS.map((kind: DataStoreKind) => {
        return getTelemetryLeakSignal(kind);
      }),
    ).toEqual([
      TelemetryLeakSignal.Logs,
      TelemetryLeakSignal.Spans,
      TelemetryLeakSignal.Exceptions,
      TelemetryLeakSignal.AiCalls,
      TelemetryLeakSignal.Metrics,
    ]);
    expect(
      getTelemetryLeakSignal(DataStoreKind.TelemetrySessionReplays),
    ).toBeNull();
    expect(getTelemetryLeakSignal(DataStoreKind.Postgres)).toBeNull();
    expect(getTelemetryLeakSignal(undefined)).toBeNull();
  });
});

describe("what makes two places one", () => {
  test("the file and line, else the function", () => {
    expect(getTelemetryLeakPlaceKey(at("src/signup.js", 10))).toBe(
      "file:src/signup.js:10",
    );
    expect(
      getTelemetryLeakPlaceKey({
        filePath: "src/signup.js",
        functionName: "signUp",
        recordCount: 1,
      }),
    ).toBe("file:src/signup.js:signUp");
  });

  test("else the line's template, the span, the metric or the exception's type", () => {
    expect(
      getTelemetryLeakPlaceKey({
        template: "User <Email address> signed up",
        spanName: "ignored",
        recordCount: 1,
      }),
    ).toBe("template:User <Email address> signed up");
    expect(
      getTelemetryLeakPlaceKey({
        spanName: "POST /signup",
        scopeName: "checkout",
        recordCount: 1,
      }),
    ).toBe("span:checkout:POST /signup");
    expect(
      getTelemetryLeakPlaceKey({ metricName: "orders.placed", recordCount: 1 }),
    ).toBe("metric:orders.placed");
    expect(
      getTelemetryLeakPlaceKey({
        exceptionType: "PaymentError",
        recordCount: 1,
      }),
    ).toBe("exception:PaymentError");
    expect(
      getTelemetryLeakPlaceKey({ scopeName: "x", recordCount: 1 }),
    ).toBeNull();
  });

  test("a leak's places are counted once each; one whose records name none is one place, its key", () => {
    expect(
      getTelemetryLeakPlaceKeys(
        leak({
          places: [at("src/a.js", 1), at("src/a.js", 1), at("src/b.js", 2)],
        }),
      ),
    ).toEqual(["file:src/a.js:1", "file:src/b.js:2"]);
    expect(
      getTelemetryLeakPlaceKeys(leak({ places: [{ recordCount: 4 }] })),
    ).toEqual(["unplaced:Spans:attributes.user.email"]);
  });
});

describe("how the leaks are fixed", () => {
  test("the issue's first scenario: a span's and a log line's user.email, two places, each fixed where it is written", () => {
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix([
      leak({ places: [at("src/signup.js", 10, 2)] }),
      leak({
        issueId: "15000000-0000-4000-8000-000000000102",
        signal: TelemetryLeakSignal.Logs,
        location: "body",
        key: undefined,
        places: [
          {
            ...at("src/signup.js", 12, 2),
            template: "User <Email address> signed up",
          },
        ],
      }),
    ]);

    expect(decision.strategy).toBe(TelemetryLeakFixStrategy.CallSites);
    expect(decision.placeCount).toBe(2);
    expect(
      decision.leaks.map((each: TelemetryLeakFixLeak) => {
        return each.handling;
      }),
    ).toEqual([TelemetryLeakHandling.CallSite, TelemetryLeakHandling.CallSite]);
    expect(decision.redactionKeys).toEqual([]);
    expect(decision.redactionDataTypes).toEqual([]);
  });

  test("three places is still a handful; a fourth makes it one redaction step", () => {
    const three: Array<TelemetryLeakPlace> = [
      at("src/a.js", 1),
      at("src/b.js", 1),
      at("src/c.js", 1),
    ];

    expect(MAX_CALL_SITE_PLACES).toBe(3);
    expect(decideTelemetryLeakFix([leak({ places: three })]).strategy).toBe(
      TelemetryLeakFixStrategy.CallSites,
    );
    expect(
      decideTelemetryLeakFix([
        leak({ places: three }),
        leak({ places: [at("src/d.js", 1)] }),
      ]).strategy,
    ).toBe(TelemetryLeakFixStrategy.RedactionStep);
  });

  test("the issue's second scenario: customer.email in twenty places is one redaction step for its key, not twenty edits", () => {
    const places: Array<TelemetryLeakPlace> = Array.from(
      { length: 20 },
      (_: unknown, index: number): TelemetryLeakPlace => {
        return at(`src/handlers/step${index + 1}.js`, 10);
      },
    );
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix([
      leak({
        location: "attributes.customer.email",
        key: "customer.email",
        places: places.slice(0, 10),
      }),
      leak({
        issueId: "15000000-0000-4000-8000-000000000102",
        signal: TelemetryLeakSignal.Logs,
        location: "attributes.customer.email",
        key: "customer.email",
        places: places.slice(10),
      }),
    ]);

    expect(decision.strategy).toBe(TelemetryLeakFixStrategy.RedactionStep);
    expect(decision.placeCount).toBe(20);
    expect(decision.redactionKeys).toEqual(["customer.email"]);
    expect(
      decision.leaks.every((each: TelemetryLeakFixLeak): boolean => {
        return each.handling === TelemetryLeakHandling.RedactionStep;
      }),
    ).toBe(true);
  });

  test("a leak a scrub rule masks at ingest always goes to the redaction step, beside the few fixed where they are written", () => {
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix([
      leak({ places: [at("src/signup.js", 10)] }),
      leak({
        location: "attributes.http.request.header.authorization",
        key: "http.request.header.authorization",
        dataTypeId: "bearer-token",
        dataTypeName: "Bearer token",
        isSecret: true,
        isMaskedByScrubRule: true,
        places: [at("src/http.js", 3), at("src/http.js", 9)],
      }),
    ]);

    expect(decision.strategy).toBe(
      TelemetryLeakFixStrategy.CallSitesAndRedactionStep,
    );
    // Only what ingest does not mask is counted.
    expect(decision.placeCount).toBe(1);
    expect(decision.redactionKeys).toEqual([
      "http.request.header.authorization",
    ]);
    expect(
      decision.leaks.map((each: TelemetryLeakFixLeak) => {
        return each.handling;
      }),
    ).toEqual([
      TelemetryLeakHandling.CallSite,
      TelemetryLeakHandling.RedactionStep,
    ]);
  });

  test("every leak masked at ingest: one redaction step, and nothing counted", () => {
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix([
      leak({ isMaskedByScrubRule: true, places: [at("src/signup.js", 10)] }),
    ]);

    expect(decision.strategy).toBe(TelemetryLeakFixStrategy.RedactionStep);
    expect(decision.placeCount).toBe(0);
  });

  test("a leak in a log line with no key is masked by its data type", () => {
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix([
      leak({
        signal: TelemetryLeakSignal.Logs,
        location: "body",
        key: undefined,
        isMaskedByScrubRule: true,
        places: [
          { template: "User <Email address> signed up", recordCount: 3 },
        ],
      }),
    ]);

    expect(decision.redactionKeys).toEqual([]);
    expect(decision.redactionDataTypes).toEqual(["Email address"]);
  });

  test("the same leaks make the same decision every time", () => {
    const leaks: Array<Leak> = [
      leak({ places: [at("src/a.js", 1)] }),
      leak({ places: [at("src/b.js", 2)] }),
    ];

    expect(decideTelemetryLeakFix(leaks)).toEqual(
      decideTelemetryLeakFix(leaks),
    );
  });
});

describe("the files OneUptime AI starts from", () => {
  test("the files the records name most first, then in the order the leaks list them, at most ten", () => {
    expect(
      getTelemetryLeakStartFiles([
        { places: [at("src/a.js", 1, 1), at("src/b.js", 1, 5)] },
        { places: [at("src/c.js", 1, 1), at("src/a.js", 2, 1)] },
        { places: [{ template: "no file", recordCount: 9 }] },
      ]),
    ).toEqual(["src/b.js", "src/a.js", "src/c.js"]);

    expect(MAX_TELEMETRY_LEAK_START_FILES).toBe(10);
    expect(
      getTelemetryLeakStartFiles([
        {
          places: Array.from({ length: 15 }, (_: unknown, index: number) => {
            return at(`src/f${index}.js`, 1);
          }),
        },
      ]),
    ).toHaveLength(10);
  });
});

describe("the plan's lane, key and fingerprint", () => {
  const decided: Array<TelemetryLeakFixLeak> = decideTelemetryLeakFix([
    leak({ places: [at("src/signup.js", 10)] }),
  ]).leaks;

  test("a lane is one service in one repository, written in lower case", () => {
    expect(
      getTelemetryLeakFixLane({
        serviceId: SERVICE_ID,
        repositoryId: REPOSITORY_ID,
      }),
    ).toBe(`tleak-${SERVICE_ID.toLowerCase()}-${REPOSITORY_ID.toLowerCase()}`);
    expect(getTelemetryLeakFixLane({ serviceId: SERVICE_ID })).toBe(
      `tleak-${SERVICE_ID.toLowerCase()}-none`,
    );
  });

  test("the plan key is its lane and what it fixes, at most 100 characters, the same for the same leaks in any order", () => {
    const two: Array<TelemetryLeakFixLeak> = decideTelemetryLeakFix([
      leak({ places: [at("src/a.js", 1)] }),
      leak({
        issueId: "15000000-0000-4000-8000-000000000102",
        location: "body",
        places: [at("src/b.js", 1)],
      }),
    ]).leaks;
    const key: string = getTelemetryLeakFixPlanKey({
      serviceId: SERVICE_ID,
      repositoryId: REPOSITORY_ID,
      leaks: two,
    });

    expect(
      key.startsWith(
        `${getTelemetryLeakFixLane({ serviceId: SERVICE_ID, repositoryId: REPOSITORY_ID })}:`,
      ),
    ).toBe(true);
    expect(key.length).toBeLessThanOrEqual(100);
    expect(
      getTelemetryLeakFixPlanKey({
        serviceId: SERVICE_ID,
        repositoryId: REPOSITORY_ID,
        leaks: [...two].reverse(),
      }),
    ).toBe(key);
    expect(
      getTelemetryLeakFixPlanKey({
        serviceId: SERVICE_ID,
        repositoryId: REPOSITORY_ID,
        leaks: two.slice(0, 1),
      }),
    ).not.toBe(key);
  });

  test("the fingerprint changes when what the person was shown changes, and only then", () => {
    const plan: Parameters<typeof getTelemetryLeakFixFingerprint>[0] = {
      serviceId: SERVICE_ID,
      repositoryId: REPOSITORY_ID,
      strategy: TelemetryLeakFixStrategy.CallSites,
      leaks: decided,
      startFiles: ["src/signup.js"],
    };
    const fingerprint: string = getTelemetryLeakFixFingerprint(plan);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(
      getTelemetryLeakFixFingerprint({
        ...plan,
        serviceId: SERVICE_ID.toLowerCase(),
      }),
    ).toBe(fingerprint);
    expect(
      getTelemetryLeakFixFingerprint({ ...plan, repositoryId: null }),
    ).not.toBe(fingerprint);
    expect(
      getTelemetryLeakFixFingerprint({
        ...plan,
        leaks: [
          {
            ...decided[0]!,
            places: [at("src/signup.js", 11)],
          },
        ],
      }),
    ).not.toBe(fingerprint);
    expect(
      getTelemetryLeakFixFingerprint({
        ...plan,
        strategy: TelemetryLeakFixStrategy.RedactionStep,
      }),
    ).not.toBe(fingerprint);
  });
});

describe("reading what was sent back", () => {
  test("a place is read field by field, a text held to its length, an unnamed place left out", () => {
    expect(
      readTelemetryLeakPlace({
        filePath: " src/signup.js ",
        lineNumber: 10,
        functionName: 7,
        template: "x".repeat(1000),
        recordCount: 2,
      }),
    ).toEqual({
      filePath: "src/signup.js",
      lineNumber: 10,
      template: "x".repeat(MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH),
      recordCount: 2,
    });
    expect(
      readTelemetryLeakPlace({ lineNumber: -1, recordCount: 2 }),
    ).toBeNull();
    expect(readTelemetryLeakPlace("src/signup.js")).toBeNull();
    expect(
      readTelemetryLeakPlace({
        filePath: "a.js",
        lineNumber: 1.5,
        recordCount: -3,
      }),
    ).toEqual({ filePath: "a.js", recordCount: 0 });
  });

  test("an exception's frames are read with it, at most three", () => {
    expect(
      readTelemetryLeakPlace({
        filePath: "src/pay.js",
        exceptionType: "PaymentError",
        frames: [
          { filePath: "src/pay.js", lineNumber: 7, functionName: "charge" },
          { filePath: "src/b.js" },
          { filePath: "" },
          { filePath: "src/c.js" },
          { filePath: "src/d.js" },
        ],
        recordCount: 1,
      })?.frames,
    ).toEqual([
      { filePath: "src/pay.js", lineNumber: 7, functionName: "charge" },
      { filePath: "src/b.js" },
      { filePath: "src/c.js" },
    ]);
  });

  test("a leak needs its issue, data type, location, signal and handling; its places are held to five", () => {
    const read: TelemetryLeakFixLeak | null = readTelemetryLeakFixLeak({
      issueId: "15000000-0000-4000-8000-000000000101",
      dataStoreId: "51000000-0000-4000-8000-000000000101",
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      signal: TelemetryLeakSignal.Spans,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      key: "user.email",
      handling: TelemetryLeakHandling.CallSite,
      isSecret: "yes",
      places: Array.from({ length: 8 }, (_: unknown, index: number) => {
        return at(`src/f${index}.js`, 1);
      }),
    });

    expect(read?.places).toHaveLength(MAX_PLACES_PER_TELEMETRY_LEAK);
    // A field of the wrong type is no field.
    expect(read?.isSecret).toBe(false);
    expect(read?.dataTypeName).toBe("email-address");
    expect(
      readTelemetryLeakFixLeak({
        issueId: "x",
        dataTypeId: "email-address",
        location: "body",
        signal: "Carrier pigeon",
        handling: TelemetryLeakHandling.CallSite,
      }),
    ).toBeNull();
    expect(
      readTelemetryLeakFixLeak({
        issueId: "x",
        dataTypeId: "email-address",
        location: "body",
        signal: TelemetryLeakSignal.Logs,
        handling: "Rewrite everything",
      }),
    ).toBeNull();
  });

  test("an issue's link is kept only as a web address", () => {
    expect(
      readTelemetryLeakFixIssue({
        issueId: "15000000-0000-4000-8000-000000000101",
        signal: TelemetryLeakSignal.Logs,
        issueUrl: "javascript:alert(1)",
      }),
    ).toEqual({
      issueId: "15000000-0000-4000-8000-000000000101",
      title: "Sensitive data in telemetry",
      checkId: "",
      signal: TelemetryLeakSignal.Logs,
    });
    expect(
      readTelemetryLeakFixIssue({
        issueId: "15000000-0000-4000-8000-000000000101",
        signal: TelemetryLeakSignal.Logs,
        issueUrl:
          "https://oneuptime.example/dashboard/p/data-security/issues/1",
      })?.issueUrl,
    ).toBe("https://oneuptime.example/dashboard/p/data-security/issues/1");
  });

  test("a list of texts leaves out the empty and the repeated, and stops at its limit", () => {
    expect(
      readTelemetryLeakTexts([" a ", "a", "", 3, "b", "c"], 2, 10),
    ).toEqual(["a", "b"]);
    expect(readTelemetryLeakTexts("a", 2, 10)).toEqual([]);
  });
});
