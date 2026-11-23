import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../../../Types/Probe/RequestFailedDetails";
import MonitorUrlInText, {
  NOT_A_URL,
} from "../../../Utils/Monitor/MonitorUrlInText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A MONITOR'S URL AS WHAT ITS CHECK REPORTS NAMES IT (#10785).
 *
 * The server fills a monitor's secrets into its URL before the probe sends
 * it, and a request that fails says the URL it went to: "Request failed to
 * https://api.example.com/health?key=<the key>. socket hang up". That text
 * was the check's failure cause, each attempt's and why the request
 * failed, shown to everyone who can read the monitor and written into an
 * incident's root cause. Every URL in them is now its scheme, host and
 * port alone, wherever the secret sits: the path, the query, the fragment
 * or the credentials before the host.
 */

// In every secret, so a text that holds one is found.
const MARK: string = "hunter2";

describe("a URL is named by its scheme, host and port", () => {
  test.each([
    ["https://api.example.com/health?key=hunter2", "https://api.example.com"],
    ["https://api.example.com:8443/v1/hunter2", "https://api.example.com:8443"],
    ["http://user:hunter2@example.com/a?b=c", "http://example.com"],
    ["https://example.com/#token=hunter2", "https://example.com"],
    ["https://example.com", "https://example.com"],
    ["https://example.com/", "https://example.com"],
    ["http://[2001:db8::1]:8080/hunter2", "http://[2001:db8::1]:8080"],
    ["HTTPS://API.EXAMPLE.COM/hunter2", "https://api.example.com"],
    ["  https://example.com/hunter2  ", "https://example.com"],
    // The default port is the scheme's: nothing to say.
    ["https://example.com:443/x", "https://example.com"],
  ])("%s is %s", (url: string, written: string) => {
    expect(MonitorUrlInText.write(url)).toBe(written);
  });

  test("never the text itself, when it is no URL", () => {
    for (const text of [
      MARK,
      "",
      undefined,
      null,
      `not a url ${MARK}`,
      `https://exa mple.com/?key=${MARK}`,
      `mailto:${MARK}@example.com`,
      `file:///etc/${MARK}`,
    ]) {
      expect(MonitorUrlInText.write(text)).toBe(NOT_A_URL);
    }
  });
});

describe("every URL in a text is written so, the sentence around it kept", () => {
  test("the issue's failure cause: a request that failed, its key in the query", () => {
    expect(
      MonitorUrlInText.writeUrls(
        `Request failed to https://api.example.com/health?key=${MARK}. socket hang up`,
      ),
    ).toBe("Request failed to https://api.example.com. socket hang up");
  });

  test.each([
    ["the path", `https://hooks.example.com/services/${MARK}/ping`],
    ["the query", `https://api.example.com/v1?token=${MARK}&format=json`],
    ["a query value with no name", `https://api.example.com/v1?${MARK}`],
    ["the fragment", `https://app.example.com/#access_token=${MARK}`],
    ["the credentials", `https://ops:${MARK}@api.example.com/health`],
    ["a percent-encoded value", `https://api.example.com/?k=${MARK}%20%22x%22`],
    ["a backslash in the query", `https://api.example.com/?k=a\\${MARK}`],
    ["braces and a pipe", `https://api.example.com/?k={${MARK}}|x`],
  ])("wherever the secret sits: %s", (_where: string, url: string) => {
    const written: string = MonitorUrlInText.writeUrls(
      `Request failed to ${url}. connect ECONNREFUSED 127.0.0.1:443`,
    );

    expect(written).not.toContain(MARK);
    expect(written).toMatch(
      /^Request failed to https:\/\/[a-z.]+\. connect ECONNREFUSED 127\.0\.0\.1:443$/,
    );
  });

  test("each URL of a text, a redirect's next hop on another host too", () => {
    expect(
      MonitorUrlInText.writeUrls(
        `Redirected from http://a.example.com/x?k=${MARK} to https://b.example.com:8443/login?next=/x%3Fk%3D${MARK}, which refused it`,
      ),
    ).toBe(
      "Redirected from http://a.example.com to https://b.example.com:8443, which refused it",
    );
  });

  test("a URL in quotes or angle brackets ends there", () => {
    expect(
      MonitorUrlInText.writeUrls(
        `navigating to "https://app.example.com/login?otp=${MARK}", waiting until "load" <https://app.example.com/${MARK}>`,
      ),
    ).toBe(
      'navigating to "https://app.example.com", waiting until "load" <https://app.example.com>',
    );
  });

  test("a text with no URL is as it was", () => {
    for (const text of [
      "Connection Refused.",
      "Server returned HTTP status 503",
      "getaddrinfo ENOTFOUND api.example.com",
      "Timeout Error.",
      "",
      "the word https without its slashes",
    ]) {
      expect(MonitorUrlInText.writeUrls(text)).toBe(text);
    }
  });

  test("writing twice writes the same", () => {
    const once: string = MonitorUrlInText.writeUrls(
      `Request failed to https://api.example.com/health?key=${MARK}. socket hang up`,
    );

    expect(MonitorUrlInText.writeUrls(once)).toBe(once);
  });
});

describe("the URLs the check sent are found exactly", () => {
  test("a query value that ends in sentence marks is never cut in two", () => {
    const sent: string = `https://api.example.com/health?key=${MARK}!.)`;
    const text: string = `Request failed to ${sent}. socket hang up`;

    // Without it, the marks the value ends in are read as the sentence's.
    expect(MonitorUrlInText.writeUrls(text)).toBe(
      "Request failed to https://api.example.com!.). socket hang up",
    );
    expect(MonitorUrlInText.writeUrls(text, [sent])).toBe(
      "Request failed to https://api.example.com. socket hang up",
    );
  });

  test("an address that is no URL, quoted whole by a refusal, says nothing of itself", () => {
    const sent: string = `https://api.exa mple.com/health?key=${MARK} end`;
    const written: string = MonitorUrlInText.writeUrls(
      `Invalid monitor target URL: ${sent}`,
      [sent],
    );

    expect(written).toBe(`Invalid monitor target URL: ${NOT_A_URL}`);
    expect(written).not.toContain(MARK);
  });

  test("the longest is found first, so one never cuts another", () => {
    const short: string = "https://api.example.com/v1";
    const long: string = `${short}?key=${MARK}.end`;

    expect(
      MonitorUrlInText.writeUrls(`Request failed to ${long}. Retry ${short}.`, [
        short,
        long,
        undefined,
        null,
        "",
      ]),
    ).toBe(
      "Request failed to https://api.example.com. Retry https://api.example.com.",
    );
  });

  test("400 seeded-random secrets, in every part of the URL, never reach the text", () => {
    const random: SeededRandom = seededRandom(10785);
    const alphabet: string =
      "abcXYZ019-_.~!$&'()*+,;=:@/?#[]%\\\"<>`{}|^ é日😀";

    const secretOf: () => string = (): string => {
      let secret: string = MARK;

      for (let index: number = 0; index < 1 + random(12); index++) {
        secret += alphabet.charAt(random(alphabet.length));
      }

      return secret;
    };

    for (let round: number = 0; round < 400; round++) {
      const secret: string = secretOf();
      const configured: Array<string> = [
        `https://api.example.com/{{secret}}/health`,
        `https://api.example.com/health?key={{secret}}`,
        `https://api.example.com/health?a=1&key={{secret}}&b=2`,
        `https://api.example.com/health#{{secret}}`,
        `https://ops:{{secret}}@api.example.com/health`,
      ];
      const url: string = (configured[random(configured.length)] as string)
        .split("{{secret}}")
        .join(secret);

      // As the probe sends it: the URL as WHATWG writes it, else as handed over.
      let dispatched: string = url;

      try {
        dispatched = new globalThis.URL(url).href;
      } catch {
        // A secret that makes it no URL: the refusal quotes it as handed over.
      }

      const sentence: string = [
        `Request failed to ${dispatched}. socket hang up`,
        `Invalid monitor target URL: ${url}`,
        `Request failed to ${dispatched}, then ${dispatched}.`,
      ][random(3)] as string;

      const written: string = MonitorUrlInText.writeUrls(sentence, [
        url,
        dispatched,
      ]);

      expect({ round, written, holdsMark: written.includes(MARK) }).toEqual({
        round,
        written,
        holdsMark: false,
      });
    }
  });
});

describe("what a check reports", () => {
  const sent: string = `https://api.example.com/health?key=${MARK}`;

  function attempt(failureCause: string | undefined): ProbeAttempt {
    return {
      attemptNumber: 1,
      attemptedAt: new Date("2026-11-23T10:00:00.000Z"),
      responseReceivedAt: new Date("2026-11-23T10:00:01.000Z"),
      isOnline: false,
      failureCause: failureCause,
    };
  }

  test("each attempt's failure cause, a copy, the attempts themselves as they were", () => {
    const attempts: Array<ProbeAttempt> = [
      attempt(`Request failed to ${sent}. socket hang up`),
      attempt(undefined),
    ];

    const written: Array<ProbeAttempt> | undefined =
      MonitorUrlInText.writeAttempts(attempts, [sent]);

    expect(written?.[0]?.failureCause).toBe(
      "Request failed to https://api.example.com. socket hang up",
    );
    expect(written?.[1]).toEqual(attempts[1]);
    expect(attempts[0]?.failureCause).toContain(MARK);
    expect(MonitorUrlInText.writeAttempts(undefined)).toBeUndefined();
  });

  test("why the request failed: its explanation and its raw message", () => {
    const details: RequestFailedDetails = {
      failedPhase: RequestFailedPhase.Unknown,
      errorCode: "ECONNRESET",
      errorDescription: `The request failed: Request failed to ${sent}. socket hang up`,
      rawErrorMessage: `Request failed to ${sent}. socket hang up`,
    };

    expect(MonitorUrlInText.writeRequestFailedDetails(details, [sent])).toEqual(
      {
        failedPhase: RequestFailedPhase.Unknown,
        errorCode: "ECONNRESET",
        errorDescription:
          "The request failed: Request failed to https://api.example.com. socket hang up",
        rawErrorMessage:
          "Request failed to https://api.example.com. socket hang up",
      },
    );
    // A copy: the details handed in are as they were.
    expect(details.rawErrorMessage).toContain(MARK);
  });

  test("a probe's whole report, as the server takes it in: a copy, everything else kept", () => {
    const monitorStepId: ObjectID = ObjectID.generate();
    const report: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      monitorStepId: monitorStepId,
      isOnline: false,
      responseCode: undefined,
      failureCause: `Request failed to ${sent}. socket hang up`,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.NetworkError,
        errorDescription: "The request was sent but no response was returned.",
        rawErrorMessage: `Request failed to ${sent}. socket hang up`,
      },
      probeAttempts: [attempt(`Request failed to ${sent}. socket hang up`)],
      externalStatusPageResponse: {
        isOnline: false,
        overallStatus: "unknown",
        componentStatuses: [],
        activeIncidentCount: 0,
        responseTimeInMs: 12,
        failureCause: `Invalid monitor target URL: ${sent}`,
        probeAttempts: [attempt(`Invalid monitor target URL: ${sent}`)],
      },
      monitoredAt: new Date("2026-11-23T10:00:01.000Z"),
    };

    const written: ProbeMonitorResponse =
      MonitorUrlInText.writeProbeResponse(report);

    expect(JSON.stringify(written)).not.toContain(MARK);
    expect(written.failureCause).toBe(
      "Request failed to https://api.example.com. socket hang up",
    );
    expect(written.externalStatusPageResponse?.failureCause).toBe(
      "Invalid monitor target URL: https://api.example.com",
    );
    expect(written.monitorStepId).toBe(monitorStepId);
    expect(written.monitoredAt).toBe(report.monitoredAt);
    expect(written.externalStatusPageResponse?.responseTimeInMs).toBe(12);

    // The report handed in is as it was.
    expect(report.failureCause).toContain(MARK);
    expect(report.externalStatusPageResponse?.failureCause).toContain(MARK);
  });

  test("a report that says no failure is as it was", () => {
    const report: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      isOnline: true,
      failureCause: "",
      monitoredAt: new Date("2026-11-23T10:00:01.000Z"),
    };

    expect(MonitorUrlInText.writeProbeResponse(report)).toEqual(report);
  });
});

describe("time in line with the text's length", () => {
  test("a URL that ends in 200,000 sentence marks, and 20,000 URLs", () => {
    const marks: string = `Request failed to https://api.example.com/${".".repeat(200_000)}x${"!".repeat(200_000)} end`;
    const many: string = `https://api.example.com/${MARK} `.repeat(20_000);

    const timed: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return [
          MonitorUrlInText.writeUrls(marks),
          MonitorUrlInText.writeUrls(many, [`https://api.example.com/${MARK}`]),
        ];
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result[0]).toBe(
      `Request failed to https://api.example.com${"!".repeat(200_000)} end`,
    );
    expect(timed.result[1]).not.toContain(MARK);
  });
});
