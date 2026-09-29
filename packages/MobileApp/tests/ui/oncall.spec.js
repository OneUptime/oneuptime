const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures, projects } = require("./fixtures");

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the native-stack transition finish before freezing the rendered screen.
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(
        __dirname,
        "../../docs/screenshots",
        `${testInfo.project.name}-${name}.png`,
      )
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  expect(
    await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
}

async function backToOverview(page) {
  await page.getByRole("button", { name: /back/i }).first().click();
  await expect(page.getByTestId("oncall-overview-scroll")).toBeVisible();
}

async function checkClearance(page, scrollId, lastActionId) {
  const scroller = page.getByTestId(scrollId);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const lastAction = await page.getByTestId(lastActionId).boundingBox();
  const navigation = await page
    .getByRole("tab", { name: "Settings", exact: true })
    .boundingBox();
  expect(lastAction).not.toBeNull();
  expect(navigation).not.toBeNull();
  expect(lastAction.y + lastAction.height).toBeLessThanOrEqual(
    navigation.y - 20,
  );
}

test("on-call roster, coverage, pages, policies and calendar stay in the selected project", async ({
  page,
}, testInfo) => {
  const { requests, mutations } = await installFixtures(page);
  const failures = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await expect(page.getByTestId("oncall-status-card")).toContainText(
    "You're on call",
  );
  await expect(
    page.getByText("Engineering primary", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("quick-action-cover")).toContainText("Cover for me");
  await expect(page.getByTestId("quick-action-roster")).toContainText("Who's on call");
  await capture(page, "oncall-overview", testInfo);
  await checkClearance(page, "oncall-overview-scroll", "row-calendar");
  await capture(page, "oncall-bottom-clearance", testInfo);

  await page.getByTestId("quick-action-roster").click();
  await expect(page.getByTestId("coverage-summary")).toContainText(
    "1 of 2 schedules covered",
  );
  await capture(page, "oncall-roster", testInfo);
  await page.getByRole("tab", { name: "Needs cover (1)", exact: true }).click();
  await expect(page.getByTestId("roster-card-schedule-2")).toBeVisible();
  await expect(page.getByTestId("roster-card-schedule-1")).toHaveCount(0);
  await page.getByTestId("roster-search").fill("Priya");
  await expect(
    page.getByText("No schedules match that search.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "On call (1)", exact: true }).click();
  await expect(page.getByTestId("roster-card-schedule-1")).toBeVisible();
  await backToOverview(page);

  await page.getByTestId("quick-action-cover").click();
  await expect(page.getByTestId("coverage-project-name")).toContainText(
    projects[0].name,
  );
  await capture(page, "oncall-arrange-coverage", testInfo);
  await page.getByTestId("open-user-picker").click();
  await expect(page.getByTestId("user-option-responder-2")).toBeVisible();
  const closePicker = await page.getByRole("button", { name: "Close user picker", exact: true }).boundingBox();
  expect(closePicker.width).toBeGreaterThanOrEqual(48);
  expect(closePicker.height).toBeGreaterThanOrEqual(48);
  expect(closePicker.x + closePicker.width).toBeLessThanOrEqual(page.viewportSize().width - 12);
  await capture(page, "oncall-teammate-picker", testInfo);
  await page.getByTestId("user-picker-search").fill("Priya");
  await page.getByTestId("user-option-responder-2").click();
  await page.getByTestId("duration-8").click();
  await expect(page.getByTestId("override-preview")).toContainText("8 hours");
  await expect(page.getByTestId("override-preview")).toContainText(
    "Priya Shah",
  );
  await checkClearance(page, "create-override-scroll", "submit-override");
  await capture(page, "oncall-coverage-review", testInfo);
  await page.getByTestId("submit-override").click();
  await expect(page.getByTestId("oncall-overview-scroll")).toBeVisible();
  const created = mutations.find((request) => {
    return request.path === "/api/on-call-duty-policy-user-override";
  });
  expect(created).toBeTruthy();
  expect(created.projectId).toBe(projects[0]._id);
  expect(created.body.data.overrideUserId).toBe("responder-1");
  expect(created.body.data.routeAlertsToUserId).toBe("responder-2");
  expect(
    new Date(created.body.data.endsAt) - new Date(created.body.data.startsAt),
  ).toBe(8 * 60 * 60 * 1000);

  await page.getByTestId("row-overrides").click();
  await expect(
    page.getByText("Your pages go to Priya Shah", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("override-card-override-1")).toContainText("In effect");
  await capture(page, "oncall-coverage", testInfo);
  await backToOverview(page);

  await page.getByTestId("row-pages").click();
  await expect(page.getByTestId("page-card-page-1")).toBeVisible();
  await capture(page, "oncall-pages", testInfo);
  await page
    .getByRole("tab", { name: "Unacknowledged (1)", exact: true })
    .click();
  await expect(page.getByTestId("page-card-page-2")).toHaveCount(0);
  await page.getByTestId("page-card-page-1").click();
  await expect(page.getByRole("button", { name: "Acknowledge incident", exact: true })).toBeVisible();
  const incidentBack = page.getByRole("button", { name: /back/i }).first();
  await expect(incidentBack).toBeVisible();
  await incidentBack.click();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("inbox-category-incidents")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await backToOverview(page);

  await page.getByTestId("row-policies").click();
  await expect(
    page.getByText("Active assignments", { exact: true }),
  ).toBeVisible();
  await capture(page, "oncall-policies", testInfo);
  await backToOverview(page);

  await page.getByTestId("row-calendar").click();
  await expect(page.getByTestId("calendar-project-name")).toContainText(
    projects[0].name,
  );
  await capture(page, "oncall-calendar-setup", testInfo);
  await page.getByTestId("generate-feed").click();
  await expect(page.getByTestId("feed-link-box")).toBeVisible();
  await expect(page.getByTestId("feed-https-url")).toHaveCount(0);
  await expect(page.getByTestId("toggle-private-link")).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Show private link", exact: true }).click();
  await expect(page.getByTestId("feed-https-url")).toBeVisible();
  await expect(page.getByTestId("toggle-private-link")).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Hide private link", exact: true }).click();
  await expect(page.getByTestId("toggle-private-link")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("feed-https-url")).toHaveCount(0);
  await capture(page, "oncall-calendar", testInfo);
  await checkClearance(page, "calendar-feed-scroll", "regenerate-feed");
  await capture(page, "oncall-calendar-bottom", testInfo);

  const onCallRequests = requests.filter((request) => {
    return (
      request.path.includes("on-call") ||
      request.path.includes("user-notification-log") ||
      request.path.includes("team-member")
    );
  });
  expect(onCallRequests.length).toBeGreaterThan(0);
  for (const request of onCallRequests) {
    expect(request.headers.tenantid).toBe(projects[0]._id);
    expect(request.headers["is-multi-tenant-query"]).not.toBe("true");
  }
  expect(failures).toEqual([]);
});

test("coverage recovers from a teammate loading failure and confirms the requested direction", async ({ page }, testInfo) => {
  const { mutations } = await installFixtures(page);
  let teammatesAvailable = false;
  await page.route(/\/api\/team-member\/get-list/, async (route) => {
    if (!teammatesAvailable) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Team directory is temporarily unavailable" }),
      });
    }
    return route.fallback();
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await page.getByTestId("quick-action-cover").click();
  await expect(page.getByTestId("coverage-teammates-error")).toBeVisible();
  await page.getByTestId("open-user-picker").click();
  await expect(page.getByTestId("user-picker-search")).toHaveCount(0);
  await capture(page, "oncall-teammates-retry", testInfo);
  teammatesAvailable = true;
  await page.getByTestId("retry-coverage-teammates").click();
  await expect(page.getByTestId("coverage-teammates-error")).toHaveCount(0);
  await page.getByRole("tab", { name: "I'll take over", exact: true }).click();
  await page.getByTestId("open-user-picker").click();
  await page.getByTestId("user-option-responder-2").click();
  await page.getByTestId("duration-2").click();
  await expect(page.getByTestId("override-preview")).toContainText("Priya Shah's on-call pages come to you for the next 2 hours.");
  await page.getByTestId("submit-override").click();
  await expect(page.getByTestId("oncall-overview-scroll")).toBeVisible();
  const created = mutations.filter((request) => {
    return request.path === "/api/on-call-duty-policy-user-override";
  });
  expect(created).toHaveLength(1);
  expect(created[0].projectId).toBe(projects[0]._id);
  expect(created[0].body.data.overrideUserId).toBe("responder-2");
  expect(created[0].body.data.routeAlertsToUserId).toBe("responder-1");
  expect(new Date(created[0].body.data.endsAt) - new Date(created[0].body.data.startsAt)).toBe(2 * 60 * 60 * 1000);
});

test("covering a current shift preserves its end time and does not offer a new duration", async ({ page }) => {
  const { mutations } = await installFixtures(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "On-Call", exact: true }).click();
  await page.getByTestId("get-cover-shift-1").click();
  await expect(page.getByTestId("prefilled-shift")).toContainText("Engineering primary");
  await expect(page.getByTestId("duration-4")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "I'll take over", exact: true })).toHaveCount(0);
  await page.getByTestId("open-user-picker").click();
  await page.getByTestId("user-option-responder-2").click();
  await page.getByTestId("submit-override").click();
  await expect(page.getByTestId("oncall-overview-scroll")).toBeVisible();
  const created = mutations.find((request) => {
    return request.path === "/api/on-call-duty-policy-user-override";
  });
  expect(created.body.data.overrideUserId).toBe("responder-1");
  expect(created.body.data.routeAlertsToUserId).toBe("responder-2");
  expect(created.body.data.startsAt).toBe("2026-09-10T10:00:00.000Z");
  expect(created.body.data.endsAt).toBe("2026-09-10T16:00:00.000Z");
});
