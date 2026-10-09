import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  certificateMonitorName,
  intervalNotes,
  readHttpMethod,
  timeoutNotes,
  toCertificateMonitor,
  toHttpMonitor,
  toUnsupportedMonitor,
} from "../../../Types/ToolImport/ToolImportMonitorMapping";
import {
  DEFAULT_ACCEPTED_STATUS_CODES,
  invertStatusCodeRanges,
  isDefaultStatusCodeRanges,
  isSecretHeader,
  mergeStatusCodeRanges,
  readJsonObjectBody,
  readStatusCodeRanges,
  splitRequestHeaders,
  TOOL_IMPORT_DEFAULT_MONITORING_INTERVAL,
  TOOL_IMPORT_MAX_TIMEOUT_SECONDS,
  TOOL_IMPORT_MONITORING_INTERVALS,
  toHeartbeatMinutes,
  toMonitoringInterval,
} from "../../../Types/ToolImport/ToolImportMonitorRules";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import { ImportedMonitor } from "../../../Types/ToolImport/ToolImportSnapshot";

/*
 * The rules every uptime tool's adapter shares, read in each tool's own
 * spelling: the status codes that count as up, how often a check runs and
 * how long it waits, the headers and body it sends, and the decision every
 * web check goes through (Website or API monitor, what is left out and
 * said). Pure, so each rule is held here on its own; the adapters' tests
 * hold each tool's spellings to them.
 */

function codes(notes: Array<ToolImportNote>): Array<ToolImportNoteCode> {
  return notes.map((note: ToolImportNote): ToolImportNoteCode => {
    return note.code;
  });
}

describe("status codes that count as up", () => {
  test("every spelling a tool uses reads: a class, a range, a code, a number", () => {
    expect(readStatusCodeRanges(["2xx"])).toEqual([{ from: 200, to: 299 }]);
    expect(readStatusCodeRanges(["200-299", "3XX"])).toEqual([
      { from: 200, to: 399 },
    ]);
    expect(readStatusCodeRanges(["201", 418, " 204 "])).toEqual([
      { from: 201, to: 201 },
      { from: 204, to: 204 },
      { from: 418, to: 418 },
    ]);
    expect(readStatusCodeRanges(["200 - 204"])).toEqual([
      { from: 200, to: 204 },
    ]);
  });

  test("what is not a status code is ignored, never guessed", () => {
    expect(
      readStatusCodeRanges([
        "ok",
        "6xx",
        "99",
        600,
        200.5,
        "299-200",
        null,
        {},
        "",
      ]),
    ).toEqual([]);
  });

  test("overlapping and touching ranges are joined, and the result is sorted", () => {
    expect(
      mergeStatusCodeRanges([
        { from: 300, to: 302 },
        { from: 200, to: 299 },
        { from: 250, to: 260 },
        { from: 404, to: 404 },
      ]),
    ).toEqual([
      { from: 200, to: 302 },
      { from: 404, to: 404 },
    ]);
  });

  test("the codes a tool alerts on, turned around, are the codes that count as up", () => {
    expect(
      invertStatusCodeRanges([
        { from: 500, to: 599 },
        { from: 404, to: 404 },
      ]),
    ).toEqual([
      { from: 100, to: 403 },
      { from: 405, to: 499 },
    ]);
    expect(invertStatusCodeRanges([])).toEqual([{ from: 100, to: 599 }]);
    expect(invertStatusCodeRanges([{ from: 100, to: 599 }])).toEqual([]);
  });

  test("2xx and 3xx, or nothing said, is OneUptime's own default", () => {
    expect(DEFAULT_ACCEPTED_STATUS_CODES).toEqual([{ from: 200, to: 399 }]);
    expect(isDefaultStatusCodeRanges(undefined)).toBe(true);
    expect(isDefaultStatusCodeRanges([])).toBe(true);
    expect(
      isDefaultStatusCodeRanges([
        { from: 300, to: 399 },
        { from: 200, to: 299 },
      ]),
    ).toBe(true);
    expect(isDefaultStatusCodeRanges([{ from: 200, to: 299 }])).toBe(false);
  });
});

describe("how often a monitor is checked", () => {
  test("the intervals are the Create Monitor form's, shortest first, and five minutes is the default", () => {
    const seconds: Array<number> = TOOL_IMPORT_MONITORING_INTERVALS.map(
      (interval: { seconds: number }): number => {
        return interval.seconds;
      },
    );

    expect(seconds).toEqual(
      [...seconds].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
    expect(TOOL_IMPORT_DEFAULT_MONITORING_INTERVAL).toEqual({
      cron: "*/5 * * * *",
      seconds: 300,
    });
  });

  test("a tool's pace becomes the closest OneUptime offers, the shorter of two equally close", () => {
    expect(toMonitoringInterval(60).cron).toBe("* * * * *");
    expect(toMonitoringInterval(30).cron).toBe("* * * * *");
    expect(toMonitoringInterval(300).cron).toBe("*/5 * * * *");
    expect(toMonitoringInterval(240).cron).toBe("*/5 * * * *");
    // Halfway between 2 and 5 minutes is nearer 2; 3.5 minutes ties - shorter wins.
    expect(toMonitoringInterval(180).cron).toBe("*/2 * * * *");
    expect(toMonitoringInterval(210).cron).toBe("*/2 * * * *");
    expect(toMonitoringInterval(3600).cron).toBe("0 * * * *");
    expect(toMonitoringInterval(86400 * 30).cron).toBe("0 0 * * 0");
  });

  test("a pace the tool does not say is checked every five minutes", () => {
    expect(toMonitoringInterval(undefined).cron).toBe("*/5 * * * *");
    expect(toMonitoringInterval(0).cron).toBe("*/5 * * * *");
    expect(toMonitoringInterval(-60).cron).toBe("*/5 * * * *");
    expect(toMonitoringInterval(Number.NaN).cron).toBe("*/5 * * * *");
  });

  test("the preview says when the pace changes, and only then", () => {
    expect(intervalNotes(300)).toEqual([]);
    expect(intervalNotes(undefined)).toEqual([]);
    expect(intervalNotes(30)).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
        every: 30,
        oneUptimeEvery: 60,
      }),
    ]);
    expect(intervalNotes(240)).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
        every: 240,
        oneUptimeEvery: 300,
      }),
    ]);
  });

  test("a wait longer than OneUptime's longest is said", () => {
    expect(TOOL_IMPORT_MAX_TIMEOUT_SECONDS).toBe(60);
    expect(timeoutNotes(30)).toEqual([]);
    expect(timeoutNotes(60)).toEqual([]);
    expect(timeoutNotes(undefined)).toEqual([]);
    expect(timeoutNotes(90)).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorTimeoutShortened, {
        timeout: 90,
      }),
    ]);
  });

  test("a heartbeat's silence is whole minutes, rounded up, at least one", () => {
    expect(toHeartbeatMinutes(60)).toBe(1);
    expect(toHeartbeatMinutes(90)).toBe(2);
    expect(toHeartbeatMinutes(1)).toBe(1);
    expect(toHeartbeatMinutes(0)).toBe(1);
    expect(toHeartbeatMinutes(86400)).toBe(1440);
  });
});

describe("headers and body a check sends", () => {
  test("a header that may hold a secret is recognised by its name", () => {
    for (const name of [
      "Authorization",
      "Proxy-Authorization",
      "Cookie",
      "X-API-Key",
      "X-Auth-Token",
      "x-session-id",
      "X-Hub-Signature",
      "Client-Secret",
      "X-Password",
    ]) {
      expect({ name, secret: isSecretHeader(name) }).toEqual({
        name,
        secret: true,
      });
    }

    for (const name of ["Accept", "User-Agent", "Content-Type", "X-Request"]) {
      expect({ name, secret: isSecretHeader(name) }).toEqual({
        name,
        secret: false,
      });
    }
  });

  test("secret headers are named, not kept; the rest are kept as they are", () => {
    expect(
      splitRequestHeaders([
        { name: "Accept", value: "application/json" },
        { name: "Authorization", value: "Bearer abc" },
        { name: " X-Trace ", value: " on " },
        { name: "Authorization", value: "again" },
      ]),
    ).toEqual({
      kept: { Accept: "application/json", "X-Trace": "on" },
      leftOut: ["Authorization"],
    });
  });

  test("a header that is not a header is dropped: a bad name, a line break, an object's machinery", () => {
    const split: { kept: Record<string, string>; leftOut: Array<string> } =
      splitRequestHeaders([
        { name: "Bad Name", value: "x" },
        { name: "X-Injected", value: "a\r\nSet-Cookie: evil=1" },
        { name: "X-Null", value: "a\u0000b" },
        { name: "__proto__", value: "polluted" },
        { name: "constructor", value: "x" },
        { name: "X-Long", value: "x".repeat(5000) },
        { name: "", value: "x" },
        { name: "X-Tab", value: "a\tb" },
      ]);

    expect(split.kept).toEqual({ "X-Tab": "a\tb" });
    expect(split.leftOut).toEqual([]);
    // Nothing reached a prototype.
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(split.kept)).toBe(Object.prototype);
  });

  test("a body is sent only as a JSON object, written compactly", () => {
    expect(readJsonObjectBody('{ "a": 1, "b": [1, 2] }')).toBe(
      '{"a":1,"b":[1,2]}',
    );
    expect(readJsonObjectBody("[1, 2]")).toBeNull();
    expect(readJsonObjectBody("a=1&b=2")).toBeNull();
    expect(readJsonObjectBody('"text"')).toBeNull();
    expect(readJsonObjectBody("null")).toBeNull();
    expect(readJsonObjectBody("")).toBeNull();
    expect(readJsonObjectBody(42)).toBeNull();
  });
});

describe("what a web check becomes", () => {
  test("a method is any case, and anything unknown is GET", () => {
    expect(readHttpMethod("post")).toBe(HTTPMethod.POST);
    expect(readHttpMethod(" Head ")).toBe(HTTPMethod.HEAD);
    expect(readHttpMethod("TRACE")).toBe(HTTPMethod.GET);
    expect(readHttpMethod(undefined)).toBe(HTTPMethod.GET);
  });

  test("a plain load is a Website monitor", () => {
    const monitor: ImportedMonitor = toHttpMonitor({
      sourceId: "1",
      name: "Home",
      sourceType: "http",
      url: "https://example.com",
      isPaused: false,
    });

    expect(monitor).toMatchObject({
      sourceId: "1",
      name: "Home",
      sourceType: "http",
      monitorType: MonitorType.Website,
      destination: "https://example.com",
      httpMethod: HTTPMethod.GET,
      isPaused: false,
      notes: [],
    });
    expect(monitor.requestHeaders).toBeUndefined();
    expect(monitor.requestBody).toBeUndefined();
  });

  test("another method, headers or a JSON body make it an API monitor, which sends them", () => {
    const monitor: ImportedMonitor = toHttpMonitor({
      sourceId: "2",
      name: "Orders",
      sourceType: "http",
      url: "https://api.example.com/orders",
      method: "post",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "X-Api-Key", value: "secret" },
      ],
      body: '{"ping": true}',
      isPaused: false,
    });

    expect(monitor.monitorType).toBe(MonitorType.API);
    expect(monitor.httpMethod).toBe(HTTPMethod.POST);
    expect(monitor.requestHeaders).toEqual({
      "Content-Type": "application/json",
    });
    expect(monitor.requestBody).toBe('{"ping":true}');
    expect(monitor.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "X-Api-Key",
      }),
    ]);
  });

  test("a body that is not a JSON object is left out and said, and a GET sends none", () => {
    expect(
      codes(
        toHttpMonitor({
          sourceId: "3",
          name: "Form",
          sourceType: "http",
          url: "https://example.com/form",
          method: "POST",
          body: "a=1&b=2",
          isPaused: false,
        }).notes,
      ),
    ).toEqual([ToolImportNoteCode.MonitorBodyLeftOut]);

    const get: ImportedMonitor = toHttpMonitor({
      sourceId: "4",
      name: "Get",
      sourceType: "http",
      url: "https://example.com",
      body: '{"ignored": true}',
      isPaused: false,
    });

    expect(get.monitorType).toBe(MonitorType.Website);
    expect(get.requestBody).toBeUndefined();
  });

  test("a check that signs in says so, a paused one too, with the pace and wait it keeps", () => {
    expect(
      codes(
        toHttpMonitor({
          sourceId: "5",
          name: "Admin",
          sourceType: "http",
          url: "https://example.com/admin",
          signsIn: true,
          intervalSeconds: 30,
          timeoutSeconds: 120,
          isPaused: true,
          notes: [makeToolImportNote(ToolImportNoteCode.MonitorAssertionsLeftOut)],
        }).notes,
      ),
    ).toEqual([
      ToolImportNoteCode.MonitorAssertionsLeftOut,
      ToolImportNoteCode.MonitorSignInLeftOut,
      ToolImportNoteCode.MonitorIntervalChanged,
      ToolImportNoteCode.MonitorTimeoutShortened,
      ToolImportNoteCode.MonitorPaused,
    ]);
  });

  test("a keyword needs the page: a HEAD check with one sends GET", () => {
    const monitor: ImportedMonitor = toHttpMonitor({
      sourceId: "6",
      name: "Head",
      sourceType: "keyword",
      url: "https://example.com",
      method: "HEAD",
      keyword: { value: "Welcome", isPresent: true, isCaseSensitive: true },
      acceptedStatusCodes: [{ from: 200, to: 299 }],
      isPaused: false,
    });

    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(monitor.httpMethod).toBe(HTTPMethod.GET);
    expect(monitor.keyword).toEqual({
      value: "Welcome",
      isPresent: true,
      isCaseSensitive: true,
    });
    expect(monitor.acceptedStatusCodes).toEqual([{ from: 200, to: 299 }]);
  });

  test("a certificate monitor is made for https only, named after its check, checked at most hourly", () => {
    expect(
      toCertificateMonitor({
        sourceId: "7",
        name: "Shop",
        url: "http://example.com",
        isPaused: false,
      }),
    ).toBeNull();

    expect(
      toCertificateMonitor({
        sourceId: "7",
        name: "Shop",
        url: "https://shop.example.com",
        warningDays: 14,
        intervalSeconds: 60,
        isPaused: true,
      }),
    ).toEqual({
      sourceId: "7:certificate",
      name: "Shop certificate",
      sourceType: "certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://shop.example.com",
      intervalSeconds: 3600,
      certificateExpiryWarningDays: 14,
      isPaused: true,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorPaused)],
    });
  });

  test("a long name is cut so the certificate monitor's name still fits", () => {
    const name: string = certificateMonitorName("x".repeat(150));

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(" certificate")).toBe(true);
  });

  test("a check OneUptime has no monitor for is named, with the reason when the tool knows one", () => {
    expect(
      toUnsupportedMonitor({
        sourceId: "8",
        name: "Game",
        sourceType: "steam",
        destination: "game.example.com",
        skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
      }),
    ).toEqual({
      sourceId: "8",
      name: "Game",
      sourceType: "steam",
      monitorType: null,
      destination: "game.example.com",
      isPaused: false,
      skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
      notes: [],
    });
  });
});
