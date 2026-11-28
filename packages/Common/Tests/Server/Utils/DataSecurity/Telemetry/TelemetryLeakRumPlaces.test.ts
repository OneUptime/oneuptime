import { describe, expect, test } from "@jest/globals";
import {
  MAX_RUM_FRAMES_RESOLVED,
  MAX_RUM_STACKS_RESOLVED,
  RUM_IDENTIFY_CALL,
  readLeakPlaces,
  readMinifiedFrames,
  readResolvedFrames,
  readRumPage,
  resolveRumStacks,
  toOwnResolvedFrames,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakPlaces";
import { buildLeakRecordStatement } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakLocator";
import { TelemetrySampleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetrySampleSource";
import SourceMapResolver from "../../../../../Server/Utils/Telemetry/SourceMapResolver";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakPlace,
  getTelemetryLeakPlaceKey,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "../../../../../Types/Telemetry/SourceMap";
import { buildTelemetryLeakTemplate } from "../../../../../Utils/DataSecurity/TelemetryLeakTemplate";

/*
 * WHERE A RUM APPLICATION'S FRONT-END CODE WRITES A LEAK (#10933), from the
 * records it was seen in: a browser log's or span's code location, its
 * JavaScript stack resolved through the application's source maps to the
 * original files, its line or its name as a template, and the page it was
 * written on - the path the URL scrubber keeps, as a template. A session's
 * user details name the session recorder call that gave them. Never a
 * value, never the page's host, query or an identifier in its path, and
 * never a recording: the read selects no replay.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9e9e9e9e-0000-4000-8000-000000000001",
);
const APP_ID: string = "9e9e9e9e-0000-4000-8000-000000000002";
const EMAIL: string = "ada.l@example.com";

const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

function templateOf(text: string): string {
  return buildTelemetryLeakTemplate(text, {
    nameOf: (dataTypeId: string): string => {
      return namer.nameOf(dataTypeId);
    },
  });
}

// The base64 digits of a source map's numbers: each fits one digit here.
const VLQ_DIGITS: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// A map whose bundle's first line, first column is `file`'s `line` (1-based), in `name`.
function sourceMap(file: string, line: number, name: string): string {
  return JSON.stringify({
    version: 3,
    file: "app.js",
    sources: [file],
    names: [name],
    mappings: [0, 0, line - 1, 2, 0]
      .map((value: number): string => {
        return VLQ_DIGITS.charAt(value * 2);
      })
      .join(""),
  });
}

const STACK: string = [
  "Error: Payment declined",
  "    at pay (https://shop.example.com/assets/app.3f9c1e.js:1:1)",
].join("\n");

function resolverOf(
  maps: Array<{ bundlePath: string; content: string }>,
): (data: {
  frames: Array<MinifiedStackFrame>;
}) => Promise<Array<ResolvedStackFrame>> {
  return async (data: {
    frames: Array<MinifiedStackFrame>;
  }): Promise<Array<ResolvedStackFrame>> => {
    return SourceMapResolver.resolveFrames(data.frames, maps);
  };
}

describe("the page a RUM record was written on", () => {
  test("its path alone, identifiers masked, then as a template: no host, no query, no fragment", () => {
    const page: string = readRumPage(
      {
        readUrlFull: `https://shop.example.com/account/${EMAIL}/orders/4f6d1c2a-7b8e-4f9a-b0c1-d2e3f4a5b6c7?coupon=SPRING10#reviews`,
      },
      templateOf,
    );

    expect(page.startsWith("/account/")).toBe(true);
    expect(page).not.toContain(EMAIL);
    expect(page).not.toContain("SPRING10");
    expect(page).not.toContain("shop.example.com");
    expect(page).not.toContain("4f6d1c2a");
    expect(page).not.toContain("#reviews");
  });

  test("a hash router's route is the page", () => {
    expect(
      readRumPage(
        { readUrlFull: "https://admin.example.com/#/settings/billing" },
        templateOf,
      ),
    ).toBe("/#/settings/billing");
  });

  test("url.path first, else url.full, http.url or a session's entry page", () => {
    expect(
      readRumPage(
        {
          readUrlPath: "/checkout/pay",
          readUrlFull: "https://shop.example.com/cart",
        },
        templateOf,
      ),
    ).toBe("/checkout/pay");
    expect(
      readRumPage({ readHttpUrl: "https://shop.example.com/cart" }, templateOf),
    ).toBe("/cart");
    expect(
      readRumPage(
        { readPage: "https://shop.example.com/account/settings?tab=billing" },
        templateOf,
      ),
    ).toBe("/account/settings");
  });

  test("a record that names no page has none", () => {
    expect(readRumPage({}, templateOf)).toBe("");
    expect(readRumPage({ readUrlFull: "not a url" }, templateOf)).toBe("");
  });
});

describe("a RUM record's JavaScript stack, through the application's source maps", () => {
  test("the minified frames the maps are asked for, at most MAX_RUM_FRAMES_RESOLVED", () => {
    expect(readMinifiedFrames(STACK)).toEqual([
      expect.objectContaining({
        functionName: "pay",
        fileName: "https://shop.example.com/assets/app.3f9c1e.js",
        lineNumber: 1,
      }),
    ]);
    expect(readMinifiedFrames("")).toEqual([]);

    const deep: string = [
      "Error: deep",
      ...Array.from(
        { length: MAX_RUM_FRAMES_RESOLVED + 5 },
        (_: unknown, index: number) => {
          return `    at f${index} (https://shop.example.com/assets/app.js:1:${index + 1})`;
        },
      ),
    ].join("\n");

    expect(readMinifiedFrames(deep)).toHaveLength(MAX_RUM_FRAMES_RESOLVED);
  });

  test("frames resolved to the application's own original files are kept; a dependency's and an unresolved bundle's are not", () => {
    expect(
      toOwnResolvedFrames([
        {
          functionName: "e",
          fileName: "https://shop.example.com/assets/app.js",
          lineNumber: 1,
          inApp: true,
          resolved: true,
          originalFileName: "webpack://shop/./src/checkout/payment.js",
          originalLineNumber: 8,
          originalFunctionName: "pay",
        },
        {
          functionName: "r",
          fileName: "https://shop.example.com/assets/vendor.js",
          lineNumber: 1,
          inApp: false,
          resolved: true,
          originalFileName: "node_modules/react-dom/cjs/react-dom.js",
          originalLineNumber: 3001,
        },
        {
          functionName: "t",
          fileName: "https://shop.example.com/assets/app.js",
          lineNumber: 1,
          inApp: true,
          resolved: false,
        },
      ]),
    ).toEqual([
      {
        filePath: "src/checkout/payment.js",
        functionName: "pay",
        lineNumber: 8,
      },
    ]);
  });

  test("resolved through a recorded map, the record names the original file, line and function - and its stack text is dropped", async () => {
    const rows: Array<JSONObject> = [
      {
        readStackTrace: STACK,
        readServiceVersion: "web-1.4.2",
      },
    ];

    await resolveRumStacks({
      rows,
      resolve: resolverOf([
        {
          bundlePath: "assets/app.3f9c1e.js",
          content: sourceMap(
            "webpack://storefront-web/./src/checkout/payment.js",
            8,
            "pay",
          ),
        },
      ]),
    });

    expect(rows[0]!["readStackTrace"]).toBeUndefined();
    expect(readResolvedFrames(rows[0]!)).toEqual([
      {
        filePath: "src/checkout/payment.js",
        functionName: "pay",
        lineNumber: 8,
      },
    ]);
  });

  test("no map for the bundle, or no release named: the stack names no file", async () => {
    const rows: Array<JSONObject> = [
      { readStackTrace: STACK, readServiceVersion: "web-1.4.2" },
      { readStackTrace: STACK },
    ];

    await resolveRumStacks({ rows, resolve: resolverOf([]) });

    expect(rows.map(readResolvedFrames)).toEqual([[], []]);
    expect(rows[1]!["readStackTrace"]).toBeUndefined();
  });

  test("maps that cannot be read resolve nothing, and never fail the place", async () => {
    const rows: Array<JSONObject> = [
      { readStackTrace: STACK, readServiceVersion: "web-1.4.2" },
    ];

    await resolveRumStacks({
      rows,
      resolve: async (): Promise<Array<ResolvedStackFrame>> => {
        throw new Error("the maps' storage is down");
      },
    });

    expect(readResolvedFrames(rows[0]!)).toEqual([]);
  });

  test("each stack resolved once, and at most MAX_RUM_STACKS_RESOLVED of a finding's", async () => {
    let asked: number = 0;
    const rows: Array<JSONObject> = [
      ...Array.from({ length: 3 }, () => {
        return { readStackTrace: STACK, readServiceVersion: "web-1.4.2" };
      }),
      ...Array.from(
        { length: MAX_RUM_STACKS_RESOLVED + 2 },
        (_: unknown, index: number) => {
          return {
            readStackTrace: `Error: other\n    at f (https://shop.example.com/assets/app.js:1:${index + 2})`,
            readServiceVersion: "web-1.4.2",
          };
        },
      ),
    ];

    await resolveRumStacks({
      rows,
      resolve: async (): Promise<Array<ResolvedStackFrame>> => {
        asked++;
        return [];
      },
    });

    expect(asked).toBe(MAX_RUM_STACKS_RESOLVED);
  });
});

describe("the place a RUM record names", () => {
  test("a browser log: its resolved file and line first, its line as a template, and its page", () => {
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumLogs,
      rows: [
        {
          readBody: `Payment declined for ${EMAIL}`,
          readUrlFull: `https://shop.example.com/checkout/${EMAIL}/pay?coupon=SPRING10`,
          readResolvedFrames: [
            {
              filePath: "src/checkout/payment.js",
              functionName: "pay",
              lineNumber: 8,
            },
          ],
        },
      ],
      location: "logs.attributes.user.email",
      templateOf,
    });

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      filePath: "src/checkout/payment.js",
      functionName: "pay",
      lineNumber: 8,
      frames: [
        {
          filePath: "src/checkout/payment.js",
          functionName: "pay",
          lineNumber: 8,
        },
      ],
      recordCount: 1,
    });
    expect(places[0]!.template).toContain("Payment declined for");
    expect(places[0]!.page!.startsWith("/checkout/")).toBe(true);
    expect(JSON.stringify(places)).not.toContain(EMAIL);
    expect(JSON.stringify(places)).not.toContain("SPRING10");
  });

  test("a browser span: its code attributes, its name as a template and its page", () => {
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumSpans,
      rows: [
        {
          readFile1: "webpack://storefront/./src/search/SearchBox.tsx",
          readLine1: "42",
          readFunction1: "submit",
          readName: "search.submit",
          readUrlPath: "/search",
        },
      ],
      location: "spans.attributes.user.email",
      templateOf,
    });

    expect(places[0]).toMatchObject({
      spanName: "search.submit",
      functionName: "submit",
      page: "/search",
    });
    expect(places[0]!.filePath).toContain("src/search/SearchBox.tsx");
  });

  test("a session's user details: the session recorder's identify() call, and the page it started on", () => {
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumSessions,
      rows: [
        {
          readSessionId: "s-1",
          readPage: `https://shop.example.com/account/${EMAIL}/settings?tab=billing`,
        },
        { readSessionId: "s-2", readPage: "https://shop.example.com/cart" },
      ],
      location: "sessions.identifiedUserLabel",
      templateOf,
    });

    expect(
      places.map((place: TelemetryLeakPlace): JSONObject => {
        return {
          recorderCall: place.recorderCall || "",
          isAccount: Boolean(place.page?.startsWith("/account/")),
        };
      }),
    ).toEqual(
      expect.arrayContaining([
        { recorderCall: RUM_IDENTIFY_CALL, isAccount: true },
        { recorderCall: RUM_IDENTIFY_CALL, isAccount: false },
      ]),
    );
    expect(JSON.stringify(places)).not.toContain(EMAIL);
  });

  test("read from one record, a name no detector names is masked in its line, its span's name and its page (#11098)", () => {
    const logs: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumLogs,
      rows: [
        {
          readBody: "Payment declined for Ada Lovelace",
          readUrlFull:
            "https://shop.example.com/profile/ada-lovelace/settings?tab=billing",
          readResolvedFrames: [
            {
              filePath: "src/checkout/payment.js",
              functionName: "pay",
              lineNumber: 8,
            },
          ],
        },
      ],
      location: "logs.attributes.user.email",
      templateOf,
    });
    const spans: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumSpans,
      rows: [
        {
          readName: "load profile of Grace Hopper",
          readUrlPath: "/profile/grace-hopper",
        },
      ],
      location: "spans.attributes.user.email",
      templateOf,
    });

    expect(logs[0]).toMatchObject({
      template: "Payment declined for <value>",
      page: "/profile/<value>/settings",
    });
    expect(spans[0]).toMatchObject({
      spanName: "load profile of <value>",
      page: "/profile/<value>",
    });
    expect(JSON.stringify([...logs, ...spans])).not.toMatch(
      /Ada|Lovelace|lovelace|Grace|Hopper|hopper/,
    );
  });

  /*
   * #11204: the browser logs of one line of the front end - its source
   * maps resolve each to the same file and line - aligned with different
   * words, a lower-case value every one holds: one user's session clicking
   * through the shop. A word they share is no more the code's than one
   * record's word is, so it is masked; the file and line say where.
   */
  test("read from several records of one line, a value they all share is masked too (#11204)", () => {
    const rows: Array<JSONObject> = ["cart", "wishlist", "orders"].map(
      (tab: string): JSONObject => {
        return {
          readBody: `Opened ${tab} for jdoe from the header`,
          readUrlFull: `https://shop.example.com/account/${tab}`,
          readResolvedFrames: [
            {
              filePath: "src/account/tabs.js",
              functionName: "open",
              lineNumber: 21,
            },
          ],
        };
      },
    );
    const places: Array<TelemetryLeakPlace> = readLeakPlaces({
      source: TelemetrySampleSource.RumLogs,
      rows,
      location: "logs.attributes.user.email",
      templateOf,
    });

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      filePath: "src/account/tabs.js",
      lineNumber: 21,
      recordCount: 3,
      template: "Opened <value> for <value> from the header",
    });
    expect(JSON.stringify(places)).not.toContain("jdoe");
  });

  test("a place's key: its file, then its template, its span - else the recorder call and the page, else the page", () => {
    expect(
      getTelemetryLeakPlaceKey({
        recordCount: 1,
        recorderCall: "identify",
        page: "/account",
      }),
    ).toBe("recorder:identify:/account");
    expect(getTelemetryLeakPlaceKey({ recordCount: 1, page: "/cart" })).toBe(
      "page:/cart",
    );
    expect(
      getTelemetryLeakPlaceKey({
        recordCount: 1,
        page: "/cart",
        template: "Added <Email address>",
      }),
    ).toBe("template:Added <Email address>");
  });
});

describe("what the locator reads of a RUM record", () => {
  const RECORD: { time: string; logId: string; sessionId: string } = {
    time: "2026-11-20T10:00:00.000Z",
    logId: "a1b2c3d4-0000-4000-8000-000000000001",
    sessionId: "s-7f3c",
  };

  function queryOf(source: TelemetrySampleSource): string {
    return buildLeakRecordStatement({
      projectId: PROJECT_ID,
      read: { source },
      ownerId: APP_ID,
      records: [RECORD as never],
    }).query;
  }

  test("a browser log: its code attributes, its line, its page's addresses, its stack and its release", () => {
    const query: string = queryOf(TelemetrySampleSource.RumLogs);

    for (const alias of [
      "readFile1",
      "readBody",
      "readUrlPath",
      "readUrlFull",
      "readHttpUrl",
      "readStackTrace",
      "readServiceVersion",
    ]) {
      expect(query).toContain(`AS ${alias}`);
    }
  });

  test("a browser span: its name instead of a line", () => {
    const query: string = queryOf(TelemetrySampleSource.RumSpans);

    expect(query).toContain("AS readName");
    expect(query).not.toContain("AS readBody");
  });

  test("a session: its entry page, by its own id - never its traits, its label or a recording", () => {
    const query: string = queryOf(TelemetrySampleSource.RumSessions);

    expect(query).toContain("entryUrl");
    expect(query).toContain("AS readPage");
    expect(query).toContain("sessionId = ");
    expect(query).not.toContain("traceId = ");
    expect(query).not.toContain("identifiedUserLabel");
    expect(query).not.toContain("identifiedUserTraits");
    expect(query.toLowerCase()).not.toContain("payload");
    expect(query.toLowerCase()).not.toContain("chunk");
  });
});
