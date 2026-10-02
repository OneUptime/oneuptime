import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The Add Component / Add Trigger picker, in the real workflow builder with
 * the real catalog: about two thousand actions and seven hundred triggers.
 *
 * The maintainer's report: "Add component picker is so hard to use. We have
 * thousands of components and have we no idea what components to pick ...
 * the search on top is very clunky to use and freezes the UI ... When I
 * search on incident, it shows me incident states."
 *
 * So: the panel leads with a short list (popular steps, the rest of the
 * hand-written ones, the common resources), a resource opens onto what can
 * be done with it, search ranks the resource named first, one click or
 * Enter adds a step, and typing never holds the page up. Ranking and
 * keyboard details are unit tested in packages/Common; this is what only a
 * browser shows: real layout, real timing, the real theme.
 */

const INCIDENT_ACTIONS: Array<string> = [
  "Create One Incident",
  "Create Many Incidents",
  "Find One Incident",
  "Find Many Incidents",
  "Update One Incident",
  "Update Many Incidents",
  "Delete One Incident",
  "Delete Many Incidents",
];

async function openBuilder(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

async function openComponentPicker(page: Page): Promise<Locator> {
  await openBuilder(page, "scenario=graph");
  await page.getByTestId("add-component").click();
  const panel: Locator = page.getByTestId("side-over");
  await expect(panel.locator("#workflow-component-search")).toBeVisible();
  return panel;
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

async function optionNames(panel: Locator): Promise<Array<string>> {
  return panel
    .getByRole("option")
    .evaluateAll((options: Array<Element>): Array<string> => {
      return options.map((option: Element): string => {
        return option.getAttribute("aria-label") || "";
      });
    });
}

// The side panel's 1.5rem under its last row, at every width.
const ROOM_BELOW_LAST_ROW: number = 24;

/*
 * Short enough that every view of the picker scrolls, on a laptop and on a
 * phone alike: a view that fits has no last row to sit on the footer.
 */
async function useShortViewport(page: Page): Promise<void> {
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 640,
  });
}

// The gap between a row and the footer's divider, as the panel is scrolled now.
async function roomBelow(row: Locator): Promise<number> {
  return row.evaluate((element: Element): number => {
    const content: Element = element.closest(
      "[data-testid='side-over-content']",
    )!;

    return Math.round(
      content.getBoundingClientRect().bottom -
        element.getBoundingClientRect().bottom,
    );
  });
}

// The same, once the panel is scrolled all the way down.
async function roomBelowAtTheEnd(row: Locator): Promise<number> {
  await row.evaluate((element: Element): void => {
    const content: Element = element.closest(
      "[data-testid='side-over-content']",
    )!;

    if (content.scrollHeight <= content.clientHeight) {
      throw new Error("The view fits without scrolling; nothing to measure.");
    }

    content.scrollTop = content.scrollHeight;
  });

  return roomBelow(row);
}

test.describe("Workflow builder: the Add Component picker", () => {
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

  test("opens on a short list, led by the steps most workflows use", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);

    await expect(
      panel.getByRole("region", { name: "Popular" }).getByRole("button"),
    ).toHaveCount(10);
    await expect(
      panel.getByRole("button", { name: "Log", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Incident, 8 actions" }),
    ).toBeVisible();
    // Not the two thousand generated steps the old panel drew.
    expect(
      await panel
        .getByTestId("workflow-component-picker")
        .getByRole("button")
        .count(),
    ).toBeLessThan(40);
    await expect(
      panel.getByRole("button", { name: "Add to Workflow" }),
    ).toHaveCount(0);
  });

  test("'incident' lists Incident's steps first, before Incident State's", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);

    await panel.locator("#workflow-component-search").fill("incident");
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "Create One Incident",
    );

    const names: Array<string> = await optionNames(panel);
    expect(names.slice(0, 8)).toEqual(INCIDENT_ACTIONS);
    /*
     * Incident State is further from "incident" than Incident, and is not one
     * of the common resources, so its steps come well down the list - past
     * the first page here, which is drawn on its own.
     */
    const incidentState: number = names.indexOf("Create One Incident State");
    expect(incidentState === -1 || incidentState > 7).toBe(true);
    expect(names.length).toBeLessThanOrEqual(50);
    await expect(
      panel.getByRole("button", { name: /^Show \d+ more$/ }),
    ).toBeVisible();
  });

  test("'create incident' then Enter adds Create One Incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);
    const search: Locator = panel.locator("#workflow-component-search");

    await search.focus();
    await page.keyboard.type("create incident");
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "Create One Incident",
    );
    await page.keyboard.press("Enter");

    await expect(panel).toHaveCount(0);
    await expect(stepCard(page, "incident-create-one-1")).toBeVisible();
  });

  test("a resource opens onto what can be done with it, and one click adds the step", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);

    await panel.getByRole("button", { name: "Incident, 8 actions" }).click();
    await expect(
      panel.getByRole("heading", { name: "Incident" }),
    ).toBeVisible();
    await expect(
      panel
        .getByRole("group", { name: "Incident components" })
        .getByRole("button"),
    ).toHaveCount(8);

    await panel.getByRole("button", { name: "Update One Incident" }).click();

    await expect(panel).toHaveCount(0);
    await expect(stepCard(page, "incident-update-one-1")).toBeVisible();
  });

  test("a rarely used resource is under Browse all resources, and Back returns", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);

    await panel.getByRole("button", { name: /^Browse all resources/ }).click();
    await expect(
      panel.getByRole("heading", { name: "All resources" }),
    ).toBeVisible();

    await panel
      .getByRole("button", { name: "Incident State, 8 actions" })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Incident State" }),
    ).toBeVisible();

    await panel.getByRole("button", { name: "Back" }).click();
    await expect(
      panel.getByRole("heading", { name: "All resources" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Back" }).click();
    await expect(panel.getByRole("region", { name: "Popular" })).toBeVisible();

    await panel.getByRole("button", { name: /^Browse all resources/ }).click();
    await panel
      .getByRole("button", { name: "Incident State, 8 actions" })
      .click();
    await panel
      .getByRole("button", { name: "Find One Incident State" })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(stepCard(page, "incident-state-find-one-1")).toBeVisible();
  });

  test("typing a search never holds the page up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __longTasks: Array<number> }).__longTasks = [];
      new PerformanceObserver((list: PerformanceObserverEntryList) => {
        for (const entry of list.getEntries()) {
          (
            window as unknown as { __longTasks: Array<number> }
          ).__longTasks.push(entry.duration);
        }
      }).observe({ type: "longtask", buffered: true });
    });

    const panel: Locator = await openComponentPicker(page);
    const search: Locator = panel.locator("#workflow-component-search");
    // Let the panel open, and index the catalog while it is idle.
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      (window as unknown as { __longTasks: Array<number> }).__longTasks = [];
    });

    await search.focus();
    await page.keyboard.type("create incident state", { delay: 30 });
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "Create One Incident State",
    );

    const longTasks: Array<number> = await page.evaluate((): Array<number> => {
      return (window as unknown as { __longTasks: Array<number> }).__longTasks;
    });

    /*
     * The old panel re-scored and redrew every step on every key, and spent
     * seconds of main-thread time on one search. A task over 50 ms is what
     * the browser calls long; allow a few, never a freeze.
     */
    expect(Math.max(0, ...longTasks)).toBeLessThan(250);
    expect(
      longTasks.reduce((sum: number, duration: number) => {
        return sum + duration;
      }, 0),
    ).toBeLessThan(1000);
  });

  test("Escape clears the search, then goes back a view", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);
    const search: Locator = panel.locator("#workflow-component-search");

    await panel.getByRole("button", { name: "Monitor, 8 actions" }).click();
    await search.fill("slack");
    await expect(panel.getByRole("option")).toHaveCount(1);

    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(panel.getByRole("heading", { name: "Monitor" })).toBeVisible();

    await search.press("Escape");
    await expect(panel.getByRole("region", { name: "Popular" })).toBeVisible();
    // The panel stays open: Escape never threw away the work.
    await expect(panel).toHaveCount(1);
  });

  test("fits a phone's width without scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openComponentPicker(page);
    const content: Locator = panel.getByTestId("side-over-content");

    for (const step of ["home", "search", "all"]) {
      if (step === "search") {
        await panel
          .locator("#workflow-component-search")
          .fill("subscriber notification template");
        await expect(panel.getByRole("option").first()).toBeVisible();
      }

      if (step === "all") {
        await panel.locator("#workflow-component-search").fill("");
        await panel
          .getByRole("button", { name: /^Browse all resources/ })
          .click();
      }

      const overflow: number = await content.evaluate(
        (element: Element): number => {
          return element.scrollWidth - element.clientWidth;
        },
      );
      expect({ step, overflow }).toEqual({ step, overflow: 0 });
    }
  });

  /*
   * "Please have a little bottom margin for this": "Browse all resources",
   * the start view's last row, sat flush on the footer's divider, and so did
   * the end of every other view, on any screen 640px or wider - the side
   * panel dropped its bottom padding from the sm breakpoint up.
   */
  test("leaves room under the last row of every view, above the footer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await useShortViewport(page);
    const panel: Locator = await openComponentPicker(page);
    const search: Locator = panel.locator("#workflow-component-search");
    const browseAll: Locator = panel.getByRole("button", {
      name: /^Browse all resources/,
    });

    await expect
      .poll(() => {
        return roomBelowAtTheEnd(browseAll);
      })
      .toBe(ROOM_BELOW_LAST_ROW);

    await panel.getByRole("button", { name: "Incident, 8 actions" }).click();
    await expect
      .poll(() => {
        return roomBelowAtTheEnd(
          panel
            .getByRole("group", { name: "Incident components" })
            .getByRole("button")
            .last(),
        );
      })
      .toBe(ROOM_BELOW_LAST_ROW);
    await panel.getByRole("button", { name: "Back" }).click();

    // Every resource, A to Z: one bordered list, measured from its border.
    await browseAll.click();
    await expect
      .poll(() => {
        return roomBelowAtTheEnd(
          panel.getByRole("group", { name: "All resources" }),
        );
      })
      .toBe(ROOM_BELOW_LAST_ROW);
    await panel.getByRole("button", { name: "Back" }).click();

    // A search with more results than it draws ends on Show more.
    await search.fill("incident");
    await expect
      .poll(() => {
        return roomBelowAtTheEnd(
          panel.getByRole("button", { name: /^Show \d+ more$/ }),
        );
      })
      .toBe(ROOM_BELOW_LAST_ROW);

    // One that draws them all ends on its last result.
    await search.fill("monitor status");
    await expect(
      panel.getByRole("button", { name: /^Show \d+ more$/ }),
    ).toHaveCount(0);
    await expect
      .poll(() => {
        return roomBelowAtTheEnd(panel.getByRole("option").last());
      })
      .toBe(ROOM_BELOW_LAST_ROW);
  });

  test("keeps what the arrow keys move to clear of the footer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await useShortViewport(page);
    const panel: Locator = await openComponentPicker(page);
    const search: Locator = panel.locator("#workflow-component-search");

    // Down every result of a search: each one scrolled into view stops short.
    await search.fill("incident");
    await expect(
      panel.getByRole("button", { name: /^Show \d+ more$/ }),
    ).toBeVisible();
    const options: Locator = panel.getByRole("option");
    const optionCount: number = await options.count();
    expect(optionCount).toBeGreaterThan(20);

    await search.focus();
    for (let index: number = 1; index < optionCount; index++) {
      await page.keyboard.press("ArrowDown");
    }

    await expect(options.last()).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => {
        return roomBelow(options.last());
      })
      .toBe(ROOM_BELOW_LAST_ROW);

    // Down every entry of the start view, to Browse all resources.
    await search.fill("");
    await expect(panel.getByRole("region", { name: "Popular" })).toBeVisible();
    const entryCount: number = await panel
      .locator("[data-picker-item]")
      .count();

    await search.focus();
    for (let index: number = 0; index < entryCount; index++) {
      await page.keyboard.press("ArrowDown");
    }

    const browseAll: Locator = panel.getByRole("button", {
      name: /^Browse all resources/,
    });
    await expect(browseAll).toBeFocused();
    await expect
      .poll(() => {
        return roomBelow(browseAll);
      })
      .toBe(ROOM_BELOW_LAST_ROW);
  });
});

test.describe("Workflow builder: the Add Trigger picker", () => {
  test("leads with the triggers people start with, and finds the rest by resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=empty");
    await page
      .locator(".react-flow__node", {
        hasText: "Choose what starts this workflow",
      })
      .click();

    const panel: Locator = page.getByTestId("side-over");
    await expect(panel.getByTestId("side-over-title")).toHaveText(
      "Add Trigger",
    );
    await expect(
      panel.getByRole("region", { name: "Popular" }).getByRole("button"),
    ).toHaveText([
      /^Manual/,
      /^Schedule/,
      /^Webhook/,
      /^Incoming Email/,
      /^On Create Incident/,
      /^On Update Incident/,
      /^On Create Alert/,
      /^On Update Monitor/,
    ]);

    await panel.locator("#workflow-component-search").fill("incident created");
    await expect(panel.getByRole("option").first()).toHaveAccessibleName(
      "On Create Incident",
    );
    await panel.getByRole("option").first().click();

    await expect(panel).toHaveCount(0);
    await expect(stepCard(page, "incident-on-create-1")).toBeVisible();
  });
});

test.describe("Workflow builder: the picker in the dark theme", () => {
  test("draws its tiles and results on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=graph&theme=dark");
    await page.getByTestId("add-component").click();
    const panel: Locator = page.getByTestId("side-over");

    const tileBackground: string = await panel
      .getByRole("button", { name: "Log", exact: true })
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(tileBackground).not.toBe("rgb(255, 255, 255)");

    await panel.locator("#workflow-component-search").fill("incident");
    const activeBackground: string = await panel
      .getByRole("option")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    // Indigo-50 in the light theme; a deep indigo in the dark one.
    expect(activeBackground).not.toBe("rgb(238, 242, 255)");
  });
});
