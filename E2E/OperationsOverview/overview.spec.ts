import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import path from "path";

const projectId: string = "10000000-0000-4000-8000-000000000001";
const eventId: string = "20000000-0000-4000-8000-000000000001";
const screenshots: string = path.resolve(
  __dirname,
  "../../output/playwright/operations-overview",
);
interface EventFixture {
  slug: string;
  name: string;
  model: string;
  title: string;
  identifier: string;
  action: string;
  modal: string;
  nextState: string;
  activity: string;
  titleLabel: string;
}
interface BrowserTest {
  page: Page;
}
interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface FixtureRequest {
  operation: string;
  model: string;
}
const events: [EventFixture, EventFixture, EventFixture] = [
  {
    slug: "incidents",
    name: "incident",
    model: "Incident",
    title: "Checkout requests failing in Europe",
    identifier: "INC-142",
    action: "Acknowledge",
    modal: "Acknowledge Incident",
    nextState: "Acknowledged",
    activity: "Response activity",
    titleLabel: "Incident Title",
  },
  {
    slug: "alerts",
    name: "alert",
    model: "Alert",
    title: "API latency above the response time threshold",
    identifier: "ALT-86",
    action: "Acknowledge",
    modal: "Acknowledge Alert",
    nextState: "Acknowledged",
    activity: "Response activity",
    titleLabel: "Alert Title",
  },
  {
    slug: "scheduled-maintenance-events",
    name: "maintenance",
    model: "ScheduledMaintenance",
    title: "Production database maintenance",
    identifier: "MNT-24",
    action: "Mark as Ongoing",
    modal: "Mark Scheduled Maintenance as Ongoing",
    nextState: "Ongoing",
    activity: "Maintenance activity",
    titleLabel: "Scheduled Maintenance Title",
  },
];

async function openOverview(
  page: Page,
  event: EventFixture,
  scenario: string = "default",
): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-09-07T10:45:00Z"));
  await page.goto(
    `/dashboard/${projectId}/${event.slug}/${eventId}?scenario=${scenario}`,
  );
  await expect(
    page.getByRole("region", { name: "Event summary", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit details", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: event.activity, exact: true }),
  ).toBeVisible();
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(
    overflow,
    "The actual overview and side navigation must fit the viewport",
  ).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }: BrowserTest): Promise<void> => {
  const errors: string[] = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  (page as Page & { overviewErrors: string[] }).overviewErrors = errors;
});

test.afterEach(async ({ page }: BrowserTest): Promise<void> => {
  expect(
    (page as Page & { overviewErrors: string[] }).overviewErrors,
    "No uncaught browser errors",
  ).toEqual([]);
});

for (const event of events) {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1100 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`${event.name}: ${viewport.name} overview hierarchy and screenshot`, async ({
      page,
    }: BrowserTest, testInfo: TestInfo): Promise<void> => {
      await page.setViewportSize(viewport);
      await openOverview(page, event);
      await expect(
        page.getByText(event.identifier, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "State progression" }),
      ).toBeVisible();
      await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: event.action, exact: true }),
      ).toBeEnabled();
      for (const label of await page
        .getByRole("group", { name: "Event actions", exact: true })
        .locator("button > span")
        .all()) {
        const textSize: {
          clientWidth: number;
          scrollWidth: number;
          clientHeight: number;
          scrollHeight: number;
        } = await label.evaluate((element: HTMLElement | SVGElement) => {
          return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          };
        });
        expect(
          textSize.scrollWidth,
          "Action labels must remain fully readable",
        ).toBeLessThanOrEqual(textSize.clientWidth + 1);
        expect(
          textSize.scrollHeight,
          "Wrapped action labels must fit their buttons",
        ).toBeLessThanOrEqual(textSize.clientHeight + 1);
      }
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const title: Locator = page.getByRole("heading", {
        name: event.title,
        exact: true,
      });
      await expect(title).toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Event context" }),
      ).toBeVisible();
      const summary: ElementBox | null = await page
        .getByRole("region", { name: "Event summary" })
        .boundingBox();
      const activity: ElementBox | null = await page
        .getByRole("region", { name: event.activity, exact: true })
        .boundingBox();
      const details: ElementBox | null = await page
        .getByRole("complementary", { name: "Event context" })
        .boundingBox();
      expect(summary).not.toBeNull();
      expect(activity).not.toBeNull();
      expect(details).not.toBeNull();
      expect(summary!.y + summary!.height).toBeLessThan(activity!.y);
      if (viewport.name === "desktop") {
        expect(details!.x).toBeGreaterThan(activity!.x + activity!.width);
        expect(summary!.width).toBeGreaterThan(activity!.width);
      } else {
        expect(details!.y).toBeGreaterThan(activity!.y + activity!.height);
      }
      await expectNoOverflow(page);
      const file: string = path.join(
        screenshots,
        `${event.name}-${viewport.name}.png`,
      );
      await page.screenshot({
        path: file,
        fullPage: true,
        animations: "disabled",
      });
      await testInfo.attach(`${event.name}-${viewport.name}`, {
        path: file,
        contentType: "image/png",
      });
    });
  }

  test(`${event.name}: state action saves through the real modal and refreshes summary`, async ({
    page,
  }: BrowserTest): Promise<void> => {
    await openOverview(page, event);
    await page.getByRole("button", { name: event.action, exact: true }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: event.modal,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: event.action, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[aria-current="step"]')).toContainText(
      event.nextState,
    );
    await expect(
      page.getByRole("button", { name: event.action, exact: true }),
    ).toHaveCount(0);
    const saves: Array<FixtureRequest> = await page.evaluate(
      (): Array<FixtureRequest> => {
        return (
          window as unknown as {
            __operationsOverviewRequests: Array<FixtureRequest>;
          }
        ).__operationsOverviewRequests.filter(
          (request: FixtureRequest): boolean => {
            return request.operation === "save";
          },
        );
      },
    );
    expect(saves).toEqual([
      expect.objectContaining({ model: `${event.model}StateTimeline` }),
    ]);
  });

  test(`${event.name}: edit details retains the form and updates the visible title`, async ({
    page,
  }: BrowserTest): Promise<void> => {
    await openOverview(page, event);
    await page
      .getByRole("button", { name: "Edit details", exact: true })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const editedTitle: string = `${event.title} — recovery verified`;
    await dialog
      .getByLabel(event.titleLabel, { exact: true })
      .fill(editedTitle);
    for (let step: number = 0; step < 5; step++) {
      const next: Locator = dialog.getByRole("button", {
        name: "Next",
        exact: true,
      });
      if (!(await next.isVisible())) {
        break;
      }
      await next.click();
    }
    await dialog
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: editedTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(event.identifier, { exact: true }),
    ).toBeVisible();
  });

  for (const scenario of ["long-title", "missing-data"]) {
    test(`${event.name}: ${scenario} stays usable on a narrow phone`, async ({
      page,
    }: BrowserTest): Promise<void> => {
      await page.setViewportSize({ width: 320, height: 812 });
      await openOverview(page, event, scenario);
      await expectNoOverflow(page);
      await expect(
        page.getByRole("button", {
          name:
            scenario === "missing-data" && event.name === "maintenance"
              ? "More actions"
              : event.action,
          exact: true,
        }),
      ).toBeEnabled();
      if (scenario === "missing-data") {
        await expect(
          page.getByRole("region", { name: "Event summary" }),
        ).not.toContainText("Invalid");
        await expect(page.getByText(/no items in this feed/i)).toBeVisible();
      } else {
        const title: Locator = page.getByRole("heading", {
          name: /checkout-service-checkout-service/,
        });
        await expect(title).toHaveCount(2); // Semantic page h1 plus the visible event heading.
        const visibleTitle: Locator = title.last();
        const metrics: { client: number; scroll: number } =
          await visibleTitle.evaluate(
            (
              element: HTMLElement | SVGElement,
            ): { client: number; scroll: number } => {
              return {
                client: element.clientHeight,
                scroll: element.scrollHeight,
              };
            },
          );
        expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
      }
    });
  }

  test(`${event.name}: tablet long titles fit alongside the real navigation`, async ({
    page,
  }: BrowserTest): Promise<void> => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openOverview(page, event, "long-title");
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectNoOverflow(page);
    await expect(
      page.getByRole("button", { name: event.action, exact: true }),
    ).toBeEnabled();
  });
}

test("keyboard shortcuts focus activity and details and state cancellation preserves the event", async ({
  page,
}: BrowserTest): Promise<void> => {
  await openOverview(page, events[0]);
  const skip: Locator = page.getByRole("link", {
    name: "Skip to activity",
    exact: true,
  });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Response activity", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("link", { name: "Skip to details", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Event context" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toContainText("Created");
});

test("resolved incidents have completed progression and a fixed final duration", async ({
  page,
}: BrowserTest): Promise<void> => {
  await openOverview(page, events[0], "resolved");
  await expect(page.locator('[aria-current="step"]')).toContainText("Resolved");
  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Event summary" }),
  ).toContainText("30 minutes");
});

test("load errors remain visible through the actual model page", async ({
  page,
}: BrowserTest): Promise<void> => {
  await page.goto(
    `/dashboard/${projectId}/incidents/${eventId}?scenario=load-error`,
  );
  await expect(
    page.getByText("Fixture could not load the incident.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acknowledge", exact: true }),
  ).toHaveCount(0);
});

test("long activity feeds reveal earlier history and keep recent updates when collapsed", async ({
  page,
}: BrowserTest): Promise<void> => {
  await openOverview(page, events[0], "long-feed");
  const activity: Locator = page.getByRole("region", {
    name: "Response activity",
    exact: true,
  });
  const disclosure: Locator = activity.getByRole("button", {
    name: "Show 6 earlier updates",
    exact: true,
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(activity.getByText("Update 01", { exact: true })).toHaveCount(0);
  await expect(activity.getByText("Update 07", { exact: true })).toBeVisible();
  await expect(activity.getByText("Update 12", { exact: true })).toBeVisible();
  await disclosure.click();
  const collapse: Locator = activity.getByRole("button", {
    name: "Show fewer updates",
    exact: true,
  });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(activity.getByText("Update 01", { exact: true })).toBeVisible();
  await expect(activity.getByText("Update 12", { exact: true })).toBeVisible();
  await activity.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(activity.getByText("Update 01", { exact: true })).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(activity.getByText("Update 01", { exact: true })).toHaveCount(0);
  await expect(activity.getByText("Update 12", { exact: true })).toBeVisible();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
});
