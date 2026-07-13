/*
 * Topology page E2E: the unified maps hub (Service Map | Infrastructure |
 * Network tabs) renders for a fresh project, each tab shows its
 * onboarding empty state, the Network tab is reachable even with no
 * telemetry, and tab selection is reflected in the URL (shareable views).
 *
 * Run locally: cd E2E && HOST=localhost npx playwright test \
 *   Tests/Dashboard/Topology.spec.ts --project=chromium
 */
import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("Topology page", () => {
  test.beforeEach(() => {
    test.setTimeout(420000);
  });

  test("shows all three map tabs with onboarding empty states and URL tab state", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "topology",
    });

    const topologyUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/topology/overview`)
      .toString();

    await gotoProjectPage({
      page,
      projectId,
      url: topologyUrl,
      ready: page.getByRole("tab", { name: "Service Map" }),
    });

    // All three tabs of the maps hub are present.
    await expect(page.getByRole("tab", { name: "Service Map" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Infrastructure" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Network" })).toBeVisible();

    // Default tab: Service Map onboarding empty state for a fresh project.
    await expect(page.getByText("No services discovered yet")).toBeVisible({
      timeout: 30000,
    });

    // Telemetry tabs show the time range picker.
    await expect(
      page.getByText(
        "Maps are discovered automatically from your OpenTelemetry data",
        { exact: false },
      ),
    ).toBeVisible();

    // Infrastructure tab: its own empty state.
    await page.getByRole("tab", { name: "Infrastructure" }).click();
    await expect(
      page.getByText("No infrastructure topology discovered yet"),
    ).toBeVisible({ timeout: 30000 });

    /*
     * Network tab: reachable without any telemetry (independent data
     * source), shows the live-map hint instead of the time range picker,
     * carries the LLDP empty state with its setup link, and lands in the
     * URL so the view is shareable.
     */
    await page.getByRole("tab", { name: "Network" }).click();
    await expect(
      page.getByText("No network topology discovered yet", { exact: false }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("The network map is live", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Set up network device monitoring"),
    ).toBeVisible();
    expect(page.url()).toContain("tab=Network");
  });
});
