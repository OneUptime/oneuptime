import {
  REPORT_LANGUAGE_INSTRUCTIONS,
  getPersonaReportTerms,
  getReportLanguageInstructions,
} from "../../../../Server/Utils/AI/SRE/InvestigationReportLanguagePrompt";
import { INVESTIGATION_PERSONA } from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { SECURITY_CASE_TRIAGE_PERSONA } from "../../../../Server/Utils/AI/Security/SecurityCaseTriagePrompt";
import {
  SecurityCaseTriageDecision,
  readSecurityCaseTriageDecision,
} from "../../../../Server/Utils/AI/Security/SecurityCaseTriageDecision";
import {
  ENGLISH_REPORT_LANGUAGE_CODE,
  ENGLISH_REPORT_WORDS,
  INVESTIGATION_REPORT_LANGUAGES,
  InvestigationReportLanguage,
  InvestigationReportTerm,
} from "../../../../Utils/AI/InvestigationReportLanguages";
import {
  InvestigationImpactAspect,
  InvestigationImpactLine,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  parseImpactLines,
  parseInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../../../Types/Dashboard/DashboardLanguage";
import SecurityCaseAiVerdict from "../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A RUN THAT READ AN AI CONTEXT IS TOLD ABOUT THE LANGUAGE IT WRITES
 * IN (issue #6542).
 *
 * The notes may ask for a language ("用中文回复"). The AI card lays a
 * report out by its headings, so a run that read notes is given, after its
 * persona, each language's words for the headings and labels that persona
 * asks for - the words the report parser reads - and told what stays as it
 * is in any language. A persona's own headings only; nothing for a persona
 * that asks for none. Whatever the table tells a model to write, the
 * parser reads as the heading it stands for.
 */

const OTHER_LANGUAGES: Array<InvestigationReportLanguage> =
  INVESTIGATION_REPORT_LANGUAGES.filter(
    (language: InvestigationReportLanguage): boolean => {
      return language.code !== ENGLISH_REPORT_LANGUAGE_CODE;
    },
  );

// A fix's persona, as the remediation runners write theirs.
const REMEDIATION_PERSONA: string = `You are OneUptime AI, and this is a REMEDIATION run.

Write your final answer with these sections, in this order (use these markdown headings):
**Summary** — one or two sentences: what was wrong and what you did.
**Diagnosis** — what you found, each factual claim cited [C#].
**Actions taken** — every command you executed, in order, with its outcome.
**Recommendations** — anything a human should still do.`;

// The table's rows: each a list of its cells.
function tableOf(instructions: string): Array<Array<string>> {
  return instructions
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| ");
    })
    .map((line: string): Array<string> => {
      return line.slice(2, -2).split(" | ");
    });
}

describe("the terms a persona asks for", () => {
  test("the investigation's: every heading and every Impact label, in the table's order", () => {
    expect(getPersonaReportTerms(INVESTIGATION_PERSONA)).toEqual([
      InvestigationReportTerm.Summary,
      InvestigationReportTerm.Impact,
      InvestigationReportTerm.RootCause,
      InvestigationReportTerm.Evidence,
      InvestigationReportTerm.RuledOut,
      InvestigationReportTerm.NextSteps,
      InvestigationReportTerm.Users,
      InvestigationReportTerm.Services,
      InvestigationReportTerm.Slos,
    ]);
  });

  test("a security case's triage: its Summary, Evidence and Suggested next steps", () => {
    expect(getPersonaReportTerms(SECURITY_CASE_TRIAGE_PERSONA)).toEqual([
      InvestigationReportTerm.Summary,
      InvestigationReportTerm.Evidence,
      InvestigationReportTerm.NextSteps,
    ]);
  });

  test("a fix's: its Summary only", () => {
    expect(getPersonaReportTerms(REMEDIATION_PERSONA)).toEqual([
      InvestigationReportTerm.Summary,
    ]);
  });

  test("a word in prose, not in bold, asks for nothing", () => {
    expect(
      getPersonaReportTerms(
        "Write a summary, then the evidence, then the impact on users.",
      ),
    ).toEqual([]);
  });
});

describe("what a run that read an AI context is told", () => {
  const instructions: string = getReportLanguageInstructions(
    INVESTIGATION_PERSONA,
  );
  const table: Array<Array<string>> = tableOf(instructions);

  test("the instructions, a blank line, then the table", () => {
    expect(
      instructions.startsWith(`${REPORT_LANGUAGE_INSTRUCTIONS}\n\n| `),
    ).toBe(true);
  });

  test("write in the language the notes ask for, headings included; else in English", () => {
    expect(REPORT_LANGUAGE_INSTRUCTIONS).toContain(
      "If they do, write your whole answer in that language",
    );
    expect(REPORT_LANGUAGE_INSTRUCTIONS).toContain(
      "exactly as that language's row gives it",
    );
    expect(REPORT_LANGUAGE_INSTRUCTIONS).toContain(
      "If they do not, write in English.",
    );
  });

  test("what stays as it is in any language: what people and OneUptime read exactly", () => {
    for (const kept of [
      "code, commands, queries, identifiers, metric and service names",
      "citation markers like [C1]",
      "quoted data",
      // The card links "incident #12" and "alert #3" by their English word.
      'written "incident #12" or "alert #3"',
      "every line, key, value or block the instructions above require in a fixed form",
    ]) {
      expect(REPORT_LANGUAGE_INSTRUCTIONS).toContain(kept);
    }
  });

  test("a header of the persona's English words, then a row a language, in the Dashboard's order", () => {
    expect(table[0]).toEqual([
      "Language",
      "Summary",
      "Impact",
      "Most likely root cause",
      "Evidence",
      "Ruled out",
      "Suggested next steps",
      "Users",
      "Services",
      "SLOs",
    ]);
    expect(table[1]).toEqual(new Array(10).fill("---"));
    expect(table.slice(2)).toHaveLength(OTHER_LANGUAGES.length);

    OTHER_LANGUAGES.forEach(
      (language: InvestigationReportLanguage, index: number): void => {
        const dashboardLanguage: DashboardLanguage =
          SUPPORTED_DASHBOARD_LANGUAGES.find(
            (candidate: DashboardLanguage): boolean => {
              return candidate.code === language.code;
            },
          )!;

        expect(table[index + 2]).toEqual([
          `${dashboardLanguage.englishName}, ${dashboardLanguage.nativeName}`,
          ...getPersonaReportTerms(INVESTIGATION_PERSONA).map(
            (term: InvestigationReportTerm): string => {
              return language.words[term];
            },
          ),
        ]);
      },
    );
  });

  test("the row a Chinese team's run writes from", () => {
    expect(instructions).toContain(
      "| Chinese (Simplified), 简体中文 | 摘要 | 影响 | 最可能的根本原因 | 证据 | 已排除的原因 | 建议的后续步骤 | 用户 | 服务 | SLOs |",
    );
  });

  test("no English row: English is the persona itself", () => {
    expect(
      table.some((row: Array<string>): boolean => {
        return row[0]!.startsWith("English");
      }),
    ).toBe(false);
  });

  test("a triage's table names its own headings only", () => {
    expect(
      tableOf(getReportLanguageInstructions(SECURITY_CASE_TRIAGE_PERSONA))[0],
    ).toEqual(["Language", "Summary", "Evidence", "Suggested next steps"]);
  });

  test("nothing for a persona that asks for none of the table's words", () => {
    expect(
      getReportLanguageInstructions(
        "You are OneUptime AI's remediation agent.",
      ),
    ).toBe("");
    expect(getReportLanguageInstructions("")).toBe("");
  });

  test("the same persona, the same words: the prompt stays inside the provider's cache", () => {
    expect(getReportLanguageInstructions(INVESTIGATION_PERSONA)).toBe(
      instructions,
    );
  });
});

describe("what the table tells a model to write is what the card reads", () => {
  const table: Array<Array<string>> = tableOf(
    getReportLanguageInstructions(INVESTIGATION_PERSONA),
  );
  const terms: Array<InvestigationReportTerm> = getPersonaReportTerms(
    INVESTIGATION_PERSONA,
  );

  function cell(row: Array<string>, term: InvestigationReportTerm): string {
    return row[terms.indexOf(term) + 1]!;
  }

  test.each(
    OTHER_LANGUAGES.map(
      (
        language: InvestigationReportLanguage,
        index: number,
      ): [string, number] => {
        return [language.code, index];
      },
    ),
  )(
    "%s: a report written with its row is laid out as an English one",
    (_code: string, index: number) => {
      const row: Array<string> = table[index + 2]!;
      const report: ParsedInvestigationReport = parseInvestigationReport(
        [
          `**${cell(row, InvestigationReportTerm.Summary)}**`,
          "S [C1].",
          "",
          `**${cell(row, InvestigationReportTerm.Impact)}**`,
          `- **${cell(row, InvestigationReportTerm.Users)}:** 30 [C2].`,
          `- **${cell(row, InvestigationReportTerm.Services)}：** checkout-api.`,
          `- **${cell(row, InvestigationReportTerm.Slos)}:** 1 [C1].`,
          "",
          `**${cell(row, InvestigationReportTerm.RootCause)}**`,
          "R [C1].",
          "",
          `**${cell(row, InvestigationReportTerm.Evidence)}**`,
          "- E [C1]",
          "",
          `**${cell(row, InvestigationReportTerm.RuledOut)}**`,
          "- **X:** Y [C2].",
          "",
          `**${cell(row, InvestigationReportTerm.NextSteps)}**`,
          "1. N.",
        ].join("\n"),
      );

      expect(
        report.sections.map(
          (
            section: InvestigationReportSection,
          ): InvestigationReportSectionKind => {
            return section.kind;
          },
        ),
      ).toEqual([
        InvestigationReportSectionKind.Summary,
        InvestigationReportSectionKind.Impact,
        InvestigationReportSectionKind.RootCause,
        InvestigationReportSectionKind.Evidence,
        InvestigationReportSectionKind.RuledOut,
        InvestigationReportSectionKind.NextSteps,
      ]);
      expect(
        parseImpactLines(report.impact).map(
          (line: InvestigationImpactLine): InvestigationImpactAspect | null => {
            return line.aspect;
          },
        ),
      ).toEqual([
        InvestigationImpactAspect.Users,
        InvestigationImpactAspect.Services,
        InvestigationImpactAspect.Slos,
      ]);
    },
  );

  test("the header's words are the persona's own, in bold", () => {
    for (const term of terms) {
      const word: string = ENGLISH_REPORT_WORDS[term];

      expect(INVESTIGATION_PERSONA).toContain(
        term === InvestigationReportTerm.Users ||
          term === InvestigationReportTerm.Services ||
          term === InvestigationReportTerm.Slos
          ? `**${word}:**`
          : `**${word}**`,
      );
    }
  });
});

describe("a triage written in Chinese keeps the lines the server reads", () => {
  test("its Summary is read as the Summary, and its closing lines as the decision", () => {
    const answer: string = [
      "**摘要**",
      "deploy 用户在四分钟内 32 次 SSH 登录失败后成功登录 web-1，很可能是暴力破解成功 [C1]。",
      "",
      "**评估**",
      "很可能是恶意的：203.0.113.9 在 Feodo 列表中 [C2]。",
      "",
      "**证据**",
      "- 32 次失败后 1 次成功 [C1]",
      "",
      "**建议的后续步骤**",
      "1. 对 web-1 运行 Contain Host 剧本。",
      "",
      "Verdict: malicious",
      "Priority: critical",
      "Playbook: none",
    ].join("\n");

    const report: ParsedInvestigationReport = parseInvestigationReport(answer);

    expect(report.summary).toBe(
      "deploy 用户在四分钟内 32 次 SSH 登录失败后成功登录 web-1，很可能是暴力破解成功 [C1]。",
    );
    expect(
      report.sections.map((section: InvestigationReportSection): string => {
        return section.title;
      }),
    ).toEqual(["摘要", "评估", "证据", "建议的后续步骤"]);

    const decision: SecurityCaseTriageDecision = readSecurityCaseTriageDecision(
      {
        analysisMarkdown: answer,
        offeredPlaybookIds: [],
        instructionLikeTextFound: false,
      },
    );

    expect(decision.verdict).toBe(SecurityCaseAiVerdict.LikelyMalicious);
    expect(decision.suggestedPriority).toBe(SecurityCasePriorityLevel.Critical);
    expect(decision.suggestedPlaybookId).toBeUndefined();
  });
});
