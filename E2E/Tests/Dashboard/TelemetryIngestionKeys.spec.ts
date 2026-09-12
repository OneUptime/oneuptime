import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
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
 * cd E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https BILLING_ENABLED=true \
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

  const nextButton: () => Locator = (): Locator => {
    return modal().getByTestId("modal-footer-submit-button");
  };

  const next: () => Promise<void> = async (): Promise<void> => {
    await expect(
      modal().getByRole("button", { name: "Back", exact: true }),
    ).toHaveCount(0);
    await expect(nextButton()).toHaveText("Next");
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

  const fillOrigins: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    /*
     * Wait for - and act on - the editor itself, never Monaco's focusable
     * control. That control is a hidden textarea Monaco parks at the caret,
     * and it collapses to zero size whenever the editor is not focused: on
     * the second call in a step Firefox reports it as hidden, and every
     * actionability check on it then times out. Clicking the rendered lines
     * focuses the editor the way a person does, and the keyboard goes
     * through the page rather than through a locator that has to be
     * "visible" first.
     */
    const lines: Locator = modal().locator(".monaco-editor .view-lines");
    await expect(modal().locator(".monaco-editor").first()).toBeVisible({
      timeout: 30000,
    });
    await lines.click();
    await ctx.page.keyboard.press("ControlOrMeta+A");
    await ctx.page.keyboard.press("Backspace");
    await expect(lines).toHaveText("");
    await ctx.page.keyboard.insertText(value);
    /*
     * Inserting the whole document at once does not escape Monaco's
     * auto-closing brackets: CursorsController.type replays the string one
     * character at a time through the same interceptors as real typing. So
     * `["https://app.example.com"` landed in the editor as
     * `["https://app.example.com"]` - valid JSON - and the wizard stepped
     * past the Browser Settings validation this helper exists to exercise.
     *
     * Everything Monaco auto-closes sits after the caret, on the caret's own
     * line (these fixtures are single-line), so select to the end of the line
     * and delete it. When the value needed no repair the selection is empty
     * and Delete at the end of the document is a no-op, which leaves balanced
     * values exactly as they were inserted.
     */
    await ctx.page.keyboard.press("Shift+End");
    await ctx.page.keyboard.press("Delete");
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
    await expect(nextButton()).toHaveText("Create Ingestion Key");
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
    await expect(nextButton()).toHaveText("Create Ingestion Key");
    await nextButton().click();
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
    const createButton: Locator = ctx.page.getByRole("button", {
      name: "Create Ingestion Key",
      exact: true,
    });
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.ingestionKeysUrl,
      ready: createButton,
    });
    await createButton.click();
    await expect(modal()).toBeVisible();
    await expect(nextButton()).toHaveText("Next");
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
    await expect(modal().locator(".monaco-editor .view-lines")).toContainText(
      origins[0]!,
    );
    await expect(modal().locator(".monaco-editor .view-lines")).toContainText(
      origins[1]!,
    );
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

    await ctx.page
      .getByRole("button", { name: "Create Ingestion Key", exact: true })
      .click();
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
    const progress: Locator = modal().getByRole("status");
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
    await expect(nextButton()).toBeVisible();
    expect(await fetchKeys(name)).toEqual([]);
    await modal().getByTestId("modal-footer-close-button").click();
  });
});
