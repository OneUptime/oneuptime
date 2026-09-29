const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures, projects } = require("./fixtures");

async function capture(page, name, testInfo) {
  await page.evaluate(() => { return document.fonts.ready; });
  // Allow the native-stack header and tab transitions to finish laying out.
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(__dirname, "../../docs/screenshots", `${testInfo.project.name}-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  expect(await page.evaluate(() => { return document.documentElement.scrollWidth <= window.innerWidth; })).toBe(true);
}

async function tab(page, name) {
  if (name === "Incidents" || name === "Alerts") {
    const inbox = page.getByRole("tab", { name: "Inbox", exact: true });
    // Reselecting an active tab pops its stack. Do not race that transition
    // with a second Back press while an outgoing detail is still mounted.
    if (await inbox.getAttribute("aria-selected") !== "true") {
      await inbox.click();
    }
    const category = page.getByTestId(`inbox-category-${name.toLowerCase()}`);
    if (!(await category.isVisible())) {
      await page.getByRole("button", { name: /back/i }).first().click();
    }
    await expect(category).toBeVisible();
    await category.click();
    return;
  }
  await page.getByRole("tab", { name, exact: true }).click();
}

async function bottomClearance(page) {
  const result = await page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll("div")).filter((element) => {
      if (element.closest('[aria-hidden="true"]')) { return false; }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return ["auto", "scroll"].includes(style.overflowY) && rect.height > 100 && rect.width > 200 && element.scrollHeight > element.clientHeight;
    });
    const scroller = scrollers.sort((a, b) => { return b.clientHeight - a.clientHeight; })[0];
    if (!scroller) { return null; }
    scroller.scrollTop = scroller.scrollHeight;
    const navigation = document.querySelector('[role="tablist"]:not([aria-label="Inbox categories"])');
    const controls = Array.from(scroller.querySelectorAll('[role="button"], input, [role="radio"]')).filter((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const last = controls.at(-1);
    return last && navigation ? { item: last.getBoundingClientRect().bottom, navigation: navigation.getBoundingClientRect().top } : null;
  });
  if (result) { expect(result.item).toBeLessThanOrEqual(result.navigation - 20); }
}

test("main screens, searching, project switching and cold restoration", async ({ page }, testInfo) => {
  const { requests } = await installFixtures(page);
  const failures = [];
  page.on("pageerror", (error) => { failures.push(error.message); });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Switch project, current project/ })).toContainText(projects[0].name);
  await expect(page.getByRole("button", { name: "2 Active Incidents. Tap to view.", exact: true })).toBeVisible();
  await expect(page.getByText("You're on call", { exact: true })).toBeVisible();
  for (const name of ["Home", "Monitors", "Inbox", "On-Call", "Settings"]) {
    const label = page.getByRole("tab", { name, exact: true }).getByText(name, { exact: true });
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await capture(page, "home", testInfo);
  await bottomClearance(page);
  await capture(page, "home-bottom", testInfo);

  await tab(page, "Incidents");
  await expect(page.getByText("Checkout API latency above threshold", { exact: true })).toBeVisible();
  await capture(page, "incidents", testInfo);
  await page.getByPlaceholder("Search title or ID").fill("no matching incident");
  await expect(page.getByText(/No matching/).first()).toBeVisible();
  await capture(page, "search-empty", testInfo);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByText("Checkout API latency above threshold", { exact: true }).click();
  await expect(page.getByText("Impact", { exact: true })).toBeVisible();
  await capture(page, "incident-detail", testInfo);
  await bottomClearance(page);

  await tab(page, "Alerts");
  await expect(page.getByText("Database CPU usage above 80%", { exact: true })).toBeVisible();
  await capture(page, "alerts", testInfo);
  await page.getByText("Database CPU usage above 80%", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Acknowledge alert", exact: true })).toBeVisible();
  await capture(page, "alert-detail", testInfo);

  await tab(page, "Monitors");
  await expect(page.getByRole("button", { name: /^Monitor Checkout API\. Status/ })).toBeVisible();
  await capture(page, "monitors", testInfo);
  await page.getByRole("button", { name: /^Monitor Checkout API\. Status/ }).click();
  await expect(page.getByRole("heading", { name: "Description", exact: true })).toBeVisible();
  await capture(page, "monitor-detail", testInfo);

  await tab(page, "On-Call");
  await expect(page.getByText(/Engineering primary/).first()).toBeVisible();
  await capture(page, "on-call", testInfo);

  await tab(page, "Settings");
  await capture(page, "settings", testInfo);
  await bottomClearance(page);
  await capture(page, "settings-bottom", testInfo);

  await page.getByRole("button", { name: /^Switch project, current project/ }).click();
  await capture(page, "project-switcher", testInfo);
  await page.getByRole("radio", { name: projects[1].name, exact: true }).click();
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Switch project, current project/ })).toContainText(projects[1].name);
  await tab(page, "Incidents");
  await expect(page.getByText("Staging deployment health check", { exact: true })).toBeVisible();
  await expect(page.getByText("Checkout API latency above threshold", { exact: true })).toHaveCount(0);
  await capture(page, "switched-project", testInfo);
  const beforeReload = requests.length;
  await page.reload();
  await expect(page.getByRole("button", { name: /^Switch project, current project/ })).toContainText(projects[1].name);
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  const operational = requests.slice(beforeReload).filter((request) => { return request.path.startsWith("/api/") && request.path !== "/api/project/get-list"; });
  expect(operational.length).toBeGreaterThan(0);
  for (const request of operational) {
    expect(request.projectId).toBe(projects[1]._id);
    expect(request.headers["is-multi-tenant-query"]).not.toBe("true");
  }
  expect(failures).toEqual([]);
});

test("grouped incidents and alerts expose context and a usable note composer", async ({ page }, testInfo) => {
  const { mutations } = await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await tab(page, "Incidents");
  await page.getByRole("button", { name: "Episodes", exact: true }).click();
  await expect(page.getByText("Checkout service degradation", { exact: true })).toBeVisible();
  await capture(page, "incident-episodes", testInfo);
  await page.getByText("Checkout service degradation", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Acknowledge incident episode", exact: true })).toBeVisible();
  await capture(page, "incident-episode-detail", testInfo);
  await page.getByRole("button", { name: "Add Note", exact: true }).scrollIntoViewIfNeeded();
  await bottomClearance(page);
  await page.getByRole("button", { name: "Add Note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Connection limits adjusted; monitoring recovery.");
  await capture(page, "add-note", testInfo);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveCount(0);
  expect(mutations.some((request) => request.path.includes("incident-episode-internal-note") && request.projectId === projects[0]._id)).toBe(true);

  await tab(page, "Alerts");
  await page.getByRole("button", { name: "Episodes", exact: true }).click();
  await expect(page.getByText("Database resource pressure", { exact: true })).toBeVisible();
  await capture(page, "alert-episodes", testInfo);
  await page.getByText("Database resource pressure", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Acknowledge alert episode", exact: true })).toBeVisible();
  await capture(page, "alert-episode-detail", testInfo);
  await bottomClearance(page);
});

test("server setup, login and password recovery remain reachable", async ({ page }, testInfo) => {
  await installFixtures(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByTestId("auth-scroll")).toBeVisible();
  await capture(page, "server-setup", testInfo);
  const input = page.getByRole("textbox").first();
  await input.fill("http://127.0.0.1:8096");
  await page.getByRole("button", { name: /Continue|Connect/ }).first().click();
  await expect(page.getByPlaceholder(/email|you@/i)).toBeVisible();
  await capture(page, "login", testInfo);
  await page.getByRole("button", { name: /Forgot password/i }).click();
  await capture(page, "forgot-password", testInfo);
});

test("Home shortcuts reset old searches while detail Back preserves context", async ({ page }, testInfo) => {
  await installFixtures(page);
  await page.goto("/");
  const activeAlerts = page.getByRole("button", { name: "2 Active Alerts. Tap to view.", exact: true });
  await activeAlerts.click();
  await expect(page.getByTestId("inbox-category-alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Active only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("Search title or ID").fill("Database");
  await page.getByText("Database CPU usage above 80%", { exact: true }).click();
  await page.getByRole("button", { name: /back/i }).first().click();
  await expect(page.getByTestId("inbox-category-alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByPlaceholder("Search title or ID")).toHaveValue("Database");
  await page.getByPlaceholder("Search title or ID").fill("nothing matches this");
  await expect(page.getByText(/No matching/).first()).toBeVisible();

  await tab(page, "Home");
  await activeAlerts.click();
  await expect(page.getByPlaceholder("Search title or ID")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Active only", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Database CPU usage above 80%", { exact: true })).toBeVisible();
  await tab(page, "Home");
  await page.getByRole("button", { name: /Incident Episodes\. Tap to view\./ }).click();
  await expect(page.getByTestId("inbox-category-incidents")).toHaveAttribute("aria-selected", "true");
  const episode = page.getByTestId("response-list").getByText("Checkout service degradation", { exact: true });
  await expect(episode).toBeVisible();
  await episode.click();
  await page.getByRole("button", { name: /back/i }).first().click();
  await expect(episode).toBeVisible();
  await capture(page, "inbox-shortcut", testInfo);

  await tab(page, "Monitors");
  for (const shortcut of ["Monitor issues", "All monitors", "Disabled monitors"]) {
    await page.getByPlaceholder("Search name or ID").fill("nothing matches this");
    await expect(page.getByText("No matching monitors", { exact: true })).toBeVisible();
    await tab(page, "Home");
    await page.getByRole("button", { name: new RegExp(`${shortcut}\\. Tap to view\\.`) }).click();
    await expect(page.getByPlaceholder("Search name or ID")).toHaveValue("");
    await expect(page.getByText("No matching monitors", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Monitor .*\. Status/ }).first()).toBeVisible();
  }
});
