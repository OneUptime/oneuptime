import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  createItem,
  getProjectDefaults,
  JSONish,
  listItems,
  ProjectDefaults,
  toId,
} from "./Helpers/MonitorAlerting";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Monitors > Settings > Secrets (#1467): a secret is available to all
 * monitors, to specific monitors, or to monitors with any of its labels, and
 * the Access step shows the picker for the chosen option only.
 *
 * Real form, real API, real Postgres. What each test creates is read back
 * through the API, so the assertions are on what is stored - including what
 * the server empties when a secret's access changes. A temporary project
 * holds everything and is deleted afterwards.
 *
 * Monitor secrets are a Growth plan feature, so a billing-enabled run puts the
 * project on Growth.
 *
 * cd packages/E2E && HOST=localhost:<port> HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/MonitorSecretAccess.spec.ts
 */

interface StoredSecret {
  _id: string;
  name: string;
  monitorAccess: string;
  monitors: Array<string>;
  labels: Array<string>;
}

interface SharedContext {
  page: Page;
  projectId: string;
  secretsUrl: string;
  checkoutMonitorId: string;
  billingMonitorId: string;
  paymentsLabelId: string;
}

const CHECKOUT_MONITOR: string = "Checkout API";
const BILLING_MONITOR: string = "Billing API";
const PAYMENTS_LABEL: string = "payments";

const ACCESS_QUESTION: string = "Which monitors can use this secret?";

test.describe("Monitor secret access", () => {
  test.describe.configure({ mode: "serial" });

  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    secretsUrl: "",
    checkoutMonitorId: "",
    billingMonitorId: "",
    paymentsLabelId: "",
  };

  const modal: () => Locator = (): Locator => {
    return ctx.page.getByTestId("modal");
  };

  const submitButton: () => Locator = (): Locator => {
    return modal().getByTestId("modal-footer-submit-button");
  };

  const card: (access: string) => Locator = (access: string): Locator => {
    return modal().getByTestId(`card-select-option-${access}`);
  };

  const monitorsPicker: () => Locator = (): Locator => {
    return modal().getByRole("combobox", { name: /^Monitors/ });
  };

  const labelsPicker: () => Locator = (): Locator => {
    return modal().getByRole("combobox", { name: /^Labels/ });
  };

  const secretRow: (name: string) => Locator = (name: string): Locator => {
    return ctx.page.getByRole("row").filter({ hasText: name });
  };

  // A row shows one action as a button and folds the rest into its ⋯ menu.
  const runRowAction: (name: string, action: string) => Promise<void> = async (
    name: string,
    action: string,
  ): Promise<void> => {
    const row: Locator = secretRow(name);
    const inline: Locator = row.getByRole("button", {
      name: action,
      exact: true,
    });

    if ((await inline.count()) > 0) {
      await inline.click();
      return;
    }

    await row.getByRole("button", { name: /^More actions/ }).click();
    await ctx.page.getByRole("menuitem", { name: action, exact: true }).click();
  };

  const openCreateDialog: () => Promise<void> = async (): Promise<void> => {
    // An empty table repeats Create under its message; use the card's own.
    const createButton: Locator = ctx.page.getByTestId("card-button").and(
      ctx.page.getByRole("button", {
        name: "Create Monitor Secret",
        exact: true,
      }),
    );

    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.secretsUrl,
      ready: createButton,
    });
    await createButton.click();
    await expect(modal()).toBeVisible();
    await expect(submitButton()).toHaveText("Next");
  };

  const fillSecretStep: (name: string) => Promise<void> = async (
    name: string,
  ): Promise<void> => {
    await modal().getByPlaceholder("Secret Name", { exact: true }).fill(name);
    await modal()
      .getByPlaceholder("Secret Value (eg: API Key, Password, etc.)", {
        exact: true,
      })
      .fill(`value-of-${name}`);
    await submitButton().click();
    await expect(
      modal().getByRole("radiogroup", { name: ACCESS_QUESTION }),
    ).toBeVisible();
  };

  const choose: (access: string) => Promise<void> = async (
    access: string,
  ): Promise<void> => {
    await card(access).click();
    await expect(card(access)).toHaveAttribute("aria-checked", "true");
  };

  const pick: (picker: Locator, option: string) => Promise<void> = async (
    picker: Locator,
    option: string,
  ): Promise<void> => {
    await picker.click();
    await ctx.page.getByRole("option", { name: option, exact: true }).click();
    await expect(
      modal().getByRole("button", { name: `Remove ${option}` }),
    ).toBeVisible();

    /*
     * Close the option list so it cannot sit over the footer. The modal title
     * is inert; Escape would close the whole dialog.
     */
    await ctx.page.getByTestId("modal-title").click();
    await expect(ctx.page.getByRole("option", { name: option })).toHaveCount(0);
  };

  const create: (name: string) => Promise<StoredSecret> = async (
    name: string,
  ): Promise<StoredSecret> => {
    await expect(submitButton()).toHaveText("Create Monitor Secret");
    await submitButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });
    await expect(secretRow(name)).toBeVisible({ timeout: 30000 });
    return await readSecret(name);
  };

  const readSecret: (name: string) => Promise<StoredSecret> = async (
    name: string,
  ): Promise<StoredSecret> => {
    const rows: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor-secret",
      query: { name },
      select: {
        _id: true,
        name: true,
        monitorAccess: true,
        monitors: { _id: true },
        labels: { _id: true },
      },
    });

    expect(rows, `exactly one secret named ${name}`).toHaveLength(1);

    const row: JSONish = rows[0]!;

    return {
      _id: toId(row["_id"]),
      name: row["name"] as string,
      monitorAccess: row["monitorAccess"] as string,
      monitors: ((row["monitors"] as Array<JSONish>) || []).map(
        (monitor: JSONish): string => {
          return toId(monitor["_id"]);
        },
      ),
      labels: ((row["labels"] as Array<JSONish>) || []).map(
        (label: JSONish): string => {
          return toId(label["_id"]);
        },
      ),
    };
  };

  const postSecret: (data: JSONish) => Promise<APIResponse> = async (
    data: JSONish,
  ): Promise<APIResponse> => {
    return await ctx.page.request.post(
      URL.fromString(BASE_URL.toString())
        .addRoute("/api/monitor-secret")
        .toString(),
      {
        headers: {
          "content-type": "application/json",
          tenantid: ctx.projectId,
        },
        data: { data: { projectId: ctx.projectId, ...data } },
      },
    );
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);

    ctx.page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Monitor Secret Access",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });

    ctx.secretsUrl = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${ctx.projectId}/monitors/settings/secrets`)
      .toString();

    const defaults: ProjectDefaults = await getProjectDefaults({
      page: ctx.page,
      projectId: ctx.projectId,
    });

    for (const name of [CHECKOUT_MONITOR, BILLING_MONITOR]) {
      // Manual monitors: no probe, no plan cap, nothing that pages anyone.
      const monitor: JSONish = await createItem({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/monitor",
        item: {
          name,
          projectId: ctx.projectId,
          monitorType: "Manual",
          currentMonitorStatusId: defaults.operationalMonitorStatusId,
        },
      });

      const id: string = toId(monitor["_id"]);
      expect(id, `monitor ${name} is created`).not.toBe("");

      if (name === CHECKOUT_MONITOR) {
        ctx.checkoutMonitorId = id;
      } else {
        ctx.billingMonitorId = id;
      }
    }

    const label: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/label",
      item: {
        name: PAYMENTS_LABEL,
        projectId: ctx.projectId,
        color: { _type: "Color", value: "#16a34a" },
      },
    });

    ctx.paymentsLabelId = toId(label["_id"]);
    expect(ctx.paymentsLabelId, "the label is created").not.toBe("");
  });

  test.afterAll(async () => {
    try {
      if (ctx.projectId) {
        const response: APIResponse = await ctx.page.request.delete(
          URL.fromString(BASE_URL.toString())
            .addRoute(`/api/project/${ctx.projectId}`)
            .toString(),
          { headers: { tenantid: ctx.projectId } },
        );
        expect(
          response.ok(),
          "The temporary monitor secret project is deleted",
        ).toBe(true);
      }
    } finally {
      await ctx.page?.close();
    }
  });

  test("the Access step offers three options and shows only the chosen option's picker", async () => {
    await openCreateDialog();
    await fillSecretStep("PickerOnly");

    const options: Locator = modal()
      .getByRole("radiogroup", { name: ACCESS_QUESTION })
      .getByRole("radio");

    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("All monitors");
    await expect(options.nth(1)).toContainText("Specific monitors");
    await expect(options.nth(2)).toContainText("Monitors with labels");

    // Opens on the old behaviour: pick the monitors.
    await expect(card("Specific Monitors")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(monitorsPicker()).toBeVisible();
    await expect(labelsPicker()).toHaveCount(0);

    await choose("All Monitors");
    await expect(monitorsPicker()).toHaveCount(0);
    await expect(labelsPicker()).toHaveCount(0);

    await choose("Monitors With Labels");
    await expect(labelsPicker()).toBeVisible();
    await expect(monitorsPicker()).toHaveCount(0);

    await choose("Specific Monitors");
    await expect(monitorsPicker()).toBeVisible();
    await expect(labelsPicker()).toHaveCount(0);

    await modal().getByTestId("close-button").click();
    await expect(modal()).toBeHidden();
  });

  test("creates a secret every monitor can use, with no monitor or label to pick", async () => {
    await openCreateDialog();
    await fillSecretStep("SharedToken");
    await choose("All Monitors");

    const stored: StoredSecret = await create("SharedToken");

    expect(stored.monitorAccess).toBe("All Monitors");
    expect(stored.monitors).toEqual([]);
    expect(stored.labels).toEqual([]);
    await expect(
      secretRow("SharedToken").getByTestId("monitor-secret-access"),
    ).toHaveText("All monitors");
  });

  test("Specific monitors needs a monitor, and stores the ones picked", async () => {
    await openCreateDialog();
    await fillSecretStep("CheckoutKey");

    await submitButton().click();
    await expect(
      modal().getByText("Monitors is required.", { exact: true }),
    ).toBeVisible();

    await pick(monitorsPicker(), CHECKOUT_MONITOR);

    const stored: StoredSecret = await create("CheckoutKey");

    expect(stored.monitorAccess).toBe("Specific Monitors");
    expect(stored.monitors).toEqual([ctx.checkoutMonitorId]);
    expect(stored.labels).toEqual([]);

    const cell: Locator = secretRow("CheckoutKey").getByTestId(
      "monitor-secret-access",
    );
    await expect(cell).toContainText("Specific monitors");
    await expect(cell).toContainText(CHECKOUT_MONITOR);
    await expect(cell).not.toContainText(BILLING_MONITOR);
  });

  test("Monitors with labels needs a label, and stores the ones picked", async () => {
    await openCreateDialog();
    await fillSecretStep("PaymentsKey");
    await choose("Monitors With Labels");

    await submitButton().click();
    await expect(
      modal().getByText("Labels is required.", { exact: true }),
    ).toBeVisible();

    await pick(labelsPicker(), PAYMENTS_LABEL);

    const stored: StoredSecret = await create("PaymentsKey");

    expect(stored.monitorAccess).toBe("Monitors With Labels");
    expect(stored.labels).toEqual([ctx.paymentsLabelId]);
    expect(stored.monitors).toEqual([]);

    const cell: Locator = secretRow("PaymentsKey").getByTestId(
      "monitor-secret-access",
    );
    await expect(cell).toContainText("Monitors with labels");
    await expect(cell).toContainText(PAYMENTS_LABEL);
  });

  test("switching a secret to All monitors in Edit empties the monitor list it no longer reads", async () => {
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.secretsUrl,
      ready: secretRow("CheckoutKey"),
    });

    await runRowAction("CheckoutKey", "Edit");
    await expect(modal()).toBeVisible();

    await modal()
      .getByRole("navigation", { name: "Progress" })
      .getByText("Access", { exact: true })
      .click();
    await expect(card("Specific Monitors")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      modal().getByRole("button", { name: `Remove ${CHECKOUT_MONITOR}` }),
    ).toBeVisible();

    await choose("All Monitors");
    await expect(submitButton()).toHaveText("Save Changes");
    await submitButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });

    await expect(
      secretRow("CheckoutKey").getByTestId("monitor-secret-access"),
    ).toHaveText("All monitors", { timeout: 30000 });

    const stored: StoredSecret = await readSecret("CheckoutKey");

    expect(stored.monitorAccess).toBe("All Monitors");
    // The form still sent the old list; the server emptied it.
    expect(stored.monitors).toEqual([]);
  });

  test("the API defaults a secret to Specific monitors and refuses what it cannot store", async () => {
    const legacy: APIResponse = await postSecret({
      name: "ApiDefault",
      secretValue: "value",
      // Relations go over the API as { _id } objects.
      monitors: [{ _id: ctx.billingMonitorId }],
    });
    expect(legacy.ok(), await legacy.text()).toBe(true);

    const stored: StoredSecret = await readSecret("ApiDefault");
    expect(stored.monitorAccess).toBe("Specific Monitors");
    expect(stored.monitors).toEqual([ctx.billingMonitorId]);

    const unknownMode: APIResponse = await postSecret({
      name: "ApiUnknownMode",
      secretValue: "value",
      monitorAccess: "Everyone",
    });
    expect(unknownMode.status()).toBe(400);
    expect(await unknownMode.text()).toContain(
      "Monitor access must be one of: All Monitors, Specific Monitors, Monitors With Labels.",
    );

    const missingLabel: APIResponse = await postSecret({
      name: "ApiMissingLabel",
      secretValue: "value",
      monitorAccess: "Monitors With Labels",
      labels: [{ _id: "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e99" }],
    });
    expect(missingLabel.status()).toBe(400);
    expect(await missingLabel.text()).toContain("do not exist");

    const rows: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor-secret",
      query: {},
      select: { name: true },
      limit: 50,
    });

    expect(
      rows
        .map((row: JSONish): string => {
          return row["name"] as string;
        })
        .sort(),
    ).toEqual(
      ["ApiDefault", "CheckoutKey", "PaymentsKey", "SharedToken"].sort(),
    );
  });
});
