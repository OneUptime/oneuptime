import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsPageSummary,
  DocsSearchEntry,
  stripInlineMarkdown,
  summarizeDocsPage,
} from "../../../FeatureSet/Docs/Utils/SearchIndex";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * Search across every page's sections, and the page route around it, run
 * through the docs' real routes and templates without booting the
 * database-backed application - only infrastructure outside docs is
 * replaced.
 *
 *   - /docs/search-index/<lang>.json lists every page in the nav, in that
 *     language, with its summary and its section headings, each with the
 *     anchor the rendered page gives it;
 *   - a page is found by its exact path, never by a link whose URL merely
 *     contains it;
 *   - a page carries its own description, keeps in-text links in the
 *     reader's language, and lists the sidebar in its sections.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual("fs") as typeof FileSystem;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendMarkdownResponse: (
        _req: unknown,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    GoogleTagManagerEnabled: false,
  };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/LlmsTxt", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

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

const ALL_LINKS: Array<{ group: NavGroup; link: NavLink }> = DocsNav.flatMap(
  (group: NavGroup): Array<{ group: NavGroup; link: NavLink }> => {
    return group.links.map((link: NavLink) => {
      return { group: group, link: link };
    });
  },
);

const getIndex: (lang: string) => Promise<Array<DocsSearchEntry>> = async (
  lang: string,
): Promise<Array<DocsSearchEntry>> => {
  const response: Response = await fetch(
    `${origin}/docs/search-index/${lang}.json`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Array<DocsSearchEntry>;
};

describe("summarizeDocsPage", () => {
  it("takes the first paragraph of prose as the description, without Markdown", () => {
    const summary: DocsPageSummary = summarizeDocsPage(
      [
        "# Title",
        "",
        "> [!NOTE]",
        "> Not this.",
        "",
        "A **website monitor** checks [your site](/docs/x/y) with `GET`",
        "requests from every probe.",
        "",
        "Not this either.",
      ].join("\n"),
    );

    expect(summary.description).toBe(
      "A website monitor checks your site with GET requests from every probe.",
    );
  });

  it("cuts a long description at a word, with an ellipsis", () => {
    const summary: DocsPageSummary = summarizeDocsPage(
      `# T\n\n${"word ".repeat(80)}`,
    );

    expect(summary.description.length).toBeLessThanOrEqual(180);
    expect(summary.description.endsWith("word…")).toBe(true);
  });

  it("lists h2 and h3 headings with the anchors the renderer gives them, outside code", () => {
    const summary: DocsPageSummary = summarizeDocsPage(
      [
        "# Title",
        "Intro.",
        "## Set up `probe-1`",
        "```bash",
        "## not a heading",
        "```",
        "### Überprüfen",
        "#### Too deep",
      ].join("\n"),
    );

    expect(summary.headings).toEqual([
      { level: 2, text: "Set up probe-1", anchor: "set-up-probe-1" },
      { level: 3, text: "Überprüfen", anchor: "überprüfen" },
    ]);
  });

  it("skips component syntax, lists and tables when looking for prose", () => {
    const summary: DocsPageSummary = summarizeDocsPage(
      [
        "# T",
        ":::cards",
        "- [A](/docs/a/b)",
        ":::",
        "| a | b |",
        "Prose.",
      ].join("\n"),
    );

    expect(summary.description).toBe("Prose.");
  });

  it("strips inline Markdown", () => {
    expect(
      stripInlineMarkdown(
        "**Bold**, _em_, `code`, [link](/x), ![img](/y.png) and <b>tags</b>",
      ),
    ).toBe("Bold, em, code, link, img and tags");
    expect(stripInlineMarkdown("snake_case_name stays")).toBe(
      "snake_case_name stays",
    );
  });
});

describe("the search index", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "lists every page of the nav in %s, in that language",
    async (lang: string) => {
      const index: Array<DocsSearchEntry> = await getIndex(lang);
      const t: ReturnType<typeof makeT> = makeT(lang);

      expect(index).toHaveLength(ALL_LINKS.length);

      index.forEach((entry: DocsSearchEntry, position: number): void => {
        const { group, link } = ALL_LINKS[position]!;

        expect(entry.t).toBe(t(`navLinks.${link.title}`));
        expect(entry.c).toBe(t(`navGroups.${group.title}`));
        expect(entry.u).toBe(
          link.url.startsWith("/docs/")
            ? link.url.replace("/docs/", `/docs/${lang}/`)
            : link.url,
        );
      });
    },
  );

  it("gives every docs page a summary and headings whose anchors the page has", async () => {
    const index: Array<DocsSearchEntry> = await getIndex("en");
    const sample: Array<DocsSearchEntry> = index.filter(
      (entry: DocsSearchEntry): boolean => {
        return [
          "/docs/en/monitor/website-monitor",
          "/docs/en/identity/sso",
          "/docs/en/incidents/index",
        ].includes(entry.u);
      },
    );

    expect(sample).toHaveLength(3);

    for (const entry of sample) {
      expect(entry.d.length).toBeGreaterThan(20);
      expect(entry.h.length).toBeGreaterThan(2);

      const html: string = await (await fetch(`${origin}${entry.u}`)).text();
      for (const heading of entry.h) {
        expect(html).toContain(`id="${heading.a}"`);
      }
    }
  });

  it("is cacheable, and refuses a language the docs do not have", async () => {
    const response: Response = await fetch(
      `${origin}/docs/search-index/en.json`,
    );

    expect(response.headers.get("cache-control")).toContain("max-age");
    expect(response.headers.get("content-type")).toContain("application/json");

    const unknown: Response = await fetch(
      `${origin}/docs/search-index/xx.json`,
    );
    expect(unknown.status).toBe(404);
  });
});

describe("a docs page", () => {
  it("is found by its exact path, among pages whose paths share words", async () => {
    for (const [url, title] of [
      ["/docs/en/monitor/kubernetes-agent", "Kubernetes Agent (Helm install)"],
      ["/docs/en/telemetry/kubernetes-agent", "Kubernetes Agent"],
      ["/docs/en/telemetry/databases", "Databases"],
      ["/docs/en/monitor/database-health-monitor", "Database Health Monitor"],
    ]) {
      const response: Response = await fetch(`${origin}${url}`);
      expect(response.status).toBe(200);
      const html: string = await response.text();
      expect(html).toContain(`<h1 class="docs-title">${title}</h1>`);
    }
  });

  it("is not found at a path that is only part of a page's path", async () => {
    const response: Response = await fetch(
      `${origin}/docs/en/telemetry/kubernetes`,
    );
    expect(response.status).toBe(404);
  });

  it("describes itself with its own first paragraph", async () => {
    const html: string = await (
      await fetch(`${origin}/docs/en/incidents/index`)
    ).text();
    const description: RegExpMatchArray | null = html.match(
      /<meta name="description" content="([^"]*)">/,
    );

    expect(description).not.toBeNull();
    expect(description![1]).not.toBe(makeT("en")("ui.metaDescription"));
    expect(description![1]!.length).toBeGreaterThan(40);
    expect(html).toContain(
      `<meta property="og:description" content="${description![1]}">`,
    );
  });

  it.each(["de", "ja", "fa"])(
    "keeps links in its text in %s",
    async (lang: string) => {
      const html: string = await (
        await fetch(`${origin}/docs/${lang}/incidents/index`)
      ).text();
      const article: string = html.slice(html.indexOf('id="docs-content"'));
      const unlocalized: Array<string> = Array.from(
        article.matchAll(/href="(\/docs\/[a-z0-9-]+\/[a-z0-9-]+[^"]*)"/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ).filter((href: string): boolean => {
        return !href.startsWith(`/docs/${lang}/`);
      });

      expect(unlocalized).toEqual([]);
    },
  );

  it("lists the sidebar in its sections", async () => {
    const html: string = await (
      await fetch(`${origin}/docs/en/monitor/website-monitor`)
    ).text();

    let position: number = -1;
    for (const section of DocsNavSections) {
      const at: number = html.indexOf(
        `class="docs-nav__section-title" id="sidebar-section-`,
        position + 1,
      );
      expect(at).toBeGreaterThan(position);
      expect(html.indexOf(section, at)).toBeGreaterThan(at);
      position = at;
    }
  });
});
