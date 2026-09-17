import {
  Locator,
  Page,
  Route as PlaywrightRoute,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

/*
 * The Replay Policy page against the offline fixture.
 *
 * The policy card is a ModelDetail, which refetches whenever the modelId it is
 * handed changes by identity, and the page stores each loaded row in state. A
 * page that builds its modelId per render therefore reloads the card forever
 * and it never leaves its loading bar. These tests count the card's reads
 * over time rather than waiting for text, because a loop can briefly show the
 * card between reloads.
 *
 * A healthy mount reads once. CardModelDetail deliberately avoids changing
 * its refresher on mount so ModelDetail does not issue a redundant read.
 */
const readsOnMount: number = 1;

const artifacts: string = path.resolve(
  __dirname,
  "../../output/playwright/session-replay-ui",
);
const monacoRuntime: string = path.resolve(
  __dirname,
  "../../Common/node_modules/monaco-editor/min/vs",
);
const port: string = process.env["SESSION_REPLAY_FIXTURE_PORT"] || "4212";
const appId: string = "20000000-0000-4000-8000-000000000001";
const policyRoute: string = `/dashboard/10000000-0000-4000-8000-000000000001/rum/${appId}/session-replay-settings`;

interface GetItemRequest {
  modelType: string;
  id: string;
  selectKeys: Array<string>;
}
interface SavedModel {
  formType: string;
  id: string;
  values: Record<string, unknown>;
}
interface FixtureState {
  getItemRequests: Array<GetItemRequest>;
  savedModels: Array<SavedModel>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

const state: (page: Page) => Promise<FixtureState> = async (
  page: Page,
): Promise<FixtureState> => {
  return page.evaluate((): FixtureState => {
    return (window as unknown as { __sessionReplayFixture: FixtureState })
      .__sessionReplayFixture;
  });
};

/*
 * The policy card's reads: its select names the policy columns and _id. The
 * layout's name read selects neither, and the edit form's read has no _id.
 */
const policyFetchCount: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return (await state(page)).getItemRequests.filter(
    (request: GetItemRequest): boolean => {
      return (
        request.modelType === "RumApplication" &&
        request.selectKeys.includes("isSessionReplayEnabled") &&
        request.selectKeys.includes("_id")
      );
    },
  ).length;
};

const policyCard: (page: Page) => Locator = (page: Page): Locator => {
  return page.locator("#replay-policy");
};

const recordingPill: (page: Page) => Locator = (page: Page): Locator => {
  return policyCard(page)
    .locator("#model-detail-rum-application-session-replay")
    .getByTestId("pill")
    .first();
};

const expectPolicyLoaded: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect(policyCard(page).getByText("Uploads when")).toBeVisible();
  await expect(policyCard(page).getByTestId("bar-loader")).toHaveCount(0);
};

/* The count must reach expected and hold still: a reload loop keeps adding reads. */
const expectPolicyFetchesStable: (
  page: Page,
  expected: number,
) => Promise<void> = async (page: Page, expected: number): Promise<void> => {
  await expect
    .poll((): Promise<number> => {
      return policyFetchCount(page);
    })
    .toBe(expected);
  await page.waitForTimeout(3000);
  expect(await policyFetchCount(page)).toBe(expected);
  await expect(policyCard(page).getByTestId("bar-loader")).toHaveCount(0);
};

const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
  });
};

test.beforeEach(async ({ page }: { page: Page }) => {
  // Each test also waits out the stability window, on top of the page load.
  test.setTimeout(120000);
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === port) {
      await route.continue();
      return;
    }

    await route.abort();
  });

  /*
   * The edit form's JSON fields mount Monaco, which the build points at
   * /assets/monaco/vs. The fixture server only serves the bundle, so hand
   * the editor the runtime the build would have copied there.
   */
  await page.route("**/assets/monaco/vs/**", async (route: PlaywrightRoute) => {
    const relative: string = new URL(route.request().url()).pathname.replace(
      /^\/assets\/monaco\/vs\//,
      "",
    );
    const file: string = path.resolve(monacoRuntime, relative);

    if (!file.startsWith(monacoRuntime + path.sep)) {
      await route.abort();
      return;
    }

    await route.fulfill({ path: file });
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("the policy card loads and stays loaded", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(policyRoute);
  await expectPolicyLoaded(page);
  await expect(recordingPill(page)).toHaveText("On", { timeout: 15000 });
  await expect(policyCard(page)).toContainText("100%");
  await expect(policyCard(page)).toContainText("https://shop.example.com");
  await expectPolicyFetchesStable(page, readsOnMount);
  await screenshot(page, "replay-policy");
});

test("the recording pill follows health that answers after the policy", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${policyRoute}?health=hold`);
  await expectPolicyLoaded(page);
  await expect(recordingPill(page)).toHaveText(
    "On (project switch not checked yet)",
  );

  await page.evaluate((): void => {
    (
      window as unknown as {
        __sessionReplayFixture: { releaseHealth: () => void };
      }
    ).__sessionReplayFixture.releaseHealth();
  });

  await expect(recordingPill(page)).toHaveText("On");
  await expect(page.getByTestId("health-card")).toHaveAttribute(
    "data-state",
    /^healthy/,
  );
  await expectPolicyFetchesStable(page, readsOnMount);
});

test("the recording pill says so when the project switch is off", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${policyRoute}?project=off`);
  await expectPolicyLoaded(page);
  await expect(recordingPill(page)).toHaveText("Off: project switch is off");
  await expect(page.getByTestId("health-card")).toHaveAttribute(
    "data-state",
    "disabled-project",
  );
  await expectPolicyFetchesStable(page, readsOnMount);
});

test("saving the policy reloads the card once", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(policyRoute);
  await expectPolicyLoaded(page);
  await expectPolicyFetchesStable(page, readsOnMount);

  await policyCard(page).getByRole("button", { name: "Edit Policy" }).click();
  const modal: Locator = page.getByTestId("modal");
  await expect(modal).toBeVisible();
  const samplePercentage: Locator = modal.getByPlaceholder("100");
  await expect(samplePercentage).toHaveValue("100");
  await samplePercentage.fill("50");

  for (let step: number = 0; step < 3; step++) {
    await modal.getByRole("button", { name: "Next", exact: true }).click();
  }
  await modal.getByRole("button", { name: "Save Changes" }).click();
  await expect(modal).toHaveCount(0);

  const saved: Array<SavedModel> = (await state(page)).savedModels;
  expect(saved).toHaveLength(1);
  expect(saved[0]!.id).toBe(appId);
  expect(saved[0]!.values["sessionReplaySamplePercentage"]).toBe(50);

  await expect(policyCard(page)).toContainText("50%");
  await expectPolicyLoaded(page);
  await expectPolicyFetchesStable(page, readsOnMount + 1);
});
