import { describe, expect, test } from "@jest/globals";
import {
  readLeakPlaceOfRow,
  readLeakPlaces,
  readOwnFrames,
  toLeakFilePath,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakPlaces";
import { TelemetrySampleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetrySampleSource";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  MAX_PLACES_PER_TELEMETRY_LEAK,
  TelemetryLeakPlace,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import { METRIC_NAME_LOCATION } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import { buildTelemetryLeakTemplate } from "../../../../../Utils/DataSecurity/TelemetryLeakTemplate";

/*
 * THE PLACE IN A SERVICE'S CODE EACH RECORD NAMES (#10367), FOR EACH SIGNAL.
 *
 * Read from the record's row as the locator selects it, and nothing else of
 * it: a span's or an AI call's code location and name; an exception's own
 * top frames, never a dependency's; a log line's code location, its logger
 * and its line as a template; a metric's name, unless the name holds the
 * data. A file is a repository path, its container's prefix taken off.
 */

const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

function templateOf(text: string): string {
  return buildTelemetryLeakTemplate(text, {
    nameOf: (dataTypeId: string): string => {
      return namer.nameOf(dataTypeId);
    },
  });
}

function placeOf(
  source: TelemetrySampleSource,
  row: JSONObject,
  location: string = "attributes.user.email",
): TelemetryLeakPlace | null {
  return readLeakPlaceOfRow({ source, row, location, templateOf });
}

describe("a file a record names", () => {
  test("is a repository path: a container's prefix and a file:// scheme taken off", () => {
    expect(toLeakFilePath("/usr/src/app/src/signup.js")).toBe("src/signup.js");
    expect(toLeakFilePath("/app/services/checkout/src/signup.ts")).toBe(
      "services/checkout/src/signup.ts",
    );
    expect(toLeakFilePath("file:///app/src/signup.js")).toBe("src/signup.js");
  });

  test("is no file of the service's own in a dependency, or without an extension", () => {
    expect(toLeakFilePath("/app/node_modules/pino/lib/proto.js")).toBe("");
    expect(toLeakFilePath("/app/bin/server")).toBe("");
    expect(toLeakFilePath("")).toBe("");
  });
});

describe("a span or an AI call", () => {
  test("its code location attributes, its function with its namespace, its scope and its name", () => {
    expect(
      placeOf(TelemetrySampleSource.Traces, {
        readFile1: "/usr/src/app/src/signup.js",
        readLine1: "10",
        readFunction1: "signUp",
        readNamespace: "Accounts",
        readScope: "checkout",
        readName: "POST /signup",
      }),
    ).toEqual({
      recordCount: 1,
      filePath: "src/signup.js",
      lineNumber: 10,
      functionName: "Accounts.signUp",
      scopeName: "checkout",
      spanName: "POST /signup",
    });
  });

  test("the newer attribute names when the older are absent; a line with no file is dropped", () => {
    expect(
      placeOf(TelemetrySampleSource.AiConversations, {
        readFile2: "/app/src/assistant.py",
        readLine2: "33",
        readFunction2: "answer",
        readName: "chat completion",
      }),
    ).toEqual({
      recordCount: 1,
      filePath: "src/assistant.py",
      lineNumber: 33,
      functionName: "answer",
      spanName: "chat completion",
    });
    expect(
      placeOf(TelemetrySampleSource.Traces, {
        readLine1: "10",
        readName: "POST /signup",
      }),
    ).toEqual({ recordCount: 1, spanName: "POST /signup" });
  });

  test("a span named with a value is named by its template", () => {
    const place: TelemetryLeakPlace | null = placeOf(
      TelemetrySampleSource.Traces,
      { readName: "lookup jane.doe@northwind-mail.com" },
    );

    expect(place?.spanName).toBeDefined();
    expect(place?.spanName).not.toContain("jane.doe");
  });
});

describe("an exception", () => {
  const FRAMES: string = JSON.stringify([
    {
      fileName: "/app/node_modules/stripe/lib/Error.js",
      functionName: "StripeError",
      lineNumber: 8,
      inApp: true,
    },
    {
      fileName: "/app/src/payments.js",
      functionName: "charge",
      lineNumber: 21,
      inApp: true,
    },
    {
      fileName: "/app/src/vendor-shim.js",
      functionName: "wrap",
      lineNumber: 3,
      inApp: false,
    },
    {
      fileName: "/app/src/index.js",
      functionName: "<anonymous>",
      lineNumber: 5,
      inApp: true,
    },
  ]);

  test("its own top frames, the first of them its place - never a dependency's", () => {
    expect(readOwnFrames({ readFrames: FRAMES })).toEqual([
      { filePath: "src/payments.js", functionName: "charge", lineNumber: 21 },
      { filePath: "src/index.js", lineNumber: 5 },
    ]);
    expect(
      placeOf(TelemetrySampleSource.Exceptions, {
        readFrames: FRAMES,
        readExceptionType: "PaymentError",
      }),
    ).toEqual({
      recordCount: 1,
      filePath: "src/payments.js",
      functionName: "charge",
      lineNumber: 21,
      frames: [
        { filePath: "src/payments.js", functionName: "charge", lineNumber: 21 },
        { filePath: "src/index.js", lineNumber: 5 },
      ],
      exceptionType: "PaymentError",
    });
  });

  test("a stack sent as text is parsed for its frames", () => {
    const frames: ReturnType<typeof readOwnFrames> = readOwnFrames({
      readStackTrace: [
        "Error: card declined",
        "    at charge (/app/src/payments.js:21:11)",
        "    at /app/node_modules/express/lib/router/layer.js:95:5",
      ].join("\n"),
    });

    expect(frames[0]).toEqual(
      expect.objectContaining({ filePath: "src/payments.js", lineNumber: 21 }),
    );
    expect(
      frames.some((frame: { filePath: string }): boolean => {
        return frame.filePath.includes("node_modules");
      }),
    ).toBe(false);
  });

  test("its message is a template only for a finding in the message, and never holds the value", () => {
    const row: JSONObject = {
      readFrames: FRAMES,
      readExceptionType: "PaymentError",
      readMessage: "Card declined for jane.doe@northwind-mail.com",
    };
    const inMessage: TelemetryLeakPlace | null = placeOf(
      TelemetrySampleSource.Exceptions,
      row,
      "message",
    );

    expect(inMessage?.template?.startsWith("Card declined for <")).toBe(true);
    expect(inMessage?.template).not.toContain("jane.doe");
    expect(
      placeOf(TelemetrySampleSource.Exceptions, row, "attributes.user.email")
        ?.template,
    ).toBeUndefined();
  });
});

describe("a log line", () => {
  test("its code location when it has one, its logger, and its line as a template", () => {
    const place: TelemetryLeakPlace | null = placeOf(
      TelemetrySampleSource.Logs,
      {
        readFile1: "/usr/src/app/src/signup.js",
        readLine1: "12",
        readFunction1: "signUp",
        readScope: "checkout",
        readBody: "User jane.doe@northwind-mail.com signed up",
      },
      "body",
    );

    expect(place).toEqual({
      recordCount: 1,
      filePath: "src/signup.js",
      lineNumber: 12,
      functionName: "signUp",
      scopeName: "checkout",
      template: `User <${namer.nameOf("email-address")}> signed up`,
    });
  });

  test("with no code attributes, its template and its logger are where the code is looked for", () => {
    expect(
      placeOf(
        TelemetrySampleSource.Logs,
        {
          readScope: "accounts",
          readBody: "Password reset sent to jane.doe@northwind-mail.com",
        },
        "body",
      ),
    ).toEqual({
      recordCount: 1,
      scopeName: "accounts",
      template: `Password reset sent to <${namer.nameOf("email-address")}>`,
    });
  });

  test("a record that names nothing the code can be found by is no place", () => {
    expect(
      placeOf(TelemetrySampleSource.Logs, { readScope: "accounts" }, "body"),
    ).toBeNull();
    expect(
      placeOf(TelemetrySampleSource.RumSessions, { readName: "x" }),
    ).toBeNull();
  });
});

describe("a metric", () => {
  test("its name, where the instrument is created", () => {
    expect(
      placeOf(TelemetrySampleSource.Metrics, {
        readMetricName: "checkout.orders.placed",
      }),
    ).toEqual({ recordCount: 1, metricName: "checkout.orders.placed" });
  });

  test("a name that holds the data is said as a template, never as it is", () => {
    const named: TelemetryLeakPlace | null = placeOf(
      TelemetrySampleSource.Metrics,
      { readMetricName: "logins.jane.doe@northwind-mail.com.count" },
    );

    expect(named?.metricName).toBeUndefined();
    expect(JSON.stringify(named)).not.toContain("jane.doe");

    const atTheName: TelemetryLeakPlace | null = placeOf(
      TelemetrySampleSource.Metrics,
      { readMetricName: "logins.count" },
      METRIC_NAME_LOCATION,
    );

    expect(atTheName?.metricName).toBeUndefined();
    expect(atTheName?.template).toBe("logins.count");
  });
});

describe("a leak's places", () => {
  test("each once, counted by its records, the most named first, one line's reads aligned", () => {
    const rows: Array<JSONObject> = [
      {
        readFile1: "/app/src/notify.js",
        readLine1: "7",
        readBody: "Welcome Mary to the shop",
      },
      {
        readFile1: "/app/src/notify.js",
        readLine1: "7",
        readBody: "Welcome Bob to the shop",
      },
      {
        readFile1: "/app/src/signup.js",
        readLine1: "12",
        readBody: "User jane.doe@northwind-mail.com signed up",
      },
    ];
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.Logs,
      rows,
      location: "body",
      templateOf,
    });

    expect(places).toHaveLength(2);
    expect(places[0]).toEqual({
      recordCount: 2,
      filePath: "src/notify.js",
      lineNumber: 7,
      template: "Welcome <value> to the shop",
    });
    expect(places[1]!.filePath).toBe("src/signup.js");
    expect(JSON.stringify(places)).not.toMatch(/Mary|Bob|jane\.doe/);
  });

  test("two lines of code alike are two places, never aligned together", () => {
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.Logs,
      rows: [
        { readFile1: "/app/src/a.js", readLine1: "1", readBody: "Saved order" },
        { readFile1: "/app/src/b.js", readLine1: "1", readBody: "Saved cart" },
      ],
      location: "body",
      templateOf,
    });

    expect(
      places.map((place: TelemetryLeakPlace) => {
        return place.template;
      }),
    ).toEqual(["Saved order", "Saved cart"]);
  });

  test("at most five", () => {
    expect(
      readLeakPlaces({
        source: TelemetrySampleSource.Traces,
        rows: Array.from({ length: 9 }, (_: unknown, index: number) => {
          return { readFile1: `/app/src/f${index}.js`, readLine1: "1" };
        }),
        location: "attributes.user.email",
        templateOf,
      }),
    ).toHaveLength(MAX_PLACES_PER_TELEMETRY_LEAK);
  });
});
