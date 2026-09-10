const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

async function capture(page, name, testInfo) {
  await page.evaluate(() => document.fonts.ready);
  const scroll = page.getByTestId("auth-scroll").filter({ visible: true });
  if (await scroll.count()) {
    await scroll.evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
  }
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(__dirname, "../../docs/screenshots", `${testInfo.project.name}-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function openLogin(page, loginMode = "normal") {
  const fixture = await installFixtures(page, { signedIn: false, loginMode });
  await page.goto("/");
  await page.getByLabel("Server URL", { exact: true }).fill("http://127.0.0.1:8096");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  return fixture;
}

async function signInWithPassword(page) {
  await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}

test("password visibility, keyboard entry, and recovery give clear next steps", async ({ page }, testInfo) => {
  const { requests } = await openLogin(page);
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeInViewport({ ratio: 1 });
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("fixture-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveJSProperty("type", "text");
  await expect(password).toHaveValue("fixture-password");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByTestId("forgot-password-link").click();
  await expect(page.getByRole("heading", { name: "Forgot Password", exact: true })).toBeVisible();
  await page.getByTestId("send-reset-link").click();
  await expect(page.getByRole("alert")).toContainText("Enter the email address on your account.");
  await page.getByTestId("forgot-password-email-input").fill("alex@example.test");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const emailBounds = await page.getByTestId("forgot-password-email-input").evaluate((element) => {
    const input = element.getBoundingClientRect();
    const field = element.parentElement.getBoundingClientRect();
    return { inputRight: input.right, fieldRight: field.right, inputLeft: input.left, fieldLeft: field.left };
  });
  expect(emailBounds.inputRight).toBeLessThanOrEqual(emailBounds.fieldRight - 8);
  expect(emailBounds.inputLeft).toBeGreaterThanOrEqual(emailBounds.fieldLeft + 8);
  await capture(page, "password-recovery-form", testInfo);
  await page.getByTestId("forgot-password-email-input").press("Enter");
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await expect(page.getByTestId("forgot-password-subtitle")).toContainText("If that address has an account");
  expect(requests.some((request) => request.path === "/identity/forgot-password")).toBe(true);
  await capture(page, "password-recovery-confirmation", testInfo);
  await page.getByTestId("back-to-sign-in").click();
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
});

test("SSO offers organization sign-in and groups email-discovered providers by project", async ({ page }, testInfo) => {
  const { requests } = await openLogin(page);
  await page.getByRole("button", { name: "Sign in with SSO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SSO Login", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Company single sign-on", exact: true })).toBeVisible();
  await capture(page, "sso-login", testInfo);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Email is required.");
  await page.getByLabel("Email", { exact: true }).filter({ visible: true }).fill("alex@example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Aurora Production", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aurora SSO", exact: true })).toBeVisible();
  expect(requests.some((request) => request.path === "/identity/service-provider-login")).toBe(true);
  await capture(page, "sso-provider-selection", testInfo);
  await page.getByRole("button", { name: "Use a different email", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true }).filter({ visible: true })).toHaveValue("alex@example.test");
  await page.getByRole("button", { name: "Back to Login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
});

test("two-factor verification preserves recovery routes and requires saving newly issued codes", async ({ page }, testInfo) => {
  const { requests } = await openLogin(page, "two-factor");
  await signInWithPassword(page);
  await expect(page.getByRole("heading", { name: "Two Factor Authentication", exact: true })).toBeVisible();
  await capture(page, "two-factor-methods", testInfo);
  await page.getByTestId("totp-method-totp-1").click();
  await expect(page.getByLabel("Authenticator code", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lost-access-link")).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter the code from your authenticator app.");
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await capture(page, "two-factor-code-entry", testInfo);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save Your Backup Codes", exact: true })).toBeVisible();
  await expect(page.getByTestId("backup-code-value")).toHaveCount(8);
  await expect(page.getByTestId("backup-codes-continue")).toBeDisabled();
  await capture(page, "backup-codes", testInfo);
  await page.getByTestId("backup-codes-saved-checkbox").click();
  await expect(page.getByTestId("backup-codes-continue")).toBeEnabled();
  await page.getByTestId("backup-codes-continue").click();
  await expect(page.getByText("Your overview", { exact: true })).toBeVisible();
  const verification = requests.find((request) => request.path === "/identity/verify-totp-auth");
  expect(verification.body.data).toMatchObject({ code: "123456", twoFactorAuthId: "totp-1" });
});

test("a backup code can recover a sign-in without access to the authenticator", async ({ page }, testInfo) => {
  const { requests } = await openLogin(page, "two-factor");
  await signInWithPassword(page);
  await page.getByTestId("lost-access-link").click();
  await expect(page.getByLabel("Backup code", { exact: true })).toBeVisible();
  await page.getByLabel("Backup code", { exact: true }).fill("DEMO-1234");
  await capture(page, "backup-code-recovery", testInfo);
  await page.getByRole("button", { name: "Sign In", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Your overview", { exact: true })).toBeVisible();
  const verification = requests.find((request) => request.path === "/identity/verify-backup-code");
  expect(verification.body.data.backupCode).toBe("DEMO-1234");
});

test("required authenticator setup explains both steps and protects recovery codes", async ({ page }, testInfo) => {
  const { requests } = await openLogin(page, "enrolment");
  await signInWithPassword(page);
  await expect(page.getByRole("heading", { name: "Set Up Two Factor Authentication", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your account", exact: true })).toBeVisible();
  await expect(page.getByTestId("enrolment-secret")).toHaveText("JBSWY3DPEHPK3PXP");
  await capture(page, "authenticator-setup", testInfo);
  await page.getByLabel("Authenticator code", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Verify and Sign In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save Your Backup Codes", exact: true })).toBeVisible();
  await expect(page.getByTestId("backup-codes-continue")).toBeDisabled();
  const verification = requests.find((request) => request.path === "/identity/verify-totp-enrolment");
  expect(verification.body.data).toMatchObject({ code: "654321", twoFactorAuthId: "totp-1" });
});

test("settings project access makes required SSO and provider choices clear without switching workspaces", async ({ page }, testInfo) => {
  const { requests } = await installFixtures(page, { requireProjectSso: true });
  await page.goto("/");
  await expect(page.getByText("Your overview", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Manage Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Projects", exact: true })).toBeVisible();
  await expect(page.getByText("2 projects · 1 need SSO sign-in", { exact: true })).toBeVisible();
  await expect(page.getByText("SSO Required", { exact: true })).toBeVisible();
  await capture(page, "projects-access", testInfo);

  await page.getByLabel("Search projects", { exact: true }).fill(" atlas ");
  await expect(page.getByRole("button", { name: "Authenticate with SSO for Atlas Staging", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear project search", exact: true }).click();
  await expect(page.getByLabel("Search projects", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Authenticate with SSO for Atlas Staging", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your provider", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Company single sign-on", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atlas SSO", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch project, current project Aurora Production", exact: true }).filter({ visible: true })).toBeVisible();
  expect(requests.some((request) => request.path === "/api/project-sso/project-atlas/sso-list")).toBe(true);
  await capture(page, "settings-sso-providers", testInfo);

  const lastProvider = page.getByRole("button", { name: "Atlas SSO", exact: true });
  await lastProvider.evaluate((element) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (!ancestor.closest('[aria-hidden="true"]') && ["auto", "scroll"].includes(style.overflowY)) {
        ancestor.scrollTop = ancestor.scrollHeight;
        return;
      }
      ancestor = ancestor.parentElement;
    }
    throw new Error("The final SSO provider must have an accessible scrolling ancestor.");
  });
  await expect(lastProvider).toBeInViewport();
  const providerBounds = await lastProvider.boundingBox();
  const navigationBounds = await page.getByRole("tablist").boundingBox();
  expect(providerBounds).not.toBeNull();
  expect(navigationBounds).not.toBeNull();
  expect(providerBounds.y + providerBounds.height).toBeLessThanOrEqual(navigationBounds.y - 20);
  await capture(page, "settings-sso-providers-bottom", testInfo);
});
