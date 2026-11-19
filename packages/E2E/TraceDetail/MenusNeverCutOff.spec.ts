import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { DrawnPopup, expectDrawnWhole } from "../SuiteHelpers/Popups";

/*
 * A TRACE'S LOGS AND SPANS: THEIR MENUS ARE NEVER CUT OFF.
 *
 * #9859: without a filter bar, the logs viewer draws its toolbar inside the
 * list's card, which hides what runs past it. Over a trace's empty logs the
 * card is a few rows tall, and the Columns panel and the keyboard shortcuts
 * lost everything past the card's foot.
 *
 * #9861: the Copy attributes menu opened under its caret, in place. In the
 * last expanded log row, inside a list that scrolls sideways (which clips up
 * and down too), and near a span panel's foot, its foot was cut off.
 *
 * Every one of them is drawn on the page's body now (LayeredPopover), placed
 * against the window: whole at its four corners, above its control where
 * the window has no room under it, and inside the window's sides on a
 * tablet and a phone. The keyboard goes through each as if it sat right
 * after its control, and Escape closes it and hands the focus back.
 *
 * On the real trace page (Fixture/Fixture.js), in Chromium. Screenshots land
 * in output/playwright/trace-detail-ui.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const EBPF_TRACE: string = "1e8f0c2a9b7d4e6f8a1b2c3d4e5f6a7b";
const CHECKOUT_TRACE: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/trace-detail-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

async function openTrace(
  page: Page,
  trace: string,
  query: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(
    `/dashboard/${PROJECT_ID}/traces/view/${trace}${query ? `?${query}` : ""}`,
  );
  await expect(page.getByTestId("trace-header")).toBeVisible({
    timeout: 60000,
  });
}

/*
 * The eBPF trace's logs linked by its ID: there are none, so the list's
 * card is its toolbar, its header and its empty line.
 */
async function openEmptyTraceLogs(
  page: Page,
  size: { width: number; height: number },
): Promise<Locator> {
  await openTrace(page, EBPF_TRACE, "trace=ebpf", size);
  await page.getByTestId("trace-logs-scope-trace").click();
  await expect(
    page.getByText("Logs that carry this trace's ID appear here.").first(),
  ).toBeVisible({ timeout: 30000 });

  const toolbar: Locator = page
    .getByTestId("trace-signals")
    .getByTestId("logs-viewer-toolbar");

  await expect(toolbar).toBeVisible();
  await toolbar.scrollIntoViewIfNeeded();

  return toolbar;
}

// The list's card around the toolbar: what used to cut its menus off.
function listCard(page: Page): Locator {
  return page
    .getByTestId("trace-signals")
    .getByTestId("logs-viewer-list")
    .locator("> div")
    .first();
}

interface ToolbarMenu {
  name: string;
  open: (toolbar: Locator) => Promise<void>;
  panel: (page: Page) => Locator;
}

const TOOLBAR_MENUS: Array<ToolbarMenu> = [
  {
    name: "Columns",
    open: async (toolbar: Locator): Promise<void> => {
      await toolbar.getByRole("button", { name: /^Columns \d+$/ }).click();
    },
    panel: (page: Page): Locator => {
      return page.getByTestId("column-selector-panel");
    },
  },
  {
    name: "the keyboard shortcuts",
    open: async (toolbar: Locator): Promise<void> => {
      await toolbar.getByTitle("Keyboard shortcuts (?)").click();
    },
    panel: (page: Page): Locator => {
      return page.getByTestId("keyboard-shortcuts-help");
    },
  },
  {
    name: "Export",
    open: async (toolbar: Locator): Promise<void> => {
      await toolbar
        .getByRole("button", { name: "Export", exact: true })
        .click();
    },
    panel: (page: Page): Locator => {
      return page.getByTestId("logs-viewer-export-menu");
    },
  },
  {
    name: "the time range",
    open: async (toolbar: Locator): Promise<void> => {
      await toolbar.getByTestId("log-time-range-picker-button").click();
    },
    panel: (page: Page): Locator => {
      return page.getByTestId("log-time-range-picker-dropdown");
    },
  },
];

const SIZES: Array<{ name: string; width: number; height: number }> = [
  { name: "a laptop", width: 1440, height: 1000 },
  { name: "a tablet", width: 820, height: 1180 },
  { name: "a phone", width: 390, height: 844 },
];

test.describe("a trace's logs with no filter bar: the toolbar's menus are whole (#9859)", () => {
  for (const size of SIZES) {
    test(`on ${size.name}, over the trace's empty logs, every menu of the toolbar is drawn over the page, whole`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const toolbar: Locator = await openEmptyTraceLogs(page, size);
      const card: Locator = listCard(page);

      for (const menu of TOOLBAR_MENUS) {
        await menu.open(toolbar);

        const panel: Locator = menu.panel(page);
        await expect(panel).toBeVisible();

        await expectDrawnWhole(panel, `${menu.name} on ${size.name}`);
        // Not inside the list's card, which used to cut it off.
        expect(
          await card.evaluate(
            (element: Element, panelId: string): boolean => {
              return Boolean(
                element.querySelector(`[data-testid="${panelId}"]`),
              );
            },
            (await panel.getAttribute("data-testid")) || "",
          ),
          `${menu.name} is not inside the list's card`,
        ).toBe(false);

        if (menu.name === "Columns") {
          await screenshot(page, `menus-never-cut-off-columns-${size.width}`);
        }

        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
      }
    });
  }

  test("the keyboard goes through Columns as if it sat after its button, and Escape hands the focus back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const toolbar: Locator = await openEmptyTraceLogs(page, {
      width: 1440,
      height: 1000,
    });
    const button: Locator = toolbar.getByRole("button", {
      name: /^Columns \d+$/,
    });

    await button.focus();
    await page.keyboard.press("Enter");

    const panel: Locator = page.getByTestId("column-selector-panel");
    await expect(panel).toBeVisible();
    await expect(button).toBeFocused();

    // Tab from the button: into the panel, drawn at the end of the page.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Reset" })).toBeFocused();

    // Shift+Tab: back to the button.
    await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
    await expect(panel).toBeVisible();

    // Escape from inside closes it, and the focus is back on the button.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();

    // Escape was spent on the panel: the trace page is still here.
    await expect(page.getByTestId("trace-signals")).toBeVisible();
  });

  test("a press outside a menu closes it; a press inside does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    const toolbar: Locator = await openEmptyTraceLogs(page, {
      width: 1440,
      height: 1000,
    });

    await toolbar.getByRole("button", { name: /^Columns \d+$/ }).click();

    const panel: Locator = page.getByTestId("column-selector-panel");
    await panel.getByPlaceholder("Search or type attribute").click();
    await expect(panel).toBeVisible();

    await page.getByTestId("trace-header").click({ position: { x: 4, y: 4 } });
    await expect(panel).toHaveCount(0);
  });
});

test.describe("the Copy attributes menu is whole (#9861)", () => {
  test("in the last expanded log row, inside a list that scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The eBPF trace's pod logs: six lines, each with one attribute.
    await openTrace(page, EBPF_TRACE, "trace=ebpf", {
      width: 1440,
      height: 1000,
    });

    const table: Locator = page
      .getByTestId("trace-signals")
      .getByTestId("logs-table");
    await expect(table.locator("tbody > tr").first()).toBeVisible({
      timeout: 30000,
    });
    await table.locator("tbody > tr").last().click();

    const copy: Locator = page
      .getByTestId("trace-signals")
      .getByTestId("log-attributes-copy-json");
    await copy.scrollIntoViewIfNeeded();
    await copy.getByRole("button", { name: "Choose JSON format" }).click();

    const menu: Locator = page.getByRole("menu", {
      name: "Copy attributes as",
    });
    await expect(menu).toBeVisible();
    await expectDrawnWhole(menu, "the Copy attributes menu in a log row");

    // The list behind it did not grow to hold it: it scrolls no further.
    expect(
      await table
        .locator("> div")
        .first()
        .evaluate((box: Element): number => {
          return box.scrollHeight - box.clientHeight;
        }),
    ).toBeLessThanOrEqual(1);

    await screenshot(page, "copy-attributes-log-row-1440");
  });

  test("near a span panel's foot, it opens above its caret, whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTrace(page, CHECKOUT_TRACE, "", { width: 1280, height: 640 });

    const reserve: string = await page.evaluate((): string => {
      const spans: Array<{ name: string; spanId: string }> = (
        window as unknown as {
          __traceFixture: { spans: Array<{ name: string; spanId: string }> };
        }
      ).__traceFixture.spans;

      return spans.find((span: { name: string }): boolean => {
        return span.name === "POST /reserve";
      })!.spanId;
    });

    await page
      .locator(`[data-testid="trace-waterfall-row"][data-span-id="${reserve}"]`)
      .click();

    const panel: Locator = page.getByTestId("trace-span-panel");
    await panel.getByTestId("span-panel-tab-events").click();
    await panel.getByTestId("span-events").locator("summary").last().click();

    const copy: Locator = panel
      .getByTestId("span-event-attributes-copy-json")
      .last();
    await expect(copy).toBeVisible();
    await copy.getByRole("button", { name: "Choose JSON format" }).click();

    const menu: Locator = page.getByRole("menu", {
      name: "Copy attributes as",
    });
    await expect(menu).toBeVisible();

    const drawn: DrawnPopup = await expectDrawnWhole(
      menu,
      "the Copy attributes menu near the span panel's foot",
    );

    // No room under the caret in a 640px window: above it, its end on the caret's end.
    expect(drawn.placement).toBe("top-end");

    await screenshot(page, "copy-attributes-span-panel-1280x640");
  });

  test("the keyboard: the arrows open it on the shape in use, Escape hands the focus back, Tab goes on from the caret", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTrace(page, EBPF_TRACE, "trace=ebpf", {
      width: 1440,
      height: 1000,
    });

    const table: Locator = page
      .getByTestId("trace-signals")
      .getByTestId("logs-table");
    await expect(table.locator("tbody > tr").first()).toBeVisible({
      timeout: 30000,
    });
    await table.locator("tbody > tr").last().click();

    const copy: Locator = page
      .getByTestId("trace-signals")
      .getByTestId("log-attributes-copy-json");
    const caret: Locator = copy.getByRole("button", {
      name: "Choose JSON format",
    });

    await caret.focus();
    await page.keyboard.press("ArrowDown");

    const menu: Locator = page.getByRole("menu", {
      name: "Copy attributes as",
    });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: /Flat JSON/ }),
    ).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitemradio", { name: /Nested JSON/ }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(caret).toBeFocused();
    // Escape was spent on the menu: the log row is still open.
    await expect(copy).toBeVisible();

    // Tab from a shape goes on from the caret - not from the end of the page.
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);

    const focusedIsAfterTheCaret: boolean = await caret.evaluate(
      (element: Element): boolean => {
        const focused: Element | null = document.activeElement;

        return Boolean(
          focused &&
            focused !== document.body &&
            focused !== element &&
            element.compareDocumentPosition(focused) &
              Node.DOCUMENT_POSITION_FOLLOWING &&
            !focused.closest("[data-tippy-root]"),
        );
      },
    );

    expect(focusedIsAfterTheCaret, "the focus moved on from the caret").toBe(
      true,
    );
  });
});
