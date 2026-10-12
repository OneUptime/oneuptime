import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Test LLM Provider, end to end in a browser, against the fixture's in-page
 * API (LlmProviderTest/Fixture.js), on the real Dashboard pages: a
 * provider's own page and Project Settings > AI > LLM Providers.
 *
 * A customer pressed Test on their own OpenAI provider and read "You do not
 * have permissions to select on - isGlobalLlm. You need any one of these
 * permissions:", above "Testing the connection to your LLM provider...", as
 * if the test were still running. What is pinned here is what a person sees
 * and what is sent: who may press Test (whoever may change the provider) and
 * what the locked button says to everyone else; the request (the provider's
 * id, the project's header); the dialog while the test runs - which can be
 * closed - and after it: passed, passed with a warning, failed with what to
 * check and the next step, and Test again; at phone width, in the dark theme
 * and in Japanese.
 *
 * The screenshots under output/playwright/llm-provider-test-ui are for the
 * people who review the dialog.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const PROVIDER_ID: string = "20000000-0000-4000-8000-000000000001";
const SECOND_PROVIDER_ID: string = "20000000-0000-4000-8000-000000000002";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-provider-test-ui",
);

const PASSED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

const BAD_KEY: string =
  "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key. OpenAI answered: Incorrect API key provided: sk-proj-****abcd.";

const REFUSAL: string =
  "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

const TESTING: string = "Sending a test prompt to your LLM provider…";

const CUSTOMER_REFUSAL: string =
  "You do not have permissions to select on - isGlobalLlm. No permission allows it: the column is not readable through the API.";

interface SentTest {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function sentTests(page: Page): Promise<Array<SentTest>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __llmProviderTestFixture: { state: { tests: unknown } };
          }
        ).__llmProviderTestFixture.state.tests,
      ),
    );
  });
}

async function setVerdict(page: Page, name: string): Promise<void> {
  await page.evaluate((verdict: string) => {
    (
      window as unknown as {
        __llmProviderTestFixture: { setVerdict: (name: string) => void };
      }
    ).__llmProviderTestFixture.setVerdict(verdict);
  }, name);
}

async function release(page: Page, name: string): Promise<void> {
  await page.evaluate((verdict: string) => {
    (
      window as unknown as {
        __llmProviderTestFixture: { release: (name: string) => void };
      }
    ).__llmProviderTestFixture.release(verdict);
  }, name);
}

function testButton(page: Page): Locator {
  return page.getByRole("button", { name: "Test", exact: true });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function outcome(page: Page): Locator {
  return page.getByTestId("llm-provider-test");
}

function result(page: Page): Locator {
  return page.getByTestId("llm-provider-test-result");
}

async function settledOn(page: Page, expected: string): Promise<void> {
  await expect(outcome(page)).toHaveAttribute("data-outcome", expected);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
  });
}

test.describe("a provider's own page: who may press Test", () => {
  for (const role of ["owner", "member", "settingsmember", "editllm"]) {
    test(`${role}: Test is offered, and says what it does`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `role=${role}`);

      await expect(testButton(page)).toBeEnabled();
      await testButton(page).hover();
      await expect(
        page.getByText(
          "Send this provider a short prompt to check its API key, model and Base URL.",
        ),
      ).toBeVisible();
    });
  }

  for (const role of ["viewer", "readllm"]) {
    test(`${role}: Test is locked, its reason the server's refusal, and pressing it sends nothing`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `role=${role}`);

      await expect(testButton(page)).toBeDisabled();

      const locked: Locator = page
        .getByTestId("card-button-disabled-wrapper")
        .filter({ has: testButton(page) });
      await locked.hover();
      await expect(page.getByText(REFUSAL)).toBeVisible();

      await locked.click({ force: true });
      await expect(dialog(page)).toHaveCount(0);
      expect(await sentTests(page)).toEqual([]);

      if (role === "viewer") {
        await shoot(page, "locked-viewer-1280");
      }
    });
  }

  test("a member whose team blocks their role: locked, told which block", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=blocked");

    await expect(testButton(page)).toBeDisabled();
    await page
      .getByTestId("card-button-disabled-wrapper")
      .filter({ has: testButton(page) })
      .hover();
    await expect(
      page.getByText(
        "You do not have permission to test this LLM provider. A team you are on blocks Project Member.",
      ),
    ).toBeVisible();
  });

  test("before the permission snapshot has landed, Test is not offered", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=loading");

    await expect(page.getByText("LLM Provider Details")).toBeVisible();
    await expect(testButton(page)).toHaveCount(0);
  });
});

test.describe("a provider's own page: the Test dialog", () => {
  test("one request: this provider's id, with the project's header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member");

    await testButton(page).click();
    await settledOn(page, "passed");

    const sent: Array<SentTest> = await sentTests(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toMatch(/\/llm-provider\/test$/);
    expect(sent[0]!.body).toEqual({ llmProviderId: PROVIDER_ID });
    expect(sent[0]!.headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("while it runs: what is happening, Close and no Test again; then the verdict", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=slow");

    await testButton(page).click();

    await expect(dialog(page).getByText("Test LLM Provider")).toBeVisible();
    await settledOn(page, "testing");
    await expect(dialog(page).getByText(TESTING)).toBeVisible();
    await expect(dialog(page).getByRole("status")).toBeVisible();
    await expect(page.getByTestId("llm-provider-test-again")).toHaveCount(0);
    await expect(page.getByTestId("modal-footer-submit-button")).toBeEnabled();
    await shoot(page, "testing-1280");

    await release(page, "passed");

    await settledOn(page, "passed");
    await expect(result(page)).toContainText("Test passed");
    await expect(result(page)).toContainText(PASSED);
    await expect(dialog(page).getByText(TESTING)).toHaveCount(0);
    await shoot(page, "passed-1280");
  });

  test("a provider that never answers: Close closes the dialog at once, and the late verdict is dropped", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = [];
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });

    await open(page, "role=owner&verdict=slow");

    await testButton(page).click();
    await settledOn(page, "testing");

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    await release(page, "badkey");
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("failed: what failed and what to check, the provider's words, the next step - and Test again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member&verdict=badkey");

    await testButton(page).click();
    await settledOn(page, "failed");

    await expect(result(page)).toContainText("Test failed");
    await expect(result(page)).toContainText(BAD_KEY);
    await expect(page.getByTestId("llm-provider-test-next-step")).toHaveText(
      "Change the provider's settings, then test again.",
    );
    // A failed test is the dialog's answer, not an error of the dialog.
    await expect(page.getByTestId("modal-error")).toHaveCount(0);
    await shoot(page, "failed-1280");

    // The key fixed elsewhere: Test again, and it passes.
    await setVerdict(page, "passed");
    await page.getByTestId("llm-provider-test-again").click();

    await settledOn(page, "passed");
    expect(await sentTests(page)).toHaveLength(2);
  });

  for (const [verdict, headline] of [
    ["warning", "Test passed, with a warning"],
    ["truncated", "Test passed, with a warning"],
    ["badmodel", "Test failed"],
    ["unreachable", "Test failed"],
  ]) {
    test(`${verdict}: headed "${headline}"`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `role=owner&verdict=${verdict}`);

      await testButton(page).click();

      await expect(result(page)).toContainText(headline!);

      if (verdict === "warning") {
        await shoot(page, "warning-1280");
      }
    });
  }

  test("an older server's refusal - the customer's words - is shown whole, never as a test still running", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=legacy");

    await testButton(page).click();
    await settledOn(page, "failed");

    await expect(result(page)).toContainText(CUSTOMER_REFUSAL);
    await expect(
      dialog(page).getByText(
        "Testing the connection to your LLM provider. This sends a small prompt using your configured API key, model, and base URL.",
      ),
    ).toHaveCount(0);
  });
});

test.describe("Project Settings > AI > LLM Providers: a row's Test", () => {
  test("a member tests the row's own provider, from the row's menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&role=member");

    await page
      .locator("tr")
      .filter({ hasText: "Claude" })
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menuitem", { name: "Test" }).click();

    await settledOn(page, "passed");

    const sent: Array<SentTest> = await sentTests(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ llmProviderId: SECOND_PROVIDER_ID });
    expect(sent[0]!.headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("a viewer finds the row's Test locked, and it sends nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&role=viewer");

    await page
      .locator("tr")
      .filter({ hasText: "Chatgpt" })
      .getByTestId("row-actions-more-button")
      .click();

    const item: Locator = page.getByRole("menuitem", { name: "Test" });
    await expect(item).toHaveAttribute("aria-disabled", "true");

    await item.click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(await sentTests(page)).toEqual([]);
  });
});

test.describe("the dialog at phone width, in the dark theme and in Japanese", () => {
  test("at 390px the dialog fits the screen and its buttons take its width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "role=owner&verdict=badkey");

    await testButton(page).click();
    await settledOn(page, "failed");

    const box: { x: number; width: number } | null =
      await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    const overflows: boolean = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    expect(overflows).toBe(false);

    const again: { width: number } | null = await page
      .getByTestId("llm-provider-test-again")
      .boundingBox();
    expect(again!.width).toBeGreaterThan(300);

    await shoot(page, "failed-390");
  });

  test("in the dark theme the dialog is dark, and each outcome keeps its color", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=slow&theme=dark");

    await testButton(page).click();
    await settledOn(page, "testing");
    await shoot(page, "testing-dark-1280");

    await release(page, "passed");
    await settledOn(page, "passed");

    const background: string = await dialog(page).evaluate(
      (element: Element) => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(background).not.toBe("rgb(255, 255, 255)");
    await shoot(page, "passed-dark-1280");

    await setVerdict(page, "badkey");
    await page.getByTestId("llm-provider-test-again").click();
    await settledOn(page, "failed");
    await shoot(page, "failed-dark-1280");

    await setVerdict(page, "warning");
    await page.getByTestId("llm-provider-test-again").click();
    await settledOn(page, "warning");
    await shoot(page, "warning-dark-1280");
  });

  test("in Japanese: the title, the headline, the next step and the buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=badkey&lang=ja");

    await page.getByRole("button", { name: "テスト", exact: true }).click();
    await settledOn(page, "failed");

    await expect(
      dialog(page).getByText("LLM プロバイダーをテスト"),
    ).toBeVisible();
    await expect(result(page)).toContainText("テストに失敗しました");
    await expect(page.getByTestId("llm-provider-test-next-step")).toHaveText(
      "プロバイダーの設定を変更してから、もう一度テストしてください。",
    );
    await expect(page.getByTestId("llm-provider-test-again")).toHaveText(
      "再テスト",
    );
    await shoot(page, "failed-ja-1280");
  });
});
