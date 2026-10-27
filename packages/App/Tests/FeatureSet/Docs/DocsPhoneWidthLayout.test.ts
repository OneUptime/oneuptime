import { DOCS_CORPUS } from "./DocsContentRules";
import { readPage } from "./DocsContentSupport";
import { stripHtmlTags } from "./DocsHtmlText";
import {
  CssRule,
  DOCS_STYLESHEET,
  declaredIn,
  readCssRules,
} from "./DocsStylesheet";
import { describe, expect, it } from "@jest/globals";
import {
  CODE_BREAK,
  CODE_BREAK_MIN_RUN,
} from "Common/Server/Types/MarkdownCodeBreaks";

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

/*
 * A long code name breaks between its parts. A Helm value such as
 * `vapid.existingSecret.privateKeyKey` broke mid-word on a phone (#5090's
 * review), and the environment-variable tables of the Microsoft Teams, Slack
 * and GitHub guides - two columns of names like
 * `MICROSOFT_TEAMS_APP_CLIENT_SECRET` and `microsoftTeamsApp.clientSecret` -
 * scrolled sideways at 1280px (26px on the Teams page, 8px on Slack's) for
 * want of anywhere to break (#5220's review). The renderer now puts a <wbr>
 * before the dots, after the underscores and after the slashes of a long
 * run (MarkdownCodeBreaks); measured in Chromium at 1280px, none of the
 * three pages' tables scrolls any more.
 */
describe("a long code name breaks between its parts", () => {
  const CODE_SPAN: string = '<code class="docs-code-inline">';

  const codeSpansOf: (html: string) => Array<string> = (
    html: string,
  ): Array<string> => {
    return html
      .split(CODE_SPAN)
      .slice(1)
      .map((part: string): string => {
        return part.slice(0, part.indexOf("</code>"));
      });
  };

  // A run long enough to break that has a dot or an underscore between names.
  const needsBreaks: (code: string) => boolean = (code: string): boolean => {
    return code.split(" ").some((run: string): boolean => {
      const readable: string = stripHtmlTags(run)
        .split("&lt;")
        .join("<")
        .split("&gt;")
        .join(">")
        .split("&quot;")
        .join('"')
        .split("&amp;")
        .join("&");
      if (Array.from(readable).length < CODE_BREAK_MIN_RUN) {
        return false;
      }
      for (let index: number = 1; index < readable.length - 1; index++) {
        const character: string = readable[index]!;
        const before: string = readable[index - 1]!;
        const after: string = readable[index + 1]!;
        const isName: (letter: string) => boolean = (
          letter: string,
        ): boolean => {
          return (
            letter.toLowerCase() !== letter.toUpperCase() ||
            (letter >= "0" && letter <= "9")
          );
        };
        if (
          (character === "." || character === "_") &&
          isName(before) &&
          isName(after)
        ) {
          return true;
        }
      }
      return false;
    });
  };

  it.each([
    ["en", "self-hosted/microsoft-teams-integration"],
    ["en", "self-hosted/slack-integration"],
    ["en", "self-hosted/github-integration"],
    ["en", "self-hosted/push-notifications"],
    ["de", "self-hosted/microsoft-teams-integration"],
    ["fa", "self-hosted/slack-integration"],
  ])(
    "%s %s: every long name in its code can break between its parts",
    async (lang: string, page: string) => {
      const body: string = readPage(lang, page).split("\n").slice(1).join("\n");
      const html: string = await DOCS_CORPUS.renderBody(body, lang);
      const spans: Array<string> = codeSpansOf(html);
      const long: Array<string> = spans.filter(needsBreaks);

      expect(long.length).toBeGreaterThan(0);
      for (const span of long) {
        expect({ span, breaks: span.includes(CODE_BREAK) }).toEqual({
          span,
          breaks: true,
        });
      }
    },
  );

  it.each([
    "self-hosted/microsoft-teams-integration",
    "self-hosted/slack-integration",
  ])(
    "%s: the environment-variable table's names break, and read as written",
    async (page: string) => {
      const body: string = readPage("en", page).split("\n").slice(1).join("\n");
      const html: string = await DOCS_CORPUS.renderBody(body, "en");
      // The table of config.env's settings beside their Helm values.
      const table: string | undefined = html
        .split('<div class="docs-table-wrapper"')
        .map((part: string): string => {
          return part.slice(0, part.indexOf("</table>"));
        })
        .find((part: string): boolean => {
          const header: string = part.slice(0, part.indexOf("</tr>"));
          return (
            header.includes(`Docker Compose (${CODE_SPAN}config.env</code>)`) &&
            header.includes(`Helm (${CODE_SPAN}values.yaml</code>)`)
          );
        });

      expect(table).toBeDefined();
      const names: Array<string> = codeSpansOf(table!).filter(
        (span: string): boolean => {
          return (
            !span.includes(" ") &&
            Array.from(stripHtmlTags(span)).length >= CODE_BREAK_MIN_RUN
          );
        },
      );

      // A Compose name and a Helm value for each of the app's three settings.
      expect(names.length).toBeGreaterThanOrEqual(4);
      for (const name of names) {
        expect(name).toContain(CODE_BREAK);
        // A break adds no character: the text is the name as written.
        expect(body).toContain("`" + stripHtmlTags(name) + "`");
      }
    },
  );
});
