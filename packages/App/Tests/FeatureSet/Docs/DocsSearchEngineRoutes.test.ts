import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  isSupportedDocsLanguage,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { getDocsPagePaths } from "../../../FeatureSet/Docs/Utils/Sitemap";
import DocsTranslations from "../../../FeatureSet/Docs/Utils/Translations";
import { MAX_SITEMAP_URLS } from "Common/Server/Utils/Sitemap";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  parsePage,
} from "Common/Tests/RenderedMarkup";
import { seededRandom, shuffled } from "Common/Tests/Helpers/SeededRandom";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import { readPage } from "./DocsContentSupport";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * What search engines are sent to, on the real docs, through the docs' real
 * routes and templates (only infrastructure outside docs is replaced):
 *
 *   - an old address without a language redirects permanently, in one hop,
 *     to the English page - the address a search engine should keep - not
 *     temporarily to the browser's language;
 *   - the retired OneUptime Copilot section and /docs/<lang>/monitor/monitor,
 *     which search engines still ask for, redirect to their successors;
 *   - the page as Markdown is never indexed;
 *   - the docs' sitemap lists every page in English, and only addresses the
 *     docs serve as their own canonical page.
 *
 * DocsCanonicalPages proves the canonical and alternate links on pages
 * written for it; this holds the real docs to the same rules.
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

const ORIGIN: string = "https://oneuptime.com";

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

type FetchManualFunction = (
  pathname: string,
  headers?: Record<string, string>,
) => Promise<Response>;

const fetchManual: FetchManualFunction = async (
  pathname: string,
  headers: Record<string, string> = {},
): Promise<Response> => {
  return await fetch(`${origin}${pathname}`, {
    redirect: "manual",
    headers: headers,
  });
};

// Where an address redirects to, and with what status.
type RedirectOfFunction = (
  pathname: string,
  headers?: Record<string, string>,
) => Promise<{ status: number; location: string | null }>;

const redirectOf: RedirectOfFunction = async (
  pathname: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; location: string | null }> => {
  const response: Response = await fetchManual(pathname, headers);
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
};

// The canonical links of a served page.
const canonicalsOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const page: RenderedPage = parsePage(html);
  return page.elements
    .filter((element: RenderedElement): boolean => {
      return (
        element.tagName === "link" &&
        attributeOf(element, "rel") === "canonical"
      );
    })
    .map((element: RenderedElement): string => {
      return attributeOf(element, "href") || "";
    });
};

const DOCS_PAGES: Array<string> = getDocsPagePaths();

describe("an old docs address without a language", () => {
  it("redirects permanently to the English page for every page in the nav", async () => {
    const wrong: Array<string> = [];

    for (const page of DOCS_PAGES) {
      const redirect: { status: number; location: string | null } =
        await redirectOf(`/docs/${page}`);

      if (redirect.status !== 301 || redirect.location !== `/docs/en/${page}`) {
        wrong.push(`/docs/${page} -> ${redirect.status} ${redirect.location}`);
      }
    }

    expect(DOCS_PAGES.length).toBeGreaterThan(200);
    expect(wrong).toEqual([]);
  }, 300000);

  it("sends the addresses with the most search clicks to their English pages, whatever the browser's language", async () => {
    for (const page of [
      "terraform/self-hosted",
      "installation/docker-compose",
    ]) {
      for (const acceptLanguage of ["de-DE,de;q=0.9", "fr", "ja", "en-US"]) {
        expect(
          await redirectOf(`/docs/${page}`, {
            "Accept-Language": acceptLanguage,
          }),
        ).toEqual({ status: 301, location: `/docs/en/${page}` });
      }

      const landing: Response = await fetchManual(`/docs/en/${page}`);

      expect(landing.status).toBe(200);
      expect(canonicalsOf(await landing.text())).toEqual([
        `${ORIGIN}/docs/en/${page}`,
      ]);
    }
  }, 300000);

  it("keeps the query string and lands in lower case", async () => {
    expect(
      await redirectOf(
        "/docs/Installation/Docker-Compose?utm_source=github&utm_medium=readme",
      ),
    ).toEqual({
      status: 301,
      location:
        "/docs/en/installation/docker-compose?utm_source=github&utm_medium=readme",
    });
  });

  it("lands on a page in one hop, for a page that moved too", async () => {
    for (const [oldPath, newPath] of [
      ["/docs/ai/sentinel", "/docs/en/ai/ai-sre"],
      ["/docs/monitor/snmp-monitor", "/docs/en/monitor/network-device-monitor"],
      ["/docs/telemetry/real-user-monitoring", "/docs/en/rum/index"],
      ["/docs/incidents/forms", "/docs/en/forms/index"],
      [
        "/docs/self-hosted/integration-network-access",
        "/docs/en/integrations/index",
      ],
    ] as Array<[string, string]>) {
      expect({ oldPath, ...(await redirectOf(oldPath)) }).toEqual({
        oldPath,
        status: 301,
        location: newPath,
      });

      expect({ newPath, status: (await fetchManual(newPath)).status }).toEqual({
        newPath,
        status: 200,
      });
    }
  }, 300000);

  it("does not take a file or an endpoint for an old page", async () => {
    for (const pathname of [
      "/docs/static/favicon.ico",
      "/docs/as-markdown/getting-started",
      "/docs/search-index/en",
    ]) {
      const redirect: { status: number; location: string | null } =
        await redirectOf(pathname);

      expect({ pathname, location: redirect.location || "" }).not.toEqual({
        pathname,
        location: expect.stringMatching(/^\/docs\/en\//),
      });
    }
  });

  it("the docs root still sends a reader to their language, and says it depends on it", async () => {
    const response: Response = await fetchManual("/docs", {
      "Accept-Language": "de-DE,de;q=0.9",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/docs/de/introduction/getting-started",
    );
    expect(response.headers.get("vary")).toContain("Accept-Language");
  });
});

describe("the retired OneUptime Copilot section", () => {
  const OLD_PAGES: Array<string> = [
    "",
    "/introduction",
    "/deploy-llm-server",
    "/introduction/",
  ];

  it("redirects permanently to the AI Agent's page, without a language", async () => {
    for (const page of OLD_PAGES) {
      expect({ page, ...(await redirectOf(`/docs/copilot${page}`)) }).toEqual({
        page,
        status: 301,
        location: "/docs/en/ai/ai-agent",
      });
    }
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "redirects permanently to the AI Agent's page in %s",
    async (lang: string) => {
      for (const page of OLD_PAGES) {
        expect({
          page,
          ...(await redirectOf(`/docs/${lang}/copilot${page}`)),
        }).toEqual({
          page,
          status: 301,
          location: `/docs/${lang}/ai/ai-agent`,
        });
      }
    },
  );

  it("redirects its Markdown to the AI Agent's Markdown", async () => {
    expect(
      await redirectOf("/docs/as-markdown/en/copilot/introduction"),
    ).toEqual({ status: 301, location: "/docs/as-markdown/en/ai/ai-agent" });
    expect(await redirectOf("/docs/as-markdown/copilot/introduction")).toEqual({
      status: 301,
      location: "/docs/as-markdown/ai/ai-agent",
    });
  });

  it("lands on the AI Agent's page", async () => {
    const response: Response = await fetch(
      `${origin}/docs/copilot/introduction`,
    );

    expect(response.status).toBe(200);
    expect(response.url).toBe(`${origin}/docs/en/ai/ai-agent`);
    expect(canonicalsOf(await response.text())).toEqual([
      `${ORIGIN}/docs/en/ai/ai-agent`,
    ]);
    expect(DOCS_PAGES).toContain("ai/ai-agent");
  });

  it("does not redirect a language the docs do not have to a page that does not exist", async () => {
    const redirect: { status: number; location: string | null } =
      await redirectOf("/docs/xx/copilot/introduction");

    expect(redirect.location || "").not.toContain("/docs/xx/ai/ai-agent");
  });
});

describe("/docs/<lang>/monitor/monitor", () => {
  it("is not a page, and Getting Started links to Creating a Monitor as the monitors overview", () => {
    expect(DOCS_PAGES).not.toContain("monitor/monitor");
    expect(DOCS_PAGES).toContain("monitor/create-monitor");
    expect(readPage("en", "introduction/getting-started")).toContain(
      "](/docs/monitor/create-monitor)",
    );
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "redirects permanently to Creating a Monitor in %s",
    async (lang: string) => {
      expect(await redirectOf(`/docs/${lang}/monitor/monitor`)).toEqual({
        status: 301,
        location: `/docs/${lang}/monitor/create-monitor`,
      });
      expect(
        await redirectOf(`/docs/as-markdown/${lang}/monitor/monitor`),
      ).toEqual({
        status: 301,
        location: `/docs/as-markdown/${lang}/monitor/create-monitor`,
      });
    },
  );

  it("redirects to the English page without a language, and lands on it", async () => {
    expect(await redirectOf("/docs/monitor/monitor")).toEqual({
      status: 301,
      location: "/docs/en/monitor/create-monitor",
    });
    expect(await redirectOf("/docs/as-markdown/monitor/monitor")).toEqual({
      status: 301,
      location: "/docs/as-markdown/monitor/create-monitor",
    });

    const response: Response = await fetch(`${origin}/docs/en/monitor/monitor`);

    expect(response.status).toBe(200);
    expect(response.url).toBe(`${origin}/docs/en/monitor/create-monitor`);
  });

  it("does not redirect a language the docs do not have", async () => {
    expect(isSupportedDocsLanguage("xx")).toBe(false);
    expect(
      (await redirectOf("/docs/xx/monitor/monitor")).location || "",
    ).not.toContain("/docs/xx/monitor/create-monitor");
  });
});

describe("the page as Markdown", () => {
  it.each([
    ["a page", "/docs/as-markdown/en/installation/docker-compose", 200],
    [
      "a translated page",
      "/docs/as-markdown/de/installation/docker-compose",
      200,
    ],
    [
      "a page without a language",
      "/docs/as-markdown/installation/docker-compose",
      200,
    ],
    ["a page that is not there", "/docs/as-markdown/en/nope/nope", 404],
    ["a redirect", "/docs/as-markdown/zh/installation/docker-compose", 301],
    ["a moved page", "/docs/as-markdown/en/monitor/monitor", 301],
  ])(
    "is never indexed: %s",
    async (_what: string, pathname: string, status: number) => {
      const response: Response = await fetchManual(pathname);

      expect(response.status).toBe(status);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    },
  );

  it("is linked from its page without asking search engines to follow it", async () => {
    const html: string = await (
      await fetchManual("/docs/en/installation/docker-compose")
    ).text();
    const links: Array<RenderedElement> = parsePage(html).elements.filter(
      (element: RenderedElement): boolean => {
        return (
          element.tagName === "a" &&
          attributeOf(element, "href") ===
            "/docs/as-markdown/en/installation/docker-compose"
        );
      },
    );

    expect(links).toHaveLength(1);
    expect((attributeOf(links[0]!, "rel") || "").split(" ")).toEqual(
      expect.arrayContaining(["nofollow", "noopener"]),
    );
  });

  it("leaves the page itself to be indexed", async () => {
    const response: Response = await fetchManual(
      "/docs/en/installation/docker-compose",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("the docs' sitemap, on the real docs", () => {
  let locations: Array<string> = [];
  let xml: string = "";

  beforeAll(async () => {
    const response: Response = await fetchManual("/docs/sitemap.xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );

    xml = await response.text();
    locations = Array.from(
      xml.matchAll(/<loc>([^<]*)<\/loc>/g),
      (match: RegExpMatchArray): string => {
        return match[1] || "";
      },
    );
  }, 900000);

  it("lists every page in the nav in English", () => {
    const missing: Array<string> = DOCS_PAGES.filter(
      (page: string): boolean => {
        return !locations.includes(`${ORIGIN}/docs/en/${page}`);
      },
    );

    expect(missing).toEqual([]);
  }, 300000);

  it("lists a page in each language it is written in, and in no other", async () => {
    const expected: Array<string> = [];

    for (const page of DOCS_PAGES) {
      for (const lang of await DocsTranslations.getLanguages(page)) {
        expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(lang);
        expected.push(`${ORIGIN}/docs/${lang}/${page}`);
      }
    }

    expect(locations).toEqual(expected);
  }, 600000);

  it("lists each address once, and never one without a language, which redirects", () => {
    expect(new Set(locations).size).toBe(locations.length);

    for (const location of locations) {
      const address: URL = new URL(location);
      const segments: Array<string> = address.pathname.split("/");

      expect({ location, origin: address.origin }).toEqual({
        location,
        origin: ORIGIN,
      });
      // "", "docs", the language, the category, the page.
      expect({ location, segments: segments.length }).toEqual({
        location,
        segments: 5,
      });
      expect({
        location,
        language: isSupportedDocsLanguage(segments[2] || ""),
      }).toEqual({ location, language: true });
    }
  }, 300000);

  it("stays within the protocol's limit, and gives no made-up date", () => {
    expect(locations.length).toBeGreaterThan(DOCS_PAGES.length);
    expect(locations.length).toBeLessThanOrEqual(MAX_SITEMAP_URLS);
    expect(xml).not.toContain("<lastmod>");
  });

  it("lists addresses that are served, without a redirect, as their own canonical page", async () => {
    // A sample across languages and sections, the same one on every run.
    const sample: Array<string> = shuffled(
      locations,
      seededRandom(20261013),
    ).slice(0, 16);

    for (const location of sample) {
      const response: Response = await fetchManual(new URL(location).pathname);

      expect({ location, status: response.status }).toEqual({
        location,
        status: 200,
      });
      expect({
        location,
        canonicals: canonicalsOf(await response.text()),
      }).toEqual({ location, canonicals: [location] });
    }
  }, 600000);
});
