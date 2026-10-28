import { expect, Locator, Page, test } from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * The bulk actions the table audit built on the shared bulk switch
 * (Common/UI/Components/BulkUpdate/BulkSwitchActions), in a browser,
 * against the offline fixture (BulkActions/Fixture): Enable and Disable on
 * the Workflows and Monitors lists, and Unsubscribe on a status page's
 * Email Subscribers.
 *
 * The audit's rules, one way on every list: an action is offered only when
 * it would change something; it asks first, with how many will change,
 * which, and what the change does to them; each row is its own update,
 * which the server checks; and the result says which rows changed, which
 * were left alone and which the server refused, and why. A member who may
 * not change a list sees its actions locked, saying why.
 *
 * The fixture records every update the page sends, so the tests check what
 * was written as well as what the page drew. Laptop (1280) and phone (390)
 * widths, light and dark, English and German.
 */

const PROJECT: string = "/dashboard/10000000-0000-4000-8000-000000000001";
const WORKFLOWS: string = `${PROJECT}/workflows`;
const MONITORS: string = `${PROJECT}/monitors?page=monitors`;
const SUBSCRIBERS: string = `${PROJECT}/status-pages/30000000-0000-4000-8000-000000000001/email-subscribers?page=subscribers`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/bulk-actions-ui",
);

const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const WORKFLOW_IDS: Record<string, string> = {
  onCall: "20000000-0000-4000-8000-000000000001",
  slack: "20000000-0000-4000-8000-000000000002",
  cleanup: "20000000-0000-4000-8000-000000000003",
  jira: "20000000-0000-4000-8000-000000000004",
};

const MONITOR_IDS: Record<string, string> = {
  checkout: "60000000-0000-4000-8000-000000000001",
  legacyFtp: "60000000-0000-4000-8000-000000000003",
};

const SUBSCRIBER_IDS: Record<string, string> = {
  ops: "70000000-0000-4000-8000-000000000001",
  site03: "70000000-0000-4000-8000-000000000002",
};

// BulkSwitchConsequences' sentences: what each change does.
const WORKFLOW_DISABLED: string =
  "A disabled workflow does not run when its trigger fires. You can still run it by hand from its Builder.";
const WORKFLOW_ENABLED: string =
  "An enabled workflow runs every time its trigger fires.";
const MONITOR_DISABLED: string =
  "A disabled monitor is not checked, and opens no incidents or alerts, until it is enabled again.";
const SUBSCRIBERS_UNSUBSCRIBED: string =
  "Unsubscribed subscribers get no more updates from this status page. They stay in the list, and each can be subscribed again from its Edit form.";

// The fixture's refusal, as the server words a label-scoped one.
const WORKFLOW_REFUSAL: string =
  "You do not have permission to update this Workflow. You need to have one of the following labels: Production.";

// What PermissionGate says to a Viewer about the Enabled switch.
const VIEWER_LOCKED: string =
  "You do not have permission to update this Workflow. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.";

interface RecordedUpdate {
  tableName: string;
  id: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // An action that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf-8"),
  ) as Record<string, string>;
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function openList(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByRole("checkbox").first()).toBeVisible();
}

/*
 * Rows and phone cards alike are selected by their checkbox's name: "Select
 * Workflow: Nightly cleanup", whose kind - and, since the box's sentence is
 * the shared "Select {{name}}", whose wording - is in the reader's language
 * ("Arbeitsablauf: Nightly cleanup auswählen").
 */
async function select(
  page: Page,
  kind: string,
  names: Array<string>,
  language: string = "en",
): Promise<void> {
  const [before, after] = (
    language === "en"
      ? "Select {{name}}"
      : readLocale(language)["Select {{name}}"] || "Select {{name}}"
  ).split("{{name}}");

  for (const name of names) {
    await page
      .getByRole("checkbox", {
        name:
          language === "en"
            ? `Select ${kind}: ${name}`
            : new RegExp(
                `^${escapeRegExp(before || "")}[^:]+: ${escapeRegExp(name)}${escapeRegExp(after || "")}$`,
              ),
        exact: true,
      })
      .check();
  }
}

async function openBulkMenu(
  page: Page,
  title: string = "Bulk Actions",
): Promise<Locator> {
  await page.getByText(title, { exact: true }).click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function choose(
  page: Page,
  action: string,
  title?: string,
): Promise<void> {
  const menu: Locator = await openBulkMenu(page, title);
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function confirm(page: Page): Promise<void> {
  await dialog(page).getByTestId("modal-footer-submit-button").click();
}

async function updatesSent(page: Page): Promise<Array<RecordedUpdate>> {
  return await page.evaluate((): Array<RecordedUpdate> => {
    return (
      window as unknown as {
        __fixture: { updates: Array<RecordedUpdate> };
      }
    ).__fixture.updates;
  });
}

// What changes and why, under the question.
function consequence(page: Page): Locator {
  return page.getByTestId("bulk-switch-consequence");
}

function rowNames(page: Page): Locator {
  return dialog(page).getByTestId("delete-confirmation-item");
}

// A colour's relative luminance, 0 (black) to 1 (white).
function luminance(rgb: string): number {
  const channels: Array<number> = (rgb.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

async function expectFitsTheScreen(page: Page): Promise<void> {
  const widths: { scroll: number; inner: number } = await page.evaluate(
    (): { scroll: number; inner: number } => {
      return {
        scroll: (document.scrollingElement as Element).scrollWidth,
        inner: window.innerWidth,
      };
    },
  );

  // Nothing scrolls sideways, and the dialog's buttons are on the screen.
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  await expect(
    dialog(page).getByTestId("modal-footer-submit-button"),
  ).toBeInViewport();
}

test.describe("the Workflows list", () => {
  test("offers Enable and Disable first, before labels, owners and archiving", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Nightly cleanup",
    ]);

    const menu: Locator = await openBulkMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Enable",
      "Disable",
      "Add Labels",
      "Remove Labels",
      "Add Owner",
      "Remove Owner",
      "Archive",
      "Export JSON",
      "Export CSV",
      "Delete",
    ]);
    await screenshot(page, "workflows-bulk-menu");
  });

  test("offers only the side that would change something", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);

    // Both on: Disable, and no Enable.
    await select(page, "Workflow", [
      "Page the on-call team",
      "Post incidents to Slack",
    ]);
    let menu: Locator = await openBulkMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Disable" })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Enable", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // Both off: Enable, and no Disable.
    await page.getByText("Clear Selection", { exact: true }).click();
    await select(page, "Workflow", ["Nightly cleanup", "Sync to Jira"]);
    menu = await openBulkMenu(page);
    await expect(
      menu.getByRole("menuitem", { name: "Enable", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Disable", exact: true }),
    ).toHaveCount(0);
  });

  test("Disable asks first: how many will change, which, and what disabling does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Post incidents to Slack",
      "Nightly cleanup",
    ]);
    await choose(page, "Disable");

    // The one already off is not counted, and not named...
    await expect(dialog(page)).toContainText("Disable 2 Workflows");
    await expect(page.getByTestId("confirm-modal-description")).toHaveText(
      "Are you sure you want to disable 2 workflows?",
    );
    await expect(rowNames(page)).toHaveText([
      "Page the on-call team",
      "Post incidents to Slack",
    ]);
    // ...but said, so three selected and two asked about add up.
    await expect(dialog(page).getByTestId("bulk-switch-already")).toHaveText(
      "1 selected workflow is already disabled.",
    );
    await expect(consequence(page)).toHaveText(WORKFLOW_DISABLED);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Disable");
    await screenshot(page, "workflows-disable-dialog");

    // Cancel changes nothing.
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(await updatesSent(page)).toEqual([]);
  });

  test("Disable turns off the workflows that were on, and says which it left alone and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Post incidents to Slack",
      "Nightly cleanup",
    ]);
    await choose(page, "Disable");
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Workflows disabled",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);
    await expect(page.getByTestId("bulk-action-unchanged-count")).toHaveText(
      "1 Workflow not changed",
    );
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toHaveText(["Workflow: Nightly cleanupAlready disabled."]);
    await screenshot(page, "workflows-disable-result");

    // One update each, of the switch only.
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "Workflow",
        id: WORKFLOW_IDS["onCall"],
        data: { isEnabled: false },
      },
      {
        tableName: "Workflow",
        id: WORKFLOW_IDS["slack"],
        data: { isEnabled: false },
      },
    ]);

    // The list is read again, and says so.
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator("tbody").getByText("Enabled")).toHaveCount(0);
    await expect(page.locator("tbody").getByText("Disabled")).toHaveCount(4);
  });

  test("Enable turns them on again, saying what that does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);
    await select(page, "Workflow", ["Nightly cleanup", "Sync to Jira"]);
    await choose(page, "Enable");

    await expect(dialog(page)).toContainText("Enable 2 Workflows");
    await expect(page.getByTestId("confirm-modal-description")).toHaveText(
      "Are you sure you want to enable 2 workflows?",
    );
    // Every selected workflow changes: nothing to say about the others.
    await expect(dialog(page).getByTestId("bulk-switch-already")).toHaveCount(
      0,
    );
    await expect(consequence(page)).toHaveText(WORKFLOW_ENABLED);
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Workflows enabled",
    );
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "Workflow",
        id: WORKFLOW_IDS["cleanup"],
        data: { isEnabled: true },
      },
      {
        tableName: "Workflow",
        id: WORKFLOW_IDS["jira"],
        data: { isEnabled: true },
      },
    ]);
  });

  test("a workflow the server refuses: the rest change, and the result says which and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, `${WORKFLOWS}?refuse=${WORKFLOW_IDS["slack"]}`);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Post incidents to Slack",
    ]);
    await choose(page, "Disable");
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Workflow disabled",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Workflow not disabled",
    );
    await expect(page.getByTestId("bulk-action-failed-items-group")).toHaveText(
      [`Workflow: Post incidents to Slack${WORKFLOW_REFUSAL}`],
    );
    await screenshot(page, "workflows-disable-refused");
  });

  test("a member who may not edit workflows finds Enable and Disable locked, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, `${WORKFLOWS}?role=viewer`);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Nightly cleanup",
    ]);
    const menu: Locator = await openBulkMenu(page);

    for (const action of ["Enable", "Disable"]) {
      await expect(
        menu.getByRole("menuitem", { name: action, exact: true }),
      ).toHaveAttribute("aria-disabled", "true");
    }

    await menu.getByRole("menuitem", { name: "Disable", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(VIEWER_LOCKED);
    await screenshot(page, "workflows-locked-for-viewer");

    // A click on a locked action opens nothing and sends nothing.
    await menu
      .getByRole("menuitem", { name: "Disable", exact: true })
      .click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(await updatesSent(page)).toEqual([]);
  });
});

test.describe("the Monitors list", () => {
  test("Disable writes Disable Monitoring on, and leaves a monitor already off alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, MONITORS);
    await select(page, "Monitor", ["Checkout API", "Legacy FTP"]);
    await choose(page, "Disable");

    await expect(dialog(page)).toContainText("Disable 1 Monitor");
    await expect(rowNames(page)).toHaveText(["Checkout API"]);
    await expect(dialog(page).getByTestId("bulk-switch-already")).toHaveText(
      "1 selected monitor is already disabled.",
    );
    await expect(consequence(page)).toHaveText(MONITOR_DISABLED);
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Monitor disabled",
    );
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toHaveText(["Monitor: Legacy FTPAlready disabled."]);
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "Monitor",
        id: MONITOR_IDS["checkout"],
        data: { disableActiveMonitoring: true },
      },
    ]);
  });

  test("Enable writes it off again, and is the only side offered for a monitor that is off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, MONITORS);
    await select(page, "Monitor", ["Legacy FTP"]);
    const menu: Locator = await openBulkMenu(page);
    await expect(
      menu.getByRole("menuitem", { name: "Disable", exact: true }),
    ).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Enable", exact: true }).click();

    await expect(dialog(page)).toContainText("Enable 1 Monitor");
    // Turning monitoring back on has nothing to warn about.
    await expect(consequence(page)).toHaveCount(0);
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Monitor enabled",
    );
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "Monitor",
        id: MONITOR_IDS["legacyFtp"],
        data: { disableActiveMonitoring: false },
      },
    ]);
  });
});

test.describe("a status page's Email Subscribers", () => {
  test("offer Unsubscribe, and never a way to subscribe people again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, SUBSCRIBERS);
    await select(page, "Subscriber", [
      "ops@example.com",
      "former.customer@example.com",
    ]);
    const menu: Locator = await openBulkMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Unsubscribe",
      "Export CSV",
      "Delete",
    ]);
  });

  test("Unsubscribe asks first, then unsubscribes the subscribed ones and leaves the rest as they are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, SUBSCRIBERS);
    await select(page, "Subscriber", [
      "ops@example.com",
      "site03-all@example.com",
      "former.customer@example.com",
    ]);
    await choose(page, "Unsubscribe");

    await expect(dialog(page)).toContainText("Unsubscribe 2 Subscribers");
    await expect(page.getByTestId("confirm-modal-description")).toHaveText(
      "Are you sure you want to unsubscribe 2 subscribers?",
    );
    await expect(rowNames(page)).toHaveText([
      "ops@example.com",
      "site03-all@example.com",
    ]);
    await expect(dialog(page).getByTestId("bulk-switch-already")).toHaveText(
      "1 selected subscriber is already unsubscribed.",
    );
    await expect(consequence(page)).toHaveText(SUBSCRIBERS_UNSUBSCRIBED);
    await screenshot(page, "subscribers-unsubscribe-dialog");
    await confirm(page);

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Subscribers unsubscribed",
    );
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toHaveText([
      "Subscriber: former.customer@example.comAlready unsubscribed.",
    ]);
    expect(await updatesSent(page)).toEqual([
      {
        tableName: "StatusPageSubscriber",
        id: SUBSCRIBER_IDS["ops"],
        data: { isUnsubscribed: true },
      },
      {
        tableName: "StatusPageSubscriber",
        id: SUBSCRIBER_IDS["site03"],
        data: { isUnsubscribed: true },
      },
    ]);
  });

  test("subscribers who all unsubscribed already are offered no Unsubscribe", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, SUBSCRIBERS);
    await select(page, "Subscriber", ["former.customer@example.com"]);
    const menu: Locator = await openBulkMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Export CSV",
      "Delete",
    ]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("the Workflows menu opens on the screen, and the Disable dialog fits it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, WORKFLOWS);
    await select(page, "Workflow", [
      "Page the on-call team",
      "Nightly cleanup",
    ]);
    const menu: Locator = await openBulkMenu(page);
    await expect(menu).toHaveCSS("opacity", "1");
    const box: { x: number; width: number } | null = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
    await screenshot(page, "workflows-bulk-menu-phone");

    await menu.getByRole("menuitem", { name: "Disable", exact: true }).click();
    await expect(consequence(page)).toHaveText(WORKFLOW_DISABLED);
    await expectFitsTheScreen(page);
    await screenshot(page, "workflows-disable-dialog-phone");

    await confirm(page);
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Workflow disabled",
    );
    await expectFitsTheScreen(page);
    await screenshot(page, "workflows-disable-result-phone");
  });

  test("the Unsubscribe dialog fits it", async ({ page }: { page: Page }) => {
    await openList(page, SUBSCRIBERS);
    await select(page, "Subscriber", [
      "ops@example.com",
      "site03-all@example.com",
    ]);
    await choose(page, "Unsubscribe");

    await expect(consequence(page)).toHaveText(SUBSCRIBERS_UNSUBSCRIBED);
    await expectFitsTheScreen(page);
    await screenshot(page, "subscribers-unsubscribe-dialog-phone");
  });
});

test.describe("in dark mode", () => {
  for (const viewport of [{ width: 1280, height: 900 }, PHONE]) {
    test(`the Disable dialog and its result are drawn dark, at ${viewport.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await openList(page, `${WORKFLOWS}?theme=dark`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await select(page, "Workflow", [
        "Page the on-call team",
        "Nightly cleanup",
      ]);
      await choose(page, "Disable");

      const colours: { panel: string; text: string; note: string } =
        await page.evaluate(
          (): { panel: string; text: string; note: string } => {
            return {
              panel: getComputedStyle(
                document.querySelector('[data-testid="modal"]') as Element,
              ).backgroundColor,
              text: getComputedStyle(
                document.querySelector(
                  '[data-testid="bulk-switch-consequence"]',
                ) as Element,
              ).color,
              note: getComputedStyle(
                document.querySelector(
                  '[data-testid="bulk-switch-already"]',
                ) as Element,
              ).color,
            };
          },
        );

      // A dark panel, and light words on it - the quieter note too.
      expect(luminance(colours.panel)).toBeLessThan(0.1);
      expect(luminance(colours.text)).toBeGreaterThan(0.5);
      expect(luminance(colours.note)).toBeGreaterThan(0.3);
      await screenshot(page, `workflows-disable-dialog-dark-${viewport.width}`);

      await confirm(page);
      await expect(
        page.getByTestId("bulk-action-succeeded-count"),
      ).toBeVisible();
      await screenshot(page, `workflows-disable-result-dark-${viewport.width}`);
    });
  }
});

test.describe("in German", () => {
  test("the menu, the question, what disabling does and the result are German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const german: Record<string, string> = readLocale("de");

    await openList(page, `${WORKFLOWS}?lang=de`);
    await select(
      page,
      "Workflow",
      ["Page the on-call team", "Post incidents to Slack", "Nightly cleanup"],
      "de",
    );
    const menu: Locator = await openBulkMenu(page, german["Bulk Actions"]);
    await expect(menu.getByRole("menuitem").first()).toHaveText(
      german["Enable"]!,
    );
    await menu
      .getByRole("menuitem", { name: german["Disable"]!, exact: true })
      .click();

    await expect(consequence(page)).toHaveText(german[WORKFLOW_DISABLED]!);
    // The one already off, in German, the noun keeping its capital.
    await expect(dialog(page).getByTestId("bulk-switch-already")).toHaveText(
      "Von Ihrer Auswahl ist 1 Arbeitsablauf bereits deaktiviert.",
    );
    await expect(dialog(page)).not.toContainText(WORKFLOW_DISABLED);
    await expect(dialog(page)).not.toContainText("Are you sure");
    await screenshot(page, "workflows-disable-dialog-german");

    await confirm(page);
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toContainText(german["Already disabled."]!);
    await screenshot(page, "workflows-disable-result-german");
  });
});
