import {
  AI_CONTEXT_BYTES_PER_TOKEN,
  AI_CONTEXT_COLUMN,
  AI_CONTEXT_RUN_MAX_CHARACTERS,
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  AiContextActivity,
  AiContextOwner,
  AiContextRule,
  AiContextSource,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  composeAiContext,
  countAiContextCharacters,
  countAiContextUtf8Bytes,
  describeAiContextActivityInEnglish,
  estimateAiContextTokens,
  formatAiContextCount,
  getAiContextMaxCharacters,
  getAiContextProblem,
  getAiContextRuleParts,
  hasProjectAiContext,
  holdAiContextTo,
  isAiContextActivity,
  readAiContext,
} from "../../../Types/AI/AiContext";
import { describe, expect, test } from "@jest/globals";

/*
 * THE AI CONTEXT (issue #5198): what a project's team writes for OneUptime
 * AI about its own systems, and what one run reads of it. These pin the
 * limits and how they are counted - the same in the browser and on the
 * server - the token estimate, and how the project's notes and its AI
 * rules' notes are put together for a run.
 */

const WORDS: string =
  "checkout-api serves the checkout page and depends on payments-db. ";

function textOf(characters: number, unit: string = "a"): string {
  return unit.repeat(characters);
}

function rule(
  id: string,
  name: string,
  aiContext: unknown,
): AiContextRule {
  return { id, name, aiContext };
}

describe("the limits", () => {
  test("a project holds 20,000 characters, a rule 5,000, a run reads 30,000", () => {
    expect(PROJECT_AI_CONTEXT_MAX_CHARACTERS).toBe(20_000);
    expect(AI_RULE_AI_CONTEXT_MAX_CHARACTERS).toBe(5_000);
    expect(AI_CONTEXT_RUN_MAX_CHARACTERS).toBe(30_000);
    expect(AI_CONTEXT_COLUMN).toBe("aiContext");
  });

  test("a run fits the project's whole AI context and two full rules", () => {
    expect(
      PROJECT_AI_CONTEXT_MAX_CHARACTERS + 2 * AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
    ).toBe(AI_CONTEXT_RUN_MAX_CHARACTERS);
  });

  test("each owner has its own limit", () => {
    expect(getAiContextMaxCharacters(AiContextOwner.Project)).toBe(
      PROJECT_AI_CONTEXT_MAX_CHARACTERS,
    );
    expect(getAiContextMaxCharacters(AiContextOwner.AiRule)).toBe(
      AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
    );
  });

  test("counts are written with a comma for thousands", () => {
    expect(formatAiContextCount(20000)).toBe("20,000");
    expect(formatAiContextCount(5)).toBe("5");
    expect(formatAiContextCount(-3)).toBe("0");
  });
});

describe("readAiContext", () => {
  test("a stored text, without the white space at its ends", () => {
    expect(readAiContext("  ## Services\n- api\n\n")).toBe("## Services\n- api");
  });

  test("anything that is not text reads as none", () => {
    expect(readAiContext(undefined)).toBe("");
    expect(readAiContext(null)).toBe("");
    expect(readAiContext(42)).toBe("");
    expect(readAiContext({ text: "x" })).toBe("");
    expect(readAiContext("   ")).toBe("");
  });
});

describe("countAiContextCharacters: characters as a person counts them", () => {
  test("ASCII, accented letters and CJK count one each", () => {
    expect(countAiContextCharacters("checkout")).toBe(8);
    expect(countAiContextCharacters("é")).toBe(1);
    expect(countAiContextCharacters("日本語")).toBe(3);
    expect(countAiContextCharacters("")).toBe(0);
  });

  test("a character outside the Basic Multilingual Plane is one, not two", () => {
    // Two UTF-16 code units each.
    expect("🚀".length).toBe(2);
    expect(countAiContextCharacters("🚀")).toBe(1);
    expect(countAiContextCharacters("deploy 🚀🚀")).toBe(9);
    expect(countAiContextCharacters("𝒳")).toBe(1);
  });

  test("a lone surrogate still counts as one character", () => {
    expect(countAiContextCharacters("\ud83d")).toBe(1);
    expect(countAiContextCharacters("a\ude80b")).toBe(3);
  });
});

describe("the token estimate: a token for every four bytes of UTF-8", () => {
  test("bytes are counted as UTF-8 encodes them", () => {
    expect(countAiContextUtf8Bytes("abc")).toBe(3);
    expect(countAiContextUtf8Bytes("é")).toBe(2);
    expect(countAiContextUtf8Bytes("ж")).toBe(2);
    expect(countAiContextUtf8Bytes("日")).toBe(3);
    expect(countAiContextUtf8Bytes("🚀")).toBe(4);
    expect(countAiContextUtf8Bytes("\ud83d")).toBe(3);
  });

  test("the count matches a real UTF-8 encoder on every script", () => {
    for (const text of [
      WORDS,
      "Сервис checkout зависит от payments-db.",
      "チェックアウトは payments-db に依存しています。",
      "결제 페이지는 payments-db에 의존합니다.",
      "سرویس پرداخت به payments-db وابسته است.",
      "deploy 🚀 then 🔥",
    ]) {
      expect(countAiContextUtf8Bytes(text)).toBe(
        Buffer.byteLength(text, "utf8"),
      );
    }
  });

  test("four letters of English are a token", () => {
    expect(AI_CONTEXT_BYTES_PER_TOKEN).toBe(4);
    expect(estimateAiContextTokens("abcd")).toBe(1);
    expect(estimateAiContextTokens("abcde")).toBe(2);
    expect(estimateAiContextTokens(textOf(4000))).toBe(1000);
  });

  test("a Japanese character comes to about one token, not a quarter of one", () => {
    // 1,000 characters of three bytes each.
    expect(estimateAiContextTokens(textOf(1000, "日"))).toBe(750);
    // Counting characters instead would say 250.
    expect(estimateAiContextTokens(textOf(1000, "日"))).toBeGreaterThan(
      textOf(1000, "日").length / 4,
    );
  });

  test("empty or blank text costs nothing; the white space at its ends is not counted", () => {
    expect(estimateAiContextTokens("")).toBe(0);
    expect(estimateAiContextTokens("   \n\n")).toBe(0);
    expect(estimateAiContextTokens("  abcd  ")).toBe(1);
  });
});

describe("getAiContextProblem: what may be saved", () => {
  test("nothing, or a blank text, may always be saved: it clears the notes", () => {
    for (const owner of [AiContextOwner.Project, AiContextOwner.AiRule]) {
      expect(getAiContextProblem({ value: undefined, owner })).toBeNull();
      expect(getAiContextProblem({ value: null, owner })).toBeNull();
      expect(getAiContextProblem({ value: "", owner })).toBeNull();
      expect(getAiContextProblem({ value: "   ", owner })).toBeNull();
    }
  });

  test("anything but text is refused", () => {
    expect(
      getAiContextProblem({ value: 12, owner: AiContextOwner.Project }),
    ).toBe("The AI context must be text.");
    expect(
      getAiContextProblem({
        value: ["a"],
        owner: AiContextOwner.AiRule,
      }),
    ).toBe("The AI context must be text.");
  });

  test("a project's notes up to 20,000 characters are saved; one more is refused, with the count", () => {
    expect(
      getAiContextProblem({
        value: textOf(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
        owner: AiContextOwner.Project,
      }),
    ).toBeNull();

    expect(
      getAiContextProblem({
        value: textOf(PROJECT_AI_CONTEXT_MAX_CHARACTERS + 1),
        owner: AiContextOwner.Project,
      }),
    ).toBe(
      "The project's AI context can hold at most 20,000 characters. This one has 20,001.",
    );
  });

  test("a rule's notes up to 5,000 characters are saved; one more is refused", () => {
    expect(
      getAiContextProblem({
        value: textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        owner: AiContextOwner.AiRule,
      }),
    ).toBeNull();

    expect(
      getAiContextProblem({
        value: textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 1),
        owner: AiContextOwner.AiRule,
      }),
    ).toBe(
      "An AI rule's AI context can hold at most 5,000 characters. This one has 5,001.",
    );
  });

  test("the limit counts what a person sees: emoji are one, the white space at the ends nothing", () => {
    // 5,000 emoji are 10,000 UTF-16 units and still fit a rule.
    expect(
      getAiContextProblem({
        value: textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS, "🚀"),
        owner: AiContextOwner.AiRule,
      }),
    ).toBeNull();

    expect(
      getAiContextProblem({
        value: `\n\n${textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)}    \n`,
        owner: AiContextOwner.AiRule,
      }),
    ).toBeNull();
  });
});

describe("holdAiContextTo", () => {
  test("a text within the limit is the same string", () => {
    const text: string = "## Services";
    expect(holdAiContextTo(text, 100)).toBe(text);
  });

  test("a longer one is read only up to the limit", () => {
    expect(holdAiContextTo("abcdef", 3)).toBe("abc");
    expect(countAiContextCharacters(holdAiContextTo(textOf(30), 20))).toBe(20);
  });

  test("never cuts a character in half", () => {
    const held: string = holdAiContextTo("🚀🚀🚀", 2);
    expect(held).toBe("🚀🚀");
    expect(countAiContextCharacters(held)).toBe(2);
  });
});

describe("composeAiContext: what one run reads", () => {
  test("nothing to read is null: the run reads and records nothing more than before", () => {
    expect(composeAiContext({ projectContext: undefined })).toBeNull();
    expect(composeAiContext({ projectContext: "  " })).toBeNull();
    expect(
      composeAiContext({
        projectContext: null,
        rules: [rule("r1", "Checkout", ""), rule("r2", "DB", null)],
      }),
    ).toBeNull();
  });

  test("the project's notes alone, trimmed, with their size", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: `  ${WORDS}  `,
    });

    expect(activity).toEqual({
      parts: [{ source: AiContextSource.Project, text: WORDS.trim() }],
      characterCount: WORDS.trim().length,
      estimatedTokenCount: estimateAiContextTokens(WORDS),
    });
    expect(hasProjectAiContext(activity!)).toBe(true);
    expect(getAiContextRuleParts(activity!)).toEqual([]);
  });

  test("the project's notes first, then each rule's, by name - whatever order the rules came in", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: "Project notes",
      rules: [
        rule("bbbbbbbb-0000-4000-8000-000000000002", "payments", "Payments notes"),
        rule("aaaaaaaa-0000-4000-8000-000000000001", "Checkout", "Checkout notes"),
      ],
    });

    expect(activity!.parts).toEqual([
      { source: AiContextSource.Project, text: "Project notes" },
      {
        source: AiContextSource.AiRule,
        ruleId: "aaaaaaaa-0000-4000-8000-000000000001",
        ruleName: "Checkout",
        text: "Checkout notes",
      },
      {
        source: AiContextSource.AiRule,
        ruleId: "bbbbbbbb-0000-4000-8000-000000000002",
        ruleName: "payments",
        text: "Payments notes",
      },
    ]);
    expect(activity!.characterCount).toBe(
      "Project notes".length + "Checkout notes".length + "Payments notes".length,
    );
  });

  test("two rules of one name are read in the order of their ids: the same every run", () => {
    const first: AiContextActivity | null = composeAiContext({
      projectContext: "",
      rules: [rule("id-2", "Same", "Second"), rule("id-1", "Same", "First")],
    });
    const second: AiContextActivity | null = composeAiContext({
      projectContext: "",
      rules: [rule("id-1", "Same", "First"), rule("id-2", "Same", "Second")],
    });

    expect(first).toEqual(second);
    expect(
      first!.parts.map((part: { text: string }) => {
        return part.text;
      }),
    ).toEqual(["First", "Second"]);
  });

  test("a rule's notes alone, when the project has none", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: "",
      rules: [rule("r1", "Checkout", "Checkout notes")],
    });

    expect(hasProjectAiContext(activity!)).toBe(false);
    expect(getAiContextRuleParts(activity!)).toHaveLength(1);
  });

  test("a rule named twice is read once; a rule without notes adds nothing", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: "Project notes",
      rules: [
        rule("R1", "Checkout", "Checkout notes"),
        rule("r1", "Checkout", "Checkout notes"),
        rule("r2", "Empty", "   "),
        rule("r3", "Nothing", undefined),
      ],
    });

    expect(activity!.parts).toHaveLength(2);
  });

  test("each part is held to its own limit", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: textOf(PROJECT_AI_CONTEXT_MAX_CHARACTERS + 500, "p"),
      rules: [
        rule("r1", "Long", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 10, "r")),
      ],
    });

    expect(activity!.parts[0]!.text).toHaveLength(
      PROJECT_AI_CONTEXT_MAX_CHARACTERS,
    );
    expect(activity!.parts[1]!.text).toHaveLength(
      AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
    );
    expect(activity!.characterCount).toBe(AI_CONTEXT_RUN_MAX_CHARACTERS - 5000);
  });

  test("past 30,000 characters a rule's notes are left out whole - and named - while a later shorter one still fits", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: textOf(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
      rules: [
        rule("r1", "A first", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS, "a")),
        rule("r2", "B second", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS - 10, "b")),
        rule("r3", "C third", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS, "c")),
        rule("r4", "D fourth", textOf(10, "d")),
      ],
    });

    expect(
      getAiContextRuleParts(activity!).map((part: { ruleName?: string }) => {
        return part.ruleName;
      }),
    ).toEqual(["A first", "B second", "D fourth"]);
    expect(activity!.leftOutRuleNames).toEqual(["C third"]);
    expect(activity!.characterCount).toBe(AI_CONTEXT_RUN_MAX_CHARACTERS);
    // Nothing of the left-out rule is in what the run read.
    for (const part of activity!.parts) {
      expect(part.text).not.toContain("c");
    }
  });

  test("with nothing left out, the activity says nothing about it", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: "Project notes",
    });

    expect(activity).not.toHaveProperty("leftOutRuleNames");
  });

  test("the token estimate adds up the parts", () => {
    const activity: AiContextActivity | null = composeAiContext({
      projectContext: textOf(400),
      rules: [rule("r1", "Rule", textOf(40, "日"))],
    });

    expect(activity!.estimatedTokenCount).toBe(100 + 30);
  });
});

describe("isAiContextActivity: what the activity may draw", () => {
  test("a composed activity is one", () => {
    expect(
      isAiContextActivity(
        composeAiContext({
          projectContext: "Project notes",
          rules: [rule("r1", "Rule", "Rule notes")],
        }),
      ),
    ).toBe(true);
  });

  test("anything else read back from a row is not", () => {
    for (const value of [
      undefined,
      null,
      "text",
      [],
      {},
      { parts: [] },
      { parts: "x" },
      { parts: [null] },
      { parts: [{ source: "Somewhere", text: "x" }] },
      { parts: [{ source: AiContextSource.Project }] },
      { parts: [{ source: AiContextSource.AiRule, text: 3 }] },
    ]) {
      expect(isAiContextActivity(value)).toBe(false);
    }
  });
});

describe("describeAiContextActivityInEnglish: the event's message", () => {
  test("the project's notes", () => {
    expect(
      describeAiContextActivityInEnglish(
        composeAiContext({ projectContext: textOf(2360) })!,
      ),
    ).toBe("Read the project's AI context (about 590 tokens).");
  });

  test("the project's and its rules', by name", () => {
    expect(
      describeAiContextActivityInEnglish(
        composeAiContext({
          projectContext: textOf(4),
          rules: [
            rule("r1", "Checkout", textOf(4)),
            rule("r2", "Payments", textOf(4)),
          ],
        })!,
      ),
    ).toBe(
      'Read the project\'s AI context and the AI context of AI rules "Checkout" and "Payments" (about 3 tokens).',
    );
  });

  test("one rule's alone", () => {
    expect(
      describeAiContextActivityInEnglish(
        composeAiContext({
          projectContext: "",
          rules: [rule("r1", "Checkout", textOf(4))],
        })!,
      ),
    ).toBe('Read the AI context of AI rule "Checkout" (about 1 token).');
  });

  test("and the rules left out", () => {
    expect(
      describeAiContextActivityInEnglish(
        composeAiContext({
          projectContext: textOf(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
          rules: [
            rule("r1", "A", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)),
            rule("r2", "B", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)),
            rule("r3", "C", textOf(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)),
          ],
        })!,
      ),
    ).toContain(
      'Left out the AI context of AI rule "C": a run reads at most 30,000 characters of AI context.',
    );
  });
});
