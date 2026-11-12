import {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  tokenizeForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { DocsVocabulary } from "../../../FeatureSet/Docs/Utils/DocsSearchWords";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";

/*
 * A small docs index made by hand, laid out as AIDocsReader.build lays out
 * the real one, so docs search's ranking can be checked against pages whose
 * every word is known (DocsSearch.test.ts).
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

const counts: (text: string) => Map<string, number> = (
  text: string,
): Map<string, number> => {
  const found: Map<string, number> = new Map();
  for (const term of tokenizeForDocs(text)) {
    found.set(term, (found.get(term) || 0) + 1);
  }
  return found;
};

const terms: (text: string) => Set<string> = (text: string): Set<string> => {
  return new Set<string>(tokenizeForDocs(text));
};

const anchorOf: (title: string) => string = (title: string): string => {
  return slugifyMarkdownHeading(title);
};

export const makeDocsIndex: (
  madePages: Array<MadePage>,
  language?: string | undefined,
) => AIDocsLanguageIndex = (
  madePages: Array<MadePage>,
  language?: string | undefined,
): AIDocsLanguageIndex => {
  const documentFrequency: Map<string, number> = new Map();

  const pages: Array<AIDocsIndexedPage> = madePages.map(
    (made: MadePage): AIDocsIndexedPage => {
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

      const sections: Array<AIDocsIndexedSection> = madeSections.map(
        (section: MadeSection): AIDocsIndexedSection => {
          return {
            title: section.title,
            anchor: section.anchor || anchorOf(section.title),
            terms: counts(section.isOtherName ? section.title : section.text),
            titleTerms: terms(section.title),
            text: section.text,
            isOtherName: section.isOtherName,
          };
        },
      );

      const page: AIDocsIndexedPage = {
        page: made.page,
        title: made.title,
        group: made.group || "Docs",
        summary,
        language: language || "en",
        titleTerms: terms(made.title),
        groupTerms: terms(made.group || "Docs"),
        summaryTerms: terms(summary),
        headingTerms: terms(
          madeSections
            .filter((section: MadeSection): boolean => {
              return !section.isOtherName;
            })
            .map((section: MadeSection): string => {
              return section.title;
            })
            .join(" "),
        ),
        bodyTerms: counts(body),
        bodyLength: tokenizeForDocs(body).length,
        sections,
        isGuide: made.isGuide === true,
      };

      for (const term of new Set<string>([
        ...page.titleTerms,
        ...page.headingTerms,
        ...page.summaryTerms,
        ...page.bodyTerms.keys(),
        ...sections.flatMap((section: AIDocsIndexedSection): Array<string> => {
          return section.isOtherName ? Array.from(section.titleTerms) : [];
        }),
      ])) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }

      return page;
    },
  );

  return {
    language: language || "en",
    pages,
    documentFrequency,
    averageBodyLength:
      pages.reduce((total: number, page: AIDocsIndexedPage): number => {
        return total + page.bodyLength;
      }, 0) / Math.max(1, pages.length),
    vocabulary: new DocsVocabulary(documentFrequency),
  };
};
