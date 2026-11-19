import { describe, expect, test } from "@jest/globals";
import {
  SESSION_REPLAY_READABLE_VALUE_PATTERN,
  isSessionReplayReadableValue,
  maskSessionReplayProperties,
  normalizeSessionReplayReadablePropertyKeys,
} from "../../../Types/Rum/SessionReplayReadableProperties";
import { normalizeProductAnalyticsUserPropertyKeys } from "../../../Types/Rum/ProductAnalyticsEvents";
import CommonMasking from "../../../Utils/Rum/Masking";

/*
 * Readable event properties (issue #7501): under Mask all text a listed
 * key keeps its value as written while the value is a short token, and
 * everything else - a listed key's sentence, an unlisted key's token - is
 * masked as it always was.
 */

const MASK: (value: string) => string = (value: string): string => {
  return CommonMasking.maskText(value);
};

describe("isSessionReplayReadableValue", () => {
  test("a short code-chosen token is readable", () => {
    for (const value of [
      "",
      "checkout",
      "step_3",
      "monitor.website",
      "plan:pro",
      "/settings/billing",
      "a-b-c",
      "x".repeat(32),
      "0",
      "2026-11-19",
    ]) {
      expect({ value, readable: isSessionReplayReadableValue(value) }).toEqual({
        value,
        readable: true,
      });
    }
  });

  test("text a person wrote, or anything long, is not", () => {
    for (const value of [
      "Jane Doe",
      "jane@acme.com",
      "x".repeat(33),
      "hello world",
      "café",
      "a\nb",
      "a\tb",
      "<b>",
      "50%",
      "+15551230100",
      "Hartwell Ltd",
      "a,b",
      "a?b=c",
      "#top",
      " step",
    ]) {
      expect({ value, readable: isSessionReplayReadableValue(value) }).toEqual({
        value,
        readable: false,
      });
    }
  });

  test("is the shape a data-* attribute is kept in under Mask all text", () => {
    expect(SESSION_REPLAY_READABLE_VALUE_PATTERN.source).toBe(
      "^[A-Za-z0-9_.:/-]{0,32}$",
    );
  });
});

describe("normalizeSessionReplayReadablePropertyKeys", () => {
  test("reads the list as product analytics reads the traits it keeps", () => {
    for (const value of [
      undefined,
      null,
      "step",
      [" step ", "step", "Step", "", 7, "plan"],
      ["k".repeat(60)],
      Array.from({ length: 30 }, (_value: unknown, index: number): string => {
        return `key${index}`;
      }),
      ["__proto__", "ok"],
    ]) {
      expect(normalizeSessionReplayReadablePropertyKeys(value)).toEqual(
        normalizeProductAnalyticsUserPropertyKeys(value),
      );
    }

    expect(
      normalizeSessionReplayReadablePropertyKeys([" step ", "step", "plan"]),
    ).toEqual(["step", "plan"]);
    expect(normalizeSessionReplayReadablePropertyKeys("step")).toEqual([]);
  });
});

describe("maskSessionReplayProperties", () => {
  test("with no keys listed, every value is masked: the default", () => {
    const masked: Record<string, string> = maskSessionReplayProperties(
      { step: "billing", plan: "pro", name: "Jane Doe" },
      [],
      MASK,
    );

    expect(masked).toEqual({
      step: MASK("billing"),
      plan: MASK("pro"),
      name: MASK("Jane Doe"),
    });

    for (const value of Object.values(masked)) {
      expect(value).toMatch(/^•+$/);
    }
  });

  test("a listed key keeps its token; its sentence, and every unlisted key, are masked", () => {
    expect(
      maskSessionReplayProperties(
        {
          step: "billing",
          setup: "monitor.website",
          plan: "pro",
          note: "Jane Doe asked for a refund",
        },
        ["step", "setup", "note"],
        MASK,
      ),
    ).toEqual({
      step: "billing",
      setup: "monitor.website",
      plan: MASK("pro"),
      note: MASK("Jane Doe asked for a refund"),
    });
  });

  test("a listed key whose value is an email or too long is masked", () => {
    expect(
      maskSessionReplayProperties(
        { user: "jane@acme.com", id: "x".repeat(33) },
        ["user", "id"],
        MASK,
      ),
    ).toEqual({ user: MASK("jane@acme.com"), id: MASK("x".repeat(33)) });
  });

  test("keys are matched as written", () => {
    expect(
      maskSessionReplayProperties({ Step: "billing" }, ["step"], MASK),
    ).toEqual({ Step: MASK("billing") });
  });

  test("keys are never masked, and the mask is asked only for what it masks", () => {
    const asked: Array<string> = [];

    const masked: Record<string, string> = maskSessionReplayProperties(
      { step: "billing", plan: "pro" },
      ["step"],
      (value: string): string => {
        asked.push(value);
        return "•";
      },
    );

    expect(Object.keys(masked)).toEqual(["step", "plan"]);
    expect(asked).toEqual(["pro"]);
  });

  test("a mode that masks nothing leaves every value as written", () => {
    const asWritten: (value: string) => string = (value: string): string => {
      return value;
    };

    expect(
      maskSessionReplayProperties(
        { step: "billing", note: "Jane Doe" },
        ["step"],
        asWritten,
      ),
    ).toEqual({ step: "billing", note: "Jane Doe" });
  });
});
