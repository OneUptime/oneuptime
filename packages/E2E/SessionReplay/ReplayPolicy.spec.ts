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

/*
 * The Edit Policy dialog's steps, in order (formSteps in the Dashboard's
 * Pages/Rum/View/SessionReplaySettings.tsx). A stepped dialog offers Save
 * Changes on its last step only, with a plain Next on every other step
 * (Common/UI/Components/Forms/Utils/SteppedFormFooter.ts), so saving walks
 * this list to its end, and the dialog's step list must match it exactly.
 *
 * The walk used to be three Nexts. That reached the last of the four steps
 * this was written against, and fell one short of Limits once Privacy was
 * split into Masking and Consent & Identity - unnoticed while an edit dialog
 * could still save from any step. A step added or removed now fails by name.
 */
const policyFormSteps: ReadonlyArray<string> = [
  "Recording",
  "Masking",
  "Consent & Identity",
  "Performance & Tracing",
  "Limits",
];

// ButtonStyleType.PRIMARY's background, Tailwind's indigo-600.
const primaryButtonBackground: string = "rgb(79, 70, 229)";

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
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

// What tells a primary button from a plain one, as the browser draws it.
interface ButtonLook {
  background: string;
  text: string;
  border: string;
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
 * page reads the application in two other places, so the card is told apart
 * by a column only it asks for, the sample percentage it shows as "100%":
 *
 *   - the layout's name read selects neither _id nor any policy column;
 *   - the side menu's Recommendations badge reads the application through
 *     RecommendationResourceRegistry.getSelect: _id and name, plus the
 *     columns that decide its session replay storage budget alerts, which
 *     include isSessionReplayEnabled. Keying on isSessionReplayEnabled
 *     counted that read as a second card read;
 *   - the edit form's read has no _id.
 */
const policyFetchCount: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return (await state(page)).getItemRequests.filter(
    (request: GetItemRequest): boolean => {
      return (
        request.modelType === "RumApplication" &&
        request.selectKeys.includes("sessionReplaySamplePercentage") &&
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

const buttonLook: (button: Locator) => Promise<ButtonLook> = async (
  button: Locator,
): Promise<ButtonLook> => {
  return button.evaluate((element: Element): ButtonLook => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    return {
      background: style.backgroundColor,
      text: style.color,
      border: style.borderTopColor,
    };
  });
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

  const progress: Locator = modal.getByRole("navigation", {
    name: "Progress",
  });
  await expect(progress.getByRole("listitem")).toHaveText([...policyFormSteps]);
  const currentStep: Locator = progress.locator("[aria-current='step']");
  await expect(currentStep).toHaveText(policyFormSteps[0]!);

  await samplePercentage.fill("50");

  const footer: Locator = modal.getByTestId("modal-footer");
  const next: Locator = footer.getByRole("button", {
    name: "Next",
    exact: true,
  });
  const cancel: Locator = footer.getByRole("button", {
    name: "Cancel",
    exact: true,
  });
  const save: Locator = modal.getByRole("button", {
    name: "Save Changes",
    exact: true,
  });
  expect((await buttonLook(cancel)).background).not.toBe(
    primaryButtonBackground,
  );

  /*
   * Every step before the last offers no Save Changes, only a Next drawn
   * plain, like Cancel: Next commits nothing, so it never takes the primary
   * colour. The pointer leaves the footer before each comparison: pressing
   * Next leaves it there, the next step's Next is often drawn right under
   * it, and a hovered button is a shade darker.
   */
  const lastStep: number = policyFormSteps.length - 1;
  for (let step: number = 0; step < lastStep; step++) {
    await expect(currentStep).toHaveText(policyFormSteps[step]!);
    await expect(save).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect
      .poll((): Promise<ButtonLook> => {
        return buttonLook(next);
      })
      .toEqual(await buttonLook(cancel));
    await next.click();
  }

  // The last step: no Next, and Save Changes is the one primary button.
  await expect(currentStep).toHaveText(policyFormSteps[lastStep]!);
  await expect(next).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(save).toHaveCSS("background-color", primaryButtonBackground);
  await save.click();
  await expect(modal).toHaveCount(0);

  const saved: Array<SavedModel> = (await state(page)).savedModels;
  expect(saved).toHaveLength(1);
  expect(saved[0]!.id).toBe(appId);
  expect(saved[0]!.values["sessionReplaySamplePercentage"]).toBe(50);

  await expect(policyCard(page)).toContainText("50%");
  await expectPolicyLoaded(page);
  await expectPolicyFetchesStable(page, readsOnMount + 1);
});
