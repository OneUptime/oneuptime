import {
  AIDocsLanguageIndex,
  tokenizeForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import {
  DocsIndexBuilder,
  DocsIndexPageInput,
  DocsIndexSectionInput,
} from "../../../FeatureSet/Docs/Utils/DocsIndex";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";

/*
 * A small docs index made by hand, laid out as AIDocsReader.build lays out
 * the real one - by the same DocsIndexBuilder - so docs search's ranking
 * can be checked against pages whose every word is known
 * (DocsSearch.test.ts).
 */

export interface MadeSection {
  title: string;
  text: string;
  anchor?: string | undefined;
  isOtherName?: boolean | undefined;
}

export interface MadePage {
  page: string;
  title: string;
  group?: string | undefined;
  summary?: string | undefined;
  isGuide?: boolean | undefined;
  sections?: Array<MadeSection> | undefined;
}

const counts: (text: string, language: string) => Map<string, number> = (
  text: string,
  language: string,
): Map<string, number> => {
  const found: Map<string, number> = new Map();
  for (const term of tokenizeForDocs(text, language)) {
    found.set(term, (found.get(term) || 0) + 1);
  }
  return found;
};

const terms: (text: string, language: string) => Set<string> = (
  text: string,
  language: string,
): Set<string> => {
  return new Set<string>(tokenizeForDocs(text, language));
};

const anchorOf: (title: string) => string = (title: string): string => {
  return slugifyMarkdownHeading(title);
};

// A page made by hand, as the index's builder is handed a page of the docs.
export const madePageInput: (
  made: MadePage,
  language: string,
) => DocsIndexPageInput = (
  made: MadePage,
  language: string,
): DocsIndexPageInput => {
  const madeSections: Array<MadeSection> = made.sections || [];
  const summary: string = made.summary || "";
  const body: string = [
    summary,
    ...madeSections
      .filter((section: MadeSection): boolean => {
        return !section.isOtherName;
      })
      .map((section: MadeSection): string => {
        return `${section.title}\n${section.text}`;
      }),
  ].join("\n");

  return {
    page: made.page,
    title: made.title,
    group: made.group || "Docs",
    summary,
    language,
    isGuide: made.isGuide === true,
    titleTerms: terms(made.title, language),
    groupTerms: terms(made.group || "Docs", language),
    summaryTerms: terms(summary, language),
    headingTerms: terms(
      madeSections
        .filter((section: MadeSection): boolean => {
          return !section.isOtherName;
        })
        .map((section: MadeSection): string => {
          return section.title;
        })
        .join(" "),
      language,
    ),
    bodyTerms: counts(body, language),
    bodyLength: tokenizeForDocs(body, language).length,
    sections: madeSections.map(
      (section: MadeSection): DocsIndexSectionInput => {
        return {
          title: section.title,
          anchor: section.anchor || anchorOf(section.title),
          terms: counts(
            section.isOtherName ? section.title : section.text,
            language,
          ),
          titleTerms: terms(section.title, language),
          text: section.text,
          isOtherName: section.isOtherName,
        };
      },
    ),
  };
};

export const makeDocsIndex: (
  madePages: Array<MadePage>,
  language?: string | undefined,
) => AIDocsLanguageIndex = (
  madePages: Array<MadePage>,
  language?: string | undefined,
): AIDocsLanguageIndex => {
  const resolved: string = language || "en";
  const builder: DocsIndexBuilder = new DocsIndexBuilder(resolved);

  for (const made of madePages) {
    builder.addPage(madePageInput(made, resolved));
  }

  return builder.build();
};
