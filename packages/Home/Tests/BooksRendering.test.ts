import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  BackToMetal,
  BookChapter,
  BookDefinition,
  BookMove,
  BookStage,
} from "../Utils/Books/BookCatalog";
import { BookPageAssets, getBookPageAssets } from "../Utils/StaticAssets";
import ejs from "ejs";
import fs from "fs";
import path from "path";

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const STATIC_ROOT: string = path.join(__dirname, "..", "Static");
const HOME_URL: string = "https://oneuptime.com";
const BOOK_URL: string = "https://backtometal.oneuptime.com/";
const COVER_PATH: string = "/img/books/back-to-metal.jpg";
const VERSIONED_ASSET: RegExp =
  /^\/(css|js)\/[a-z-]+\.(css|js)\?v=[0-9a-f]{12}$/;

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

interface RenderBooksOptions {
  homeUrl?: string;
  seo?: Partial<PageSEOData>;
  book?: BookDefinition;
  bookAssets?: BookPageAssets | undefined;
}

async function renderBooks(options: RenderBooksOptions = {}): Promise<string> {
  const homeUrl: string = options.homeUrl || HOME_URL;
  const seo: PageSEOData = { ...getPageSEO("/books"), ...(options.seo || {}) };

  return render("books.ejs", {
    enableGoogleTagManager: false,
    support: false,
    footerCards: false,
    cta: false,
    blackLogo: false,
    requestDemoCta: false,
    homeUrl,
    book: options.book || BackToMetal,
    bookAssets: options.bookAssets,
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

function openingTags(html: string, tag: string): Array<string> {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

function attributeValue(attributes: string, name: string): string | undefined {
  return new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(attributes)?.[1];
}

function hasAttribute(attributes: string, name: string): boolean {
  return new RegExp(`\\s${name}(\\s|=|>|$)`, "i").test(attributes);
}

function textIn(html: string): string {
  return html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(
      /<span\b[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/span>/gi,
      " ",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/&ldquo;|&rdquo;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, name: string): string | undefined {
  const tag: string | undefined = openingTags(html, "meta").find(
    (meta: string): boolean => {
      return (
        attributeValue(meta, "name") === name ||
        attributeValue(meta, "property") === name
      );
    },
  );

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

function sectionById(html: string, id: string): string {
  const start: number = html.search(new RegExp(`<section\\b[^>]*id="${id}"`));
  expect(start).toBeGreaterThanOrEqual(0);
  const end: number = html.indexOf("</section>", start);
  return html.slice(start, end);
}

function readerDialog(html: string): string {
  const start: number = html.indexOf('<div id="book-reader"');
  const end: number = html.indexOf('<div class="bk-measure"', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

const allMoves: Array<BookMove> = BackToMetal.stages.flatMap(
  (stage: BookStage): Array<BookMove> => {
    return stage.moves;
  },
);

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
    expect(elementsIn(html, "footer").length).toBeGreaterThanOrEqual(1);
  });

  test("provides a focusable main destination for the shared skip link", () => {
    const mainElement: RenderedElement = elementsIn(html, "main")[0]!;
    const skipLinks: Array<RenderedElement> = linkedElements(
      html,
      "#main-content",
    );

    expect(attributeValue(mainElement.attributes, "id")).toBe("main-content");
    expect(attributeValue(mainElement.attributes, "tabindex")).toBe("-1");
    expect(skipLinks).toHaveLength(1);
    expect(textIn(skipLinks[0]!.body)).toBe("Skip to main content");
  });

  test("leads with the book: one page heading naming it, with its subtitle and author", () => {
    const headings: Array<RenderedElement> = elementsIn(html, "h1");

    expect(headings).toHaveLength(1);
    expect(textIn(headings[0]!.body)).toBe("Back to Metal");
    expect(attributeValue(headings[0]!.attributes, "id")).toBe("book-title");
    expect(textIn(main)).toContain(
      "How a company leaves the cloud, one move at a time",
    );
    expect(textIn(main)).toContain("By Nawaz Dhandala");
    expect(textIn(main)).toContain("From the makers of OneUptime");
  });

  test("the hero is labelled by the book title for assistive technology", () => {
    const hero: string | undefined = openingTags(main, "section").find(
      (section: string): boolean => {
        return attributeValue(section, "class") === "books-hero";
      },
    );

    expect(hero).toBeDefined();
    expect(attributeValue(hero!, "aria-labelledby")).toBe("book-title");
  });

  test("the primary action opens the in-page reader and falls back to the official website", () => {
    const readingLinks: Array<RenderedElement> = linkedElements(
      main,
      BOOK_URL,
    ).filter((anchor: RenderedElement): boolean => {
      return textIn(anchor.body) === "Read the book";
    });

    expect(readingLinks).toHaveLength(1);
    expect(hasAttribute(readingLinks[0]!.attributes, "data-book-open")).toBe(
      true,
    );
    expect(hasAttribute(readingLinks[0]!.attributes, "data-book-section")).toBe(
      false,
    );
  });

  test("the explore action points to the contents on this page", () => {
    const exploreLinks: Array<RenderedElement> = linkedElements(
      main,
      "#inside-the-book",
    );

    expect(exploreLinks).toHaveLength(1);
    expect(textIn(exploreLinks[0]!.body)).toBe("Explore the book");
    expect(main).toContain('id="inside-the-book"');
  });

  test("the 3D book in the hero is a real link that opens the reader", () => {
    const objects: Array<string> = openingTags(main, "a").filter(
      (anchor: string): boolean => {
        return hasAttribute(anchor, "data-book-object");
      },
    );

    expect(objects).toHaveLength(1);
    expect(attributeValue(objects[0]!, "href")).toBe(BOOK_URL);
    expect(hasAttribute(objects[0]!, "data-book-open")).toBe(true);
    expect(attributeValue(objects[0]!, "aria-label")).toBe(
      "Open Back to Metal and start reading",
    );
  });

  test("uses the local book cover with meaningful alternative text and stable dimensions", () => {
    const covers: Array<string> = openingTags(main, "img").filter(
      (image: string): boolean => {
        return attributeValue(image, "src") === COVER_PATH;
      },
    );

    expect(covers).toHaveLength(1);
    expect(attributeValue(covers[0]!, "alt")).toBe(
      "Back to Metal book cover by Nawaz Dhandala",
    );
    expect(attributeValue(covers[0]!, "width")).toBe("1600");
    expect(attributeValue(covers[0]!, "height")).toBe("2560");
    expect(hasAttribute(covers[0]!, "data-book-cover")).toBe(true);
  });

  test("ships a real JPEG for the advertised cover URL", () => {
    const cover: Buffer = fs.readFileSync(path.join(STATIC_ROOT, COVER_PATH));

    expect(cover.length).toBeGreaterThan(10000);
    expect(cover.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  test("states the book's facts at a glance as a description list", () => {
    const glance: RenderedElement | undefined = elementsIn(main, "dl")[0];

    expect(glance).toBeDefined();
    expect(
      elementsIn(glance!.body, "dt").map((term: RenderedElement): string => {
        return textIn(term.body);
      }),
    ).toEqual(["20", "5", "3", "Free"]);
    expect(elementsIn(glance!.body, "dd")).toHaveLength(4);
  });

  test("quotes the opening pages and offers to keep reading them in the reader", () => {
    const heading: RenderedElement | undefined = elementsIn(main, "h2").find(
      (candidate: RenderedElement): boolean => {
        return (
          attributeValue(candidate.attributes, "id") === "books-excerpt-heading"
        );
      },
    );
    const keepReading: Array<string> = openingTags(main, "a").filter(
      (anchor: string): boolean => {
        return attributeValue(anchor, "data-book-section") === "why";
      },
    );

    expect(textIn(heading!.body)).toBe(
      "You are allowed to run your own computers.",
    );
    expect(elementsIn(main, "blockquote")).toHaveLength(1);
    expect(keepReading.length).toBeGreaterThanOrEqual(1);
    for (const link of keepReading) {
      expect(attributeValue(link, "href")).toBe(`${BOOK_URL}about.html`);
    }
  });

  test("lists all twenty moves in reading order, grouped into the five stages", () => {
    const contents: string = sectionById(main, "inside-the-book");
    const moveLinks: Array<RenderedElement> = elementsIn(contents, "a").filter(
      (anchor: RenderedElement): boolean => {
        return (
          attributeValue(anchor.attributes, "href")?.startsWith(
            `${BOOK_URL}m/`,
          ) || false
        );
      },
    );

    expect(
      elementsIn(contents, "h3").map((heading: RenderedElement): string => {
        return textIn(heading.body);
      }),
    ).toEqual(["Decide", "Buy", "Build", "Move", "Run"]);
    expect(moveLinks).toHaveLength(20);
    expect(
      moveLinks.map((anchor: RenderedElement): string | undefined => {
        return attributeValue(anchor.attributes, "data-book-section");
      }),
    ).toEqual(
      allMoves.map((move: BookMove): string => {
        return move.sectionId;
      }),
    );

    moveLinks.forEach((anchor: RenderedElement, index: number): void => {
      const move: BookMove = allMoves[index]!;

      expect(attributeValue(anchor.attributes, "href")).toBe(move.webUrl);
      expect(hasAttribute(anchor.attributes, "data-book-open")).toBe(true);
      expect(textIn(anchor.body)).toContain(move.title);
      expect(textIn(anchor.body)).toContain(`Move ${move.number}`);
    });
  });

  test("each stage names its purpose and the condition that ends it", () => {
    const contents: string = sectionById(main, "inside-the-book");

    for (const stage of BackToMetal.stages) {
      expect(textIn(contents)).toContain(`Stage ${stage.number}`);
      expect(textIn(contents)).toContain(stage.summary);
      expect(textIn(contents)).toContain(stage.doneWhen);
    }
  });

  test.each([
    ["front", BackToMetal.frontMatter],
    ["back", BackToMetal.backMatter],
  ])(
    "links the %s matter into the reader with the website as the fallback",
    (_label: string, chapters: Array<BookChapter>) => {
      const contents: string = sectionById(main, "inside-the-book");

      for (const chapter of chapters) {
        const links: Array<string> = openingTags(contents, "a").filter(
          (anchor: string): boolean => {
            return (
              attributeValue(anchor, "data-book-section") === chapter.sectionId
            );
          },
        );

        expect(links).toHaveLength(1);
        expect(attributeValue(links[0]!, "href")).toBe(chapter.webUrl);
        expect(hasAttribute(links[0]!, "data-book-open")).toBe(true);
        expect(contents).toContain(`>${chapter.title}</a>`);
      }
    },
  );

  test.each([
    ["PDF", "Back-to-Metal.pdf"],
    ["EPUB", "Back-to-Metal.epub"],
  ])(
    "offers the %s edition at its official download URL",
    (format: string, fileName: string) => {
      const formats: string = sectionById(main, "reading-formats");
      const downloadLinks: Array<RenderedElement> = linkedElements(
        formats,
        `${BOOK_URL}${fileName}`,
      );

      expect(downloadLinks).toHaveLength(1);
      expect(textIn(downloadLinks[0]!.body).toUpperCase()).toContain(format);
      expect(hasAttribute(downloadLinks[0]!.attributes, "data-book-open")).toBe(
        false,
      );
    },
  );

  test("offers reading here and on the book's website as separate formats", () => {
    const formats: string = sectionById(main, "reading-formats");
    const websiteLinks: Array<RenderedElement> = linkedElements(
      formats,
      BOOK_URL,
    );
    const here: RenderedElement | undefined = websiteLinks.find(
      (anchor: RenderedElement): boolean => {
        return hasAttribute(anchor.attributes, "data-book-open");
      },
    );
    const online: RenderedElement | undefined = websiteLinks.find(
      (anchor: RenderedElement): boolean => {
        return !hasAttribute(anchor.attributes, "data-book-open");
      },
    );

    expect(websiteLinks).toHaveLength(2);
    expect(textIn(here!.body)).toContain("Read it here");
    expect(textIn(online!.body)).toContain("Read online");
  });

  test("all in-page links resolve to unique sections on the page", () => {
    const anchors: Array<RenderedElement> = elementsIn(main, "a").filter(
      (anchor: RenderedElement): boolean => {
        return (
          attributeValue(anchor.attributes, "href")?.startsWith("#") || false
        );
      },
    );
    const ids: Array<string> = [...html.matchAll(/\sid="([^"]+)"/g)].map(
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

  test("ids on the page are unique", () => {
    const ids: Array<string> = [...html.matchAll(/\sid="([^"]+)"/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(new Set<string>(ids).size).toBe(ids.length);
  });

  test("every reader trigger is a real https link to the book, so the page works without JavaScript", () => {
    const triggers: Array<string> = openingTags(html, "a").filter(
      (anchor: string): boolean => {
        return hasAttribute(anchor, "data-book-open");
      },
    );

    expect(triggers.length).toBeGreaterThanOrEqual(
      allMoves.length +
        BackToMetal.frontMatter.length +
        BackToMetal.backMatter.length +
        3,
    );

    for (const trigger of triggers) {
      const url: URL = new URL(attributeValue(trigger, "href")!);

      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("backtometal.oneuptime.com");
    }
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
      expect(anchor.attributes).not.toMatch(/\son[a-z]+=/i);
      expect(textIn(anchor.body).length).toBeGreaterThan(0);
    }
  });

  test("the returning-reader prompt is hidden until the script has something to resume", () => {
    const resume: string | undefined = openingTags(main, "div").find(
      (division: string): boolean => {
        return hasAttribute(division, "data-book-resume");
      },
    );
    const restart: Array<string> = openingTags(main, "a").filter(
      (anchor: string): boolean => {
        return hasAttribute(anchor, "data-book-start");
      },
    );

    expect(resume).toBeDefined();
    expect(hasAttribute(resume!, "hidden")).toBe(true);
    expect(restart).toHaveLength(1);
    expect(hasAttribute(restart[0]!, "data-book-open")).toBe(true);
  });
});

describe("the in-page reader", () => {
  let html: string = "";
  let dialog: string = "";

  beforeAll(async () => {
    html = await renderBooks();
    dialog = readerDialog(html);
  });

  test("lives outside <main> and is hidden until opened", () => {
    const main: string = elementsIn(html, "main")[0]!.body;
    const root: string = openingTags(dialog, "div")[0]!;

    expect(main).not.toContain('id="book-reader"');
    expect(hasAttribute(root, "hidden")).toBe(true);
  });

  test("is a labelled modal dialog", () => {
    const root: string = openingTags(dialog, "div")[0]!;
    const labelledBy: string = attributeValue(root, "aria-labelledby")!;
    const describedBy: string = attributeValue(root, "aria-describedby")!;

    expect(attributeValue(root, "role")).toBe("dialog");
    expect(attributeValue(root, "aria-modal")).toBe("true");
    expect(dialog).toContain(`id="${labelledBy}"`);
    expect(dialog).toContain(`id="${describedBy}"`);
    expect(
      textIn(
        elementsIn(dialog, "h2").find((heading: RenderedElement): boolean => {
          return attributeValue(heading.attributes, "id") === labelledBy;
        })!.body,
      ),
    ).toBe("Back to Metal");
  });

  test("is configured from the catalog", () => {
    const root: string = openingTags(dialog, "div")[0]!;

    expect(attributeValue(root, "data-content-url")).toBe(
      "/books/back-to-metal/content.json",
    );
    expect(attributeValue(root, "data-book-slug")).toBe("back-to-metal");
    expect(attributeValue(root, "data-book-title")).toBe("Back to Metal");
    expect(attributeValue(root, "data-book-author")).toBe("Nawaz Dhandala");
    expect(attributeValue(root, "data-cover-url")).toBe(COVER_PATH);
    expect(attributeValue(root, "data-site-url")).toBe(BOOK_URL);
    expect(attributeValue(root, "data-theme")).toBe("paper");
  });

  test.each([
    ["close", "Close the book"],
    ["prev", "Previous page"],
    ["next", "Next page"],
    ["settings", "Reading settings"],
    ["fullscreen", "Full screen"],
    ["font-smaller", "Smaller text"],
    ["font-larger", "Larger text"],
  ])("has a named %s button", (action: string, label: string) => {
    const buttons: Array<string> = openingTags(dialog, "button").filter(
      (button: string): boolean => {
        return attributeValue(button, "data-reader-action") === action;
      },
    );

    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(attributeValue(buttons[0]!, "type")).toBe("button");
    expect(attributeValue(buttons[0]!, "aria-label")).toBe(label);
  });

  test("the contents and settings panels are disclosed by buttons that control them", () => {
    for (const [action, id] of [
      ["contents", "bk-reader-contents"],
      ["settings", "bk-reader-settings"],
    ] as Array<[string, string]>) {
      const toggle: string = openingTags(dialog, "button").find(
        (button: string): boolean => {
          return (
            attributeValue(button, "data-reader-action") === action &&
            attributeValue(button, "aria-controls") === id
          );
        },
      )!;
      const panel: string = openingTags(dialog, "(nav|div)").find(
        (element: string): boolean => {
          return attributeValue(element, "id") === id;
        },
      )!;

      expect(attributeValue(toggle, "aria-expanded")).toBe("false");
      expect(hasAttribute(panel, "hidden")).toBe(true);
    }
  });

  test("offers three page colours as a radio group, paper selected", () => {
    const radios: Array<string> = openingTags(dialog, "button").filter(
      (button: string): boolean => {
        return attributeValue(button, "role") === "radio";
      },
    );

    expect(
      radios.map((radio: string): string | undefined => {
        return attributeValue(radio, "data-reader-theme");
      }),
    ).toEqual(["paper", "sepia", "night"]);
    expect(
      radios.map((radio: string): string | undefined => {
        return attributeValue(radio, "aria-checked");
      }),
    ).toEqual(["true", "false", "false"]);
    expect(dialog).toMatch(
      /role="radiogroup" aria-labelledby="bk-reader-theme-label"/,
    );
  });

  test("has a labelled page slider, a polite live region and a text alternative for screen readers", () => {
    const slider: string = openingTags(dialog, "input")[0]!;

    expect(attributeValue(slider, "type")).toBe("range");
    expect(dialog).toMatch(
      /<label class="bk-reader-scrubber-label">\s*<span class="sr-only">Go to page<\/span>/,
    );
    expect(dialog).toMatch(
      /class="bk-reader-live sr-only" role="status" aria-live="polite"/,
    );
    expect(dialog).toMatch(
      /class="bk-reader-text sr-only" role="document" aria-label="Text of the current chapter"/,
    );
  });

  test("the drawn book and the measuring room are hidden from assistive technology until built", () => {
    expect(dialog).toContain(
      '<div class="bk-book" data-mode="spread" data-state="closed"></div>',
    );
    expect(html).toContain('<div class="bk-measure" aria-hidden="true"></div>');
  });
});

describe("books page assets", () => {
  test("loads the stylesheet and the three scripts, deferred and in dependency order", async () => {
    const html: string = await renderBooks();
    const scripts: Array<string> = openingTags(html, "script")
      .map((script: string): string | undefined => {
        return attributeValue(script, "src");
      })
      .filter((source: string | undefined): source is string => {
        return Boolean(source) && !source!.startsWith("http");
      })
      .filter((source: string): boolean => {
        return source.startsWith("/js/");
      });

    expect(scripts).toEqual([
      "/js/book-reader-core.js",
      "/js/book-reader.js",
      "/js/books.js",
    ]);
    for (const source of scripts) {
      const tag: string = openingTags(html, "script").find(
        (script: string): boolean => {
          return attributeValue(script, "src") === source;
        },
      )!;

      expect(hasAttribute(tag, "defer")).toBe(true);
    }
    expect(html).toContain('<link rel="stylesheet" href="/css/books.css">');
  });

  test("uses content-versioned URLs when the route supplies them, and every asset exists", async () => {
    const assets: BookPageAssets = getBookPageAssets(STATIC_ROOT);
    const html: string = await renderBooks({ bookAssets: assets });

    for (const url of [
      assets.css,
      assets.coreJs,
      assets.readerJs,
      assets.pageJs,
    ]) {
      expect(url).toMatch(VERSIONED_ASSET);
      expect(html).toContain(`"${url}"`);
      expect(
        fs.existsSync(path.join(STATIC_ROOT, url.replace(/\?.*$/, ""))),
      ).toBe(true);
    }
  });

  test("loads the reading typeface without blocking the page", async () => {
    const html: string = await renderBooks();
    const fontLink: string | undefined = openingTags(html, "link").find(
      (link: string): boolean => {
        return (attributeValue(link, "href") || "").includes("family=Literata");
      },
    );

    expect(fontLink).toBeDefined();
    expect(attributeValue(fontLink!, "media")).toBe("print");
    // The value holds single quotes, which attributeValue() stops at.
    expect(fontLink).toContain(`onload="this.media='all'"`);
    expect(attributeValue(fontLink!, "href")).toContain("display=swap");
  });

  test("preloads the cover so the hero book paints early", async () => {
    const html: string = await renderBooks();

    expect(html).toContain(
      `<link rel="preload" as="image" href="${COVER_PATH}" fetchpriority="high">`,
    );
  });
});

describe("books page escaping", () => {
  const hostile: string =
    '"><img src=x onerror=alert(1)></script><script>alert(2)</script>';

  test("catalog text is escaped wherever it is rendered", async () => {
    const html: string = await renderBooks({
      book: {
        ...BackToMetal,
        title: `Back ${hostile}`,
        author: `Author ${hostile}`,
        subtitle: `Subtitle ${hostile}`,
        description: `Description ${hostile}`,
      },
    });

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(() => {
      structuredDataIn(html);
    }).not.toThrow();
  });

  test("structured data cannot close its script element", async () => {
    const html: string = await renderBooks({
      book: { ...BackToMetal, title: "</script><script>alert(3)</script>" },
    });
    const book: StructuredData | undefined = structuredDataIn(html).find(
      (schema: StructuredData): boolean => {
        return schema["@type"] === "Book";
      },
    );

    expect(html).not.toContain("<script>alert(3)</script>");
    expect(book?.["name"]).toBe("</script><script>alert(3)</script>");
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
    const canonicalLinks: Array<string> = openingTags(html, "link").filter(
      (link: string): boolean => {
        return attributeValue(link, "rel") === "canonical";
      },
    );

    expect(canonicalLinks).toHaveLength(1);
    expect(attributeValue(canonicalLinks[0]!, "href")).toBe(
      `${HOME_URL}/books`,
    );
    expect(metaContent(html, "og:url")).toBe(`${HOME_URL}/books`);
  });

  test("all structured data parses and identifies one free English book with both editions", () => {
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
      alternativeHeadline: "How a company leaves the cloud, one move at a time",
      url: BOOK_URL,
      image: `${HOME_URL}${COVER_PATH}`,
      author: { "@type": "Person", name: "Nawaz Dhandala" },
      publisher: { "@type": "Organization", name: "HackerBay, Inc." },
      inLanguage: "en",
      isAccessibleForFree: true,
      license: "https://creativecommons.org/licenses/by/4.0/",
      workExample: [
        expect.objectContaining({
          encodingFormat: "application/pdf",
          url: `${BOOK_URL}Back-to-Metal.pdf`,
        }),
        expect.objectContaining({
          encodingFormat: "application/epub+zip",
          url: `${BOOK_URL}Back-to-Metal.epub`,
        }),
      ],
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
    const stagingHtml: string = await renderBooks({ homeUrl: stagingUrl });
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

  test("a trailing slash on the website host does not double the cover path", async () => {
    const html: string = await renderBooks({
      homeUrl: "https://oneuptime.com/",
    });
    const book: StructuredData | undefined = structuredDataIn(html).find(
      (schema: StructuredData): boolean => {
        return schema["@type"] === "Book";
      },
    );

    expect(book?.["image"]).toBe(`${HOME_URL}${COVER_PATH}`);
  });

  test("escapes quotes and markup in SEO text without breaking structured data", async () => {
    const unsafeText: string =
      'Books " & </title><script id="books-meta-injection">alert(1)</script>';
    const escapedHtml: string = await renderBooks({
      seo: { title: unsafeText, description: unsafeText },
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
