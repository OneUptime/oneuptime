import { Browser, chromium, Page } from "@playwright/test";
import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";

/*
 * On a self-hosted instance the first account to sign up becomes Master Admin
 * (UserService.createUserOnSignup), and Master Admin skips every column and
 * tenant permission check (BasePermission.checkPermissions). On a fresh
 * database the first Discord spec would therefore run its ACL probes as that
 * user and read columns declared `read: []`, which made
 * Installation.spec's credential-disclosure case pass or fail depending on
 * whether another spec had registered first. Burn the Master Admin seat on a
 * throwaway account here so every spec's user is an ordinary project owner,
 * which is the user the assertions are written for.
 */
export default async function globalSetup(): Promise<void> {
  const browser: Browser = await chromium.launch();
  try {
    const page: Page = await browser.newPage({
      locale: "en-US",
      timezoneId: "UTC",
    });
    await registerAndCreateProject({
      page,
      projectNamePrefix: "Discord bootstrap (master admin seat)",
    });
  } finally {
    await browser.close();
  }
}
