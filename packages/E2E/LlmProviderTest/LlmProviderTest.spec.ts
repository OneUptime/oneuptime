import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Test LLM Provider, end to end in a browser, against the fixture's in-page
 * API (LlmProviderTest/Fixture.js), on the real pages: a provider's own page
 * and Project Settings > AI > LLM Providers in the Dashboard, and Settings >
 * Global LLM Providers in the Admin Dashboard.
 *
 * A customer pressed Test on their own OpenAI provider and read "You do not
 * have permissions to select on - isGlobalLlm. You need any one of these
 * permissions:", above "Testing the connection to your LLM provider...", as
 * if the test were still running. What is pinned here is what a person sees
 * and what is sent: who may press Test (whoever may change the provider) and
 * what the locked button says to everyone else; the request (the provider's
 * id, the project's header); the dialog while the test runs - which every way
 * out of a dialog closes - and after it: passed, passed with a warning,
 * failed with what to check and, on a line of its own, what the provider
 * answered, and Test again; at phone width, in the dark theme and in Japanese
 * and German. And the row menu that holds Test: where it opens, and that a
 * locked item's reason waits for the pointer when the mouse opened it.
 *
 * The screenshots under output/playwright/llm-provider-test-ui are for the
 * people who review the dialog.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const PROVIDER_ID: string = "20000000-0000-4000-8000-000000000001";
const SECOND_PROVIDER_ID: string = "20000000-0000-4000-8000-000000000002";
const GLOBAL_PROVIDER_ID: string = "20000000-0000-4000-8000-000000000003";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-provider-test-ui",
);

const PASSED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

// What to check, then - on a line of its own - what the provider answered.
const BAD_KEY_LEAD: string =
  "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.";
const BAD_KEY_ANSWER: string =
  "OpenAI answered: Incorrect API key provided: sk-proj-****abcd.";

// The server's refusal: every permission that would let the test in.
const REFUSAL: string =
  "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

/*
 * The locked Test's reason: the server's first sentence, word for word,
 * then the permission to ask for, as every lock in the product names it.
 */
const LOCKED: string =
  "You do not have permission to test this LLM provider. You need this permission: Edit LLM.";

const TESTING: string = "Sending a test prompt to your LLM provider…";

const CHECKS: string =
  "This checks its API key, model and Base URL, and whether its model can call tools.";

const CUSTOMER_REFUSAL: string =
  "You do not have permissions to select on - isGlobalLlm. No permission allows it: the column is not readable through the API.";

// What the dialog once said under every 400, busy provider or not.
const RETIRED_NEXT_STEP: string =
  "Change the provider's settings, then test again.";

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

function closeButton(page: Page): Locator {
  return page.getByTestId("modal-footer-close-button");
}

function tooltip(page: Page): Locator {
  return page.locator("[data-tippy-root]");
}

/*
 * A menu item's tooltip opens beside the item it explains (MoreMenuItem):
 * level with it, on the menu's left, and clear of the menu - so the reason
 * never covers the items above it, and is never drawn where the menu opened
 * from instead of next to the item.
 */
async function expectBesideItem(page: Page, item: Locator): Promise<void> {
  const itemBox: { x: number; y: number; height: number } | null =
    await item.boundingBox();
  const tipBox: { x: number; y: number; width: number; height: number } | null =
    await tooltip(page).boundingBox();

  expect(
    Math.abs(
      tipBox!.y + tipBox!.height / 2 - (itemBox!.y + itemBox!.height / 2),
    ),
  ).toBeLessThan(4);
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(itemBox!.x);
}

async function settledOn(page: Page, expected: string): Promise<void> {
  await expect(outcome(page)).toHaveAttribute("data-outcome", expected);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
  });
}

/*
 * The dialog once its entrance has played: its boxes are where they stay.
 * The loader's bar runs for as long as the test does, so only the
 * animations that end are waited for.
 */
async function dialogAtRest(page: Page): Promise<void> {
  await dialog(page).evaluate(async (element: Element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation: Animation) => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation) => {
          return animation.finished;
        }),
    );
  });
}

// The footer's buttons, left to right, by what they say.
async function footerButtons(page: Page): Promise<Array<string>> {
  return (
    await page.getByTestId("modal-footer").getByRole("button").allInnerTexts()
  ).map((text: string) => {
    return text.trim();
  });
}

test.describe("a provider's own page: who may press Test", () => {
  for (const role of ["owner", "member", "settingsmember", "editllm"]) {
    test(`${role}: Test is offered, with no tooltip to pop up`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `role=${role}`);

      await expect(testButton(page)).toBeEnabled();
      await testButton(page).hover();
      // Its dialog says what it does; the button needs no tooltip of its own.
      await page.waitForTimeout(300);
      await expect(tooltip(page)).toHaveCount(0);
    });
  }

  for (const role of ["viewer", "readllm"]) {
    test(`${role}: Test is locked, its reason the server's first sentence and the permission to ask for, and pressing it sends nothing`, async ({
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
      await expect(page.getByText(LOCKED)).toBeVisible();

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

  test("while it runs: what is happening and what it checks, Close and no Test again; then the verdict", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=slow");

    await testButton(page).click();

    await expect(dialog(page).getByText("Test LLM Provider")).toBeVisible();
    await settledOn(page, "testing");
    await expect(dialog(page).getByText(TESTING)).toBeVisible();
    await expect(dialog(page).getByText(CHECKS)).toBeVisible();
    await expect(dialog(page).getByRole("status")).toBeVisible();
    await expect(page.getByTestId("llm-provider-test-again")).toHaveCount(0);
    expect(await footerButtons(page)).toEqual(["Close"]);
    await expect(closeButton(page)).toBeEnabled();
    await expect(closeButton(page)).toBeFocused();
    await dialogAtRest(page);
    const closeWhileTesting: { x: number; y: number } | null =
      await closeButton(page).boundingBox();
    await shoot(page, "testing-1280");

    await release(page, "passed");

    await settledOn(page, "passed");
    await expect(result(page)).toContainText("Test passed");
    await expect(result(page)).toContainText(PASSED);
    await expect(dialog(page).getByText(TESTING)).toHaveCount(0);
    // Test again arrives on the footer's left; Close keeps its place.
    expect(await footerButtons(page)).toEqual(["Test again", "Close"]);
    const closeAfter: { x: number; y: number } | null =
      await closeButton(page).boundingBox();
    expect(Math.abs(closeAfter!.x - closeWhileTesting!.x)).toBeLessThan(1);
    await shoot(page, "passed-1280");
  });

  for (const [way, leave] of [
    [
      "Close",
      async (page: Page): Promise<void> => {
        await closeButton(page).click();
      },
    ],
    [
      "the X",
      async (page: Page): Promise<void> => {
        await dialog(page).getByTestId("close-button").click();
      },
    ],
    [
      "Escape",
      async (page: Page): Promise<void> => {
        await page.keyboard.press("Escape");
      },
    ],
  ] as Array<[string, (page: Page) => Promise<void>]>) {
    test(`a provider that never answers: ${way} closes the dialog at once, and the late verdict is dropped`, async ({
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

      await leave(page);
      await expect(dialog(page)).toHaveCount(0);

      await release(page, "badkey");
      await expect(dialog(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("failed: what failed and what to check, then the provider's words on a line of their own - and Test again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member&verdict=badkey");

    await testButton(page).click();
    await settledOn(page, "failed");

    await expect(result(page)).toContainText("Test failed");
    await expect(result(page)).toContainText(BAD_KEY_LEAD);
    await expect(result(page)).toContainText(BAD_KEY_ANSWER);

    // The provider's words start a line of their own, below what to check.
    const lines: { lead: number; answer: number } = await result(page).evaluate(
      (
        element: Element,
        words: { lead: string; answer: string },
      ): { lead: number; answer: number } => {
        // The text node that holds the verdict, the headline being another.
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );
        let text: Node | null = walker.nextNode();
        while (text && !(text.textContent || "").includes(words.lead)) {
          text = walker.nextNode();
        }
        if (!text) {
          throw new Error("The verdict is not in the alert.");
        }
        const verdictText: Node = text;
        const content: string = verdictText.textContent || "";
        const topOf: (from: number) => number = (from: number): number => {
          const range: Range = document.createRange();
          range.setStart(verdictText, from);
          range.setEnd(verdictText, from + 1);
          return range.getBoundingClientRect().top;
        };
        return {
          lead: topOf(content.indexOf(words.lead)),
          answer: topOf(content.indexOf(words.answer)),
        };
      },
      { lead: BAD_KEY_LEAD, answer: BAD_KEY_ANSWER },
    );
    expect(lines.answer).toBeGreaterThan(lines.lead);

    // The server's words are the whole answer: nothing of the dialog's own.
    expect(await outcome(page).textContent()).toBe(
      await result(page).textContent(),
    );
    await expect(page.getByText(RETIRED_NEXT_STEP)).toHaveCount(0);
    // A failed test is the dialog's answer, not an error of the dialog.
    await expect(page.getByTestId("modal-error")).toHaveCount(0);
    await shoot(page, "failed-1280");

    // The key fixed elsewhere: Test again, and it passes.
    await setVerdict(page, "passed");
    await page.getByTestId("llm-provider-test-again").click();

    await settledOn(page, "passed");
    expect(await sentTests(page)).toHaveLength(2);
  });

  test("a provider that was only busy: told to wait and test again - never to change the settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=busy");

    await testButton(page).click();
    await settledOn(page, "failed");

    await expect(result(page)).toContainText(
      "OpenAI could not answer the request (HTTP 503). Test again in a few minutes.",
    );
    await expect(page.getByText(RETIRED_NEXT_STEP)).toHaveCount(0);
    await expect(page.getByTestId("llm-provider-test-again")).toBeVisible();
    await shoot(page, "busy-1280");
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
    await expect(dialog(page).getByText(TESTING)).toHaveCount(0);
    await expect(dialog(page).getByText(CHECKS)).toHaveCount(0);
    await expect(page.getByText(RETIRED_NEXT_STEP)).toHaveCount(0);
  });

  for (const [verdict, role, words] of [
    // The server's own refusal, whole: it names every permission.
    ["refused", "member", REFUSAL],
    ["plan", "owner", "Please upgrade your plan to Growth"],
  ]) {
    test(`${verdict}: the server's words alone - no line telling to change a provider that is not the trouble`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `role=${role}&verdict=${verdict}`);

      await testButton(page).click();
      await settledOn(page, "failed");

      await expect(result(page)).toContainText("Test failed");
      await expect(result(page)).toContainText(words!);
      expect(await outcome(page).textContent()).toBe(
        await result(page).textContent(),
      );
      await expect(page.getByTestId("llm-provider-test-again")).toBeVisible();

      if (verdict === "plan") {
        await shoot(page, "plan-1280");
      }
    });
  }

  test("closed with the mouse, the dialog leaves no tooltip over Test", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=passed");

    await testButton(page).click();
    await settledOn(page, "passed");
    await closeButton(page).click();
    await page.mouse.move(5, 5);

    await expect(dialog(page)).toHaveCount(0);
    // Focus goes back to Test, as it should, and nothing pops up there.
    await expect(testButton(page)).toBeFocused();
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toHaveCount(0);
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

  test("opened with the mouse, the menu opens under its ⋯ from its first frame, and the locked Test keeps its reason until pointed at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&role=viewer");

    const trigger: Locator = page
      .locator("tr")
      .filter({ hasText: "Chatgpt" })
      .getByTestId("row-actions-more-button");
    const triggerBox: { x: number; width: number } | null =
      await trigger.boundingBox();

    // Where the menu is, every frame from the press on.
    await page.evaluate(() => {
      const frames: Array<{ left: number; right: number }> = [];
      (window as unknown as { __menuFrames: unknown }).__menuFrames = frames;
      const start: number = performance.now();
      const tick: () => void = (): void => {
        const menu: Element | null = document.querySelector('[role="menu"]');
        if (menu && getComputedStyle(menu).visibility === "visible") {
          const box: DOMRect = menu.getBoundingClientRect();
          frames.push({ left: box.left, right: box.right });
        }
        if (performance.now() - start < 800) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    await trigger.click();
    await page.waitForTimeout(900);

    const frames: Array<{ left: number; right: number }> = await page.evaluate(
      () => {
        return (
          window as unknown as {
            __menuFrames: Array<{ left: number; right: number }>;
          }
        ).__menuFrames;
      },
    );

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      // Right-aligned to the ⋯, never at the left edge of the screen.
      expect(
        Math.abs(frame.right - (triggerBox!.x + triggerBox!.width)),
      ).toBeLessThan(2);
    }

    const item: Locator = page.getByRole("menuitem", { name: "Test" });
    await expect(item).toBeFocused();
    await expect(tooltip(page)).toHaveCount(0);
    await shoot(page, "list-viewer-menu-1280");

    // Pointed at, it says why it is locked - beside itself.
    await item.hover();
    await expect(tooltip(page)).toContainText(LOCKED);
    await expectBesideItem(page, item);
  });

  test("opened from the keyboard, the locked Test says why at once, beside itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&role=viewer");

    const trigger: Locator = page
      .locator("tr")
      .filter({ hasText: "Chatgpt" })
      .getByTestId("row-actions-more-button");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const item: Locator = page.getByRole("menuitem", { name: "Test" });
    await expect(item).toBeFocused();
    await expect(tooltip(page)).toContainText(LOCKED);

    await expectBesideItem(page, item);
    await shoot(page, "list-viewer-menu-keyboard-1280");
  });

  test("a member's menu opens without a tooltip: an unlocked Test needs none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&role=member");

    await page
      .locator("tr")
      .filter({ hasText: "Chatgpt" })
      .getByTestId("row-actions-more-button")
      .click();
    await page.getByRole("menuitem", { name: "Test" }).hover();
    await page.waitForTimeout(300);

    await expect(tooltip(page)).toHaveCount(0);
  });
});

test.describe("Admin Dashboard > Settings > Global LLM Providers: a row's Test", () => {
  test("a server administrator tests a global provider: no project header, the same dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=admin&verdict=slow");

    await page
      .locator("tr")
      .filter({ hasText: "OneUptime AI" })
      .getByRole("button", { name: "Test", exact: true })
      .click();

    await settledOn(page, "testing");
    await expect(dialog(page).getByText(TESTING)).toBeVisible();
    await expect(dialog(page).getByText(CHECKS)).toBeVisible();
    await shoot(page, "admin-testing-1280");

    await release(page, "unreachable");
    await settledOn(page, "failed");
    await expect(result(page)).toContainText(
      "OneUptime could not reach OpenAI",
    );

    const sent: Array<SentTest> = await sentTests(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ llmProviderId: GLOBAL_PROVIDER_ID });
    expect(sent[0]!.headers["tenantid"]).toBeUndefined();
  });

  test("in German, the Admin Dashboard's dialog speaks German too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=admin&verdict=badkey&lang=de");

    await page
      .locator("tr")
      .filter({ hasText: "OneUptime AI" })
      .getByRole("button", { name: "Testen", exact: true })
      .click();
    await settledOn(page, "failed");

    await expect(dialog(page).getByText("LLM-Anbieter testen")).toBeVisible();
    await expect(result(page)).toContainText("Test fehlgeschlagen");
    expect(await footerButtons(page)).toEqual(["Erneut testen", "Schließen"]);
    await shoot(page, "admin-failed-de-1280");
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

  test("in Japanese: the title, what it does while it runs, the headline and the buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=owner&verdict=slow&lang=ja");

    await page.getByRole("button", { name: "テスト", exact: true }).click();
    await settledOn(page, "testing");

    await expect(
      dialog(page).getByText("LLM プロバイダーをテスト"),
    ).toBeVisible();
    await expect(
      dialog(page).getByText(
        "API キー、モデル、ベース URL と、モデルがツールを呼び出せるかどうかを確認します。",
      ),
    ).toBeVisible();

    await release(page, "badkey");
    await settledOn(page, "failed");

    await expect(result(page)).toContainText("テストに失敗しました");
    expect(await footerButtons(page)).toEqual(["再テスト", "閉じる"]);
    await shoot(page, "failed-ja-1280");
  });
});
