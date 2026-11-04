import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import {
  DocsAnchorAlias,
  addEnglishAnchorAliases,
  getEnglishAnchorAliases,
} from "../../../FeatureSet/Docs/Utils/AnchorAliases";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DOCS_DIR,
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import {
  MarkdownHeading,
  readMarkdownHeadings,
} from "Common/Server/Types/MarkdownHeadings";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import fs from "fs";
import path from "path";

/*
 * A TRANSLATED DOCS PAGE ANSWERS THE ENGLISH ANCHORS THE PRODUCT LINKS TO.
 *
 * The dashboards link to a heading of the docs by its English anchor
 * (/docs/telemetry/queues#broker-health-metrics, which opens the English
 * page), and a translated heading's anchor is made of its own words. So the
 * reader who picked Japanese on that page got the Japanese page at its top,
 * and the address with "ja" in it went nowhere. Each translated heading
 * answers the English anchor of the heading in its place now
 * (Utils/AnchorAliases.ts), and the language switcher keeps the reader's
 * place by it (Common's DocsLanguageSwitcherPlace runs it):
 *
 *   - headings pair by place only when the two copies have the same shape,
 *     read by the one reader docs:localize-anchors pairs them by too
 *     (Common/Server/Types/MarkdownHeadings);
 *   - a translated heading names its English anchor in data-english-anchor
 *     and, where the two differ, has an empty mark with the English id at
 *     its top - never a second element with an id the page already has;
 *   - the pages the product links to, in every language, served by the
 *     docs' own route, land each English anchor on the heading in the
 *     English heading's place, and the English pages are drawn as before.
 *
 * DocsLinksResolve holds every link written into the product to it.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const FENCE: string = "```";

// A page as the route draws it: its first line, the title, is the header's.
const withoutTitle: (markdown: string) => string = (
  markdown: string,
): string => {
  return markdown.split("\n").slice(1).join("\n");
};

// How many elements of the HTML have this id.
const idCount: (html: string, id: string) => number = (
  html: string,
  id: string,
): number => {
  return html.split(` id="${id}"`).length - 1;
};

// The ids the HTML gives more than one element.
const repeatedIds: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const seen: Map<string, number> = new Map<string, number>();

  for (const match of html.matchAll(/\sid="([^"]*)"/g)) {
    seen.set(match[1]!, (seen.get(match[1]!) || 0) + 1);
  }

  return [...seen.entries()]
    .filter((entry: [string, number]): boolean => {
      return entry[1] > 1;
    })
    .map((entry: [string, number]): string => {
      return entry[0];
    });
};

/*
 * A heading's opening as the page draws it once it answers an English
 * anchor: with the mark when its own anchor is another.
 */
const answeringHeading: (
  level: number,
  anchor: string,
  englishAnchor: string,
) => string = (
  level: number,
  anchor: string,
  englishAnchor: string,
): string => {
  const opening: string = `<h${level} id="${anchor}" data-english-anchor="${englishAnchor}" class="docs-heading docs-h${level}">`;

  return anchor === englishAnchor
    ? opening
    : `${opening}<span id="${englishAnchor}" class="docs-heading__alias" aria-hidden="true"></span>`;
};

const render: (markdown: string, lang: string) => Promise<string> = (
  markdown: string,
  lang: string,
): Promise<string> => {
  return DocsRender.render(markdown, { lang: lang, contentLang: lang });
};

const ENGLISH: string = [
  "Intro.",
  "",
  "## Connect a repository",
  "",
  "Pick the repository.",
  "",
  `${FENCE}bash`,
  "# a comment, not a heading",
  FENCE,
  "",
  "### Run on a schedule",
  "",
  "~~~yaml",
  "## not a heading either",
  "~~~",
  "",
  "## Upgrading",
  "",
  "Upgrade the agent.",
].join("\n");

const JAPANESE: string = [
  "はじめに。",
  "",
  "## リポジトリを接続する",
  "",
  "リポジトリを選びます。",
  "",
  `${FENCE}bash`,
  "# コメントで、見出しではありません",
  FENCE,
  "",
  "### スケジュールで実行する",
  "",
  "~~~yaml",
  "## これも見出しではありません",
  "~~~",
  "",
  "## Upgrading",
  "",
  "エージェントをアップグレードします。",
].join("\n");

describe("a translated page's headings and the English page's", () => {
  it("pair by place: each translated heading with the English heading where it is", () => {
    expect(getEnglishAnchorAliases(ENGLISH, JAPANESE)).toEqual([
      {
        anchor: "リポジトリを接続する",
        englishAnchor: "connect-a-repository",
      },
      { anchor: "スケジュールで実行する", englishAnchor: "run-on-a-schedule" },
      { anchor: "upgrading", englishAnchor: "upgrading" },
    ]);
  });

  it("read a heading's anchor as the page draws it", async () => {
    const english: string = [
      "## Ship `ceph_health_status` & more ##",
      "",
      "## Read [the guide](/docs/telemetry/queues) first",
    ].join("\n");
    const html: string = await render(english, "en");

    for (const heading of readMarkdownHeadings(english)) {
      expect(idCount(html, heading.anchor)).toBe(1);
    }
    expect(
      readMarkdownHeadings(english).map((heading: MarkdownHeading): string => {
        return heading.anchor;
      }),
    ).toEqual(["ship-ceph_health_status-more", "read-the-guide-first"]);
  });

  it("do not read a heading in fenced code, however long its fence", () => {
    const english: string = [
      "## Example",
      "",
      "````md",
      FENCE,
      "## Inside a sample",
      FENCE,
      "````",
    ].join("\n");

    expect(readMarkdownHeadings(english)).toEqual([
      { anchor: "example", level: 2, code: ["md"] },
    ]);
  });

  it.each([
    [
      "a heading at another level",
      JAPANESE.replace("## リポジトリを接続する", "### リポジトリを接続する"),
    ],
    [
      "a code sample in another language",
      JAPANESE.replace(`${FENCE}bash`, `${FENCE}sh`),
    ],
    [
      "a heading missing",
      JAPANESE.replace("### スケジュールで実行する", "スケジュールで実行する"),
    ],
    ["a heading more", `${JAPANESE}\n\n## 付録`],
  ])(
    "do not pair when the translation is not the English page's shape: %s",
    (_change: string, translated: string) => {
      expect(getEnglishAnchorAliases(ENGLISH, translated)).toEqual([]);
    },
  );

  it("do not pair a page whose English copy has no headings", () => {
    expect(getEnglishAnchorAliases("Intro.", "はじめに。")).toEqual([]);
  });
});

describe("a translated page's HTML", () => {
  it("has each heading answer the English anchor of its place: the attribute, and a mark at its top", async () => {
    const html: string = addEnglishAnchorAliases(
      await render(JAPANESE, "ja"),
      getEnglishAnchorAliases(ENGLISH, JAPANESE),
    );

    expect(html).toContain(
      `${answeringHeading(2, "リポジトリを接続する", "connect-a-repository")}<span class="docs-heading__text">リポジトリを接続する</span>`,
    );
    expect(html).toContain(
      answeringHeading(3, "スケジュールで実行する", "run-on-a-schedule"),
    );
    // The heading's own anchor link still copies its own anchor.
    expect(html).toContain('href="#リポジトリを接続する"');
    expect(idCount(html, "connect-a-repository")).toBe(1);
    expect(idCount(html, "run-on-a-schedule")).toBe(1);
    expect(repeatedIds(html)).toEqual([]);
  });

  it("gives a heading kept in English the attribute and no mark: its own id answers", async () => {
    const html: string = addEnglishAnchorAliases(
      await render(JAPANESE, "ja"),
      getEnglishAnchorAliases(ENGLISH, JAPANESE),
    );

    expect(html).toContain(
      '<h2 id="upgrading" data-english-anchor="upgrading" class="docs-heading docs-h2"><span class="docs-heading__text">Upgrading</span>',
    );
    expect(idCount(html, "upgrading")).toBe(1);
  });

  it("never gives a mark an id the page has: that anchor is left to its element", async () => {
    const english: string = "## Overview\n\nText.\n\n## Upgrading\n\nText.";
    // A stale translation with the same shape: its headings moved.
    const translated: string =
      "## Upgrading\n\nテキスト。\n\n## 概要\n\nテキスト。";
    const aliases: Array<DocsAnchorAlias> = getEnglishAnchorAliases(
      english,
      translated,
    );
    const html: string = addEnglishAnchorAliases(
      await render(translated, "ja"),
      aliases,
    );

    expect(aliases).toEqual([
      { anchor: "upgrading", englishAnchor: "overview" },
      { anchor: "概要", englishAnchor: "upgrading" },
    ]);
    expect(html).toContain(answeringHeading(2, "upgrading", "overview"));
    expect(html).toContain(
      '<h2 id="概要" data-english-anchor="upgrading" class="docs-heading docs-h2"><span class="docs-heading__text">',
    );
    expect(idCount(html, "upgrading")).toBe(1);
    expect(repeatedIds(html)).toEqual([]);
  });

  it("gives a heading repeated on a page each its own pair, and one mark per id", async () => {
    const english: string = "## Example\n\nOne.\n\n## Example\n\nTwo.";
    const translated: string = "## 例\n\n一。\n\n## 例\n\n二。";
    const html: string = addEnglishAnchorAliases(
      await render(translated, "ja"),
      getEnglishAnchorAliases(english, translated),
    );

    expect(html.split('data-english-anchor="example"').length - 1).toBe(2);
    expect(idCount(html, "example")).toBe(1);
  });

  it("leaves a heading the page's lines do not show alone, and pairs the next one", async () => {
    const english: string = "## One\n\n> ## Quoted\n\n## Two";
    const translated: string = "## 一\n\n> ## 引用\n\n## 二";
    const html: string = addEnglishAnchorAliases(
      await render(translated, "ja"),
      getEnglishAnchorAliases(english, translated),
    );

    expect(html).toContain('<h2 id="引用" class="docs-heading docs-h2">');
    expect(html).toContain(answeringHeading(2, "一", "one"));
    expect(html).toContain(answeringHeading(2, "二", "two"));
  });

  it("is drawn as it was when nothing pairs", async () => {
    const html: string = await render(JAPANESE, "ja");

    expect(addEnglishAnchorAliases(html, [])).toBe(html);
    expect(
      addEnglishAnchorAliases(
        html,
        getEnglishAnchorAliases(ENGLISH, `${JAPANESE}\n\n## 付録`),
      ),
    ).toBe(html);
  });
});

/*
 * Pages the product links to a heading of, by the anchors it links with
 * (DocsLinksResolve reads every link written into the product): the AI
 * agent's repositories, the queue page's broker sections
 * (MessageQueueOverviewPresentation's anchors), video calls, the agentless
 * VMware and host collector setups, cloud costs, runbook triggers, web
 * vitals, flows, the Kubernetes agent and the incoming email monitor.
 */
const PRODUCT_ANCHORS: Record<string, Array<string>> = {
  "ai/ai-agent": ["connect-a-repository"],
  "telemetry/kubernetes-agent": ["what-ebpf-traces-look-like"],
  "telemetry/queues": [
    "apache-kafka",
    "broker-health-metrics",
    "broker-health-stays-empty",
  ],
  "workspace-connections/video-calls": [
    "zoom",
    "connect-in-one-click",
    "call-transcripts",
  ],
  "telemetry/vmware-agentless": ["probe-or-agent"],
  "telemetry/vmware": ["optional-ship-esxi-syslog"],
  "telemetry/host-otel-collector": [
    "inventory-attributes-ip-mac-serial-number-make-model-firmware",
  ],
  "telemetry/cloud-costs": [
    "microsoft-azure",
    "google-cloud",
    "amazon-web-services",
  ],
  "runbooks/triggers": ["run-on-a-schedule", "call-the-webhook"],
  "rum/web-vitals": ["single-page-apps"],
  "monitor/network-traffic": ["cisco-meraki-without-netflow"],
  "monitor/kubernetes-agent": ["linking-logs-to-traces"],
  "monitor/incoming-email-monitor": ["verifying-the-address-with-the-sender"],
  "inventory/cmdb-sync": ["network-device-asset-attributes"],
};

const PRODUCT_PAGES: Array<string> = Object.keys(PRODUCT_ANCHORS);

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

const served: (lang: string, page: string) => Promise<string> = async (
  lang: string,
  page: string,
): Promise<string> => {
  const response: Response = await fetch(`${origin}/docs/${lang}/${page}`, {
    redirect: "manual",
  });

  expect({ lang, page, status: response.status }).toEqual({
    lang,
    page,
    status: 200,
  });

  return response.text();
};

describe("every translated docs page", () => {
  it("pairs its headings with its English page's, as the page route reads both", () => {
    const unpaired: Array<string> = [];
    let pairs: number = 0;

    for (const page of listPages("en")) {
      // The route pairs the pages it draws: titles off, placeholders filled.
      const english: string = DocsPlaceholders.render(
        withoutTitle(readPage("en", page)),
        "en",
      );

      for (const lang of TRANSLATED_LANGUAGES) {
        const aliases: Array<DocsAnchorAlias> = getEnglishAnchorAliases(
          english,
          DocsPlaceholders.render(withoutTitle(readPage(lang, page)), lang),
        );

        if (aliases.length === 0 && readMarkdownHeadings(english).length > 0) {
          unpaired.push(`${lang}/${page}`);
        }

        pairs += aliases.length;
      }
    }

    expect(unpaired).toEqual([]);
    // Sixteen languages of more than three hundred pages.
    expect(pairs).toBeGreaterThan(90000);
  });
});

describe("the docs' pages the product links to", () => {
  it("are English pages with those headings", () => {
    for (const page of PRODUCT_PAGES) {
      const anchors: Array<string> = readMarkdownHeadings(
        withoutTitle(readPage("en", page)),
      ).map((heading: MarkdownHeading): string => {
        return heading.anchor;
      });

      expect({ page, missing: [] }).toEqual({
        page,
        missing: PRODUCT_ANCHORS[page]!.filter((anchor: string): boolean => {
          return !anchors.includes(anchor);
        }),
      });
    }
  });

  it.each(PRODUCT_PAGES)(
    "land an English anchor of %s on the heading in its place, in every language",
    async (page: string) => {
      const english: Array<MarkdownHeading> = readMarkdownHeadings(
        withoutTitle(readPage("en", page)),
      );
      const problems: Array<string> = [];

      for (const lang of TRANSLATED_LANGUAGES) {
        const html: string = await served(lang, page);
        const translated: Array<MarkdownHeading> = readMarkdownHeadings(
          withoutTitle(readPage(lang, page)),
        );

        for (const englishAnchor of PRODUCT_ANCHORS[page]!) {
          const place: number = english.findIndex(
            (heading: MarkdownHeading): boolean => {
              return heading.anchor === englishAnchor;
            },
          );
          const heading: MarkdownHeading = translated[place]!;

          if (
            !html.includes(
              answeringHeading(heading.level, heading.anchor, englishAnchor),
            )
          ) {
            problems.push(
              `${lang}: #${englishAnchor} is not at #${heading.anchor}`,
            );
          }

          if (idCount(html, englishAnchor) !== 1) {
            problems.push(
              `${lang}: #${englishAnchor} is the id of ${idCount(html, englishAnchor)} elements`,
            );
          }
        }

        for (const match of html.matchAll(
          /<span id="([^"]*)" class="docs-heading__alias"/g,
        )) {
          if (idCount(html, match[1]!) !== 1) {
            problems.push(`${lang}: the mark #${match[1]} repeats an id`);
          }
        }
      }

      expect(problems).toEqual([]);
    },
    120000,
  );

  it("are answered by a mark where the heading is translated, which most are", () => {
    let linked: number = 0;
    let translatedAnchors: number = 0;

    for (const page of PRODUCT_PAGES) {
      const english: Array<MarkdownHeading> = readMarkdownHeadings(
        withoutTitle(readPage("en", page)),
      );

      for (const lang of TRANSLATED_LANGUAGES) {
        const translated: Array<MarkdownHeading> = readMarkdownHeadings(
          withoutTitle(readPage(lang, page)),
        );

        for (const englishAnchor of PRODUCT_ANCHORS[page]!) {
          const place: number = english.findIndex(
            (heading: MarkdownHeading): boolean => {
              return heading.anchor === englishAnchor;
            },
          );

          linked++;
          if (translated[place]!.anchor !== englishAnchor) {
            translatedAnchors++;
          }
        }
      }
    }

    // Names (Zoom, Microsoft Azure) keep their words, and their anchors.
    expect(translatedAnchors).toBeGreaterThan(linked / 2);
  });

  it.each(["telemetry/queues", "ai/ai-agent"])(
    "draw %s in English as before: its own anchors, no attribute, no mark",
    async (page: string) => {
      const html: string = await served("en", page);

      expect(html).not.toContain('data-english-anchor="');
      expect(html).not.toContain('class="docs-heading__alias"');
      for (const anchor of PRODUCT_ANCHORS[page]!) {
        expect(idCount(html, anchor)).toBe(1);
      }
    },
  );

  it("draw a right-to-left page's marks the same way: Persian queues", async () => {
    const html: string = await served("fa", "telemetry/queues");

    expect(html).toMatch(
      /<h2 id="[^"]+" data-english-anchor="broker-health-metrics" class="docs-heading docs-h2"><span id="broker-health-metrics" class="docs-heading__alias" aria-hidden="true"><\/span><span class="docs-heading__text">/,
    );
  });
});

describe("the English anchors' mark and reader", () => {
  const STYLESHEET: string = fs.readFileSync(
    path.join(DOCS_DIR, "Static", "css", "style.css"),
    "utf8",
  );

  // One rule of the docs stylesheet, as its declarations: property -> value.
  const cssRule: (selector: string) => Record<string, string> = (
    selector: string,
  ): Record<string, string> => {
    const start: number = STYLESHEET.indexOf(`\n${selector} {`);

    expect({ selector, found: start >= 0 }).toEqual({ selector, found: true });

    const body: string = STYLESHEET.slice(
      STYLESHEET.indexOf("{", start) + 1,
      STYLESHEET.indexOf("}", start),
    );
    const declarations: Record<string, string> = {};

    for (const declaration of body.split(";")) {
      const colon: number = declaration.indexOf(":");

      if (colon > 0) {
        declarations[declaration.slice(0, colon).trim()] = declaration
          .slice(colon + 1)
          .trim();
      }
    }

    return declarations;
  };

  it("scrolls the heading to where its own anchor does: at its top, under the header", () => {
    const heading: Record<string, string> = cssRule(
      ".docs-content .docs-heading",
    );
    const mark: Record<string, string> = cssRule(
      ".docs-content .docs-heading__alias",
    );

    expect(heading["position"]).toBe("relative");
    expect(mark["position"]).toBe("absolute");
    expect(mark["top"]).toBe("0");
    expect(mark["scroll-margin-top"]).toBe(heading["scroll-margin-top"]);
    expect(mark["width"]).toBe("0");
    expect(mark["height"]).toBe("0");
  });

  it("is one reader: docs:localize-anchors and the docs site read a page's headings with MarkdownHeadings", () => {
    const script: string = fs.readFileSync(
      path.join(REPOSITORY, "Scripts", "Docs", "LocalizeAnchors.ts"),
      "utf8",
    );
    const aliases: string = fs.readFileSync(
      path.join(DOCS_DIR, "Utils", "AnchorAliases.ts"),
      "utf8",
    );

    expect(script).toContain(
      'from "../../packages/Common/Server/Types/MarkdownHeadings";',
    );
    expect(script).toContain("readMarkdownHeadings");
    expect(script).not.toContain("const HEADING: RegExp");
    expect(aliases).toContain('from "Common/Server/Types/MarkdownHeadings";');
    expect(aliases).not.toContain("const HEADING: RegExp");
  });
});
