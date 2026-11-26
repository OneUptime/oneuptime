import { JSONObject } from "../../../Types/JSON";
import {
  detectionOverflowMarkdown,
  detectionRuleMatchMarkdown,
  entityRiskMarkdown,
  threatIntelMatchMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { getEntityCaseGroupingKey } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import {
  CORRELATION_SENTENCE_PREFIX,
  ErasedName,
  TITLE_VALUE_SEPARATOR,
  getDescriptionNameTexts,
  getErasedRiskKeys,
  namesAnyone,
  unnameDescription,
  unnameGroupingKey,
  unnameJson,
  unnameTitle,
  unnameValue,
} from "../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { describe, expect, test } from "@jest/globals";

/*
 * Taking an erased person out of what Security Events wrote about them
 * (#10908): whole values, and the one title shape OneUptime makes, get
 * what the Hash rule left in the name's place - never a name found inside
 * other words, which a short user id would mangle and which is people's to
 * change.
 */

const TOKEN: string = "[HASHED:5e29db14e508e09a]";
const NAMES: Array<ErasedName> = [
  { named: "alice@example.com", hashed: TOKEN },
  { named: "auth0|alice@example.com", hashed: `auth0|${TOKEN}` },
  { named: "bob", hashed: "[HASHED:aaaaaaaaaaaaaaab]" },
];

describe("a whole value", () => {
  test("that is one of the names becomes what the rule left", () => {
    expect(unnameValue("alice@example.com", NAMES)).toBe(TOKEN);
    expect(unnameValue("auth0|alice@example.com", NAMES)).toBe(
      `auth0|${TOKEN}`,
    );
  });

  test("that only holds a name, or spells it in another case, stays: only the vault's own spelling is the person", () => {
    expect(unnameValue("Alice@Example.com", NAMES)).toBe("Alice@Example.com");
    expect(unnameValue("alice@example.com ", NAMES)).toBe("alice@example.com ");
    expect(unnameValue("bobby", NAMES)).toBe("bobby");
  });

  test("nothing stays nothing", () => {
    expect(unnameValue(undefined, NAMES)).toBeUndefined();
    expect(unnameValue(null, NAMES)).toBeNull();
    expect(unnameValue("", NAMES)).toBe("");
  });
});

describe("a title OneUptime made", () => {
  test("<rule> — <name> ends in what the rule left instead", () => {
    expect(
      unnameTitle(
        `Repeated failed sign-ins for one account${TITLE_VALUE_SEPARATOR}alice@example.com`,
        NAMES,
      ),
    ).toBe(`Repeated failed sign-ins for one account — ${TOKEN}`);
    expect(unnameTitle("Brute force — auth0|alice@example.com", NAMES)).toBe(
      `Brute force — auth0|${TOKEN}`,
    );
  });

  test("a title that is the name alone becomes what the rule left", () => {
    expect(unnameTitle("bob", NAMES)).toBe("[HASHED:aaaaaaaaaaaaaaab]");
  });

  test("a name inside other words stays as written: a short id is part of many sentences", () => {
    for (const title of [
      "Look at bob's sign-ins",
      "alice@example.com signed in from a new country",
      "Brute force — alice@example.com, then a success",
      "Brute force — bobsleigh",
    ]) {
      expect(unnameTitle(title, NAMES)).toBe(title);
    }
  });

  test("nothing stays nothing", () => {
    expect(unnameTitle(undefined, NAMES)).toBeUndefined();
    expect(unnameTitle(null, NAMES)).toBeNull();
  });
});

describe("a description OneUptime wrote", () => {
  const BOB_TOKEN: string = "[HASHED:aaaaaaaaaaaaaaab]";
  const CAROL: ErasedName = {
    named: "carol_smith*ops@example.com",
    hashed: "[HASHED:cccccccccccccccc]",
  };

  // A detection rule's match, as DetectionRuleEvaluator has it written.
  function ruleMatch(data: {
    observables?: Array<string>;
    correlationSummary?: string;
    sampleMessage?: string;
  }): string {
    return detectionRuleMatchMarkdown({
      ruleName: "Repeated failed sign-ins",
      matchCount: 5,
      windowStart: "2026-11-24T09:00:00Z",
      windowEnd: "2026-11-24T09:15:00Z",
      observables: data.observables || [],
      correlationSummary: data.correlationSummary,
      sampleMessage: data.sampleMessage,
    }).toString();
  }

  test("the observables a detection lists: the name's code span becomes the token's, the rest stay", () => {
    const description: string = ruleMatch({
      observables: ["alice@example.com", "203.0.113.7", "bob"],
    });

    expect(description).toContain(
      "Observables: `alice@example.com`, `203.0.113.7`, `bob`",
    );
    expect(unnameDescription(description, NAMES)).toBe(
      description
        .replace("`alice@example.com`", `\`${TOKEN}\``)
        .replace("`bob`", `\`${BOB_TOKEN}\``),
    );
  });

  test("the new values a correlation's sentence lists, escaped as the sentence escapes them", () => {
    const description: string = ruleMatch({
      correlationSummary:
        "First principalUser / srcIp in 7 days: carol_smith*ops@example.com / 203.0.113.7, bob, bobby and 3 more",
      observables: ["carol_smith*ops@example.com"],
    });
    const names: Array<ErasedName> = [...NAMES, CAROL];

    // The sentence escapes what would restyle it; the code span does not.
    expect(description).toContain(
      `${CORRELATION_SENTENCE_PREFIX}First principalUser / srcIp in 7 days: carol_smith\\*ops@example.com / 203.0.113.7, bob, bobby and 3 more.`,
    );

    const unnamed: string = unnameDescription(description, names) as string;

    expect(unnamed).toContain(
      `${CORRELATION_SENTENCE_PREFIX}First principalUser / srcIp in 7 days: \\[HASHED:cccccccccccccccc\\] / 203.0.113.7, \\[HASHED:aaaaaaaaaaaaaaab\\], bobby and 3 more.`,
    );
    expect(unnamed).toContain("Observables: `[HASHED:cccccccccccccccc]`");
    expect(unnamed).not.toContain("carol");
    // Done again, nothing more changes.
    expect(unnameDescription(unnamed, names)).toBe(unnamed);
  });

  test("the last value the sentence lists, before its full stop", () => {
    const description: string = ruleMatch({
      correlationSummary:
        "First principalUser in 1 day: dave, alice@example.com",
    });

    expect(unnameDescription(description, NAMES)).toContain(
      "First principalUser in 1 day: dave, \\[HASHED:5e29db14e508e09a\\].",
    );
  });

  test("a threat intel indicator, an entity's risk and an overflow's groups", () => {
    const indicator: string = threatIntelMatchMarkdown({
      feedName: "Known bad accounts",
      indicatorValue: "alice@example.com",
      indicatorType: "email-addr",
      confidence: 80,
      matchCount: 2,
      windowStart: "2026-11-24T09:00:00Z",
      windowEnd: "2026-11-24T09:15:00Z",
    }).toString();
    const risk: string = entityRiskMarkdown({
      entityValue: "bob",
      entityType: "user",
      score: 82,
      level: "High",
      threshold: 70,
      windowInDays: 7,
      sources: [],
    }).toString();
    const overflow: string = detectionOverflowMarkdown({
      kind: "rule",
      sourceName: "Repeated failed sign-ins",
      summary: "It matched 240 groups.",
      windowStart: "2026-11-24T09:00:00Z",
      windowEnd: "2026-11-24T09:15:00Z",
      examples: ["carol", "alice@example.com"],
    }).toString();

    expect(unnameDescription(indicator, NAMES)).toBe(
      indicator.replace("`alice@example.com`", `\`${TOKEN}\``),
    );
    expect(unnameDescription(risk, NAMES)).toBe(
      risk.replace("`bob`", `\`${BOB_TOKEN}\``),
    );
    expect(unnameDescription(overflow, NAMES)).toBe(
      overflow.replace("`alice@example.com`", `\`${TOKEN}\``),
    );
  });

  test("a name inside other words, or inside a longer code span, stays as written", () => {
    for (const description of [
      ruleMatch({ sampleMessage: "Failed sign-in for bob" }),
      ruleMatch({ observables: ["bobby", "alice@example.com.evil"] }),
      ruleMatch({
        correlationSummary:
          "Failed sign-ins (5+ events in 10 minutes), then Successful sign-in, 3 minutes apart",
      }),
      "Look at bob's sign-ins, and at what happened: bob, then carol.",
      "bob",
    ]) {
      expect(unnameDescription(description, NAMES)).toBe(description);
    }
  });

  test('what the rule left is placed as written, even with a "$" in it', () => {
    const names: Array<ErasedName> = [{ named: "bob", hashed: "[MASK:$&$1]" }];

    expect(
      unnameDescription(
        `${CORRELATION_SENTENCE_PREFIX}First user in 1 day: bob.\n\nObservables: \`bob\``,
        names,
      ),
    ).toBe(
      `${CORRELATION_SENTENCE_PREFIX}First user in 1 day: \\[MASK:$&$1\\].\n\nObservables: \`[MASK:$&$1]\``,
    );
  });

  test("hands back the very description when nothing names anyone, and nothing stays nothing", () => {
    const description: string = ruleMatch({ observables: ["203.0.113.7"] });

    expect(unnameDescription(description, NAMES)).toBe(description);
    expect(unnameDescription(undefined, NAMES)).toBeUndefined();
    expect(unnameDescription(null, NAMES)).toBeNull();
    expect(unnameDescription("", NAMES)).toBe("");
  });

  test("the texts a read finds a description naming the names by", () => {
    expect(getDescriptionNameTexts([...NAMES, CAROL])).toEqual({
      code: [
        "`alice@example.com`",
        "`auth0|alice@example.com`",
        "`bob`",
        "`carol_smith*ops@example.com`",
      ],
      text: [
        "alice@example.com",
        "auth0|alice@example.com",
        "bob",
        "carol_smith\\*ops@example.com",
      ],
    });
    expect(getDescriptionNameTexts([])).toEqual({ code: [], text: [] });
  });
});

describe("a case's grouping key", () => {
  test("the key about a name becomes the key about what the rule left", () => {
    expect(
      unnameGroupingKey(getEntityCaseGroupingKey("alice@example.com"), NAMES),
    ).toBe(getEntityCaseGroupingKey(TOKEN));
  });

  test("any other key stays", () => {
    expect(
      unnameGroupingKey(getEntityCaseGroupingKey("203.0.113.7"), NAMES),
    ).toBe(getEntityCaseGroupingKey("203.0.113.7"));
    expect(unnameGroupingKey("detection-rule:abc", NAMES)).toBe(
      "detection-rule:abc",
    );
    expect(unnameGroupingKey(undefined, NAMES)).toBeUndefined();
  });
});

describe("the entity risk keys of the names", () => {
  test("each name's key, once, case folded as risk keys are", () => {
    expect(
      getErasedRiskKeys([
        ...NAMES,
        { named: "Alice@Example.com", hashed: "[HASHED:1111111111111111]" },
      ]).sort(),
    ).toEqual(["alice@example.com", "auth0|alice@example.com", "bob"].sort());
  });
});

describe("a JSON value", () => {
  test("every whole string that is a name is replaced, at any depth; keys never are", () => {
    const value: JSONObject = {
      entities: [
        { type: "User", value: "alice@example.com" },
        { type: "IP Address", value: "203.0.113.7" },
      ],
      events: [
        {
          principalUser: "auth0|alice@example.com",
          observables: ["alice@example.com", "203.0.113.7"],
          message: "Failed password for alice@example.com",
          "alice@example.com": "a key that is the name",
        },
      ],
      count: 7,
      flagged: true,
      nothing: null,
    };

    const result: { value: JSONObject; changed: boolean } = unnameJson(
      value,
      NAMES,
    );

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      entities: [
        { type: "User", value: TOKEN },
        { type: "IP Address", value: "203.0.113.7" },
      ],
      events: [
        {
          principalUser: `auth0|${TOKEN}`,
          observables: [TOKEN, "203.0.113.7"],
          // A name inside words is the words' own.
          message: "Failed password for alice@example.com",
          "alice@example.com": "a key that is the name",
        },
      ],
      count: 7,
      flagged: true,
      nothing: null,
    });
  });

  test("leaves what it was handed as it was", () => {
    const value: JSONObject = { entities: [{ value: "alice@example.com" }] };
    const copy: string = JSON.stringify(value);

    unnameJson(value, NAMES);

    expect(JSON.stringify(value)).toBe(copy);
  });

  test("hands back the very value, and says so, when nothing names anyone", () => {
    const value: JSONObject = { entities: [{ value: "carol@example.com" }] };
    const result: { value: JSONObject; changed: boolean } = unnameJson(
      value,
      NAMES,
    );

    expect(result.changed).toBe(false);
    expect(result.value).toBe(value);
    expect(namesAnyone(value, NAMES)).toBe(false);
    expect(namesAnyone({ user: "bob" }, NAMES)).toBe(true);
  });

  test("nothing, a list, a bare string", () => {
    expect(unnameJson(undefined, NAMES)).toEqual({
      value: undefined,
      changed: false,
    });
    expect(unnameJson(null, NAMES)).toEqual({ value: null, changed: false });
    expect(unnameJson(["bob", "carol"], NAMES)).toEqual({
      value: ["[HASHED:aaaaaaaaaaaaaaab]", "carol"],
      changed: true,
    });
    expect(unnameJson("alice@example.com", NAMES)).toEqual({
      value: TOKEN,
      changed: true,
    });
  });
});
