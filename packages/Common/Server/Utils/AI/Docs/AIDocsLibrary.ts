/*
 * OneUptime's own docs, as OneUptime AI reads them.
 *
 * Every installation serves its docs itself (App's Docs feature set), an
 * air-gapped one too, so Ask AI answers "how do I...?" from the very pages
 * the reader would open, in their language where a page is translated, and
 * nothing leaves the installation but what goes to the AI provider it
 * already has (issue #6828).
 *
 * The docs live in App, and the tools that read them in Common
 * (Toolbox/DocsTools), so App hands Common its reader when the Docs feature
 * set starts (Docs/Utils/AIDocsReader). A process without one - a test, a
 * service that does not serve the docs - has no docs, and the tools say so
 * rather than guess.
 */

// A section of a page: its heading, and the anchor the docs give it.
export interface AIDocsSection {
  title: string;
  anchor: string;
}

export interface AIDocsSearchHit {
  // The page's address under /docs/<lang>/: "monitor/website-monitor".
  page: string;
  title: string;
  // The docs nav group it sits in: "Monitors".
  group: string;
  // Its first paragraph, trimmed.
  summary: string;
  // The language its text is in: the one asked for, or English where it is not translated.
  language: string;
  // The section that matched best, when one did better than the page as a whole.
  section?: AIDocsSection | undefined;
}

export interface AIDocsPage {
  page: string;
  title: string;
  group: string;
  // The language its text is in: the one asked for, or English where it is not translated.
  language: string;
  // The page as written, in Markdown, without its title line.
  markdown: string;
  // Its h2 and h3 sections, in order.
  sections: Array<AIDocsSection>;
}

export interface AIDocsReader {
  search(data: {
    query: string;
    language: string;
    limit: number;
  }): Promise<Array<AIDocsSearchHit>>;
  // Null when there is no such page in the docs' nav.
  readPage(data: { page: string; language: string }): Promise<AIDocsPage | null>;
}

let registeredReader: AIDocsReader | null = null;

export default class AIDocsLibrary {
  public static setReader(reader: AIDocsReader | null): void {
    registeredReader = reader;
  }

  public static getReader(): AIDocsReader | null {
    return registeredReader;
  }
}
