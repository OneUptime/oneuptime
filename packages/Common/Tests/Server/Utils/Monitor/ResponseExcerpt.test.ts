import ResponseExcerpt, {
  MatchExcerptResult,
  ResponseText,
} from "../../../../Server/Utils/Monitor/ResponseExcerpt";
import {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationExcerpt,
} from "../../../../Types/Monitor/MonitorEvaluationDetails";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PART OF A RESPONSE AN INCIDENT KEEPS: A FEW LINES AROUND THE MATCH.
 *
 * Bounded either side of the match, never the whole body; redacted before it
 * is cut, so nothing secret is cut into a piece no rule recognizes; and for
 * a JSON response, the path of the field that holds the match.
 */

const REDACTED: string = "[REDACTED]";
const CONTEXT: number = MonitorEvaluationDetailsLimits.excerptContextChars;

function around(body: unknown, needle: string): MatchExcerptResult | null {
  const response: ResponseText | null = ResponseExcerpt.readText(body);

  return response
    ? ResponseExcerpt.aroundMatch({ response: response, needle: needle })
    : null;
}

function wholeText(excerpt: MonitorEvaluationExcerpt): string {
  return excerpt.before + excerpt.match + excerpt.after;
}

describe("the text an excerpt is cut from", () => {
  test("a JSON body is read as written, with its secrets located", () => {
    const response: ResponseText = ResponseExcerpt.readText(
      '{"status":"down","token":"t-1"}',
    )!;

    expect(response.text).toBe('{"status":"down","token":"t-1"}');
    expect(response.scan?.sensitiveSpans).toHaveLength(1);
  });

  test("a body the probe stored as a JSON string is read as its text", () => {
    expect(
      ResponseExcerpt.readText(JSON.stringify("<html>Error 500</html>"))!.text,
    ).toBe("<html>Error 500</html>");
  });

  test("an HTML body is text, with no JSON structure", () => {
    const response: ResponseText = ResponseExcerpt.readText(
      "<html><body>Service Unavailable</body></html>",
    )!;

    expect(response.scan).toBeUndefined();
  });

  test("an object body is written as JSON", () => {
    expect(ResponseExcerpt.readText({ status: "down" })!.text).toBe(
      '{"status":"down"}',
    );
  });

  test("a body past the scanned limit is text, never parsed whole", () => {
    const big: string =
      '{"data":"' +
      "x".repeat(MonitorEvaluationDetailsLimits.scannedBodyChars) +
      '"}';

    expect(ResponseExcerpt.readText(big)!.scan).toBeUndefined();
  });

  test("no body is no text", () => {
    expect(ResponseExcerpt.readText(undefined)).toBeNull();
    expect(ResponseExcerpt.readText("")!.text).toBe("");
  });
});

describe("an excerpt around the match", () => {
  test("keeps the match and a bounded stretch either side", () => {
    const body: string =
      "a".repeat(5000) +
      " the payment provider returned error 503 " +
      "b".repeat(5000);

    const result: MatchExcerptResult = around(body, "error 503")!;
    const excerpt: MonitorEvaluationExcerpt = result.excerpt!;

    expect(excerpt.match).toBe("error 503");
    expect(excerpt.before.length).toBeLessThanOrEqual(CONTEXT);
    expect(excerpt.after.length).toBeLessThanOrEqual(CONTEXT);
    expect(excerpt.isCutAtStart).toBe(true);
    expect(excerpt.isCutAtEnd).toBe(true);
    expect(wholeText(excerpt).length).toBeLessThan(body.length / 10);
  });

  test("a short body is kept whole, and says it was not cut", () => {
    const result: MatchExcerptResult = around('{"status":"error"}', "error")!;

    expect(result.excerpt).toEqual({
      before: '{"status":"',
      match: "error",
      after: '"}',
      isCutAtStart: false,
      isCutAtEnd: false,
    });
  });

  test("names the JSON path of the field that holds the match", () => {
    const body: string = JSON.stringify({
      service: "checkout",
      checks: [
        { name: "db", status: "ok" },
        { name: "payments", status: "error: connection refused" },
      ],
    });

    expect(around(body, "connection refused")!.path).toBe("checks[1].status");
  });

  test("a match in a key names that key's path", () => {
    expect(around('{"data":{"errorCount":3}}', "errorCount")!.path).toBe(
      "data.errorCount",
    );
  });

  test("an HTML body has no path", () => {
    expect(around("<p>Error</p>", "Error")!.path).toBeUndefined();
  });

  test("white space runs read as one space", () => {
    const result: MatchExcerptResult = around(
      "line one\n\n\n    error here\t\tand more",
      "error",
    )!;

    expect(result.excerpt!.before).toBe("line one ");
    expect(result.excerpt!.after).toBe(" here and more");
  });

  test("a needle that is not in the body has no excerpt", () => {
    expect(around('{"status":"ok"}', "error")).toBeNull();
  });

  test("a match longer than the limit is cut to it", () => {
    const long: string = "e".repeat(1000);
    const result: MatchExcerptResult = around(`x ${long} y`, long)!;

    expect(result.excerpt!.match.length).toBe(
      MonitorEvaluationDetailsLimits.matchChars,
    );
  });

  test("never cuts a character outside the basic plane in two", () => {
    const body: string = "😀".repeat(400) + "error" + "😀".repeat(400);
    const excerpt: MonitorEvaluationExcerpt = around(body, "error")!.excerpt!;

    for (const part of [excerpt.before, excerpt.after]) {
      const first: number = part.charCodeAt(0);
      const last: number = part.charCodeAt(part.length - 1);

      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe("what the excerpt masks", () => {
  test("the value of a JSON field named secret, beside the match", () => {
    const body: string = JSON.stringify({
      status: "error",
      token: "tok_live_abcdef",
      user: { email: "jane@example.com", name: "Jane" },
    });

    const text: string = wholeText(around(body, "error")!.excerpt!);

    expect(text).not.toContain("tok_live_abcdef");
    expect(text).not.toContain("jane@example.com");
    expect(text).toContain(REDACTED);
    expect(text).toContain('"name":"Jane"');
  });

  test("a whole secret object, however it is nested", () => {
    const body: string = JSON.stringify({
      error: "expired",
      session: { id: "abc", refresh: { value: "deep-secret" } },
    });

    const text: string = wholeText(around(body, "expired")!.excerpt!);

    expect(text).not.toContain("deep-secret");
    expect(text).not.toContain('"id":"abc"');
  });

  test("text that looks like a credential, in an HTML body", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const body: string = `<p>Error: request with Authorization: Bearer abcdef.123456 and ${jwt} failed for ops@example.com, card 4111 1111 1111 1111</p>`;

    const text: string = wholeText(around(body, "Error")!.excerpt!);

    expect(text).not.toContain("abcdef.123456");
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("ops@example.com");
    expect(text).not.toContain("4111 1111 1111 1111");
    expect(text).toContain("failed");
  });

  test("a secret that runs into the excerpt from outside it is masked whole", () => {
    // A long token that starts well before what the excerpt keeps.
    const token: string = "Q".repeat(600) + "7";
    const body: string = `{"password":"${token}","status":"error"}`;

    const text: string = wholeText(around(body, "error")!.excerpt!);

    expect(text).not.toContain("QQQQ");
  });

  test("a text secret whose name sits far before the excerpt is masked", () => {
    // Only the name before it says the long value is a password.
    const body: string =
      "password: " + "Q".repeat(2000) + "7 status error happened";

    const text: string = wholeText(around(body, "error")!.excerpt!);

    expect(text).not.toContain("QQQQ");
    expect(text).toContain("status");
  });

  test("an email cut by the window's edge is still masked", () => {
    const body: string =
      "x ".repeat(400) +
      "error " +
      " ".repeat(150) +
      "someone.with.a.long.name@example.com tail";

    const text: string = wholeText(around(body, "error")!.excerpt!);

    expect(text).not.toContain("@example.com");
  });

  test("a bearer token whose scheme sits before the window is masked", () => {
    const body: string =
      "Authorization: Bearer " +
      "a1b2c3d4".repeat(90) +
      " " +
      "y".repeat(10) +
      " error";

    const text: string = wholeText(around(body, "error")!.excerpt!);

    expect(text).not.toContain("a1b2c3d4a1b2");
  });

  test("a match that is part of a masked value has no excerpt", () => {
    const result: MatchExcerptResult = around(
      '{"token":"error-token-value","status":"ok"}',
      "error-token",
    )!;

    expect(result.isMatchMasked).toBe(true);
    expect(result.excerpt).toBeUndefined();
  });

  test("an excerpt is never cut through a [REDACTED] marker", () => {
    const body: string = JSON.stringify({
      a: "x".repeat(150),
      token: "secret",
      b: "error",
    });

    const excerpt: MonitorEvaluationExcerpt = around(body, "error")!.excerpt!;

    expect(excerpt.before.startsWith("ACTED]")).toBe(false);
    expect(excerpt.before.startsWith("]")).toBe(false);
    expect(
      excerpt.before.indexOf("[RED") === -1 ||
        excerpt.before.includes(REDACTED),
    ).toBe(true);
  });
});

describe("the start of a response, for a filter with nothing to point at", () => {
  test("keeps how the body begins, bounded", () => {
    const body: string =
      "<html><head><title>Maintenance</title></head>" + "z".repeat(5000);
    const excerpt: MonitorEvaluationExcerpt = ResponseExcerpt.atStart({
      response: ResponseExcerpt.readText(body)!,
    })!;

    expect(excerpt.match).toBe("");
    expect(excerpt.before).toBe("");
    expect(excerpt.after.startsWith("<html><head><title>Maintenance")).toBe(
      true,
    );
    expect(excerpt.after.length).toBeLessThanOrEqual(
      MonitorEvaluationDetailsLimits.startExcerptChars,
    );
    expect(excerpt.isCutAtEnd).toBe(true);
  });

  test("masks as the match excerpt does", () => {
    const excerpt: MonitorEvaluationExcerpt = ResponseExcerpt.atStart({
      response: ResponseExcerpt.readText(
        '{"apiKey":"k-123","owner":"ops@example.com","status":"degraded"}',
      )!,
    })!;

    expect(excerpt.after).not.toContain("k-123");
    expect(excerpt.after).not.toContain("ops@example.com");
    expect(excerpt.after).toContain('"status":"degraded"');
  });

  test("an empty body has none", () => {
    expect(ResponseExcerpt.atStart({ response: { text: "   " } })).toBeNull();
  });
});

describe("a body written to break it", () => {
  test("a match at the end of a 2 MB JSON body takes time in line with it", () => {
    const body: string = JSON.stringify({
      items: Array.from({ length: 40000 }, (_value: unknown, index: number) => {
        return { id: index, token: "t" + index, note: "fine" };
      }),
      status: "error at the end",
    });

    const run: FastestRun<MatchExcerptResult | null> = fastestRun({
      run: (): MatchExcerptResult | null => {
        return around(body, "error at the end");
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result!.path).toBe("status");
  });

  test.each([
    ["no boundary at all", "e".repeat(400000)],
    ["a match on every word", "error ".repeat(66000)],
    ["quotes everywhere", '"'.repeat(400000)],
  ])("%s", (_name: string, body: string) => {
    const run: FastestRun<MatchExcerptResult | null> = fastestRun({
      run: (): MatchExcerptResult | null => {
        return around(body, "e");
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
