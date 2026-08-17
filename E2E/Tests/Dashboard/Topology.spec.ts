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

    /*
     * Telemetry tabs describe what the map covers, alongside the time range
     * picker. Asserted on the "Connections reflect ..." clause rather than the
     * whole sentence: the leading half names whatever the product currently
     * calls the things on the map, and has already been reworded once.
     */
    await expect(
      page.getByText(
        "Connections reflect OpenTelemetry data from the selected time range",
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

    /*
     * The network map's layout switcher lives in the card header, so it
     * is present even with nothing to draw. A fresh project has no SNMP
     * devices — the topology is derived server-side from LLDP/CDP
     * neighbour tables — so the empty state is all E2E can reach here.
     * The drag, viewport and layout behaviour is covered by the unit
     * suites in App/Tests/Dashboard, which can exercise it exactly.
     */
    await expect(
      page.getByTestId("network-topology-layout-mode-force"),
    ).toBeVisible();
    await expect(
      page.getByTestId("network-topology-layout-mode-tiered"),
    ).toBeVisible();
    await expect(
      page.getByTestId("network-topology-layout-mode-radial"),
    ).toBeVisible();
    await expect(
      page.getByTestId("network-topology-layout-mode-star"),
    ).toBeVisible();
    await expect(
      page.getByTestId("network-topology-layout-mode-parentChild"),
    ).toBeVisible();

    // Force is the default, and it says so to assistive technology.
    await expect(
      page.getByTestId("network-topology-layout-mode-force"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("network-topology-layout-mode-tiered"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-star"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-parentChild"),
    ).toHaveAttribute("aria-pressed", "false");

    // Switching modes moves the pressed state, and only one is ever pressed.
    await page.getByTestId("network-topology-layout-mode-radial").click();
    await expect(
      page.getByTestId("network-topology-layout-mode-radial"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("network-topology-layout-mode-force"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-tiered"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-star"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-parentChild"),
    ).toHaveAttribute("aria-pressed", "false");

    // Star is a mode of its own, not a variant of radial.
    await page.getByTestId("network-topology-layout-mode-star").click();
    await expect(
      page.getByTestId("network-topology-layout-mode-star"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("network-topology-layout-mode-force"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-tiered"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-radial"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-parentChild"),
    ).toHaveAttribute("aria-pressed", "false");

    // ...and so is parent-child, the last option in the group.
    await page.getByTestId("network-topology-layout-mode-parentChild").click();
    await expect(
      page.getByTestId("network-topology-layout-mode-parentChild"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("network-topology-layout-mode-force"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-tiered"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-radial"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId("network-topology-layout-mode-star"),
    ).toHaveAttribute("aria-pressed", "false");

    // The empty state survives a layout change rather than blanking.
    await expect(
      page.getByText("No network topology discovered yet", { exact: false }),
    ).toBeVisible();
  });
});
