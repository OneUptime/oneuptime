import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONObject } from "Common/Types/JSON";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { describe, expect, test } from "@jest/globals";

/*
 * Scrubbing of the DENORMALIZED LLM identity columns.
 *
 * The privacy bug this file exists to prevent, stated plainly:
 *
 * OneUptime copies a small set of values out of a span's attributes into
 * first-class ClickHouse columns at ingest — user.email becomes llmUserEmail,
 * and so on (Common/Server/Utils/Telemetry/LlmSpan.ts). That copy happens
 * BEFORE TraceScrubRuleService runs. Until the identity-column pass was added
 * to scrubSpan, the copies bypassed every scrub rule a project had
 * configured: a customer could enable an Email redaction rule, watch it
 * visibly redact "user.email" inside the attributes map, and still have the
 * identical address stored in the clear in llmUserEmail — indexed,
 * queryable, and exported. The rule LOOKS active in the rules table. That is
 * the worst shape a privacy failure can take, because nothing signals it.
 *
 * The scope choice is the other half, and it cuts both ways: these columns
 * are derived FROM attributes, so an Attributes-scoped rule must reach them,
 * and a Name-scoped rule must NOT — otherwise "redact the span name" would
 * quietly start deleting chargeback data that the rule's author never
 * intended to touch.
 *
 * Rules are compiled through the service's real getRegexForPattern rather
 * than with hand-written regexes, so these tests exercise the same built-in
 * Email / SensitiveKeys patterns production uses.
 */

type CompiledRule = {
  rule: TraceScrubRule;
  regex: RegExp;
};

function compile(data: {
  patternType: TraceScrubPatternType;
  fieldsToScrub: TraceScrubField;
  scrubAction?: TraceScrubAction;
  customRegex?: string;
}): Array<CompiledRule> {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "test-rule";
  rule.patternType = data.patternType;
  rule.fieldsToScrub = data.fieldsToScrub;
  rule.scrubAction = data.scrubAction || TraceScrubAction.Redact;

  if (data.customRegex) {
    rule.customRegex = data.customRegex;
  }

  /*
   * getRegexForPattern is private; reaching it through the index signature
   * keeps the test on the REAL compiled pattern instead of a copy that could
   * drift from the built-in list.
   */
  const regex: RegExp | null = (
    TraceScrubRuleService as unknown as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => RegExp | null;
    }
  ).getRegexForPattern(data.patternType as string, data.customRegex);

  expect(regex).not.toBeNull();

  return [{ rule: rule, regex: regex as RegExp }];
}

function spanRow(overrides?: JSONObject): JSONObject {
  return {
    name: "chat gpt-4o",
    attributes: {
      "gen_ai.system": "openai",
      "user.email": "ada@example.com",
    },
    events: [],
    llmUserId: "acct-9f2",
    llmUserEmail: "ada@example.com",
    llmTeam: "platform",
    ...overrides,
  };
}

describe("TraceScrubRuleService.scrubSpan — denormalized identity columns", () => {
  test("an Attributes-scoped Email rule redacts llmUserEmail", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
      }) as never,
    );

    expect(row["llmUserEmail"]).toBe("[REDACTED]");
  });

  test("an All-scoped Email rule redacts llmUserEmail", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.All,
      }) as never,
    );

    expect(row["llmUserEmail"]).toBe("[REDACTED]");
  });

  /*
   * The column and the attribute it was COPIED FROM must end up in the same
   * state. A test that only checked the column would still pass if the
   * attribute pass regressed, and vice versa; the point of the feature is
   * that the two cannot disagree.
   */
  test("the column and its source attribute are redacted identically", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
      }) as never,
    );

    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(attributes["user.email"]).toBe("[REDACTED]");
    expect(row["llmUserEmail"]).toBe(attributes["user.email"]);
  });

  test("no email survives anywhere in the row after an Email rule", () => {
    /*
     * The adversarial version of the assertion: serialize the whole scrubbed
     * row and prove the address is not in it. This is the check that would
     * have caught the original gap regardless of which field held the leak.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.All,
      }) as never,
    );

    expect(JSON.stringify(row)).not.toContain("ada@example.com");
  });

  test("a Name-scoped rule does NOT touch the identity columns", () => {
    /*
     * The other direction. These columns are derived from attributes, so a
     * rule scoped to the span NAME has no business rewriting them — a
     * "redact emails from span names" rule must not start deleting
     * chargeback data as a side effect.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow({ name: "chat for ada@example.com" }),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Name,
      }) as never,
    );

    expect(row["name"]).toBe("chat for [REDACTED]");
    expect(row["llmUserEmail"]).toBe("ada@example.com");
    expect(row["llmUserId"]).toBe("acct-9f2");
    expect(row["llmTeam"]).toBe("platform");
  });

  test("an Events-scoped rule does NOT touch the identity columns", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow({
        events: [{ attributes: { "log.message": "ada@example.com" } }],
      }),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Events,
      }) as never,
    );

    const events: Array<JSONObject> = row["events"] as Array<JSONObject>;
    const eventAttributes: JSONObject = events[0]!["attributes"] as JSONObject;

    expect(eventAttributes["log.message"]).toBe("[REDACTED]");
    expect(row["llmUserEmail"]).toBe("ada@example.com");
  });

  /*
   * SensitiveKeys is KEY-targeted: it matches attribute KEYS, and scrubSpan
   * promotes it to All scope so a name-only save is not a silent no-op. It
   * must therefore reach the identity-column pass — and, because these are
   * bare values with no attribute key to match, leave them alone while still
   * redacting the sensitive attribute. Getting this wrong in the other
   * direction would blank every llmUserEmail on every project that has a
   * SensitiveKeys rule.
   */
  test("a SensitiveKeys rule redacts the sensitive attribute but not the identity columns", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow({
        attributes: {
          "user.email": "ada@example.com",
          "http.request.header.authorization": "Bearer sk-live-123",
        },
      }),
      compile({
        patternType: TraceScrubPatternType.SensitiveKeys,
        fieldsToScrub: TraceScrubField.Attributes,
      }) as never,
    );

    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(attributes["http.request.header.authorization"]).toBe("[REDACTED]");
    expect(row["llmUserEmail"]).toBe("ada@example.com");
    expect(row["llmUserId"]).toBe("acct-9f2");
  });

  test("a custom regex rule scrubs llmUserId and llmTeam too", () => {
    /*
     * Identity is not only email. An organization whose internal account ids
     * are themselves sensitive configures a Custom rule; it has to reach the
     * id and team columns, not just the email one.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Custom,
        fieldsToScrub: TraceScrubField.Attributes,
        customRegex: "acct-[a-z0-9]+",
      }) as never,
    );

    expect(row["llmUserId"]).toBe("[REDACTED]");
    // The team value does not match the pattern and must survive intact.
    expect(row["llmTeam"]).toBe("platform");
  });

  test("the Hash action is applied to the identity columns, not just Redact", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
        scrubAction: TraceScrubAction.Hash,
      }) as never,
    );

    expect(row["llmUserEmail"]).toMatch(/^\[HASHED:[0-9a-f]{8}\]$/);
  });

  test("the Mask action preserves the email shape in the column", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
        scrubAction: TraceScrubAction.Mask,
      }) as never,
    );

    expect(row["llmUserEmail"]).toBe("a***@***.com");
  });

  test("the same masked value lands in the column and the attribute", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.All,
        scrubAction: TraceScrubAction.Mask,
      }) as never,
    );

    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(row["llmUserEmail"]).toBe(attributes["user.email"]);
  });

  test("a non-matching rule leaves every identity column byte-identical", () => {
    /*
     * The no-op guard. The overwhelming majority of spans carry no PII in
     * these columns, and the pass must not rewrite, trim or coerce them.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      compile({
        patternType: TraceScrubPatternType.CreditCard,
        fieldsToScrub: TraceScrubField.All,
      }) as never,
    );

    expect(row["llmUserId"]).toBe("acct-9f2");
    expect(row["llmUserEmail"]).toBe("ada@example.com");
    expect(row["llmTeam"]).toBe("platform");
  });

  test("an empty rule list returns the row untouched", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(spanRow(), []);

    expect(row["llmUserEmail"]).toBe("ada@example.com");
  });

  test("absent identity columns do not throw", () => {
    /*
     * Non-LLM spans never carry these keys at all (the extractor gates them
     * on isLlmSpan), so the pass has to tolerate their absence rather than
     * stamping empty strings onto every row in the fleet.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "GET /checkout",
        attributes: { "http.method": "GET" },
        events: [],
      },
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.All,
      }) as never,
    );

    expect(row).not.toHaveProperty("llmUserEmail");
  });

  test("a non-string identity column value is left alone", () => {
    // Defensive: a malformed row must not crash the whole span batch.
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow({ llmUserId: 42 }),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.All,
      }) as never,
    );

    expect(row["llmUserId"]).toBe(42);
  });

  test("every identity column is covered, not just the email one", () => {
    /*
     * A rule that redacts any of the three values proves the pass iterates
     * the whole column list rather than special-casing llmUserEmail.
     */
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow({
        llmUserId: "ada@example.com",
        llmTeam: "ada@example.com",
      }),
      compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
      }) as never,
    );

    expect(row["llmUserId"]).toBe("[REDACTED]");
    expect(row["llmUserEmail"]).toBe("[REDACTED]");
    expect(row["llmTeam"]).toBe("[REDACTED]");
  });

  test("multiple rules compose across the identity columns", () => {
    /*
     * scrubSpan dispatches per rule; a bug that broke out of the loop after
     * the first rule would leave the second value in the clear.
     */
    const rules: Array<CompiledRule> = [
      ...compile({
        patternType: TraceScrubPatternType.Email,
        fieldsToScrub: TraceScrubField.Attributes,
      }),
      ...compile({
        patternType: TraceScrubPatternType.Custom,
        fieldsToScrub: TraceScrubField.All,
        customRegex: "acct-[a-z0-9]+",
      }),
    ];

    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      rules as never,
    );

    expect(row["llmUserEmail"]).toBe("[REDACTED]");
    expect(row["llmUserId"]).toBe("[REDACTED]");
  });
});
