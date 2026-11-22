import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * ISSUES WITH ONE CAUSE (#10370) in a browser, against the offline fixture
 * (Fixture/Fixture.js, ?groups=on): forty buckets one Terraform module made,
 * twelve the export-job role made in the console, and five tables of one
 * CloudFormation stack.
 *
 *   - Group by cause starts on for a busy project: each group above the
 *     list - "40 issues, one cause: the static-site module", how many are
 *     fixed and left, its pull request - its stores folded under it, and
 *     the issues in no group under the groups. Off, the list is flat again;
 *     a new project has no switch;
 *   - Fix the Cause on the module's group asks for one pull request, in the
 *     repository the grouping found; on the console's group it is one
 *     approval, leaving out the store marked Public By Design and the one
 *     whose analysis says the fix would break it, until it is ticked;
 *   - a Security Viewer is told why each part is not theirs to make;
 *   - an issue's analysis points at its group, and its Fix the Cause opens
 *     the group's fix;
 *   - at 390, in German and in Persian, in the dark theme, nothing scrolls
 *     sideways.
 */

const PORT: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const ISSUES: string = `/dashboard/${PROJECT_ID}/data-security/issues`;
const PUBLIC_BUCKET_ISSUE: string = `/dashboard/${PROJECT_ID}/data-security/issues/30000000-0000-4000-8000-000000000001`;
const MODULE_GROUP: string = "1c000000-0000-4000-8000-000000000001";
const EXPORTS_GROUP: string = "1c000000-0000-4000-8000-000000000002";
const INFRA_REPOSITORY: string = "1c100000-0000-4000-8000-000000000001";
const GROUPS: string = "data-security-issue-groups";
const FIX: string = "data-security-issue-group-fix";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/data-security-ui/issue-groups",
);

const LAPTOP: number = 1280;
const PHONE: number = 390;

interface FixtureState {
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  groupFixes: Array<{ groupId: string; body: Record<string, unknown> }>;
  unhandled: Array<unknown>;
}

interface Options {
  width?: number | undefined;
  lang?: "de" | "fa" | undefined;
  theme?: "dark" | undefined;
  ai?: boolean | undefined;
  role?: "viewer" | undefined;
  data?: "busy" | "empty" | undefined;
  groups?: boolean | undefined;
  pathname?: string | undefined;
  query?: Record<string, string> | undefined;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  const state: FixtureState | null = await fixture(page).catch(() => {
    return null;
  });
  if (state) {
    expect(state.unhandled, "requests the fixture does not model").toEqual([]);
  }
});

async function open(page: Page, options: Options = {}): Promise<void> {
  await page.setViewportSize({ width: options.width || LAPTOP, height: 1000 });
  await page.clock.setFixedTime(NOW);
  // Group by cause is the reader's own choice, kept in the browser: none yet.
  await page.addInitScript((): void => {
    try {
      window.localStorage.removeItem("data-security-issues-group-by-cause");
    } catch {
      // A browser that keeps nothing.
    }
  });
  const params: URLSearchParams = new URLSearchParams();
  if (options.groups !== false) {
    params.set("groups", "on");
  }
  if (options.data) {
    params.set("data", options.data);
  }
  if (options.ai) {
    params.set("ai", "on");
  }
  if (options.lang) {
    params.set("lang", options.lang);
  }
  if (options.theme) {
    params.set("theme", options.theme);
  }
  if (options.role) {
    params.set("role", options.role);
  }
  for (const [key, value] of Object.entries(options.query || {})) {
    params.set(key, value);
  }
  await page.goto(`${options.pathname || ISSUES}?${params.toString()}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __dataSecurityFixture: FixtureState })
          .__dataSecurityFixture,
      ),
    ) as FixtureState;
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function screenshot(
  page: Page,
  name: string,
  fullPage: boolean = true,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

function group(page: Page, groupId: string): Locator {
  return page.locator(
    `[data-testid="${GROUPS}-group"][data-group-id="${groupId}"]`,
  );
}

test.describe("Group by cause", () => {
  test("starts on for a busy project: each group above the list, its stores folded, the rest under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "busy" });
    await expect(page.getByTestId(GROUPS)).toBeVisible();
    await expect(
      page.getByTestId("data-security-issues-group-by-cause"),
    ).toBeVisible();

    const moduleGroup: Locator = group(page, MODULE_GROUP);

    await expect(moduleGroup.getByTestId(`${GROUPS}-headline`)).toHaveText(
      "40 issues, one cause: the static-site module",
    );
    await expect(moduleGroup.getByTestId(`${GROUPS}-progress`)).toHaveText(
      "6 fixed, 34 left",
    );
    // The list opens on the open issues, which are the group's: no note of filters.
    await expect(moduleGroup).not.toContainText("match the filters");
    // The stack's group says where its pull request stands.
    await expect(
      page
        .locator(`[data-testid="${GROUPS}-group"]`)
        .filter({ hasText: "billing-tables" })
        .getByTestId(`${GROUPS}-fix`),
    ).toHaveAttribute("data-state", "opened");

    // The module's buckets are not rows of the list any more.
    await expect(
      page.getByRole("link", { name: "acme-marketing-site" }),
    ).toHaveCount(0);
    await settle(page);
    await screenshot(page, "issues-grouped-1280");

    await moduleGroup.getByTestId(`${GROUPS}-toggle`).click();
    await expect(moduleGroup.getByTestId(`${GROUPS}-stores`)).toBeVisible();
    await expect(
      moduleGroup.getByTestId(`${GROUPS}-stores`).locator("li"),
    ).toHaveCount(34);
    await expect(moduleGroup.getByTestId(`${GROUPS}-toggle`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await settle(page);
    await screenshot(page, "issues-grouped-open-1280", false);
    await expectNoSidewaysScroll(page);

    // Off, the list is flat again - every issue a row.
    await page.getByTestId("data-security-issues-group-by-cause").click();
    await expect(page.getByTestId(GROUPS)).toHaveCount(0);
    await settle(page);
    await screenshot(page, "issues-flat-1280");
  });

  test("before any group is kept, the same issues are rows of the list, with no switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, {
      data: "busy",
      groups: false,
      query: { groups: "before" },
    });
    await settle(page);
    await expect(page.getByTestId(GROUPS)).toHaveCount(0);
    await expect(
      page.getByTestId("data-security-issues-group-by-cause"),
    ).toHaveCount(0);
    await screenshot(page, "issues-before-1280");
  });

  test("a new project has no groups, and no switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "empty" });
    await settle(page);
    await expect(page.getByTestId(GROUPS)).toHaveCount(0);
    await expect(
      page.getByTestId("data-security-issues-group-by-cause"),
    ).toHaveCount(0);
    await screenshot(page, "issues-new-project-1280");
  });

  test("with AI on, each group carries OneUptime AI's name for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "busy", ai: true });
    await expect(
      group(page, MODULE_GROUP).getByTestId(`${GROUPS}-headline`),
    ).toHaveText(
      "40 issues, one cause: the static-site module turns off access logs",
    );
    await settle(page);
    await screenshot(page, "issues-grouped-ai-1280");
  });
});

test.describe("Fix the Cause", () => {
  test("on the module's group: one pull request, in the repository the grouping found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "busy" });
    await group(page, MODULE_GROUP).getByTestId(`${GROUPS}-fix-button`).click();

    const dialog: Locator = page.getByTestId(FIX);

    await expect(dialog.getByTestId(`${FIX}-pull-request`)).toContainText(
      "OneUptime AI opens one pull request to the Terraform code that declares these 34 stores",
    );
    await expect(dialog).toContainText("modules/static-site/main.tf");
    await expect(dialog.getByTestId(`${FIX}-cloud`)).toHaveCount(0);
    // The repository the grouping found is the one picked.
    await expect(dialog.getByTestId(`${FIX}-pull-request`)).toContainText(
      "acme/infra",
    );
    await expect(
      dialog.getByRole("combobox", { name: "Repository" }),
    ).toBeVisible();
    await settle(page);
    await screenshot(page, "fix-the-cause-pull-request-1280", false);

    await page.getByRole("button", { name: "Fix the Cause" }).last().click();
    await expect(dialog).toHaveCount(0);
    await expect(
      group(page, MODULE_GROUP).getByTestId(`${GROUPS}-fix`),
    ).toHaveAttribute("data-state", "writing");

    const state: FixtureState = await fixture(page);

    expect(state.groupFixes).toEqual([
      {
        groupId: MODULE_GROUP,
        body: expect.objectContaining({
          parts: ["PullRequest"],
          codeRepositoryId: INFRA_REPOSITORY,
        }),
      },
    ]);
  });

  test("on the console's group: one approval, leaving out Public By Design and what the fix would break, until it is ticked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "busy" });
    await group(page, EXPORTS_GROUP)
      .getByTestId(`${GROUPS}-fix-button`)
      .click();

    const dialog: Locator = page.getByTestId(FIX);

    await expect(dialog.getByTestId(`${FIX}-cloud`)).toContainText(
      "Block Public Access on each of the 10 stores made in the console",
    );
    await expect(dialog.getByTestId(`${FIX}-left-out`)).toContainText(
      "Marked Public By Design, so its access is never closed.",
    );
    await expect(dialog.getByTestId(`${FIX}-left-out`)).toContainText(
      "role/partner-reporting",
    );
    await settle(page);
    await screenshot(page, "fix-the-cause-approval-1280", false);

    await dialog
      .locator(`[data-testid^="${FIX}-tick-"]`)
      .first()
      .check({ force: true });
    await page.getByRole("button", { name: "Fix the Cause" }).last().click();
    await expect(dialog).toHaveCount(0);

    const state: FixtureState = await fixture(page);

    expect(state.groupFixes[0]!.body).toEqual(
      expect.objectContaining({
        parts: ["Cloud"],
        includeDataStoreIds: [expect.any(String)],
      }),
    );
  });

  test("a Security Viewer is told why neither part is theirs to make", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { data: "busy", role: "viewer" });
    await group(page, MODULE_GROUP).getByTestId(`${GROUPS}-fix-button`).click();
    await expect(page.getByTestId(FIX)).toContainText(
      "Asking OneUptime AI for this pull request takes permission to change Data Security issues.",
    );
    await expect(
      page.getByRole("button", { name: "Fix the Cause" }).last(),
    ).toBeDisabled();
    await settle(page);
    await screenshot(page, "fix-the-cause-viewer-1280", false);
  });
});

test.describe("an issue's analysis", () => {
  test("points at its group, and Fix the Cause opens the group's fix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { ai: true, pathname: PUBLIC_BUCKET_ISSUE });

    const pointer: Locator = page.getByTestId(
      "data-security-issue-ai-analysis-group",
    );

    await expect(pointer).toContainText(
      "12 issues, one cause: the export-job role makes its buckets public",
    );
    await settle(page);
    await screenshot(page, "issue-analysis-points-at-its-group-1280");

    await pointer
      .getByTestId("data-security-issue-ai-analysis-group-link")
      .click();
    await expect(page.getByTestId(FIX)).toBeVisible();
  });
});

test.describe("on a phone, in German, in Persian, in the dark", () => {
  for (const scenario of [
    { name: "phone-390", width: PHONE },
    { name: "german-1280", width: LAPTOP, lang: "de" as const },
    { name: "persian-390", width: PHONE, lang: "fa" as const },
    { name: "dark-1280", width: LAPTOP, theme: "dark" as const },
    {
      name: "dark-german-390",
      width: PHONE,
      lang: "de" as const,
      theme: "dark" as const,
    },
  ]) {
    test(`the groups fit: ${scenario.name}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, {
        data: "busy",
        width: scenario.width,
        lang: scenario.lang,
        theme: scenario.theme,
      });
      await expect(page.getByTestId(GROUPS)).toBeVisible();
      await settle(page);
      await expectNoSidewaysScroll(page);
      await screenshot(page, `issues-grouped-${scenario.name}`, false);

      await group(page, EXPORTS_GROUP)
        .getByTestId(`${GROUPS}-fix-button`)
        .click();
      await expect(page.getByTestId(`${FIX}-cloud`)).toBeVisible();
      await settle(page);
      await expectNoSidewaysScroll(page);
      await screenshot(page, `fix-the-cause-${scenario.name}`, false);
    });
  }
});
