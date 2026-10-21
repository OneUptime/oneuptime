import { Locator, Page, expect, test } from "@playwright/test";

/*
 * The pagination footer under every table, log and trace list, in a real
 * browser over an in-memory list of monitors (see Fixture/Fixture.js for the
 * query string). Each test drives the bar the way a reader does - a click, a
 * key, the rows-per-page select, the jump dialog - and checks both what the
 * bar now says and what the list was asked to fetch, "page/size", in
 * [data-testid=navigations].
 */

type OpenFunction = (page: Page, query?: string) => Promise<Locator>;

// Opens the list and returns the footer, by its landmark name.
const open: OpenFunction = async (
  page: Page,
  query: string = "",
): Promise<Locator> => {
  await page.goto(`/?${query}`);
  const footer: Locator = page.getByRole("navigation", {
    name: "Pagination for Monitors",
  });
  await expect(footer).toBeVisible();
  return footer;
};

type PageButtonFunction = (footer: Locator, pageNumber: number) => Locator;

// Any page number but the current one is named for where it goes.
const pageButton: PageButtonFunction = (
  footer: Locator,
  pageNumber: number,
): Locator => {
  return footer.getByRole("button", {
    name: `Go to page ${pageNumber}`,
    exact: true,
  });
};

type CurrentPageFunction = (footer: Locator) => Locator;

const currentPage: CurrentPageFunction = (footer: Locator): Locator => {
  return footer.locator('[aria-current="page"]');
};

type PageListFunction = (footer: Locator) => Locator;

/*
 * The numbered list, page numbers and gaps ("…") in order. Asserted with
 * toHaveText, which waits for the bar to re-render after a click.
 */
const pageList: PageListFunction = (footer: Locator): Locator => {
  return footer.locator(
    '[data-testid^="pagination-page-"], [data-testid^="pagination-ellipsis-"]',
  );
};

type RowsFunction = (page: Page) => Locator;

const rows: RowsFunction = (page: Page): Locator => {
  return page.getByRole("list", { name: "Monitors" }).getByRole("listitem");
};

test.describe("a list that fits on the bar", () => {
  test("arrows and page numbers move through the list, and the ends disable the arrows", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=23");
    const previous: Locator = footer.getByRole("button", {
      name: "Go to previous page",
    });
    const next: Locator = footer.getByRole("button", {
      name: "Go to next page",
    });

    // Three pages, all on the bar, no gaps.
    await expect(pageList(footer)).toHaveText(["1", "2", "3"]);
    await expect(currentPage(footer)).toHaveText("1");
    await expect(currentPage(footer)).toHaveAccessibleName("Page 1");
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 1-10 of 23 monitors",
    );
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(currentPage(footer)).toHaveText("2");
    await expect(rows(page).first()).toHaveText("Monitor 11");
    await expect(previous).toBeEnabled();

    // The last page is short: the summary and the rows say so.
    await pageButton(footer, 3).click();
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 21-23 of 23 monitors",
    );
    await expect(rows(page)).toHaveText([
      "Monitor 21",
      "Monitor 22",
      "Monitor 23",
    ]);
    await expect(next).toBeDisabled();

    await previous.click();
    await expect(currentPage(footer)).toHaveText("2");
    await expect(page.getByTestId("navigations")).toHaveText("2/10 3/10 2/10");
  });

  test("clicking the page already shown asks for nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=23&page=2");

    await currentPage(footer).click();
    await pageButton(footer, 1).click();
    await expect(currentPage(footer)).toHaveText("1");

    // Only the move to page 1 reached the list.
    await expect(page.getByTestId("navigations")).toHaveText("1/10");
  });

  test("the keyboard walks the bar and Enter or Space turns the page, keeping focus", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=23");
    const select: Locator = footer.getByLabel("Rows per page");

    await select.focus();
    // The disabled "previous" arrow is skipped: the next stop is page 1.
    await page.keyboard.press("Tab");
    await expect(currentPage(footer)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(pageButton(footer, 2)).toBeFocused();
    await page.keyboard.press("Enter");

    // The button pressed is now the current page, and still has focus.
    await expect(currentPage(footer)).toHaveText("2");
    await expect(currentPage(footer)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(pageButton(footer, 3)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(currentPage(footer)).toHaveText("3");

    // "Next" is disabled on the last page, so Tab leaves the bar.
    await page.keyboard.press("Tab");
    await expect(
      footer.getByRole("button", { name: "Go to next page" }),
    ).not.toBeFocused();
    await expect(page.getByTestId("navigations")).toHaveText("2/10 3/10");
  });

  test("one monitor and none read as a sentence, and an empty list cannot page", async ({
    page,
  }: {
    page: Page;
  }) => {
    let footer: Locator = await open(page, "total=1");
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 1 of 1 monitor",
    );

    footer = await open(page, "total=0");
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "No monitors",
    );
    await expect(pageList(footer)).toHaveText(["1"]);
    await expect(
      footer.getByRole("button", { name: "Go to previous page" }),
    ).toBeDisabled();
    await expect(
      footer.getByRole("button", { name: "Go to next page" }),
    ).toBeDisabled();
  });
});

test.describe("a long list", () => {
  test("the bar keeps both ends and collapses what lies between", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000");

    await expect(pageList(footer)).toHaveText(["1", "2", "3", "…", "100"]);
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 1-10 of 1,000 monitors",
    );

    // The last page is one click away, and the gap moves to the other side.
    await pageButton(footer, 100).click();
    await expect(pageList(footer)).toHaveText(["1", "…", "98", "99", "100"]);
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 991-1,000 of 1,000 monitors",
    );

    // From the middle there is a gap on each side.
    await page.goto("/?total=1000&page=50");
    await expect(pageList(footer)).toHaveText(["1", "…", "50", "…", "100"]);
    await expect(
      footer.getByRole("button", { name: "Go to a page in between" }),
    ).toHaveCount(2);

    /*
     * A gap never stands in for a single page: from page 3 only page 2 lies
     * between it and page 1, so it is shown rather than collapsed. From page
     * 4 two pages lie there, and they collapse.
     */
    await page.goto("/?total=1000&page=3");
    await expect(pageList(footer)).toHaveText(["1", "2", "3", "…", "100"]);
    await page.goto("/?total=1000&page=4");
    await expect(pageList(footer)).toHaveText(["1", "…", "4", "…", "100"]);
  });

  test("a gap opens the jump dialog, which takes a number and Enter", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000");

    await footer
      .getByRole("button", { name: "Go to a page in between" })
      .click();

    const dialog: Locator = page.getByRole("dialog", { name: "Go to page" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(
      "This list has 100 pages. Enter the one you want to see.",
    );

    const input: Locator = dialog.getByLabel("Page number");
    const submit: Locator = dialog.getByRole("button", {
      name: "Go to page",
      exact: true,
    });

    // The number box has focus, and the button waits for a number.
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "1-100");
    await expect(submit).toBeDisabled();

    await page.keyboard.type("42");
    await expect(submit).toBeEnabled();
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(currentPage(footer)).toHaveText("42");
    await expect(pageList(footer)).toHaveText(["1", "…", "42", "…", "100"]);
    await expect(rows(page).first()).toHaveText("Monitor 411");
    await expect(page.getByTestId("navigations")).toHaveText("42/10");
  });

  test("the jump dialog clamps a page past the end and ignores page 0", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000");
    const dialog: Locator = page.getByRole("dialog", { name: "Go to page" });

    await footer
      .getByRole("button", { name: "Go to a page in between" })
      .click();
    await dialog.getByLabel("Page number").fill("0");
    await page.keyboard.press("Enter");

    // Nothing to go to: the dialog stays, and nothing was asked for.
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("navigations")).toHaveText("");

    await dialog.getByLabel("Page number").fill("5000");
    await dialog
      .getByRole("button", { name: "Go to page", exact: true })
      .click();

    await expect(dialog).toBeHidden();
    await expect(currentPage(footer)).toHaveText("100");
    await expect(page.getByTestId("navigations")).toHaveText("100/10");
  });

  test("Escape and Cancel close the jump dialog without paging, and focus returns to the gap", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000&page=50");
    const dialog: Locator = page.getByRole("dialog", { name: "Go to page" });
    const laterGap: Locator = footer.getByTestId("pagination-ellipsis-end");

    // Opened from the keyboard, closed with Escape.
    await laterGap.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Page number").fill("7");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(laterGap).toBeFocused();

    // Reopened, the box is empty again - what was typed did not stick.
    await laterGap.click();
    await expect(dialog.getByLabel("Page number")).toHaveValue("");
    await dialog.getByLabel("Page number").fill("7");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await expect(currentPage(footer)).toHaveText("50");
    await expect(page.getByTestId("navigations")).toHaveText("");
  });
});

test.describe("rows per page", () => {
  test("a new page size goes back to page 1 with the new size", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000&page=7");
    const select: Locator = footer.getByLabel("Rows per page");

    await expect(select).toHaveValue("10");
    await select.selectOption("50");

    await expect(select).toHaveValue("50");
    await expect(currentPage(footer)).toHaveText("1");
    await expect(rows(page)).toHaveCount(50);
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 1-50 of 1,000 monitors",
    );
    // 1,000 rows at 50 a page: twenty pages, the last one on the bar.
    await expect(pageButton(footer, 20)).toBeVisible();
    await expect(page.getByTestId("navigations")).toHaveText("1/50");
  });

  test("a page size from a shared link is offered, selected and in order", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000&size=37");
    const select: Locator = footer.getByLabel("Rows per page");

    await expect(select).toHaveValue("37");

    const options: Array<number> = (
      await select.locator("option").allInnerTexts()
    ).map((text: string) => {
      return Number(text);
    });
    expect(options).toContain(37);
    expect(options).toContain(10);
    expect(options).toEqual(
      [...options].sort((a: number, b: number) => {
        return a - b;
      }),
    );
    expect(new Set(options).size).toBe(options.length);
    await expect(rows(page)).toHaveCount(37);
  });
});

test.describe("a frozen bar", () => {
  for (const state of ["loading", "error", "disabled"]) {
    test(`while ${state}, no control can page but the current page stays marked`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const footer: Locator = await open(
        page,
        `total=1000&page=50&state=${state}`,
      );

      await expect(footer.getByLabel("Rows per page")).toBeDisabled();
      for (const button of await footer.getByRole("button").all()) {
        await expect(button).toBeDisabled();
      }
      await expect(currentPage(footer)).toHaveText("50");

      await expect(footer.getByTestId("pagination-summary")).toHaveText(
        state === "loading"
          ? "Loading..."
          : "Showing 491-500 of 1,000 monitors",
      );

      // A forced click on a dead gap opens nothing.
      await footer
        .getByTestId("pagination-ellipsis-end")
        .click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("navigations")).toHaveText("");
    });
  }
});

test.describe("a list whose total is unknown", () => {
  test("only the arrows page, and the summary never claims a total", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=25&hasMore=1");
    const next: Locator = footer.getByRole("button", {
      name: "Go to next page",
    });

    // No numbered pages: there is no last page to number.
    await expect(pageList(footer)).toHaveCount(0);
    await expect(
      footer.getByTestId("pagination-current-page-indicator-desktop"),
    ).toHaveText("Page 1");
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 1-10+ monitors",
    );

    await next.click();
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 11-20+ monitors",
    );

    // The last page: what it shows, without the "+", and no way on.
    await next.click();
    await expect(
      footer.getByTestId("pagination-current-page-indicator-desktop"),
    ).toHaveText("Page 3");
    await expect(footer.getByTestId("pagination-summary")).toHaveText(
      "Showing 21-25 monitors",
    );
    await expect(next).toBeDisabled();
    await expect(rows(page)).toHaveCount(5);
    await expect(page.getByTestId("navigations")).toHaveText("2/10 3/10");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 760 } });

  test("the page list gives way to one indicator, which opens the jump dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=1000&page=3");

    await expect(footer.getByTestId("pagination-page-1")).toBeHidden();
    await expect(footer.getByTestId("pagination-ellipsis-end")).toBeHidden();

    const indicator: Locator = footer.getByTestId(
      "pagination-current-page-indicator",
    );
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveText("Page 3 of 100");
    await expect(indicator).toHaveAttribute("aria-haspopup", "dialog");

    await indicator.click();
    const dialog: Locator = page.getByRole("dialog", { name: "Go to page" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("80");
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(indicator).toHaveText("Page 80 of 100");
    await expect(page.getByTestId("navigations")).toHaveText("80/10");

    // The arrows stay, and stay usable.
    await footer.getByRole("button", { name: "Go to next page" }).click();
    await expect(indicator).toHaveText("Page 81 of 100");
  });

  test("a list too short for gaps shows plain text, not a button", async ({
    page,
  }: {
    page: Page;
  }) => {
    const footer: Locator = await open(page, "total=23&page=2");
    const indicator: Locator = footer.getByTestId(
      "pagination-current-page-indicator",
    );

    await expect(indicator).toHaveText("Page 2 of 3");
    await expect(
      footer.getByRole("button", { name: "Page 2 of 3" }),
    ).toHaveCount(0);

    // Nothing on the bar spills past the screen.
    const overflow: number = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
