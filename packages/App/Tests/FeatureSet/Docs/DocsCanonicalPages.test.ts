import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { ContentPath } from "../../../FeatureSet/Docs/Utils/Config";
import DocsSitemap from "../../../FeatureSet/Docs/Utils/Sitemap";
import DocsTranslations, {
  UNTRANSLATED_PAGE_MARKER,
} from "../../../FeatureSet/Docs/Utils/Translations";
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
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * What a docs page tells search engines about its address, run through the
 * docs' real routes and templates on pages written here - so it holds
 * whatever the real docs translate next.
 *
 * Every page is served under every language's prefix. A page that is not
 * translated into a language - no copy there, or a copy that is still
 * English - names the English page as its canonical one and lists no
 * alternates; a page in a language it is written in is its own canonical
 * page and lists, as alternates, every language it is written in and English
 * as the default. The docs' sitemap lists exactly the canonical pages.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const nodeFs: typeof fs = jest.requireActual("fs") as typeof fs;
  const nodeOs: typeof os = jest.requireActual("os") as typeof os;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    // The pages this suite writes, in a folder of its own.
    ContentPath: nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), "oneuptime-docs-canonical-"),
    ),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Nav", () => {
  return {
    __esModule: true,
    DocsNavSections: ["Get Started"],
    default: [
      {
        title: "Guides",
        section: "Get Started",
        links: [
          { title: "Translated", url: "/docs/guide/translated" },
          { title: "English Copy", url: "/docs/guide/english-copy" },
          { title: "English Only", url: "/docs/guide/english-only" },
        ],
      },
      {
        title: "Elsewhere",
        section: "Get Started",
        links: [{ title: "Helm Chart", url: "https://artifacthub.io/x" }],
      },
    ],
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const nodeFs: typeof fs = jest.requireActual("fs") as typeof fs;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return nodeFs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return nodeFs.promises.readFile(file, "utf8");
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
    Host: "docs.example.com",
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

const ORIGIN: string = "https://docs.example.com";

// Lines of Markdown, as a page.
const md: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return `${lines.join("\n")}\n`;
};

const ENGLISH_GUIDE: Array<string> = [
  "This guide explains how a monitor checks your website from every probe.",
  "",
  "## Before you begin",
  "",
  "You need the Project Admin role, and a website that answers on the public internet.",
  "",
  "## Create the monitor",
  "",
  "Open **Monitors** and click **Create Monitor**, then choose the website type.",
  "",
  "```bash",
  "curl -sS https://status.example.com/health",
  "```",
  "",
  "The monitor runs every minute until you pause it from its settings page.",
];

const GERMAN_GUIDE: Array<string> = [
  "Diese Anleitung erklärt, wie ein Monitor Ihre Website von jeder Probe aus prüft.",
  "",
  "## Bevor Sie beginnen",
  "",
  "Sie brauchen die Rolle Projektadministrator und eine Website, die im Internet antwortet.",
  "",
  "## Den Monitor anlegen",
  "",
  "Öffnen Sie **Monitore** und klicken Sie auf **Monitor erstellen**, dann wählen Sie den Typ Website.",
  "",
  "```bash",
  "curl -sS https://status.example.com/health",
  "```",
  "",
  "Der Monitor läuft jede Minute, bis Sie ihn in seinen Einstellungen anhalten.",
];

const PERSIAN_GUIDE: Array<string> = [
  "این راهنما توضیح می‌دهد که یک مانیتور چگونه وب‌سایت شما را از هر پروب بررسی می‌کند.",
  "",
  "## پیش از شروع",
  "",
  "به نقش مدیر پروژه و وب‌سایتی نیاز دارید که در اینترنت عمومی پاسخ می‌دهد.",
  "",
  "## ساختن مانیتور",
  "",
  "**مانیتورها** را باز کنید و روی **ساختن مانیتور** بزنید، سپس نوع وب‌سایت را انتخاب کنید.",
  "",
  "```bash",
  "curl -sS https://status.example.com/health",
  "```",
  "",
  "مانیتور هر دقیقه اجرا می‌شود تا زمانی که آن را از صفحهٔ تنظیماتش متوقف کنید.",
];

/*
 * guide/translated: English, German and Persian, all translations.
 * guide/english-copy: translated into Persian only. The German copy says it is
 * still to be translated, the French one is the English page byte for byte,
 * and the Japanese one is English with one dashboard label translated - which
 * is what an English copy usually looks like.
 * guide/english-only: English alone.
 */
const PAGES: Record<string, Record<string, string>> = {
  en: {
    "guide/translated": md("# Translated", "", ...ENGLISH_GUIDE),
    "guide/english-copy": md("# English Copy", "", ...ENGLISH_GUIDE),
    "guide/english-only": md("# English Only", "", ...ENGLISH_GUIDE),
  },
  de: {
    "guide/translated": md("# Übersetzt", "", ...GERMAN_GUIDE),
    "guide/english-copy": md(
      "# English Copy",
      "",
      `<!-- ${UNTRANSLATED_PAGE_MARKER}: Translate this page. -->`,
      "",
      ...ENGLISH_GUIDE,
    ),
  },
  fr: {
    "guide/english-copy": md("# English Copy", "", ...ENGLISH_GUIDE),
  },
  ja: {
    "guide/english-copy": md(
      "# English Copy",
      "",
      ...ENGLISH_GUIDE.map((line: string): string => {
        return line.split("**Create Monitor**").join("**モニターを作成**");
      }),
    ),
  },
  fa: {
    "guide/translated": md("# ترجمه‌شده", "", ...PERSIAN_GUIDE),
    "guide/english-copy": md("# نسخهٔ انگلیسی", "", ...PERSIAN_GUIDE),
  },
};

let server: Server;
let origin: string;

beforeAll(async () => {
  for (const [lang, pages] of Object.entries(PAGES)) {
    for (const [page, markdown] of Object.entries(pages)) {
      const file: string = path.join(ContentPath, lang, `${page}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, markdown);
    }
  }

  DocsTranslations.clearCache();
  DocsSitemap.clearCache();

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
  fs.rmSync(ContentPath, { recursive: true, force: true });

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

interface SearchEngineTags {
  status: number;
  // Every canonical link's address: a page has exactly one.
  canonicals: Array<string>;
  // Every alternate's language and address, in the order the page lists them.
  alternates: Array<[string, string]>;
}

type FetchTagsFunction = (pathname: string) => Promise<SearchEngineTags>;

const fetchTags: FetchTagsFunction = async (
  pathname: string,
): Promise<SearchEngineTags> => {
  const response: Response = await fetch(`${origin}${pathname}`, {
    redirect: "manual",
  });
  const page: RenderedPage = parsePage(await response.text());
  const links: Array<RenderedElement> = page.elements.filter(
    (element: RenderedElement): boolean => {
      return element.tagName === "link";
    },
  );

  return {
    status: response.status,
    canonicals: links
      .filter((link: RenderedElement): boolean => {
        return attributeOf(link, "rel") === "canonical";
      })
      .map((link: RenderedElement): string => {
        return attributeOf(link, "href") || "";
      }),
    alternates: links
      .filter((link: RenderedElement): boolean => {
        return (
          attributeOf(link, "rel") === "alternate" &&
          attributeOf(link, "hreflang") !== null
        );
      })
      .map((link: RenderedElement): [string, string] => {
        return [
          attributeOf(link, "hreflang") || "",
          attributeOf(link, "href") || "",
        ];
      }),
  };
};

// A page's full address in a language.
const pageUrl: (lang: string, page: string) => string = (
  lang: string,
  page: string,
): string => {
  return `${ORIGIN}/docs/${lang}/${page}`;
};

describe("a page in a language it is written in", () => {
  it("is its own canonical page, in English", async () => {
    expect(await fetchTags("/docs/en/guide/translated")).toEqual({
      status: 200,
      canonicals: [pageUrl("en", "guide/translated")],
      alternates: [
        ["en", pageUrl("en", "guide/translated")],
        ["de", pageUrl("de", "guide/translated")],
        ["fa", pageUrl("fa", "guide/translated")],
        ["x-default", pageUrl("en", "guide/translated")],
      ],
    });
  });

  it.each(["de", "fa"])(
    "is its own canonical page in %s, and lists the same alternates",
    async (lang: string) => {
      const tags: SearchEngineTags = await fetchTags(
        `/docs/${lang}/guide/translated`,
      );

      expect(tags.status).toBe(200);
      expect(tags.canonicals).toEqual([pageUrl(lang, "guide/translated")]);
      expect(tags.alternates).toEqual(
        (await fetchTags("/docs/en/guide/translated")).alternates,
      );
    },
  );

  it("lists only the languages it is written in: an English page translated into Persian alone", async () => {
    for (const lang of ["en", "fa"]) {
      const tags: SearchEngineTags = await fetchTags(
        `/docs/${lang}/guide/english-copy`,
      );

      expect(tags.canonicals).toEqual([pageUrl(lang, "guide/english-copy")]);
      expect(tags.alternates).toEqual([
        ["en", pageUrl("en", "guide/english-copy")],
        ["fa", pageUrl("fa", "guide/english-copy")],
        ["x-default", pageUrl("en", "guide/english-copy")],
      ]);
    }
  });

  it("lists no alternates when it is written in English alone", async () => {
    expect(await fetchTags("/docs/en/guide/english-only")).toEqual({
      status: 200,
      canonicals: [pageUrl("en", "guide/english-only")],
      alternates: [],
    });
  });
});

describe("a page served in English under another language's prefix", () => {
  it.each([
    ["fr", "guide/translated", "there is no French copy"],
    ["ja", "guide/translated", "there is no Japanese copy"],
    ["de", "guide/english-only", "there is no German copy"],
    ["de", "guide/english-copy", "the German copy is still to be translated"],
    ["fr", "guide/english-copy", "the French copy is the English page"],
    [
      "ja",
      "guide/english-copy",
      "the Japanese copy is English with a label translated",
    ],
  ])(
    "names the English page as canonical, and lists no alternates (%s %s: %s)",
    async (lang: string, page: string) => {
      expect(await fetchTags(`/docs/${lang}/${page}`)).toEqual({
        status: 200,
        canonicals: [pageUrl("en", page)],
        alternates: [],
      });
    },
  );
});

describe("the canonical address", () => {
  it("leaves the query string out", async () => {
    expect(
      (await fetchTags("/docs/de/guide/translated?utm_source=newsletter"))
        .canonicals,
    ).toEqual([pageUrl("de", "guide/translated")]);
  });

  it("is the address in lower case, as the docs serve every page", async () => {
    expect((await fetchTags("/docs/en/Guide/Translated")).canonicals).toEqual([
      pageUrl("en", "guide/translated"),
    ]);
  });

  it("is not on a page that is not there", async () => {
    expect(await fetchTags("/docs/en/guide/no-such-page")).toEqual({
      status: 404,
      canonicals: [],
      alternates: [],
    });
  });
});

// The sitemap is XML: no HTML page (a 404 or an error) was sent in its place.
const isXmlDocument: (text: string) => boolean = (text: string): boolean => {
  return (
    text.startsWith('<?xml version="1.0" encoding="UTF-8"?>') &&
    !text.includes("<html")
  );
};

describe("the docs' sitemap", () => {
  const SITEMAP_URLS: Array<string> = [
    pageUrl("en", "guide/translated"),
    pageUrl("de", "guide/translated"),
    pageUrl("fa", "guide/translated"),
    pageUrl("en", "guide/english-copy"),
    pageUrl("fa", "guide/english-copy"),
    pageUrl("en", "guide/english-only"),
  ];

  const sitemapLocations: (xml: string) => Array<string> = (
    xml: string,
  ): Array<string> => {
    return Array.from(
      xml.matchAll(/<loc>([^<]*)<\/loc>/g),
      (match: RegExpMatchArray): string => {
        return match[1] || "";
      },
    );
  };

  it("lists every page in English and in each language it is written in, in the sidebar's order", async () => {
    const response: Response = await fetch(`${origin}/docs/sitemap.xml`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(sitemapLocations(await response.text())).toEqual(SITEMAP_URLS);
  });

  it("gives no date it does not have, and links out to nothing", async () => {
    const xml: string = await (
      await fetch(`${origin}/docs/sitemap.xml`)
    ).text();

    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("artifacthub");
    expect(isXmlDocument(xml)).toBe(true);
  });

  it("lists only addresses that are their own canonical page, served without a redirect", async () => {
    for (const url of SITEMAP_URLS) {
      const tags: SearchEngineTags = await fetchTags(url.slice(ORIGIN.length));

      expect({ url, status: tags.status, canonicals: tags.canonicals }).toEqual(
        { url, status: 200, canonicals: [url] },
      );
    }
  });

  it("is cached by browsers and crawlers for ten minutes", async () => {
    const response: Response = await fetch(`${origin}/docs/sitemap.xml`);

    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
  });
});

describe("an old address without a language", () => {
  it("redirects permanently to the English page, whatever the browser's language", async () => {
    for (const acceptLanguage of ["de-DE,de;q=0.9", "fa", "en-US"]) {
      const response: Response = await fetch(
        `${origin}/docs/guide/translated`,
        {
          redirect: "manual",
          headers: { "Accept-Language": acceptLanguage },
        },
      );

      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(
        "/docs/en/guide/translated",
      );
    }
  });

  it("keeps the query string it came with, and lands in lower case", async () => {
    const response: Response = await fetch(
      `${origin}/docs/Guide/Translated?utm_source=newsletter&utm_medium=email`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "/docs/en/guide/translated?utm_source=newsletter&utm_medium=email",
    );
  });

  it("lands on the English page in one hop", async () => {
    const redirect: Response = await fetch(
      `${origin}/docs/guide/english-only`,
      { redirect: "manual" },
    );
    const location: string = redirect.headers.get("location") || "";
    const page: Response = await fetch(`${origin}${location}`, {
      redirect: "manual",
    });

    expect(location).toBe("/docs/en/guide/english-only");
    expect(page.status).toBe(200);
  });
});
