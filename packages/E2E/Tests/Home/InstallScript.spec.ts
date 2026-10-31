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
 * /infrastructure-agent/install.sh redirects, on the same host, to the copy
 * of the infrastructure agent's installer every OneUptime serves with its docs
 * (/docs/static/scripts/infrastructure-agent/install.sh), never to GitHub. The
 * redirect is inspected with `fetch(..., { redirect: "manual" })` (Node's
 * fetch surfaces the real 3xx status and Location header rather than
 * following it), and its target is then fetched from the same deployment.
 *
 * These run only where the Home marketing site is deployed, which the suite
 * gates on IS_BILLING_ENABLED like the other Home specs.
 */

// The infrastructure agent's installer: a POSIX shell script that says what it installs.
const INFRASTRUCTURE_AGENT_INSTALLER_HEAD: RegExp =
  /^#!\/bin\/sh\n# Installs the OneUptime infrastructure agent/;

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

    /*
     * The shell script itself, not an HTML page or an error body: a bash
     * script that says what it installs. Home's Redirect.test.ts holds the
     * script in the repository (Home/Scripts/Install.sh) to the same two
     * marks, so a rewrite of the installer fails there first.
     */
    expect(body).toMatch(/^#!(?:\/usr\/bin\/env bash|\/bin\/bash)\n/);
    expect(body).toContain("Installs OneUptime with Docker Compose");
  });

  test("/infrastructure-agent/install.sh redirects to the installer this OneUptime serves with its docs", async ({
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
      "/docs/static/scripts/infrastructure-agent/install.sh",
    );

    // The target is the POSIX shell script itself, from this same deployment.
    const script: Response = await fetch(
      endpointFor("/docs/static/scripts/infrastructure-agent/install.sh"),
      { redirect: "manual" },
    );

    expect(script.status).toBe(200);
    expect(await script.text()).toMatch(INFRASTRUCTURE_AGENT_INSTALLER_HEAD);
  });
});
