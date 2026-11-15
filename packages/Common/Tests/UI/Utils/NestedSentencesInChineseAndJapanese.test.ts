import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  composedValue,
  createTranslator,
  forgetRememberedSentenceEdges,
  formatList,
  MAX_REMEMBERED_SENTENCE_EDGES,
  translatableTerm,
  Translator,
} from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";

/*
 * A SENTENCE INSIDE ANOTHER, IN CHINESE AND JAPANESE (#8532).
 *
 * Chinese and Japanese write no space between their words, and their
 * locale files put one beside every {{placeholder}}; the Translator drops
 * it where a term in their own script meets their words (#7864). A value
 * that is itself a sentence (composedValue) kept it: a criteria filter's
 * summary read "过去 5 分钟内的 ... 的平均值 大于 90%" and "... の平均値 が 90%
 * より大きい". A nested sentence now closes up on a side whose letter is
 * OneUptime's own words, and keeps the space on a side where a name someone
 * typed, a number or a Latin word stands.
 */

// A translator over `words`, in `language`.
function translatorOver(
  language: string,
  words: Record<string, string>,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

const JAPANESE: Record<string, string> = {
  "{{subject}} is greater than {{value}}":
    "{{subject}} が {{value}} より大きい",
  "average value of {{measure}}": "{{measure}} の平均値",
  "{{name}} of this host": "このホストの {{name}}",
  "the average of {{name}}": "{{name}} の平均",
  "{{subject}} is empty": "{{subject}} が空",
};

const CHINESE: Record<string, string> = {
  "{{subject}} is greater than {{value}}": "{{subject}} 大于 {{value}}",
  "average value of {{measure}}": "{{measure}} 的平均值",
  "{{name}} of this host": "此主机的 {{name}}",
  "the average of {{name}}": "{{name}} 的平均",
  "{{subject}} is empty": "{{subject}} 为空",
};

function greaterThan(
  translator: Translator,
  subject: (sentence: Translator) => string,
): string {
  return translator.translateTemplate("{{subject}} is greater than {{value}}", {
    subject: composedValue(subject),
    value: "90",
  });
}

beforeEach(() => {
  forgetRememberedSentenceEdges();
});

describe("a sentence that ends in its own words meets the next word with no space", () => {
  test('Japanese: "の平均値が", never "の平均値 が"', () => {
    const japanese: Translator = translatorOver("ja", JAPANESE);

    expect(
      greaterThan(japanese, (sentence: Translator): string => {
        return sentence.translateTemplate("average value of {{measure}}", {
          measure: "CPU",
        });
      }),
    ).toBe("CPU の平均値が 90 より大きい");
  });

  test('Chinese: "的平均值大于", never "的平均值 大于"', () => {
    const chinese: Translator = translatorOver("zh-CN", CHINESE);

    expect(
      greaterThan(chinese, (sentence: Translator): string => {
        return sentence.translateTemplate("average value of {{measure}}", {
          measure: "CPU",
        });
      }),
    ).toBe("CPU 的平均值大于 90");
  });

  test("Traditional Chinese reads the same way", () => {
    const traditional: Translator = translatorOver("zh-TW", {
      "{{subject}} is empty": "{{subject}} 為空",
      "{{name}} of this host": "此主機的 {{name}}",
    });

    expect(
      traditional.translateTemplate("{{subject}} is empty", {
        subject: composedValue((sentence: Translator): string => {
          return sentence.translateTemplate("{{name}} of this host", {
            name: translatableTerm("磁碟"),
          });
        }),
      }),
    ).toBe("此主機的磁碟為空");
  });

  test("a sentence that starts with its own words meets the word before it with no space", () => {
    const japanese: Translator = translatorOver("ja", {
      ...JAPANESE,
      "Check: {{condition}}": "確認 {{condition}}",
    });

    expect(
      japanese.translateTemplate("Check: {{condition}}", {
        condition: composedValue((sentence: Translator): string => {
          return sentence.translateTemplate("{{name}} of this host", {
            name: "CPU",
          });
        }),
      }),
    ).toBe("確認このホストの CPU");
  });

  test("nested again, each sentence closes up where its own words meet", () => {
    const chinese: Translator = translatorOver("zh-CN", CHINESE);

    expect(
      greaterThan(chinese, (outer: Translator): string => {
        return outer.translateTemplate("average value of {{measure}}", {
          measure: composedValue((inner: Translator): string => {
            return inner.translateTemplate("{{name}} of this host", {
              name: translatableTerm("磁盘"),
            });
          }),
        });
      }),
    ).toBe("此主机的磁盘的平均值大于 90");
  });
});

describe("a name someone typed, a number or a Latin word keeps its space", () => {
  test("a sentence that ends in a typed name keeps the space after it", () => {
    const japanese: Translator = translatorOver("ja", JAPANESE);

    expect(
      japanese.translateTemplate("{{subject}} is empty", {
        subject: composedValue((sentence: Translator): string => {
          return sentence.translateTemplate("{{name}} of this host", {
            // A name someone typed, in Japanese.
            name: "本番データベース",
          });
        }),
      }),
    ).toBe("このホストの 本番データベース が空");
  });

  test("a sentence that starts with a typed name keeps the space before it", () => {
    const chinese: Translator = translatorOver("zh-CN", {
      ...CHINESE,
      "Check: {{condition}}": "检查 {{condition}}",
    });

    expect(
      chinese.translateTemplate("Check: {{condition}}", {
        condition: composedValue((sentence: Translator): string => {
          return sentence.translateTemplate("the average of {{name}}", {
            name: "生产数据库",
          });
        }),
      }),
    ).toBe("检查 生产数据库 的平均");
  });

  test("a Latin word or a figure at the edge keeps its space", () => {
    const chinese: Translator = translatorOver("zh-CN", CHINESE);

    expect(
      chinese.translateTemplate("{{subject}} is empty", {
        subject: composedValue((sentence: Translator): string => {
          return sentence.translateTemplate("{{name}} of this host", {
            name: translatableTerm("CPU"),
          });
        }),
      }),
    ).toBe("此主机的 CPU 为空");
  });

  test("a value put together from names, not one sentence, keeps its spaces", () => {
    const japanese: Translator = translatorOver("ja", JAPANESE);

    expect(
      japanese.translateTemplate("{{subject}} is empty", {
        subject: composedValue((sentence: Translator): string => {
          return formatList(["本番", "検証"], sentence);
        }),
      }),
    ).toBe("本番、検証 が空");
  });
});

describe("only the languages that write no space between their words", () => {
  test("Korean, German, Persian and English keep every space", () => {
    for (const [language, words] of [
      ["ko", { "{{subject}} is empty": "{{subject}} 비어 있음" }],
      ["de", { "{{subject}} is empty": "{{subject}} ist leer" }],
      ["fa", { "{{subject}} is empty": "{{subject}} خالی است" }],
    ] as Array<[string, Record<string, string>]>) {
      const translator: Translator = translatorOver(language, {
        ...words,
        "{{name}} of this host": "{{name}}",
      });

      const written: string = translator.translateTemplate(
        "{{subject}} is empty",
        {
          subject: composedValue((sentence: Translator): string => {
            return sentence.translateTemplate("{{name}} of this host", {
              name: translatableTerm("디스크"),
            });
          }),
        },
      );

      expect(written).toContain("디스크 ");
    }

    expect(
      createTranslator(undefined, "en").translateTemplate(
        "{{subject}} is empty",
        {
          subject: composedValue((sentence: Translator): string => {
            return sentence.translateTemplate("average value of {{measure}}", {
              measure: "CPU",
            });
          }),
        },
      ),
    ).toBe("average value of CPU is empty");
  });

  test("an English sentence on a Japanese page holds English, spaced as English", () => {
    const japanese: Translator = translatorOver("ja", {
      "average value of {{measure}}": "{{measure}} の平均値",
    });

    // The outer sentence has no Japanese wording: English, whole.
    expect(
      greaterThan(japanese, (sentence: Translator): string => {
        return sentence.translateTemplate("average value of {{measure}}", {
          measure: "CPU",
        });
      }),
    ).toBe("average value of CPU is greater than 90");
  });
});

describe("what is remembered", () => {
  test("only so many sentences, the oldest going first", () => {
    const japanese: Translator = translatorOver("ja", JAPANESE);
    const first: string = japanese.translateTemplate(
      "average value of {{measure}}",
      { measure: "0" },
    );

    for (
      let index: number = 1;
      index <= MAX_REMEMBERED_SENTENCE_EDGES;
      index++
    ) {
      japanese.translateTemplate("average value of {{measure}}", {
        measure: String(index),
      });
    }

    // The first is forgotten: a value with its text keeps its space.
    expect(
      japanese.translateTemplate("{{subject}} is empty", {
        subject: composedValue((): string => {
          return first;
        }),
      }),
    ).toBe(`${first} が空`);
  });

  test("a composed value is looked up by the text it composed to, nothing else", () => {
    const japanese: Translator = translatorOver("ja", JAPANESE);

    // A plain string with a remembered sentence's text is still a plain string.
    const sentence: string = japanese.translateTemplate(
      "average value of {{measure}}",
      { measure: "CPU" },
    );

    expect(
      japanese.translateTemplate("{{subject}} is empty", { subject: sentence }),
    ).toBe(`${sentence} が空`);
  });
});

describe("the criteria list, with the shipped locales", () => {
  const DISK: CriteriaFilter = {
    checkOn: CheckOn.DiskUsagePercent,
    filterType: FilterType.GreaterThan,
    value: 90,
    serverMonitorOptions: { diskPath: "/dev/sda" },
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.Average,
    },
  };

  test.each([
    ["ja", "の平均値が", "の平均値 が"],
    ["zh-CN", "的平均值大于", "的平均值 大于"],
    ["zh-TW", "的平均值大於", "的平均值 大於"],
  ])(
    "%s: the average meets the comparison with no space",
    (language: string, closed: string, spaced: string) => {
      const summary: string = CriteriaFilterUtil.translateFilterToText(
        DISK,
        undefined,
        translatorOver(language, readDashboardLocale(language)),
      );

      expect(summary).toContain(closed);
      expect(summary).not.toContain(spaced);
      // The path someone typed keeps its spaces.
      expect(summary).toMatch(/ \/dev\/sda /);
    },
  );

  test.each(["en", "de", "ar", "fa"])(
    "%s: every space as before",
    (language: string) => {
      const summary: string = CriteriaFilterUtil.translateFilterToText(
        DISK,
        undefined,
        translatorOver(language, readDashboardLocale(language)),
      );

      expect(summary).toContain("/dev/sda");
      expect(summary.split(" ").length).toBeGreaterThan(8);
    },
  );
});
