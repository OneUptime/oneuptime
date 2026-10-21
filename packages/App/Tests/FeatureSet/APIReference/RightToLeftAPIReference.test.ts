import APIReferenceFeatureSet from "../../../FeatureSet/APIReference/Index";
import {
  DocsLanguage,
  SUPPORTED_DOCS_LANGUAGES,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  only,
  parsePage,
} from "Common/Tests/RenderedMarkup";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";

/*
 * Persian API Reference pages are served right to left.
 *
 * Farsi pages were served with lang="fa" and no dir, so the browser laid the
 * Persian out left to right: every paragraph flush left, its full stop on the
 * wrong end, the sidebar, the top bar and the pager in the wrong order. These
 * run the API Reference's real routes, services and templates - only where
 * the views live is replaced, since the shipped config points into the
 * container - and read the direction off the page a reader is sent.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await APIReferenceFeatureSet.init();
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

interface ServedPage {
  status: number;
  // Where the reader ended up, after any redirect.
  url: string;
  page: RenderedPage;
}

type FetchPageFunction = (
  pathname: string,
  headers?: Record<string, string>,
) => Promise<ServedPage>;

const fetchPage: FetchPageFunction = async (
  pathname: string,
  headers: Record<string, string> = {},
): Promise<ServedPage> => {
  const response: Response = await fetch(`${origin}${pathname}`, {
    headers: headers,
  });
  return {
    status: response.status,
    url: response.url,
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

// The name inside the desktop sidebar's link to a page.
const sidebarNameFor: (page: RenderedPage, slug: string) => RenderedElement = (
  page: RenderedPage,
  slug: string,
): RenderedElement => {
  return only(page, (element: RenderedElement): boolean => {
    const link: RenderedElement | undefined = element.ancestors[0];

    return (
      element.tagName === "span" &&
      link !== undefined &&
      attributeOf(link, "data-nav-slug") === slug &&
      link.ancestors.some((ancestor: RenderedElement): boolean => {
        return attributeOf(ancestor, "id") === "reference-sidebar";
      })
    );
  });
};

// Every language but the two the regression is about.
const OTHER_LANGUAGES: Array<DocsLanguage> = SUPPORTED_DOCS_LANGUAGES.filter(
  (language: DocsLanguage): boolean => {
    return language.code !== "fa" && language.code !== "en";
  },
);

/*
 * One page from each service that renders the layout, so a service that
 * stopped passing the direction on would be caught.
 */
const PAGES: Array<string> = [
  "introduction",
  "authentication",
  "pagination",
  "permissions",
  "errors",
  "openapi",
  "status",
  "data-types",
  "monitor",
  "monitor-steps",
];

describe("a served API Reference page", () => {
  it("is right to left in Persian", async () => {
    const served: ServedPage = await fetchPage("/reference/fa/introduction");

    expect(served.status).toBe(200);
    expect(attributeOf(htmlOf(served.page), "lang")).toBe("fa");
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("rtl");
  });

  it("is not right to left in English", async () => {
    const served: ServedPage = await fetchPage("/reference/en/introduction");

    expect(served.status).toBe(200);
    expect(attributeOf(htmlOf(served.page), "lang")).toBe("en");
    expect(attributeOf(htmlOf(served.page), "dir")).not.toBe("rtl");
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("ltr");
  });

  it.each(OTHER_LANGUAGES)(
    "is left to right in $englishName",
    async (language: DocsLanguage) => {
      const served: ServedPage = await fetchPage(
        `/reference/${language.code}/introduction`,
      );

      expect(served.status).toBe(200);
      expect(attributeOf(htmlOf(served.page), "lang")).toBe(language.code);
      expect(attributeOf(htmlOf(served.page), "dir")).toBe("ltr");
    },
  );

  it.each(PAGES)(
    "is right to left in Persian and left to right in English on the %s page",
    async (slug: string) => {
      const persian: ServedPage = await fetchPage(`/reference/fa/${slug}`);
      const english: ServedPage = await fetchPage(`/reference/en/${slug}`);

      expect([slug, persian.status, english.status]).toEqual([slug, 200, 200]);
      expect(attributeOf(htmlOf(persian.page), "dir")).toBe("rtl");
      expect(attributeOf(htmlOf(english.page), "dir")).toBe("ltr");
    },
  );

  it("is right to left in Persian when it is not found, and left to right in English", async () => {
    const persian: ServedPage = await fetchPage("/reference/fa/no-such-page");
    const english: ServedPage = await fetchPage("/reference/en/no-such-page");

    expect(persian.status).toBe(404);
    expect(attributeOf(htmlOf(persian.page), "dir")).toBe("rtl");
    expect(english.status).toBe(404);
    expect(attributeOf(htmlOf(english.page), "dir")).toBe("ltr");
  });

  it("sends a reader whose browser asks for Persian to a right-to-left page", async () => {
    const served: ServedPage = await fetchPage("/reference", {
      "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.5",
    });

    expect(served.url).toBe(`${origin}/reference/fa/introduction`);
    expect(attributeOf(htmlOf(served.page), "dir")).toBe("rtl");
  });

  it("lays a model's English name out left to right in the Persian sidebar, and leaves a guide's to the page", async () => {
    /*
     * The live navigation, not the fixtures: the registry is what marks a
     * name as English. Persian's "APIهای مدیر ارشد" opens with a Latin
     * acronym, and laid out left to right it would read in the wrong order.
     */
    const served: ServedPage = await fetchPage("/reference/fa/introduction");

    expect(attributeOf(sidebarNameFor(served.page, "monitor"), "dir")).toBe(
      "ltr",
    );
    expect(
      attributeOf(sidebarNameFor(served.page, "monitor-steps"), "dir"),
    ).toBe("ltr");
    expect(
      attributeOf(sidebarNameFor(served.page, "authentication"), "dir"),
    ).toBeNull();
  });
});
