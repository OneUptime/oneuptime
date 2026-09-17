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
 * (`curl .../install.sh | sh`).
 *
 * /install.sh serves the installer baked into the Home image, so it keeps
 * working however the script moves in the repository. The test checks the
 * body is that script rather than an HTML page or a 404.
 *
 * /infrastructure-agent/install.sh still redirects to raw GitHub. That redirect
 * is inspected with `fetch(..., { redirect: "manual" })` (Node's fetch surfaces
 * the real 3xx status and Location header rather than following it) so the test
 * stays hermetic and never leaves the deployment.
 *
 * These run only where the Home marketing site is deployed, which the suite
 * gates on IS_BILLING_ENABLED like the other Home specs.
 */

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Home: install script shortcuts", () => {
  test("/install.sh serves the OneUptime installer", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const response: Response = await fetch(endpointFor("/install.sh"), {
      redirect: "manual",
    });

    expect(response.status).toBe(200);

    const body: string = await response.text();

    // The shell script itself, not an HTML page or an error body.
    expect(body.startsWith("#!/bin/bash")).toBe(true);
    expect(body).toContain("OneUptime Installation Script");
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
