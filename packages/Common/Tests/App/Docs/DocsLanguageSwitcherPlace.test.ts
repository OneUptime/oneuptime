import {
  addEnglishAnchorAliases,
  getEnglishAnchorAliases,
} from "../../../../App/FeatureSet/Docs/Utils/AnchorAliases";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

/*
 * The docs' language switcher, run in jsdom from the real page script
 * (Views/Partials/Scripts.ejs) over headings as the docs' route draws them
 * (the docs renderer, then Utils/AnchorAliases.ts).
 *
 * The dashboards link to a heading of the docs by its English anchor, which
 * opens the English page there. Picking another language opened that page
 * at its top: the switcher kept the path and dropped the place. It keeps the
 * place now, by the anchor every copy of the page answers - the English one
 * - so the reader stays at the heading they were sent to:
 *
 *   - on a translated page, from the heading's English mark or from its own
 *     translated anchor (the contents list's links), by the heading's
 *     data-english-anchor;
 *   - on an English copy - the English page, or one shown for a page not
 *     translated yet - by the heading's id;
 *   - not from a translated heading with no English anchor (a copy whose
 *     headings do not line up with the English page's): no other copy has
 *     that place, so the page opens at its top as before;
 *   - and anything that is not a heading by its id, which is the same in
 *     every copy.
 *
 * jsdom navigates to a fragment of the address it is at and to nothing
 * else, so each page is opened at the address the switcher should go to,
 * with the reader's fragment: a switcher that went anywhere but that page
 * would leave the address as it was, and report the navigation as an error.
 * Where the place is the reader's fragment itself, the address spells it
 * with a percent-escape, as an address may: the switch writes it plainly,
 * so a switch that kept nothing would show.
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
);

const SCRIPTS_TEMPLATE: string = path.join(
  DOCS_ROOT,
  "Views",
  "Partials",
  "Scripts.ejs",
);

const ORIGIN: string = "http://docs.example.lan";
const FENCE: string = "```";

const ENGLISH: string = [
  "Queues have pages of their own.",
  "",
  "## Broker health metrics",
  "",
  "The broker's own numbers.",
  "",
  `${FENCE}yaml`,
  "receivers: {}",
  FENCE,
  "",
  "### Apache Kafka",
  "",
  "Kafka's exporter.",
].join("\n");

const JAPANESE: string = [
  "キューには専用のページがあります。",
  "",
  "## ブローカーのヘルスメトリクス",
  "",
  "ブローカー自身の数値です。",
  "",
  `${FENCE}yaml`,
  "receivers: {}",
  FENCE,
  "",
  "### Apache Kafka",
  "",
  "Kafka のエクスポーターです。",
].join("\n");

// A translation whose headings no longer line up with the English page's.
const STALE_JAPANESE: string = JAPANESE.replace(
  "### Apache Kafka",
  "## Apache Kafka",
);

const TRANSLATED_ANCHOR: string = "ブローカーのヘルスメトリクス";

// An anchor with its last character percent-escaped: the same place.
function escaped(anchor: string): string {
  const last: number = anchor.charCodeAt(anchor.length - 1);

  return `${anchor.slice(0, -1)}%${last.toString(16).toUpperCase()}`;
}

function renderScripts(lang: string): string {
  return ejs.render(
    fs.readFileSync(SCRIPTS_TEMPLATE, "utf8"),
    {
      t: (key: string): string => {
        return key;
      },
      nav: [],
      lang,
    },
    { filename: SCRIPTS_TEMPLATE },
  );
}

interface PageOptions {
  // The page's language: the URL's and the switcher's.
  lang: string;
  // The copy's own language, when it is not the page's (an untranslated page).
  contentLang?: string | undefined;
  markdown: string;
  // The English page the copy's headings are paired with, for a translation.
  englishMarkdown?: string | undefined;
  // The page's path, with any query, as the server saw it.
  currentPath: string;
  // The address jsdom opens: where the switcher should go, with the reader's fragment.
  url: string;
}

interface OpenedPage {
  window: DOMWindow;
  document: Document;
  errors: Array<string>;
}

let opened: OpenedPage | null = null;

afterEach(() => {
  opened?.window.close();
  opened = null;
});

async function settle(window: DOMWindow): Promise<void> {
  for (let round: number = 0; round < 3; round++) {
    await new Promise<void>((resolve: () => void) => {
      window.setTimeout(resolve, 0);
    });
  }
}

async function openPage(options: PageOptions): Promise<OpenedPage> {
  let content: string = await Markdown.convertToHTML(
    options.markdown,
    MarkdownContentType.Docs,
  );

  if (options.englishMarkdown !== undefined) {
    content = addEnglishAnchorAliases(
      content,
      getEnglishAnchorAliases(options.englishMarkdown, options.markdown),
    );
  }

  const contentLang: string = options.contentLang
    ? ` lang="${options.contentLang}" dir="ltr"`
    : "";

  const html: string = `<!doctype html><html lang="${options.lang}"><head></head><body>
    <select id="docs-language-switcher-header" data-language-switcher data-current-path="${options.currentPath}">
      <option value="en">English</option>
      <option value="de">Deutsch</option>
      <option value="ja">日本語</option>
    </select>
    <article class="docs-article">
      <div class="docs-content" id="docs-content"${contentLang}>${content}</div>
    </article>
    ${renderScripts(options.lang)}
  </body></html>`;

  const errors: Array<string> = [];
  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: options.url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });

  await settle(dom.window);

  opened = { window: dom.window, document: dom.window.document, errors };

  return opened;
}

// Pick a language in the header's switcher; where the page went.
async function pick(page: OpenedPage, language: string): Promise<string> {
  const switcher: HTMLSelectElement = page.document.querySelector(
    "[data-language-switcher]",
  ) as HTMLSelectElement;

  switcher.value = language;
  switcher.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await settle(page.window);

  return page.window.location.href;
}

describe("the docs' language switcher keeps the reader's place", () => {
  test("from a translated heading's English mark: the address the dashboard linked to, in another language", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/de/telemetry/queues#${escaped("broker-health-metrics")}`,
    });

    // The mark answers the English anchor on the Japanese page.
    expect(
      page.document
        .getElementById("broker-health-metrics")
        ?.closest(".docs-heading")?.id,
    ).toBe(TRANSLATED_ANCHOR);

    expect(await pick(page, "de")).toBe(
      `${ORIGIN}/docs/de/telemetry/queues#broker-health-metrics`,
    );
    expect(page.errors).toEqual([]);
  });

  test("from a translated heading's own anchor, as the contents list links it", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/en/telemetry/queues#${encodeURIComponent(TRANSLATED_ANCHOR)}`,
    });

    expect(await pick(page, "en")).toBe(
      `${ORIGIN}/docs/en/telemetry/queues#broker-health-metrics`,
    );
    expect(page.errors).toEqual([]);
  });

  test("from a translated heading kept in English, whose own anchor is the English one", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/de/telemetry/queues#${escaped("apache-kafka")}`,
    });

    expect(await pick(page, "de")).toBe(
      `${ORIGIN}/docs/de/telemetry/queues#apache-kafka`,
    );
  });

  test("from the English page, by the heading's id, keeping the address's query", async () => {
    const page: OpenedPage = await openPage({
      lang: "en",
      markdown: ENGLISH,
      currentPath: "/docs/en/telemetry/queues?from=dashboard",
      url: `${ORIGIN}/docs/ja/telemetry/queues?from=dashboard#${escaped("broker-health-metrics")}`,
    });

    expect(await pick(page, "ja")).toBe(
      `${ORIGIN}/docs/ja/telemetry/queues?from=dashboard#broker-health-metrics`,
    );
    expect(page.errors).toEqual([]);
  });

  test("from the English copy of a page not translated yet, by the heading's id", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      contentLang: "en",
      markdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/de/telemetry/queues#${escaped("broker-health-metrics")}`,
    });

    expect(await pick(page, "de")).toBe(
      `${ORIGIN}/docs/de/telemetry/queues#broker-health-metrics`,
    );
  });

  test("not from a translated heading with no English anchor: the page opens at its top, as before", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: STALE_JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/de/telemetry/queues#${encodeURIComponent(TRANSLATED_ANCHOR)}`,
    });

    // The stale copy's headings answer no English anchor.
    expect(page.document.querySelector("[data-english-anchor]")).toBeNull();
    expect(page.document.getElementById(TRANSLATED_ANCHOR)).not.toBeNull();

    expect(await pick(page, "de")).toBe(`${ORIGIN}/docs/de/telemetry/queues`);
    expect(page.errors).toEqual([]);
  });

  test("by its id from anything that is not a heading: it is the same in every copy", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/de/telemetry/queues#${escaped("docs-content")}`,
    });

    expect(await pick(page, "de")).toBe(
      `${ORIGIN}/docs/de/telemetry/queues#docs-content`,
    );
  });

  test.each([
    // Nothing to keep: the switch adds no "#" either.
    ["no fragment", ""],
    ["a fragment that names nothing on the page", "#nowhere"],
    ["a fragment that is not percent-encoding", "#100%"],
  ])(
    "with %s, as the page's path alone",
    async (_case: string, fragment: string) => {
      const page: OpenedPage = await openPage({
        lang: "ja",
        markdown: JAPANESE,
        englishMarkdown: ENGLISH,
        currentPath: "/docs/ja/telemetry/queues",
        url: `${ORIGIN}/docs/de/telemetry/queues${fragment}`,
      });

      expect(await pick(page, "de")).toBe(`${ORIGIN}/docs/de/telemetry/queues`);
      expect(page.errors).toEqual([]);
    },
  );

  test("control: a switch to a page jsdom is not at is not followed, and is reported", async () => {
    const page: OpenedPage = await openPage({
      lang: "ja",
      markdown: JAPANESE,
      englishMarkdown: ENGLISH,
      currentPath: "/docs/ja/telemetry/queues",
      url: `${ORIGIN}/docs/ja/telemetry/queues#broker-health-metrics`,
    });

    // To German from a page jsdom opened in Japanese: a navigation it does not follow.
    expect(await pick(page, "de")).toBe(
      `${ORIGIN}/docs/ja/telemetry/queues#broker-health-metrics`,
    );
    expect(page.errors.join("\n")).toContain("navigation");
  });
});
