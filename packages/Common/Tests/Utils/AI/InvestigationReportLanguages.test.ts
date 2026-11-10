import {
  ENGLISH_REPORT_LANGUAGE_CODE,
  ENGLISH_REPORT_WORDS,
  INVESTIGATION_REPORT_HEADING_TERMS,
  INVESTIGATION_REPORT_IMPACT_LABEL_TERMS,
  INVESTIGATION_REPORT_LANGUAGES,
  InvestigationReportLanguage,
  InvestigationReportTerm,
  getInvestigationReportLanguage,
  getInvestigationReportWordKey,
  getTranslatedReportWords,
  readTranslatedReportTerm,
} from "../../../Utils/AI/InvestigationReportLanguages";
import {
  IMPACT_LINE_LABELS,
  IMPACT_SECTION_TITLE,
  InvestigationImpactAspect,
  InvestigationImpactLine,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  RULED_OUT_SECTION_TITLE,
  RuledOutCause,
  getImpactAspect,
  parseImpactLines,
  parseInvestigationReport,
  parseRuledOutCauses,
} from "../../../Utils/AI/InvestigationReport";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN AI REPORT WRITTEN IN THE LANGUAGE THE TEAM ASKED FOR IS LAID OUT AS AN
 * ENGLISH ONE IS (issue #6542).
 *
 * A team that reads OneUptime in Chinese wrote "用中文回复" (reply in
 * Chinese) in its AI context. OneUptime AI now writes what people read in
 * that language, headings included, and the AI card lays a report out by
 * its headings: the summary first, the impact with a mark for each line,
 * the causes ruled out as a list. So the report parser reads a heading or
 * an Impact label in every language the Dashboard reads - the words a run
 * is told to write (InvestigationReportLanguages), the other words a model
 * writes for them, the full-width colon and brackets Chinese and Japanese
 * write - as it reads the English ones, and English reads as it always did.
 * ---------------------------------------------------------------------------
 */

const BRAND_HEADING: string = "## 🧠 AI — Automated Root Cause Analysis";

const EVIDENCE_CHECKED: string = [
  "**Evidence checked**",
  "- **[C1]** Logs for checkout-api — 7 row(s)",
  "- **[C2]** Traces for checkout-api — 20 row(s)",
  "- **[C3]** Metrics for payments-db — 12 row(s)",
].join("\n");

const FOOTER: string = [
  "---",
  "*Investigated automatically by OneUptime AI — read-only, 3 queries run across your own telemetry using gpt-4.1. This is an AI-generated first pass; verify before acting.*",
].join("\n");

function languageOf(code: string): InvestigationReportLanguage {
  const language: InvestigationReportLanguage | undefined =
    getInvestigationReportLanguage(code);

  expect(language).toBeDefined();

  return language!;
}

/*
 * The report the investigation persona asks for, with a language's words
 * for its headings and labels - and a colon after each bold label, ASCII
 * or full width. The text under them stays English: only the words the
 * card lays the report out by change.
 */
function reportIn(
  language: InvestigationReportLanguage,
  colon: string = ":",
): string {
  const words: Readonly<Record<InvestigationReportTerm, string>> =
    language.words;

  return [
    BRAND_HEADING,
    "",
    `**${words.Summary}**`,
    "checkout-api restarted with its pool cut to 10 [C1].",
    "",
    `**${words.Impact}**`,
    `- **${words.Users}${colon}** about 1,240 failed checkout requests since 14:02 [C2].`,
    `- **${words.Services}${colon}** checkout-api, and cart-api, which calls it.`,
    `- **${words.Slos}${colon}** Checkout availability is At Risk, 38% of its error budget left [C1].`,
    "",
    `**${words.RootCause}** (medium confidence)`,
    "Release 2026.09.14-2 set `DB_POOL_MAX` to 10 [C1].",
    "",
    `**${words.Evidence}**`,
    "- pool waits rose from 0 to 1,900 [C1]",
    "",
    `**${words.RuledOut}**`,
    `- **A traffic spike${colon}** checkout requests were flat [C2].`,
    `- **The database${colon}** payments-db CPU stayed under 20% [C3].`,
    "",
    `**${words.NextSteps}**`,
    "1. Roll checkout-api back.",
    "",
    EVIDENCE_CHECKED,
    "",
    FOOTER,
  ].join("\n");
}

// A word starts with a letter, in any script.
const LETTER_FIRST_REGEX: RegExp = /^\p{L}/u;

/*
 * What would split a word: a table's cell, emphasis, code, a heading, a
 * colon, a bracket, a line break.
 */
const LABEL_SPLITTING_CHARACTER_REGEX: RegExp = /[|*_`#:：()（）[\]\n\r]/;

const ENGLISH: InvestigationReportLanguage = languageOf(
  ENGLISH_REPORT_LANGUAGE_CODE,
);

const OTHER_LANGUAGES: Array<InvestigationReportLanguage> =
  INVESTIGATION_REPORT_LANGUAGES.filter(
    (language: InvestigationReportLanguage): boolean => {
      return language.code !== ENGLISH_REPORT_LANGUAGE_CODE;
    },
  );

const HEADING_KINDS: Record<string, InvestigationReportSectionKind> = {
  [InvestigationReportTerm.Summary]: InvestigationReportSectionKind.Summary,
  [InvestigationReportTerm.Impact]: InvestigationReportSectionKind.Impact,
  [InvestigationReportTerm.RootCause]: InvestigationReportSectionKind.RootCause,
  [InvestigationReportTerm.Evidence]: InvestigationReportSectionKind.Evidence,
  [InvestigationReportTerm.RuledOut]: InvestigationReportSectionKind.RuledOut,
  [InvestigationReportTerm.NextSteps]: InvestigationReportSectionKind.NextSteps,
};

const IMPACT_ASPECTS: Record<string, InvestigationImpactAspect> = {
  [InvestigationReportTerm.Users]: InvestigationImpactAspect.Users,
  [InvestigationReportTerm.Services]: InvestigationImpactAspect.Services,
  [InvestigationReportTerm.Slos]: InvestigationImpactAspect.Slos,
};

// What the card lays a report out by: each section's kind, in order.
function kindsOf(
  report: ParsedInvestigationReport,
): Array<InvestigationReportSectionKind> {
  return report.sections.map(
    (section: InvestigationReportSection): InvestigationReportSectionKind => {
      return section.kind;
    },
  );
}

function titlesOf(report: ParsedInvestigationReport): Array<string> {
  return report.sections.map((section: InvestigationReportSection): string => {
    return section.title;
  });
}

function aspectsOf(
  report: ParsedInvestigationReport,
): Array<InvestigationImpactAspect | null> {
  return parseImpactLines(report.impact).map(
    (line: InvestigationImpactLine): InvestigationImpactAspect | null => {
      return line.aspect;
    },
  );
}

function causesOf(report: ParsedInvestigationReport): Array<string> {
  return parseRuledOutCauses(report.ruledOut).map(
    (cause: RuledOutCause): string => {
      return cause.causeMarkdown;
    },
  );
}

// Every word a language writes for a term: the one a run is told, then the others.
function wordsFor(
  language: InvestigationReportLanguage,
  term: InvestigationReportTerm,
): Array<string> {
  return [language.words[term], ...(language.otherWords[term] || [])];
}

const ENGLISH_REPORT: ParsedInvestigationReport = parseInvestigationReport(
  reportIn(ENGLISH),
);

const ENGLISH_KINDS: Array<InvestigationReportSectionKind> = [
  InvestigationReportSectionKind.Summary,
  InvestigationReportSectionKind.Impact,
  InvestigationReportSectionKind.RootCause,
  InvestigationReportSectionKind.Evidence,
  InvestigationReportSectionKind.RuledOut,
  InvestigationReportSectionKind.NextSteps,
];

const IMPACT_LINE_ASPECTS: Array<InvestigationImpactAspect> = [
  InvestigationImpactAspect.Users,
  InvestigationImpactAspect.Services,
  InvestigationImpactAspect.Slos,
];

describe("the table of words", () => {
  test("has a language for every language the Dashboard reads, in its order, English first", () => {
    expect(
      INVESTIGATION_REPORT_LANGUAGES.map(
        (language: InvestigationReportLanguage): string => {
          return language.code;
        },
      ),
    ).toEqual(SUPPORTED_DASHBOARD_LANGUAGE_CODES);
    expect(INVESTIGATION_REPORT_LANGUAGES[0]!.code).toBe(
      ENGLISH_REPORT_LANGUAGE_CODE,
    );
  });

  test("English's words are the ones the parser and the persona spell", () => {
    expect(ENGLISH_REPORT_WORDS).toBe(ENGLISH.words);
    expect(ENGLISH_REPORT_WORDS.Summary).toBe("Summary");
    expect(ENGLISH_REPORT_WORDS.Impact).toBe(IMPACT_SECTION_TITLE);
    expect(ENGLISH_REPORT_WORDS.RootCause).toBe("Most likely root cause");
    expect(ENGLISH_REPORT_WORDS.Evidence).toBe("Evidence");
    expect(ENGLISH_REPORT_WORDS.RuledOut).toBe(RULED_OUT_SECTION_TITLE);
    expect(ENGLISH_REPORT_WORDS.NextSteps).toBe("Suggested next steps");
    expect(ENGLISH_REPORT_WORDS.Users).toBe(
      IMPACT_LINE_LABELS[InvestigationImpactAspect.Users],
    );
    expect(ENGLISH_REPORT_WORDS.Services).toBe(
      IMPACT_LINE_LABELS[InvestigationImpactAspect.Services],
    );
    expect(ENGLISH_REPORT_WORDS.Slos).toBe(
      IMPACT_LINE_LABELS[InvestigationImpactAspect.Slos],
    );
    expect(ENGLISH.otherWords).toEqual({});
  });

  test("the headings and the labels are every term, once, in the persona's order", () => {
    expect([
      ...INVESTIGATION_REPORT_HEADING_TERMS,
      ...INVESTIGATION_REPORT_IMPACT_LABEL_TERMS,
    ]).toEqual(Object.values(InvestigationReportTerm));
  });

  test("every word is a short label of letters: nothing a table, emphasis or a colon would split", () => {
    for (const language of INVESTIGATION_REPORT_LANGUAGES) {
      for (const term of Object.values(InvestigationReportTerm)) {
        for (const word of wordsFor(language, term)) {
          const where: string = `${language.code} ${term} "${word}"`;

          expect({ where, trimmed: word.trim() }).toEqual({
            where,
            trimmed: word,
          });
          expect({ where, length: word.length <= 60 }).toEqual({
            where,
            length: true,
          });
          expect({ where, letterFirst: LETTER_FIRST_REGEX.test(word) }).toEqual(
            {
              where,
              letterFirst: true,
            },
          );
          expect({
            where,
            plain: LABEL_SPLITTING_CHARACTER_REGEX.test(word),
          }).toEqual({ where, plain: false });
          expect({
            where,
            hasKey: getInvestigationReportWordKey(word) !== "",
          }).toEqual({ where, hasKey: true });
        }
      }
    }
  });

  test("no word means two things, in any two languages", () => {
    const termsByKey: Map<string, Set<string>> = new Map();

    for (const language of INVESTIGATION_REPORT_LANGUAGES) {
      for (const term of Object.values(InvestigationReportTerm)) {
        for (const word of wordsFor(language, term)) {
          const key: string = getInvestigationReportWordKey(word);
          const terms: Set<string> = termsByKey.get(key) || new Set<string>();

          terms.add(term);
          termsByKey.set(key, terms);
        }
      }
    }

    const ambiguous: Array<string> = [...termsByKey.entries()]
      .filter((entry: [string, Set<string>]): boolean => {
        return entry[1].size > 1;
      })
      .map((entry: [string, Set<string>]): string => {
        return `${entry[0]}: ${[...entry[1]].join(", ")}`;
      });

    expect(ambiguous).toEqual([]);
  });

  test("a language's words for its terms are its own: no two terms share one", () => {
    for (const language of INVESTIGATION_REPORT_LANGUAGES) {
      const keys: Array<string> = Object.values(InvestigationReportTerm).map(
        (term: InvestigationReportTerm): string => {
          return getInvestigationReportWordKey(language.words[term]);
        },
      );

      expect({ code: language.code, distinct: new Set(keys).size }).toEqual({
        code: language.code,
        distinct: keys.length,
      });
    }
  });

  test("the words of the languages other than English, each once", () => {
    const summaries: Array<string> = getTranslatedReportWords(
      InvestigationReportTerm.Summary,
    );

    expect(summaries).toContain("摘要");
    expect(summaries).toContain("Zusammenfassung");
    expect(summaries).toContain("Résumé");
    expect(summaries).toContain("الملخص");
    expect(summaries).not.toContain("Summary");
    expect(new Set(summaries).size).toBe(summaries.length);
    expect(getInvestigationReportLanguage("zh-CN")!.words.Summary).toBe("摘要");
    expect(getInvestigationReportLanguage("xx")).toBeUndefined();
  });
});

describe("a word is read the ways a model writes it", () => {
  test.each([
    ["摘要", InvestigationReportTerm.Summary],
    ["Zusammenfassung", InvestigationReportTerm.Summary],
    ["ZUSAMMENFASSUNG", InvestigationReportTerm.Summary],
    ["zusammenfassung", InvestigationReportTerm.Summary],
    ["RÉSUMÉ", InvestigationReportTerm.Summary],
    // Russian "ё" written as "е".
    ["Исключенные причины", InvestigationReportTerm.RuledOut],
    ["Исключённые причины", InvestigationReportTerm.RuledOut],
    // Persian writes a joiner inside a word; a model may write a space or nothing.
    ["محتمل‌ترین علت ریشه‌ای", InvestigationReportTerm.RootCause],
    ["محتمل ترین علت ریشه ای", InvestigationReportTerm.RootCause],
    ["محتملترین علت ریشهای", InvestigationReportTerm.RootCause],
    // The Arabic and the Persian yeh and kaf are one letter here.
    ["كاربران", InvestigationReportTerm.Users],
    ["تأثير", InvestigationReportTerm.Impact],
    // Arabic with or without its vowel marks, a hamza or a stretch.
    ["السبب الجذري الأكثر احتمالًا", InvestigationReportTerm.RootCause],
    ["السبب الجذري الاكثر احتمالا", InvestigationReportTerm.RootCause],
    ["الملخّص", InvestigationReportTerm.Summary],
    ["الملـخص", InvestigationReportTerm.Summary],
    ["التاثير", InvestigationReportTerm.Impact],
    // Full-width letters are the plain ones.
    ["ＳＬＯｓ", InvestigationReportTerm.Slos],
    // Korean spaces its words as a writer likes.
    ["근본원인", InvestigationReportTerm.RootCause],
    ["가장 가능성 높은 근본원인", InvestigationReportTerm.RootCause],
    ["サービス", InvestigationReportTerm.Services],
    ["सेवाएँ", InvestigationReportTerm.Services],
    ["用户", InvestigationReportTerm.Users],
    ["使用者", InvestigationReportTerm.Users],
  ])("%s is the %s", (word: string, term: InvestigationReportTerm) => {
    expect(readTranslatedReportTerm(word)).toBe(term);
  });

  test("text that is no word of the table is none", () => {
    expect(readTranslatedReportTerm("结账服务因连接池耗尽而失败")).toBeNull();
    expect(readTranslatedReportTerm("诊断")).toBeNull();
    expect(readTranslatedReportTerm("")).toBeNull();
    expect(readTranslatedReportTerm("   ")).toBeNull();
    expect(readTranslatedReportTerm("摘要".repeat(101))).toBeNull();
    // A Map, not an object: no word reads as one of its members.
    expect(readTranslatedReportTerm("constructor")).toBeNull();
    expect(readTranslatedReportTerm("__proto__")).toBeNull();
    expect(readTranslatedReportTerm("toString")).toBeNull();
    // English is read by the parser's own tables, as it always was.
    expect(readTranslatedReportTerm("Summary")).toBeNull();
    expect(readTranslatedReportTerm("Most likely root cause")).toBeNull();
    expect(readTranslatedReportTerm(undefined as unknown as string)).toBeNull();
  });
});

describe("a report in another language is laid out as the English one is", () => {
  test("the English report is the one the persona asks for", () => {
    expect(ENGLISH_REPORT.isStructured).toBe(true);
    expect(kindsOf(ENGLISH_REPORT)).toEqual(ENGLISH_KINDS);
    expect(aspectsOf(ENGLISH_REPORT)).toEqual(IMPACT_LINE_ASPECTS);
    expect(causesOf(ENGLISH_REPORT)).toEqual([
      "A traffic spike",
      "The database",
    ]);
    expect(ENGLISH_REPORT.evidenceChecked).toHaveLength(3);
    expect(ENGLISH_REPORT.footer?.queryCount).toBe(3);
  });

  test.each(
    OTHER_LANGUAGES.map((language: InvestigationReportLanguage): [string] => {
      return [language.code];
    }),
  )(
    "%s, with the words a run is told to write, either colon",
    (code: string) => {
      const language: InvestigationReportLanguage = languageOf(code);

      for (const colon of [":", "："]) {
        const report: ParsedInvestigationReport = parseInvestigationReport(
          reportIn(language, colon),
        );

        expect(report.isStructured).toBe(true);
        expect(kindsOf(report)).toEqual(ENGLISH_KINDS);
        expect(titlesOf(report)).toEqual([
          language.words.Summary,
          language.words.Impact,
          `${language.words.RootCause} (medium confidence)`,
          language.words.Evidence,
          language.words.RuledOut,
          language.words.NextSteps,
        ]);
        expect(report.summary).toBe(ENGLISH_REPORT.summary);
        expect(report.rootCause).toBe(ENGLISH_REPORT.rootCause);
        expect(report.evidence).toBe(ENGLISH_REPORT.evidence);
        expect(report.nextSteps).toBe(ENGLISH_REPORT.nextSteps);
        expect(aspectsOf(report)).toEqual(IMPACT_LINE_ASPECTS);
        expect(
          parseImpactLines(report.impact).map(
            (line: InvestigationImpactLine): string => {
              return line.labelMarkdown;
            },
          ),
        ).toEqual([
          language.words.Users,
          language.words.Services,
          language.words.Slos,
        ]);
        expect(causesOf(report)).toEqual(causesOf(ENGLISH_REPORT));
        // What the server writes stays English, and is read as it was.
        expect(report.evidenceChecked).toEqual(ENGLISH_REPORT.evidenceChecked);
        expect(report.footer).toEqual(ENGLISH_REPORT.footer);
      }
    },
  );

  test("every word of every language opens its section, however the heading is written", () => {
    let read: number = 0;

    for (const language of OTHER_LANGUAGES) {
      for (const term of INVESTIGATION_REPORT_HEADING_TERMS) {
        for (const word of wordsFor(language, term)) {
          const shapes: Array<string> = [
            `**${word}**\nThe body.`,
            `**${word}:**\nThe body.`,
            `**${word}：**\nThe body.`,
            `**${word}**：The body.`,
            `**${word}** — The body.`,
            `__${word}__\nThe body.`,
            `## ${word}\nThe body.`,
            `### ${word}：\nThe body.`,
            `${word}: The body.`,
            `${word}：The body.`,
          ];

          for (const shape of shapes) {
            const sections: Array<InvestigationReportSection> =
              parseInvestigationReport(shape).sections;
            const where: string = `${language.code} ${term}: ${shape}`;

            expect({
              where,
              sections: sections.map(
                (
                  section: InvestigationReportSection,
                ): [InvestigationReportSectionKind, string, string] => {
                  return [section.kind, section.title, section.markdown];
                },
              ),
            }).toEqual({
              where,
              sections: [[HEADING_KINDS[term], word, "The body."]],
            });
            read++;
          }
        }
      }
    }

    expect(read).toBeGreaterThan(1000);
  });

  test("every Impact label of every language names its aspect, with either colon", () => {
    for (const language of OTHER_LANGUAGES) {
      for (const term of INVESTIGATION_REPORT_IMPACT_LABEL_TERMS) {
        for (const word of wordsFor(language, term)) {
          const where: string = `${language.code} ${term} "${word}"`;

          expect({ where, aspect: getImpactAspect(word) }).toEqual({
            where,
            aspect: IMPACT_ASPECTS[term],
          });

          for (const line of [
            `- **${word}:** 30 [C1].`,
            `- **${word}：** 30 [C1].`,
            `- **${word}**: 30 [C1].`,
            `- **${word}**：30 [C1].`,
          ]) {
            expect({ where, line, read: parseImpactLines(line) }).toEqual({
              where,
              line,
              read: [
                {
                  aspect: IMPACT_ASPECTS[term],
                  labelMarkdown: word,
                  textMarkdown: "30 [C1].",
                },
              ],
            });
          }
        }
      }
    }
  });

  test("an Impact label's word is no heading: on its own line it is a section of its own name", () => {
    expect(
      kindsOf(
        parseInvestigationReport(
          "**摘要**\n结账失败。\n\n**用户**\n约 30 人。",
        ),
      ),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Other,
    ]);
  });
});

describe("whole reports, as a model writes them", () => {
  const CHINESE: string = [
    BRAND_HEADING,
    "",
    "**摘要**",
    "结账服务因 payments-db 连接池耗尽而失败 [C1]。",
    "",
    "**影响**",
    "- **用户：** 自 14:02 起约 1,240 个失败的结账请求，按带错误的根 span 统计 [C2]。",
    "- **服务：** checkout-api，以及调用它的 cart-api。",
    "- **SLOs：** 结账可用性处于风险中，剩余 38% 的错误预算 [C1]。",
    "",
    "**最可能的根本原因**（中等置信度）",
    "版本 2026.09.14-2 将 `DB_POOL_MAX` 设为 10 [C1]。",
    "",
    "**证据**",
    "- 连接池等待从 0 升至 1,900 [C1]",
    "- **注意：** 重启后连接池上限仍为 10 [C3]。",
    "",
    "**已排除的原因**",
    "- **流量激增：** 结账请求量保持平稳 [C2]。",
    "- **数据库故障：** payments-db 的 CPU 低于 20% [C3]。",
    "",
    "**建议的后续步骤**",
    "1. 回滚 checkout-api。",
    "2. 将 `DB_POOL_MAX` 恢复为 50。",
    "",
    EVIDENCE_CHECKED,
    "",
    FOOTER,
  ].join("\n");

  // The same report, in English: what the Chinese one must be laid out as.
  const CHINESE_IN_ENGLISH: string = [
    BRAND_HEADING,
    "",
    "**Summary**",
    "Checkout fails because the payments-db connection pool is exhausted [C1].",
    "",
    "**Impact**",
    "- **Users:** about 1,240 failed checkout requests since 14:02, counted as root spans with errors [C2].",
    "- **Services:** checkout-api, and cart-api, which calls it.",
    "- **SLOs:** Checkout availability is At Risk, 38% of its error budget left [C1].",
    "",
    "**Most likely root cause** (medium confidence)",
    "Release 2026.09.14-2 set `DB_POOL_MAX` to 10 [C1].",
    "",
    "**Evidence**",
    "- pool waits rose from 0 to 1,900 [C1]",
    "- **Note:** the pool still holds 10 after the restart [C3].",
    "",
    "**Ruled out**",
    "- **A traffic spike:** checkout requests were flat [C2].",
    "- **A database fault:** payments-db CPU stayed under 20% [C3].",
    "",
    "**Suggested next steps**",
    "1. Roll checkout-api back.",
    "2. Set `DB_POOL_MAX` back to 50.",
    "",
    EVIDENCE_CHECKED,
    "",
    FOOTER,
  ].join("\n");

  test("Chinese (issue #6542): every section, every Impact line and every cause, as in English", () => {
    const chinese: ParsedInvestigationReport =
      parseInvestigationReport(CHINESE);
    const english: ParsedInvestigationReport =
      parseInvestigationReport(CHINESE_IN_ENGLISH);

    expect(chinese.isStructured).toBe(true);
    expect(kindsOf(chinese)).toEqual(kindsOf(english));
    expect(kindsOf(chinese)).toEqual(ENGLISH_KINDS);
    expect(titlesOf(chinese)).toEqual([
      "摘要",
      "影响",
      // A full-width bracket keeps to its word.
      "最可能的根本原因（中等置信度）",
      "证据",
      "已排除的原因",
      "建议的后续步骤",
    ]);
    expect(chinese.summary).toBe(
      "结账服务因 payments-db 连接池耗尽而失败 [C1]。",
    );
    expect(chinese.rootCause).toBe(
      "版本 2026.09.14-2 将 `DB_POOL_MAX` 设为 10 [C1]。",
    );
    // A bold label inside a section is part of it, as in English.
    expect(chinese.evidence).toContain("**注意：** 重启后连接池上限仍为 10");
    expect(parseImpactLines(chinese.impact)).toEqual([
      {
        aspect: InvestigationImpactAspect.Users,
        labelMarkdown: "用户",
        textMarkdown:
          "自 14:02 起约 1,240 个失败的结账请求，按带错误的根 span 统计 [C2]。",
      },
      {
        aspect: InvestigationImpactAspect.Services,
        labelMarkdown: "服务",
        textMarkdown: "checkout-api，以及调用它的 cart-api。",
      },
      {
        aspect: InvestigationImpactAspect.Slos,
        labelMarkdown: "SLOs",
        textMarkdown: "结账可用性处于风险中，剩余 38% 的错误预算 [C1]。",
      },
    ]);
    expect(aspectsOf(chinese)).toEqual(aspectsOf(english));
    expect(parseRuledOutCauses(chinese.ruledOut)).toEqual([
      {
        causeMarkdown: "流量激增",
        reasonMarkdown: "结账请求量保持平稳 [C2]。",
      },
      {
        causeMarkdown: "数据库故障",
        reasonMarkdown: "payments-db 的 CPU 低于 20% [C3]。",
      },
    ]);
    expect(causesOf(chinese)).toHaveLength(causesOf(english).length);
    expect(chinese.evidenceChecked).toEqual(english.evidenceChecked);
    expect(chinese.footer).toEqual(english.footer);
    expect(chinese.preamble).toBe("");
  });

  test("the Chinese Summary however it is written: a heading, bold, with either colon, or plain", () => {
    for (const opening of [
      "## 摘要\n结账服务失败。",
      "**摘要**\n结账服务失败。",
      "**摘要：**\n结账服务失败。",
      "**摘要**：\n结账服务失败。",
      "**摘要：** 结账服务失败。",
      "**摘要**：结账服务失败。",
      "摘要：结账服务失败。",
      "## 摘要：结账服务失败。",
      "# 摘要 #\n结账服务失败。",
    ]) {
      const report: ParsedInvestigationReport = parseInvestigationReport(
        `${opening}\n\n**最可能的根本原因**\n连接池被调小 [C1]。`,
      );

      expect({ opening, kinds: kindsOf(report) }).toEqual({
        opening,
        kinds: [
          InvestigationReportSectionKind.Summary,
          InvestigationReportSectionKind.RootCause,
        ],
      });
      expect({ opening, summary: report.summary }).toEqual({
        opening,
        summary: "结账服务失败。",
      });
      expect({ opening, title: report.sections[0]!.title }).toEqual({
        opening,
        title: "摘要",
      });
    }
  });

  test("Chinese prose with a colon or in bold is no heading", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**摘要**",
        "结账服务：仍然失败。",
        "**连接池**很小。",
        "",
        "**最可能的根本原因**",
        "连接池被调小 [C1]。",
      ].join("\n"),
    );

    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
    ]);
    expect(report.summary).toBe("结账服务：仍然失败。\n**连接池**很小。");
  });

  test("a heading the table does not know keeps its own name, as an English one does", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      "**摘要**\n结账失败。\n\n**诊断**\n连接池被调小。",
    );

    expect(kindsOf(report)).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.Other,
    ]);
    expect(titlesOf(report)).toEqual(["摘要", "诊断"]);
  });

  test("German, with Markdown headings and a qualifier after the root cause", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      [
        BRAND_HEADING,
        "",
        "## Zusammenfassung",
        "Der Checkout schlägt fehl, weil der Verbindungspool von payments-db erschöpft ist [C1].",
        "",
        "## Auswirkungen",
        "- **Benutzer:** etwa 1.240 fehlgeschlagene Checkout-Anfragen seit 14:02 [C2].",
        "- **Dienste:** checkout-api und cart-api, das es aufruft.",
        "- **SLOs:** Die Checkout-Verfügbarkeit ist gefährdet, 38 % des Fehlerbudgets übrig [C1].",
        "",
        "## Wahrscheinlichste Grundursache (mittlere Sicherheit)",
        "Release 2026.09.14-2 setzte `DB_POOL_MAX` auf 10 [C1].",
        "",
        "## Belege",
        "- Die Wartezeiten im Pool stiegen von 0 auf 1.900 [C1]",
        "",
        "## Ausgeschlossene Ursachen",
        "- **Eine Lastspitze:** Die Checkout-Anfragen blieben gleich [C2].",
        "",
        "## Vorgeschlagene nächste Schritte",
        "1. checkout-api zurückrollen.",
        "",
        EVIDENCE_CHECKED,
        "",
        FOOTER,
      ].join("\n"),
    );

    expect(kindsOf(report)).toEqual(ENGLISH_KINDS);
    expect(titlesOf(report)[2]).toBe(
      "Wahrscheinlichste Grundursache (mittlere Sicherheit)",
    );
    expect(aspectsOf(report)).toEqual(IMPACT_LINE_ASPECTS);
    expect(causesOf(report)).toEqual(["Eine Lastspitze"]);
    expect(report.evidenceChecked).toHaveLength(3);
  });

  test("Arabic and Persian, written right to left, with their own marks and joiners", () => {
    const arabic: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**الملخص**",
        "فشلت خدمة الدفع لأن مجمع اتصالات payments-db استُنفد [C1].",
        "",
        "**التأثير**",
        "- **المستخدمون:** نحو 1,240 طلب دفع فاشل منذ 14:02 [C2].",
        "- **الخدمات:** checkout-api و cart-api التي تستدعيها.",
        "- **أهداف SLO:** توفر الدفع معرض للخطر [C1].",
        "",
        "**السبب الجذري الأكثر احتمالًا** (ثقة متوسطة)",
        "ضبط الإصدار 2026.09.14-2 قيمة `DB_POOL_MAX` على 10 [C1].",
        "",
        "**الأدلة**",
        "- ارتفع انتظار المجمع من 0 إلى 1,900 [C1]",
        "",
        "**الأسباب المستبعدة**",
        "- **ارتفاع مفاجئ في الحركة:** ظل عدد طلبات الدفع ثابتًا [C2].",
        "",
        "**الخطوات التالية المقترحة**",
        "1. أرجع checkout-api إلى الإصدار السابق.",
      ].join("\n"),
    );
    // Persian, with spaces where the table writes a joiner.
    const persian: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**خلاصه**",
        "سرویس پرداخت به خاطر پر شدن استخر اتصال payments-db از کار افتاد [C1].",
        "",
        "**تأثیر**",
        "- **کاربران:** حدود ۱٬۲۴۰ درخواست ناموفق از ساعت ۱۴:۰۲ [C2].",
        "- **سرویس ها:** checkout-api و cart-api.",
        "- **SLOs:** دسترس پذیری پرداخت در خطر است [C1].",
        "",
        "**محتمل ترین علت ریشه ای** (اطمینان متوسط)",
        "انتشار 2026.09.14-2 مقدار `DB_POOL_MAX` را ۱۰ کرد [C1].",
        "",
        "**شواهد**",
        "- انتظار استخر از ۰ به ۱٬۹۰۰ رسید [C1]",
        "",
        "**علت‌های ردشده**",
        "- **افزایش ترافیک:** تعداد درخواست‌ها ثابت ماند [C2].",
        "",
        "**گام‌های بعدی پیشنهادی**",
        "1. checkout-api را به نسخه قبلی برگردانید.",
      ].join("\n"),
    );

    for (const report of [arabic, persian]) {
      expect(kindsOf(report)).toEqual(ENGLISH_KINDS);
      expect(aspectsOf(report)).toEqual(IMPACT_LINE_ASPECTS);
      expect(causesOf(report)).toHaveLength(1);
    }

    expect(titlesOf(arabic)[2]).toBe(
      "السبب الجذري الأكثر احتمالًا (ثقة متوسطة)",
    );
    expect(persian.summary).toBe(
      "سرویس پرداخت به خاطر پر شدن استخر اتصال payments-db از کار افتاد [C1].",
    );
  });

  test("Japanese, with the full-width colon inside the confidence too", () => {
    const report: ParsedInvestigationReport = parseInvestigationReport(
      [
        "**概要**",
        "決済サービスは payments-db の接続プール枯渇により失敗しています [C1]。",
        "",
        "**影響**",
        "- **ユーザー：** 14:02 以降、約 1,240 件の決済リクエストが失敗 [C2]。",
        "- **サービス：** checkout-api と、それを呼び出す cart-api。",
        "- **SLO：** 決済の可用性が危険な状態、エラーバジェット残り 38% [C1]。",
        "",
        "**最も可能性の高い根本原因**（確度：中）",
        "リリース 2026.09.14-2 で `DB_POOL_MAX` が 10 に設定された [C1]。",
        "",
        "**証拠**",
        "- プール待機が 0 から 1,900 に増加 [C1]",
        "",
        "**除外した原因**",
        "- **トラフィックの急増：** 決済リクエスト数は横ばい [C2]。",
        "",
        "**推奨される次のステップ**",
        "1. checkout-api をロールバックする。",
      ].join("\n"),
    );

    expect(kindsOf(report)).toEqual(ENGLISH_KINDS);
    expect(titlesOf(report)[2]).toBe("最も可能性の高い根本原因（確度：中）");
    expect(report.rootCause).toBe(
      "リリース 2026.09.14-2 で `DB_POOL_MAX` が 10 に設定された [C1]。",
    );
    expect(aspectsOf(report)).toEqual(IMPACT_LINE_ASPECTS);
    expect(causesOf(report)).toEqual(["トラフィックの急増"]);
  });

  test("a report in a mix of languages reads each heading in its own", () => {
    const random: SeededRandom = seededRandom(6542);

    for (let run: number = 0; run < 500; run++) {
      const lines: Array<string> = [];

      for (const term of INVESTIGATION_REPORT_HEADING_TERMS) {
        const language: InvestigationReportLanguage =
          INVESTIGATION_REPORT_LANGUAGES[
            random(INVESTIGATION_REPORT_LANGUAGES.length)
          ]!;
        const words: Array<string> = wordsFor(language, term);

        lines.push(`**${words[random(words.length)]!}**`, `${term} body.`, "");
      }

      const report: ParsedInvestigationReport = parseInvestigationReport(
        lines.join("\n"),
      );

      expect(kindsOf(report)).toEqual(ENGLISH_KINDS);
      expect(
        report.sections.map((section: InvestigationReportSection): string => {
          return section.markdown;
        }),
      ).toEqual(
        INVESTIGATION_REPORT_HEADING_TERMS.map(
          (term: InvestigationReportTerm): string => {
            return `${term} body.`;
          },
        ),
      );
    }
  });
});

describe("a report in another language is read in time in line with its length", () => {
  const LENGTH: number = 400000;

  const repeat: (unit: string, length: number) => string = (
    unit: string,
    length: number,
  ): string => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  const WORST_CASES: Array<[string, string]> = [
    ["a plain label with a long body", `摘要：${repeat("摘", LENGTH)}`],
    ["a run of full-width colons", `摘要${repeat("：", LENGTH)}`],
    ["a bold label of colons", `**${repeat("摘要：", LENGTH)}**`],
    ["an unclosed full-width qualifier", `**摘要**（${repeat("中", LENGTH)}`],
    ["a run of full-width brackets", `**摘要**${repeat("（", LENGTH)}）`],
    ["a heading of joiners", `## ${repeat("ـ‌", LENGTH)}`],
    ["a line of every label", repeat("**影响**：", LENGTH)],
    ["many short sections", repeat("**摘要**\n结账失败。\n", LENGTH)],
    [
      "an Impact line of colons",
      `**影响**\n- **用户：** ${repeat("：", LENGTH)}`,
    ],
  ];

  test.each(WORST_CASES)("%s", (_label: string, text: string) => {
    const timed: FastestRun<ParsedInvestigationReport> = fastestRun({
      run: (): ParsedInvestigationReport => {
        const report: ParsedInvestigationReport =
          parseInvestigationReport(text);

        parseImpactLines(report.impact);
        parseRuledOutCauses(report.ruledOut);

        return report;
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
