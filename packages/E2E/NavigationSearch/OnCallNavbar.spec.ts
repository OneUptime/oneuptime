import { expect, Locator, Page, test } from "@playwright/test";

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const modelId: string = "00000000-0000-4000-8000-000000000002";
const onCallPath: string = `${projectPath}/on-call-duty`;
const onCallTitle: string = "On-Call Duty";

const expectActiveProduct: (
  page: Page,
  title: string,
) => Promise<void> = async (page: Page, title: string): Promise<void> => {
  const navbar: Locator = page.getByTestId("dashboard-navbar");
  await expect(
    navbar.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    navbar.getByRole("button", { name: "Products", exact: true }),
  ).toHaveCount(0);
};

const selectProduct: (
  page: Page,
  isMobile: boolean,
  currentTitle: string,
  title: string,
) => Promise<void> = async (
  page: Page,
  isMobile: boolean,
  currentTitle: string,
  title: string,
): Promise<void> => {
  const navbar: Locator = page.getByTestId("dashboard-navbar");
  if (isMobile) {
    await navbar.getByTestId("mobile-nav-toggle").click();
  } else {
    await navbar
      .getByRole("button", { name: currentTitle, exact: true })
      .click();
  }

  await page
    .getByRole("link", { name: new RegExp(`^${title}(?:\\s|$)`) })
    .click();
};

test("selecting On-Call Duty keeps its policies landing page and shows its name in the navbar", async ({
  page,
  isMobile,
}: {
  page: Page;
  isMobile: boolean;
}) => {
  await page.goto(`${projectPath}/home?navbar=true`);
  await selectProduct(page, isMobile, "Products", onCallTitle);

  await expect(page).toHaveURL(`${onCallPath}/policies`);
  await expectActiveProduct(page, onCallTitle);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: onCallTitle, exact: true }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Open schedule layers" }).click();
  await expect(page).toHaveURL(`${onCallPath}/schedules/${modelId}/layers`);
  await expectActiveProduct(page, onCallTitle);
});

for (const example of [
  { name: "schedules list", path: "schedules" },
  { name: "schedule details", path: `schedules/${modelId}` },
  { name: "schedule layers", path: `schedules/${modelId}/layers` },
  { name: "escalation policy", path: `policies/${modelId}/escalation` },
  { name: "incoming call policy", path: `incoming-call-policies/${modelId}` },
  { name: "calendar feeds", path: "calendar-feeds" },
  { name: "product settings", path: "settings/label-rules" },
]) {
  test(`shows On-Call Duty when opening and reloading ${example.name}`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${onCallPath}/${example.path}?navbar=true`);
    await expectActiveProduct(page, onCallTitle);
    await expect(page.getByTestId("current-route")).toHaveText(
      `${onCallPath}/${example.path}`,
    );

    await page.reload();
    await expectActiveProduct(page, onCallTitle);
  });
}

test("updates the selected product through switching, browser history and Home", async ({
  page,
  isMobile,
}: {
  page: Page;
  isMobile: boolean;
}) => {
  await page.goto(`${onCallPath}/schedules/${modelId}/layers?navbar=true`);
  await expectActiveProduct(page, onCallTitle);
  await selectProduct(page, isMobile, onCallTitle, "Monitors");
  await expect(page).toHaveURL(`${projectPath}/monitors`);
  await expectActiveProduct(page, "Monitors");

  await page.goBack();
  await expectActiveProduct(page, onCallTitle);
  await expect(page.getByTestId("current-route")).toHaveText(
    `${onCallPath}/schedules/${modelId}/layers`,
  );

  await page.goForward();
  await expectActiveProduct(page, "Monitors");
  await selectProduct(page, isMobile, "Monitors", onCallTitle);
  await expect(page).toHaveURL(`${onCallPath}/policies`);
  await expectActiveProduct(page, onCallTitle);

  const navbar: Locator = page.getByTestId("dashboard-navbar");
  if (isMobile) {
    await navbar.getByTestId("mobile-nav-toggle").click();
  }
  await navbar.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/home/`,
  );
  await expect(
    navbar.getByRole("button", { name: onCallTitle, exact: true }),
  ).toHaveCount(0);
  await expect(
    navbar.getByRole("button", {
      name: isMobile ? "Home" : "Products",
      exact: true,
    }),
  ).toBeVisible();
});
