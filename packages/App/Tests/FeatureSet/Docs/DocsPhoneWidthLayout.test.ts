import { DOCS_CORPUS } from "./DocsContentRules";
import { readPage } from "./DocsContentSupport";
import {
  CssRule,
  DOCS_STYLESHEET,
  declaredIn,
  readCssRules,
} from "./DocsStylesheet";
import { describe, expect, it } from "@jest/globals";

/*
 * What keeps a docs page from scrolling sideways on a phone.
 *
 * The final pass of the docs overhaul (task 40) loaded every page in all 17
 * languages at 390px wide. Diagrams, tables, code samples and tab lists
 * scroll inside their own box, and prose breaks a long word, so nothing else
 * may stick out of the page. Two pages did: Russian and six other API
 * Monitor pages, and Russian AWS Security Hub. Each had a details summary
 * with inline code in it, and the summary is a flex row: its words and its
 * code spans, the summary's own children, were each a flex item that could
 * not wrap around the others. The renderer now puts the whole title in one
 * element (MarkdownDocsExtensions), and these tests hold the stylesheet and
 * the rendered pages to that.
 */

const RULES: Array<CssRule> = readCssRules(DOCS_STYLESHEET);

describe("on a phone, the wide parts of a page scroll inside their own box", () => {
  it.each([
    [".docs-diagram", "overflow-x", "auto"],
    [".docs-table-wrapper", "overflow-x", "auto"],
    [".docs-code pre", "overflow-x", "auto"],
    [".docs-tabs__list", "overflow-x", "auto"],
  ])("%s has %s: %s", (selector: string, property: string, value: string) => {
    expect(declaredIn(RULES, selector, property)).toBe(value);
  });

  it("and prose and inline code break a long word rather than widen the page", () => {
    expect(declaredIn(RULES, ".docs-content", "overflow-wrap")).toBe(
      "break-word",
    );
    expect(declaredIn(RULES, ".docs-code-inline", "overflow-wrap")).toBe(
      "break-word",
    );
  });
});

describe("a details summary wraps its title as one paragraph", () => {
  it("lays out the marker and the title side by side, and lets the title shrink and break", () => {
    expect(declaredIn(RULES, ".docs-details__summary", "display")).toBe("flex");
    expect(declaredIn(RULES, ".docs-details__title", "flex")).toBe("1 1 auto");
    expect(declaredIn(RULES, ".docs-details__title", "min-width")).toBe("0");
    expect(declaredIn(RULES, ".docs-details__title", "overflow-wrap")).toBe(
      "anywhere",
    );
  });

  // The pages that scrolled sideways at 390px, and the English one.
  it.each([
    ["ru", "monitor/api-monitor"],
    ["pt", "monitor/api-monitor"],
    ["fa", "monitor/api-monitor"],
    ["ru", "integrations/aws-security-hub"],
    ["en", "monitor/api-monitor"],
  ])(
    "%s %s draws every summary as its marker and one title",
    async (lang: string, page: string) => {
      const body: string = readPage(lang, page).split("\n").slice(1).join("\n");
      const html: string = await DOCS_CORPUS.renderBody(body, lang);
      const open: string = '<summary class="docs-details__summary">';
      const summaries: Array<string> = html
        .split(open)
        .slice(1)
        .map((part: string): string => {
          return part.slice(0, part.indexOf("</summary>"));
        });

      expect(summaries.length).toBeGreaterThan(0);
      // The one with code in it, which pushed the page sideways.
      expect(
        summaries.some((summary: string): boolean => {
          return summary.includes('<code class="docs-code-inline">');
        }),
      ).toBe(true);

      for (const summary of summaries) {
        expect({
          summary,
          oneTitle:
            summary.startsWith('<span class="docs-details__title">') &&
            summary.endsWith("</span>") &&
            summary.split('class="docs-details__title"').length === 2,
        }).toEqual({ summary, oneTitle: true });
      }
    },
  );
});
