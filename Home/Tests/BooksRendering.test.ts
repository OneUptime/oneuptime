import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import fs from "fs";
import path from "path";

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const BOOK_URL: string = "https://backtometal.oneuptime.com/";
const COVER_PATH: string = "/img/books/back-to-metal.jpg";

interface RenderedElement {
  attributes: string;
  body: string;
}

type StructuredData = Record<string, unknown>;

async function render(
  template: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), locals, {
    views: [VIEWS_ROOT],
  })) as string;
}

async function renderBooks(
  homeUrl: string = HOME_URL,
  overrides: Partial<PageSEOData> = {},
): Promise<string> {
  const seo: PageSEOData = { ...getPageSEO("/books"), ...overrides };

  return render("books.ejs", {
    enableGoogleTagManager: false,
    support: false,
    footerCards: false,
    cta: false,
    blackLogo: false,
    requestDemoCta: false,
    homeUrl,
    seo: {
      ...seo,
      fullCanonicalUrl: `${homeUrl}${seo.canonicalPath}`,
    },
  });
}

/*
 * Inspect rendered elements rather than template source or CSS class names.
 * This exercises the real shared includes without adding a DOM dependency.
 */
function elementsIn(html: string, tag: string): Array<RenderedElement> {
  return [
    ...html.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi"),
    ),
  ].map((match: RegExpMatchArray): RenderedElement => {
    return { attributes: match[1]!, body: match[2]! };
  });
}

function attributeValue(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(attributes)?.[1];
}

function textIn(html: string): string {
  return html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(
      /<span\b[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/span>/gi,
      " ",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, name: string): string | undefined {
  const tag: string | undefined = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .find((meta: string): boolean => {
      return (
        attributeValue(meta, "name") === name ||
        attributeValue(meta, "property") === name
      );
    });

  return tag ? attributeValue(tag, "content") : undefined;
}

function linkedElements(html: string, href: string): Array<RenderedElement> {
  return elementsIn(html, "a").filter((anchor: RenderedElement): boolean => {
    return attributeValue(anchor.attributes, "href") === href;
  });
}

function structuredDataIn(html: string): Array<StructuredData> {
  return elementsIn(html, "script")
    .filter((script: RenderedElement): boolean => {
      return (
        attributeValue(script.attributes, "type") === "application/ld+json"
      );
    })
    .map((script: RenderedElement): StructuredData => {
      return JSON.parse(script.body) as StructuredData;
    });
}

function escapeForHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
}

describe("books.ejs", () => {
  let html: string = "";
  let main: string = "";

  beforeAll(async () => {
    html = await renderBooks();
    main = elementsIn(html, "main")[0]?.body || "";
  });

  test("renders a complete English page with the shared navigation and footer", () => {
    expect(html).toMatch(/^\s*<!DOCTYPE html>/i);
    expect(html).toMatch(/<html\b[^>]*lang="en"/);
    expect(html).toContain("</html>");
    expect(elementsIn(html, "main")).toHaveLength(1);
    expect(elementsIn(html, "nav").length).toBeGreaterThan(0);
    expect(elementsIn(html, "footer")).toHaveLength(1);
  });

  test("has one descriptive page heading and a separate book heading", () => {
    const headings: Array<RenderedElement> = elementsIn(html, "h1");

    expect(headings).toHaveLength(1);
    expect(textIn(headings[0]!.body)).toBe("Books for people who build.");
    expect(
      elementsIn(main, "h2").map((heading: RenderedElement): string => {
        return textIn(heading.body);
      }),
    ).toContain("Back to Metal");
  });

  test("identifies the book by its official subtitle and author", () => {
    expect(textIn(main)).toContain(
      "How a company leaves the cloud, one move at a time",
    );
    expect(textIn(main)).toContain("Nawaz Dhandala");
  });

  test("the primary reading action opens the official book website", () => {
    const readingLinks: Array<RenderedElement> = linkedElements(main, BOOK_URL);

    expect(readingLinks.length).toBeGreaterThan(0);
    expect(
      readingLinks.some((anchor: RenderedElement): boolean => {
        return textIn(anchor.body) === "Read the book";
      }),
    ).toBe(true);
  });

  test("the explore action points to the book preview on this page", () => {
    const exploreLinks: Array<RenderedElement> = linkedElements(
      main,
      "#inside-the-book",
    );

    expect(exploreLinks).toHaveLength(1);
    expect(textIn(exploreLinks[0]!.body)).toBe("Explore the book");
    expect(main).toContain('id="inside-the-book"');
  });

  test("introduces the five stages of the book in reading order", () => {
    const chapterLinks: Array<RenderedElement> = elementsIn(main, "a").filter(
      (anchor: RenderedElement): boolean => {
        return (
          attributeValue(anchor.attributes, "href")?.startsWith(
            `${BOOK_URL}m/`,
          ) || false
        );
      },
    );

    expect(
      chapterLinks.map((anchor: RenderedElement): string | undefined => {
        return textIn(anchor.body).match(
          /\b(Decide|Buy|Build|Move|Run)\b/,
        )?.[1];
      }),
    ).toEqual(["Decide", "Buy", "Build", "Move", "Run"]);
  });

  test.each([
    ["PDF", "Back-to-Metal.pdf"],
    ["EPUB", "Back-to-Metal.epub"],
  ])(
    "offers the %s edition at its official download URL",
    (format: string, fileName: string) => {
      const downloadLinks: Array<RenderedElement> = linkedElements(
        main,
        `${BOOK_URL}${fileName}`,
      );

      expect(main).toContain('id="reading-formats"');
      expect(downloadLinks).toHaveLength(1);
      expect(textIn(downloadLinks[0]!.body).toUpperCase()).toContain(format);
    },
  );

  test("all preview links resolve to unique sections on the page", () => {
    const anchors: Array<RenderedElement> = elementsIn(main, "a").filter(
      (anchor: RenderedElement): boolean => {
        return (
          attributeValue(anchor.attributes, "href")?.startsWith("#") || false
        );
      },
    );
    const ids: Array<string> = [...html.matchAll(/\bid="([^"]+)"/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      const target: string = attributeValue(anchor.attributes, "href")!.slice(
        1,
      );

      expect(target).not.toBe("");
      expect(
        ids.filter((id: string): boolean => {
          return id === target;
        }),
      ).toHaveLength(1);
    }
  });

  test("uses the local book cover with meaningful alternative text and stable dimensions", () => {
    const cover: string | undefined = [...main.matchAll(/<img\b[^>]*>/gi)]
      .map((match: RegExpMatchArray): string => {
        return match[0];
      })
      .find((image: string): boolean => {
        return attributeValue(image, "src") === COVER_PATH;
      });

    expect(cover).toBeDefined();
    expect(attributeValue(cover!, "alt")).toMatch(/Back to Metal/);
    expect(attributeValue(cover!, "alt")).toMatch(/cover|Nawaz Dhandala/i);
    expect(attributeValue(cover!, "width")).toBe("1600");
    expect(attributeValue(cover!, "height")).toBe("2560");
  });

  test("ships a real JPEG for the advertised cover URL", () => {
    const cover: Buffer = fs.readFileSync(
      path.join(__dirname, "..", "Static", COVER_PATH),
    );

    expect(cover.length).toBeGreaterThan(10000);
    expect(cover.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  test("book links remain usable without client-side event handlers", () => {
    const bookLinks: Array<RenderedElement> = elementsIn(main, "a").filter(
      (anchor: RenderedElement): boolean => {
        return (
          attributeValue(anchor.attributes, "href")?.includes("backtometal") ||
          false
        );
      },
    );

    expect(bookLinks.length).toBeGreaterThanOrEqual(3);

    for (const anchor of bookLinks) {
      const url: URL = new URL(attributeValue(anchor.attributes, "href")!);

      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("backtometal.oneuptime.com");
      expect(textIn(anchor.body).length).toBeGreaterThan(0);
    }
  });
});

describe("books page discovery", () => {
  test("the desktop and mobile navigation both link to the books page", async () => {
    const navigation: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const links: Array<RenderedElement> = linkedElements(navigation, "/books");

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(textIn(link.body)).toContain("Books");
    }
  });

  test("the shared footer links to the books page", async () => {
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });
    const links: Array<RenderedElement> = linkedElements(footer, "/books");

    expect(links).toHaveLength(1);
    expect(textIn(links[0]!.body)).toBe("Books");
  });
});

describe("books page metadata", () => {
  let html: string = "";
  let schemas: Array<StructuredData> = [];

  beforeAll(async () => {
    html = await renderBooks();
    schemas = structuredDataIn(html);
  });

  test("the document and social previews use the registered title and description", () => {
    const seo: PageSEOData = getPageSEO("/books");
    const titles: Array<RenderedElement> = elementsIn(html, "title");

    expect(titles).toHaveLength(1);
    expect(titles[0]!.body).toBe(escapeForHtml(seo.title));
    expect(metaContent(html, "description")).toBe(
      escapeForHtml(seo.description),
    );
    expect(metaContent(html, "og:title")).toBe(escapeForHtml(seo.title));
    expect(metaContent(html, "og:description")).toBe(
      escapeForHtml(seo.description),
    );
    expect(metaContent(html, "twitter:title")).toBe(escapeForHtml(seo.title));
    expect(metaContent(html, "twitter:description")).toBe(
      escapeForHtml(seo.description),
    );
  });

  test("publishes the configured image in large social sharing cards", () => {
    const imagePath: string =
      getPageSEO("/books").ogImage || "/img/og-image.png";
    const imageUrl: string = `${HOME_URL}${imagePath}`;

    expect(metaContent(html, "og:image")).toBe(imageUrl);
    expect(metaContent(html, "twitter:image")).toBe(imageUrl);
    expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
  });

  test("publishes exactly one canonical URL for the books collection", () => {
    const canonicalLinks: Array<string> = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((match: RegExpMatchArray): string => {
        return match[0];
      })
      .filter((link: string): boolean => {
        return attributeValue(link, "rel") === "canonical";
      });

    expect(canonicalLinks).toHaveLength(1);
    expect(attributeValue(canonicalLinks[0]!, "href")).toBe(
      `${HOME_URL}/books`,
    );
    expect(metaContent(html, "og:url")).toBe(`${HOME_URL}/books`);
  });

  test("all structured data parses and identifies one free English book", () => {
    const books: Array<StructuredData> = schemas.filter(
      (schema: StructuredData): boolean => {
        return schema["@type"] === "Book";
      },
    );

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Book",
      name: "Back to Metal",
      url: BOOK_URL,
      image: `${HOME_URL}${COVER_PATH}`,
      author: { "@type": "Person", name: "Nawaz Dhandala" },
      inLanguage: "en",
      isAccessibleForFree: true,
    });
  });

  test("the breadcrumb links identify the collection within OneUptime", () => {
    const breadcrumb: StructuredData | undefined = schemas.find(
      (schema: StructuredData): boolean => {
        return schema["@type"] === "BreadcrumbList";
      },
    );

    expect(breadcrumb?.["itemListElement"]).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${HOME_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Books",
        item: `${HOME_URL}/books`,
      },
    ]);
  });

  test("the collection is described as a web page, not a software product", () => {
    expect(schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "WebPage",
          url: `${HOME_URL}/books`,
        }),
        expect.objectContaining({ "@type": "Organization", name: "OneUptime" }),
      ]),
    );
    expect(
      schemas.some((schema: StructuredData): boolean => {
        return schema["@type"] === "SoftwareApplication";
      }),
    ).toBe(false);
  });

  test("uses the configured website host for canonical and preview URLs", async () => {
    const stagingUrl: string = "https://staging.oneuptime.example";
    const stagingHtml: string = await renderBooks(stagingUrl);
    const stagingSchemas: Array<StructuredData> = structuredDataIn(stagingHtml);
    const imagePath: string =
      getPageSEO("/books").ogImage || "/img/og-image.png";

    expect(stagingHtml).toContain(`rel="canonical" href="${stagingUrl}/books"`);
    expect(metaContent(stagingHtml, "og:url")).toBe(`${stagingUrl}/books`);
    expect(metaContent(stagingHtml, "og:image")).toBe(
      `${stagingUrl}${imagePath}`,
    );
    expect(stagingSchemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "WebPage",
          url: `${stagingUrl}/books`,
        }),
        expect.objectContaining({
          "@type": "Book",
          url: BOOK_URL,
          image: `${stagingUrl}${COVER_PATH}`,
        }),
      ]),
    );
    expect(linkedElements(stagingHtml, BOOK_URL).length).toBeGreaterThan(0);
  });

  test("escapes quotes and markup in SEO text without breaking structured data", async () => {
    const unsafeText: string =
      'Books " & </title><script id="books-meta-injection">alert(1)</script>';
    const escapedHtml: string = await renderBooks(HOME_URL, {
      title: unsafeText,
      description: unsafeText,
    });

    expect(escapedHtml).not.toContain('<script id="books-meta-injection">');
    expect(elementsIn(escapedHtml, "title")).toHaveLength(1);
    expect(elementsIn(escapedHtml, "title")[0]!.body).toBe(
      escapeForHtml(unsafeText),
    );
    expect(metaContent(escapedHtml, "description")).toBe(
      escapeForHtml(unsafeText),
    );
    expect(metaContent(escapedHtml, "og:title")).toBe(
      escapeForHtml(unsafeText),
    );
    expect(metaContent(escapedHtml, "twitter:description")).toBe(
      escapeForHtml(unsafeText),
    );
    expect(() => {
      structuredDataIn(escapedHtml);
    }).not.toThrow();
  });
});
