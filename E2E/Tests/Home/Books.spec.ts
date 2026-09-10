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

interface ChapterPreview {
  stage: string;
  title: string;
  path: string;
}

const chapters: ChapterPreview[] = [
  {
    stage: "Decide",
    title: "The bill, and the three lines that are most of it",
    path: "m/01-the-bill-and-the-three-lines-that-are-most-of-it.html",
  },
  {
    stage: "Buy",
    title: "A cage, not a data centre",
    path: "m/07-a-cage-not-a-data-centre.html",
  },
  {
    stage: "Build",
    title: "The platform your workloads need",
    path: "m/11-the-platform-your-workloads-need.html",
  },
  {
    stage: "Move",
    title: "Postgres, the one that matters",
    path: "m/16-postgres-the-one-that-matters.html",
  },
  {
    stage: "Run",
    title: "Backups you have restored, and the pager",
    path: "m/19-backups-you-have-restored-and-the-pager.html",
  },
];

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
      "Books for people who build.",
      { useInnerText: true },
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Back to Metal",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Nawaz Dhandala");
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toHaveAttribute("href", "#main-content");
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

  test("offers the complete book online and in both downloadable formats", async ({
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
    await expect(formats.locator(`a[href="${bookUrl}"]`)).toHaveCount(1);
  });

  test("previews a real chapter from each of the five stages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(booksUrl);

    const preview: Locator = page.locator("#inside-the-book");
    await expect(preview.locator(`a[href^="${bookUrl}m/"]`)).toHaveCount(5);

    for (const chapter of chapters) {
      const link: Locator = preview.locator(
        `a[href="${bookUrl}${chapter.path}"]`,
      );
      await expect(link).toHaveCount(1);
      await expect(link).toContainText(chapter.title);
      await expect(link).toContainText(chapter.stage);
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

  test("the primary reading link works from the keyboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.route(bookUrl, async (route: Route): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!DOCTYPE html><html><body><h1>Back to Metal reader</h1></body></html>",
      });
    });
    await page.goto(booksUrl);

    const read: Locator = page.getByRole("link", {
      name: "Read the book",
      exact: true,
    });
    await read.focus();
    await expect(read).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(bookUrl);
    await expect(
      page.getByRole("heading", { name: "Back to Metal reader" }),
    ).toBeVisible();
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

  test("respects the reader's reduced-motion preference", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(booksUrl);
    await page
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
          level: 2,
          name: "Back to Metal",
          exact: true,
        }),
        main.getByText("Nawaz Dhandala", { exact: true }),
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Books for people who build.",
      { useInnerText: true },
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
    await expect(
      page.getByRole("heading", {
        level: 2,
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
    await page.setViewportSize({ width: 768, height: 900 });
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

  for (const width of [320, 390]) {
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
          node["@type"] === "Book" ||
          (Array.isArray(node["@type"]) && node["@type"].includes("Book"))
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

  for (const width of [320, 390, 768, 1440]) {
    test(`fits the page and its reading links at ${width}px`, async ({
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

      const formats: Locator = page.locator("#reading-formats");
      await formats.scrollIntoViewIfNeeded();
      await expect(
        formats.locator(`a[href="${bookUrl}Back-to-Metal.pdf"]`),
      ).toBeVisible();
      await expect(
        formats.locator(`a[href="${bookUrl}Back-to-Metal.epub"]`),
      ).toBeVisible();
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
          level: 2,
          name: "Back to Metal",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Read the book", exact: true }),
      ).toHaveAttribute("href", bookUrl);
      await expect(
        page.locator(`#reading-formats a[href="${bookUrl}Back-to-Metal.pdf"]`),
      ).toBeVisible();
      await expect(
        page.locator(`#reading-formats a[href="${bookUrl}Back-to-Metal.epub"]`),
      ).toBeVisible();

      await page
        .getByRole("link", { name: "Explore the book", exact: true })
        .click();
      await expect(page).toHaveURL(`${booksUrl}#inside-the-book`);
      await expect(page.locator("#inside-the-book")).toBeInViewport();
    });
  });
});
