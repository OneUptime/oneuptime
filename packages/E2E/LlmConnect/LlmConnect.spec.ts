import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * AI / LLM > Connect, end to end in a browser, on the real page
 * (LlmConnect/Fixture.js). The maintainer could not see how to connect
 * OpenAI, Anthropic or Azure Foundry, or how to watch what the company's
 * people ask AI tools, and asked for the product to be easier to
 * understand. What is pinned here is what a person sees and what is sent:
 * the checklist that ticks itself, the three ways in, a provider account
 * and a company AI tool connected from their tiles with a test first, the
 * privacy of what people wrote, and the list's status and actions - at
 * desktop and phone width, in the dark theme and in Japanese.
 *
 * The screenshots under output/playwright/llm-connect-ui are for the people
 * who review the page.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-connect-ui",
);

// Kanji, hiragana or katakana: words the Japanese locale translated.
const JAPANESE_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

interface FixtureState {
  creates: Array<Record<string, unknown>>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  deletes: Array<string>;
  tests: Array<{ body: Record<string, unknown> }>;
  readNows: Array<string>;
  spanLists: Array<Record<string, unknown>>;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __llmConnectFixture: { state: unknown } })
          .__llmConnectFixture.state,
      ),
    );
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function next(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-next-button");
}

function submit(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

/*
 * The whole page, or - with a dialog open - what the screen shows, since
 * a dialog stays put while the page under it scrolls.
 */
async function shoot(page: Page, name: string): Promise<void> {
  const project: string = test.info().project.name;
  const hasDialog: boolean = (await page.getByTestId("modal").count()) > 0;
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${project}.png`),
    fullPage: !hasDialog,
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("the Connect page", () => {
  test("shows the three ways in and a checklist with nothing done yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(
      page.getByText("Connect AI to OneUptime", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("llm-connect-checklist-progress")).toHaveText(
      "0 of 4 done",
    );

    for (const key of ["apps", "providers", "companyTools", "budget"]) {
      await expect(
        page.getByTestId(`llm-connect-checklist-${key}`),
      ).toHaveAttribute("data-done", "false");
    }

    for (const title of [
      "Your apps",
      "Your AI provider accounts",
      "Your company's AI tools",
    ]) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    for (const provider of [
      "openai",
      "anthropic",
      "azure-openai",
      "aws-bedrock",
      "google-vertex-ai",
      "claude-enterprise",
      "microsoft-365-copilot",
    ]) {
      await expect(
        page.getByTestId(`llm-connection-tile-${provider}`),
      ).toBeVisible();
    }

    // The tools with no connector say what to do instead.
    for (const tool of [
      "chatgpt-enterprise",
      "gemini",
      "coding-assistants",
      "self-hosted-chat",
    ]) {
      await expect(page.getByTestId(`llm-other-ai-tool-${tool}`)).toBeVisible();
    }

    await expect(page.getByTestId("llm-tell-your-people")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-empty");
  });

  test("ticks itself from what is true", async ({ page }: { page: Page }) => {
    await open(page, "state=done");

    await expect(page.getByTestId("llm-connect-checklist-progress")).toHaveText(
      "4 of 4 done",
    );
    await expect(page.getByTestId("llm-connect-checklist-apps")).toContainText(
      "Your apps send their AI calls",
    );

    // An app's AI calls: the company tool's own service is left out.
    const state: FixtureState = await fixture(page);
    expect(JSON.stringify(state.spanLists[0])).toContain(
      "30000000-0000-4000-8000-000000000009",
    );
    await shoot(page, "connect-done");
  });

  test("a checklist line takes you to its section", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await page.getByTestId("llm-connect-checklist-open-companyTools").click();
    await expect(
      page.getByTestId("llm-connection-tile-claude-enterprise"),
    ).toBeInViewport();
  });

  test("the snippet carries the project's endpoint and the key picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const python: Locator = page.getByTestId("llm-apps-snippet-python");
    await expect(python).toContainText("Traceloop.init(");
    await expect(python).toContainText("http://localhost/otlp");
    await expect(python).toContainText("50000000-0000-4000-8000-000000000001");

    await page.getByTestId("llm-apps-snippet-tab-otel").click();
    await expect(page.getByTestId("llm-apps-snippet-otel")).toContainText(
      "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true",
    );

    await page.getByTestId("llm-apps-snippet-tab-gateway").click();
    await expect(page.getByTestId("llm-apps-snippet-gateway")).toContainText(
      'callbacks: ["otel"]',
    );
    await expect(page.getByTestId("llm-apps-snippet-gateway")).toContainText(
      "http://localhost/otlp/v1/traces",
    );
  });
});

test.describe("connecting a provider account", () => {
  test("OpenAI: the guide, the key, a test, and what is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await page.getByTestId("llm-connection-tile-openai").click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("Connect OpenAI");
    await expect(
      dialog(page).getByTestId("llm-connection-setup-guide"),
    ).toContainText("Create an admin key");
    await expect(
      dialog(page).getByTestId("llm-connection-guide-link"),
    ).toHaveAttribute(
      "href",
      /\/docs\/telemetry\/ai-provider-accounts#openai$/,
    );
    await shoot(page, "connect-openai-setup");

    await next(page).click();
    const key: Locator = dialog(page).getByPlaceholder("sk-admin-...");
    await expect(key).toBeVisible();
    await key.fill("sk-admin-e2e-test-key-0000000000000001");

    await next(page).click();
    await expect(
      dialog(page).getByTestId("llm-connection-test-panel"),
    ).toBeVisible();
    await dialog(page).getByTestId("llm-connection-test-button").click();

    const passed: Locator = dialog(page).getByTestId(
      "llm-connection-test-pass",
    );
    await expect(passed).toBeVisible();
    await expect(passed).toContainText(
      "Connected. Here is what the account used in the last 7 days.",
    );
    await expect(passed).toContainText("$182.40");
    await expect(passed).toContainText("1.4M");
    await shoot(page, "connect-openai-tested");

    const state: FixtureState = await fixture(page);
    expect(state.tests[0]!.body).toEqual({
      provider: "openai",
      config: {},
      secrets: { adminKey: "sk-admin-e2e-test-key-0000000000000001" },
    });

    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    const saved: FixtureState = await fixture(page);
    expect(saved.creates).toHaveLength(1);
    expect(saved.creates[0]).toMatchObject({
      name: "OpenAI",
      provider: "openai",
      config: {},
      isEnabled: true,
    });
    expect(JSON.parse(saved.creates[0]!["secrets"] as string)).toEqual({
      adminKey: "sk-admin-e2e-test-key-0000000000000001",
    });
  });

  test("a refused key says so, what to do, and what the provider answered", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "verdict=auth");

    await page.getByTestId("llm-connection-tile-openai").click();
    await next(page).click();
    await dialog(page).getByPlaceholder("sk-admin-...").fill("sk-admin-wrong");
    await next(page).click();
    await dialog(page).getByTestId("llm-connection-test-button").click();

    const failed: Locator = dialog(page).getByTestId(
      "llm-connection-test-fail",
    );
    await expect(failed).toContainText("The key or secret was not accepted.");
    await expect(failed).toContainText("Check that you copied all of it");
    await expect(
      dialog(page).getByTestId("llm-connection-test-details"),
    ).toContainText("HTTP 401");
    await shoot(page, "connect-openai-refused");
  });

  test("Next waits for every required setting", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await page.getByTestId("llm-connection-tile-azure-openai").click();
    await next(page).click();
    await next(page).click();

    // Still on Credentials, saying what is missing; the test is a step away.
    await expect(dialog(page)).toContainText("Directory (tenant) ID");
    await expect(
      dialog(page).getByTestId("llm-connection-test-panel"),
    ).toHaveCount(0);
    await expect(
      dialog(page)
        .getByText(/required/i)
        .first(),
    ).toBeVisible();
  });

  test("Azure: the cloud is folded under More fields and saved as its default", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await page.getByTestId("llm-connection-tile-azure-openai").click();
    await next(page).click();

    await dialog(page)
      .getByPlaceholder("00000000-0000-0000-0000-000000000000")
      .nth(0)
      .fill("b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c");
    await dialog(page)
      .getByPlaceholder("00000000-0000-0000-0000-000000000000")
      .nth(1)
      .fill("00001111-aaaa-2222-bbbb-3333cccc4444");
    await dialog(page)
      .getByPlaceholder("00000000-0000-0000-0000-000000000000")
      .nth(2)
      .fill("d0cfe6b2-9ac0-4464-9919-dccaee2e48c0");
    await dialog(page).locator('input[type="password"]').fill("client~secret");
    await expect(dialog(page)).toContainText("More fields");
    await shoot(page, "connect-azure-credentials");

    await next(page).click();
    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    const saved: FixtureState = await fixture(page);
    expect(saved.creates[0]).toMatchObject({
      provider: "azure-openai",
      config: {
        tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
        clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
        subscriptionId: "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0",
        cloud: "public",
      },
    });
  });
});

test.describe("connecting a company AI tool", () => {
  test("Claude Enterprise: who can read, whether text is kept, and telling people", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "verdict=tool");

    await page.getByTestId("llm-connection-tile-claude-enterprise").click();
    await expect(
      dialog(page).getByTestId("llm-tell-your-people"),
    ).toBeVisible();
    await next(page).click();
    await dialog(page)
      .getByPlaceholder("sk-ant-api01-...")
      .fill("sk-ant-api01-e2e-compliance-key");
    await next(page).click();

    // Privacy: owners and admins only, and text kept, until changed.
    await expect(dialog(page)).toContainText("Who can read conversations");
    await expect(dialog(page)).toContainText("Project owners and admins");
    await expect(dialog(page)).toContainText("Keep what was written");
    await shoot(page, "connect-claude-privacy");

    await next(page).click();
    await dialog(page).getByTestId("llm-connection-test-button").click();
    const passed: Locator = dialog(page).getByTestId(
      "llm-connection-test-pass",
    );
    await expect(passed).toContainText(
      "Connected. Here is what the first read will bring in.",
    );
    await expect(passed).toContainText("48");

    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    const saved: FixtureState = await fixture(page);
    expect(saved.creates[0]).toMatchObject({
      provider: "claude-enterprise",
      conversationReaders: "admins",
      storeConversationText: true,
    });
  });
});

test.describe("the list of connections", () => {
  test("says how each connection is doing and what its last read found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    const providers: Locator = page.locator(
      "#llm-connections-table-provider-account",
    );
    await expect(page.getByText("OpenAI production")).toBeVisible();
    await expect(page.getByText("Working").first()).toBeVisible();
    await expect(page.getByText("Not working").first()).toBeVisible();
    await expect(
      page.getByText("Waiting for the first read").first(),
    ).toBeVisible();
    await expect(page.getByText("$182.40 over the last 3 days")).toBeVisible();
    await expect(
      page.getByTestId("llm-connection-tile-connected-openai"),
    ).toBeVisible();
    expect(providers).toBeDefined();

    await shoot(page, "connect-connected");
  });

  test("the error of a failing connection opens in full", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByRole("button", { name: "View error" }).first().click();
    await expect(page.getByTestId("llm-connection-error")).toContainText(
      "AuthorizationFailed",
    );
  });

  test("Read now queues a read and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByRole("button", { name: "Read now" }).first().click();
    await expect(page.getByTestId("llm-connections-notice")).toContainText(
      "now",
    );

    const state: FixtureState = await fixture(page);
    expect(state.readNows).toHaveLength(1);
    expect(state.readNows[0]).toMatch(
      /^(\/api)?\/llm-observability-connection\/20000000-0000-4000-8000-000000000001\/read-now$/,
    );
  });

  test("editing keeps the stored key unless a new one is typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    // The row's other actions are under its More actions menu.
    await page
      .getByRole("button", {
        name: "More actions for AI Connection: OpenAI production",
      })
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).locator('input[type="password"]'),
    ).toHaveAttribute("placeholder", "Unchanged");

    // Credentials, then Test: Save is on the last step only.
    await next(page).click();
    await expect(
      dialog(page).getByTestId("llm-connection-test-panel"),
    ).toBeVisible();
    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    const state: FixtureState = await fixture(page);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.data["secrets"]).toBeUndefined();
  });
});

test.describe("who may connect", () => {
  test("a member sees the ways in, but cannot connect, test or read now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member&state=connected");

    await expect(page.getByTestId("llm-connection-tile-openai")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Read now" }).first(),
    ).toBeDisabled();
  });
});

test.describe("the Connect page in the dark theme and in Japanese", () => {
  test("dark", async ({ page }: { page: Page }) => {
    await open(page, "theme=dark&state=connected");

    const background: string = await page
      .getByTestId("llm-connect-checklist-apps")
      .evaluate((element: Element) => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-dark");
  });

  test("Japanese", async ({ page }: { page: Page }) => {
    await open(page, "lang=ja");

    await expect(page.getByTestId("llm-connect-checklist-progress")).toHaveText(
      JAPANESE_SCRIPT,
    );
    await expect(
      page.getByTestId("llm-connect-checklist-providers"),
    ).toHaveText(JAPANESE_SCRIPT);
    await shoot(page, "connect-japanese");
  });
});
