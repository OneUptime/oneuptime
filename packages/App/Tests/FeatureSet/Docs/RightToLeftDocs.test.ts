import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { ContentPath } from "../../../FeatureSet/Docs/Utils/Config";
import {
  DocsLanguage,
  SUPPORTED_DOCS_LANGUAGES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  only,
  parsePage,
  textOf,
} from "Common/Tests/RenderedMarkup";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * Persian docs pages are served right to left.
 *
 * Farsi pages were served with lang="fa" and no dir, so the browser laid the
 * Persian out left to right: every paragraph flush left, its full stop on the
 * wrong end, the menu and the table columns in the wrong order. These run the
 * docs' real routes and templates, without booting the database-backed
 * application - only infrastructure outside docs is replaced - and read the
 * direction off the page a reader is sent.
 */

/*
 * Copies a test pretends are not on disk: an untranslated page, whatever the
 * translation state of the real one.
 */
const mockMissingFiles: Set<string> = new Set<string>();

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
        return !mockMissingFiles.has(file) && fs.existsSync(file);
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

// Translated into Persian, with a code block and inline code in its prose.
const PAGE: string = "self-hosted/private-network-access";

// Any letter of the Arabic script, which Persian is written in.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

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

afterEach(() => {
  mockMissingFiles.clear();
});

interface ServedPage {
  status: number;
  page: RenderedPage;
}

type FetchPageFunction = (pathname: string) => Promise<ServedPage>;

const fetchPage: FetchPageFunction = async (
  pathname: string,
): Promise<ServedPage> => {
  const response: Response = await fetch(`${origin}${pathname}`);
  return {
    status: response.status,
    page: parsePage(await response.text()),
  };
};

const htmlOf: (page: RenderedPage) => RenderedElement = (
  page: RenderedPage,
): RenderedElement => {
  return only(page, (element: RenderedElement): boolean => {
    return element.tagName === "html";
  });
};

// The article: the rendered Markdown, under the page's title.
const articleOf: (page: RenderedPage) => RenderedElement = (
  page: RenderedPage,
): RenderedElement => {
  return only(page, (element: RenderedElement): boolean => {
    return attributeOf(element, "class") === "docs-content";
  });
};

// Every language but the two the regression is about.
const OTHER_LANGUAGES: Array<DocsLanguage> = SUPPORTED_DOCS_LANGUAGES.filter(
  (language: DocsLanguage): boolean => {
    return language.code !== "fa" && language.code !== "en";
  },
);

describe("docs languages", () => {
  it("name Persian, and only Persian, as written right to left", () => {
    const rightToLeft: Array<string> = SUPPORTED_DOCS_LANGUAGES.filter(
      (language: DocsLanguage): boolean => {
        return language.direction === "rtl";
      },
    ).map((language: DocsLanguage): string => {
      return language.code;
    });

    expect(rightToLeft).toEqual(["fa"]);
  });

  it("lay out a code that is not a docs language left to right, like the English it falls back to", () => {
    expect(getDocsLanguageDirection("fa")).toBe("rtl");
    expect(getDocsLanguageDirection("en")).toBe("ltr");
    expect(getDocsLanguageDirection("zz")).toBe("ltr");
  });
});

describe("a served docs page", () => {
  it("is right to left in Persian, and its article with it", async () => {
    const served: ServedPage = await fetchPage(`/docs/fa/${PAGE}`);

    expect(served.status).toBe(200);
    expect(attributeOf(htmlOf(served.page), "lang")).toBe("fa");
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("rtl");

    // The article is the Persian copy and takes the page's direction.
    const article: RenderedElement = articleOf(served.page);

    expect(textOf(served.page, article)).toMatch(PERSIAN_LETTER);
    expect(attributeOf(article, "dir")).toBeNull();
    expect(attributeOf(article, "lang")).toBeNull();
  });

  it("is not right to left in English", async () => {
    const served: ServedPage = await fetchPage(`/docs/en/${PAGE}`);

    expect(served.status).toBe(200);
    expect(attributeOf(htmlOf(served.page), "lang")).toBe("en");
    expect(attributeOf(htmlOf(served.page), "dir")).not.toBe("rtl");
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("ltr");
  });

  it.each(OTHER_LANGUAGES)(
    "is left to right in $englishName",
    async (language: DocsLanguage) => {
      const served: ServedPage = await fetchPage(
        `/docs/${language.code}/${PAGE}`,
      );

      expect(served.status).toBe(200);
      expect(attributeOf(htmlOf(served.page), "lang")).toBe(language.code);
      expect(attributeOf(htmlOf(served.page), "dir")).toBe("ltr");
    },
  );

  it("keeps an untranslated page's English copy left to right inside the Persian page", async () => {
    /*
     * A page with no Persian translation is served with the English copy
     * under the Persian menu. Laid out right to left, its sentences would
     * end in a full stop on the wrong side and "1. Is the token valid?"
     * would be drawn "?Is the token valid .1".
     */
    mockMissingFiles.add(`${ContentPath}/fa/${PAGE}.md`);

    const served: ServedPage = await fetchPage(`/docs/fa/${PAGE}`);

    expect(served.status).toBe(200);
    expect(attributeOf(htmlOf(served.page), "lang")).toBe("fa");
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("rtl");

    const article: RenderedElement = articleOf(served.page);

    expect(textOf(served.page, article)).not.toMatch(PERSIAN_LETTER);
    expect(attributeOf(article, "lang")).toBe("en");
    expect(attributeOf(article, "dir")).toBe("ltr");
  });

  it("is right to left in Persian when it is not found, and left to right in English", async () => {
    const persian: ServedPage = await fetchPage("/docs/fa/no-such/page");
    const english: ServedPage = await fetchPage("/docs/en/no-such/page");

    expect(persian.status).toBe(404);
    expect(attributeOf(htmlOf(persian.page), "dir")).toBe("rtl");
    expect(english.status).toBe(404);
    expect(attributeOf(htmlOf(english.page), "dir")).toBe("ltr");
  });
});
