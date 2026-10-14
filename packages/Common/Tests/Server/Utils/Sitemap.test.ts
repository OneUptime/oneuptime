import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  MAX_SITEMAP_URLS,
  SITEMAP_CONTENT_TYPE,
  SITEMAP_XML_NAMESPACE,
  buildSitemapXml,
  escapeSitemapText,
} from "../../../Server/Utils/Sitemap";

/*
 * The sitemaps the app serves for the docs and the API reference are written
 * by buildSitemapXml, and their addresses are made with getPublicOrigin. A
 * sitemap lists final addresses, entity-escaped as the protocol asks, and a
 * <lastmod> only when the page has a real date: one made up when the sitemap
 * is generated teaches a crawler to ignore every date the site gives.
 */

// Each <url> element of a sitemap, as written.
const urlElementsOf: (xml: string) => Array<string> = (
  xml: string,
): Array<string> => {
  return xml.match(/<url>[\s\S]*?<\/url>/g) || [];
};

describe("buildSitemapXml", () => {
  test("writes an XML urlset in the sitemaps namespace", () => {
    const xml: string = buildSitemapXml([
      { loc: "https://oneuptime.com/docs/en/introduction/getting-started" },
    ]);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(
      true,
    );
    expect(xml).toContain(`<urlset xmlns="${SITEMAP_XML_NAMESPACE}">`);
    expect(SITEMAP_XML_NAMESPACE).toBe(
      "http://www.sitemaps.org/schemas/sitemap/0.9",
    );
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  test("lists every address once, in the order given", () => {
    const xml: string = buildSitemapXml([
      { loc: "https://oneuptime.com/a" },
      { loc: "https://oneuptime.com/b" },
      { loc: "https://oneuptime.com/c" },
    ]);

    expect(
      urlElementsOf(xml).map((element: string): string => {
        return (element.match(/<loc>([^<]*)<\/loc>/) || [])[1] || "";
      }),
    ).toEqual([
      "https://oneuptime.com/a",
      "https://oneuptime.com/b",
      "https://oneuptime.com/c",
    ]);
  });

  test("gives a lastmod only to a page that has one", () => {
    const xml: string = buildSitemapXml([
      { loc: "https://oneuptime.com/dated", lastmod: "2026-10-01" },
      { loc: "https://oneuptime.com/undated" },
      { loc: "https://oneuptime.com/blank", lastmod: "" },
    ]);
    const [dated, undated, blank] = urlElementsOf(xml);

    expect(dated).toContain("<lastmod>2026-10-01</lastmod>");
    expect(undated).not.toContain("<lastmod>");
    expect(blank).not.toContain("<lastmod>");
  });

  test("writes no lastmod, changefreq or priority it was not given", () => {
    const xml: string = buildSitemapXml([{ loc: "https://oneuptime.com/" }]);

    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
  });

  test("entity-escapes an address as the protocol asks", () => {
    const xml: string = buildSitemapXml([
      { loc: "https://oneuptime.com/a?b=1&c='2'&d=\"3\"&e=<4>" },
    ]);

    expect(xml).toContain(
      "<loc>https://oneuptime.com/a?b=1&amp;c=&apos;2&apos;&amp;d=&quot;3&quot;&amp;e=&lt;4&gt;</loc>",
    );
  });

  test("an empty sitemap is still a well-formed urlset", () => {
    const xml: string = buildSitemapXml([]);

    expect(urlElementsOf(xml)).toEqual([]);
    expect(xml).toContain(`<urlset xmlns="${SITEMAP_XML_NAMESPACE}">`);
    expect(xml).toContain("</urlset>");
  });

  test("is served as XML in UTF-8, a type the ingress compresses", () => {
    expect(SITEMAP_CONTENT_TYPE).toBe("application/xml; charset=utf-8");
    // The protocol's limit, which every sitemap the app serves stays under.
    expect(MAX_SITEMAP_URLS).toBe(50000);
  });
});

describe("escapeSitemapText", () => {
  test("escapes all five of XML's special characters, ampersands first", () => {
    expect(escapeSitemapText(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    // An entity already in the text is escaped like any other ampersand.
    expect(escapeSitemapText("&amp;")).toBe("&amp;amp;");
  });

  test("leaves every other character as it is", () => {
    expect(escapeSitemapText("https://oneuptime.com/docs/zh-CN/a/b")).toBe(
      "https://oneuptime.com/docs/zh-CN/a/b",
    );
    expect(escapeSitemapText("日本語")).toBe("日本語");
  });
});

describe("getPublicOrigin", () => {
  type GetPublicOrigin = () => string;

  /*
   * The origin is read from EnvironmentConfig, which reads the environment
   * when it is loaded: each case loads the module afresh with its own.
   */
  const originWith: (environment: {
    Host?: string | undefined;
    HttpProtocol?: string | undefined;
  }) => string = (environment: {
    Host?: string | undefined;
    HttpProtocol?: string | undefined;
  }): string => {
    let getPublicOrigin: GetPublicOrigin | undefined;

    jest.isolateModules(() => {
      jest.doMock("../../../Server/EnvironmentConfig", () => {
        return environment;
      });
      /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      getPublicOrigin = require("../../../Server/Utils/Sitemap")
        .getPublicOrigin as GetPublicOrigin;
    });

    return (getPublicOrigin as GetPublicOrigin)();
  };

  afterEach(() => {
    jest.dontMock("../../../Server/EnvironmentConfig");
  });

  test("is the protocol and the host the instance is served at", () => {
    expect(
      originWith({ Host: "oneuptime.com", HttpProtocol: "https://" }),
    ).toBe("https://oneuptime.com");
    expect(
      originWith({ Host: "status.example.com", HttpProtocol: "http://" }),
    ).toBe("http://status.example.com");
  });

  test("never ends in a slash, so a path can follow it", () => {
    expect(
      originWith({ Host: "oneuptime.com/", HttpProtocol: "https://" }),
    ).toBe("https://oneuptime.com");
    expect(
      originWith({ Host: " oneuptime.com// ", HttpProtocol: "https://" }),
    ).toBe("https://oneuptime.com");
  });

  test("keeps a port", () => {
    expect(
      originWith({ Host: "localhost:3000", HttpProtocol: "http://" }),
    ).toBe("http://localhost:3000");
  });

  test("falls back to http://localhost, as the app does, when neither is set", () => {
    expect(originWith({})).toBe("http://localhost");
    expect(originWith({ Host: "", HttpProtocol: "" })).toBe("http://localhost");
  });
});
