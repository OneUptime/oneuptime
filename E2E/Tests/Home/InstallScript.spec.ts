import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The Home service exposes two convenience install-script shortcuts
 * (Home/Routes.ts):
 *
 *   - GET /install.sh                      -> the OneUptime installer
 *   - GET /infrastructure-agent/install.sh -> the Infrastructure Agent installer
 *
 * Both are documented, copy-pasted-into-a-terminal URLs
 * (`curl .../install.sh | sh`), so their contract is simply that they
 * redirect to the canonical raw-GitHub script on the `release` branch. This
 * suite is the deployment contract: it proves the routes are mounted and
 * redirect to exactly the right script.
 *
 * The redirect is inspected with `fetch(..., { redirect: "manual" })` (Node's
 * fetch surfaces the real 3xx status and Location header rather than following
 * it) so the test stays hermetic - it never leaves the deployment out to
 * GitHub, and so does not depend on external network or on the release branch
 * actually containing the file. A regression that drops the route, 404s, or
 * points the shortcut at the wrong file would break the documented one-line
 * install and fail here.
 *
 * These run only where the Home marketing site is deployed, which the suite
 * gates on IS_BILLING_ENABLED like the other Home specs.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Home: install script shortcuts", () => {
  test("/install.sh redirects to the release OneUptime installer", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    /*
     * redirect: "manual" captures the redirect itself rather than following it
     * out to GitHub, keeping this test hermetic.
     */
    const response: Response = await fetch(endpointFor("/install.sh"), {
      redirect: "manual",
    });

    // A 3xx redirect, not a 200 page and not a 404.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);

    expect(response.headers.get("location")).toBe(
      "https://raw.githubusercontent.com/OneUptime/oneuptime/release/Home/Scripts/Install.sh",
    );
  });

  test("/infrastructure-agent/install.sh redirects to the release Linux agent installer", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: Response = await fetch(
      endpointFor("/infrastructure-agent/install.sh"),
      { redirect: "manual" },
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);

    expect(response.headers.get("location")).toBe(
      "https://raw.githubusercontent.com/OneUptime/oneuptime/release/InfrastructureAgent/Scripts/Install/Linux.sh",
    );
  });
});
