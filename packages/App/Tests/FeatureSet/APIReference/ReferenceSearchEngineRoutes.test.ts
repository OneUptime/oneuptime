import APIReferenceFeatureSet from "../../../FeatureSet/APIReference/Index";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/APIReference/Utils/I18n";
import { getNavigationForLanguage } from "../../../FeatureSet/APIReference/Utils/RenderContext";
import {
  TRANSLATED_REFERENCE_PAGES,
  X_DEFAULT_HREFLANG,
} from "../../../FeatureSet/APIReference/Utils/Seo";
import { getReferenceSitemapUrls } from "../../../FeatureSet/APIReference/Utils/Sitemap";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { SitemapUrl, getPublicOrigin } from "Common/Server/Utils/Sitemap";
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
import type * as Path from "path";

/*
 * What search engines are sent to by the API Reference, through its real
 * routes, services and templates - only where the views live is replaced,
 * since the shipped config points into the container:
 *
 *   - an old address without a language (/reference/monitor) redirects
 *     permanently, in one hop, to the English page - the address a search
 *     engine should keep - not temporarily to the browser's language;
 *   - a language's own address redirects permanently to its introduction;
 *   - every page names its canonical address (Utils/Seo.ts), and a page that
 *     does not exist names none;
 *   - the File resource's page, which answered 500, renders.
 *
 * Google Search Console listed the /reference/en pages as "Duplicate without
 * user-selected canonical": no page named one, and Google kept the old
 * address, which redirected only temporarily, in place of each.
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
  // fetch keeps its connections open for reuse; close them with the server.
  server.closeAllConnections();
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

// The origin the pages name in their links, as the sitemap does.
const PUBLIC_ORIGIN: string = getPublicOrigin();

const GERMAN_READER: Record<string, string> = {
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
};

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

interface Redirect {
  status: number;
  location: string | null;
}

type RedirectOfFunction = (
  pathname: string,
  headers?: Record<string, string>,
) => Promise<Redirect>;

const redirectOf: RedirectOfFunction = async (
  pathname: string,
  headers: Record<string, string> = {},
): Promise<Redirect> => {
  const response: Response = await fetchManual(pathname, headers);
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
};

interface AlternateLink {
  hreflang: string;
  href: string;
}

interface ServedLinks {
  status: number;
  canonicals: Array<string>;
  alternates: Array<AlternateLink>;
  html: string;
}

// A served page's status, and the canonical and alternate links in its head.
type LinksOfFunction = (pathname: string) => Promise<ServedLinks>;

const linksOf: LinksOfFunction = async (
  pathname: string,
): Promise<ServedLinks> => {
  const response: Response = await fetchManual(pathname);
  const html: string = await response.text();
  const page: RenderedPage = parsePage(html);

  const links: Array<RenderedElement> = page.elements.filter(
    (element: RenderedElement): boolean => {
      return element.tagName === "link";
    },
  );

  return {
    status: response.status,
    canonicals: links
      .filter((element: RenderedElement): boolean => {
        return attributeOf(element, "rel") === "canonical";
      })
      .map((element: RenderedElement): string => {
        return attributeOf(element, "href") || "";
      }),
    alternates: links
      .filter((element: RenderedElement): boolean => {
        return (
          attributeOf(element, "rel") === "alternate" &&
          attributeOf(element, "hreflang") !== null
        );
      })
      .map((element: RenderedElement): AlternateLink => {
        return {
          hreflang: attributeOf(element, "hreflang") || "",
          href: attributeOf(element, "href") || "",
        };
      }),
    html: html,
  };
};

const urlOf: (lang: string, page: string) => string = (
  lang: string,
  page: string,
): string => {
  return `${PUBLIC_ORIGIN}/reference/${lang}/${page}`;
};

const everyLanguageOf: (page: string) => Array<AlternateLink> = (
  page: string,
): Array<AlternateLink> => {
  return [
    ...SUPPORTED_DOCS_LANGUAGE_CODES.map((lang: string): AlternateLink => {
      return { hreflang: lang, href: urlOf(lang, page) };
    }),
    { hreflang: X_DEFAULT_HREFLANG, href: urlOf("en", page) },
  ];
};

// Master admin APIs are a page only where billing is off (self-hosted).
const SERVED_TRANSLATED_PAGES: Array<string> =
  TRANSLATED_REFERENCE_PAGES.filter((page: string): boolean => {
    return page !== "master-admin-apis" || !IsBillingEnabled;
  });

const SITEMAP_URLS: Array<SitemapUrl> = getReferenceSitemapUrls(
  PUBLIC_ORIGIN,
  getNavigationForLanguage("en"),
);

const slugOf: (url: SitemapUrl) => string = (url: SitemapUrl): string => {
  return new URL(url.loc).pathname.split("/").pop() || "";
};

describe("an old address without a language", () => {
  it("redirects permanently to the English page for every page in the sitemap, whatever the reader's language", async () => {
    const wrong: Array<string> = [];

    for (const url of SITEMAP_URLS) {
      const slug: string = slugOf(url);
      const redirect: Redirect = await redirectOf(
        `/reference/${slug}`,
        GERMAN_READER,
      );

      if (
        redirect.status !== 301 ||
        redirect.location !== `/reference/en/${slug}`
      ) {
        wrong.push(
          `/reference/${slug} -> ${redirect.status} ${redirect.location}`,
        );
      }
    }

    expect(SITEMAP_URLS.length).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  }, 300000);

  it("keeps the query it came with", async () => {
    expect(
      await redirectOf("/reference/monitor?utm_source=newsletter&ref=a%20b"),
    ).toEqual({
      status: 301,
      location: "/reference/en/monitor?utm_source=newsletter&ref=a%20b",
    });
  });

  it("answers a page the reference does not have with 404, not a redirect", async () => {
    const served: ServedLinks = await linksOf("/reference/no-such-page");

    expect(served.status).toBe(404);
    expect(served.canonicals).toEqual([]);
    expect((await redirectOf("/reference/no-such-page")).location).toBeNull();
  });
});

describe("a language's own address", () => {
  it.each([
    ["/reference/en", "/reference/en/introduction"],
    ["/reference/en/", "/reference/en/introduction"],
    ["/reference/de", "/reference/de/introduction"],
    ["/reference/zh-CN?ref=nav", "/reference/zh-CN/introduction?ref=nav"],
  ])(
    "redirects %s permanently to its introduction",
    async (from: string, to: string) => {
      expect(await redirectOf(from)).toEqual({ status: 301, location: to });
    },
  );

  it("leaves the reference's root to send each reader to their language", async () => {
    // /reference itself first gets the static files' trailing slash (301).
    const response: Response = await fetchManual("/reference/", GERMAN_READER);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/reference/de/introduction");
    expect(response.headers.get("vary")).toContain("Accept-Language");
  });
});

describe("a guide written in every language", () => {
  it.each(SERVED_TRANSLATED_PAGES)(
    "names %s as its own canonical page in English, German and Persian, and lists every language",
    async (page: string) => {
      for (const lang of ["en", "de", "fa"]) {
        const served: ServedLinks = await linksOf(`/reference/${lang}/${page}`);

        expect({
          lang,
          status: served.status,
          canonicals: served.canonicals,
          alternates: served.alternates,
        }).toEqual({
          lang,
          status: 200,
          canonicals: [urlOf(lang, page)],
          alternates: everyLanguageOf(page),
        });
      }
    },
  );
});

describe("a page written from English descriptions", () => {
  it.each([
    ["/reference/de/monitor", "monitor"],
    ["/reference/ja/status-page", "status-page"],
    ["/reference/fr/equal-to", "equal-to"],
    ["/reference/es/permissions", "permissions"],
    ["/reference/en/monitor", "monitor"],
  ])(
    "names the English page from %s, with no alternates",
    async (pathname: string, page: string) => {
      const served: ServedLinks = await linksOf(pathname);

      expect({
        status: served.status,
        canonicals: served.canonicals,
        alternates: served.alternates,
      }).toEqual({
        status: 200,
        canonicals: [urlOf("en", page)],
        alternates: [],
      });
    },
  );
});

describe("a page that does not exist", () => {
  it.each([
    "/reference/en/no-such-page",
    "/reference/de/no-such-page",
    "/reference/en/page-not-found",
  ])(
    "answers %s with 404 and names no canonical page",
    async (pathname: string) => {
      const served: ServedLinks = await linksOf(pathname);

      expect({
        status: served.status,
        canonicals: served.canonicals,
        alternates: served.alternates,
      }).toEqual({ status: 404, canonicals: [], alternates: [] });
    },
  );
});

describe("the reference's sitemap", () => {
  it("lists addresses that are served, without a redirect, as their own canonical page", async () => {
    // A sample across guides, resources and data types, the same one on every run.
    const sample: Array<SitemapUrl> = shuffled(
      SITEMAP_URLS,
      seededRandom(20261022),
    ).slice(0, 16);

    for (const url of sample) {
      const served: ServedLinks = await linksOf(new URL(url.loc).pathname);

      expect({
        location: url.loc,
        status: served.status,
        canonicals: served.canonicals,
      }).toEqual({ location: url.loc, status: 200, canonicals: [url.loc] });
    }
  }, 300000);
});

describe("the File resource's page", () => {
  it("renders, and lists the AuthenticatedRequest grant its create allows by its key", async () => {
    const served: ServedLinks = await linksOf("/reference/en/file");

    expect(served.status).toBe(200);
    expect(served.canonicals).toEqual([urlOf("en", "file")]);
    expect(served.html).toContain(">AuthenticatedRequest</code>");
  });
});
