import MonitorSecretValueRedaction, {
  HIDDEN_SECRET_MARKER,
  HiddenSecretValues,
  MINIMUM_HIDDEN_SECRET_LENGTH,
} from "../../../../Server/Utils/Monitor/MonitorSecretValueRedaction";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "../../../../Types/Probe/RequestFailedDetails";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A MONITOR SECRET'S VALUE NEVER COMES BACK IN WHAT A CHECK REPORTS (#10825).
 *
 * The server fills a monitor's Text secrets into its steps, and a check can
 * say a value back: Playwright quotes the URL a page failed to load, a
 * script prints what it holds, an API echoes its query, an error page
 * quotes the URL, a server returns the headers it was sent. Each value is
 * hidden wherever it stands, in whatever form a browser, a client or a
 * server wrote it, and everything around it is kept.
 */

const MARKER: string = HIDDEN_SECRET_MARKER;

function compile(...values: Array<string>): HiddenSecretValues {
  const compiled: HiddenSecretValues | null =
    MonitorSecretValueRedaction.compile(values);

  expect(compiled).not.toBeNull();

  return compiled!;
}

function hide(text: string, ...values: Array<string>): string {
  return MonitorSecretValueRedaction.redactTextKeepingJson(
    text,
    compile(...values),
  );
}

/*
 * The forms a value is written in by a browser, a URL, a JSON text or
 * HTML: a text that holds none of them holds no part of the value anyone
 * could read back by undoing one encoding.
 */
function formsOf(secret: string): Array<string> {
  const forms: Array<string> = [
    secret,
    encodeURIComponent(secret),
    encodeURI(secret),
    encodeURIComponent(secret).split("%20").join("+"),
    JSON.stringify(secret).slice(1, -1),
    secret
      .split("&")
      .join("&amp;")
      .split("<")
      .join("&lt;")
      .split(">")
      .join("&gt;")
      .split('"')
      .join("&quot;"),
  ];

  const before: string = "https://forms.example.invalid/?t=";

  try {
    forms.push(
      new globalThis.URL(`${before}${secret}`).href.slice(before.length),
    );
  } catch {
    // A value that makes no URL is written whole.
  }

  return forms.filter((form: string, index: number): boolean => {
    return form.length > 0 && forms.indexOf(form) === index;
  });
}

function expectNoFormOf(text: string, secret: string): void {
  const lower: string = text.toLowerCase();

  expect(
    formsOf(secret).filter((form: string): boolean => {
      return lower.includes(form.toLowerCase());
    }),
  ).toEqual([]);
}

describe("a value is hidden wherever it stands, the text around it kept", () => {
  /*
   * Playwright 1.63.0's error for page.goto of a host that does not
   * resolve, as Chromium 153 writes the URL (a space as %20, a quote as
   * %22), captured from a real run: the value is Abc def"ghi.
   */
  const PLAYWRIGHT_ERROR: string =
    'page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=Abc%20def%22ghi&x=1#frag\nCall log:\n\u001b[2m  - navigating to "https://app.example.invalid/login?token=Abc%20def%22ghi&x=1#frag", waiting until "load"\u001b[22m\n';

  test("the issue's script error: Playwright quotes the URL, token and all, twice", () => {
    expect(hide(PLAYWRIGHT_ERROR, 'Abc def"ghi')).toBe(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${MARKER}&x=1#frag\nCall log:\n\u001b[2m  - navigating to "https://app.example.invalid/login?token=${MARKER}&x=1#frag", waiting until "load"\u001b[22m\n`,
    );
  });

  test("a path that holds a value: Playwright writes é as %C3%A9", () => {
    // Captured from the same run: the value is über-Secret.
    const error: string =
      'page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/caf%C3%A9/%C3%BCber-Secret?x=1\nCall log:\n  - navigating to "https://app.example.invalid/caf%C3%A9/%C3%BCber-Secret?x=1", waiting until "load"\n';

    expect(hide(error, "über-Secret")).toBe(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/caf%C3%A9/${MARKER}?x=1\nCall log:\n  - navigating to "https://app.example.invalid/caf%C3%A9/${MARKER}?x=1", waiting until "load"\n`,
    );
  });

  test("a value said many times is hidden every time", () => {
    const line: string = "key=sk_live_51HxQ2aBc; ";

    expect(hide(line.repeat(500), "sk_live_51HxQ2aBc")).toBe(
      `key=${MARKER}; `.repeat(500),
    );
  });

  test("in any case: a parser writes a host in lower case", () => {
    expect(
      hide(
        "page.goto: net::ERR_NAME_NOT_RESOLVED at https://db-7q.internal.example.com/",
        "DB-7Q.Internal.Example.com",
      ),
    ).toBe(`page.goto: net::ERR_NAME_NOT_RESOLVED at https://${MARKER}/`);

    expect(hide("TOKEN: ABCDEF123", "abcdef123")).toBe(`TOKEN: ${MARKER}`);
  });

  test("the marker is one fixed text: not the value's length, not a part of it, not its placeholder", () => {
    const short: string = hide("a=Q7rT b", "Q7rT");
    const long: string = hide(`a=${"Q7rT".repeat(40)} b`, "Q7rT".repeat(40));

    expect(short).toBe(`a=${MARKER} b`);
    expect(long).toBe(`a=${MARKER} b`);
    expect(MARKER).toBe("[REDACTED]");
    expect(MARKER).not.toContain("monitorSecrets");
    expect(MARKER).not.toContain("*");
  });

  test("a text that holds no value is the very text it was", () => {
    const text: string = "page.goto: Timeout 30000ms exceeded.";

    expect(
      MonitorSecretValueRedaction.redactText(text, compile("hunter2-key")),
    ).toBe(text);
    expect(MonitorSecretValueRedaction.redactText(text, null)).toBe(text);
    expect(MonitorSecretValueRedaction.redactText("", compile("abcd"))).toBe(
      "",
    );
  });
});

describe("in every form a browser, a client or a server writes it", () => {
  const SECRET: string = 'p@ss "w0rd" \\ é/x<y>&z';

  test.each([
    ["percent-encoded whole (encodeURIComponent)", encodeURIComponent(SECRET)],
    [
      "percent-encoded in lower case",
      encodeURIComponent(SECRET).replace(/%[0-9A-F]{2}/g, (escape: string) => {
        return escape.toLowerCase();
      }),
    ],
    [
      "as a form writes it: a space as +",
      encodeURIComponent(SECRET).split("%20").join("+"),
    ],
    [
      "as Chromium writes a query: some characters escaped, the rest not",
      new globalThis.URL(`https://x.example.invalid/?k=${SECRET}`).search.slice(
        3,
      ),
    ],
    ["in a JSON string", JSON.stringify(SECRET).slice(1, -1)],
    [
      "as Python's json.dumps writes it (ensure_ascii)",
      JSON.stringify(SECRET).slice(1, -1).replace("é", "\\u00e9"),
    ],
    [
      "as PHP's json_encode writes it: \\/ and \\u00E9",
      JSON.stringify(SECRET)
        .slice(1, -1)
        .replace("é", "\\u00E9")
        .split("/")
        .join("\\/"),
    ],
    [
      "as Go's encoding/json writes it: <, > and & as \\u003c, \\u003e, \\u0026",
      JSON.stringify(SECRET)
        .slice(1, -1)
        .split("<")
        .join("\\u003c")
        .split(">")
        .join("\\u003e")
        .split("&")
        .join("\\u0026"),
    ],
    [
      "a JSON string inside a JSON string: an echo server's copy of the body it was sent",
      JSON.stringify(JSON.stringify(SECRET)).slice(3, -3),
    ],
    [
      "as Node's util.inspect writes a string: \\' and \\\\",
      SECRET.split("\\").join("\\\\").split("'").join("\\'"),
    ],
    [
      "in HTML: &amp; &lt; &gt; &quot;",
      SECRET.split("&")
        .join("&amp;")
        .split("<")
        .join("&lt;")
        .split(">")
        .join("&gt;")
        .split('"')
        .join("&quot;"),
    ],
    [
      "in HTML by number: &#34; &#x26;",
      SECRET.split("&").join("&#x26;").split('"').join("&#34;"),
    ],
    [
      "percent-encoded, inside a JSON string",
      JSON.stringify(encodeURIComponent(SECRET)).slice(1, -1),
    ],
  ])("%s", (_name: string, written: string) => {
    const text: string = `echo: {before}${written}{after}`;
    const hidden: string = hide(text, SECRET);

    expect(hidden).toBe(`echo: {before}${MARKER}{after}`);
  });

  test("httpbin's echo of a JSON body it was sent: the body as parsed, and as the text it came as", () => {
    const sent: string = JSON.stringify({ password: SECRET, user: "ops" });
    const echoed: string = JSON.stringify({
      data: sent,
      json: JSON.parse(sent),
      headers: { "Content-Type": "application/json" },
    });
    const hidden: string = hide(echoed, SECRET);

    expect(JSON.parse(hidden)).toEqual({
      data: JSON.stringify({ password: MARKER, user: "ops" }),
      json: { password: MARKER, user: "ops" },
      headers: { "Content-Type": "application/json" },
    });
  });

  test("a value that holds what reads as an escape, written beside a character that is escaped", () => {
    // Found by a seeded sweep: the URL keeps the value's own %19 and escapes its spaces.
    const secret: string = "Zq / +0&b}\\%19";
    const before: string = "https://x.example.invalid/?k=";
    const written: string = new globalThis.URL(`${before}${secret}`).href.slice(
      before.length,
    );

    expect(written).toBe("Zq%20/%20+0&b}\\%19");
    expect(hide(`at ${before}${written}.`, secret)).toBe(
      `at ${before}${MARKER}.`,
    );
  });

  test("a backslash in a URL's path, which the parser writes as a slash, and one in its query, which it keeps", () => {
    const secret: string = "Zq\\path\\Secret?x=\\y";
    const before: string = "https://x.example.invalid/";
    const written: string = new globalThis.URL(`${before}${secret}`).href.slice(
      before.length,
    );

    expect(written).toBe("Zq/path/Secret?x=\\y");
    expect(hide(`GET ${before}${written} failed`, secret)).toBe(
      `GET ${before}${MARKER} failed`,
    );
  });

  test("a Latin-1 percent-encoding, as an older server writes é", () => {
    expect(hide("q=caf%E9-Secret!", "café-Secret!")).toBe(`q=${MARKER}`);
  });

  test("the tabs and line breaks a URL parser drops, and spaces around the value", () => {
    expect(
      hide("at https://a.example.invalid/?t=TokenValue1", "TokenValue1\n"),
    ).toBe(`at https://a.example.invalid/?t=${MARKER}`);
    expect(hide("t=Token\tValue2", "Token\tValue2")).toBe(`t=${MARKER}`);
    expect(hide("t=TokenValue3", "Token\tValue3")).toBe(`t=${MARKER}`);
    expect(hide("t=TokenValue4.", "  TokenValue4  ")).toBe(`t=${MARKER}.`);
  });

  describe("base64, as a client sends it", () => {
    test.each([
      ["the value alone", "Sup3rS3cret!x"],
      ["after one byte", "a:Sup3rS3cret!x"],
      ["after two bytes", "ab:Sup3rS3cret!x"],
      ["after three bytes", "abc:Sup3rS3cret!x"],
      ["with text after it", "admin:Sup3rS3cret!x:more"],
    ])(
      "in an Authorization: Basic header, %s",
      (_name: string, pair: string) => {
        const encoded: string = Buffer.from(pair, "utf8").toString("base64");
        const hidden: string = hide(
          `Authorization: Basic ${encoded}`,
          "Sup3rS3cret!x",
        );

        expect(hidden).toContain(MARKER);
        expect(hidden).not.toContain(encoded);

        // Undone, what is left says nothing of the value.
        const left: string = hidden.split(MARKER).join("");

        expect(
          Buffer.from(left.replace("Authorization: Basic ", ""), "base64")
            .toString("utf8")
            .includes("Sup3rS3cret"),
        ).toBe(false);
      },
    );

    test("the URL-safe alphabet, without its padding", () => {
      const value: string = "k>>?~~Secret-Key";
      const encoded: string = Buffer.from(value, "utf8")
        .toString("base64")
        .split("+")
        .join("-")
        .split("/")
        .join("_")
        .replace(/[=]+$/, "");

      expect(hide(`token=${encoded}&x=1`, value)).toBe(`token=${MARKER}&x=1`);
    });

    test("the whole value, padding and all", () => {
      const encoded: string = Buffer.from("hunter2-secret", "utf8").toString(
        "base64",
      );

      expect(encoded.endsWith("=")).toBe(true);
      expect(hide(`"auth":"${encoded}"`, "hunter2-secret")).toBe(
        `"auth":"${MARKER}"`,
      );
    });
  });
});

describe("values that overlap", () => {
  test("two values that overlap are hidden as one stretch, never what one leaves of the other", () => {
    expect(hide("t=abc123xyz789!", "abc123xyz", "123xyz789")).toBe(
      `t=${MARKER}!`,
    );
  });

  test("a value inside another", () => {
    expect(hide("k=xxSecretValueyy;", "SecretValue", "xxSecretValueyy")).toBe(
      `k=${MARKER};`,
    );
  });

  test("two values side by side are one marker", () => {
    expect(
      hide("k=FirstSecretSecondSecret;", "FirstSecret", "SecondSecret"),
    ).toBe(`k=${MARKER};`);
  });

  test("a value that overlaps itself: every repeat is hidden", () => {
    expect(hide("x=abababababab;", "ababab")).toBe(`x=${MARKER};`);
    expect(hide(`x=${"a".repeat(5000)};`, "a".repeat(40))).toBe(`x=${MARKER};`);
    // Not a whole repeat: what follows the last whole one stays.
    expect(hide("x=abcabcabcab;", "abcabc")).toBe(`x=${MARKER}ab;`);
  });
});

describe(`a value shorter than ${MINIMUM_HIDDEN_SECRET_LENGTH} characters is left as it is`, () => {
  test("one to three characters stand in ordinary text: never hidden", () => {
    for (const value of ["a", "12", "abc", " ab ", "\tx\n"]) {
      expect(MonitorSecretValueRedaction.isLongEnoughToHide(value)).toBe(false);
      expect(MonitorSecretValueRedaction.compile([value])).toBeNull();
    }

    expect(
      MonitorSecretValueRedaction.redactText(
        "took 1234 ms, status abc",
        MonitorSecretValueRedaction.compile(["123", "abc"]),
      ),
    ).toBe("took 1234 ms, status abc");
  });

  test("four characters are hidden, counted as people count them", () => {
    expect(MonitorSecretValueRedaction.isLongEnoughToHide("4821")).toBe(true);
    expect(MonitorSecretValueRedaction.isLongEnoughToHide("日本語字")).toBe(
      true,
    );
    // Two characters, though four UTF-16 units.
    expect(MonitorSecretValueRedaction.isLongEnoughToHide("😀😀")).toBe(false);
    expect(hide("pin=4821", "4821")).toBe(`pin=${MARKER}`);
  });

  test("a value of nothing but spaces is no value", () => {
    expect(
      MonitorSecretValueRedaction.compile(["     ", "", null, undefined]),
    ).toBeNull();
  });
});

describe("a JSON text stays JSON", () => {
  test("a value inside a string: the rest of the text as it was", () => {
    const body: string = JSON.stringify({
      args: { key: 'k"9\\Secret' },
      origin: "203.0.113.7",
    });
    const hidden: string = hide(body, 'k"9\\Secret');

    expect(JSON.parse(hidden)).toEqual({
      args: { key: MARKER },
      origin: "203.0.113.7",
    });
  });

  test("a value that is a number becomes the marker as a string", () => {
    const hidden: string = hide('{"pin":48213925,"ok":true}', "48213925");

    expect(JSON.parse(hidden)).toEqual({ pin: MARKER, ok: true });
  });

  test("a value inside a longer number", () => {
    const hidden: string = hide('{"account":9948213925001}', "48213925");

    expect(JSON.parse(hidden)).toEqual({ account: MARKER });
  });

  test("a value that runs across the text's own quotes is hidden still", () => {
    const hidden: string = hide('{"a":"x","b":"y"}', 'x","b');

    expect(hidden).not.toContain('x","b');
    expect(hidden).toContain(MARKER);
  });

  test("a text that is no JSON is hidden as text", () => {
    expect(hide("[INFO] sent token Abc12345 to {server}", "Abc12345")).toBe(
      `[INFO] sent token ${MARKER} to {server}`,
    );
  });
});

describe("what a probe reports of a check", () => {
  const SECRET: string = "Sk_Live_Q1w2E3r4";
  const PROJECT: ObjectID = ObjectID.generate();
  const MONITOR: ObjectID = ObjectID.generate();
  const STEP: ObjectID = ObjectID.generate();
  const PROBE: ObjectID = ObjectID.generate();

  function report(): ProbeMonitorResponse {
    return {
      projectId: PROJECT,
      monitorId: MONITOR,
      monitorStepId: STEP,
      probeId: PROBE,
      isOnline: false,
      responseCode: 400,
      // A measurement that happens to read as the numeric value below.
      responseTimeInMs: 48213925,
      failureCause: `Request failed: key ${SECRET} was refused`,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.ServerResponse,
        errorCode: "E400",
        errorDescription: `The server said: bad key ${SECRET}`,
        rawErrorMessage: `bad key ${SECRET}`,
      },
      probeAttempts: [
        {
          attemptNumber: 1,
          attemptedAt: new Date("2026-11-23T10:00:00.000Z"),
          responseReceivedAt: new Date("2026-11-23T10:00:01.000Z"),
          responseTimeInMs: 12,
          isOnline: false,
          failureCause: `bad key ${SECRET}`,
        },
      ],
      responseHeaders: {
        "x-echo-authorization": `Bearer ${SECRET}`,
        [`x-seen-${SECRET}`]: "yes",
        "content-type": "application/json",
      },
      responseBody: JSON.stringify({
        args: { key: SECRET },
        pin: 48213925,
        url: `https://httpbin.example/get?key=${encodeURIComponent(SECRET)}`,
      }),
      syntheticMonitorResponse: [
        {
          result: { [SECRET]: true, echoed: SECRET, pin: 48213925 },
          scriptError: `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/?token=${SECRET}`,
          logMessages: [`token is ${SECRET}`, "done"],
          capturedMetrics: [
            { name: "login_ms", value: 820, attributes: { token: SECRET } },
          ],
          executionTimeInMS: 48213925,
          retryAttempts: [
            {
              attemptNumber: 1,
              scriptError: `failed with ${SECRET}`,
              executionTimeInMS: 10,
            },
          ],
          screenshots: { "after-login": "aVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FB" },
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
        },
      ],
      customCodeMonitorResponse: {
        result: `returned ${SECRET}`,
        scriptError: `fetch failed for ${SECRET}`,
        logMessages: [`using ${SECRET}`],
        capturedMetrics: [],
        executionTimeInMS: 3,
      },
      externalStatusPageResponse: {
        isOnline: false,
        overallStatus: "unknown",
        componentStatuses: [],
        activeIncidentCount: 0,
        responseTimeInMs: 4,
        failureCause: `Invalid page ${SECRET}`,
      },
      monitorDestination: URL.fromString(
        `https://api.example.com/v1?key=${SECRET}`,
      ),
      monitoredAt: new Date("2026-11-23T10:00:01.000Z"),
      evaluationSummary: {
        evaluatedAt: new Date("2026-11-23T10:00:02.000Z"),
        criteriaResults: [],
        events: [],
      },
    } as unknown as ProbeMonitorResponse;
  }

  // Every text in a value, its object keys included.
  function textsOf(value: unknown): Array<string> {
    if (typeof value === "string") {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item: unknown): Array<string> => {
        return textsOf(item);
      });
    }

    if (value instanceof Date || value instanceof ObjectID) {
      return [];
    }

    if (value && typeof value === "object") {
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        return [String(value)];
      }

      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, item]: [string, unknown]): Array<string> => {
          return [key, ...textsOf(item)];
        },
      );
    }

    return [];
  }

  const configured: URL = URL.fromString(
    "https://api.example.com/v1?key={{monitorSecrets.ApiKey}}",
  );

  function redact(check: ProbeMonitorResponse): ProbeMonitorResponse {
    return MonitorSecretValueRedaction.redactCheck(
      check,
      compile(SECRET, "48213925"),
      { configuredDestination: configured },
    );
  }

  test("no text of it holds a value: errors, log lines, returned data, body, headers, causes", () => {
    const redacted: ProbeMonitorResponse = redact(report());

    for (const text of textsOf(redacted)) {
      expectNoFormOf(text, SECRET);
    }

    expect(redacted.failureCause).toBe(
      `Request failed: key ${MARKER} was refused`,
    );
    expect(redacted.requestFailedDetails).toEqual({
      failedPhase: RequestFailedPhase.ServerResponse,
      errorCode: "E400",
      errorDescription: `The server said: bad key ${MARKER}`,
      rawErrorMessage: `bad key ${MARKER}`,
    });
    expect(redacted.probeAttempts?.[0]?.failureCause).toBe(`bad key ${MARKER}`);
    expect(redacted.externalStatusPageResponse?.failureCause).toBe(
      `Invalid page ${MARKER}`,
    );
    expect(redacted.customCodeMonitorResponse).toEqual({
      result: `returned ${MARKER}`,
      scriptError: `fetch failed for ${MARKER}`,
      logMessages: [`using ${MARKER}`],
      capturedMetrics: [],
      executionTimeInMS: 3,
    });

    const run: JSONObject = redacted
      .syntheticMonitorResponse![0] as unknown as JSONObject;

    expect(run["scriptError"]).toBe(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/?token=${MARKER}`,
    );
    expect(run["logMessages"]).toEqual([`token is ${MARKER}`, "done"]);
    expect((run["retryAttempts"] as Array<JSONObject>)[0]!["scriptError"]).toBe(
      `failed with ${MARKER}`,
    );
    expect(run["capturedMetrics"]).toEqual([
      { name: "login_ms", value: 820, attributes: { token: MARKER } },
    ]);
  });

  test("the monitored system's names and numbers are read as its text is; OneUptime's own are not", () => {
    const redacted: ProbeMonitorResponse = redact(report());

    // A response's and a script's own data: names and numbers too.
    expect(redacted.responseHeaders).toEqual({
      "x-echo-authorization": `Bearer ${MARKER}`,
      [`x-seen-${MARKER}`]: "yes",
      "content-type": "application/json",
    });
    expect(JSON.parse(redacted.responseBody as string)).toEqual({
      args: { key: MARKER },
      pin: MARKER,
      url: `https://httpbin.example/get?key=${MARKER}`,
    });
    expect(redacted.syntheticMonitorResponse![0]!.result).toEqual({
      [MARKER]: true,
      echoed: MARKER,
      pin: MARKER,
    });

    // What the probe measured is kept, whatever it reads as.
    expect(redacted.responseTimeInMs).toBe(48213925);
    expect(redacted.syntheticMonitorResponse![0]!.executionTimeInMS).toBe(
      48213925,
    );
    expect(redacted.responseCode).toBe(400);
  });

  test("the screenshots, the ids, the times and the evaluation are as they were", () => {
    const original: ProbeMonitorResponse = report();
    const redacted: ProbeMonitorResponse = redact(original);

    expect(redacted.syntheticMonitorResponse![0]!.screenshots).toBe(
      original.syntheticMonitorResponse![0]!.screenshots,
    );
    expect(redacted.evaluationSummary).toBe(original.evaluationSummary);
    expect(redacted.projectId).toBe(PROJECT);
    expect(redacted.monitorId).toBe(MONITOR);
    expect(redacted.monitorStepId).toBe(STEP);
    expect(redacted.probeId).toBe(PROBE);
    expect(redacted.monitoredAt).toBe(original.monitoredAt);
    expect(redacted.isOnline).toBe(false);
  });

  test("the destination the probe echoes is the step's as configured, {{monitorSecrets.NAME}} by name", () => {
    const redacted: ProbeMonitorResponse = redact(report());

    expect(redacted.monitorDestination).toBe(configured);

    // With no step to name it, it is left out rather than shown.
    const withoutStep: ProbeMonitorResponse =
      MonitorSecretValueRedaction.redactCheck(report(), compile(SECRET));

    expect(
      Object.prototype.hasOwnProperty.call(withoutStep, "monitorDestination"),
    ).toBe(false);

    // One that holds no value is as the probe sent it.
    const plain: ProbeMonitorResponse = {
      ...report(),
      monitorDestination: URL.fromString("https://api.example.com/health"),
    };

    expect(redact(plain).monitorDestination).toBe(plain.monitorDestination);
  });

  test("never changes the check it is handed", () => {
    const original: ProbeMonitorResponse = report();
    const before: string = JSON.stringify(original);

    redact(original);

    expect(JSON.stringify(original)).toBe(before);
  });

  test("a check that holds no value is the very object it was", () => {
    const clean: ProbeMonitorResponse = {
      projectId: PROJECT,
      monitorId: MONITOR,
      monitorStepId: STEP,
      probeId: PROBE,
      failureCause: "Connection refused",
      responseBody: '{"status":"down"}',
      responseHeaders: { "content-type": "application/json" },
      syntheticMonitorResponse: [
        {
          result: { ok: false },
          scriptError: "page.goto: Timeout 30000ms exceeded.",
          logMessages: ["started"],
          capturedMetrics: [],
          executionTimeInMS: 30000,
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Mobile,
        },
      ],
      monitoredAt: new Date(),
    };

    expect(redact(clean)).toBe(clean);
    expect(MonitorSecretValueRedaction.redactCheck(clean, null)).toBe(clean);
  });
});

describe("seeded-random values never reach the text, wherever and however they stand", () => {
  test("400 values with quotes, backslashes, spaces and unicode, each in a form and a place drawn at random", () => {
    const random: SeededRandom = seededRandom(10825);
    // By character, so 😀 is drawn whole.
    const alphabet: Array<string> = Array.from(
      "abcXYZ019-_.~!$&'()*+,;=:@/?#[]%\\\" <>`{}|^ é日😀\t",
    );

    const secretOf: () => string = (): string => {
      let secret: string = "Zq";

      for (let index: number = 0; index < 4 + random(16); index++) {
        secret += alphabet[random(alphabet.length)];
      }

      return `${secret}9`;
    };

    const writers: Array<(value: string) => string> = [
      (value: string): string => {
        return value;
      },
      (value: string): string => {
        return encodeURIComponent(value);
      },
      (value: string): string => {
        return encodeURIComponent(value).split("%20").join("+");
      },
      (value: string): string => {
        return JSON.stringify(value).slice(1, -1);
      },
      (value: string): string => {
        return JSON.stringify(JSON.stringify(value)).slice(1, -1);
      },
      (value: string): string => {
        return value
          .split("&")
          .join("&amp;")
          .split("<")
          .join("&lt;")
          .split('"')
          .join("&quot;");
      },
      (value: string): string => {
        // As a browser writes the URL a page failed to load: href, fragment and all.
        const before: string = "https://r.example.invalid/?k=";

        try {
          return new globalThis.URL(`${before}${value}`).href.slice(
            before.length,
          );
        } catch {
          return value;
        }
      },
    ];

    const places: Array<(written: string) => string> = [
      (written: string): string => {
        return `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/?token=${written}`;
      },
      (written: string): string => {
        return `{"args":{"key":"${written}"},"origin":"x"}`;
      },
      (written: string): string => {
        return `<p>No page at /v1/${written}/items</p>`;
      },
      (written: string): string => {
        return `${written}`;
      },
      (written: string): string => {
        return `start ${written} middle ${written} end`;
      },
    ];

    for (let round: number = 0; round < 400; round++) {
      const secret: string = secretOf();
      const written: string = writers[random(writers.length)]!(secret);
      const text: string = places[random(places.length)]!(written);
      const hidden: string = MonitorSecretValueRedaction.redactText(
        text,
        compile(secret),
      );

      // Seen in a failure: which round, the value, and what was left.
      expect({
        round,
        secret,
        hidden,
        holdsWritten: hidden.includes(written),
      }).toEqual({ round, secret, hidden, holdsWritten: false });
      expectNoFormOf(hidden, secret);
      expect(hidden).toContain(MARKER);
    }
  });
});

describe("time in line with the text's length", () => {
  test("a long page full of escapes, a value said 20,000 times, and a run of one letter", () => {
    const values: HiddenSecretValues = compile(
      "sk_live_51HxQ2a&b<c>",
      'p@ss "w0rd" \\ é',
      "%41%42%43%44",
      "a".repeat(64),
    );
    const page: string =
      "<p>Hello &amp; welcome &lt;b&gt;user&lt;/b&gt; sk_live 41%20 \\n \\u0041</p>\n".repeat(
        5000,
      );
    const many: string = "k=sk_live_51HxQ2a%26b%3Cc%3E; ".repeat(20_000);
    const run: string = "a".repeat(400_000);

    const timed: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return [
          MonitorSecretValueRedaction.redactText(page, values),
          MonitorSecretValueRedaction.redactText(many, values),
          MonitorSecretValueRedaction.redactText(run, values),
        ];
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result[0]).toBe(page);
    expect(timed.result[1]).toBe(`k=${MARKER}; `.repeat(20_000));
    expect(timed.result[2]).toBe(MARKER);
  });
});
