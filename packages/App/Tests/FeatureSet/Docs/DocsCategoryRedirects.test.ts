import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
  isSupportedDocsLanguage,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  NOT_PAGE_CATEGORIES,
  getDocsCategoryFirstPage,
  getDocsCategoryTarget,
} from "../../../FeatureSet/Docs/Utils/Redirects";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  parsePage,
  textOf,
} from "Common/Tests/RenderedMarkup";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import { NAV_PAGES } from "./DocsContentSupport";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * A category's own address - /docs/terraform, /docs/de/terraform - is not
 * a page, but the website linked eight of them (/docs/compliance,
 * /docs/terraform, /docs/rbac, ...), and old emails, search results and
 * people typing an address ask for them too. The docs answered each with a
 * bare 404. Now a category of the nav opens its first page in the nav (its
 * overview wherever it has one): without a language, permanently, in
 * English, like every address without a language; with one, in that
 * language. Any other name is the docs' own 404 page, with the sidebar and
 * the search box, in the language the address names.
 *
 * The routes and templates are the docs' real ones; only infrastructure
 * outside the docs is replaced.
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
        _req: ExpressRequest,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
      sendTextResponse: (
        _req: ExpressRequest,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.status(200).send(content);
      },
    },
  };
});
jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: async (): Promise<{ toString: () => string }> => {
        return {
          toString: (): string => {
            return "https://oneuptime.com/";
          },
        };
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
    Host: "oneuptime.com",
    HttpProtocol: "https://",
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

interface Answer {
  status: number;
  location: string | null;
}

// What the docs answer an address with, without following a redirect.
const answerOf: (pathname: string) => Promise<Answer> = async (
  pathname: string,
): Promise<Answer> => {
  const response: Response = await fetch(`${origin}${pathname}`, {
    redirect: "manual",
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
};

const pageAt: (pathname: string) => Promise<Response> = async (
  pathname: string,
): Promise<Response> => {
  return await fetch(`${origin}${pathname}`, { redirect: "manual" });
};

// The categories of the nav, in the order their first pages are listed.
const NAV_CATEGORIES: Array<string> = [
  ...new Set(
    NAV_PAGES.map((page: string): string => {
      return page.split("/")[0]!;
    }),
  ),
];

// A category's first page in the nav, read straight off the nav's pages.
const firstNavPageOf: (category: string) => string = (
  category: string,
): string => {
  return NAV_PAGES.find((page: string): boolean => {
    return page.split("/")[0] === category;
  })!;
};

/*
 * The addresses the website linked that the docs answered with a 404, and
 * the page each now opens (or null: no such category).
 */
const WEBSITE_CATEGORY_ADDRESSES: Array<[string, string | null]> = [
  ["compliance", null],
  ["integrations", "integrations/index"],
  ["terraform", "terraform/index"],
  ["rbac", null],
  ["api", null],
  ["incidents", "incidents/index"],
  ["cli", "cli/index"],
];

// Names that are no category of the nav.
const NOT_CATEGORIES: Array<string> = [
  "compliance",
  "rbac",
  "api",
  "nope",
  "terraform-provider",
  "incident",
];

describe("getDocsCategoryFirstPage", () => {
  const link: (url: string) => { title: string; url: string } = (
    url: string,
  ): { title: string; url: string } => {
    return { title: url, url: url };
  };

  const NAV: Array<NavGroup> = [
    {
      title: "First group",
      section: "Get Started",
      links: [
        link("https://example.com/docs/elsewhere/page"),
        link("/docs/alpha"),
        link("/docs/alpha/one/deeper"),
        link("/docs/alpha/one"),
        link("/docs/beta/index"),
      ],
    },
    {
      title: "Second group",
      section: "Monitoring",
      links: [
        link("/docs/alpha/two"),
        link("/docs/gamma/overview"),
        link("/docs/beta/two"),
        link("/docs/Delta/Mixed-Case"),
      ],
    },
  ];

  it("is the category's first page in the nav, whichever group lists it", () => {
    expect(getDocsCategoryFirstPage("alpha", NAV)).toBe("alpha/one");
    expect(getDocsCategoryFirstPage("beta", NAV)).toBe("beta/index");
    expect(getDocsCategoryFirstPage("gamma", NAV)).toBe("gamma/overview");
  });

  it("reads only links to a docs page: not another site, a category or anything deeper", () => {
    expect(getDocsCategoryFirstPage("elsewhere", NAV)).toBeNull();
    // /docs/alpha and /docs/alpha/one/deeper come first, and are passed over.
    expect(getDocsCategoryFirstPage("alpha", NAV)).toBe("alpha/one");
  });

  it("matches a name in any case, and answers in lower case as the docs serve pages", () => {
    expect(getDocsCategoryFirstPage("ALPHA", NAV)).toBe("alpha/one");
    expect(getDocsCategoryFirstPage("Beta", NAV)).toBe("beta/index");
    expect(getDocsCategoryFirstPage("delta", NAV)).toBe("delta/mixed-case");
  });

  it("is null for a name the nav has no category of", () => {
    for (const name of [
      "",
      "omega",
      "alpha/one",
      "one",
      "..",
      ".",
      "en",
      ...NOT_PAGE_CATEGORIES,
    ]) {
      expect({ name, page: getDocsCategoryFirstPage(name, NAV) }).toEqual({
        name,
        page: null,
      });
    }
  });

  it("reads the docs' own nav when given none: every category opens its first page", () => {
    expect(NAV_CATEGORIES.length).toBeGreaterThan(20);

    for (const category of NAV_CATEGORIES) {
      expect({ category, page: getDocsCategoryFirstPage(category) }).toEqual({
        category,
        page: firstNavPageOf(category),
      });
    }
  });

  it("opens the categories the website and the docs point people at where their pages start", () => {
    for (const [category, page] of [
      ["introduction", "introduction/getting-started"],
      ["monitor", "monitor/create-monitor"],
      ["incidents", "incidents/index"],
      ["status-pages", "status-pages/index"],
      ["telemetry", "telemetry/open-telemetry"],
      ["rum", "rum/index"],
      ["integrations", "integrations/index"],
      ["api-reference", "api-reference/api-reference"],
      ["cli", "cli/index"],
      ["terraform", "terraform/index"],
      ["permissions", "permissions/index"],
    ] as Array<[string, string]>) {
      expect({ category, page: getDocsCategoryFirstPage(category) }).toEqual({
        category,
        page,
      });
    }
  });

  it("opens a category's overview: a category with an index page lists it first", () => {
    const overviewNotFirst: Array<string> = NAV_CATEGORIES.filter(
      (category: string): boolean => {
        return (
          NAV_PAGES.includes(`${category}/index`) &&
          getDocsCategoryFirstPage(category) !== `${category}/index`
        );
      },
    );

    expect(
      NAV_CATEGORIES.filter((category: string): boolean => {
        return NAV_PAGES.includes(`${category}/index`);
      }).length,
    ).toBeGreaterThan(10);
    expect(overviewNotFirst).toEqual([]);
  });

  it("has no category named like a language, a file or an endpoint of the docs", () => {
    for (const category of NAV_CATEGORIES) {
      expect({ category, language: isSupportedDocsLanguage(category) }).toEqual(
        { category, language: false },
      );
      expect(NOT_PAGE_CATEGORIES).not.toContain(category);
      expect(category).not.toContain(".");
    }
  });
});

describe("getDocsCategoryTarget", () => {
  it("is the category's first page in the language it is given", () => {
    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect(getDocsCategoryTarget("terraform", lang)).toBe(
        `/docs/${lang}/terraform/index`,
      );
    }
    expect(getDocsCategoryTarget("Monitor", "en")).toBe(
      "/docs/en/monitor/create-monitor",
    );
  });

  it("is null for a name that is no category", () => {
    for (const name of NOT_CATEGORIES) {
      expect(getDocsCategoryTarget(name, "en")).toBeNull();
    }
  });
});

describe("a category's own address, through the docs' routes", () => {
  it("opens the English copy of the category's first page, permanently, for every category", async () => {
    const wrong: Array<string> = [];

    for (const category of NAV_CATEGORIES) {
      const target: string = `/docs/en/${firstNavPageOf(category)}`;
      const answer: Answer = await answerOf(`/docs/${category}`);

      if (answer.status !== 301 || answer.location !== target) {
        wrong.push(
          `/docs/${category} -> ${answer.status} ${answer.location} (expected 301 ${target})`,
        );
        continue;
      }

      const landing: Answer = await answerOf(target);

      if (landing.status !== 200) {
        wrong.push(`/docs/${category} -> ${target} -> ${landing.status}`);
      }
    }

    expect(wrong).toEqual([]);
  }, 300000);

  it("opens that language's copy, permanently, under every language", async () => {
    const wrong: Array<string> = [];

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const category of NAV_CATEGORIES) {
        const target: string = `/docs/${lang}/${firstNavPageOf(category)}`;
        const answer: Answer = await answerOf(`/docs/${lang}/${category}`);

        if (answer.status !== 301 || answer.location !== target) {
          wrong.push(
            `/docs/${lang}/${category} -> ${answer.status} ${answer.location} (expected 301 ${target})`,
          );
        }
      }
    }

    expect(SUPPORTED_DOCS_LANGUAGE_CODES.length).toBe(17);
    expect(wrong).toEqual([]);
  }, 300000);

  it("lands on a page in the language the address names, right to left in Persian", async () => {
    for (const [address, landingPath, lang] of [
      ["/docs/de/terraform", "/docs/de/terraform/index", "de"],
      ["/docs/fa/incidents", "/docs/fa/incidents/index", "fa"],
      ["/docs/zh-CN/cli", "/docs/zh-CN/cli/index", "zh-CN"],
      ["/docs/ja/integrations", "/docs/ja/integrations/index", "ja"],
    ] as Array<[string, string, string]>) {
      expect({ address, ...(await answerOf(address)) }).toEqual({
        address,
        status: 301,
        location: landingPath,
      });

      const landing: Response = await pageAt(landingPath);
      const html: RenderedPage = parsePage(await landing.text());
      const root: RenderedElement = html.elements.find(
        (element: RenderedElement): boolean => {
          return element.tagName === "html";
        },
      )!;

      expect({ landingPath, status: landing.status }).toEqual({
        landingPath,
        status: 200,
      });
      expect([attributeOf(root, "lang"), attributeOf(root, "dir")]).toEqual([
        lang,
        getDocsLanguageDirection(lang),
      ]);
    }
  }, 120000);

  it("keeps the query it came with, matches the name in any case and takes a trailing slash", async () => {
    for (const [address, location] of [
      [
        "/docs/terraform?utm_source=website&utm_medium=card",
        "/docs/en/terraform/index?utm_source=website&utm_medium=card",
      ],
      ["/docs/Terraform", "/docs/en/terraform/index"],
      ["/docs/INCIDENTS/", "/docs/en/incidents/index"],
      ["/docs/de/Terraform?ref=mail", "/docs/de/terraform/index?ref=mail"],
      ["/docs/fr/incidents/", "/docs/fr/incidents/index"],
    ] as Array<[string, string]>) {
      expect({ address, ...(await answerOf(address)) }).toEqual({
        address,
        status: 301,
        location,
      });
    }
  });

  it("answers the addresses the website linked with a page, or a 404 when there is no such category", async () => {
    for (const [category, page] of WEBSITE_CATEGORY_ADDRESSES) {
      const answer: Answer = await answerOf(`/docs/${category}`);

      expect({ category, ...answer }).toEqual(
        page === null
          ? { category, status: 404, location: null }
          : { category, status: 301, location: `/docs/en/${page}` },
      );
    }
  });
});

describe("a name that is no category", () => {
  // The docs' 404 page: its language and direction, title and sidebar.
  interface NotFoundPage {
    status: number;
    location: string | null;
    lang: string | null;
    dir: string | null;
    title: string;
    linksToGettingStarted: boolean;
  }

  const notFoundPageOf: (pathname: string) => Promise<NotFoundPage> = async (
    pathname: string,
  ): Promise<NotFoundPage> => {
    const response: Response = await pageAt(pathname);
    const html: RenderedPage = parsePage(await response.text());
    const root: RenderedElement | undefined = html.elements.find(
      (element: RenderedElement): boolean => {
        return element.tagName === "html";
      },
    );
    const heading: RenderedElement | undefined = html.elements.find(
      (element: RenderedElement): boolean => {
        return element.tagName === "h1";
      },
    );
    const lang: string | null = root ? attributeOf(root, "lang") : null;

    return {
      status: response.status,
      location: response.headers.get("location"),
      lang: lang,
      dir: root ? attributeOf(root, "dir") : null,
      title: heading ? textOf(html, heading).trim() : "",
      linksToGettingStarted: html.elements.some(
        (element: RenderedElement): boolean => {
          return (
            element.tagName === "a" &&
            attributeOf(element, "href") ===
              `/docs/${lang}/introduction/getting-started`
          );
        },
      ),
    };
  };

  it("is the docs' 404 page in English, with the sidebar, and no redirect", async () => {
    for (const name of NOT_CATEGORIES) {
      expect({ name, ...(await notFoundPageOf(`/docs/${name}`)) }).toEqual({
        name,
        status: 404,
        location: null,
        lang: DEFAULT_DOCS_LANGUAGE,
        dir: "ltr",
        title: makeT(DEFAULT_DOCS_LANGUAGE)("ui.notFoundTitle"),
        linksToGettingStarted: true,
      });
    }
  }, 120000);

  it("under a language, is the 404 page in that language, never an English page of that name", async () => {
    for (const lang of ["de", "fa", "zh-TW"]) {
      for (const name of ["compliance", "rbac"]) {
        expect({
          address: `/docs/${lang}/${name}`,
          ...(await notFoundPageOf(`/docs/${lang}/${name}`)),
        }).toEqual({
          address: `/docs/${lang}/${name}`,
          status: 404,
          location: null,
          lang: lang,
          dir: getDocsLanguageDirection(lang),
          title: makeT(lang)("ui.notFoundTitle"),
          linksToGettingStarted: true,
        });
      }
    }

    expect(makeT("de")("ui.notFoundTitle")).not.toBe(
      makeT("en")("ui.notFoundTitle"),
    );
  }, 120000);

  it("leaves the docs' other addresses of one name as they were", async () => {
    expect(await answerOf("/docs/de")).toEqual({
      status: 302,
      location: "/docs/de/introduction/getting-started",
    });
    expect(await answerOf("/docs/zh")).toEqual({
      status: 301,
      location: "/docs/zh-CN",
    });
    expect(await answerOf("/docs/copilot")).toEqual({
      status: 301,
      location: "/docs/en/ai/ai-agent",
    });

    const llms: Response = await pageAt("/docs/llms.txt");
    expect(llms.status).toBe(200);
    expect(await llms.text()).toContain("/docs/as-markdown/");

    const sitemap: Response = await pageAt("/docs/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(
      "/docs/en/introduction/getting-started</loc>",
    );

    expect((await answerOf("/docs/static/css/style.css")).status).toBe(200);
  });

  it("leaves an old page address, and a page under a language, as they were", async () => {
    expect(await answerOf("/docs/terraform/self-hosted")).toEqual({
      status: 301,
      location: "/docs/en/terraform/self-hosted",
    });
    expect(await answerOf("/docs/Cli/Index?x=1")).toEqual({
      status: 301,
      location: "/docs/en/cli/index?x=1",
    });
    expect((await answerOf("/docs/de/cli/index")).status).toBe(200);
    expect((await answerOf("/docs/de/nope/nope")).status).toBe(404);
    // Files and endpoints of the docs are still never taken for a page.
    for (const pathname of [
      "/docs/as-markdown/terraform",
      "/docs/static/nope",
    ]) {
      expect({ pathname, ...(await answerOf(pathname)) }).toEqual({
        pathname,
        status: 404,
        location: null,
      });
    }
  });
});
