import { expect, Locator, Page, test } from "@playwright/test";

/*
 * What the on-call logs say of a direct page, in a browser.
 *
 * A workflow's Page Users, Page a Team and Page Whoever Is On Call steps
 * page people with no on-call policy behind the page, and the page is
 * listed with the policies' runs. Where another row names its policy, such
 * a row says "Direct page" and what started it: the workflow, by name, or
 * the person.
 *
 * The label is drawn in the first column of a logs table, which is narrow.
 * What only a browser shows is checked here: the label stays on one line
 * and inside its cell, a long workflow name wraps under it rather than
 * widening the column, and in the dark theme the label is readable on the
 * page colour's dark tint. What the label says, and which rows get it, is
 * unit tested in packages/Common.
 */

type Box = { x: number; y: number; width: number; height: number };

async function openLogs(page: Page, theme?: string): Promise<void> {
  await page.goto(`/?page=direct-page${theme ? `&theme=${theme}` : ""}`);
  await expect(page.getByTestId("on-call-logs")).toBeVisible();
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

/*
 * A colour's relative luminance, 0 (black) to 1 (white), from the
 * rgb()/rgba() a computed style gives.
 */
function luminanceOf(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((part: string): number => {
      const value: number = Number(part) / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

// How far apart two colours are, as WCAG counts it: 1 (the same) to 21.
function contrastOf(first: string, second: string): number {
  const lighter: number = Math.max(luminanceOf(first), luminanceOf(second));
  const darker: number = Math.min(luminanceOf(first), luminanceOf(second));

  return (lighter + 0.05) / (darker + 0.05);
}

async function colorsOf(
  locator: Locator,
): Promise<{ text: string; background: string }> {
  return locator.evaluate(
    (element: Element): { text: string; background: string } => {
      const style: CSSStyleDeclaration = getComputedStyle(element);

      return { text: style.color, background: style.backgroundColor };
    },
  );
}

test.describe("On-call logs: a direct page", () => {
  let pageErrors: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("says Direct page where another row names its policy, with an icon before the words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    for (const id of ["direct-workflow", "direct-person", "direct-plain"]) {
      const label: Locator = page.getByTestId(`${id}-label`);

      await expect(label).toBeVisible();
      await expect(label).toContainText("Direct page");
      await expect(label.locator("svg")).toHaveCount(1);
      // What it means, on hover.
      await expect(label).toHaveAttribute(
        "title",
        "People were paged directly, with no on-call policy: everybody at once, and no escalation.",
      );
    }

    // A policy's row has no such label.
    await expect(
      page.getByTestId("run-policy").locator("[data-testid$='-label']"),
    ).toHaveCount(0);
  });

  test("the label is one line, inside its cell, however narrow the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    for (const id of ["direct-workflow", "direct-person", "direct-plain"]) {
      const label: Box = await boxOf(page.getByTestId(`${id}-label`));
      const cell: Box = await boxOf(
        page.getByTestId(id).locator("xpath=ancestor::td"),
      );

      // One line of small text, with its padding.
      expect(label.height).toBeLessThan(32);
      expect(label.x).toBeGreaterThanOrEqual(cell.x - 0.5);
      expect(label.x + label.width).toBeLessThanOrEqual(
        cell.x + cell.width + 0.5,
      );
    }
  });

  test("a long workflow name wraps under the label and does not widen the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const workflow: Locator = page.getByTestId("direct-workflow-workflow");

    await expect(workflow).toHaveText(
      "Workflow: Page whoever is on call for critical incidents in the payments platform",
    );

    const name: Box = await boxOf(workflow);
    const label: Box = await boxOf(page.getByTestId("direct-workflow-label"));
    const cell: Box = await boxOf(
      page.getByTestId("direct-workflow").locator("xpath=ancestor::td"),
    );
    const plainCell: Box = await boxOf(
      page.getByTestId("direct-plain").locator("xpath=ancestor::td"),
    );

    // Under the label, on more than one line, inside the cell.
    expect(name.y).toBeGreaterThanOrEqual(label.y + label.height - 0.5);
    expect(name.height).toBeGreaterThan(24);
    expect(name.x + name.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5);
    // The column is as wide as it is for a row with no name at all.
    expect(Math.abs(cell.width - plainCell.width)).toBeLessThan(0.5);
  });

  test("a person who started the page is drawn under the label", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const startedBy: Box = await boxOf(page.getByTestId("started-by"));
    const label: Box = await boxOf(page.getByTestId("direct-person-label"));

    expect(startedBy.y).toBeGreaterThanOrEqual(label.y + label.height - 0.5);
    await expect(page.getByTestId("direct-person-workflow")).toHaveCount(0);
  });

  test("is the page colour, and its words stand out from it, in the light theme and the dark one", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openLogs(page, theme);

      const label: Locator = page.getByTestId("direct-plain-label");
      const colors: { text: string; background: string } =
        await colorsOf(label);

      // Readable: at least the contrast body text needs.
      expect({
        theme,
        readable: contrastOf(colors.text, colors.background) >= 4.5,
      }).toEqual({ theme, readable: true });

      // A tint, not a white pill on a dark page - nor a dark one on a light page.
      const isDarkPill: boolean = luminanceOf(colors.background) < 0.2;

      expect({ theme, isDarkPill }).toEqual({
        theme,
        isDarkPill: theme === "dark",
      });
    }
  });

  test("the workflow's name is readable under it in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openLogs(page, theme);

      const name: Locator = page.getByTestId("direct-workflow-workflow");
      const text: string = (await colorsOf(name)).text;
      const behind: string = (await colorsOf(page.getByTestId("on-call-logs")))
        .background;

      expect({
        theme,
        readable: contrastOf(text, behind) >= 4.5,
      }).toEqual({ theme, readable: true });
    }
  });
});
