import DocsNav, { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DOCS_DEFAULT_ICON,
  DOCS_EXTERNAL_LINK_ICON,
  getDocsNavIcon,
} from "../../../FeatureSet/Docs/Utils/NavIcons";
import DocsRender, {
  findDocsNavGroupForUrl,
} from "../../../FeatureSet/Docs/Utils/Render";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { DOCS_CALLOUT_TYPES } from "Common/Server/Types/MarkdownDocsExtensions";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs app adds to the shared renderer's HTML, because only it knows
 * which language a page is read in and which section a link leads to:
 *
 *   - the labels the renderer adds (a callout's "Note", a folded section's
 *     "Details") in the language of the text around them;
 *   - links between pages that keep the reader in the language they are
 *     reading - written as /docs/<category>/<page>, they used to redirect by
 *     the browser's language, so a reader who picked German was sent back to
 *     English by every link in the text;
 *   - the icon on each card, the icon of the sidebar group it leads into.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const render: (
  markdown: string,
  lang?: string,
  contentLang?: string,
) => Promise<string> = (
  markdown: string,
  lang?: string,
  contentLang?: string,
): Promise<string> => {
  return DocsRender.render(markdown, { lang: lang, contentLang: contentLang });
};

const LABEL_KEYS: Record<string, string> = {
  note: "calloutNote",
  tip: "calloutTip",
  info: "calloutInfo",
  important: "calloutImportant",
  warning: "calloutWarning",
  caution: "calloutCaution",
  danger: "calloutDanger",
};

describe("labels the renderer adds", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "are in %s for a page written in it",
    async (lang: string) => {
      const t: ReturnType<typeof makeT> = makeT(lang);

      for (const type of DOCS_CALLOUT_TYPES) {
        const html: string = await render(`:::${type}\nx\n:::`, lang, lang);
        const label: string = t(`ui.${LABEL_KEYS[type]}`);

        expect(label).not.toBe(`ui.${LABEL_KEYS[type]}`);
        expect(html).toContain(
          `<span class="docs-callout__label" data-docs-label="${type}">${label}</span>`,
        );
      }

      expect(await render(":::details\nx\n:::", lang, lang)).toContain(
        `<span data-docs-label="details">${t("ui.detailsSummary")}</span>`,
      );
    },
  );

  it("are translated in every locale file, not left in English", () => {
    const english: { ui: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    );

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      if (lang === "en") {
        continue;
      }

      const locale: { ui: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
      );

      /*
       * "Tip", "Info" and "Details" are the word itself in several
       * languages; "Note" and "Warning" are not in any of ours.
       */
      for (const key of ["calloutNote", "calloutWarning"]) {
        expect({ lang, key, value: locale.ui[key] }).not.toEqual({
          lang,
          key,
          value: english.ui[key],
        });
      }
    }
  });

  it("follow the text, not the page, when the page shows the English copy", async () => {
    const html: string = await render("> [!NOTE]\n> x", "de", "en");

    expect(html).toContain('data-docs-label="note">Note</span>');
  });

  it("leave a callout's own title alone", async () => {
    const html: string = await render(
      ":::warning Back up first\nx\n:::",
      "de",
      "de",
    );

    expect(html).toContain(
      '<span class="docs-callout__label">Back up first</span>',
    );
  });
});

describe("links between docs pages", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "keep a %s reader in their language",
    async (lang: string) => {
      const html: string = await render(
        "See [incidents](/docs/incidents/index) and [this part](/docs/monitor/website-monitor#default-criteria).",
        lang,
        lang,
      );

      expect(html).toContain(`href="/docs/${lang}/incidents/index"`);
      expect(html).toContain(
        `href="/docs/${lang}/monitor/website-monitor#default-criteria"`,
      );
    },
  );

  it("keep a link that already names a language, and anything that is not a page", async () => {
    const html: string = await render(
      [
        "[German](/docs/de/incidents/index)",
        "[image](/docs/static/images/logo-light.svg)",
        "[raw](/docs/as-markdown/incidents/index)",
        "[llms](/docs/llms.txt)",
        "[section](#a-heading)",
        "[site](https://oneuptime.com/docs/monitor/website-monitor)",
        "[dashboard](/dashboard/123/incidents)",
      ].join("\n\n"),
      "fr",
      "fr",
    );

    expect(html).toContain('href="/docs/de/incidents/index"');
    expect(html).toContain('href="/docs/static/images/logo-light.svg"');
    expect(html).toContain('href="/docs/as-markdown/incidents/index"');
    expect(html).toContain('href="/docs/llms.txt"');
    expect(html).toContain('href="#a-heading"');
    expect(html).toContain(
      'href="https://oneuptime.com/docs/monitor/website-monitor"',
    );
    expect(html).toContain('href="/dashboard/123/incidents"');
  });

  it("are left as written when no page language is given", async () => {
    expect(await DocsRender.render("[x](/docs/incidents/index)")).toContain(
      'href="/docs/incidents/index"',
    );
  });

  it("keep a query string, escaped", async () => {
    const html: string = await render(
      "[x](/docs/telemetry/search-syntax?q=a&b=c)",
      "ja",
      "ja",
    );

    expect(html).toContain(
      'href="/docs/ja/telemetry/search-syntax?q=a&amp;b=c"',
    );
  });
});

describe("card icons", () => {
  const groupOf: (title: string) => NavGroup = (title: string): NavGroup => {
    return DocsNav.find((group: NavGroup): boolean => {
      return group.title === title;
    })!;
  };

  it("are the icon of the group the card leads into", async () => {
    const html: string = await render(
      ":::cards\n- [Website](/docs/monitor/website-monitor): x\n- [Agents](/docs/telemetry/kubernetes-agent): y\n:::",
      "en",
      "en",
    );

    expect(html).toContain(getDocsNavIcon("Monitor"));
    expect(html).toContain(getDocsNavIcon("Infrastructure Agents"));
    expect(getDocsNavIcon("Monitor")).not.toBe(DOCS_DEFAULT_ICON);
  });

  it("are chosen from the link as written, before it is localized", async () => {
    const html: string = await render(
      ":::cards\n- [Incidents](/docs/incidents/index)\n:::",
      "ko",
      "ko",
    );

    expect(html).toContain('href="/docs/ko/incidents/index"');
    expect(html).toContain(getDocsNavIcon("Incidents"));
  });

  it("mark a card that leaves the docs, and fall back to a page icon", async () => {
    const html: string = await render(
      ":::cards\n- [GitHub](https://github.com/oneuptime/oneuptime)\n- [Somewhere](/elsewhere)\n- No link\n:::",
      "en",
      "en",
    );

    expect(html).toContain(DOCS_EXTERNAL_LINK_ICON);
    expect(html.split(DOCS_DEFAULT_ICON).length - 1).toBe(2);
    expect(html).not.toContain(
      '<span class="docs-card__icon" aria-hidden="true"></span>',
    );
  });

  it("find a page's group, or failing that its category's first group", () => {
    expect(findDocsNavGroupForUrl("/docs/monitor/vmware-monitor")).toBe(
      groupOf("Infrastructure Monitors"),
    );
    expect(findDocsNavGroupForUrl("/docs/monitor/no-such-page")).toBe(
      groupOf("Monitor"),
    );
    expect(findDocsNavGroupForUrl("/docs/telemetry/cloud-aws-ecs#x")).toBe(
      groupOf("Cloud"),
    );
    expect(
      findDocsNavGroupForUrl("/docs/de/monitor/vmware-monitor"),
    ).toBeNull();
    expect(findDocsNavGroupForUrl("/docs/nothing/here")).toBeNull();
    expect(findDocsNavGroupForUrl("https://example.com")).toBeNull();
  });
});
