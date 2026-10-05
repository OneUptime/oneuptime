import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * "If the agent version is outdated, can you please show the sign beside the
 * agent version and also, when I click on it, show how to upgrade the agent?"
 *
 * The real Kubernetes cluster Overview and Host Overview, on the offline
 * fixture (Fixture/Fixture.js): the cluster's agent reports 1.9.0, and the
 * host's collector 0.154.0. `?appVersion=` sets the version the server says
 * it runs (APP_VERSION in env.js), which a OneUptime agent's version is
 * compared with; the fixture leaves it unset otherwise, as on a dev build.
 * A host's collector is compared with the release the host guide pins
 * (0.161.0), whatever the server's own version.
 *
 * Network fenced, page errors and requests the fixture does not model fail
 * the test - the sign and the dialog need nothing from the server.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const HOST_ID: string = "62000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;
const HOST_PATH: string = `/dashboard/${PROJECT_ID}/host/${HOST_ID}`;
const SERVER_VERSION: string = "14.0.14";

const OUTDATED_NAME: string = `Agent 1.9.0 is outdated. A newer agent is available: ${SERVER_VERSION}. Show how to upgrade.`;

// The otelcol-contrib release the host guide pins (HOST_COLLECTOR_VERSION).
const HOST_COLLECTOR_PIN: string = "0.161.0";
const HOST_OUTDATED_NAME: string = `Agent 0.154.0 is outdated. A newer agent is available: ${HOST_COLLECTOR_PIN}. Show how to upgrade.`;

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(
  async ({ page, baseURL }: { page: Page; baseURL: string | undefined }) => {
    const errors: Array<string> = [];
    const aborted: Array<string> = [];
    pageErrors.set(page, errors);
    abortedRequests.set(page, aborted);
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });

    // Nothing may leave the fixture server.
    const fixtureOrigin: string = new URL(baseURL || "http://127.0.0.1:4233")
      .origin;
    await page.route("**/*", async (route: PlaywrightRoute) => {
      if (new URL(route.request().url()).origin === fixtureOrigin) {
        await route.continue();
        return;
      }
      aborted.push(route.request().url());
      await route.abort();
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  // Everything the page asked the fixture for, the fixture models.
  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const fixture: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __chartTimeZoomFixture?: { unhandled?: Array<unknown> };
        }
      ).__chartTimeZoomFixture;
      return fixture?.unhandled || [];
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(page: Page, pathWithQuery: string): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(pathWithQuery);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

test.describe("an outdated agent version", () => {
  test("Cluster Details shows the sign beside the version; it explains itself and opens how to upgrade the chart", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${CLUSTER_PATH}?appVersion=${SERVER_VERSION}`);

    const trigger: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await expect(trigger).toHaveText("1.9.0");
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    // Hover: the sign says what it means.
    await trigger.hover();
    await expect(
      page.getByText(`A newer agent is available: ${SERVER_VERSION}`),
    ).toBeVisible();

    await trigger.click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Upgrade the OneUptime Kubernetes Agent",
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        `This agent runs version 1.9.0. Version ${SERVER_VERSION} is available.`,
      ),
    ).toBeVisible();
    await expect(dialog.getByText("Upgrade the Helm release")).toBeVisible();

    const command: Locator = dialog.locator("pre code");
    await expect(command).toHaveCount(1);
    await expect(command).toContainText("helm repo update");
    await expect(command).toContainText(
      "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
    );
    await expect(command).toContainText("--reuse-values");
    await expect(
      dialog.getByRole("button", { name: "Copy to clipboard" }),
    ).toBeVisible();

    // Escape closes it, and the focus is back on the version.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the keyboard reaches the version and opens the dialog; Close closes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${CLUSTER_PATH}?appVersion=${SERVER_VERSION}`);

    const trigger: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("modal-footer-close-button").click();
    await expect(dialog).toBeHidden();
  });

  test("the dialog fits a phone's screen without scrolling the page sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${CLUSTER_PATH}?appVersion=${SERVER_VERSION}`);

    const trigger: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await trigger.click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const box: { x: number; width: number } | null = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 0.5);

    const scroll: { scrollWidth: number; innerWidth: number } =
      await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);
  });
});

test.describe("versions that are not outdated look as they always did", () => {
  test("a server that does not know its own version shows the cluster's version as plain text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLUSTER_PATH);

    await expect(page.getByText("1.9.0", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
  });
});

/*
 * Hosts named by the maintainer: the host guide's collector now reports the
 * release it pins, so a host whose collector is older carries the sign too,
 * and the dialog shows how to upgrade the collector on that host's OS.
 */
test.describe("a host's collector behind the release the host guide pins", () => {
  test("shows the sign whatever the server's own version, and opens the upgrade for a Linux host", async ({
    page,
  }: {
    page: Page;
  }) => {
    // No ?appVersion: the pin decides, not the server.
    await open(page, HOST_PATH);

    const trigger: Locator = page.getByRole("button", {
      name: HOST_OUTDATED_NAME,
    });
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await expect(trigger).toHaveText("0.154.0");
    await expect(trigger).toHaveAttribute("data-agent-kind", "host-collector");

    await trigger.hover();
    await expect(
      page.getByText(`A newer agent is available: ${HOST_COLLECTOR_PIN}`),
    ).toBeVisible();

    await trigger.click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Upgrade the OpenTelemetry Collector",
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        `This agent runs version 0.154.0. Version ${HOST_COLLECTOR_PIN} is available.`,
      ),
    ).toBeVisible();

    // The fixture host reports os.type linux: the four Linux installs.
    await expect(dialog.getByRole("tab")).toHaveText([
      "Docker",
      "Debian / Ubuntu",
      "RHEL / Fedora",
      "Linux Tarball",
    ]);

    // First the config, which only the setup guide fills in with a key.
    await expect(dialog.getByText("Save the new config")).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", `${HOST_PATH}/documentation`);

    // Then the new release: the Docker container, on the pinned image.
    await expect(dialog.getByText("Install the new release")).toBeVisible();
    const command: Locator = dialog.locator("pre code");
    await expect(command).toHaveCount(1);
    await expect(command).toContainText("docker rm -f otel-collector");
    await expect(command).toContainText(
      `otel/opentelemetry-collector-contrib:${HOST_COLLECTOR_PIN}`,
    );

    await dialog.getByRole("tab", { name: "Debian / Ubuntu" }).click();
    await expect(command).toContainText(`VERSION=${HOST_COLLECTOR_PIN}`);
    await expect(command).toContainText(
      "sudo dpkg -i --force-confold /tmp/otelcol-contrib.deb",
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a host on the pinned release, or a newer one, shows its version as plain text", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const version of [HOST_COLLECTOR_PIN, "0.162.0"]) {
      await open(page, `${HOST_PATH}?hostAgentVersion=${version}`);

      await expect(page.getByText(version, { exact: true })).toBeVisible({
        timeout: 30000,
      });
      await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
    }
  });
});
