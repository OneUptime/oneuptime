const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures, projects, caseIds } = require("./fixtures");

/*
 * Security cases in the web rendering of the app, on each phone size and a
 * tablet: Home's row and the Inbox's Security category for somebody who can
 * see the project's cases (and neither for somebody who cannot), the open
 * cases in the order a paged analyst works them, and the case itself - a
 * playbook step approved with a comment, the case taken on and closed with a
 * verdict - each change sent as the dashboard sends it, in the selected
 * project. The API is the fixture's fake (installFixtures' `security`).
 */

const SPRAY =
  "Password spray against the VPN ended in a sign-in for alice@acme.test";

async function capture(page, name, testInfo) {
  await page.evaluate(() => {
    return document.fonts.ready;
  });
  // Let the native-stack transition and any sheet's slide settle.
  await page.waitForTimeout(400);
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

async function openSecurity(page) {
  await page.getByTestId("home-row-security-cases").click();
  await expect(
    page.getByTestId("inbox-category-security").filter({ visible: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("CASE-142 · Security case").first(),
  ).toBeVisible();
}

// A button's fill as the browser draws it.
async function fillOf(locator) {
  return locator.evaluate((element) => {
    return getComputedStyle(element).backgroundColor;
  });
}

function caseRows(page) {
  return page
    .getByRole("button", { name: /^Security case CASE-/ })
    .filter({ visible: true });
}

test("somebody who cannot see security cases keeps the Inbox and Home they had", async ({
  page,
}) => {
  const { requests } = await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await expect(page.getByTestId("home-row-security-cases")).toHaveCount(0);

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByTestId("inbox-category-incidents")).toBeVisible();
  await expect(page.getByTestId("inbox-category-security")).toHaveCount(0);
  // The one question asked, and nothing read past it.
  expect(
    requests.filter((request) => {
      return request.path === "/api/security-case/count";
    }).length,
  ).toBeGreaterThan(0);
  expect(
    requests.filter((request) => {
      return request.path === "/api/security-case/get-list";
    }),
  ).toHaveLength(0);
});

test("the open cases, the most urgent first, and a case waiting for an approval before them", async ({
  page,
}, testInfo) => {
  const { requests } = await installFixtures(page, { security: true });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  const homeRow = page.getByTestId("home-row-security-cases");
  await expect(homeRow).toContainText("Open security cases");
  await expect(homeRow).toContainText("Approval needed on 1 case");
  await homeRow.scrollIntoViewIfNeeded();
  await capture(page, "security-home", testInfo);

  await openSecurity(page);
  await expect(caseRows(page)).toHaveCount(4);
  const order = await caseRows(page).evaluateAll((elements) => {
    return elements.map((element) => {
      return element.getAttribute("aria-label").split(",")[0];
    });
  });
  expect(order).toEqual([
    "Security case CASE-142",
    "Security case CASE-141",
    "Security case CASE-139",
    "Security case CASE-137",
  ]);
  await expect(
    page
      .getByText("Approval needed", { exact: true })
      .filter({ visible: true }),
  ).toHaveCount(1);
  await capture(page, "security-cases", testInfo);

  // Every case read went to the selected project.
  for (const request of requests.filter((entry) => {
    return entry.path.startsWith("/api/security-");
  })) {
    expect(request.headers.tenantid).toBe(projects[0]._id);
  }

  await page.getByRole("button", { name: "Open cases assigned to me" }).click();
  await expect(caseRows(page)).toHaveCount(1);
  await expect(caseRows(page).first()).toContainText("Impossible travel");

  await page
    .getByRole("button", { name: "Open cases nobody has picked up" })
    .click();
  await expect(caseRows(page)).toHaveCount(2);

  await page.getByRole("button", { name: "Every open case" }).click();
  await page.getByTestId("security-case-search").fill("fin-laptop");
  await expect(caseRows(page)).toHaveCount(1);
  await expect(caseRows(page).first()).toContainText("PowerShell");
});

test("a playbook step is approved from the case, with a comment, and the case is taken on and closed", async ({
  page,
}, testInfo) => {
  const { mutations } = await installFixtures(page, { security: true });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await openSecurity(page);
  await page
    .getByText(SPRAY, { exact: true })
    .filter({ visible: true })
    .first()
    .click();

  const approval = page
    .getByTestId("playbook-approval-card")
    .filter({ visible: true });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("Suspend the user in Okta");
  await expect(approval).toContainText(
    "Playbook Contain a compromised account waits at step 2 until someone approves or rejects it.",
  );
  await expect(approval).toContainText("alice@acme.test");
  await expect(approval).toContainText("Protected, never acted on");
  await expect(
    page
      .getByText("Needs an analyst", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  // What OneUptime AI found, before anything is tapped: its report's Summary.
  await expect(
    page.getByTestId("case-ai-summary").filter({ visible: true }),
  ).toContainText("Fourteen failed VPN sign-ins for alice@acme.test");
  // One filled button at a time: Approve, while the step waits on it.
  const assignToMe = page
    .getByRole("button", { name: "Assign CASE-142 to me" })
    .filter({ visible: true });
  const approveFill = await fillOf(approval.getByTestId("playbook-approve"));
  expect(await fillOf(assignToMe)).not.toBe(approveFill);
  await capture(page, "security-case", testInfo);

  await approval.getByTestId("playbook-approve").click();
  const sheet = page.getByTestId("playbook-approve-sheet");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("checkbox", { name: "alice@acme.test, User" }),
  ).toHaveAttribute("aria-checked", "true");
  await sheet
    .getByTestId("playbook-decision-comment")
    .fill("Alice did not sign in.");
  await capture(page, "security-approve", testInfo);
  await sheet.getByTestId("playbook-decision-submit").click();
  await expect(page.getByTestId("playbook-approve-sheet")).toHaveCount(0);
  await expect(
    page.getByTestId("playbook-approval-card").filter({ visible: true }),
  ).toHaveCount(0);
  const decision = mutations.find((entry) => {
    return entry.path.endsWith("/approve");
  });
  expect(decision).toMatchObject({
    path: "/api/security-playbook-run/7a6b0000-0001-4000-8000-000000000001/approve",
    projectId: projects[0]._id,
    body: { comment: "Alice did not sign in.", targets: ["alice@acme.test"] },
  });
  // The step decided, taking the case is the next step: now the filled button.
  await expect
    .poll(async () => {
      return fillOf(assignToMe);
    })
    .toBe(approveFill);

  await page
    .getByRole("button", { name: "Assign CASE-142 to me" })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByText("You have this case", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  expect(
    mutations.find((entry) => {
      return entry.method === "PUT";
    }),
  ).toMatchObject({
    path: `/api/security-case/${caseIds.spray}`,
    projectId: projects[0]._id,
    body: { data: { assignedToUserId: "responder-1" } },
  });

  await page
    .getByRole("button", { name: "Close CASE-142" })
    .filter({ visible: true })
    .click();
  const close = page.getByTestId("close-case-sheet");
  await expect(close).toBeVisible();
  // OneUptime AI read the case as likely malicious: True Positive to start with.
  await expect(
    close.getByRole("radio", {
      name: "True Positive, Suggested by OneUptime AI",
    }),
  ).toHaveAttribute("aria-checked", "true");
  await close.getByTestId("close-case-note").fill("Suspended and reset.");
  await capture(page, "security-close", testInfo);
  await close.getByTestId("close-case-submit").click();
  await expect(page.getByTestId("close-case-sheet")).toHaveCount(0);
  await expect(
    page.getByText("Case closed", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  const closing = mutations.filter((entry) => {
    return entry.method === "PUT";
  });
  expect(closing[closing.length - 1].body).toEqual({
    data: {
      securityCaseStatusId: "5717a7e5-0004-4000-8000-000000000004",
      verdict: "True Positive",
      closingNote: "Suspended and reset.",
    },
  });
  await expect(
    page
      .getByRole("button", { name: "Reopen CASE-142" })
      .filter({ visible: true }),
  ).toBeVisible();
});

test("the reader's own case: Close case leads, and OneUptime AI's priority is one tap", async ({
  page,
}, testInfo) => {
  const { mutations } = await installFixtures(page, { security: true });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await openSecurity(page);
  await page
    .getByText("Impossible travel for jordan.lee@acme.test", { exact: true })
    .filter({ visible: true })
    .first()
    .click();

  await expect(
    page
      .getByText("You have this case", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assign CASE-139 to me" }),
  ).toHaveCount(0);
  await capture(page, "security-case-mine", testInfo);

  await page
    .getByRole("button", { name: "Set to Low" })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByTestId("case-ai-suggested-priority").filter({ visible: true }),
  ).toHaveCount(0);
  expect(
    mutations.find((entry) => {
      return entry.method === "PUT";
    }).body,
  ).toEqual({
    data: { securityCasePriorityId: "9e10e117-0004-4000-8000-000000000004" },
  });

  // The touch targets a thumb uses at night.
  for (const name of ["Close CASE-139", "Status: Contained", "Priority: Low"]) {
    const box = await page
      .getByRole("button", { name, exact: true })
      .filter({ visible: true })
      .boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
