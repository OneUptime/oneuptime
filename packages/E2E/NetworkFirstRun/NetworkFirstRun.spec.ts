import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The first-run path of the Network Overview, in a real browser: the real
 * Network layout and Overview (with NetworkGetStarted and AddProbeModal)
 * against the offline fixture (Fixture/Fixture.js). Only the data boundary
 * and the signed-in user are synthetic.
 *
 * A new project's way in: put a probe on your network (add one, run the
 * command the dialog prints, see it connect), bring your devices in, then
 * get told when one goes down - on a desktop, on a phone, in the dark theme
 * and in German.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["NETWORK_FIRST_RUN_FIXTURE_PORT"] || "4284";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const OVERVIEW: string = `/dashboard/${PROJECT_ID}/network-devices/overview`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/network-first-run-ui",
);

interface FixtureState {
  scenario: Record<string, unknown>;
  listRequests: Array<Record<string, unknown>>;
  countRequests: Array<Record<string, unknown>>;
  itemRequests: Array<{
    modelName: string;
    id: string;
    select: Record<string, unknown>;
  }>;
  creates: Array<{ modelName: string; name: string; projectId: string }>;
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
  probes: Array<{ _id: string; name: string; key: string }>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __networkFirstRunFixture?: unknown })
          .__networkFirstRunFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${OVERVIEW}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function openFirstRun(page: Page, query: string = ""): Promise<void> {
  await open(page, query);
  await expect(page.getByTestId("network-first-run-steps")).toBeVisible();
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __networkFirstRunFixture: unknown })
          .__networkFirstRunFixture,
      ),
    ) as FixtureState;
  });
}

function step(page: Page, name: "probe" | "devices" | "alerts"): Locator {
  return page.getByTestId(`network-first-run-step-${name}`);
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// The dialog once its opening transition has finished, for a screenshot.
async function settledDialog(page: Page): Promise<void> {
  for (const part of [dialog(page), page.getByTestId("modal-backdrop")]) {
    await expect
      .poll((): Promise<string> => {
        return part.evaluate((element: Element): string => {
          return getComputedStyle(element).opacity;
        });
      })
      .toBe("1");
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

// Whether the page scrolls sideways: it must not, at any width.
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    );
  });
}

/*
 * How an element's words read on what is drawn behind them, as the browser
 * paints them (WCAG contrast of the computed colours): the light and the
 * dark theme alike.
 */
async function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((element: Element): number => {
    function rgb(value: string): Array<number> {
      const parts: Array<number> = (value.match(/[\d.]+/g) || []).map(Number);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1];
    }

    function background(start: Element): Array<number> {
      let current: Element | null = start;
      while (current) {
        const colour: Array<number> = rgb(
          getComputedStyle(current).backgroundColor,
        );
        if ((colour[3] || 0) > 0.5) {
          return colour;
        }
        current = current.parentElement;
      }
      return rgb(getComputedStyle(document.body).backgroundColor);
    }

    function luminance(colour: Array<number>): number {
      const [r, g, b] = colour.slice(0, 3).map((channel: number): number => {
        const value: number = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
    }

    const text: number = luminance(rgb(getComputedStyle(element).color));
    const ground: number = luminance(background(element));

    return (Math.max(text, ground) + 0.05) / (Math.min(text, ground) + 0.05);
  });
}

async function expectReadable(locator: Locator): Promise<void> {
  const words: string = ((await locator.textContent()) || "").trim();
  const ratio: number = await contrastOf(locator);

  expect({ words, readable: ratio >= 4.5 }).toEqual({ words, readable: true });
}

/*
 * ---------------------------------------------------------------------------
 * The path
 * ---------------------------------------------------------------------------
 */

test("a new project opens on three steps, a probe first", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page);

  await expect(page.getByTestId("network-first-run-steps")).toHaveJSProperty(
    "tagName",
    "OL",
  );
  await expect(step(page, "probe")).toContainText(
    "Put a probe on your network",
  );
  await expect(step(page, "probe")).toContainText(
    "a probe on the internet cannot reach private addresses like 10.0.0.1",
  );
  await expect(step(page, "devices")).toContainText("Bring your devices in");
  await expect(step(page, "alerts")).toContainText(
    "Get told when a device goes down",
  );

  // The page's one primary action is the first thing to do.
  await expect(page.getByTestId("network-first-run-add-probe")).toBeVisible();
  await expect(page.getByTestId("network-get-started-discover")).toBeVisible();
  await expect(page.getByTestId("network-get-started-add")).toBeVisible();

  // No verdict about a network it has not seen, and no tiles of zeroes.
  await expect(page.getByTestId("network-health-hero")).toHaveCount(0);
  await expect(page.getByText("Interfaces Down")).toHaveCount(0);

  await screenshot(page, "network-first-run");
});

test("adding a probe: name it, run the command it prints, and watch it connect", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page);

  await page.getByTestId("network-first-run-add-probe").click();

  const modal: Locator = dialog(page);
  await expect(modal.getByTestId("modal-title")).toHaveText("Add a probe");
  const name: Locator = modal.getByPlaceholder("London office probe");
  await expect(name).toHaveValue("Network probe");
  await settledDialog(page);
  await screenshot(page, "network-add-probe-name");

  await name.fill("Branch office probe");
  await page.getByTestId("modal-footer-submit-button").click();

  // The second step is the command, with the new probe's id and key in it.
  await expect(modal.getByTestId("modal-title")).toHaveText("Run the probe");
  const state: FixtureState = await fixture(page);
  expect(state.creates).toEqual([
    {
      modelName: "Probe",
      name: "Branch office probe",
      projectId: PROJECT_ID,
    },
  ]);
  const created: { _id: string; key: string } = state.probes.find(
    (probe: { name: string }): boolean => {
      return probe.name === "Branch office probe";
    },
  )!;

  const command: Locator = modal.getByTestId("add-probe-command");
  await expect(command).toContainText(
    "docker run --name oneuptime-probe --network host",
  );
  await expect(command).toContainText(`PROBE_ID=${created._id}`);
  await expect(command).toContainText(`PROBE_KEY=${created.key}`);
  await expect(command).toContainText(
    "ONEUPTIME_URL=https://oneuptime.acme-networks.example",
  );

  const connection: Locator = modal.getByTestId("add-probe-connection");
  await expect(connection).toHaveAttribute("data-connected", "false");
  await expect(connection).toContainText(
    "Waiting for Branch office probe to connect.",
  );
  await expect(page.getByTestId("modal-footer-close-button")).toHaveText(
    "Close",
  );
  await settledDialog(page);
  await screenshot(page, "network-run-probe-waiting");

  // The fixture's probe checks in on the dialog's third look.
  await expect(connection).toHaveAttribute("data-connected", "true", {
    timeout: 30000,
  });
  await expect(connection).toContainText(
    "Branch office probe is connected. Next, bring your devices in.",
  );
  await expect(page.getByTestId("modal-footer-close-button")).toHaveText(
    "Done",
  );
  await screenshot(page, "network-run-probe-connected");

  await page.getByTestId("modal-footer-close-button").click();
  await expect(dialog(page)).toHaveCount(0);

  // The step is ticked and names the probe.
  await expect(
    step(page, "probe").getByTestId("network-first-run-step-done"),
  ).toBeVisible();
  await expect(
    step(page, "probe").getByTestId("network-first-run-probe-status"),
  ).toHaveText("Branch office probe is connected.");
  await expect(page.getByTestId("network-first-run-add-probe")).toHaveCount(0);
  await screenshot(page, "network-first-run-probe-done");
});

test("the dialog links to every other way of running a probe", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "probes=waiting&connectAfter=never");

  await page.getByTestId("network-first-run-run-probe").click();

  const link: Locator = dialog(page).getByTestId("add-probe-other-ways");
  await expect(link).toHaveText(
    "Other ways to run it: Docker Compose, Kubernetes, and through a proxy",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  expect(await link.getAttribute("href")).toMatch(/\/probe\/custom-probe$/);
});

test("a probe added earlier and not running: How to run it opens its command", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "probes=waiting&connectAfter=never");

  await expect(
    step(page, "probe").getByTestId("network-first-run-probe-status"),
  ).toHaveText(
    "Office probe is added. Run it on a computer on your network and this step turns green.",
  );
  await expect(page.getByTestId("network-first-run-add-probe")).toHaveCount(0);

  await page.getByTestId("network-first-run-run-probe").click();
  await expect(dialog(page).getByTestId("modal-title")).toHaveText(
    "Run the probe",
  );
  const state: FixtureState = await fixture(page);
  await expect(dialog(page).getByTestId("add-probe-command")).toContainText(
    `PROBE_ID=${state.probes[0]!._id}`,
  );
  expect(state.creates).toEqual([]);
});

test("someone who may add a probe but not read its key is told who can", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "role=member&connectAfter=never");

  await page.getByTestId("network-first-run-add-probe").click();
  await page.getByTestId("modal-footer-submit-button").click();

  const modal: Locator = dialog(page);
  await expect(modal.getByTestId("add-probe-key-hidden")).toHaveText(
    "Only project owners and admins can see a probe's key. Ask one of them to run Network probe: it is under Monitors → Settings → Probes.",
  );
  await expect(modal.getByTestId("add-probe-command")).toHaveCount(0);

  // The key was never asked for.
  const state: FixtureState = await fixture(page);
  expect(
    state.itemRequests.filter(
      (request: { select: Record<string, unknown> }) => {
        return Boolean(request.select["key"]);
      },
    ),
  ).toEqual([]);
});

test("the second step's choices open their forms", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page);

  await page.getByTestId("network-get-started-discover").click();
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "NETWORK_DEVICE_DISCOVERY",
  );
  await expect(page.getByTestId("stub-page")).toContainText(
    "?open=discover-devices",
  );

  await page.goBack();
  await expect(page.getByTestId("network-first-run-steps")).toBeVisible();
  await page.getByTestId("network-get-started-add").click();
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "NETWORK_DEVICES",
  );
  await expect(page.getByTestId("stub-page")).toContainText("?open=add-device");
});

test("the alerts step: a link until a policy is on, then ticked", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page);

  await step(page, "alerts")
    .getByRole("link", { name: "Set up alerts" })
    .click();
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "NETWORK_DEVICE_SETTINGS_ALERT_POLICIES",
  );

  await openFirstRun(page, "alerts=1&probes=connected");
  await expect(
    step(page, "alerts").getByTestId("network-first-run-alerts-status"),
  ).toHaveText("Alerts are on.");
  await expect(
    step(page, "probe").getByTestId("network-first-run-step-done"),
  ).toBeVisible();
  await expect(
    step(page, "alerts").getByTestId("network-first-run-step-done"),
  ).toBeVisible();
  await screenshot(page, "network-first-run-done");
});

test("a self-hosted server's own probe is mentioned, and the step still offers one of the network's own", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "server=1");

  await expect(
    step(page, "probe").getByTestId("network-first-run-server-probe"),
  ).toHaveText(
    "This OneUptime server runs a probe of its own too. It can check your devices if this server can reach them.",
  );
  await expect(page.getByTestId("network-first-run-add-probe")).toBeVisible();
});

test("opened to add a probe from a device's probe field: the dialog opens, and the address forgets it", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "open=add-probe&devices=4&probes=connected");

  await expect(dialog(page).getByTestId("modal-title")).toHaveText(
    "Add a probe",
  );
  // The suggested name, while no probe of the project's has it.
  await expect(
    dialog(page).getByPlaceholder("London office probe"),
  ).toHaveValue("Network probe");
  await expect
    .poll((): string => {
      return new URL(page.url()).search;
    })
    .not.toContain("open=add-probe");
  await expect(page.getByTestId("network-health-hero")).toBeVisible();
});

/*
 * ---------------------------------------------------------------------------
 * Every width, both themes, another language
 * ---------------------------------------------------------------------------
 */

test("the path and the dialog fit a phone", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstRun(page, "connectAfter=never");

  expect(await scrollsSideways(page)).toBe(false);
  await expect(page.getByTestId("network-first-run-add-probe")).toBeVisible();
  await screenshot(page, "network-first-run-phone");

  await page.getByTestId("network-first-run-add-probe").click();
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(dialog(page).getByTestId("add-probe-command")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  // The command scrolls inside its own box, never the page.
  const box: { width: number } | null = await dialog(page)
    .getByTestId("add-probe-command")
    .boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await settledDialog(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "network-run-probe-phone.png"),
  });
});

test("every word of the path can be read, in the light theme and the dark", async ({
  page,
}: {
  page: Page;
}) => {
  for (const theme of ["light", "dark"]) {
    await openFirstRun(
      page,
      `probes=waiting&connectAfter=never${theme === "dark" ? "&theme=dark" : ""}`,
    );

    for (const heading of await page
      .getByTestId("network-first-run-steps")
      .locator("h3")
      .all()) {
      await expectReadable(heading);
    }
    await expectReadable(
      step(page, "probe").getByText("A probe is a small program", {
        exact: false,
      }),
    );
    await expectReadable(
      step(page, "probe").getByText("Office probe is added.", {
        exact: false,
      }),
    );
    await expectReadable(step(page, "alerts").getByRole("link"));
    await expectReadable(
      step(page, "devices").getByText("Every device is pinged by its probe", {
        exact: false,
      }),
    );

    await screenshot(page, `network-first-run-${theme}`);

    await page.getByTestId("network-first-run-run-probe").click();
    await settledDialog(page);
    await expectReadable(
      dialog(page).getByText("Run this on a computer inside your network", {
        exact: false,
      }),
    );
    await expectReadable(dialog(page).getByTestId("add-probe-other-ways"));
    await expectReadable(
      dialog(page).getByText("Waiting for Office probe to connect.", {
        exact: false,
      }),
    );
    await page.screenshot({
      path: path.join(SCREENSHOTS, `network-run-probe-${theme}.png`),
    });
  }
});

test("German readers get the path in German", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "lang=de");

  await expect(step(page, "probe")).toContainText(
    "Eine Sonde in Ihrem Netzwerk einrichten",
  );
  await expect(step(page, "devices")).toContainText("Ihre Geräte einbinden");
  await expect(step(page, "alerts")).toContainText(
    "Benachrichtigt werden, wenn ein Gerät ausfällt",
  );

  await page.getByTestId("network-first-run-add-probe").click();
  // The suggested name is the reader's, since it is the name they keep.
  await expect(dialog(page).getByPlaceholder("Sonde Büro London")).toHaveValue(
    "Netzwerk-Sonde",
  );
  await screenshot(page, "network-first-run-de");
});
