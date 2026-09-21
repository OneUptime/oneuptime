import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Locator,
  Page,
  Response,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

const bookUrl: string = "https://backtometal.oneuptime.com/";
const booksUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/books")
  .toString();
const contentUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/books/back-to-metal/content.json")
  .toString();
const contentRoute: string = "**/books/back-to-metal/content.json";

interface ChapterPreview {
  stage: string;
  title: string;
  path: string;
  sectionId: string;
}

interface PrimaryActionStyle {
  backgroundColor: string;
  borderRadius: string;
  color: string;
  fontFamily: string;
  fontWeight: string;
}

interface HeadingTypography {
  fontFamily: string;
  fontStyle: string;
}

interface ReaderState {
  open: boolean;
  loaded: boolean;
  view: number;
  views: number;
  pages: number;
  mode: string | null;
  sectionId: string | null;
  turning: boolean;
  settings: { fontStep: number; theme: string };
}

interface FixtureSection {
  id: string;
  kind: "text" | "contents";
  title: string;
  label: string;
  number?: string;
  part?: string;
  html: string;
  words: number;
}

const chapters: ChapterPreview[] = [
  {
    stage: "Decide",
    title: "The bill, and the three lines that are most of it",
    path: "m/01-the-bill-and-the-three-lines-that-are-most-of-it.html",
    sectionId: "m01",
  },
  {
    stage: "Buy",
    title: "A cage, not a data centre",
    path: "m/07-a-cage-not-a-data-centre.html",
    sectionId: "m07",
  },
  {
    stage: "Build",
    title: "The platform your workloads need",
    path: "m/11-the-platform-your-workloads-need.html",
    sectionId: "m11",
  },
  {
    stage: "Move",
    title: "Postgres, the one that matters",
    path: "m/16-postgres-the-one-that-matters.html",
    sectionId: "m16",
  },
  {
    stage: "Run",
    title: "Backups you have restored, and the pager",
    path: "m/19-backups-you-have-restored-and-the-pager.html",
    sectionId: "m19",
  },
];

/*
 * A small book in the shape /books/back-to-metal/content.json serves, so the
 * reader tests do not depend on the book's website being reachable from the
 * test environment. The live route is checked separately below.
 */
const paragraphs: (count: number, topic: string) => string = (
  count: number,
  topic: string,
): string => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `<p>${topic}, paragraph ${index + 1}. Measure what you run before you buy anything, rehearse every cutover against a copy, and keep the rollback within reach: a plan short enough to finish is one you can carry at three in the morning.</p>`;
  }).join("");
};

const fixtureSections: Array<FixtureSection> = [
  {
    id: "titlepage",
    kind: "text",
    title: "Back to Metal",
    label: "Title page",
    html: '<div class="bk-front"><h1>Back to Metal</h1><p>How a company leaves the cloud, one move at a time</p><p>Nawaz Dhandala</p></div>',
    words: 12,
  },
  {
    id: "contents",
    kind: "contents",
    title: "Contents",
    label: "Contents",
    html: "",
    words: 0,
  },
  {
    id: "why",
    kind: "text",
    title: "Why this book exists",
    label: "Why this book exists",
    html: `<div class="bk-front"><h1>You are allowed to run your own computers</h1>${paragraphs(6, "Why")}</div>`,
    words: 400,
  },
  ...chapters.map((chapter: ChapterPreview, index: number): FixtureSection => {
    const number: string = chapter.sectionId.slice(1);
    return {
      id: chapter.sectionId,
      kind: "text",
      title: chapter.title,
      label: `${number} · ${chapter.title}`,
      number,
      part: `Stage ${index + 1} · ${chapter.stage}`,
      html: `<h1>${number} · ${chapter.title}</h1><p class="bk-hook">The hook of Move ${number}.</p><h2>Why this works</h2>${paragraphs(8, `Move ${number}`)}<p>Next: <a href="#read/why" data-book-section="why">Why this book exists</a>.</p>`,
      words: 600,
    };
  }),
];

const fixtureBook: Record<string, unknown> = {
  version: 1,
  slug: "back-to-metal",
  title: "Back to Metal",
  subtitle: "How a company leaves the cloud, one move at a time",
  author: "Nawaz Dhandala",
  publisher: "HackerBay, Inc.",
  language: "en",
  modified: "2026-09-14T15:33:10Z",
  coverUrl: "/img/books/back-to-metal.jpg",
  siteUrl: bookUrl,
  epubUrl: `${bookUrl}Back-to-Metal.epub`,
  pdfUrl: `${bookUrl}Back-to-Metal.pdf`,
  license: {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  sections: fixtureSections,
  toc: [
    { label: "Title page", sectionId: "titlepage", children: [] },
    { label: "Why this book exists", sectionId: "why", children: [] },
    ...chapters.map((chapter: ChapterPreview, index: number) => {
      const number: string = chapter.sectionId.slice(1);
      return {
        label: `Stage ${index + 1} · ${chapter.stage}`,
        sectionId: chapter.sectionId,
        children: [
          {
            label: `${number} · ${chapter.title}`,
            sectionId: chapter.sectionId,
            children: [],
          },
        ],
      };
    }),
  ],
};

async function serveFixtureBook(page: Page): Promise<void> {
  await page.route(contentRoute, async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(fixtureBook),
    });
  });
}

function reader(page: Page): Locator {
  return page.getByRole("dialog", { name: "Back to Metal" });
}

async function readerState(page: Page): Promise<ReaderState> {
  return page.evaluate((): ReaderState => {
    return (
      window as unknown as {
        OneUptimeBooks: { reader: { getState: () => ReaderState } };
      }
    ).OneUptimeBooks.reader.getState();
  });
}

async function waitForReaderAt(
  page: Page,
  predicate: (state: ReaderState) => boolean,
): Promise<ReaderState> {
  let state: ReaderState | null = null;
  await expect
    .poll(
      async (): Promise<boolean> => {
        state = await readerState(page);
        return !state.turning && predicate(state);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return state!;
}

/*
 * The fold only exists while a page turns, which can be over before a polling
 * assertion looks, so it is recorded the moment it is added.
 */
async function recordFolds(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const record: { foldDrawn: boolean } = window as unknown as {
      foldDrawn: boolean;
    };
    record.foldDrawn = false;
    new MutationObserver((mutations: MutationRecord[]): void => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if ((node as Element).classList?.contains("bk-turn")) {
            record.foldDrawn = true;
          }
        }
      }
    }).observe(document.querySelector(".bk-book")!, { childList: true });
  });
}

async function foldWasDrawn(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (window as unknown as { foldDrawn: boolean }).foldDrawn;
  });
}

async function openReader(page: Page): Promise<void> {
  await page
    .getByRole("main")
    .getByRole("link", { name: "Read the book", exact: true })
    .click();
  await expect(reader(page)).toBeVisible();
  await waitForReaderAt(page, (state: ReaderState): boolean => {
    return state.loaded && state.view >= 0;
  });
}

function structuredDataNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(structuredDataNodes);
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  const node: Record<string, unknown> = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(structuredDataNodes)];
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions: { content: number; viewport: number } = await page.evaluate(
    () => {
      return {
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      };
    },
  );
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function primaryActionStyle(
  locator: Locator,
): Promise<PrimaryActionStyle> {
  return locator.evaluate((element: HTMLElement): PrimaryActionStyle => {
    const style: CSSStyleDeclaration = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      color: style.color,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
    };
  });
}

test.describe("Home: Books", () => {
  test.skip(
    !IS_BILLING_ENABLED,
    "The marketing website is deployed only in billing-enabled environments.",
  );

  test.beforeEach(async ({ page }: { page: Page }) => {
    page.setDefaultNavigationTimeout(120000);
    // Keep the shared consent banner from obscuring the book's reading controls.
    await page.addInitScript((): void => {
      localStorage.setItem("cookiesAccepted", "false");
    });
  });

  test("serves the books page with an accessible heading hierarchy", async ({
    page,
  }: {
    page: Page;
  }) => {
    const response: Response | null = await page.goto(booksUrl);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Back to Metal",
      { useInnerText: false },
    );
    await expect(page.getByRole("main")).toContainText("Nawaz Dhandala");
    await expect(
      page.getByRole("heading", { level: 2, name: "Read it your way" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main-content");
    // The reader is outside <main> and hidden until opened.
    await expect(reader(page)).toBeHidden();
  });

  test("uses the marketing site's typography and primary action styling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL.toString());
    await page.evaluate(async (): Promise<void> => {
      await document.fonts.ready;
    });

    const homeTypography: HeadingTypography = await page
      .getByRole("heading", { level: 1 })
      .evaluate((heading: HTMLElement): HeadingTypography => {
        const style: CSSStyleDeclaration = getComputedStyle(heading);
        return { fontFamily: style.fontFamily, fontStyle: style.fontStyle };
      });
    const homePrimaryStyle: PrimaryActionStyle = await primaryActionStyle(
      page
        .locator("#hero-section")
        .getByRole("link", { name: "Get started free", exact: true }),
    );

    await page.goto(booksUrl);
    await page.evaluate(async (): Promise<void> => {
      await document.fonts.ready;
    });

    const bookHeadings: Array<HeadingTypography & { text: string }> = await page
      .getByRole("main")
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((headings: HTMLElement[]) => {
        const textElements: Element[] = headings.flatMap(
          (heading: HTMLElement): Element[] => {
            return [heading, ...heading.querySelectorAll("span, em, strong")];
          },
        );
        return textElements
          .filter((element: Element): boolean => {
            return (
              Boolean(element.textContent?.trim()) &&
              element.getAttribute("aria-hidden") !== "true"
            );
          })
          .map((element: Element): HeadingTypography & { text: string } => {
            const style: CSSStyleDeclaration = getComputedStyle(element);
            return {
              text: element.textContent?.trim() || "",
              fontFamily: style.fontFamily,
              fontStyle: style.fontStyle,
            };
          });
      });

    expect(bookHeadings.length).toBeGreaterThan(0);
    for (const heading of bookHeadings) {
      expect(heading, heading.text).toMatchObject({ ...homeTypography });
    }
    expect(
      await primaryActionStyle(
        page
          .getByRole("main")
          .getByRole("link", { name: "Read the book", exact: true }),
      ),
    ).toEqual(homePrimaryStyle);
  });

  test("publishes book-specific search and sharing metadata", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    await expect(page).toHaveTitle(/Books.*OneUptime/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Back to Metal/,
    );

    const canonical: Locator = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const canonicalUrl: globalThis.URL = new globalThis.URL(
      (await canonical.getAttribute("href")) || "",
    );
    expect(canonicalUrl.pathname).toBe("/books");
    expect(canonicalUrl.origin).toBe(new globalThis.URL(booksUrl).origin);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /Books/,
    );
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute("content", /Back to Metal/);

    const socialImage: Locator = page.locator('meta[property="og:image"]');
    await expect(socialImage).toHaveAttribute(
      "content",
      /\/img\/books\/books-social\.jpg$/,
    );
    const socialImageUrl: string =
      (await socialImage.getAttribute("content")) || "";
    const imageResponse: APIResponse = await page.request.get(socialImageUrl);
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["content-type"]).toContain("image/jpeg");
  });

  test("offers the complete book here, online and in both downloadable formats", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Read the book", exact: true }),
    ).toHaveAttribute("href", bookUrl);

    const formats: Locator = page.locator("#reading-formats");
    const pdf: Locator = formats.locator(
      `a[href="${bookUrl}Back-to-Metal.pdf"]`,
    );
    const epub: Locator = formats.locator(
      `a[href="${bookUrl}Back-to-Metal.epub"]`,
    );
    await expect(pdf).toHaveCount(1);
    await expect(pdf).toContainText(/PDF/);
    await expect(epub).toHaveCount(1);
    await expect(epub).toContainText(/EPUB/);
    await expect(formats.locator(`a[href="${bookUrl}"]`)).toHaveCount(2);
    await expect(
      formats.locator(`a[href="${bookUrl}"][data-book-open]`),
    ).toContainText("Read it here");
  });

  test("lists all twenty moves, including a real chapter from each stage", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const contents: Locator = page.locator("#inside-the-book");
    await expect(contents.locator(`a[href^="${bookUrl}m/"]`)).toHaveCount(20);
    await expect(contents.getByRole("heading", { level: 3 })).toHaveText([
      "Decide",
      "Buy",
      "Build",
      "Move",
      "Run",
    ]);

    for (const chapter of chapters) {
      const link: Locator = contents.locator(
        `a[href="${bookUrl}${chapter.path}"]`,
      );
      await expect(link).toHaveCount(1);
      await expect(link).toContainText(chapter.title);
      await expect(link).toContainText(chapter.stage);
      await expect(link).toHaveAttribute(
        "data-book-section",
        chapter.sectionId,
      );
    }
  });

  test("loads the local official book cover", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const cover: Locator = page.locator(
      '#main-content img[src="/img/books/back-to-metal.jpg"]',
    );
    await expect(cover).toHaveCount(1);
    await expect(cover).toHaveAttribute("alt", /Back to Metal/);
    await expect(cover).toBeVisible();
    await expect
      .poll(async () => {
        return cover.evaluate((element: HTMLImageElement): boolean => {
          return element.complete && element.naturalWidth > 0;
        });
      })
      .toBe(true);

    const response: APIResponse = await page.request.get(
      URL.fromString(BASE_URL.toString())
        .addRoute("/img/books/back-to-metal.jpg")
        .toString(),
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
  });

  test("serves the page's scripts and stylesheet under content-versioned URLs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const assets: string[] = await page.evaluate((): string[] => {
      const versioned: RegExp =
        /^\/(js\/(book-reader-core|book-reader|books)\.js|css\/books\.css)\?v=/;
      return [
        ...Array.from(document.querySelectorAll("script[src]")).map(
          (script: Element): string => {
            return script.getAttribute("src") || "";
          },
        ),
        ...Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
          (link: Element): string => {
            return link.getAttribute("href") || "";
          },
        ),
      ].filter((source: string): boolean => {
        return versioned.test(source);
      });
    });

    expect(assets).toHaveLength(4);
    for (const asset of assets) {
      const response: APIResponse = await page.request.get(
        new globalThis.URL(asset, booksUrl).toString(),
      );
      expect(response.status(), asset).toBe(200);
    }
  });

  test("the preview action scrolls to the contents", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const explore: Locator = page.getByRole("link", {
      name: "Explore the book",
      exact: true,
    });
    await expect(explore).toHaveAttribute("href", "#inside-the-book");
    await explore.click();

    await expect(page).toHaveURL(`${booksUrl}#inside-the-book`);
    await expect(page.locator("#inside-the-book")).toBeInViewport();
  });

  test("keyboard readers can skip the navigation and continue through the main content", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);
    await page.keyboard.press("Tab");

    const skip: Locator = page.getByRole("link", {
      name: "Skip to main content",
      exact: true,
    });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await expect(skip).toBeInViewport({ ratio: 1 });
    const skipDimensions: { width: number; height: number } | null =
      await skip.boundingBox();
    expect(skipDimensions?.width).toBeGreaterThan(1);
    expect(skipDimensions?.height).toBeGreaterThan(1);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${booksUrl}#main-content`);
    const main: Locator = page.getByRole("main");
    await expect(main).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(main.getByRole("link").first()).toBeFocused();
  });

  test("respects the reader's reduced-motion preference on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(booksUrl);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Read the book", exact: true })
      .hover();

    const motionElements: string[] = await page
      .getByRole("main")
      .evaluate((main: HTMLElement): string[] => {
        return [...main.querySelectorAll("*")]
          .filter((element: Element): boolean => {
            const style: CSSStyleDeclaration = getComputedStyle(element);
            const hasTransition: boolean = style.transitionDuration
              .split(",")
              .some((duration: string): boolean => {
                return parseFloat(duration) > 0;
              });
            const hasAnimation: boolean =
              style.animationName !== "none" &&
              style.animationDuration
                .split(",")
                .some((duration: string): boolean => {
                  return parseFloat(duration) > 0;
                });
            return hasTransition || hasAnimation;
          })
          .map((element: Element): string => {
            return `${element.tagName.toLowerCase()}.${element.className}`;
          });
      });
    expect(motionElements).toEqual([]);
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`the book identity and reading action fit the first viewport at ${viewport.width}x${viewport.height}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(booksUrl);
      await page.evaluate(async (): Promise<void> => {
        await document.fonts.ready;
      });

      const main: Locator = page.getByRole("main");
      for (const content of [
        main.getByRole("heading", {
          level: 1,
          name: "Back to Metal",
          exact: true,
        }),
        main.getByText("Nawaz Dhandala", { exact: true }).first(),
        main.getByRole("link", { name: "Read the book", exact: true }),
      ]) {
        await expect(content).toBeInViewport({ ratio: 1 });
      }
      expect(
        await page.evaluate((): number => {
          return window.scrollY;
        }),
      ).toBe(0);
    });
  }

  for (const width of [320, 1440]) {
    test(`keeps the free-reading mark inline at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(booksUrl);

      const note: Locator = page.locator(".books-free-note");
      const mark: Locator = note.locator("svg");
      await expect(note).toBeVisible();
      await expect(mark).toBeVisible();

      const noteBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await note.boundingBox();
      const markBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await mark.boundingBox();

      expect(noteBounds).not.toBeNull();
      expect(markBounds).not.toBeNull();
      expect(markBounds!.width).toBeGreaterThanOrEqual(12);
      expect(markBounds!.width).toBeLessThanOrEqual(20);
      expect(markBounds!.height).toBeGreaterThanOrEqual(12);
      expect(markBounds!.height).toBeLessThanOrEqual(20);
      expect(markBounds!.x).toBeGreaterThanOrEqual(noteBounds!.x);
      expect(markBounds!.x + markBounds!.width).toBeLessThanOrEqual(
        noteBounds!.x + noteBounds!.width,
      );
      expect(
        Math.abs(
          markBounds!.y +
            markBounds!.height / 2 -
            (noteBounds!.y + noteBounds!.height / 2),
        ),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("the desktop Resources menu links to Books", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL.toString());
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Resources", exact: true })
      .click();

    const books: Locator = page.locator('#resources-menu a[href="/books"]');
    await expect(books).toBeVisible();
    await expect(books).toContainText("Books");
    await books.click();

    await expect(page).toHaveURL(booksUrl);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Back to Metal",
    );
  });

  test("the mobile menu links to Books", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL.toString());
    await page.getByRole("button", { name: "Open menu", exact: true }).click();

    const books: Locator = page.locator('#mobile-menu a[href="/books"]');
    await expect(books).toBeVisible();
    await expect(books).toContainText("Books");
    await books.click();

    await expect(page).toHaveURL(booksUrl);
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Back to Metal",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("closed desktop menus do not widen the page after use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(booksUrl);

    for (const entry of [
      { name: "Resources", id: "resources-menu" },
      { name: "Enterprise", id: "solutions-menu" },
    ]) {
      const menu: Locator = page.locator(`#${entry.id}`);
      await page
        .getByRole("banner")
        .getByRole("button", { name: entry.name, exact: true })
        .click();
      await expect(menu).toBeVisible();
      await expect(menu).toHaveJSProperty("hidden", false);

      await page.mouse.move(4, 4);
      await expect(menu).toHaveJSProperty("hidden", true);
      await expect(menu).toBeHidden();
      await expectNoHorizontalOverflow(page);
    }
  });

  for (const width of [320, 390, 768]) {
    test(`the mobile menu opens and closes within ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(booksUrl);
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();

      const menu: Locator = page.locator("#mobile-menu");
      const close: Locator = menu.getByRole("button", {
        name: "Close menu",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(menu).toHaveJSProperty("hidden", false);
      await expect(close).toBeInViewport({ ratio: 1 });
      await close.click();

      await expect(menu).toHaveJSProperty("hidden", true);
      await expect(menu).toBeHidden();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("Books is discoverable in the shared footer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(BASE_URL.toString());

    const books: Locator = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Books", exact: true });
    await expect(books).toHaveAttribute("href", "/books");
    await books.click();
    await expect(page).toHaveURL(booksUrl);
  });

  test("publishes the book identity as valid structured data", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const scripts: string[] = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(scripts.length).toBeGreaterThan(0);
    const nodes: Record<string, unknown>[] = scripts.flatMap(
      (script: string) => {
        return structuredDataNodes(JSON.parse(script) as unknown);
      },
    );
    const books: Record<string, unknown>[] = nodes.filter(
      (node: Record<string, unknown>): boolean => {
        return (
          (node["@type"] === "Book" ||
            (Array.isArray(node["@type"]) && node["@type"].includes("Book"))) &&
          node["name"] === "Back to Metal"
        );
      },
    );

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      name: "Back to Metal",
      url: bookUrl,
      author: { "@type": "Person", name: "Nawaz Dhandala" },
    });
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`fits the cover and usable reading links without clipping at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(booksUrl);
      await page.evaluate(async (): Promise<void> => {
        await document.fonts.ready;
      });

      await expectNoHorizontalOverflow(page);

      const viewportWidth: number = await page.evaluate((): number => {
        return document.documentElement.clientWidth;
      });
      const logo: Locator = page
        .getByRole("banner")
        .getByRole("img", { name: "OneUptime logo", exact: true });
      await expect(logo).toBeVisible();
      await expect(logo).toBeInViewport({ ratio: 0.99 });
      const logoBounds: { x: number; width: number } | null =
        await logo.boundingBox();
      expect(logoBounds).not.toBeNull();
      expect(logoBounds!.width).toBeGreaterThanOrEqual(100);
      expect(logoBounds!.x).toBeGreaterThanOrEqual(-1);
      expect(logoBounds!.x + logoBounds!.width).toBeLessThanOrEqual(
        viewportWidth + 1,
      );

      const cover: Locator = page.locator(
        '#main-content img[src="/img/books/back-to-metal.jpg"]',
      );
      await cover.scrollIntoViewIfNeeded();
      // Allow subpixel scroll rounding while catching clipping by the cover's frame.
      await expect(cover).toBeInViewport({ ratio: 0.9 });

      const formats: Locator = page.locator("#reading-formats");
      await formats.scrollIntoViewIfNeeded();
      await expect(
        formats.locator(`a[href="${bookUrl}Back-to-Metal.pdf"]`),
      ).toBeVisible();
      await expect(
        formats.locator(`a[href="${bookUrl}Back-to-Metal.epub"]`),
      ).toBeVisible();

      const readingLinks: Locator = page.locator(
        `#inside-the-book a[href^="${bookUrl}m/"], #reading-formats a[href^="${bookUrl}"]`,
      );
      await expect(readingLinks).toHaveCount(24);
      for (const link of await readingLinks.all()) {
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport({ ratio: 0.99 });

        const bounds: { x: number; width: number; height: number } | null =
          await link.boundingBox();
        const description: string = (await link.textContent())?.trim() || "";
        expect(bounds, description).not.toBeNull();
        expect(bounds!.width, description).toBeGreaterThanOrEqual(44);
        expect(bounds!.height, description).toBeGreaterThanOrEqual(44);
        expect(bounds!.x, description).toBeGreaterThanOrEqual(-1);
        expect(bounds!.x + bounds!.width, description).toBeLessThanOrEqual(
          viewportWidth + 1,
        );
      }
    });
  }

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the book and downloads remain available", async ({
      page,
    }: {
      page: Page;
    }) => {
      const response: Response | null = await page.goto(booksUrl);
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Back to Metal",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("main")
          .getByRole("link", { name: "Read the book", exact: true }),
      ).toHaveAttribute("href", bookUrl);
      await expect(
        page.locator(`#reading-formats a[href="${bookUrl}Back-to-Metal.pdf"]`),
      ).toBeVisible();
      await expect(
        page.locator(`#reading-formats a[href="${bookUrl}Back-to-Metal.epub"]`),
      ).toBeVisible();
      await expect(page.locator("#book-reader")).toBeHidden();

      await page
        .getByRole("link", { name: "Explore the book", exact: true })
        .click();
      await expect(page).toHaveURL(`${booksUrl}#inside-the-book`);
      await expect(page.locator("#inside-the-book")).toBeInViewport();
    });
  });

  test.describe("the book's text route", () => {
    test("serves the reader's JSON, or a clear fallback when the book's website is unreachable", async ({
      page,
    }: {
      page: Page;
    }) => {
      const response: APIResponse = await page.request.get(contentUrl, {
        timeout: 60000,
      });
      const body: Record<string, unknown> = (await response.json()) as Record<
        string,
        unknown
      >;

      expect(response.headers()["content-type"]).toContain("application/json");
      expect(response.headers()["x-content-type-options"]).toContain("nosniff");

      if (response.status() === 503) {
        // The test environment may have no route to the book's website.
        expect(body["readOnlineUrl"]).toBe(bookUrl);
        expect(response.headers()["retry-after"]).toBe("60");
        return;
      }

      expect(response.status()).toBe(200);
      expect(body).toMatchObject({
        slug: "back-to-metal",
        title: "Back to Metal",
        author: "Nawaz Dhandala",
      });
      const sections: Array<Record<string, unknown>> = body[
        "sections"
      ] as Array<Record<string, unknown>>;
      expect(sections.length).toBeGreaterThan(20);
      expect(
        sections.map((section: Record<string, unknown>): unknown => {
          return section["id"];
        }),
      ).toEqual(expect.arrayContaining(["m01", "m20", "contents"]));
      for (const section of sections) {
        expect(String(section["html"])).not.toMatch(
          /<script|onerror=|javascript:/i,
        );
      }

      const etag: string = response.headers()["etag"] || "";
      expect(etag).toMatch(/^"[^"]+"$/);
      const revalidated: APIResponse = await page.request.get(contentUrl, {
        headers: { "If-None-Match": etag },
      });
      expect(revalidated.status()).toBe(304);
    });

    test("answers an unknown book with a JSON 404", async ({
      page,
    }: {
      page: Page;
    }) => {
      const response: APIResponse = await page.request.get(
        URL.fromString(BASE_URL.toString())
          .addRoute("/books/not-a-book/content.json")
          .toString(),
      );

      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"]).toContain("application/json");
    });
  });

  test.describe("the in-page reader", () => {
    test.beforeEach(async ({ page }: { page: Page }) => {
      await serveFixtureBook(page);
    });

    test("opens the book in a dialog, turns pages from the keyboard and closes back to the page", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(booksUrl);

      const trigger: Locator = page
        .getByRole("main")
        .getByRole("link", { name: "Read the book", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");

      await expect(reader(page)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${booksUrl}#read`));
      const opened: ReaderState = await waitForReaderAt(
        page,
        (state: ReaderState): boolean => {
          return state.view === 0;
        },
      );
      expect(opened.mode).toBe("spread");
      await expect(reader(page).locator(".bk-reader-pages")).toHaveText(
        `Page 1 of ${opened.pages}`,
      );
      await expect(
        reader(page).getByRole("button", { name: "Close the book" }),
      ).toBeFocused();

      await recordFolds(page);
      await page.keyboard.press("ArrowRight");
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.view === 1;
      });
      expect(await foldWasDrawn(page)).toBe(true);
      await expect(page.locator(".bk-book .bk-turn")).toHaveCount(0);
      await expect(reader(page).locator(".bk-reader-pages")).toHaveText(
        `Pages 2–3 of ${opened.pages}`,
      );

      await page.keyboard.press("Escape");
      await expect(reader(page)).toBeHidden();
      await expect(page).toHaveURL(booksUrl);
      await expect(trigger).toBeFocused();
    });

    test("opens a move from the contents list at that chapter", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(booksUrl);

      await page
        .locator("#inside-the-book")
        .locator(`a[data-book-section="m07"]`)
        .click();

      await expect(reader(page)).toBeVisible();
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m07";
      });
      await expect(page).toHaveURL(`${booksUrl}#read/m07`);
      await expect(reader(page).locator(".bk-reader-location")).toContainText(
        "A cage, not a data centre",
      );
      await expect(
        reader(page).locator('.bk-page[data-section="m07"]').first(),
      ).toContainText("A cage, not a data centre");
    });

    test("a deep link opens the reader at the linked chapter", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${booksUrl}#read/m11`);

      await expect(reader(page)).toBeVisible();
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m11";
      });
    });

    test("the contents drawer lists the book with page numbers and jumps to a chapter", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(booksUrl);
      await openReader(page);

      const toggle: Locator = reader(page).getByRole("button", {
        name: "Contents",
        exact: true,
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      const drawer: Locator = reader(page).getByRole("navigation", {
        name: "Contents of Back to Metal",
      });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText("Stage 4 · Move")).toBeVisible();
      const entry: Locator = drawer.locator('a[data-book-section="m16"]');
      await expect(entry.locator(".bk-drawer-page")).toHaveText(/^\d+$/);
      await entry.click();

      await expect(drawer).toBeHidden();
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m16";
      });
    });

    test("changes the page colour and text size, and keeps the reading position", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${booksUrl}#read/m16`);
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m16";
      });

      await reader(page)
        .getByRole("button", { name: "Reading settings" })
        .click();
      await reader(page).getByRole("radio", { name: "Night" }).click();
      await expect(reader(page)).toHaveAttribute("data-theme", "night");
      await expect(
        reader(page).getByRole("radio", { name: "Night" }),
      ).toHaveAttribute("aria-checked", "true");

      const before: ReaderState = await readerState(page);
      await reader(page).getByRole("button", { name: "Larger text" }).click();
      const after: ReaderState = await waitForReaderAt(
        page,
        (state: ReaderState): boolean => {
          return state.settings.fontStep === before.settings.fontStep + 1;
        },
      );
      expect(after.pages).toBeGreaterThanOrEqual(before.pages);
      expect(after.sectionId).toBe("m16");
    });

    test("remembers where the reader stopped and offers to continue", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${booksUrl}#read/m11`);
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m11";
      });
      await page.keyboard.press("Escape");
      await expect(reader(page)).toBeHidden();

      await page.goto(booksUrl);
      const resume: Locator = page.locator("[data-book-resume]");
      await expect(resume).toBeVisible();
      await expect(resume).toContainText("Continue reading");
      await expect(resume).toContainText("Move 11");

      await resume.getByRole("link", { name: /Continue reading/ }).click();
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.sectionId === "m11";
      });
    });

    test("turns a page when its corner is dragged across the spine", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(booksUrl);
      await openReader(page);

      const book: { x: number; y: number; width: number; height: number } =
        (await page.locator(".bk-book").boundingBox())!;
      const startX: number = book.x + book.width - 10;
      const startY: number = book.y + book.height - 14;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(book.x + book.width * 0.55, startY - 40, {
        steps: 8,
      });
      await expect(page.locator(".bk-book .bk-turn")).toHaveCount(1);
      await page.mouse.move(book.x + book.width * 0.2, startY - 20, {
        steps: 8,
      });
      await page.mouse.up();

      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.view === 1;
      });
    });

    test("shows a single page on a phone and turns it with a tap on the page edge", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(booksUrl);
      await openReader(page);

      const opened: ReaderState = await readerState(page);
      expect(opened.mode).toBe("single");
      await expect(
        page.locator(".bk-book .bk-slot--right .bk-page"),
      ).toHaveCount(1);

      const book: { x: number; y: number; width: number; height: number } =
        (await page.locator(".bk-book").boundingBox())!;
      await page.mouse.click(
        book.x + book.width - 20,
        book.y + book.height / 2,
      );
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.view === 1;
      });
      await expectNoHorizontalOverflow(page);
    });

    test("turns pages without animation for readers who prefer reduced motion", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(booksUrl);
      await openReader(page);

      await recordFolds(page);
      await page.keyboard.press("ArrowRight");
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.view === 1;
      });
      expect(await foldWasDrawn(page)).toBe(false);
    });

    test("explains when the book cannot be loaded and links to its website", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.unroute(contentRoute);
      await page.route(contentRoute, async (route: Route): Promise<void> => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        });
      });
      await page.goto(booksUrl);
      await page
        .getByRole("main")
        .getByRole("link", { name: "Read the book", exact: true })
        .click();

      await expect(reader(page)).toBeVisible();
      await expect(reader(page).locator(".bk-reader-status")).toContainText(
        "could not be opened",
      );
      await expect(
        reader(page).getByRole("link", {
          name: "Read it on the book’s website",
        }),
      ).toHaveAttribute("href", bookUrl);

      await page.unroute(contentRoute);
      await serveFixtureBook(page);
      await reader(page).getByRole("button", { name: "Try again" }).click();
      await waitForReaderAt(page, (state: ReaderState): boolean => {
        return state.loaded && state.view >= 0;
      });
    });
  });
});
