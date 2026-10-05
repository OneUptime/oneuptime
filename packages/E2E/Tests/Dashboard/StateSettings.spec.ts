import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * For assertions that wait on the server (a save, a page's first fetch, a
 * full navigation): the suite's 5s default is for what is already on screen.
 */
const SERVER: { timeout: number } = { timeout: 30000 };

/*
 * The six settings pages for a project's states, severities and monitor
 * statuses (incident, alert and scheduled maintenance states, monitor
 * statuses, incident and alert severities): one compact list per page,
 * dragged into order, with a Create button and the usual form. Real pages,
 * real drags from the keyboard (the grip is a real control: Space picks a row
 * up, the arrows move it, Space drops it) and real persistence, read back
 * through the API - including where the server puts a new row and a drag it
 * refuses. Each test owns a temporary project, deleted even when the test
 * fails. The create form opens with a colour already picked - one no row of
 * the list uses - which one test keeps and reads back from the server.
 * Growth, because creating or reordering states is a Growth feature when
 * billing is on.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/StateSettings.spec.ts \
 *   --project=chromium --retries=0
 */

interface ListPage {
  page: Page;
  projectId: string;
  // The API path and the model's singular name ("Incident State").
  apiPath: string;
  singularName: string;
  // The column the list is ordered by.
  orderField: "order" | "priority";
}

// The grip a row is dragged by, which is named after the row.
const gripOf: (list: ListPage, name: string) => Locator = (
  list: ListPage,
  name: string,
): Locator => {
  return list.page.getByRole("button", {
    name: `Drag to reorder ${list.singularName}: ${name}`,
    exact: true,
  });
};

const rowOf: (list: ListPage, name: string) => Locator = (
  list: ListPage,
  name: string,
): Locator => {
  return list.page.getByRole("row").filter({ has: gripOf(list, name) });
};

// The rows on the page, top to bottom, read off their grips.
const namesOnPage: (list: ListPage) => Promise<Array<string>> = async (
  list: ListPage,
): Promise<Array<string>> => {
  const prefix: string = `Drag to reorder ${list.singularName}: `;
  const labels: Array<string> = await list.page
    .getByTestId("drag-handle")
    .evaluateAll((grips: Array<Element>): Array<string> => {
      return grips.map((grip: Element): string => {
        return grip.getAttribute("aria-label") || "";
      });
    });

  return labels.map((label: string): string => {
    return label.startsWith(prefix) ? label.slice(prefix.length) : label;
  });
};

// The rows as the server keeps them, in their order.
const namesOnServer: (list: ListPage) => Promise<Array<string>> = async (
  list: ListPage,
): Promise<Array<string>> => {
  const response: APIResponse = await list.page.request.post(
    urlFor(`/api/${list.apiPath}/get-list`),
    {
      headers: { tenantid: list.projectId },
      data: {
        query: { projectId: list.projectId },
        select: { _id: true, name: true, [list.orderField]: true },
        limit: 50,
        skip: 0,
        sort: { [list.orderField]: "ASC" },
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body: { data: Array<{ name: string }> } = await response.json();

  return body.data.map((row: { name: string }): string => {
    return row.name;
  });
};

// A row's colour as the server keeps it ("#6366f1").
const colorOnServer: (list: ListPage, name: string) => Promise<string> = async (
  list: ListPage,
  name: string,
): Promise<string> => {
  const response: APIResponse = await list.page.request.post(
    urlFor(`/api/${list.apiPath}/get-list`),
    {
      headers: { tenantid: list.projectId },
      data: {
        query: { projectId: list.projectId, name },
        select: { _id: true, color: true },
        limit: 1,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body: { data: Array<{ color?: { value?: string } | string }> } =
    await response.json();
  const color: { value?: string } | string | undefined = body.data[0]?.color;

  return String(typeof color === "string" ? color : color?.value || "");
};

// Picks the row up from the keyboard, moves it up `places` rows, drops it.
const dragUp: (
  list: ListPage,
  name: string,
  places: number,
) => Promise<void> = async (
  list: ListPage,
  name: string,
  places: number,
): Promise<void> => {
  const grip: Locator = gripOf(list, name);
  await expect(grip).not.toHaveAttribute("aria-disabled", "true", SERVER);
  await grip.focus();
  await list.page.keyboard.press("Space");
  // react-beautiful-dnd lifts the row before it takes a move.
  await list.page.waitForTimeout(300);

  for (let place: number = 0; place < places; place++) {
    await list.page.keyboard.press("ArrowUp");
    await list.page.waitForTimeout(300);
  }

  await list.page.keyboard.press("Space");
};

/*
 * Fills the create form (name, description, colour) and saves it. The colour
 * starts picked; without a `color` the form's own pick is kept. Resolves to
 * the colour the form was saved with.
 */
const createFromForm: (
  list: ListPage,
  data: {
    namePlaceholder: string;
    name: string;
    description: string;
    color?: string | undefined;
  },
) => Promise<string> = async (
  list: ListPage,
  data: {
    namePlaceholder: string;
    name: string;
    description: string;
    color?: string | undefined;
  },
): Promise<string> => {
  const page: Page = list.page;
  const modal: Locator = page.getByTestId("modal");

  // One Create button, in the card's header.
  await page
    .getByTestId("card-button")
    .and(
      page.getByRole("button", {
        name: `Create ${list.singularName}`,
        exact: true,
      }),
    )
    .click();
  await expect(modal).toBeVisible();

  // Name, description and colour - nothing about the order.
  await expect(modal.getByText("Order", { exact: true })).toHaveCount(0);
  await expect(modal.getByText("Priority", { exact: true })).toHaveCount(0);

  await modal
    .getByPlaceholder(data.namePlaceholder, { exact: true })
    .fill(data.name);
  await modal.locator("textarea").first().fill(data.description);

  // The colour is already picked: Create works without touching it.
  const colorBox: Locator = modal.getByPlaceholder("Please select a color.", {
    exact: true,
  });
  await expect(colorBox).toHaveValue(/^#[0-9a-f]{6}$/);

  if (data.color) {
    await colorBox.click();
    const picker: Locator = page.getByTestId("color-picker-popup");
    await expect(picker).toBeVisible();
    // The picker's hex box: a whole hex is taken as it is typed.
    await picker.locator("input").first().fill(data.color);
    // Escape closes the picker, not the form.
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(modal).toBeVisible();
    await expect(colorBox).toHaveValue(data.color);
  }

  const savedColor: string = await colorBox.inputValue();

  const submit: Locator = modal.getByTestId("modal-footer-submit-button");
  await submit.click();
  await expect(modal).toBeHidden(SERVER);

  return savedColor;
};

const deleteProject: (page: Page, projectId: string) => Promise<void> = async (
  page: Page,
  projectId: string,
): Promise<void> => {
  const response: APIResponse = await page.request.delete(
    urlFor(`/api/project/${projectId}`),
    { headers: { tenantid: projectId } },
  );
  expect(response.ok(), "Temporary project is deleted").toBe(true);
};

test.describe("State, severity and monitor status settings", () => {
  test("incident states: created above Resolved, dragged into place, and a drag that breaks the order is put back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Incident States",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      const list: ListPage = {
        page,
        projectId,
        apiPath: "incident-state",
        singularName: "Incident State",
        orderField: "order",
      };
      const custom: string = "E2E Investigating";
      const modal: Locator = page.getByTestId("modal");

      const countsAs: (name: string) => Locator = (name: string): Locator => {
        return rowOf(list, name).getByTestId("state-settings-counts-as");
      };
      const builtInTag: (name: string) => Locator = (name: string): Locator => {
        return rowOf(list, name).getByTestId("state-settings-built-in");
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/incidents/settings/state`),
        ready: gripOf(list, "Resolved"),
      });

      // A titled card that says what the order means.
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Incident States",
      );
      await expect(
        page.getByText(
          "Incidents only ever move down this list. Drag a state to change where it sits. A new state is added just above the resolved state.",
        ),
      ).toBeVisible();

      // The project's states in the order incidents move through them.
      expect(await namesOnPage(list)).toEqual([
        "Identified",
        "Acknowledged",
        "Resolved",
      ]);

      // What an incident in each state counts as, from where it sits.
      await expect(
        page.getByRole("columnheader", { name: /Counts as/ }),
      ).toBeVisible();
      await expect(countsAs("Identified")).toHaveText("Not acknowledged");
      await expect(countsAs("Acknowledged")).toHaveText("Acknowledged");
      await expect(countsAs("Resolved")).toHaveText("Resolved");

      // The three OneUptime moves incidents into are tagged Built-in.
      for (const name of ["Identified", "Acknowledged", "Resolved"]) {
        await expect(builtInTag(name)).toBeVisible();
      }
      await expect(builtInTag("Resolved")).toContainText(
        "Resolving an incident moves it to this state. It can be renamed, but not deleted.",
      );

      // No order number anywhere: the rows are dragged.
      await expect(
        page.getByRole("columnheader", { name: /^Order/ }),
      ).toHaveCount(0);

      // A new state goes just above Resolved, never after it.
      await createFromForm(list, {
        namePlaceholder: "Investigating",
        name: custom,
        description: "The team is looking into what happened.",
        color: "#7c3aed",
      });
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(list);
        }, SERVER)
        .toEqual(["Identified", "Acknowledged", custom, "Resolved"]);
      expect(await namesOnServer(list)).toEqual([
        "Identified",
        "Acknowledged",
        custom,
        "Resolved",
      ]);
      await expect(countsAs(custom)).toHaveText("Acknowledged");
      await expect(builtInTag(custom)).toHaveCount(0);

      // Dragged above Acknowledged, it no longer counts as acknowledged.
      await dragUp(list, custom, 1);
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnServer(list);
        }, SERVER)
        .toEqual(["Identified", custom, "Acknowledged", "Resolved"]);
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(list);
        }, SERVER)
        .toEqual(["Identified", custom, "Acknowledged", "Resolved"]);
      await expect(countsAs(custom)).toHaveText("Not acknowledged", SERVER);

      // Resolved dragged above Acknowledged is refused, put back, and why.
      await dragUp(list, "Resolved", 1);
      const reorderError: Locator = page.getByTestId("reorder-error");
      await expect(reorderError).toBeVisible(SERVER);
      await expect(reorderError).toContainText(
        "The new order could not be saved.",
      );
      await expect(reorderError).toContainText(
        'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").',
      );
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(list);
        }, SERVER)
        .toEqual(["Identified", custom, "Acknowledged", "Resolved"]);
      expect(await namesOnServer(list)).toEqual([
        "Identified",
        custom,
        "Acknowledged",
        "Resolved",
      ]);

      // A built-in state keeps Delete in its menu, locked, saying why.
      await rowOf(list, "Resolved")
        .getByTestId("row-actions-more-button")
        .click();
      const lockedDelete: Locator = page.getByRole("menuitem", {
        name: "Delete",
      });
      await expect(lockedDelete).toHaveAttribute("aria-disabled", "true");
      await expect(lockedDelete).toHaveAccessibleDescription(
        "Built-in states can be renamed, but not deleted.",
      );
      await page.keyboard.press("Escape");
      await expect(lockedDelete).toHaveCount(0);

      // The ID is behind Show ID, not on the row.
      const customId: string = await (async (): Promise<string> => {
        const response: APIResponse = await page.request.post(
          urlFor("/api/incident-state/get-list"),
          {
            headers: { tenantid: projectId },
            data: {
              query: { projectId, name: custom },
              select: { _id: true },
              limit: 1,
              skip: 0,
              sort: {},
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        const body: { data: Array<{ _id: string }> } = await response.json();
        return body.data[0]!._id;
      })();
      await expect(rowOf(list, custom)).not.toContainText(customId);
      await rowOf(list, custom).getByTestId("row-actions-more-button").click();
      await page.getByRole("menuitem", { name: "Show ID" }).click();
      await expect(modal).toBeVisible();
      await expect(modal).toContainText("Incident State ID");
      await expect(modal).toContainText(customId);
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect(modal).toBeHidden();

      // A state of the project's own can be deleted.
      await rowOf(list, custom).getByTestId("row-actions-more-button").click();
      const deleteItem: Locator = page.getByRole("menuitem", {
        name: "Delete",
      });
      await expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");
      await deleteItem.click();
      await expect(modal).toBeVisible();
      await modal.getByTestId("modal-footer-submit-button").click();
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnServer(list);
        }, SERVER)
        .toEqual(["Identified", "Acknowledged", "Resolved"]);
      await expect(rowOf(list, custom)).toHaveCount(0, SERVER);
    } finally {
      await deleteProject(page, projectId);
    }
  });

  test("monitor statuses go in above Offline, and severities are added last and dragged into rank", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Statuses Severities",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      // ---- Monitor Statuses ----
      const statuses: ListPage = {
        page,
        projectId,
        apiPath: "monitor-status",
        singularName: "Monitor Status",
        orderField: "priority",
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/monitors/settings/status`),
        ready: gripOf(statuses, "Offline"),
      });
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Monitor Statuses",
      );
      expect(await namesOnPage(statuses)).toEqual([
        "Operational",
        "Degraded",
        "Offline",
      ]);

      // Statuses have no phases, so no "Counts as".
      await expect(
        page.getByRole("columnheader", { name: /Counts as/ }),
      ).toHaveCount(0);

      // Operational and Offline are built in; Degraded is the project's own.
      await expect(
        rowOf(statuses, "Operational").getByTestId("state-settings-built-in"),
      ).toBeVisible();
      await expect(
        rowOf(statuses, "Offline").getByTestId("state-settings-built-in"),
      ).toBeVisible();
      await expect(
        rowOf(statuses, "Degraded").getByTestId("state-settings-built-in"),
      ).toHaveCount(0);

      // A new status goes just above Offline, so an outage still shows worst.
      await createFromForm(statuses, {
        namePlaceholder: "Degraded",
        name: "E2E Partial Outage",
        description: "Some checks fail.",
        color: "#f97316",
      });
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(statuses);
        }, SERVER)
        .toEqual(["Operational", "Degraded", "E2E Partial Outage", "Offline"]);
      expect(await namesOnServer(statuses)).toEqual([
        "Operational",
        "Degraded",
        "E2E Partial Outage",
        "Offline",
      ]);

      // Offline's Delete is locked, with the reason.
      await rowOf(statuses, "Offline")
        .getByTestId("row-actions-more-button")
        .click();
      const lockedDelete: Locator = page.getByRole("menuitem", {
        name: "Delete",
      });
      await expect(lockedDelete).toHaveAttribute("aria-disabled", "true");
      await expect(lockedDelete).toHaveAccessibleDescription(
        "Built-in statuses can be renamed, but not deleted.",
      );
      await page.keyboard.press("Escape");
      await expect(lockedDelete).toHaveCount(0);

      // ---- Incident Severities ----
      const severities: ListPage = {
        page,
        projectId,
        apiPath: "incident-severity",
        singularName: "Incident Severity",
        orderField: "order",
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/incidents/settings/severity`),
        ready: gripOf(severities, "Minor Incident"),
      });
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Incident Severities",
      );
      expect(await namesOnPage(severities)).toEqual([
        "Critical Incident",
        "Major Incident",
        "Minor Incident",
      ]);
      // Severities have nothing built in and no phases.
      await expect(page.getByTestId("state-settings-built-in")).toHaveCount(0);
      await expect(
        page.getByRole("columnheader", { name: /Counts as/ }),
      ).toHaveCount(0);

      // A new severity goes to the end: the least severe.
      await createFromForm(severities, {
        namePlaceholder: "Critical",
        name: "E2E Cosmetic",
        description: "Nobody is blocked.",
        color: "#64748b",
      });
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(severities);
        }, SERVER)
        .toEqual([
          "Critical Incident",
          "Major Incident",
          "Minor Incident",
          "E2E Cosmetic",
        ]);

      // Dragged to the top, it is ranked most severe, and stays there.
      await dragUp(severities, "E2E Cosmetic", 3);
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnServer(severities);
        }, SERVER)
        .toEqual([
          "E2E Cosmetic",
          "Critical Incident",
          "Major Incident",
          "Minor Incident",
        ]);

      await page.reload();
      await expect(gripOf(severities, "E2E Cosmetic")).toBeVisible(SERVER);
      expect(await namesOnPage(severities)).toEqual([
        "E2E Cosmetic",
        "Critical Incident",
        "Major Incident",
        "Minor Incident",
      ]);
    } finally {
      await deleteProject(page, projectId);
    }
  });

  test("alert and scheduled maintenance lists read the same way, and a new maintenance state goes in above Completed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Alert Maintenance States",
      preferredPlanName: "Growth",
      enablePaidUsage: false,
    });

    try {
      // ---- Alert States ----
      const alertStates: ListPage = {
        page,
        projectId,
        apiPath: "alert-state",
        singularName: "Alert State",
        orderField: "order",
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/alerts/settings/state`),
        ready: gripOf(alertStates, "Resolved"),
      });
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Alert States",
      );
      expect(await namesOnPage(alertStates)).toEqual([
        "Identified",
        "Acknowledged",
        "Resolved",
      ]);
      await expect(
        rowOf(alertStates, "Identified").getByTestId(
          "state-settings-counts-as",
        ),
      ).toHaveText("Not acknowledged");
      await expect(
        rowOf(alertStates, "Resolved").getByTestId("state-settings-counts-as"),
      ).toHaveText("Resolved");
      await expect(page.getByTestId("state-settings-built-in")).toHaveCount(3);

      // ---- Alert Severities ----
      const alertSeverities: ListPage = {
        page,
        projectId,
        apiPath: "alert-severity",
        singularName: "Alert Severity",
        orderField: "order",
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(`/dashboard/${projectId}/alerts/settings/severity`),
        ready: gripOf(alertSeverities, "Low"),
      });
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Alert Severities",
      );
      expect(await namesOnPage(alertSeverities)).toEqual(["High", "Low"]);
      await expect(page.getByTestId("state-settings-built-in")).toHaveCount(0);

      // ---- Scheduled Maintenance States ----
      const maintenanceStates: ListPage = {
        page,
        projectId,
        apiPath: "scheduled-maintenance-state",
        singularName: "Scheduled Maintenance State",
        orderField: "order",
      };
      const maintenanceCountsAs: (name: string) => Locator = (
        name: string,
      ): Locator => {
        return rowOf(maintenanceStates, name).getByTestId(
          "state-settings-counts-as",
        );
      };

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(
          `/dashboard/${projectId}/scheduled-maintenance-events/settings/state`,
        ),
        ready: gripOf(maintenanceStates, "Completed"),
      });
      await expect(page.getByTestId("card-details-heading")).toHaveText(
        "Scheduled Maintenance States",
      );
      expect(await namesOnPage(maintenanceStates)).toEqual([
        "Scheduled",
        "Ongoing",
        "Ended",
        "Completed",
      ]);
      await expect(maintenanceCountsAs("Scheduled")).toHaveText("Scheduled");
      await expect(maintenanceCountsAs("Ongoing")).toHaveText("Ongoing");
      await expect(maintenanceCountsAs("Ended")).toHaveText("Ended");
      await expect(maintenanceCountsAs("Completed")).toHaveText("Completed");
      await expect(page.getByTestId("state-settings-built-in")).toHaveCount(4);

      /*
       * A new state goes just above Completed, so it never counts as done.
       * Its colour is left as the form picked it: one no state above uses.
       */
      const pickedColor: string = await createFromForm(maintenanceStates, {
        namePlaceholder: "Verifying",
        name: "E2E Verifying",
        description: "Checking that everything is back to normal.",
      });
      expect(pickedColor).toMatch(/^#[0-9a-f]{6}$/);
      // Not the seeded Ongoing yellow or Completed green.
      expect(["#ffbf53", "#2ab57d"]).not.toContain(pickedColor);
      await expect
        .poll(async (): Promise<string> => {
          return colorOnServer(maintenanceStates, "E2E Verifying");
        }, SERVER)
        .toBe(pickedColor);
      await expect
        .poll(async (): Promise<Array<string>> => {
          return namesOnPage(maintenanceStates);
        }, SERVER)
        .toEqual([
          "Scheduled",
          "Ongoing",
          "Ended",
          "E2E Verifying",
          "Completed",
        ]);
      expect(await namesOnServer(maintenanceStates)).toEqual([
        "Scheduled",
        "Ongoing",
        "Ended",
        "E2E Verifying",
        "Completed",
      ]);
      await expect(maintenanceCountsAs("E2E Verifying")).toHaveText("Ended");
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
