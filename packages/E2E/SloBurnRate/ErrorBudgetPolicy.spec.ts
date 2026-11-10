import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * "Use the recommended policy" on the real Error Budget Policy page, and the
 * tier the SLO is in on its real Overview, against the offline fixture.
 *
 * The fixture's SLO (99.9% over a rolling 30 days, 20% of its budget left)
 * has no error budget policy, so the page's empty state offers the
 * recommended one: the confirmation lists its three tiers - Caution at 50%,
 * Reliability first at 25%, Budget exhausted at 0% - and adding them puts
 * them in the table, from the highest threshold down, raising nothing.
 * With ?policy=recommended the SLO has them already and is in Reliability
 * first, which its Overview shows right under the summary. With
 * ?policy=frozen it is in Budget exhausted - the recommended tier that
 * freezes deployments - and the Overview says since when they are frozen.
 *
 * Run it as the other SloBurnRate specs are (README.md):
 *   cd packages/E2E && npm run test-slo-burn-rate-ui
 */

const SLO_ID: string = "20000000-0000-4000-8000-000000000001";

const SLO_PATH: string = `/dashboard/10000000-0000-4000-8000-000000000001/slos/${SLO_ID}`;

const ROUTE: string = `${SLO_PATH}/error-budget-policy`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/slo-burn-rate",
);

const BUTTON: string = "Use the recommended policy";

const pageErrors: Map<Page, Array<string>> = new Map();

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

function percent(tier: SloRecommendedPolicyTier): string {
  return `Budget left ≤ ${tier.thresholdPercentage}%`;
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });

  // Nothing may leave the fixture.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === "4213") {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("offers the recommended policy to an SLO without one, lists exactly what it adds, and adds just that", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(ROUTE);
  await expect(page.getByText("No error budget policy yet")).toBeVisible();

  const button: Locator = page.getByRole("button", { name: BUTTON });

  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  // The table's own Create is there too, for a tier of one's own.
  await expect(
    page
      .getByRole("button", { name: "Create SLO Error Budget Policy Tier" })
      .first(),
  ).toBeVisible();

  await screenshot(page, "error-budget-policy-starter-synthetic");

  await button.click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog).toContainText(BUTTON);
  await expect(dialog).toContainText(
    "They raise no alerts or incidents until you switch that on, and you can edit them afterwards like any other tier.",
  );

  const listed: Locator = dialog.getByTestId("slo-recommended-policy-tier");

  await expect(listed).toHaveCount(SLO_RECOMMENDED_POLICY_TIERS.length);

  for (const [index, tier] of SLO_RECOMMENDED_POLICY_TIERS.entries()) {
    await expect(listed.nth(index)).toContainText(tier.name);
    await expect(listed.nth(index)).toContainText(percent(tier));
    await expect(listed.nth(index)).toContainText(tier.whatWeDo);
    // Only the tier that freezes deployments - Budget exhausted - is marked.
    await expect(
      listed.nth(index).getByTestId("slo-recommended-policy-tier-freezes"),
    ).toHaveCount(tier.freezesDeployments ? 1 : 0);
  }

  await expect(
    dialog.getByTestId("slo-recommended-policy-freeze-note"),
  ).toHaveText(
    "A tier marked Freezes deployments tells CI/CD pipelines that check this SLO to hold back releases while the SLO is in it.",
  );

  await screenshot(page, "error-budget-policy-confirmation-synthetic");

  await dialog.getByRole("button", { name: "Add tiers" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);

  // From the highest threshold down: the order the budget reaches them.
  const rows: Locator = page.locator("tbody tr");

  await expect(rows).toHaveCount(SLO_RECOMMENDED_POLICY_TIERS.length);

  for (const [index, tier] of SLO_RECOMMENDED_POLICY_TIERS.entries()) {
    await expect(rows.nth(index)).toContainText(tier.name);
    await expect(rows.nth(index)).toContainText(percent(tier));
    // Each raises nothing until someone switches that on.
    await expect(rows.nth(index)).toContainText("Nothing");
    // And says what deployments do while the SLO is in it.
    await expect(
      rows.nth(index).getByTestId("slo-policy-tier-deployments"),
    ).toHaveText(tier.freezesDeployments ? "Frozen" : "Allowed");
  }

  // A policy has been started: the starter is gone.
  await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);

  expect(
    await page.evaluate((): unknown => {
      return (window as unknown as { __recommendedPolicyAdds?: unknown })
        .__recommendedPolicyAdds;
    }),
  ).toEqual([
    {
      serviceLevelObjectiveId: SLO_ID,
      names: SLO_RECOMMENDED_POLICY_TIERS.map(
        (tier: SloRecommendedPolicyTier): string => {
          return tier.name;
        },
      ),
    },
  ]);

  await screenshot(page, "error-budget-policy-tiers-synthetic");
});

test("closing the confirmation adds nothing", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(ROUTE);
  await page.getByRole("button", { name: BUTTON }).click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog).toContainText("Reliability first");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: BUTTON })).toBeVisible();
  expect(
    await page.evaluate((): unknown => {
      return (window as unknown as { __recommendedPolicyAdds?: unknown })
        .__recommendedPolicyAdds;
    }),
  ).toBeUndefined();
});

test("a new tier's form asks its own three fields, with its alerts and incidents folded away and off", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(ROUTE);
  await page
    .getByRole("button", { name: "Create SLO Error Budget Policy Tier" })
    .first()
    .click();

  const dialog: Locator = page.getByRole("dialog");

  await expect(dialog.getByRole("textbox", { name: /^Name/ })).toBeVisible();
  await expect(
    dialog.getByRole("spinbutton", { name: /^Budget Left Threshold \(%\)/ }),
  ).toBeVisible();
  await expect(dialog.getByText("What We Do").first()).toBeVisible();

  // Freeze Deployments is one of the tier's own fields: shown, and off.
  const freeze: Locator = dialog.getByRole("switch", {
    name: /^Freeze Deployments/,
  });

  await expect(freeze).toBeVisible();
  await expect(freeze).toHaveAttribute("aria-checked", "false");
  await expect(dialog).toContainText(
    "While the SLO is in this tier, CI/CD pipelines that check it hold back releases.",
  );

  const fold: Locator = dialog.getByRole("button", {
    name: "Alerts and incidents",
  });

  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toContainText(
    "Raises no alert or incident: the tier records and shows what the team agreed to do.",
  );

  await screenshot(page, "error-budget-policy-create-tier-synthetic");

  await fold.click();

  const createAlert: Locator = dialog.getByRole("switch", {
    name: /^Create Alert/,
  });

  await expect(createAlert).toHaveAttribute("aria-checked", "false");
  await expect(
    dialog.getByRole("switch", { name: /^Declare Incident/ }),
  ).toHaveAttribute("aria-checked", "false");

  await createAlert.click();

  await expect(
    dialog.getByRole("textbox", { name: /^Alert Title/ }),
  ).toHaveValue("SLO error budget policy: {{sloName}} — {{policyTier}}");

  await screenshot(page, "error-budget-policy-create-tier-alert-synthetic");
});

test("the Overview shows the tier the SLO is in, and what the team does there, linking to the policy", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${SLO_PATH}?policy=recommended`);

  const card: Locator = page.getByTestId("slo-overview-policy-tier");
  const reliabilityFirst: SloRecommendedPolicyTier =
    SLO_RECOMMENDED_POLICY_TIERS.find(
      (tier: SloRecommendedPolicyTier): boolean => {
        return tier.thresholdPercentage === 25;
      },
    )!;

  await expect(card).toBeVisible();
  await expect(card).toContainText(reliabilityFirst.name);
  await expect(card).toContainText(percent(reliabilityFirst));
  await expect(card).toContainText("Entered 3 hours ago");
  await expect(card).toContainText(reliabilityFirst.whatWeDo);
  await expect(card).toHaveAttribute("data-tier-tone", "warning");

  // Right under the summary, above the headline numbers.
  const hero: Locator = page.getByTestId("slo-overview-hero");
  const [heroBox, cardBox] = (await boxesInOneFrame([hero, card])) as [
    FrameBox,
    FrameBox,
  ];

  expect(cardBox.y).toBeGreaterThan(heroBox.y + heroBox.height - 1);

  await screenshot(page, "slo-overview-policy-tier-synthetic");

  await card.getByRole("link", { name: "Open policy" }).click();

  await expect(page).toHaveURL(new RegExp(`${ROUTE}$`));

  const current: Locator = page.getByTestId("slo-current-policy-tier");

  await expect(current).toHaveCount(1);
  await expect(page.locator("tbody tr").filter({ has: current })).toContainText(
    reliabilityFirst.name,
  );
});

test("the Overview says since when deployments are frozen while the SLO is in a tier that freezes them", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${SLO_PATH}?policy=frozen`);

  const card: Locator = page.getByTestId("slo-overview-policy-tier");
  const exhausted: SloRecommendedPolicyTier = SLO_RECOMMENDED_POLICY_TIERS.find(
    (tier: SloRecommendedPolicyTier): boolean => {
      return tier.freezesDeployments;
    },
  )!;

  await expect(card).toBeVisible();
  await expect(card).toContainText(exhausted.name);
  await expect(card).toHaveAttribute("data-tier-tone", "danger");

  const badge: Locator = card.getByTestId(
    "slo-overview-policy-tier-deployments-frozen",
  );

  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Deployments frozen since");
  await expect(badge.locator("time")).toHaveAttribute(
    "datetime",
    "2026-09-11T09:00:00.000Z",
  );

  await screenshot(page, "slo-overview-deployments-frozen-synthetic");

  // At a phone's width the badge stays inside the card.
  await page.setViewportSize({ width: 390, height: 844 });
  await badge.scrollIntoViewIfNeeded();

  const [cardBox, badgeBox] = (await boxesInOneFrame([card, badge])) as [
    FrameBox,
    FrameBox,
  ];

  expect(badgeBox.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(
    cardBox.x + cardBox.width + 1,
  );

  await screenshot(page, "slo-overview-deployments-frozen-mobile-synthetic");

  // The policy page marks Budget exhausted as the tier that freezes them.
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto(`${ROUTE}?policy=frozen`);

  const frozenRow: Locator = page
    .locator("tbody tr")
    .filter({ has: page.getByTestId("slo-current-policy-tier") });

  await expect(frozenRow).toContainText(exhausted.name);
  await expect(frozenRow.getByTestId("slo-policy-tier-deployments")).toHaveText(
    "Frozen",
  );
});

test("an SLO in a tier that does not freeze deployments shows no freeze", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${SLO_PATH}?policy=recommended`);

  const card: Locator = page.getByTestId("slo-overview-policy-tier");

  await expect(card).toBeVisible();
  await expect(
    card.getByTestId("slo-overview-policy-tier-deployments-frozen"),
  ).toHaveCount(0);
});
