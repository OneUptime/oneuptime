import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The Dashboard's on-call logs with a direct page in them, in a browser.
 *
 * A workflow's Page Users, Page a Team and Page Whoever Is On Call steps
 * page people with no on-call policy behind the page, and the page is
 * listed with the policies' runs: On-Call Duty > Execution Logs, the logs of
 * the incident or the alert, and the run's own timeline. Where another row
 * names its policy, such a row says "Direct page" and what started it: the
 * workflow, by name, or the person.
 *
 * These are the REAL tables (the fixture's ?page=on-call-logs and
 * ?page=on-call-timeline render ExecutionLogsTable and
 * ExecutionLogsTimelineTable, with only the API stood in for), because what
 * went wrong only shows in one: a table cell stays on a single line unless
 * its column says otherwise, so one long workflow name took the whole row's
 * width and pushed Status, Acknowledged By and View Timeline out of the
 * card. A table drawn by hand for a test never showed that.
 *
 * What only a browser shows is checked here: a long name, and a long
 * incident title, wrap inside columns that stay narrow - and readable, when
 * the table is short of room - on a laptop and in a phone's cards; the
 * label is one line, in a quiet grey that reads in both themes and is not
 * mistaken for a status; the workflow's name is a link; and a line of the
 * timeline that names nobody says which team had no members. What each cell
 * says, and which rows get the label, is unit tested in packages/Common.
 */

type Box = { x: number; y: number; width: number; height: number };

// The fixture's records (Fixture/OnCallLogs.js).
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PAGING_WORKFLOW_ID: string = "44444444-4444-4444-8444-444444444444";
const LONG_WORKFLOW_NAME: string =
  "Page whoever is on call for critical incidents in the payments platform (EU and US regions)";
const LONG_POLICY_NAME: string =
  "Payments platform critical escalation for the EU and US regions (primary on call, then secondary, then engineering managers)";
const LONG_INCIDENT_TITLE: string =
  "Card payments fail at checkout for customers in the EU region after the 14:00 deploy";

/*
 * How wide the column may be: its content is capped at 20rem (max-w-xs),
 * and the row's first cell has 1.5rem before its content and 0.75rem after
 * it (Common's TableLayout).
 */
const NAME_COLUMN_CAP_IN_PX: number = 320 + 24 + 12;

/*
 * The Triggered By column's content is capped at 24rem (max-w-sm) and never
 * narrower than 12rem (min-w-[12rem]); a cell inside the row has 0.75rem on
 * either side of its content - two columns sit 1.5rem apart. The line under
 * a label that names a workflow has the same 12rem floor.
 */
const TITLE_COLUMN_CAP_IN_PX: number = 384 + 12 + 12;
const TITLE_COLUMN_FLOOR_IN_PX: number = 192 + 12 + 12;
const WORKFLOW_LINE_FLOOR_IN_PX: number = 192;

const DIRECT_PAGE_EXPLANATION: string =
  "People were paged directly, with no on-call policy: everybody at once, and no escalation.";

async function openLogs(page: Page, theme?: string): Promise<void> {
  await page.goto(`/?page=on-call-logs${theme ? `&theme=${theme}` : ""}`);
  await expect(page.getByText("On-Call Policy Logs")).toBeVisible();
  await expect(page.getByTestId("on-call-direct-page-label")).toHaveCount(4);
}

async function openTimeline(page: Page, theme?: string): Promise<void> {
  await page.goto(`/?page=on-call-timeline${theme ? `&theme=${theme}` : ""}`);
  await expect(page.getByText("Execution Timeline")).toBeVisible();
  await expect(page.getByTestId("on-call-direct-page-label")).toHaveCount(4);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

// The red, green and blue of a colour a computed style gives.
function channelsOf(color: string): Array<number> {
  return (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
}

/*
 * A colour's relative luminance, 0 (black) to 1 (white), from the
 * rgb()/rgba() a computed style gives.
 */
function luminanceOf(color: string): number {
  const channels: Array<number> = channelsOf(color).map(
    (part: number): number => {
      const value: number = part / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    },
  );

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

/*
 * How far a colour is from grey: the gap between its strongest and its
 * weakest channel. A pink or a red is far from it; a grey or a slate is not.
 */
function saturationOf(color: string): number {
  const channels: Array<number> = channelsOf(color);

  return Math.max(...channels) - Math.min(...channels);
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

/*
 * The colour actually painted behind an element: its own background, or the
 * nearest one behind it that is not see-through.
 */
async function backgroundBehind(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    let current: Element | null = element;

    while (current) {
      const background: string = getComputedStyle(current).backgroundColor;
      const parts: Array<string> = background.match(/[\d.]+/g) || [];
      const isSeeThrough: boolean =
        background === "transparent" ||
        (parts.length === 4 && Number(parts[3]) === 0);

      if (!isSeeThrough) {
        return background;
      }

      current = current.parentElement;
    }

    return "rgb(255, 255, 255)";
  });
}

// The line under a label that names the long workflow.
function longWorkflowLine(page: Page): Locator {
  return page
    .getByTestId("on-call-direct-page-workflow")
    .filter({ hasText: LONG_WORKFLOW_NAME });
}

test.describe("On-call logs: direct pages among a policy's runs", () => {
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

  test("every direct page says Direct page, with an icon and what it means; a policy's run names its policy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const labels: Locator = page.getByTestId("on-call-direct-page-label");

    for (let index: number = 0; index < 4; index++) {
      const label: Locator = labels.nth(index);

      await expect(label).toBeVisible();
      await expect(label).toContainText("Direct page");
      await expect(label.locator("svg")).toHaveCount(1);
      // What it means, on hover.
      await expect(label).toHaveAttribute("title", DIRECT_PAGE_EXPLANATION);
    }

    // The policy's run is the one row with no label: it names its policy.
    await expect(
      page.getByRole("link", { name: "Critical", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No on-call policy.")).toHaveCount(0);
  });

  test("what started each page is under its label: the workflow, or the person", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const workflows: Locator = page.getByTestId("on-call-direct-page-workflow");

    await expect(workflows).toHaveCount(2);
    await expect(workflows.nth(0)).toHaveText(
      "Workflow: Page the on-call engineer",
    );
    await expect(workflows.nth(1)).toHaveText(
      `Workflow: ${LONG_WORKFLOW_NAME}`,
    );

    // The one a person started names the person, as the page draws people.
    const startedBy: Locator = page.getByTestId(
      "on-call-direct-page-started-by",
    );

    await expect(startedBy).toHaveCount(1);
    await expect(startedBy).toContainText("Alex Kim");

    for (const part of [workflows.nth(0), startedBy]) {
      const under: Box = await boxOf(part);
      const label: Box = await boxOf(
        part
          .locator("xpath=ancestor::*[@data-testid='on-call-direct-page']")
          .getByTestId("on-call-direct-page-label"),
      );

      expect(under.y).toBeGreaterThanOrEqual(label.y + label.height - 0.5);
    }
  });

  test("the workflow's name opens the workflow, as a policy's name opens the policy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const link: Locator = page.getByRole("link", {
      name: "Page the on-call engineer",
      exact: true,
    });

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/workflows/${PAGING_WORKFLOW_ID}/builder`,
    );
    // The name alone is the link; "Workflow:" is said before it.
    await expect(link).not.toContainText("Workflow:");
  });

  test("the label is one line, inside whatever holds it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page);

    const groups: Locator = page.getByTestId("on-call-direct-page");

    for (let index: number = 0; index < 4; index++) {
      const label: Box = await boxOf(
        groups.nth(index).getByTestId("on-call-direct-page-label"),
      );
      const group: Box = await boxOf(groups.nth(index));

      // One line of small text, with its padding.
      expect(label.height).toBeLessThan(32);
      expect(label.x).toBeGreaterThanOrEqual(group.x - 0.5);
      expect(label.x + label.width).toBeLessThanOrEqual(
        group.x + group.width + 0.5,
      );
    }
  });

  /*
   * The regression this suite exists for. On one line the name is far wider
   * than the column: unwrapped, it took the row's width for itself.
   */
  test("on a laptop a long workflow name wraps under its label, in a column that stays narrow", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone draws each run as a card, not a table row.");

    await openLogs(page);

    const name: Locator = longWorkflowLine(page);
    const cell: Locator = name.locator("xpath=ancestor::td");

    const nameBox: Box = await boxOf(name);
    const cellBox: Box = await boxOf(cell);

    // On more than one line, and inside its cell.
    expect(nameBox.height).toBeGreaterThan(24);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cellBox.x + cellBox.width + 0.5,
    );

    // The column is no wider than its cap, for this row and for every other.
    const firstCells: Locator = page.locator("table tbody tr > td:first-child");

    await expect(firstCells).toHaveCount(6);

    for (let index: number = 0; index < 6; index++) {
      expect((await boxOf(firstCells.nth(index))).width).toBeLessThanOrEqual(
        NAME_COLUMN_CAP_IN_PX + 0.5,
      );
    }

    // And on one line the name would not have fitted in it: it had to wrap.
    const widthOnOneLine: number = await name.evaluate(
      (element: Element): number => {
        const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

        copy.style.position = "absolute";
        copy.style.visibility = "hidden";
        copy.style.whiteSpace = "nowrap";
        copy.style.maxWidth = "none";
        document.body.appendChild(copy);

        const width: number = copy.getBoundingClientRect().width;

        copy.remove();

        return width;
      },
    );

    expect(widthOnOneLine).toBeGreaterThan(NAME_COLUMN_CAP_IN_PX);
  });

  /*
   * The cap is the column's, not the label's. A policy's name has no label
   * around it to let it wrap: on a cell that stays on one line it took the
   * row's width in just the same way.
   */
  test("on a laptop a long policy name wraps too, in the same narrow column", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone draws each run as a card, not a table row.");

    await openLogs(page);

    const name: Locator = page.getByRole("link", {
      name: LONG_POLICY_NAME,
      exact: true,
    });
    const cell: Locator = name.locator("xpath=ancestor::td");

    const nameBox: Box = await boxOf(name);
    const cellBox: Box = await boxOf(cell);

    // On more than one line, inside its cell, and the cell within the cap.
    expect(nameBox.height).toBeGreaterThan(24);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cellBox.x + cellBox.width + 0.5,
    );
    expect(cellBox.width).toBeLessThanOrEqual(NAME_COLUMN_CAP_IN_PX + 0.5);

    /*
     * So what a run is about, when it ran and how it stands still begin
     * inside the card. With the name on one line, the status began past the
     * card's edge.
     */
    const card: Box = await boxOf(page.getByTestId("card"));
    const statusHeader: Box = await boxOf(
      page.locator("table thead th").filter({ hasText: "Status" }),
    );

    expect(statusHeader.x).toBeLessThan(card.x + card.width);

    // And on one line the name would not have fitted in the column.
    const widthOnOneLine: number = await name.evaluate(
      (element: Element): number => {
        const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

        copy.style.position = "absolute";
        copy.style.visibility = "hidden";
        copy.style.whiteSpace = "nowrap";
        document.body.appendChild(copy);

        const width: number = copy.getBoundingClientRect().width;

        copy.remove();

        return width;
      },
    );

    expect(widthOnOneLine).toBeGreaterThan(NAME_COLUMN_CAP_IN_PX);
  });

  /*
   * An incident's or an alert's title is long more often than a name is.
   * On one line this one is wider than the card: the row showed a name and
   * a title, and nothing of when it was triggered or how it stands.
   */
  test("on a laptop a long incident title wraps in its own column, which keeps a readable width", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone draws each run as a card, not a table row.");

    await openLogs(page);

    const title: Locator = page.getByRole("link", {
      name: LONG_INCIDENT_TITLE,
      exact: true,
    });
    const cell: Locator = title.locator("xpath=ancestor::td");

    const titleBox: Box = await boxOf(title);
    const cellBox: Box = await boxOf(cell);

    // On more than one line, and inside its cell.
    expect(titleBox.height).toBeGreaterThan(24);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
      cellBox.x + cellBox.width + 0.5,
    );

    /*
     * Within its cap - and not under its floor, although this table is
     * short of room: a column that may wrap is then given the least it can
     * take, which without a floor is the title's longest word.
     */
    expect(cellBox.width).toBeLessThanOrEqual(TITLE_COLUMN_CAP_IN_PX + 0.5);
    expect(cellBox.width).toBeGreaterThanOrEqual(
      TITLE_COLUMN_FLOOR_IN_PX - 0.5,
    );

    // When each run was triggered and how it stands begin inside the card.
    const card: Box = await boxOf(page.getByTestId("card"));
    const headers: Locator = page.locator("table thead th");

    for (const name of ["Triggered at", "Status"]) {
      const header: Box = await boxOf(headers.filter({ hasText: name }));

      expect(header.x).toBeLessThan(card.x + card.width);
    }

    // On one line the title alone is wider than its column may be.
    const widthOnOneLine: number = await title.evaluate(
      (element: Element): number => {
        const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

        copy.style.position = "absolute";
        copy.style.visibility = "hidden";
        copy.style.whiteSpace = "nowrap";
        document.body.appendChild(copy);

        const width: number = copy.getBoundingClientRect().width;

        copy.remove();

        return width;
      },
    );

    expect(widthOnOneLine).toBeGreaterThan(TITLE_COLUMN_CAP_IN_PX);
  });

  /*
   * Every row here is a label with a workflow's name under it: nothing
   * wider - a person, a policy's long name - holds the column open, so the
   * table gives it the least it can take. That used to be the label's own
   * width, with the name folded to two words a line under it.
   */
  test("on a laptop a workflow's name keeps a readable line, with no other row to hold the column open", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone draws each run as a card, not a table row.");

    await page.goto("/?page=on-call-logs&rows=workflows");
    await expect(page.getByTestId("on-call-direct-page-label")).toHaveCount(2);

    const lines: Locator = page.getByTestId("on-call-direct-page-workflow");

    await expect(lines).toHaveCount(2);

    for (let index: number = 0; index < 2; index++) {
      expect((await boxOf(lines.nth(index))).width).toBeGreaterThanOrEqual(
        WORKFLOW_LINE_FLOOR_IN_PX - 0.5,
      );
    }

    // And the column is still within its cap.
    const firstCells: Locator = page.locator("table tbody tr > td:first-child");

    for (let index: number = 0; index < 2; index++) {
      expect((await boxOf(firstCells.nth(index))).width).toBeLessThanOrEqual(
        NAME_COLUMN_CAP_IN_PX + 0.5,
      );
    }
  });

  test("on a laptop the columns after it start where they would for a short name", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone draws each run as a card, not a table row.");

    await openLogs(page);

    /*
     * Triggered By is the second column: it begins right after the first,
     * which the long name must not have widened past its cap.
     */
    const table: Box = await boxOf(page.locator("table"));
    const secondHeader: Box = await boxOf(
      page.locator("table thead th").nth(1),
    );

    expect(secondHeader.x - table.x).toBeLessThanOrEqual(
      NAME_COLUMN_CAP_IN_PX + 0.5,
    );
  });

  test("on a phone the name wraps inside its card, and nothing scrolls sideways", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "A laptop draws the runs as table rows.");

    await openLogs(page);

    // Cards, not a table.
    await expect(page.locator("table")).toHaveCount(0);

    const name: Locator = longWorkflowLine(page);
    const nameBox: Box = await boxOf(name);
    const card: Box = await boxOf(page.getByTestId("card"));

    expect(nameBox.height).toBeGreaterThan(24);
    expect(nameBox.x).toBeGreaterThanOrEqual(card.x);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );

    // A policy's long name wraps inside the card as well.
    const policyName: Box = await boxOf(
      page.getByRole("link", { name: LONG_POLICY_NAME, exact: true }),
    );

    expect(policyName.height).toBeGreaterThan(24);
    expect(policyName.x).toBeGreaterThanOrEqual(card.x);
    expect(policyName.x + policyName.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );

    // And so does an incident's long title.
    const title: Box = await boxOf(
      page.getByRole("link", { name: LONG_INCIDENT_TITLE, exact: true }),
    );

    expect(title.height).toBeGreaterThan(24);
    expect(title.x).toBeGreaterThanOrEqual(card.x);
    expect(title.x + title.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );

    const widths: { page: number; window: number } = await page.evaluate(
      (): { page: number; window: number } => {
        return {
          page: document.documentElement.scrollWidth,
          window: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.page).toBeLessThanOrEqual(widths.window);
  });

  test("the label is a quiet grey that reads in the light theme and the dark one, and is not a status colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openLogs(page, theme);

      const label: Locator = page
        .getByTestId("on-call-direct-page-label")
        .first();
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

      /*
       * Grey, or near it. The run's status is what is drawn in colour - and
       * the "Error" pill of the last row is far from grey.
       */
      expect({
        theme,
        isNearGrey: saturationOf(colors.background) <= 40,
      }).toEqual({ theme, isNearGrey: true });

      const errorPill: Locator = page
        .getByTestId("pill")
        .filter({ hasText: "Error" })
        .first();

      expect(saturationOf((await colorsOf(errorPill)).text)).toBeGreaterThan(
        saturationOf(colors.text),
      );
    }
  });

  test("the workflow's name is readable under the label in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openLogs(page, theme);

      const name: Locator = page
        .getByTestId("on-call-direct-page-workflow")
        .first();
      const text: string = (await colorsOf(name)).text;
      const behind: string = await backgroundBehind(name);

      expect({
        theme,
        readable: contrastOf(text, behind) >= 4.5,
      }).toEqual({ theme, readable: true });
    }
  });
});

test.describe("On-call logs: the timeline of a direct page", () => {
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

  test("the card names no policy: a direct page has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTimeline(page);

    const card: Locator = page.getByTestId("card");

    await expect(
      card.getByRole("heading", { name: "Execution Timeline" }),
    ).toBeVisible();
    await expect(card.getByTestId("card-header")).not.toContainText("olicy");
  });

  test("every line says Direct page where a policy's line names its escalation rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTimeline(page);

    await expect(page.getByTestId("on-call-direct-page-label")).toHaveCount(4);
    await expect(page.getByText("No escalation rule found.")).toHaveCount(0);
    // The run's own lines name nothing that started them: the logs do.
    await expect(page.getByTestId("on-call-direct-page-workflow")).toHaveCount(
      0,
    );
  });

  test("a line that names nobody says why: nobody on call, or a team with no members, by its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTimeline(page);

    await expect(page.getByText("No one was on call")).toBeVisible();

    const team: Locator = page.getByTestId(
      "on-call-timeline-team-has-no-members",
    );

    await expect(team).toHaveCount(1);
    await expect(team).toBeVisible();
    await expect(team).toHaveText("Team Night Shift has no members");
    await expect(team.locator("svg")).toHaveCount(1);

    // A person paged as a member of a team is named, not their team.
    await expect(page.getByText("Team Platform has no members")).toHaveCount(0);
    await expect(page.getByText("Jane Doe").first()).toBeVisible();
  });

  test("the two reasons are drawn alike, and read in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openTimeline(page, theme);

      const team: Locator = page.getByTestId(
        "on-call-timeline-team-has-no-members",
      );
      const nobodyOnCall: Locator = page
        .getByText("No one was on call")
        .first();

      const teamColors: { text: string; background: string } =
        await colorsOf(team);
      const onCallColors: { text: string; background: string } =
        await colorsOf(nobodyOnCall);

      expect({ theme, colors: teamColors }).toEqual({
        theme,
        colors: onCallColors,
      });
      expect({
        theme,
        readable: contrastOf(teamColors.text, teamColors.background) >= 4.5,
      }).toEqual({ theme, readable: true });
    }
  });

  test("on a phone nothing scrolls sideways", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "A laptop draws the lines as table rows.");

    await openTimeline(page);

    const widths: { page: number; window: number } = await page.evaluate(
      (): { page: number; window: number } => {
        return {
          page: document.documentElement.scrollWidth,
          window: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.page).toBeLessThanOrEqual(widths.window);
  });
});

/*
 * A policy's run that escalated to the next person in a rotation (an
 * escalation rule can page a schedule's Next in rotation: the person after
 * whoever is on call). The line of the backup's page says so under its
 * schedule's name, and a line where nobody was next says so where a person
 * would be named. On a phone too: the Schedule column used to be left off
 * the phone's cards, and there the backup's page read like any other.
 */
async function openNextInRotationTimeline(
  page: Page,
  theme?: string,
): Promise<void> {
  await page.goto(
    `/?page=on-call-timeline&run=next-in-rotation${theme ? `&theme=${theme}` : ""}`,
  );
  await expect(page.getByText("Execution Timeline")).toBeVisible();
  await expect(
    page.getByTestId("on-call-timeline-next-in-rotation"),
  ).toHaveCount(2);
}

test.describe("On-call logs: a run that paged the next person in a rotation", () => {
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

  test("the backup's line says Next in rotation under its schedule, on a laptop and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openNextInRotationTimeline(page);

    const lines: Locator = page.getByTestId(
      "on-call-timeline-next-in-rotation",
    );

    for (const [index, schedule] of [
      [0, "Primary"],
      [1, "Secondary"],
    ] as Array<[number, string]>) {
      const line: Locator = lines.nth(index);

      await expect(line).toBeVisible();
      await expect(line).toHaveText(`${schedule}Next in rotation`);
      // The fast-forward mark beside the words.
      await expect(line.locator("svg")).toHaveCount(1);
    }

    // Who was paged as the backup is named, as on any line.
    await expect(page.getByText("Sam Lee").first()).toBeVisible();
    // Level 1's page to whoever was on call says nothing of a rotation.
    await expect(page.getByText("Primary", { exact: true })).toHaveCount(2);
  });

  test("where nobody was next, the line says so where a person would be named, readable in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openNextInRotationTimeline(page, theme);

      const nobody: Locator = page.getByTestId(
        "on-call-timeline-nobody-next-in-rotation",
      );

      await expect(nobody).toHaveCount(1);
      await expect(nobody).toBeVisible();
      await expect(nobody).toHaveText("Nobody was next in the rotation");
      await expect(nobody.locator("svg")).toHaveCount(1);
      // Not that nobody was on call: somebody was.
      await expect(page.getByText("No one was on call")).toHaveCount(0);

      const colors: { text: string; background: string } =
        await colorsOf(nobody);

      expect({
        theme,
        readable: contrastOf(colors.text, colors.background) >= 4.5,
      }).toEqual({ theme, readable: true });

      const label: Locator = page
        .getByTestId("on-call-timeline-next-in-rotation")
        .first()
        .getByText("Next in rotation");
      const labelText: string = (await colorsOf(label)).text;
      const behind: string = await backgroundBehind(label);

      expect({
        theme,
        readable: contrastOf(labelText, behind) >= 4.5,
      }).toEqual({ theme, readable: true });
    }
  });

  test("on a phone nothing scrolls sideways", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "A laptop draws the lines as table rows.");

    await openNextInRotationTimeline(page);

    const widths: { page: number; window: number } = await page.evaluate(
      (): { page: number; window: number } => {
        return {
          page: document.documentElement.scrollWidth,
          window: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.page).toBeLessThanOrEqual(widths.window);
  });
});

async function openEmptyLevelsTimeline(
  page: Page,
  theme?: string,
): Promise<void> {
  await page.goto(
    `/?page=on-call-timeline&run=empty-levels${theme ? `&theme=${theme}` : ""}`,
  );
  await expect(page.getByText("Execution Timeline")).toBeVisible();
  await expect(
    page.getByTestId("on-call-timeline-level-paged-nobody"),
  ).toHaveCount(2);
}

/*
 * A level with nobody to page is passed at once (Common's OnCallEmptyLevel),
 * and its own line on the run's timeline says so where a person would be
 * named: why it paged nobody, and "Moved on at once" under it - the policy
 * did not wait it out. What each line says is unit tested in
 * packages/Common (OnCallTimelineEmptyLevel); here, that the lines are
 * drawn whole and readable in a real table, in both themes, on a laptop
 * and a phone.
 */
test.describe("On-call logs: a run that passed levels with nobody to page", () => {
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

  test("each level that paged nobody says why where a person would be named, with Moved on at once under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEmptyLevelsTimeline(page);

    const levels: Locator = page.getByTestId(
      "on-call-timeline-level-paged-nobody",
    );

    await expect(levels.nth(0)).toHaveText(
      "This level has no respondersMoved on at once",
    );
    await expect(levels.nth(1)).toHaveText(
      "Nobody at this level could be pagedMoved on at once",
    );

    const movedOn: Locator = page.getByTestId(
      "on-call-timeline-moved-on-at-once",
    );

    await expect(movedOn).toHaveCount(2);

    for (const index of [0, 1]) {
      // Its fast-forward mark, beside the words, and under the level's chip.
      await expect(movedOn.nth(index).locator("svg")).toHaveCount(1);

      const chip: Box = await boxOf(levels.nth(index).locator("span").first());
      const line: Box = await boxOf(movedOn.nth(index));

      expect(line.y).toBeGreaterThanOrEqual(chip.y + chip.height - 1);
    }

    // Why Level 2 paged nobody is its schedule's own line, above its own.
    await expect(page.getByText("No one was on call")).toHaveCount(1);
    // Level 3 paged somebody, the same minute.
    await expect(page.getByText("Alex Kim").first()).toBeVisible();
  });

  test("the lines read in the light theme and the dark one", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openEmptyLevelsTimeline(page, theme);

      const chip: Locator = page
        .getByTestId("on-call-timeline-level-paged-nobody")
        .first()
        .locator("span")
        .first();
      const chipColors: { text: string; background: string } =
        await colorsOf(chip);

      expect({
        theme,
        readable: contrastOf(chipColors.text, chipColors.background) >= 4.5,
      }).toEqual({ theme, readable: true });

      const movedOn: Locator = page
        .getByTestId("on-call-timeline-moved-on-at-once")
        .first();
      const movedOnText: string = (await colorsOf(movedOn)).text;
      const behind: string = await backgroundBehind(movedOn);

      expect({
        theme,
        readable: contrastOf(movedOnText, behind) >= 4.5,
      }).toEqual({ theme, readable: true });
    }
  });

  test("on a phone nothing scrolls sideways", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "A laptop draws the lines as table rows.");

    await openEmptyLevelsTimeline(page);

    const widths: { page: number; window: number } = await page.evaluate(
      (): { page: number; window: number } => {
        return {
          page: document.documentElement.scrollWidth,
          window: document.documentElement.clientWidth,
        };
      },
    );

    expect(widths.page).toBeLessThanOrEqual(widths.window);
  });
});
