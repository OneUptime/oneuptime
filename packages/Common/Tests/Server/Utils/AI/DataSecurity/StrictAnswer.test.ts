import {
  getAnswerJsonText,
  MAX_STRICT_ANSWER_CHARACTERS,
  readStrictAnswer,
  StrictAnswer,
  StrictFlag,
  StrictList,
  StrictNullable,
  StrictNumber,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "../../../../../Server/Utils/AI/DataSecurity/StrictAnswer";
import { describe, expect, test } from "@jest/globals";

/*
 * A DATA SECURITY FEATURE'S ANSWER IS THE OBJECT ASKED FOR, OR NO ANSWER
 * (#10365).
 *
 * Every feature reads OneUptime AI's structured answer through
 * readStrictAnswer, never a parser of its own: one JSON object, alone or in
 * one code fence, of the shape asked, typed as the shape says.
 */

// A verdict with a reason and a list of places, as a feature would ask.
const VERDICT: StrictObject<{
  verdict: StrictText;
  confidence: StrictNumber;
  isReal: StrictFlag;
  reason: StrictOptional<StrictText>;
  owner: StrictNullable<StrictText>;
  places: StrictList<StrictObject<{ location: StrictText }>>;
}> = StrictAnswer.object({
  verdict: StrictAnswer.text({
    maxLength: 20,
    oneOf: ["real", "noise", "unsure"],
  }),
  confidence: StrictAnswer.number({ min: 0, max: 1 }),
  isReal: StrictAnswer.flag(),
  reason: StrictAnswer.optional(
    StrictAnswer.text({ maxLength: 40, isOneLine: true }),
  ),
  owner: StrictAnswer.nullable(
    StrictAnswer.text({ maxLength: 10, whenTooLong: "refuse" }),
  ),
  places: StrictAnswer.list(
    StrictAnswer.object({ location: StrictAnswer.text({ maxLength: 50 }) }),
    { maxItems: 3 },
  ),
});

type Verdict = StrictValue<typeof VERDICT>;

function answer(value: unknown): string {
  return JSON.stringify(value);
}

const GOOD: Record<string, unknown> = {
  verdict: "real",
  confidence: 0.9,
  isReal: true,
  reason: "The bucket is public.",
  owner: "team-a",
  places: [{ location: "public.users.email" }],
};

describe("an answer is the object asked for", () => {
  test("is read as the shape says, typed", () => {
    const read: Verdict | null = readStrictAnswer(answer(GOOD), VERDICT);

    expect(read).toEqual(GOOD);

    // Typed: what the shape says each field is.
    const verdict: string | undefined = read?.verdict;
    const confidence: number | undefined = read?.confidence;
    const owner: string | null | undefined = read?.owner;

    expect([verdict, confidence, owner]).toEqual(["real", 0.9, "team-a"]);
  });

  test("in one code fence, or with white space around it", () => {
    expect(
      readStrictAnswer(`\`\`\`json\n${answer(GOOD)}\n\`\`\``, VERDICT),
    ).toEqual(GOOD);
    expect(readStrictAnswer(`\`\`\`\n${answer(GOOD)}\n\`\`\``, VERDICT)).toEqual(
      GOOD,
    );
    expect(readStrictAnswer(`\n\n  ${answer(GOOD)}  \n`, VERDICT)).toEqual(
      GOOD,
    );
  });

  test("a field the shape does not name is left out, never read", () => {
    expect(
      readStrictAnswer(
        answer({ ...GOOD, deleteTheRepository: true, extra: { a: 1 } }),
        VERDICT,
      ),
    ).toEqual(GOOD);
  });

  test("an optional field may be missing; a nullable one may be null", () => {
    const withoutReason: Record<string, unknown> = { ...GOOD, owner: null };
    delete withoutReason["reason"];

    expect(readStrictAnswer(answer(withoutReason), VERDICT)).toEqual(
      withoutReason,
    );
  });
});

describe("anything else is no answer", () => {
  test("words before or after the object", () => {
    for (const content of [
      `Here is the answer: ${answer(GOOD)}`,
      `${answer(GOOD)}\nLet me know if you need more.`,
      `Sure!\n\`\`\`json\n${answer(GOOD)}\n\`\`\``,
      `\`\`\`json\n${answer(GOOD)}\n\`\`\`\nThat is my verdict.`,
    ]) {
      expect({ content, read: readStrictAnswer(content, VERDICT) }).toEqual({
        content,
        read: null,
      });
    }
  });

  test("two fences, or a fence that is not closed", () => {
    expect(
      readStrictAnswer(
        `\`\`\`json\n${answer(GOOD)}\n\`\`\`\n\`\`\`json\n${answer(GOOD)}\n\`\`\``,
        VERDICT,
      ),
    ).toBeNull();
    expect(readStrictAnswer(`\`\`\`json\n${answer(GOOD)}`, VERDICT)).toBeNull();
  });

  test("not JSON, not an object, or empty", () => {
    for (const content of [
      "",
      "   ",
      "I cannot help with that.",
      "{not json}",
      "[]",
      answer([GOOD]),
      "null",
      "42",
    ]) {
      expect({ content, read: readStrictAnswer(content, VERDICT) }).toEqual({
        content,
        read: null,
      });
    }

    expect(readStrictAnswer(undefined, VERDICT)).toBeNull();
    expect(readStrictAnswer(null, VERDICT)).toBeNull();
  });

  test(`longer than ${MAX_STRICT_ANSWER_CHARACTERS} characters`, () => {
    const long: string = answer({
      ...GOOD,
      padding: "x".repeat(MAX_STRICT_ANSWER_CHARACTERS),
    });

    expect(readStrictAnswer(long, VERDICT)).toBeNull();
  });

  test("a field the shape names is missing, or of another kind", () => {
    const missing: Record<string, unknown> = { ...GOOD };
    delete missing["verdict"];

    for (const value of [
      missing,
      { ...GOOD, verdict: 1 },
      { ...GOOD, confidence: "0.9" },
      { ...GOOD, isReal: "true" },
      { ...GOOD, owner: undefined },
      { ...GOOD, places: "public.users.email" },
      { ...GOOD, reason: 7 },
    ]) {
      expect(readStrictAnswer(answer(value), VERDICT)).toBeNull();
    }
  });

  test("a choice that is not one of its values", () => {
    expect(
      readStrictAnswer(answer({ ...GOOD, verdict: "benign" }), VERDICT),
    ).toBeNull();
    expect(
      readStrictAnswer(answer({ ...GOOD, verdict: "Real" }), VERDICT),
    ).toBeNull();
  });

  test("a number out of its bounds, or not finite, or not whole where it must be", () => {
    expect(
      readStrictAnswer(answer({ ...GOOD, confidence: 1.5 }), VERDICT),
    ).toBeNull();
    expect(
      readStrictAnswer(answer({ ...GOOD, confidence: -0.1 }), VERDICT),
    ).toBeNull();
    expect(
      readStrictAnswer('{"count": 1e400}', {
        kind: "object",
        fields: { count: StrictAnswer.number({ min: 0, max: 10 }) },
      }),
    ).toBeNull();

    const WHOLE: StrictObject<{ count: StrictNumber }> = StrictAnswer.object({
      count: StrictAnswer.number({ min: 0, max: 10, isWhole: true }),
    });

    expect(readStrictAnswer('{"count": 2.5}', WHOLE)).toBeNull();
    expect(readStrictAnswer('{"count": 2}', WHOLE)).toEqual({ count: 2 });
  });

  test("a text that must not be cut, longer than it may be", () => {
    expect(
      readStrictAnswer(answer({ ...GOOD, owner: "a-much-longer-owner" }), VERDICT),
    ).toBeNull();
  });
});

describe("text", () => {
  test("is cut to its length by default, never inside a character", () => {
    const read: Verdict | null = readStrictAnswer(
      answer({ ...GOOD, reason: `${"x".repeat(39)}😀 and more` }),
      VERDICT,
    );

    expect(read?.reason).toBe("x".repeat(39));
  });

  test("on one line where the shape says so", () => {
    const read: Verdict | null = readStrictAnswer(
      answer({ ...GOOD, reason: "  The bucket\n\nis   public.\t" }),
      VERDICT,
    );

    expect(read?.reason).toBe("The bucket is public.");
  });

  test("kept as written otherwise", () => {
    const TEXT: StrictObject<{ text: StrictText }> = StrictAnswer.object({
      text: StrictAnswer.text({ maxLength: 100 }),
    });

    expect(readStrictAnswer(answer({ text: "a\n\nb" }), TEXT)).toEqual({
      text: "a\n\nb",
    });
  });
});

describe("lists", () => {
  test("an item not of its shape is left out, and the rest kept", () => {
    const read: Verdict | null = readStrictAnswer(
      answer({
        ...GOOD,
        places: [{ location: "a" }, { location: 7 }, { location: "d" }],
      }),
      VERDICT,
    );

    expect(read?.places).toEqual([{ location: "a" }, { location: "d" }]);

    const LOCATIONS: StrictObject<{
      places: StrictList<StrictObject<{ location: StrictText }>>;
    }> = StrictAnswer.object({
      places: StrictAnswer.list(
        StrictAnswer.object({
          location: StrictAnswer.text({ maxLength: 50 }),
        }),
        { maxItems: 10 },
      ),
    });

    expect(
      readStrictAnswer(
        answer({
          places: [
            { location: "a" },
            "b",
            null,
            7,
            [],
            { other: "c" },
            { location: "d" },
          ],
        }),
        LOCATIONS,
      ),
    ).toEqual({ places: [{ location: "a" }, { location: "d" }] });
  });

  test("or refuses the whole answer, where the list says so", () => {
    const STRICT_LIST: StrictObject<{
      ids: StrictList<StrictText>;
    }> = StrictAnswer.object({
      ids: StrictAnswer.list(StrictAnswer.text({ maxLength: 10 }), {
        maxItems: 5,
        whenItemIsWrong: "refuse",
      }),
    });

    expect(readStrictAnswer(answer({ ids: ["a", "b"] }), STRICT_LIST)).toEqual({
      ids: ["a", "b"],
    });
    expect(readStrictAnswer(answer({ ids: ["a", 2] }), STRICT_LIST)).toBeNull();
  });

  test("is read only as far as it may be long", () => {
    const read: Verdict | null = readStrictAnswer(
      answer({
        ...GOOD,
        places: [
          { location: "1" },
          { location: "2" },
          { location: "3" },
          { location: "4" },
          { location: "5" },
        ],
      }),
      VERDICT,
    );

    expect(read?.places).toEqual([
      { location: "1" },
      { location: "2" },
      { location: "3" },
    ]);
  });
});

describe("the JSON of an answer", () => {
  test("is the whole answer, or the whole of its one fence", () => {
    expect(getAnswerJsonText('{"a":1}')).toBe('{"a":1}');
    expect(getAnswerJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(getAnswerJsonText('```JSON\r\n{"a":1}\r\n```')).toBe('{"a":1}');
    expect(getAnswerJsonText('x {"a":1}')).toBeUndefined();
    expect(getAnswerJsonText('```json\n["a"]\n```')).toBeUndefined();
  });

  test("is only parsed, never run", () => {
    expect(
      readStrictAnswer('{"verdict": (() => "real")()}', VERDICT),
    ).toBeNull();
  });
});
