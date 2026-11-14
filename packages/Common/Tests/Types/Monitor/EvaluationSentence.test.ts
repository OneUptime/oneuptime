import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  evaluationTerm,
  evaluationTime,
  isEvaluationSentence,
  isWhollyWorded,
  translatablePluralSentence,
  translatableSentence,
  wordEvaluationSentence,
  wordStoredEvaluationText,
} from "../../../Types/Monitor/EvaluationSentence";
import {
  createTranslator,
  translationKey,
  Translator,
} from "../../../Types/Translator";

/*
 * A sentence the monitor engine stores beside its English, for each reader
 * to read in their language (issue #6542): the English it fills is what
 * the server stores, and a reader's language words it whole or not at all.
 */

const CHINESE: Record<string, string> = {
  "Response Status Code was {{code}}.": "响应状态码为 {{code}}。",
  "{{observation}} (expected {{expectation}}).":
    "{{observation}}（预期 {{expectation}}）。",
  "to be greater than {{value}}": "大于 {{value}}",
  "Response Status Code": "响应状态码",
  "Monitor reported online status at {{time}}.":
    "监视器于 {{time}} 报告在线状态。",
  "parent monitors {{parents}}": "父监视器 {{parents}}",
  '"{{monitor}}" is {{status}}': "“{{monitor}}”为 {{status}}",
  "{{check}} {{condition}} {{value}}": "{{check}} {{condition}} {{value}}",
  "Greater Than": "大于",
  true: "真",
};

const chinese: Translator = createTranslator((key: string) => {
  return CHINESE[key];
}, "zh-CN");

const GERMAN: Record<string, string> = {
  "{{label}} over the last {{count}} minutes":
    "{{label}} in den letzten {{count}} Minuten",
  "{{label}} over the last {{count}} minutes_one":
    "{{label}} in der letzten Minute",
};

const german: Translator = createTranslator((key: string) => {
  return GERMAN[key];
}, "de");

const english: Translator = createTranslator(undefined, "en");

describe("EvaluationSentence", () => {
  describe("its English, as the server stores it", () => {
    test("fills the template's values as they are", () => {
      expect(
        englishOfEvaluationSentence(
          translatableSentence("Response Status Code was {{code}}.", {
            code: "503",
          }),
        ),
      ).toBe("Response Status Code was 503.");
    });

    test("writes a number as stored, and a term as its English", () => {
      expect(
        englishOfEvaluationSentence(
          translatableSentence("{{check}} is {{value}} after {{count}}", {
            check: evaluationTerm("Response Status Code"),
            value: evaluationTerm("true"),
            count: 3,
          }),
        ),
      ).toBe("Response Status Code is true after 3");
    });

    test("fills a part with its own English", () => {
      expect(
        englishOfEvaluationSentence(
          translatableSentence("{{observation}} (expected {{expectation}}).", {
            observation: translatableSentence(
              "Response Status Code was {{code}}.",
              { code: "200" },
            ),
            expectation: translatableSentence("to be greater than {{value}}", {
              value: "499",
            }),
          }),
        ),
      ).toBe(
        "Response Status Code was 200. (expected to be greater than 499).",
      );
    });

    test("picks a count-dependent sentence's form by its count", () => {
      const forms: { one: string; other: string } = {
        one: translationKey("{{label}} over the last minute"),
        other: translationKey("{{label}} over the last {{count}} minutes"),
      };

      expect(
        englishOfEvaluationSentence(
          translatablePluralSentence(forms, 1, { label: "CPU" }),
        ),
      ).toBe("CPU over the last minute");
      expect(
        englishOfEvaluationSentence(
          translatablePluralSentence(forms, 5, { label: "CPU" }),
        ),
      ).toBe("CPU over the last 5 minutes");
    });

    test("writes a count as the engine wrote it, never grouped", () => {
      expect(
        englishOfEvaluationSentence(
          translatablePluralSentence(
            { one: "{{count}} reading", other: "{{count}} readings" },
            12000,
          ),
        ),
      ).toBe("12000 readings");
    });

    test("leaves a value's braces as they are", () => {
      expect(
        englishOfEvaluationSentence(
          translatableSentence("Incident created: {{title}}", {
            title: "Disk {{full}} on $t(host)",
          }),
        ),
      ).toBe("Incident created: Disk {{full}} on $t(host)");
    });

    test("stores a sentence with no values without a values field", () => {
      expect(translatableSentence("Request timed out.")).toEqual({
        template: "Request timed out.",
      });
    });
  });

  describe("in the reader's language", () => {
    test("words the sentence, its parts and its terms in theirs", () => {
      const sentence: EvaluationSentence = translatableSentence(
        "{{observation}} (expected {{expectation}}).",
        {
          observation: translatableSentence(
            "Response Status Code was {{code}}.",
            { code: "200" },
          ),
          expectation: translatableSentence("to be greater than {{value}}", {
            value: "499",
          }),
        },
      );

      expect(isWhollyWorded(sentence, chinese)).toBe(true);
      expect(wordEvaluationSentence(sentence, chinese)).toBe(
        "响应状态码为 200。（预期 大于 499）。",
      );
    });

    test("words a term inside a worded sentence", () => {
      // Two terms side by side in Chinese meet with no space (#7864).
      expect(
        wordStoredEvaluationText({
          english: "Response Status Code Greater Than 499",
          sentence: translatableSentence("{{check}} {{condition}} {{value}}", {
            check: evaluationTerm("Response Status Code"),
            condition: evaluationTerm("Greater Than"),
            value: "499",
          }),
          translator: chinese,
        }),
      ).toBe("响应状态码大于 499");
    });

    test("a sentence a part of which is not worded yet reads in English, whole", () => {
      const sentence: EvaluationSentence = translatableSentence(
        "{{observation}} (expected {{expectation}}).",
        {
          observation: translatableSentence(
            "Response Status Code was {{code}}.",
            { code: "200" },
          ),
          expectation: translatableSentence("to be less than {{value}}", {
            value: "100",
          }),
        },
      );

      expect(isWhollyWorded(sentence, chinese)).toBe(false);
      expect(
        wordStoredEvaluationText({
          english: "stored",
          sentence: sentence,
          translator: chinese,
        }),
      ).toBe("Response Status Code was 200. (expected to be less than 100).");
    });

    test("a template with no words of its own needs no wording", () => {
      const sentence: EvaluationSentence = translatableSentence(
        "{{first}}, {{second}}",
        {
          first: translatableSentence("Response Status Code was {{code}}.", {
            code: "200",
          }),
          second: translatableSentence("Response Status Code was {{code}}.", {
            code: "503",
          }),
        },
      );

      expect(isWhollyWorded(sentence, chinese)).toBe(true);
      // Its comma is written the way the sentence's language writes it.
      expect(wordEvaluationSentence(sentence, chinese)).toBe(
        "响应状态码为 200。，响应状态码为 503。",
      );
    });

    test.each([
      ["zh-CN", "A，B。 C"],
      ["zh-TW", "A，B。 C"],
      ["ja", "A、B。 C"],
      ["ar", "A، B. C"],
      ["fa", "A، B. C"],
      ["de", "A, B. C"],
      ["en", "A, B. C"],
    ])(
      "a wordless template's punctuation reads as %s writes it",
      (language: string, expected: string) => {
        const sentence: EvaluationSentence = translatableSentence(
          "{{first}}, {{second}}. {{third.part}}",
          { first: "A", second: "B", "third.part": "C" },
        );

        expect(
          wordEvaluationSentence(
            sentence,
            createTranslator(undefined, language),
          ),
        ).toBe(expected);
      },
    );

    test("a count-dependent sentence is worded under its general form", () => {
      const forms: { one: string; other: string } = {
        one: translationKey("parent monitor {{parents}}"),
        other: translationKey("parent monitors {{parents}}"),
      };
      const sentence: EvaluationSentence = translatablePluralSentence(
        forms,
        1,
        {
          parents: translatableSentence('"{{monitor}}" is {{status}}', {
            monitor: "Router",
            status: "Offline",
          }),
        },
      );

      // Chinese has one form: it is stored under the general form's key.
      expect(isWhollyWorded(sentence, chinese)).toBe(true);
      expect(wordEvaluationSentence(sentence, chinese)).toBe(
        "父监视器 “Router”为 Offline",
      );
      expect(englishOfEvaluationSentence(sentence)).toBe(
        'parent monitor "Router" is Offline',
      );
    });

    test("a language's one form is read for its count", () => {
      const forms: { one: string; other: string } = {
        one: translationKey("{{label}} over the last minute"),
        other: translationKey("{{label}} over the last {{count}} minutes"),
      };

      expect(
        wordEvaluationSentence(
          translatablePluralSentence(forms, 1, { label: "CPU" }),
          german,
        ),
      ).toBe("CPU in der letzten Minute");
      expect(
        wordEvaluationSentence(
          translatablePluralSentence(forms, 7, { label: "CPU" }),
          german,
        ),
      ).toBe("CPU in den letzten 7 Minuten");
    });

    test("a time is written where it is read, in the reader's language", () => {
      const sentence: EvaluationSentence = translatableSentence(
        "Monitor reported online status at {{time}}.",
        { time: evaluationTime(new Date("2026-11-10T09:30:00.000Z")) },
      );
      const written: Array<string> = [];

      const text: string = wordEvaluationSentence(sentence, chinese, {
        writeTime: (date: Date): string => {
          written.push(date.toISOString());
          return "TIME";
        },
      });

      expect(text).toBe("监视器于 TIME 报告在线状态。");
      expect(written).toEqual(["2026-11-10T09:30:00.000Z"]);
    });

    test("an English reader reads the sentence as the server's English", () => {
      const sentence: EvaluationSentence = translatableSentence(
        "{{check}} {{condition}} {{value}}",
        {
          check: evaluationTerm("Response Status Code"),
          condition: evaluationTerm("Greater Than"),
          value: "499",
        },
      );

      expect(
        wordStoredEvaluationText({
          english: englishOfEvaluationSentence(sentence),
          sentence: sentence,
          translator: english,
        }),
      ).toBe("Response Status Code Greater Than 499");
    });
  });

  describe("a stored value is read only when it is a sentence", () => {
    test.each([
      ["nothing", undefined],
      ["null", null],
      ["text", "Response Status Code was 200."],
      ["an array", [{ template: "x" }]],
      ["no template", { values: {} }],
      ["an empty template", { template: "" }],
      ["a template too long", { template: "a".repeat(1001) }],
      ["a one form without its count", { template: "x", one: "y" }],
      ["a count without its one form", { template: "x", count: 2 }],
      ["a count that is not a number", { template: "x", one: "y", count: "2" }],
      ["an infinite count", { template: "x", one: "y", count: Infinity }],
      ["values that are an array", { template: "x", values: ["a"] }],
      ["a value that is a boolean", { template: "x", values: { a: true } }],
      ["a value that is null", { template: "x", values: { a: null } }],
      ["a value too long", { template: "x", values: { a: "a".repeat(10001) } }],
      ["a non-finite number", { template: "x", values: { a: NaN } }],
      [
        "a term that is not text",
        { template: "x", values: { a: { term: 1 } } },
      ],
      [
        "a time that is not a date",
        { template: "x", values: { a: { time: "yesterday" } } },
      ],
      [
        "a part that is not a sentence",
        { template: "x", values: { a: { template: 5 } } },
      ],
    ])("not %s", (_name: string, value: unknown) => {
      expect(isEvaluationSentence(value)).toBe(false);
      expect(
        wordStoredEvaluationText({
          english: "As stored.",
          sentence: value,
          translator: chinese,
        }),
      ).toBe("As stored.");
    });

    test("not one with more values than a sentence holds", () => {
      const values: Record<string, string> = {};

      for (let index: number = 0; index < 33; index++) {
        values[`v${index}`] = "x";
      }

      expect(isEvaluationSentence({ template: "x", values })).toBe(false);
    });

    test("not one nested deeper than a sentence goes", () => {
      let sentence: EvaluationSentence = translatableSentence("leaf");

      for (let depth: number = 0; depth < 9; depth++) {
        sentence = translatableSentence("{{part}}", { part: sentence });
      }

      expect(isEvaluationSentence(sentence)).toBe(false);
    });

    test("one nested as deep as a sentence goes", () => {
      let sentence: EvaluationSentence = translatableSentence("leaf");

      for (let depth: number = 0; depth < 8; depth++) {
        sentence = translatableSentence("{{part}}", { part: sentence });
      }

      expect(isEvaluationSentence(sentence)).toBe(true);
    });

    test("a sentence round-trips through JSON", () => {
      const sentence: EvaluationSentence = translatablePluralSentence(
        { one: "{{count}} reading", other: "{{count}} readings" },
        2,
        {
          check: evaluationTerm("Response Status Code", { inSentence: true }),
          at: evaluationTime("2026-11-10T09:30:00.000Z"),
          part: translatableSentence("Request timed out."),
        },
      );

      expect(isEvaluationSentence(JSON.parse(JSON.stringify(sentence)))).toBe(
        true,
      );
    });

    test("the English stored beside it is shown when wording throws", () => {
      const throwing: Translator = {
        ...chinese,
        translateTemplate: (): string => {
          throw new Error("broken locale");
        },
      };

      expect(
        wordStoredEvaluationText({
          english: "Response Status Code was 200.",
          sentence: translatableSentence("Response Status Code was {{code}}.", {
            code: "200",
          }),
          translator: throwing,
        }),
      ).toBe("Response Status Code was 200.");
    });
  });
});
