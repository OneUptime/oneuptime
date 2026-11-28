import { JSONObject } from "../../../Types/JSON";
import {
  detectionOverflowMarkdown,
  detectionRuleMatchMarkdown,
  entityRiskMarkdown,
  threatIntelMatchMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { getEntityCaseGroupingKey } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { CORRELATION_GROUP_VALUE_SEPARATOR } from "../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import {
  CORRELATION_SENTENCE_PREFIX,
  ErasedName,
  GROUP_VALUE_PART_SEPARATOR,
  THREAT_INTEL_INDICATOR_NAME_PREFIX,
  THREAT_INTEL_MATCH_SENTENCE_PREFIX,
  THREAT_INTEL_STIX_INDICATOR_PREFIX,
  TITLE_VALUE_SEPARATOR,
  getDescriptionNameTexts,
  getErasedRiskKeys,
  getGroupValueCandidates,
  getIndicatorConfidenceTexts,
  getStixIndicatorIdOf,
  getTitleValueCandidates,
  isThreatIntelMatchOf,
  namesAnyone,
  unnameDescription,
  unnameGroupValue,
  unnameGroupingKey,
  unnameJson,
  unnameJsonMarkdown,
  unnameKeptEventStamps,
  unnameThreatIntelDescription,
  unnameTitle,
  unnameValue,
  withErasedStixIndicator,
  withoutIndicatorConfidence,
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

  test('keeps a key a sender named "__proto__" as the copy\'s own, unnamed, never as its prototype', () => {
    // As an event's attributes arrive: parsed from what its sender wrote.
    const value: JSONObject = JSON.parse(
      '{"__proto__": {"user": "alice@example.com"}, "actor": "bob", "nested": {"__proto__": "alice@example.com"}}',
    ) as JSONObject;

    const result: { value: JSONObject; changed: boolean } = unnameJson(
      value,
      NAMES,
    );
    const copy: JSONObject = result.value;

    expect(result.changed).toBe(true);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.keys(copy)).toEqual(["__proto__", "actor", "nested"]);
    expect(Object.getOwnPropertyDescriptor(copy, "__proto__")?.value).toEqual({
      user: TOKEN,
    });
    expect(copy["actor"]).toBe("[HASHED:aaaaaaaaaaaaaaab]");
    expect(
      Object.getOwnPropertyDescriptor(copy["nested"] as JSONObject, "__proto__")
        ?.value,
    ).toBe(TOKEN);
    // Nothing reached Object.prototype, or the copy's own prototype.
    expect(({} as JSONObject)["user"]).toBeUndefined();
    expect(JSON.parse(JSON.stringify(copy))).toEqual(
      JSON.parse(
        `{"__proto__": {"user": "${TOKEN}"}, "actor": "[HASHED:aaaaaaaaaaaaaaab]", "nested": {"__proto__": "${TOKEN}"}}`,
      ),
    );
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

/*
 * A correlation that groups on several values names its group by all of
 * them, joined (#11130): "alice@example.com / 203.0.113.7". Its detection's
 * group value, its title and its case's grouping key are made of that text,
 * so each value in it that is a name gets what the rule left - the value a
 * rule groups on once the events hold the token again, whose fingerprint
 * the erasure puts in place of the old one.
 */
describe("a correlation's group value", () => {
  const BOB_TOKEN: string = "[HASHED:aaaaaaaaaaaaaaab]";

  test("is joined as the server joins it", () => {
    expect(GROUP_VALUE_PART_SEPARATOR).toBe(CORRELATION_GROUP_VALUE_SEPARATOR);
  });

  test("each of its values that is a name becomes what the rule left", () => {
    expect(unnameGroupValue("alice@example.com / 203.0.113.7", NAMES)).toBe(
      `${TOKEN} / 203.0.113.7`,
    );
    expect(unnameGroupValue("203.0.113.7 / alice@example.com", NAMES)).toBe(
      `203.0.113.7 / ${TOKEN}`,
    );
    expect(unnameGroupValue("alice@example.com / bob / web-1", NAMES)).toBe(
      `${TOKEN} / ${BOB_TOKEN} / web-1`,
    );
    expect(unnameGroupValue("auth0|alice@example.com / 10.0.0.1", NAMES)).toBe(
      `auth0|${TOKEN} / 10.0.0.1`,
    );
  });

  test("a single value is a whole value", () => {
    expect(unnameGroupValue("alice@example.com", NAMES)).toBe(TOKEN);
    expect(unnameGroupValue("203.0.113.7", NAMES)).toBe("203.0.113.7");
  });

  test("a name inside one of its values, or spelt otherwise, stays", () => {
    for (const value of [
      "Alice@Example.com / 203.0.113.7",
      "alice@example.com, bob / 203.0.113.7",
      "bobby / 203.0.113.7",
      "alice@example.com/203.0.113.7",
      "203.0.113.7 / 198.51.100.4",
    ]) {
      expect(unnameGroupValue(value, NAMES)).toBe(value);
    }
  });

  test("a value whose whole is a name wins over its parts", () => {
    const names: Array<ErasedName> = [
      ...NAMES,
      { named: "bob / ops", hashed: "[HASHED:cccccccccccccccc] / ops" },
    ];

    expect(unnameGroupValue("bob / ops", names)).toBe(
      "[HASHED:cccccccccccccccc] / ops",
    );
  });

  test("taking the names out twice changes nothing more", () => {
    const once: string = unnameGroupValue(
      "alice@example.com / bob / web-1",
      NAMES,
    ) as string;

    expect(unnameGroupValue(once, NAMES)).toBe(once);
  });

  test("nothing stays nothing", () => {
    expect(unnameGroupValue(undefined, NAMES)).toBeUndefined();
    expect(unnameGroupValue(null, NAMES)).toBeNull();
    expect(unnameGroupValue("", NAMES)).toBe("");
  });

  test("a title made of it ends in it with the names out", () => {
    expect(
      unnameTitle(
        `First sign-in from a new address${TITLE_VALUE_SEPARATOR}alice@example.com / 203.0.113.7`,
        NAMES,
      ),
    ).toBe(`First sign-in from a new address — ${TOKEN} / 203.0.113.7`);
    expect(
      unnameTitle("Spray — 203.0.113.7 / alice@example.com / bob", NAMES),
    ).toBe(`Spray — 203.0.113.7 / ${TOKEN} / ${BOB_TOKEN}`);
    // Only what is after the title's last separator is the value.
    expect(
      unnameTitle("alice@example.com / x — 203.0.113.7 / bob", NAMES),
    ).toBe(`alice@example.com / x — 203.0.113.7 / ${BOB_TOKEN}`);
  });

  test("a title whose value names nobody stays", () => {
    for (const title of [
      "Spray — 203.0.113.7 / 198.51.100.4",
      "Spray — alice@example.com, then a success / 203.0.113.7",
      "alice@example.com / 203.0.113.7",
    ]) {
      expect(unnameTitle(title, NAMES)).toBe(title);
    }
  });

  test("its case's grouping key is the one about it with the names out", () => {
    expect(
      unnameGroupingKey(
        getEntityCaseGroupingKey("alice@example.com / 203.0.113.7"),
        NAMES,
      ),
    ).toBe(getEntityCaseGroupingKey(`${TOKEN} / 203.0.113.7`));
    expect(
      unnameGroupingKey(
        getEntityCaseGroupingKey("203.0.113.7 / Bob / web-1"),
        NAMES,
      ),
    ).toBe(getEntityCaseGroupingKey(`203.0.113.7 / ${BOB_TOKEN} / web-1`));
  });

  test("a grouping key that names nobody stays, and so does any other key", () => {
    for (const key of [
      getEntityCaseGroupingKey("203.0.113.7 / 198.51.100.4"),
      getEntityCaseGroupingKey("bobby / 203.0.113.7"),
      "detection:detection-rule:r1:abc / def",
      `entity:sha256:${"a".repeat(64)}`,
    ]) {
      expect(unnameGroupingKey(key, NAMES)).toBe(key);
    }
  });
});

describe("a JSON value OneUptime wrote in Markdown, as a playbook run's step results", () => {
  test("a whole value, and a name a step's message set apart as inline code, get what the rule left", () => {
    const results: Array<JSONObject> = [
      {
        stepId: "lookup",
        status: "Succeeded",
        message:
          "2 entities are known-bad in threat intel: `alice@example.com`, `203.0.113.9`.",
        found: true,
      },
      {
        stepId: "suspend",
        status: "Succeeded",
        targets: [{ type: "User", value: "auth0|alice@example.com" }],
      },
    ];

    expect(unnameJsonMarkdown(results, NAMES)).toEqual({
      value: [
        {
          stepId: "lookup",
          status: "Succeeded",
          message: `2 entities are known-bad in threat intel: \`${TOKEN}\`, \`203.0.113.9\`.`,
          found: true,
        },
        {
          stepId: "suspend",
          status: "Succeeded",
          targets: [{ type: "User", value: `auth0|${TOKEN}` }],
        },
      ],
      changed: true,
    });
  });

  test("a name inside other words - an approver's comment - or inside a longer code span stays as written", () => {
    const results: Array<JSONObject> = [
      {
        stepId: "suspend",
        approval: { comment: "Call alice@example.com about her sign-ins" },
        message: "Ran `whois alice@example.com` on the host",
      },
    ];

    expect(unnameJsonMarkdown(results, NAMES)).toEqual({
      value: results,
      changed: false,
    });
  });

  test("keys and what is no text stay, and nothing stays nothing", () => {
    const value: JSONObject = {
      "alice@example.com": 3,
      count: 2,
      flags: [true, null],
    };

    expect(unnameJsonMarkdown(value, NAMES)).toEqual({ value, changed: false });
    expect(unnameJsonMarkdown(undefined, NAMES)).toEqual({
      value: undefined,
      changed: false,
    });
  });
});

/*
 * #11231: a correlation that writes no Detection Findings and opens no cases
 * leaves its group value nowhere - but its alerts' titles hold it, and its
 * group's other entities counted its firings. These offer the readings; the
 * erasure keeps one only when its fingerprint proves it.
 */
describe("what a correlation's group value was, from what is left of it (#11231)", () => {
  test("an alert's title: what follows its separator", () => {
    expect(
      getTitleValueCandidates(
        "[Detection] Sign-in burst — alice@example.com / 203.0.113.7",
      ),
    ).toEqual(["alice@example.com / 203.0.113.7"]);
  });

  test("a rule whose own name holds the separator: every reading, the longest first", () => {
    expect(
      getTitleValueCandidates(
        "[Detection] Sign-ins — burst — alice@example.com / 203.0.113.7",
      ),
    ).toEqual([
      "burst — alice@example.com / 203.0.113.7",
      "alice@example.com / 203.0.113.7",
    ]);
  });

  test("an incident's title, with an event count after the value or not", () => {
    expect(
      getTitleValueCandidates(
        "[Detection] Sign-in burst — alice@example.com / 203.0.113.7 (5 events)",
      ),
    ).toEqual([
      "alice@example.com / 203.0.113.7 (5 events)",
      "alice@example.com / 203.0.113.7",
    ]);
    expect(
      getTitleValueCandidates("[Detection] R — bob / 10.0.0.1 (1 event)"),
    ).toContain("bob / 10.0.0.1");
    expect(
      getTitleValueCandidates("[Detection] R — bob / 10.0.0.1 (1,204 events)"),
    ).toContain("bob / 10.0.0.1");
  });

  test("a title with no value, or none at all, offers nothing", () => {
    expect(getTitleValueCandidates("[Detection] Sign-in burst")).toEqual([]);
    expect(getTitleValueCandidates("[Detection] Sign-in burst — ")).toEqual([]);
    expect(getTitleValueCandidates("")).toEqual([]);
    expect(getTitleValueCandidates(undefined)).toEqual([]);
    expect(getTitleValueCandidates(null)).toEqual([]);
  });

  test("a firing's other entity: the name and it, in each order", () => {
    expect(
      getGroupValueCandidates({
        name: "alice@example.com",
        others: ["203.0.113.7"],
      }).sort(),
    ).toEqual(
      [
        `alice@example.com${CORRELATION_GROUP_VALUE_SEPARATOR}203.0.113.7`,
        `203.0.113.7${CORRELATION_GROUP_VALUE_SEPARATOR}alice@example.com`,
      ].sort(),
    );
  });

  test("two others: every order of the name and one or both, never a value twice, never more than three", () => {
    const candidates: Array<string> = getGroupValueCandidates({
      name: "alice",
      others: ["web-1", "203.0.113.7"],
    });

    expect(candidates).toHaveLength(10);
    expect(new Set(candidates).size).toBe(10);

    for (const candidate of candidates) {
      const parts: Array<string> = candidate.split(GROUP_VALUE_PART_SEPARATOR);

      expect(parts).toContain("alice");
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts.length).toBeLessThanOrEqual(3);
      expect(new Set(parts).size).toBe(parts.length);
    }

    expect(candidates).toEqual(
      expect.arrayContaining([
        "web-1 / alice / 203.0.113.7",
        "203.0.113.7 / web-1 / alice",
        "alice / web-1",
      ]),
    );
  });

  test("as many values as the correlation groups on, no more", () => {
    expect(
      getGroupValueCandidates({
        name: "alice",
        others: ["web-1", "203.0.113.7"],
        maxParts: 2,
      }),
    ).toHaveLength(4);
  });

  test("the name itself, an empty value or a repeat among the others is no other value", () => {
    expect(
      getGroupValueCandidates({
        name: "alice",
        others: ["alice", "", "web-1", "web-1"],
      }).sort(),
    ).toEqual(["alice / web-1", "web-1 / alice"]);
    expect(getGroupValueCandidates({ name: "", others: ["web-1"] })).toEqual(
      [],
    );
    expect(getGroupValueCandidates({ name: "alice", others: [] })).toEqual([]);
  });
});

/*
 * #11230: a feed can list the person's email address, and what OneUptime
 * wrote about the match named the feed's indicator - by its id and its name,
 * beside which the feed keeps the address in clear.
 */
describe("the feed's indicator, out of what was written about a match on the person (#11230)", () => {
  const STIX_ID: string = "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f";
  const ERASED_ID: string = "[INDICATOR:3f9a1c0e7b2d4a68]";
  const erasedIndicatorIdOf: (value: string) => string = (
    value: string,
  ): string => {
    return value === TOKEN ? ERASED_ID : `[INDICATOR:${"e".repeat(16)}]`;
  };

  function match(
    overrides: Partial<Parameters<typeof threatIntelMatchMarkdown>[0]> = {},
  ): string {
    return threatIntelMatchMarkdown({
      feedName: "Acme Phishing Senders",
      indicatorName: "Phishing sender alice@example.com",
      indicatorValue: "alice@example.com",
      indicatorType: "email-addr",
      confidence: 80,
      matchCount: 2,
      windowStart: "2026-11-24T09:00:00Z",
      windowEnd: "2026-11-24T09:15:00Z",
      stixId: STIX_ID,
      sampleMessage: "Sign-in from 203.0.113.7",
      ...overrides,
    }).toString();
  }

  // An alert's description, as the matcher writes it (ThreatIntelMatcher.buildMatchDescription).
  function alertText(stixId: string = STIX_ID): string {
    return [
      "Phishing sender alice@example.com",
      "Indicator alice@example.com (email-addr, confidence 80) matched 2 security events between 2026-11-24T09:00:00Z and 2026-11-24T09:15:00Z.",
      `STIX indicator: ${stixId}`,
      "Sample event: Sign-in from 203.0.113.7",
      "Observables: alice@example.com, 203.0.113.7",
    ].join("\n\n");
  }

  test("a detection's description: the erased indicator id for the STIX id, the indicator's name gone, and its score (#11447)", () => {
    const unnamed: string = unnameThreatIntelDescription(
      unnameDescription(match(), NAMES),
      { names: NAMES, erasedIndicatorIdOf },
    )!;

    expect(unnamed).toBe(
      [
        `Indicator \`${TOKEN}\` (email-addr) from the threat intel feed **Acme Phishing Senders** matched 2 security events between 2026-11-24T09:00:00Z and 2026-11-24T09:15:00Z.`,
        `STIX indicator: \`${ERASED_ID}\``,
        "Sample event: `Sign-in from 203.0.113.7`",
      ].join("\n\n"),
    );
    expect(unnamed).not.toContain("indicator--");
    expect(unnamed).not.toContain("Phishing sender");
    expect(unnamed).not.toContain("alice");
  });

  test("the same on its own, before the names are out, and on one an earlier erasure un-named", () => {
    const before: string = unnameThreatIntelDescription(match(), {
      names: NAMES,
      erasedIndicatorIdOf,
    })!;

    expect(before).toContain(`STIX indicator: \`${ERASED_ID}\``);
    expect(before).not.toContain("Indicator: ");

    const earlier: string = unnameDescription(match(), NAMES)!;

    expect(
      unnameThreatIntelDescription(earlier, {
        names: NAMES,
        erasedIndicatorIdOf,
      }),
    ).toBe(
      unnameThreatIntelDescription(unnameDescription(match(), NAMES), {
        names: NAMES,
        erasedIndicatorIdOf,
      }),
    );
  });

  test("a list's indicator has no STIX line: only its name goes", () => {
    const unnamed: string = unnameThreatIntelDescription(
      match({ stixId: "list" }),
      { names: NAMES, erasedIndicatorIdOf },
    )!;

    expect(unnamed).not.toContain("STIX indicator");
    expect(unnamed).not.toContain("Phishing sender");
    expect(unnamed).toContain("Sample event:");
  });

  test("running it again changes nothing", () => {
    const once: string = unnameThreatIntelDescription(
      unnameDescription(match(), NAMES),
      { names: NAMES, erasedIndicatorIdOf },
    )!;

    expect(
      unnameThreatIntelDescription(once, { names: NAMES, erasedIndicatorIdOf }),
    ).toBe(once);
  });

  test("a match about anything else, another person's, a description of another kind, or one a person rewrote, stays", () => {
    for (const description of [
      match({ indicatorValue: "198.51.100.4", indicatorType: "ipv4-addr" }),
      match({ indicatorValue: "carol@example.com" }),
      // The name inside a longer value is not the match's value.
      match({ indicatorValue: "mailto:alice@example.com" }),
      detectionRuleMatchMarkdown({
        ruleName: "Brute force",
        matchCount: 3,
        windowStart: "2026-11-24T09:00:00Z",
        windowEnd: "2026-11-24T09:15:00Z",
        observables: ["alice@example.com"],
      }).toString(),
      `A person wrote this.\n\nIndicator: keep this\n\nSTIX indicator: \`${STIX_ID}\``,
    ]) {
      expect(
        unnameThreatIntelDescription(description, {
          names: NAMES,
          erasedIndicatorIdOf,
        }),
      ).toBe(description);
    }

    expect(
      unnameThreatIntelDescription(undefined, {
        names: NAMES,
        erasedIndicatorIdOf,
      }),
    ).toBeUndefined();
    expect(
      unnameThreatIntelDescription("", { names: NAMES, erasedIndicatorIdOf }),
    ).toBe("");
  });

  test("each name's own token: the id stands for the match on what the rule left", () => {
    const unnamed: string = unnameThreatIntelDescription(
      match({ indicatorValue: "bob" }),
      { names: NAMES, erasedIndicatorIdOf },
    )!;

    expect(unnamed).toContain(
      `STIX indicator: \`[INDICATOR:${"e".repeat(16)}]\``,
    );
  });

  test("the STIX indicator an alert's description names", () => {
    expect(getStixIndicatorIdOf(alertText())).toBe(STIX_ID);
    expect(
      getStixIndicatorIdOf(`Some text\n\nSTIX indicator: ${STIX_ID}\n`),
    ).toBe(STIX_ID);
    expect(getStixIndicatorIdOf(alertText(ERASED_ID))).toBeNull();
    expect(
      getStixIndicatorIdOf("Indicator 198.51.100.4 (ipv4-addr)"),
    ).toBeNull();
    expect(getStixIndicatorIdOf(undefined)).toBeNull();
    expect(getStixIndicatorIdOf(null)).toBeNull();
  });

  test("an alert's description and its feed item: the erased indicator id where they say the STIX id, the rest as written", () => {
    const description: string = withErasedStixIndicator(alertText(), {
      stixId: STIX_ID,
      erasedId: ERASED_ID,
    })!;

    expect(description).toBe(alertText(ERASED_ID));

    // A feed item embeds the description among lines of its own.
    const feedItem: string = `#### Alert #12 Created:\n\n**[Threat Intel] Acme — alice@example.com**:\n\n${alertText()}\n\n🔴 **Alert State**: Created`;

    expect(
      withErasedStixIndicator(feedItem, {
        stixId: STIX_ID,
        erasedId: ERASED_ID,
      }),
    ).toBe(
      feedItem.replace(
        `STIX indicator: ${STIX_ID}`,
        `STIX indicator: ${ERASED_ID}`,
      ),
    );
  });

  test("an alert's text that names another indicator, or none, stays", () => {
    const other: string = alertText(
      "indicator--00000000-0000-4000-8000-000000000000",
    );

    expect(
      withErasedStixIndicator(other, { stixId: STIX_ID, erasedId: ERASED_ID }),
    ).toBe(other);
    expect(
      withErasedStixIndicator("No indicator here", {
        stixId: STIX_ID,
        erasedId: ERASED_ID,
      }),
    ).toBe("No indicator here");
    expect(
      withErasedStixIndicator(alertText(), { stixId: "", erasedId: ERASED_ID }),
    ).toBe(alertText());
    expect(
      withErasedStixIndicator(undefined, {
        stixId: STIX_ID,
        erasedId: ERASED_ID,
      }),
    ).toBeUndefined();
  });

  test("the events a detection kept: a stamp about the person says the token and the erased indicator id, and no score (#11447)", () => {
    const kept: JSONObject = {
      events: [
        {
          message: "Sign-in",
          attributes: {
            "threat.indicator_value": "alice@example.com",
            "threat.indicator_id": STIX_ID,
            "threat.feed": "Acme Phishing Senders",
            "threat.indicator_type": "email-addr",
            "threat.confidence": "80",
          },
        },
        {
          message: "Port scan",
          attributes: {
            "threat.indicator_value": "198.51.100.4",
            "threat.indicator_id":
              "indicator--11111111-1111-4111-8111-111111111111",
            "threat.confidence": "95",
          },
        },
        { message: "No stamp", attributes: { "http.route": "/login" } },
        { message: "No attributes" },
      ],
      outcomes: { blocked: 2 },
    };

    const result: { value: JSONObject; changed: boolean } =
      unnameKeptEventStamps(kept, { names: NAMES, erasedIndicatorIdOf });

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      events: [
        {
          message: "Sign-in",
          attributes: {
            "threat.indicator_value": TOKEN,
            "threat.indicator_id": ERASED_ID,
            "threat.feed": "Acme Phishing Senders",
            "threat.indicator_type": "email-addr",
          },
        },
        kept["events"] && (kept["events"] as Array<JSONObject>)[1],
        { message: "No stamp", attributes: { "http.route": "/login" } },
        { message: "No attributes" },
      ],
      outcomes: { blocked: 2 },
    });
    // The kept events as they were read are not changed under the reader.
    expect(
      ((kept["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "threat.indicator_id"
      ],
    ).toBe(STIX_ID);
  });

  test("a stamp in the vault's spelling or lower-cased, or one an earlier erasure gave the token, gets it too", () => {
    const names: Array<ErasedName> = [
      { named: "Alice@Example.com", hashed: TOKEN },
    ];

    for (const stamp of ["alice@example.com", "Alice@Example.com", TOKEN]) {
      const result: { value: JSONObject; changed: boolean } =
        unnameKeptEventStamps(
          {
            events: [
              {
                attributes: {
                  "threat.indicator_value": stamp,
                  "threat.indicator_id": STIX_ID,
                },
              },
            ],
          },
          { names, erasedIndicatorIdOf },
        );

      expect(result.changed).toBe(true);
      expect(
        (result.value["events"] as Array<JSONObject>)[0]!["attributes"],
      ).toEqual({
        "threat.indicator_value": TOKEN,
        "threat.indicator_id": ERASED_ID,
      });
    }
  });

  test("kept events with nothing of the person, or none at all, are left as they are", () => {
    const done: JSONObject = {
      events: [
        {
          attributes: {
            "threat.indicator_value": TOKEN,
            "threat.indicator_id": ERASED_ID,
          },
        },
      ],
    };

    expect(
      unnameKeptEventStamps(done, { names: NAMES, erasedIndicatorIdOf }),
    ).toEqual({ value: done, changed: false });

    for (const value of [undefined, null, {}, { events: "nope" }]) {
      expect(
        unnameKeptEventStamps(value as JSONObject, {
          names: NAMES,
          erasedIndicatorIdOf,
        }),
      ).toEqual({ value, changed: false });
    }
  });

  test("a kept event's own __proto__ attribute stays its own", () => {
    const attributes: JSONObject = JSON.parse(
      '{"__proto__": "kept", "threat.indicator_value": "alice@example.com", "threat.indicator_id": "indicator--x"}',
    ) as JSONObject;
    const result: { value: JSONObject; changed: boolean } =
      unnameKeptEventStamps(
        { events: [{ attributes }] },
        { names: NAMES, erasedIndicatorIdOf },
      );
    const stamped: JSONObject = (
      result.value["events"] as Array<JSONObject>
    )[0]!["attributes"] as JSONObject;

    expect(Object.prototype.hasOwnProperty.call(stamped, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(stamped)).toBe(Object.prototype);
  });

  test("a stamp an earlier erasure gave the token and the erased id, its score left, loses the score (#11447)", () => {
    const left: JSONObject = {
      events: [
        {
          attributes: {
            "threat.indicator_value": TOKEN,
            "threat.indicator_id": ERASED_ID,
            "threat.indicator_type": "email-addr",
            "threat.confidence": "80",
          },
        },
      ],
    };
    const result: { value: JSONObject; changed: boolean } =
      unnameKeptEventStamps(left, { names: NAMES, erasedIndicatorIdOf });

    expect(result.changed).toBe(true);
    expect(
      (result.value["events"] as Array<JSONObject>)[0]!["attributes"],
    ).toEqual({
      "threat.indicator_value": TOKEN,
      "threat.indicator_id": ERASED_ID,
      "threat.indicator_type": "email-addr",
    });
    // And then nothing more.
    expect(
      unnameKeptEventStamps(result.value, {
        names: NAMES,
        erasedIndicatorIdOf,
      }).changed,
    ).toBe(false);
  });

  test("an indicator's score, out of a match's text, wherever its sentence states one (#11447)", () => {
    expect(withoutIndicatorConfidence(alertText())).toBe(
      alertText().replace("(email-addr, confidence 80)", "(email-addr)"),
    );
    expect(withoutIndicatorConfidence(match())).toContain(
      "(email-addr) from the threat intel feed",
    );

    // Every type a feed's indicator has, and one with none.
    for (const type of [
      "ipv4-addr",
      "ipv6-addr",
      "domain-name",
      "url",
      "email-addr",
      "file-hash-sha256",
      "file-hash-sha1",
      "file-hash-md5",
      "indicator",
    ]) {
      expect(withoutIndicatorConfidence(`x (${type}, confidence 7) y`)).toBe(
        `x (${type}) y`,
      );
    }

    // What has no score, or is no type's, is left as it is.
    for (const text of [
      "Indicator `x` (email-addr) from the threat intel feed",
      "with high confidence, this is it",
      "(mood, confidence 99)",
      "(email-addr, confidence high)",
    ]) {
      expect(withoutIndicatorConfidence(text)).toBe(text);
    }

    expect(withoutIndicatorConfidence(undefined)).toBeUndefined();
    expect(withoutIndicatorConfidence(null)).toBeNull();
    expect(withoutIndicatorConfidence("")).toBe("");
  });

  test("the scores a text states, each once, as a copy of it holds them", () => {
    expect(getIndicatorConfidenceTexts(alertText())).toEqual([
      "(email-addr, confidence 80)",
    ]);
    expect(
      getIndicatorConfidenceTexts(
        "a (url, confidence 5) b (url, confidence 5) c (ipv4-addr, confidence 60)",
      ),
    ).toEqual(["(url, confidence 5)", "(ipv4-addr, confidence 60)"]);
    expect(getIndicatorConfidenceTexts("none here")).toEqual([]);
    expect(getIndicatorConfidenceTexts(undefined)).toEqual([]);
  });

  test("a description is a threat intel match on the person, as written or as an erasure left it", () => {
    expect(isThreatIntelMatchOf(match(), NAMES)).toBe(true);
    expect(isThreatIntelMatchOf(unnameDescription(match(), NAMES), NAMES)).toBe(
      true,
    );
    expect(
      isThreatIntelMatchOf(match({ indicatorValue: "198.51.100.4" }), NAMES),
    ).toBe(false);
    expect(isThreatIntelMatchOf("A person wrote this.", NAMES)).toBe(false);
    expect(isThreatIntelMatchOf(undefined, NAMES)).toBe(false);
  });

  test("the lines it reads are the ones SecurityCaseMarkdown writes", () => {
    const description: string = match();

    expect(description.startsWith(THREAT_INTEL_MATCH_SENTENCE_PREFIX)).toBe(
      true,
    );
    expect(description).toContain(
      `\n\n${THREAT_INTEL_INDICATOR_NAME_PREFIX}Phishing sender`,
    );
    expect(description).toContain(
      `\n\n${THREAT_INTEL_STIX_INDICATOR_PREFIX}\`${STIX_ID}\``,
    );
  });
});
