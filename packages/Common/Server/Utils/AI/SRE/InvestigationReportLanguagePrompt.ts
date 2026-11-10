import {
  ENGLISH_REPORT_LANGUAGE_CODE,
  ENGLISH_REPORT_WORDS,
  INVESTIGATION_REPORT_HEADING_TERMS,
  INVESTIGATION_REPORT_IMPACT_LABEL_TERMS,
  INVESTIGATION_REPORT_LANGUAGES,
  InvestigationReportLanguage,
  InvestigationReportTerm,
} from "../../../../Utils/AI/InvestigationReportLanguages";
import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../../../Types/Dashboard/DashboardLanguage";

/*
 * THE LANGUAGE AN AI RUN WRITES ITS REPORT IN (issue #6542).
 *
 * A team that reads OneUptime in Chinese writes "用中文回复" in its AI
 * context, and the framing the AI context opens the prompt with tells the
 * model to write in the language the notes ask for (AiContextPrompt). The
 * AI card lays a report out by its headings, so a run that read an AI
 * context is also given each language's words for the headings and labels
 * its persona asks for: the words the report parser reads
 * (InvestigationReportLanguages), so a Chinese report is laid out as an
 * English one is. Only a persona's own headings: a fix's persona asks for
 * other sections than an investigation's.
 *
 * A run that read no AI context is sent exactly what it always was (the
 * engine adds nothing), and English stays the language when the notes ask
 * for none.
 */

// What the table says, and what stays as it is in any language.
export const REPORT_LANGUAGE_INSTRUCTIONS: string =
  'The team\'s notes at the start of this prompt may ask you to write in a language other than English. If they do, write your whole answer in that language, and write each heading and label the table below names in English exactly as that language\'s row gives it; write any other heading in that language\'s own words. If they do not, write in English. In any language, keep these as they are: code, commands, queries, identifiers, metric and service names, citation markers like [C1], quoted data, an incident or an alert you name, written "incident #12" or "alert #3", and every line, key, value or block the instructions above require in a fixed form.';

/*
 * The terms a persona asks for, by the English words it spells them with:
 * a heading in bold ("**Summary**"), an Impact line's label in bold with
 * its colon ("**Users:**"). In the table's order.
 */
export function getPersonaReportTerms(
  persona: string,
): Array<InvestigationReportTerm> {
  const headings: Array<InvestigationReportTerm> =
    INVESTIGATION_REPORT_HEADING_TERMS.filter(
      (term: InvestigationReportTerm): boolean => {
        return persona.includes(`**${ENGLISH_REPORT_WORDS[term]}**`);
      },
    );
  const labels: Array<InvestigationReportTerm> =
    INVESTIGATION_REPORT_IMPACT_LABEL_TERMS.filter(
      (term: InvestigationReportTerm): boolean => {
        return persona.includes(`**${ENGLISH_REPORT_WORDS[term]}:**`);
      },
    );

  return [...headings, ...labels];
}

// A language as a row names it: "Chinese (Simplified), 简体中文".
function getLanguageName(code: string): string {
  const language: DashboardLanguage | undefined =
    SUPPORTED_DASHBOARD_LANGUAGES.find(
      (dashboardLanguage: DashboardLanguage): boolean => {
        return dashboardLanguage.code === code;
      },
    );

  return language ? `${language.englishName}, ${language.nativeName}` : code;
}

function tableRow(cells: Array<string>): string {
  return `| ${cells.join(" | ")} |`;
}

/*
 * What a run that read an AI context is told after its persona: the
 * instructions above, then a table of every language's words for the
 * persona's headings and labels, one row a language. "" for a persona
 * that asks for none of them.
 */
export function getReportLanguageInstructions(persona: string): string {
  const terms: Array<InvestigationReportTerm> = getPersonaReportTerms(persona);

  if (terms.length === 0) {
    return "";
  }

  const rows: Array<string> = INVESTIGATION_REPORT_LANGUAGES.filter(
    (language: InvestigationReportLanguage): boolean => {
      return language.code !== ENGLISH_REPORT_LANGUAGE_CODE;
    },
  ).map((language: InvestigationReportLanguage): string => {
    return tableRow([
      getLanguageName(language.code),
      ...terms.map((term: InvestigationReportTerm): string => {
        return language.words[term];
      }),
    ]);
  });

  return [
    REPORT_LANGUAGE_INSTRUCTIONS,
    "",
    tableRow([
      "Language",
      ...terms.map((term: InvestigationReportTerm): string => {
        return ENGLISH_REPORT_WORDS[term];
      }),
    ]),
    tableRow(
      ["Language", ...terms].map((): string => {
        return "---";
      }),
    ),
    ...rows,
  ].join("\n");
}
