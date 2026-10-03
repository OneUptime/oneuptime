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
 * Real form, real authentication and real persistence. A temporary project
 * isolates the keys and is deleted even when a test fails. No telemetry is
 * ingested. Billing-enabled runs use the shared Stripe test-mode fixture.
 *
 * cd packages/E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https BILLING_ENABLED=true \
 *   npx playwright test Tests/Dashboard/TelemetryIngestionKeys.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Telemetry ingestion key creation wizard", () => {
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

  // The dialog's main button: Next while it walks, then Create Ingestion Key.
  const mainButton: () => Locator = (): Locator => {
    return modal().getByTestId("modal-footer-submit-button");
  };

  /*
   * The one button that reads Next: the main button while a step still to
   * come asks for something (or, on the Free plan, the Billing step has not
   * been read), and the plain one beside Create Ingestion Key once every
   * step left is optional.
   */
  const nextButton: () => Locator = (): Locator => {
    return modal().getByRole("button", { name: "Next", exact: true });
  };

  const next: () => Promise<void> = async (): Promise<void> => {
    await expect(
      modal().getByRole("button", { name: "Back", exact: true }),
    ).toHaveCount(0);
    await expect(nextButton()).toHaveCount(1);
    await nextButton().click();
  };

  const fillDetails: (
    name: string,
    description?: string,
  ) => Promise<void> = async (
    name: string,
    description?: string,
  ): Promise<void> => {
    await modal()
      .getByPlaceholder("Ingestion Key Name", { exact: true })
      .fill(name);
    if (description) {
      await modal()
        .getByPlaceholder("Ingestion Key Description", { exact: true })
        .fill(description);
    }
  };

  const returnToStep: (title: string) => Promise<void> = async (
    title: string,
  ): Promise<void> => {
    await modal()
      .getByRole("navigation", { name: "Progress" })
      .getByText(title, { exact: true })
      .click();
    await expect(modal().locator('[aria-current="step"]')).toHaveText(title);
  };

  // The Allowed Origins code editor: a textarea named by the field's label.
  const originsInput: () => Locator = (): Locator => {
    return modal().getByRole("textbox", { name: /^Allowed Origins/ });
  };

  /*
   * fill() replaces the document exactly - unbalanced brackets included,
   * which is what the Browser Settings validation cases need - and fires
   * the input event the form listens to. Focus then moves on, as a
   * person's would.
   */
  const fillOrigins: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    await expect(originsInput()).toBeVisible({ timeout: 30000 });
    await originsInput().fill(value);
    await expect(originsInput()).toHaveValue(value);
    await modal().getByPlaceholder("storefront-web", { exact: true }).focus();
  };

  const review: () => Promise<void> = async (): Promise<void> => {
    await next();
    if (IS_BILLING_ENABLED) {
      await expect(
        modal().getByRole("region", { name: "Telemetry pricing", exact: true }),
      ).toBeVisible();
      await expect(modal().getByRole("checkbox")).toHaveCount(0);
      await next();
    }
    await expect(modal().locator('[aria-current="step"]')).toHaveText(
      "Summary",
    );
    await expect(mainButton()).toHaveText("Create Ingestion Key");
    await expect(nextButton()).toHaveCount(0);
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

  const createAndRead: (name: string) => Promise<StoredKey> = async (
    name: string,
  ): Promise<StoredKey> => {
    // Reaching Summary must not create a key as a side effect of Next.
    expect(await fetchKeys(name)).toEqual([]);
    await expect(mainButton()).toHaveText("Create Ingestion Key");
    await mainButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });
    await expect(
      ctx.page.getByRole("row").filter({ hasText: name }),
    ).toBeVisible({ timeout: 30000 });
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
      projectNamePrefix: "E2E Ingestion Key Wizard",
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
    await expect(nextButton()).toBeVisible();
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

  test("validates Details before showing Key Type and preserves fields when returning", async () => {
    const name: Locator = modal().getByPlaceholder("Ingestion Key Name", {
      exact: true,
    });
    const description: Locator = modal().getByPlaceholder(
      "Ingestion Key Description",
      { exact: true },
    );
    await expect(name).toBeVisible();
    await expect(description).toBeVisible();
    await expect(modal().getByTestId("card-select-option-Server")).toHaveCount(
      0,
    );
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toHaveCount(0);
    await expect(
      modal().getByRole("region", { name: "Telemetry pricing" }),
    ).toHaveCount(0);

    await next();
    await expect(
      modal().getByText("Name is required.", { exact: true }),
    ).toBeVisible();
    await expect(name).toBeVisible();
    await name.fill("x");
    await next();
    await expect(
      modal().getByText("Name cannot be less than 2 characters.", {
        exact: true,
      }),
    ).toBeVisible();

    await fillDetails("Validated draft key", "Preserved across form steps.");
    await next();
    await expect(name).toHaveCount(0);
    await expect(description).toHaveCount(0);
    await expect(
      modal().getByTestId("card-select-option-Server"),
    ).toHaveAttribute("aria-checked", "true");
    await returnToStep("Details");
    await expect(name).toHaveValue("Validated draft key");
    await expect(description).toHaveValue("Preserved across form steps.");
    expect(await fetchKeys("Validated draft key")).toEqual([]);
  });

  test("offers Create Ingestion Key once every step left is optional, and not before the Free plan's Billing step is read", async () => {
    const name: string = "Server key created early";
    await fillDetails(name);

    if (IS_BILLING_ENABLED) {
      // The pricing on the Billing step is read before a key can be created.
      await expect(mainButton()).toHaveText("Next");
      await next();
      await expect(mainButton()).toHaveText("Next");
      await next();
      await expect(
        modal().getByRole("region", { name: "Telemetry pricing", exact: true }),
      ).toBeVisible();
    }

    // Only optional steps are left: the main button creates the key.
    await expect(mainButton()).toHaveText("Create Ingestion Key");
    await expect(modal().getByTestId("modal-footer-next-button")).toHaveText(
      "Next",
    );
    await expect(
      modal().getByRole("button", { name: "Back", exact: true }),
    ).toHaveCount(0);

    const key: StoredKey = await createAndRead(name);
    expect(key.keyType).toBe("Server");
  });

  test("creates a Server key only after the summary and keeps Description optional", async () => {
    const name: string = "Server wizard key";
    await fillDetails(name);
    await next();
    await expect(
      modal().getByTestId("card-select-option-Server"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      modal().getByTestId("card-select-option-Browser"),
    ).toHaveAttribute("aria-checked", "false");
    await review();
    await expect(modal().getByText(name, { exact: true })).toBeVisible();
    await expect(modal().getByText("Server", { exact: true })).toBeVisible();
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toHaveCount(0);

    const key: StoredKey = await createAndRead(name);
    expect(key.name).toBe(name);
    expect(key.keyType).toBe("Server");
    expect(key.description || "").toBe("");
  });

  test("validates Browser origins, preserves its settings, and stores the reviewed values", async () => {
    const name: string = "Browser wizard key";
    const description: string = "Public telemetry for the storefront.";
    const origins: Array<string> = [
      "https://app.example.com",
      "https://*.example.org",
    ];
    const serviceName: string = "e2e-storefront-web";
    await fillDetails(name, description);
    await next();

    // Exercise the radio group's keyboard activation as well as pointer use.
    await modal().getByTestId("card-select-option-Server").focus();
    await ctx.page.keyboard.press("ArrowRight");
    await expect(
      modal().getByTestId("card-select-option-Browser"),
    ).toBeFocused();
    await ctx.page.keyboard.press("Space");
    await expect(
      modal().getByTestId("card-select-option-Browser"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toHaveCount(0);
    await next();
    await expect(
      modal().getByPlaceholder("storefront-web", { exact: true }),
    ).toBeVisible();

    await next();
    await expect(
      modal().getByText("Allowed Origins is required.", { exact: true }),
    ).toBeVisible();
    for (const invalidJSON of [
      '["https://app.example.com"',
      "{{origins}}",
      "   ",
    ]) {
      await fillOrigins(invalidJSON);
      await next();
      await expect(
        modal().getByText(/Allowed Origins is not valid JSON\./),
      ).toBeVisible();
      await expect(modal().locator('[aria-current="step"]')).toHaveText(
        "Browser Settings",
      );
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
      await next();
      await expect(
        modal().getByText(invalidOrigins.error, { exact: true }),
      ).toBeVisible();
      await expect(modal().locator('[aria-current="step"]')).toHaveText(
        "Browser Settings",
      );
      await expect(
        modal().getByPlaceholder("storefront-web", { exact: true }),
      ).toBeVisible();
    }
    await fillOrigins(JSON.stringify(origins));
    await modal()
      .getByPlaceholder("storefront-web", { exact: true })
      .fill(serviceName);
    await returnToStep("Key Type");
    await expect(
      modal().getByTestId("card-select-option-Browser"),
    ).toHaveAttribute("aria-checked", "true");
    await next();
    await expect(
      modal().getByPlaceholder("storefront-web", { exact: true }),
    ).toHaveValue(serviceName);
    await expect(originsInput()).toHaveValue(JSON.stringify(origins));
    await review();
    await expect(modal().getByText(name, { exact: true })).toBeVisible();
    await expect(modal().getByText(description, { exact: true })).toBeVisible();
    await expect(modal().getByText(serviceName, { exact: true })).toBeVisible();
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toBeVisible();

    const key: StoredKey = await createAndRead(name);
    expect(key).toMatchObject({
      name,
      description,
      keyType: "Browser",
      allowedOrigins: origins,
      pinnedServiceName: serviceName,
    });
  });

  test("switching back to Server skips Browser Settings and removes them from the summary", async () => {
    const name: string = "Changed to server wizard key";
    await fillDetails(name, "Changed my mind before creating this key.");
    await next();
    await modal().getByTestId("card-select-option-Browser").click();
    await next();
    // An incomplete browser draft must not block the Server path.
    await fillOrigins('["unfinished');
    await modal()
      .getByPlaceholder("storefront-web", { exact: true })
      .fill("discarded-browser-service");
    await returnToStep("Key Type");
    await modal().getByTestId("card-select-option-Server").click();
    await review();
    await expect(
      modal().getByText("Allowed Origins", { exact: true }),
    ).toHaveCount(0);
    await expect(
      modal().getByText("Pinned Service Name", { exact: true }),
    ).toHaveCount(0);
    await expect(
      modal().getByText("discarded-browser-service", { exact: true }),
    ).toHaveCount(0);
    const key: StoredKey = await createAndRead(name);
    expect(key.keyType).toBe("Server");
  });

  test("cancelling a Browser draft reopens at Details with the default Server type", async () => {
    const name: string = "Cancelled browser wizard key";
    await fillDetails(name, "This draft must not be submitted.");
    await next();
    await modal().getByTestId("card-select-option-Browser").click();
    await next();
    await fillOrigins('["https://cancelled.example.com"]');
    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();
    expect(await fetchKeys(name)).toEqual([]);

    await createButton().click();
    await expect(
      modal().getByPlaceholder("Ingestion Key Name", { exact: true }),
    ).toHaveValue("");
    await expect(
      modal().getByPlaceholder("Ingestion Key Description", { exact: true }),
    ).toHaveValue("");
    await fillDetails("Fresh draft after cancel");
    await next();
    await expect(
      modal().getByTestId("card-select-option-Server"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      modal().getByTestId("card-select-option-Browser"),
    ).toHaveAttribute("aria-checked", "false");
    await modal().getByTestId("modal-footer-close-button").click();
  });

  test("shows mobile step progress without a Back button and reviews the entered values", async () => {
    await ctx.page.setViewportSize({ width: 390, height: 844 });
    const name: string = "Mobile browser draft";
    const description: string = "Created from a narrow screen.";
    const serviceName: string = "mobile-storefront-web";
    const origin: string = "https://mobile.example.com";
    const serverStepCount: number = IS_BILLING_ENABLED ? 4 : 3;
    const browserStepCount: number = serverStepCount + 1;
    /*
     * The form's step indicator. It is not the modal's only live region: the
     * Allowed Origins code editor has its own status bar.
     */
    const progress: Locator = modal()
      .getByRole("status")
      .filter({ hasText: /^Step \d+ of \d+/ });
    const backButton: Locator = modal().getByRole("button", {
      name: "Back",
      exact: true,
    });

    await expect(backButton).toHaveCount(0);
    await expect(progress).toBeVisible();
    await expect(progress).toContainText(`Step 1 of ${serverStepCount}`);
    await expect(progress).toContainText("Details");
    await fillDetails(name, description);
    await next();
    await expect(backButton).toHaveCount(0);
    await expect(progress).toContainText(`Step 2 of ${serverStepCount}`);
    await expect(progress).toContainText("Key Type");
    await modal().getByTestId("card-select-option-Browser").click();
    await expect(progress).toContainText(`Step 2 of ${browserStepCount}`);
    await next();
    await expect(progress).toContainText(`Step 3 of ${browserStepCount}`);
    await expect(progress).toContainText("Browser Settings");
    await fillOrigins(JSON.stringify([origin]));
    await modal()
      .getByPlaceholder("storefront-web", { exact: true })
      .fill(serviceName);

    await review();
    await expect(backButton).toHaveCount(0);
    await expect(progress).toContainText(
      `Step ${browserStepCount} of ${browserStepCount}`,
    );
    await expect(progress).toContainText("Summary");
    await expect(modal().getByText(name, { exact: true })).toBeVisible();
    await expect(modal().getByText(description, { exact: true })).toBeVisible();
    await expect(modal().getByText(serviceName, { exact: true })).toBeVisible();
    await expect(modal().getByTestId("modal-content")).toContainText(origin);
    await expect(mainButton()).toBeVisible();
    expect(await fetchKeys(name)).toEqual([]);
    await modal().getByTestId("modal-footer-close-button").click();
  });
});
