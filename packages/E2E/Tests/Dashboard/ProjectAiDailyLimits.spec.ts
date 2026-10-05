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

/*
 * A project's own daily AI limits, on Project Settings → AI Features →
 * More settings, against a real stack: the fold, the Daily limits card,
 * the server's rules and today's usage.
 *
 *  - More settings starts folded under Enable AI, names its one card -
 *    Daily limits - and says what applies and what AI used today:
 *    "Nothing limits how much OneUptime AI uses each day. Used today: 0
 *    tokens." (with the AI credits spent too, where AI is billed);
 *  - a token limit saved from the card is stored, is what the folded
 *    sentence says ("At most 200,000 tokens a day."), and is what
 *    POST /api/ai/daily-usage answers;
 *  - the spend limit is offered only where AI is billed: there it is saved
 *    and said in dollars; elsewhere the card has no such field and the API
 *    refuses one;
 *  - the server refuses a limit of 0 and points at Enable AI;
 *  - a cleared field is no limit again.
 *
 * No LLM provider is needed: nothing here calls a model. Enforcement - a
 * call past a limit refused, logged and explained - is covered by the
 * Common server suites (AIServiceProjectDailyLimits).
 *
 * One project for the whole file, in order.
 */

test.describe.configure({ mode: "serial" });

const urlFor: (path: string) => string = (path: string): string => {
  return `${BASE_URL.toString().replace(/\/$/, "")}${path}`;
};

test.describe("Project Settings → AI Features: daily AI limits", () => {
  let page: Page;
  let projectId: string = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E AI daily limits",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });
  });

  test.afterAll(async () => {
    try {
      if (projectId) {
        await page.request.delete(urlFor(`/api/project/${projectId}`), {
          headers: { tenantid: projectId },
        });
      }
    } finally {
      await page?.close();
    }
  });

  const section: () => Locator = (): Locator => {
    return page.getByTestId("project-ai-advanced-section");
  };

  const foldHeader: () => Locator = (): Locator => {
    return section().getByRole("button", { name: "More settings" });
  };

  const summary: () => Locator = (): Locator => {
    return section().getByTestId("collapsible-section-summary");
  };

  const openAiFeatures: () => Promise<void> = async (): Promise<void> => {
    await gotoProjectPage({
      page,
      projectId,
      url: urlFor(`/dashboard/${projectId}/settings/ai-features`),
      ready: page.getByTestId("enable-ai-switch"),
    });
  };

  // Opens the fold, the card's Edit dialog, and hands back the dialog.
  const openEditDialog: () => Promise<Locator> =
    async (): Promise<Locator> => {
      await foldHeader().click();
      await expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
      await section().getByRole("button", { name: "Edit" }).click();

      const modal: Locator = page.getByTestId("modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByLabel(/Daily AI Token Limit/)).toBeVisible();

      return modal;
    };

  const save: (modal: Locator) => Promise<void> = async (
    modal: Locator,
  ): Promise<void> => {
    // One page: the action is there at once, never behind a Next.
    await expect(modal.getByTestId("modal-footer-next-button")).toHaveCount(0);
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden();
  };

  const storedLimits: () => Promise<Record<string, unknown>> =
    async (): Promise<Record<string, unknown>> => {
      const response: APIResponse = await page.request.post(
        urlFor(`/api/project/${projectId}/get-item`),
        {
          headers: { tenantid: projectId },
          data: {
            select: { aiDailyTokenLimit: true, aiDailySpendLimitInUSD: true },
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);

      return (await response.json()) as Record<string, unknown>;
    };

  const updateProject: (
    data: Record<string, unknown>,
  ) => Promise<APIResponse> = async (
    data: Record<string, unknown>,
  ): Promise<APIResponse> => {
    return page.request.put(urlFor(`/api/project/${projectId}`), {
      headers: { tenantid: projectId },
      data: { data },
    });
  };

  test("More settings is folded under Enable AI and says nothing limits AI, with today's use", async () => {
    await openAiFeatures();

    await expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
    await expect(section().getByTestId("folded-section-item")).toHaveText([
      "Daily limits",
    ]);
    await expect(summary()).toHaveText(
      IS_BILLING_ENABLED
        ? "Nothing limits how much OneUptime AI uses each day. Used today: 0 tokens and $0 of AI credits."
        : "Nothing limits how much OneUptime AI uses each day. Used today: 0 tokens.",
    );
  });

  test("today's use is answered by POST /api/ai/daily-usage", async () => {
    const response: APIResponse = await page.request.post(
      urlFor("/api/ai/daily-usage"),
      { headers: { tenantid: projectId }, data: {} },
    );
    expect(response.ok(), await response.text()).toBe(true);

    const body: Record<string, unknown> = (await response.json()) as Record<
      string,
      unknown
    >;

    expect(body["usedTokensToday"]).toBe(0);
    expect(body["tokenLimit"]).toBeNull();
    expect(body["reachedLimit"]).toBeNull();
    expect(body["spentTodayInUSDCents"]).toBe(IS_BILLING_ENABLED ? 0 : null);
    // The count starts again at the next midnight UTC.
    expect(String(body["resetsAt"])).toMatch(/T00:00:00\.000Z$/);
  });

  test("a daily token limit saved from the card is stored and said", async () => {
    await openAiFeatures();

    const modal: Locator = await openEditDialog();

    // The spend limit is offered only where AI is billed.
    await expect(modal.getByLabel(/Daily AI Spend Limit/)).toHaveCount(
      IS_BILLING_ENABLED ? 1 : 0,
    );

    await modal.getByLabel(/Daily AI Token Limit/).fill("200000");
    await save(modal);

    expect((await storedLimits())["aiDailyTokenLimit"]).toBe(200000);

    await foldHeader().click();
    await expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
    await expect(summary()).toContainText("At most 200,000 tokens a day.");
    await expect(section().getByTestId("folded-section-item")).toHaveAttribute(
      "data-item-set",
      "true",
    );
  });

  test("the form refuses 0 before anything is sent", async () => {
    await openAiFeatures();

    const modal: Locator = await openEditDialog();

    await modal.getByLabel(/Daily AI Token Limit/).fill("0");
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect(
      modal.getByText(
        "Daily AI Token Limit must be a whole number from 1 to 2,000,000,000. Leave it empty for no limit.",
      ),
    ).toBeVisible();
    await modal.getByTestId("modal-footer-close-button").click();
    await expect(modal).toBeHidden();

    expect((await storedLimits())["aiDailyTokenLimit"]).toBe(200000);
  });

  test("the API refuses a limit of 0 too, pointing at Enable AI", async () => {
    const response: APIResponse = await updateProject({ aiDailyTokenLimit: 0 });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain(
      "To turn OneUptime AI off, use Enable AI.",
    );
    expect((await storedLimits())["aiDailyTokenLimit"]).toBe(200000);
  });

  test("the spend limit: saved and said where AI is billed, refused where it is not", async () => {
    if (!IS_BILLING_ENABLED) {
      const response: APIResponse = await updateProject({
        aiDailySpendLimitInUSD: 25,
      });

      expect(response.status()).toBe(400);
      expect(await response.text()).toContain(
        "can only be set where billing is enabled",
      );
      expect((await storedLimits())["aiDailySpendLimitInUSD"]).toBeNull();
      return;
    }

    await openAiFeatures();

    const modal: Locator = await openEditDialog();
    await modal.getByLabel(/Daily AI Spend Limit/).fill("25");
    await save(modal);

    expect((await storedLimits())["aiDailySpendLimitInUSD"]).toBe(25);

    await foldHeader().click();
    await expect(summary()).toContainText(
      "At most 200,000 tokens and $25 of AI credits a day.",
    );
  });

  test("clearing the fields means no limit again", async () => {
    await openAiFeatures();

    const modal: Locator = await openEditDialog();
    await modal.getByLabel(/Daily AI Token Limit/).fill("");

    if (IS_BILLING_ENABLED) {
      await modal.getByLabel(/Daily AI Spend Limit/).fill("");
    }

    await save(modal);

    const stored: Record<string, unknown> = await storedLimits();
    expect(stored["aiDailyTokenLimit"] ?? null).toBeNull();
    expect(stored["aiDailySpendLimitInUSD"] ?? null).toBeNull();

    await foldHeader().click();
    await expect(summary()).toContainText(
      "Nothing limits how much OneUptime AI uses each day.",
    );
  });
});
