import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { LocalizedNavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
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
 * The Incident Forms page (/docs/incidents/forms) became the Forms section
 * (/docs/forms/...). Bookmarks, links from other sites and search results
 * still point at the old page, in every shape it was reachable in: with and
 * without a language, as HTML and as Markdown. These run the docs' real
 * routes and templates, without booting the database-backed application -
 * only infrastructure outside docs is replaced - and follow each old address
 * to a page that renders.
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

// The overview's first words: the page is untranslated, so English everywhere.
const OVERVIEW_OPENING: string =
  "A form is a page that anyone with its link can fill in, without a OneUptime account.";

// The overview's title as the docs menu of a language shows it.
type OverviewTitleFunction = (lang: string) => string;

const overviewTitleIn: OverviewTitleFunction = (lang: string): string => {
  const group: LocalizedNavGroup | undefined = getLocalizedNav(lang).find(
    (item: LocalizedNavGroup): boolean => {
      return item.key === "Forms";
    },
  );

  expect(group).toBeDefined();

  return (group as LocalizedNavGroup).links[0]!.title;
};

type FetchManualFunction = (pathname: string) => Promise<Response>;

const fetchManual: FetchManualFunction = async (
  pathname: string,
): Promise<Response> => {
  return await fetch(`${origin}${pathname}`, { redirect: "manual" });
};

describe("the old Incident Forms page", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "redirects permanently to the Forms overview in %s, as HTML and as Markdown",
    async (lang: string) => {
      for (const prefix of ["/docs", "/docs/as-markdown"]) {
        const response: Response = await fetchManual(
          `${prefix}/${lang}/incidents/forms`,
        );
        const destination: string = `${prefix}/${lang}/forms/index`;

        expect(response.status).toBe(301);
        expect(response.headers.get("location")).toBe(destination);

        // The page it lands on is there, and is the Forms overview.
        const page: Response = await fetch(`${origin}${destination}`);

        expect(page.status).toBe(200);
        const content: string = await page.text();

        expect(content).toContain(OVERVIEW_OPENING);

        if (prefix === "/docs") {
          // Under the overview's title, in the language's own words.
          expect(content).toContain(overviewTitleIn(lang));
        } else {
          expect(content.startsWith("# Forms Overview")).toBe(true);
        }
      }
    },
  );

  it("redirects an address without a language too", async () => {
    const html: Response = await fetchManual("/docs/incidents/forms");

    expect(html.status).toBe(301);
    expect(html.headers.get("location")).toBe("/docs/forms/index");

    const markdown: Response = await fetchManual(
      "/docs/as-markdown/incidents/forms",
    );

    expect(markdown.status).toBe(301);
    expect(markdown.headers.get("location")).toBe(
      "/docs/as-markdown/forms/index",
    );
  });

  it("lands on a page that renders, following every hop", async () => {
    for (const pathname of [
      "/docs/incidents/forms",
      "/docs/as-markdown/incidents/forms",
    ]) {
      const response: Response = await fetch(`${origin}${pathname}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(OVERVIEW_OPENING);
    }
  });

  it("does not redirect an unsupported language to a page that does not exist", async () => {
    const response: Response = await fetchManual(
      "/docs/invalid/incidents/forms",
    );

    expect(response.headers.get("location") || "").not.toContain(
      "/docs/invalid/forms",
    );
  });
});

describe("the Forms pages", () => {
  const PAGES: Array<string> = [
    "index",
    "building",
    "on-submit",
    "sharing-and-security",
  ];

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "all render in %s, in English where they are not translated",
    async (lang: string) => {
      for (const page of PAGES) {
        const response: Response = await fetch(
          `${origin}/docs/${lang}/forms/${page}`,
        );

        expect([page, response.status]).toEqual([page, 200]);

        const html: string = await response.text();

        expect(html).toContain('id="docs-content"');
        // The section is in the menu the page is drawn with.
        expect(html).toContain(`/docs/${lang}/forms/index`);
      }
    },
  );

  it("serve as Markdown for tools and assistants", async () => {
    for (const page of PAGES) {
      const response: Response = await fetch(
        `${origin}/docs/as-markdown/en/forms/${page}`,
      );

      expect([page, response.status]).toEqual([page, 200]);
      expect((await response.text()).startsWith("# ")).toBe(true);
    }
  });
});
