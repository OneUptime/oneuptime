import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * AI / LLM > Connect, end to end in a browser, on the real page
 * (LlmConnect/Fixture.js). The maintainer could not see how to connect
 * OpenAI, Anthropic or Azure Foundry, or how to watch what the company's
 * people ask AI tools, and asked for the product to be easier to
 * understand. What is pinned here is what a person sees and what is sent:
 * the three ways in, side by side at the top and each ticking itself, the
 * one picked shown under them, a provider account and a company AI tool
 * connected from their tiles with a test first, the privacy of what people
 * wrote, and the list's status and actions - at desktop and phone width, in
 * the dark theme and in Japanese.
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

const PROVIDER_ACCOUNTS: Array<string> = [
  "openai",
  "anthropic",
  "azure-openai",
  "aws-bedrock",
  "google-vertex-ai",
];

const COMPANY_TOOLS: Array<string> = [
  "claude-enterprise",
  "microsoft-365-copilot",
];

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

function way(page: Page, key: string): Locator {
  return page.getByTestId(`llm-connect-way-${key}`);
}

function panel(page: Page, key: string): Locator {
  return page.getByTestId(`llm-connect-panel-${key}`);
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
  test("shows the three ways in, side by side, and opens on your apps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(
      page.getByText("Connect AI to OneUptime", { exact: true }),
    ).toBeVisible();

    const tabs: Locator = page
      .getByRole("tablist", { name: "Ways to bring AI in" })
      .getByRole("tab");

    await expect(tabs).toHaveText([
      /^Your apps/,
      /^Your AI provider accounts/,
      /^Your company's AI tools/,
    ]);

    for (const key of ["apps", "providers", "tools"]) {
      await expect(way(page, key)).toHaveAttribute("data-done", "false");
      await expect(way(page, key)).toBeInViewport();
    }

    // Your apps is picked, and only its path shows.
    await expect(way(page, "apps")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page, "apps")).toBeVisible();
    await expect(panel(page, "providers")).toBeHidden();
    await expect(panel(page, "tools")).toBeHidden();
    await expect(page.getByTestId("llm-apps-snippet-python")).toBeVisible();

    // Nothing works yet, so no budget is suggested.
    await expect(page.getByTestId("llm-connect-budget-hint")).toHaveCount(0);

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-empty");
  });

  test("the provider accounts: five tiles, with the way to connect each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await way(page, "providers").click();

    await expect(way(page, "providers")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel(page, "apps")).toBeHidden();

    for (const provider of PROVIDER_ACCOUNTS) {
      await expect(
        page.getByTestId(`llm-connection-tile-${provider}`),
      ).toBeVisible();
    }

    // The way picked is in the address, so a link opens it.
    expect(new URL(page.url()).searchParams.get("way")).toBe("providers");
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-providers");
  });

  test("the company AI tools: two tiles, telling your people, and the tools with no API folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "way=tools");

    await expect(way(page, "tools")).toHaveAttribute("aria-selected", "true");

    for (const tool of COMPANY_TOOLS) {
      await expect(
        page.getByTestId(`llm-connection-tile-${tool}`),
      ).toBeVisible();
    }

    await expect(
      panel(page, "tools").getByTestId("llm-tell-your-people"),
    ).toBeVisible();

    // The tools with no connector say what to do instead, a click away.
    const others: Locator = page.getByTestId("llm-other-ai-tools");

    await expect(others).not.toHaveAttribute("open", "");
    await page.getByTestId("llm-other-ai-tools-summary").click();

    for (const tool of [
      "chatgpt-enterprise",
      "gemini",
      "coding-assistants",
      "self-hosted-chat",
    ]) {
      await expect(page.getByTestId(`llm-other-ai-tool-${tool}`)).toBeVisible();
    }

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-tools");
  });

  test("ticks itself from what is true", async ({ page }: { page: Page }) => {
    await open(page, "state=done");

    await expect(page.getByTestId("llm-connect-way-apps-receiving")).toHaveText(
      "Receiving AI calls",
    );
    await expect(
      page.getByTestId("llm-connect-way-providers-connected"),
    ).toHaveText("Connected (2)");
    // Foundry East's last read failed.
    await expect(
      page.getByTestId("llm-connect-way-providers-failing"),
    ).toHaveText("Not working");
    await expect(
      page.getByTestId("llm-connect-way-tools-connected"),
    ).toHaveText("Connected");

    // An app's AI calls: the company tool's own service is left out.
    const state: FixtureState = await fixture(page);
    expect(JSON.stringify(state.spanLists[0])).toContain(
      "30000000-0000-4000-8000-000000000009",
    );

    // A budget is set: nothing more to suggest.
    await expect(page.getByTestId("llm-connect-budget-hint")).toHaveCount(0);
    await shoot(page, "connect-done");
  });

  test("once something works, a daily budget is the next step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await expect(page.getByTestId("llm-connect-budget-hint")).toBeVisible();
    await expect(page.getByTestId("llm-connect-budget-open")).toHaveText(
      /Open Budgets/,
    );
  });

  test("a tap on a way brings its path into view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await way(page, "tools").click();

    await expect(
      page.getByTestId("llm-connection-tile-claude-enterprise"),
    ).toBeInViewport();
  });

  test("arrow keys move along the ways", async ({ page }: { page: Page }) => {
    await open(page);

    await way(page, "apps").focus();
    await page.keyboard.press("ArrowRight");

    await expect(way(page, "providers")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(way(page, "providers")).toBeFocused();

    await page.keyboard.press("End");
    await expect(way(page, "tools")).toHaveAttribute("aria-selected", "true");
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
  test("OpenAI: where the key comes from, the key, a test, and what is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "way=providers");

    await page.getByTestId("llm-connection-tile-openai").click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("Connect OpenAI");
    // What arrives, under the title.
    await expect(dialog(page).getByTestId("modal-description")).toHaveText(
      "Tokens, requests and cost by day, model, project, API key and person.",
    );

    // Credentials first: where the key comes from, right above it.
    const hint: Locator = dialog(page).getByTestId(
      "llm-connection-credentials-hint",
    );
    await expect(hint).toContainText("Create an admin key");
    await expect(hint).toContainText("OneUptime only reads usage and cost.");
    await expect(
      dialog(page).getByTestId("llm-connection-guide-link"),
    ).toHaveAttribute(
      "href",
      /\/docs\/telemetry\/ai-provider-accounts#openai$/,
    );
    const key: Locator = dialog(page).getByPlaceholder("sk-admin-...");
    await expect(key).toBeVisible();
    await shoot(page, "connect-openai-credentials");

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
    // "It works": nothing is connected until Connect is pressed.
    await expect(passed).toContainText(
      "It works. Here is what the account used in the last 7 days.",
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
    await open(page, "way=providers&verdict=auth");

    await page.getByTestId("llm-connection-tile-openai").click();
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
    await open(page, "way=providers");

    await page.getByTestId("llm-connection-tile-azure-openai").click();
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
    await open(page, "way=providers");

    await page.getByTestId("llm-connection-tile-azure-openai").click();

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
    await open(page, "way=tools&verdict=tool");

    await page.getByTestId("llm-connection-tile-claude-enterprise").click();
    await expect(
      dialog(page).getByTestId("llm-connection-credentials-hint"),
    ).toContainText("Compliance API");
    // A company tool's key is not about usage and cost.
    await expect(
      dialog(page).getByTestId("llm-connection-reads-only"),
    ).toHaveCount(0);
    await dialog(page)
      .getByPlaceholder("sk-ant-api01-...")
      .fill("sk-ant-api01-e2e-compliance-key");
    await next(page).click();

    // Privacy: owners and admins only, and text kept, until changed.
    const readers: Locator = dialog(page).getByTestId("llm-connection-readers");
    await expect(dialog(page)).toContainText("Who can read conversations");
    await expect(
      readers.getByRole("radio", { name: "Project owners and admins" }),
    ).toBeChecked();
    await expect(
      readers.getByRole("radio", { name: "Everyone who can read AI calls" }),
    ).not.toBeChecked();
    await expect(dialog(page)).toContainText("Keep what was written");
    await expect(
      dialog(page).getByTestId("llm-tell-your-people"),
    ).toBeVisible();
    await shoot(page, "connect-claude-privacy");

    await next(page).click();
    await dialog(page).getByTestId("llm-connection-test-button").click();
    const passed: Locator = dialog(page).getByTestId(
      "llm-connection-test-pass",
    );
    await expect(passed).toContainText(
      "It works. Here is what the first read will bring in.",
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
    await open(page, "state=connected&way=providers");

    await expect(page.getByText("OpenAI production")).toBeVisible();
    await expect(page.getByText("Working").first()).toBeVisible();
    await expect(
      panel(page, "providers").getByText("Not working").first(),
    ).toBeVisible();
    await expect(page.getByText("$182.40 over the last 3 days")).toBeVisible();
    await expect(
      page.getByTestId("llm-connection-tile-connected-openai"),
    ).toBeVisible();

    await shoot(page, "connect-connected");

    await way(page, "tools").click();
    await expect(
      page.getByText("Waiting for the first read").first(),
    ).toBeVisible();
  });

  test("the error of a failing connection opens in full, with what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&way=providers");

    await page.getByRole("button", { name: "View error" }).first().click();
    await expect(page.getByTestId("llm-connection-error")).toContainText(
      "AuthorizationFailed",
    );
    // A permission failure, in the words a test uses for it.
    await expect(page.getByTestId("llm-connection-error-words")).toContainText(
      "The credential works, but it may not read what this connection needs.",
    );
    await shoot(page, "connect-last-error");
  });

  test("Read now queues a read and says how to see it end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&way=providers");

    await page.getByRole("button", { name: "Read now" }).first().click();
    await expect(page.getByTestId("llm-connections-notice")).toContainText(
      "Refresh the list in a minute",
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
    await open(page, "state=connected&way=providers");

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
    // An edit asks for what changes, not where a key comes from.
    await expect(
      dialog(page).getByTestId("llm-connection-credentials-hint"),
    ).toHaveCount(0);

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

test.describe("a connection that is off", () => {
  test("is turned on before anything else, and is not read now", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=off&way=providers");

    await expect(page.getByText("Bedrock us-east-1")).toBeVisible();
    await expect(
      panel(page, "providers").getByText("Off", { exact: true }),
    ).toBeVisible();
    // The row's own button is Turn on; Read now is not offered.
    await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read now" })).toHaveCount(0);
    // An account that is off is still connected - it is just not read.
    await expect(
      page.getByTestId("llm-connect-way-providers-connected"),
    ).toHaveText("Connected");
    await expect(
      page.getByTestId("llm-connect-way-providers-failing"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Turn on" }).click();

    const state: FixtureState = await fixture(page);
    expect(state.updates).toEqual([
      {
        id: "20000000-0000-4000-8000-000000000005",
        data: { isEnabled: true },
      },
    ]);
  });
});

test.describe("who may connect", () => {
  test("a member sees the ways in, but cannot connect, test or read now, and is told why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member&state=connected&way=providers");

    await expect(page.getByTestId("llm-connection-tile-openai")).toBeDisabled();
    await expect(
      panel(page, "providers").getByTestId("llm-connect-locked"),
    ).toContainText("Project Owner");
    await expect(
      page.getByRole("button", { name: "Read now" }).first(),
    ).toBeDisabled();
  });
});

test.describe("the Connect page in the dark theme and in Japanese", () => {
  test("dark", async ({ page }: { page: Page }) => {
    await open(page, "theme=dark&state=connected&way=providers");

    const background: string = await way(page, "apps").evaluate(
      (element: Element) => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(background).not.toBe("rgb(255, 255, 255)");

    // The picked way is marked in the dark too.
    const picked: string = await way(page, "providers").evaluate(
      (element: Element) => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(picked).not.toBe(background);
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-dark");
  });

  test("Japanese", async ({ page }: { page: Page }) => {
    await open(page, "lang=ja");

    for (const key of ["apps", "providers", "tools"]) {
      await expect(way(page, key)).toHaveText(JAPANESE_SCRIPT);
    }

    await shoot(page, "connect-japanese");
  });
});
