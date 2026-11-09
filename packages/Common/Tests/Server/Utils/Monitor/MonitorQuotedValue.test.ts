import MonitorQuotedValue from "../../../../Server/Utils/Monitor/MonitorQuotedValue";
import { MonitorEvaluationDetailsLimits } from "../../../../Types/Monitor/MonitorEvaluationDetails";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * A VALUE THE MONITORED SYSTEM SENT, AS A ROOT CAUSE QUOTES IT (#6341).
 *
 * "Error is not empty. Value: ..." goes out in email, Slack and Teams and
 * is kept on the incident, the alert and the status timeline. The value is
 * redacted by the rules an incident's evidence is cut by, put on one line,
 * and bounded at what the evaluation details keep of one value.
 */

const REDACTED: string = "[REDACTED]";

const JWT: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("what a quote keeps of a value", () => {
  test("a short value is quoted as it is", () => {
    expect(MonitorQuotedValue.quote("connection refused")).toBe(
      "connection refused",
    );
    expect(MonitorQuotedValue.quote(42)).toBe("42");
    expect(MonitorQuotedValue.quote(0.5)).toBe("0.5");
    expect(MonitorQuotedValue.quote(false)).toBe("false");
  });

  test("nothing quotes as nothing", () => {
    expect(MonitorQuotedValue.quote(null)).toBe("");
    expect(MonitorQuotedValue.quote(undefined)).toBe("");
    expect(MonitorQuotedValue.quote("")).toBe("");
  });

  test("credentials and personal data in a text are masked", () => {
    expect(
      MonitorQuotedValue.quote(
        `401 for jane@acme.example: Authorization: Bearer ${JWT}`,
      ),
    ).toBe(`401 for ${REDACTED}: Authorization: ${REDACTED}`);
    expect(
      MonitorQuotedValue.quote("connect failed: password=hunter2 port=5432"),
    ).toBe(`connect failed: password=${REDACTED} port=5432`);
    expect(MonitorQuotedValue.quote("card 4111 1111 1111 1111 declined")).toBe(
      `card ${REDACTED} declined`,
    );
    expect(
      MonitorQuotedValue.quote("postgres://app:s3cr3t@db.acme.example/app"),
    ).toBe(`postgres://app:${REDACTED}@db.acme.example/app`);
  });

  test("a JSON value is quoted as JSON, its credential and personal fields masked", () => {
    expect(
      MonitorQuotedValue.quote({
        status: "down",
        owner: { email: "jane@acme.example", apiKey: "k-1" },
        retries: 3,
      }),
    ).toBe(
      `{"status":"down","owner":{"email":"${REDACTED}","apiKey":"${REDACTED}"},"retries":3}`,
    );
    expect(MonitorQuotedValue.quote([1, "two", { token: "t" }])).toBe(
      `[1,"two",{"token":"${REDACTED}"}]`,
    );
  });

  test("a value is quoted on one line", () => {
    expect(
      MonitorQuotedValue.quote(
        "Error: boom\n    at main (app.js:1:1)\r\n\tat run (app.js:2:2)",
      ),
    ).toBe("Error: boom at main (app.js:1:1) at run (app.js:2:2)");
    expect(
      MonitorQuotedValue.quote("a\u00a0b\u2028c\u2029d\fe\vf  \n\n  g\n"),
    ).toBe("a b c d e f g");
    expect(MonitorQuotedValue.quote("\n\n  indented")).toBe("indented");
  });

  test("a long value is cut at what the evaluation details keep of one value", () => {
    expect(MonitorEvaluationDetailsLimits.valueChars).toBe(300);

    const quote: string = MonitorQuotedValue.quote("a".repeat(600));

    expect(quote).toBe(`${"a".repeat(300)}…`);
    expect(MonitorQuotedValue.quote("a".repeat(300))).toBe("a".repeat(300));
    expect(MonitorQuotedValue.quote("a".repeat(301))).toBe(
      `${"a".repeat(300)}…`,
    );
    expect(MonitorQuotedValue.quote("b".repeat(200), 120)).toBe(
      `${"b".repeat(120)}…`,
    );
  });

  test("a secret across the cut is masked whole, never half shown", () => {
    // The token starts at character 289 and runs past the cut at 300.
    const quote: string = MonitorQuotedValue.quote(
      `${"x".repeat(280)} Bearer ${JWT}`,
    );

    expect(quote).toBe(`${"x".repeat(280)} Bearer ${REDACTED}`);
    expect(quote).not.toContain(JWT.slice(0, 8));
  });

  test("a character outside the basic plane is never cut in two", () => {
    const quote: string = MonitorQuotedValue.quote(`${"a".repeat(299)}😀z`);

    expect(quote).toBe(`${"a".repeat(299)}…`);
    expect(MonitorQuotedValue.bound("ab😀", 3)).toBe("ab…");
    expect(MonitorQuotedValue.bound("ab😀", 4)).toBe("ab😀");
  });

  test("a value that holds itself is read to a depth, and bounded", () => {
    const loop: { name: string; self?: unknown } = { name: "loop" };
    loop.self = loop;

    const quote: string = MonitorQuotedValue.quote(loop);

    expect(quote.startsWith('{"name":"loop","self":{"name":"loop"')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(301);
  });

  test("a value that is no text, number or JSON quotes as nothing", () => {
    expect(MonitorQuotedValue.quote(Symbol("s"))).toBe("");
    expect(
      MonitorQuotedValue.quote((): string => {
        return "f";
      }),
    ).toBe("");
  });
});

describe("a quote takes time in line with what it quotes", () => {
  test.each([
    ["one long word", "a".repeat(400000)],
    ["white space", " \n\t".repeat(133334)],
    ["addresses", "jane@acme.example ".repeat(22223)],
    ["tokens", "Bearer abc.def.ghi ".repeat(21053)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return MonitorQuotedValue.quote(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.length).toBeLessThanOrEqual(301);
  });
});
