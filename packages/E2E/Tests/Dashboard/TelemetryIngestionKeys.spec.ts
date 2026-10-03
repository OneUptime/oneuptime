import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { getCardButton } from "../Helpers/CardButton";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

interface StoredKey {
  name: string;
  description?: string;
  keyType: string;
  allowedOrigins?: Array<string>;
  pinnedServiceName?: string;
}

interface SharedContext {
  page: Page;
  projectId: string;
  ingestionKeysUrl: string;
}

/*
 * Settings > Telemetry Ingestion Keys > Create, for real: real form, real
 * authentication and real persistence. A Server key is one page - its name
 * filled in, Server picked, the description folded under Advanced - and
 * the new key opens on its own page, where its secret is. A Browser key
 * walks on to its allowed origins; the Free plan (billing-enabled runs) to
 * the pricing, which has to be shown before the key can be created. A
 * temporary project isolates the keys and is deleted even when a test
 * fails. No telemetry is ingested.
 *
 * cd packages/E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https BILLING_ENABLED=true \
 *   npx playwright test Tests/Dashboard/TelemetryIngestionKeys.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Creating a telemetry ingestion key", () => {
  test.describe.configure({ mode: "serial" });

  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    ingestionKeysUrl: "",
  };

  const modal: () => Locator = (): Locator => {
    return ctx.page.getByTestId("modal");
  };

  /*
   * The card's own Create button. Until a test has created the project's
   * first key the list is empty, and an empty list offers the same button
   * again under its message.
   */
  const createButton: () => Locator = (): Locator => {
    return getCardButton(ctx.page, "Create Ingestion Key");
  };

  // The dialog's main button: Create Ingestion Key, or Next while it walks.
  const mainButton: () => Locator = (): Locator => {
    return modal().getByTestId("modal-footer-submit-button");
  };

  /*
   * The one button that reads Next: the main button while a step still to
   * come asks for something (or, on the Free plan, the Billing step has not
   * been shown), and the plain one beside Create Ingestion Key once every
   * step left is filled in. Walks on, never creates.
   */
  const next: () => Promise<void> = async (): Promise<void> => {
    const nextButton: Locator = modal().getByRole("button", {
      name: "Next",
      exact: true,
    });
    await expect(nextButton).toHaveCount(1);
    await nextButton.click();
  };

  const nameInput: () => Locator = (): Locator => {
    return modal().getByPlaceholder("Ingestion Key Name", { exact: true });
  };

  const card: (keyType: "Server" | "Browser") => Locator = (
    keyType: "Server" | "Browser",
  ): Locator => {
    return modal().getByTestId(`card-select-option-${keyType}`);
  };

  // The Advanced header on the step on screen.
  const advanced: () => Locator = (): Locator => {
    return modal().getByRole("button", { name: /^Advanced/ });
  };

  const progressList: () => Locator = (): Locator => {
    return modal().getByRole("navigation", { name: "Progress" });
  };

  const activeStep: () => Locator = (): Locator => {
    return modal().locator('[aria-current="step"]');
  };

  const returnToStep: (title: string) => Promise<void> = async (
    title: string,
  ): Promise<void> => {
    await progressList().getByText(title, { exact: true }).click();
    await expect(activeStep()).toHaveText(title);
  };

  // The Allowed Origins code editor: a textarea named by the field's label.
  const originsInput: () => Locator = (): Locator => {
    return modal().getByRole("textbox", { name: /^Allowed Origins/ });
  };

  /*
   * fill() replaces the document exactly - unbalanced brackets included,
   * which is what the validation cases need - and fires the input event the
   * form listens to. Focus then moves on, as a person's would.
   */
  const fillOrigins: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    await expect(originsInput()).toBeVisible({ timeout: 30000 });
    await originsInput().fill(value);
    await expect(originsInput()).toHaveValue(value);
    // Focus moves on, as a person's would.
    await modal().getByTestId("modal-title").click();
  };

  const pickType: (keyType: "Server" | "Browser") => Promise<void> = async (
    keyType: "Server" | "Browser",
  ): Promise<void> => {
    await card(keyType).click();
    await expect(card(keyType)).toHaveAttribute("aria-checked", "true");
  };

  // From the Key step of a Browser key to its Browser Settings step.
  const goToBrowserSettings: () => Promise<void> = async (): Promise<void> => {
    await pickType("Browser");
    // Allowed Origins is still to fill in: the main button walks on.
    await expect(mainButton()).toHaveText("Next");
    await next();
    await expect(activeStep()).toHaveText("Browser Settings");
    await expect(originsInput()).toBeVisible();
  };

  /*
   * On the Free plan, the pricing on the Billing step is shown before the
   * key can be created; elsewhere the step on screen creates it.
   */
  const readyToCreate: () => Promise<void> = async (): Promise<void> => {
    if (IS_BILLING_ENABLED) {
      await expect(mainButton()).toHaveText("Next");
      await next();
      await expect(
        modal().getByRole("region", { name: "Telemetry pricing", exact: true }),
      ).toBeVisible();
      await expect(activeStep()).toHaveText("Billing");
      await expect(modal().getByRole("checkbox")).toHaveCount(0);
    }
    await expect(mainButton()).toHaveText("Create Ingestion Key");
  };

  const fetchKeys: (name: string) => Promise<Array<StoredKey>> = async (
    name: string,
  ): Promise<Array<StoredKey>> => {
    const response: APIResponse = await ctx.page.request.post(
      URL.fromString(BASE_URL.toString())
        .addRoute("/api/telemetry-ingestion-key/get-list")
        .toString(),
      {
        headers: { tenantid: ctx.projectId },
        data: {
          query: { projectId: ctx.projectId, name },
          select: {
            name: true,
            description: true,
            keyType: true,
            allowedOrigins: true,
            pinnedServiceName: true,
          },
          limit: 5,
          skip: 0,
          sort: {},
        },
      },
    );
    expect(
      response.ok(),
      "The temporary project's ingestion keys can be read",
    ).toBe(true);
    const body: { data: Array<StoredKey> } = await response.json();
    return body.data;
  };

  /*
   * Creates the key and lands on its page, where the secret is, then reads
   * back what was stored.
   */
  const createAndRead: (name: string) => Promise<StoredKey> = async (
    name: string,
  ): Promise<StoredKey> => {
    // Nothing is created on the way here.
    expect(await fetchKeys(name)).toEqual([]);
    await expect(mainButton()).toHaveText("Create Ingestion Key");
    await mainButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });
    await expect(ctx.page).toHaveURL(
      new RegExp(
        `/dashboard/${ctx.projectId}/settings/telemetry-ingestion-keys/[a-f0-9-]+`,
      ),
      { timeout: 60000 },
    );
    await expect(ctx.page.locator('[role="hidden-text"]').first()).toBeVisible({
      timeout: 60000,
    });
    const keys: Array<StoredKey> = await fetchKeys(name);
    expect(keys).toHaveLength(1);
    return keys[0]!;
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Ingestion Key Form",
      preferredPlanName: "Free",
    });
    ctx.ingestionKeysUrl = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${ctx.projectId}/settings/telemetry-ingestion-keys`)
      .toString();
  });

  test.beforeEach(async () => {
    await ctx.page.setViewportSize({ width: 1440, height: 1000 });
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.ingestionKeysUrl,
      ready: createButton(),
    });
    await createButton().click();
    await expect(modal()).toBeVisible();
    await expect(nameInput()).toHaveValue("Server key");
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
          "The temporary ingestion key project is deleted",
        ).toBe(true);
      }
    } finally {
      await ctx.page?.close();
    }
  });

  test("opens with the name filled in, Server picked and the description folded", async () => {
    await expect(card("Server")).toHaveAttribute("aria-checked", "true");
    await expect(card("Browser")).toHaveAttribute("aria-checked", "false");
    await expect(advanced()).toHaveAttribute("aria-expanded", "false");
    await expect(
      modal().getByPlaceholder("Ingestion Key Description", { exact: true }),
    ).toBeHidden();
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toHaveCount(0);
    await expect(
      modal().getByRole("button", { name: "Back", exact: true }),
    ).toHaveCount(0);
    await expect(modal().getByText("Summary", { exact: true })).toHaveCount(0);

    if (IS_BILLING_ENABLED) {
      // The Free plan's pricing is a step of its own, still to be shown.
      await expect(progressList().getByRole("listitem")).toHaveText([
        "Key",
        "Billing",
      ]);
      await expect(mainButton()).toHaveText("Next");
      await expect(modal().getByTestId("modal-footer-next-button")).toHaveCount(
        0,
      );
    } else {
      // One page: nothing to walk.
      await expect(progressList()).toHaveCount(0);
      await expect(mainButton()).toHaveText("Create Ingestion Key");
    }

    await modal().getByTestId("modal-footer-close-button").click();
  });

  test("refuses a missing or short name before anything is created", async () => {
    await nameInput().fill("");
    await mainButton().click();
    await expect(
      modal().getByText("Name is required.", { exact: true }),
    ).toBeVisible();

    await nameInput().fill("x");
    await mainButton().click();
    await expect(
      modal().getByText("Name cannot be less than 2 characters.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(modal()).toBeVisible();
    expect(await fetchKeys("x")).toEqual([]);

    await modal().getByTestId("modal-footer-close-button").click();
  });

  test("the name follows the type until a name of one's own is typed", async () => {
    await pickType("Browser");
    await expect(nameInput()).toHaveValue("Browser key");
    await pickType("Server");
    await expect(nameInput()).toHaveValue("Server key");

    await nameInput().fill("Name of my own");
    await pickType("Browser");
    await expect(nameInput()).toHaveValue("Name of my own");

    await modal().getByTestId("modal-footer-close-button").click();
  });

  test("creates a Server key from the first page and opens it, where its secret is", async () => {
    const name: string = "Server one-page key";
    await nameInput().fill(name);
    await readyToCreate();

    const key: StoredKey = await createAndRead(name);
    expect(key.name).toBe(name);
    expect(key.keyType).toBe("Server");
    expect(key.description || "").toBe("");
    expect(key.allowedOrigins || []).toEqual([]);
  });

  test("a Browser key: origins checked on their own step, the pinned service under Advanced, stored as entered", async () => {
    const name: string = "Browser form key";
    const description: string = "Public telemetry for the storefront.";
    const origins: Array<string> = [
      "https://app.example.com",
      "https://*.example.org",
    ];
    const serviceName: string = "e2e-storefront-web";

    // The type with the keyboard, as well as the pointer elsewhere.
    await card("Server").focus();
    await ctx.page.keyboard.press("ArrowRight");
    await expect(card("Browser")).toBeFocused();
    await ctx.page.keyboard.press("Space");
    await expect(card("Browser")).toHaveAttribute("aria-checked", "true");
    await expect(nameInput()).toHaveValue("Browser key");
    await nameInput().fill(name);
    await advanced().click();
    await modal()
      .getByPlaceholder("Ingestion Key Description", { exact: true })
      .fill(description);

    await expect(progressList().getByRole("listitem")).toHaveText(
      IS_BILLING_ENABLED
        ? ["Key", "Browser Settings", "Billing"]
        : ["Key", "Browser Settings"],
    );
    await expect(mainButton()).toHaveText("Next");
    await next();
    await expect(activeStep()).toHaveText("Browser Settings");

    // The pinned service name waits under this step's Advanced.
    await expect(
      modal().getByPlaceholder("storefront-web", { exact: true }),
    ).toBeHidden();

    await mainButton().click();
    await expect(
      modal().getByText("Allowed Origins is required.", { exact: true }),
    ).toBeVisible();
    for (const invalidJSON of [
      '["https://app.example.com"',
      "{{origins}}",
      "   ",
    ]) {
      await fillOrigins(invalidJSON);
      await mainButton().click();
      await expect(
        modal().getByText(/Allowed Origins is not valid JSON\./),
      ).toBeVisible();
      await expect(activeStep()).toHaveText("Browser Settings");
    }
    for (const invalidOrigins of [
      {
        value: "[]",
        error: "Enter at least one allowed origin as a JSON array.",
      },
      {
        value: '{"origin":"https://app.example.com"}',
        error: "Enter at least one allowed origin as a JSON array.",
      },
      {
        value: '["https://app.example.com", 123]',
        error: "Every allowed origin must be text.",
      },
      {
        value: '["https://app.example.com/path"]',
        error: /must not contain a path\./,
      },
    ]) {
      await fillOrigins(invalidOrigins.value);
      await mainButton().click();
      await expect(
        modal().getByText(invalidOrigins.error, { exact: true }),
      ).toBeVisible();
      await expect(activeStep()).toHaveText("Browser Settings");
    }

    await fillOrigins(JSON.stringify(origins));
    await advanced().click();
    await modal()
      .getByPlaceholder("storefront-web", { exact: true })
      .fill(serviceName);

    /*
     * Back on Key and forward again: everything is still there. Every step
     * left is filled in now (bar the Free plan's pricing), so the main
     * button on Key would create the key: walk on with Next.
     */
    await returnToStep("Key");
    await expect(nameInput()).toHaveValue(name);
    await expect(card("Browser")).toHaveAttribute("aria-checked", "true");
    await expect(mainButton()).toHaveText(
      IS_BILLING_ENABLED ? "Next" : "Create Ingestion Key",
    );
    await next();
    await expect(activeStep()).toHaveText("Browser Settings");
    await expect(originsInput()).toHaveValue(JSON.stringify(origins));

    await readyToCreate();
    const key: StoredKey = await createAndRead(name);
    expect(key).toMatchObject({
      name,
      description,
      keyType: "Browser",
      allowedOrigins: origins,
      pinnedServiceName: serviceName,
    });
  });

  test("switching back to Server drops the Browser Settings step and its drafts", async () => {
    const name: string = "Changed to server key";
    await goToBrowserSettings();
    // An incomplete browser draft must not block the Server path.
    await fillOrigins('["unfinished');
    await advanced().click();
    await modal()
      .getByPlaceholder("storefront-web", { exact: true })
      .fill("discarded-browser-service");

    await returnToStep("Key");
    await pickType("Server");
    await expect(nameInput()).toHaveValue("Server key");
    if (IS_BILLING_ENABLED) {
      await expect(progressList().getByRole("listitem")).toHaveText([
        "Key",
        "Billing",
      ]);
    } else {
      await expect(progressList()).toHaveCount(0);
    }
    await nameInput().fill(name);
    await readyToCreate();

    const key: StoredKey = await createAndRead(name);
    expect(key.keyType).toBe("Server");
    expect(key.allowedOrigins || []).toEqual([]);
    expect(key.pinnedServiceName || "").toBe("");
  });

  test("a cancelled Browser draft reopens as a fresh Server key", async () => {
    const name: string = "Cancelled browser key";
    await nameInput().fill(name);
    await goToBrowserSettings();
    await fillOrigins('["https://cancelled.example.com"]');
    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();
    expect(await fetchKeys(name)).toEqual([]);

    await createButton().click();
    await expect(nameInput()).toHaveValue("Server key");
    await expect(card("Server")).toHaveAttribute("aria-checked", "true");
    await expect(card("Browser")).toHaveAttribute("aria-checked", "false");
    await modal().getByTestId("modal-footer-close-button").click();
  });

  test("on a narrow screen: no Back button, and the step count follows the type", async () => {
    await ctx.page.setViewportSize({ width: 390, height: 844 });
    /*
     * The form's step indicator. It is not the modal's only live region: the
     * Allowed Origins code editor has its own status bar.
     */
    const stepCount: Locator = modal()
      .getByRole("status")
      .filter({ hasText: /^Step \d+ of \d+/ });
    const backButton: Locator = modal().getByRole("button", {
      name: "Back",
      exact: true,
    });
    const serverSteps: number = IS_BILLING_ENABLED ? 2 : 1;
    const browserSteps: number = serverSteps + 1;

    await expect(backButton).toHaveCount(0);
    if (serverSteps === 1) {
      // One page: no "Step 1 of 1".
      await expect(stepCount).toHaveCount(0);
    } else {
      await expect(stepCount).toContainText(`Step 1 of ${serverSteps}`);
    }

    await pickType("Browser");
    await expect(stepCount).toContainText(`Step 1 of ${browserSteps}`);
    await expect(stepCount).toContainText("Key");
    await next();
    await expect(stepCount).toContainText(`Step 2 of ${browserSteps}`);
    await expect(stepCount).toContainText("Browser Settings");
    await expect(backButton).toHaveCount(0);
    await expect(originsInput()).toBeVisible();
    await modal().getByTestId("modal-footer-close-button").click();
  });
});
