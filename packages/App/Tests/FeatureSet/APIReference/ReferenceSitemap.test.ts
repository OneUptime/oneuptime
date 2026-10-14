import APIReferenceFeatureSet from "../../../FeatureSet/APIReference/Index";
import {
  getReferencePageUrl,
  getReferenceSitemapUrls,
  getReferenceSitemapXml,
} from "../../../FeatureSet/APIReference/Utils/Sitemap";
import {
  ReferenceNavItem,
  ReferenceNavSection,
  flattenNavigation,
} from "../../../FeatureSet/APIReference/Utils/Navigation";
import { getNavigationForLanguage } from "../../../FeatureSet/APIReference/Utils/RenderContext";
import { fixtureNavigation } from "./ReferenceFixtures";
import { MAX_SITEMAP_URLS, SitemapUrl } from "Common/Server/Utils/Sitemap";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";

/*
 * The API reference's sitemap: every page its navigation lists - the guides,
 * every resource and every data type - in English, at its final address.
 * The ingress serves it at /sitemap-reference.xml, which the sitemap index
 * lists; before it, none of the reference's pages were in any sitemap, and
 * the index listed /reference, which only redirects.
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
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "oneuptime.com",
    HttpProtocol: "https://",
  };
});

const ORIGIN: string = "https://oneuptime.com";

const slugsOf: (sections: Array<ReferenceNavSection>) => Array<string> = (
  sections: Array<ReferenceNavSection>,
): Array<string> => {
  return flattenNavigation(sections).map((item: ReferenceNavItem): string => {
    return item.slug;
  });
};

const locationsOf: (xml: string) => Array<string> = (
  xml: string,
): Array<string> => {
  return Array.from(
    xml.matchAll(/<loc>([^<]*)<\/loc>/g),
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
};

describe("getReferenceSitemapUrls", () => {
  it("lists every page of the navigation, in English, in the order a reader meets them", () => {
    const sections: Array<ReferenceNavSection> = fixtureNavigation();

    expect(
      getReferenceSitemapUrls(ORIGIN, sections).map(
        (url: SitemapUrl): string => {
          return url.loc;
        },
      ),
    ).toEqual(
      slugsOf(sections).map((slug: string): string => {
        return `${ORIGIN}/reference/en/${slug}`;
      }),
    );
  });

  it("lists the guides, the resources and the data types", () => {
    const locations: Array<string> = getReferenceSitemapUrls(
      ORIGIN,
      fixtureNavigation(),
    ).map((url: SitemapUrl): string => {
      return url.loc;
    });

    expect(locations).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/reference/en/introduction`,
        `${ORIGIN}/reference/en/authentication`,
        `${ORIGIN}/reference/en/openapi`,
        `${ORIGIN}/reference/en/monitor`,
        `${ORIGIN}/reference/en/status-page`,
        `${ORIGIN}/reference/en/object-id`,
        `${ORIGIN}/reference/en/monitor-step`,
      ]),
    );
  });

  it("leaves out what the navigation leaves out: the master admin APIs on oneuptime.com", () => {
    const hosted: Array<string> = getReferenceSitemapUrls(
      ORIGIN,
      fixtureNavigation({ showMasterAdminApis: false }),
    ).map((url: SitemapUrl): string => {
      return url.loc;
    });
    const selfHosted: Array<string> = getReferenceSitemapUrls(
      ORIGIN,
      fixtureNavigation({ showMasterAdminApis: true }),
    ).map((url: SitemapUrl): string => {
      return url.loc;
    });

    expect(hosted).not.toContain(`${ORIGIN}/reference/en/master-admin-apis`);
    expect(selfHosted).toContain(`${ORIGIN}/reference/en/master-admin-apis`);
  });

  it("lists English whatever language the navigation was built in", () => {
    for (const lang of ["de", "fa", "zh-CN"]) {
      for (const url of getReferenceSitemapUrls(
        ORIGIN,
        fixtureNavigation({ lang: lang }),
      )) {
        expect(new URL(url.loc).pathname.split("/")[2]).toBe("en");
      }
    }
  });

  it("lists a page the navigation lists twice once", () => {
    const sections: Array<ReferenceNavSection> = fixtureNavigation();
    const twice: Array<ReferenceNavSection> = [...sections, ...sections];

    expect(getReferenceSitemapUrls(ORIGIN, twice)).toEqual(
      getReferenceSitemapUrls(ORIGIN, sections),
    );
  });

  it("gives no date it does not have", () => {
    for (const url of getReferenceSitemapUrls(ORIGIN, fixtureNavigation())) {
      expect(url.lastmod).toBeUndefined();
    }
    expect(getReferenceSitemapXml(ORIGIN, fixtureNavigation())).not.toContain(
      "<lastmod>",
    );
  });

  it("writes a reference page's address in full", () => {
    expect(getReferencePageUrl(ORIGIN, "monitor")).toBe(
      "https://oneuptime.com/reference/en/monitor",
    );
  });
});

describe("/reference/sitemap.xml", () => {
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

  it("is served as XML, and lists every page the reference's navigation lists", async () => {
    const response: Response = await fetch(`${origin}/reference/sitemap.xml`, {
      redirect: "manual",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");

    const locations: Array<string> = locationsOf(await response.text());
    const slugs: Array<string> = slugsOf(getNavigationForLanguage("en"));

    expect(locations).toEqual(
      Array.from(new Set(slugs)).map((slug: string): string => {
        return `${ORIGIN}/reference/en/${slug}`;
      }),
    );
    expect(locations.length).toBeGreaterThan(50);
    expect(locations.length).toBeLessThanOrEqual(MAX_SITEMAP_URLS);
  });

  it("lists pages that are served, without a redirect", async () => {
    const locations: Array<string> = locationsOf(
      await (await fetch(`${origin}/reference/sitemap.xml`)).text(),
    );
    const guides: Array<string> = locations.slice(0, 3);
    const resource: string = `${ORIGIN}/reference/en/monitor`;

    expect(locations).toContain(resource);

    // The first guides, a resource, and the last data type.
    for (const location of [
      ...guides,
      resource,
      locations[locations.length - 1]!,
    ]) {
      const response: Response = await fetch(
        `${origin}${new URL(location).pathname}`,
        { redirect: "manual" },
      );

      expect({ location, status: response.status }).toEqual({
        location,
        status: 200,
      });
    }
  });

  it("never lists /reference, which only redirects to a language", async () => {
    const locations: Array<string> = locationsOf(
      await (await fetch(`${origin}/reference/sitemap.xml`)).text(),
    );

    expect(locations).not.toContain(`${ORIGIN}/reference`);
    expect(locations).not.toContain(`${ORIGIN}/reference/`);
    expect(locations).not.toContain(`${ORIGIN}/reference/en`);

    /*
     * Where /reference goes depends on the reader's language, and the answer
     * says so to caches. (The static files mounted at /reference first add
     * the trailing slash.)
     */
    const root: Response = await fetch(`${origin}/reference/`, {
      redirect: "manual",
      headers: { "Accept-Language": "de" },
    });

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/reference/de/introduction");
    expect(root.headers.get("vary")).toContain("Accept-Language");
  });

  it("is not taken for a language or an old page address", async () => {
    const response: Response = await fetch(`${origin}/reference/sitemap.xml`, {
      redirect: "manual",
    });

    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("<urlset");
  });
});
