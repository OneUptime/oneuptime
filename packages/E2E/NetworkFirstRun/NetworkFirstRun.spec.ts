import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  CARD_GRID_GAP_IN_PX,
  getCardGridColumnsAt,
} from "Common/UI/Components/Card/CardGridLayout";
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

  /*
   * With no command in front of them, nothing asks them to run one: the
   * step says where the probe has to run, for whoever runs it, and the
   * waiting line asks for nothing.
   */
  await expect(
    modal.getByText(
      "Network probe has to run on a computer inside your network that can reach your devices, such as a server or a virtual machine with Docker.",
    ),
  ).toBeVisible();
  await expect(modal.getByTestId("add-probe-connection")).toHaveText(
    "Waiting for Network probe to connect. This checks every few seconds and turns green once it is running.",
  );
  await expect(modal.getByTestId("add-probe-run-step")).not.toContainText(
    "Run this on a computer",
  );
  await expect(modal.getByTestId("add-probe-run-step")).not.toContainText(
    "run the command",
  );
  await settledDialog(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "network-run-probe-without-key.png"),
  });

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

/*
 * Each step's number (or tick) sits on the first line of its title: a 32px
 * circle beside a 24px line used to hang 4px below the title's middle. On a
 * phone a long title wraps, and the marker stays on its first line.
 */
test("each step's marker sits on its title's first line, on a desktop and a phone", async ({
  page,
}: {
  page: Page;
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width: width, height: 900 });
    await openFirstRun(page, "probes=connected&connectAfter=never");

    for (const name of ["probe", "devices", "alerts"] as const) {
      const offset: number = await step(page, name).evaluate(
        (item: Element): number => {
          const marker: Element = item.firstElementChild as Element;
          const title: Element = item.querySelector("h3") as Element;
          const markerBox: DOMRect = marker.getBoundingClientRect();
          const titleBox: DOMRect = title.getBoundingClientRect();
          const lineHeight: number = parseFloat(
            getComputedStyle(title).lineHeight,
          );

          return Math.abs(
            markerBox.top +
              markerBox.height / 2 -
              (titleBox.top + lineHeight / 2),
          );
        },
      );

      expect({ width, name, offset: offset <= 1 }).toEqual({
        width,
        name,
        offset: true,
      });
    }
  }
});

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

/*
 * ---------------------------------------------------------------------------
 * OneUptime Cloud, below the plan a probe needs
 * ---------------------------------------------------------------------------
 *
 * The server refuses to add a probe below Growth. A project on the free plan
 * was offered "Add a probe", named it, and was refused - a dead end at step
 * one. The step and the dialog now name the plan and lead to Billing.
 */

const PLAN_SENTENCE: string =
  "Adding a probe needs the Growth plan. Until then, OneUptime's probes on the internet can check devices with a public address.";

function planNote(page: Page): Locator {
  return step(page, "probe").getByTestId("network-first-run-probe-plan");
}

test("on the free plan, the probe step names the plan and links to Billing instead of offering a probe", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "plan=free");

  await expect(planNote(page)).toContainText(PLAN_SENTENCE);
  await expect(page.getByTestId("network-first-run-add-probe")).toHaveCount(0);
  // The step still says what a probe is, and step 2 still works.
  await expect(step(page, "probe")).toContainText(
    "a probe on the internet cannot reach private addresses like 10.0.0.1",
  );
  await expect(page.getByTestId("network-get-started-discover")).toBeVisible();
  await expect(page.getByTestId("network-get-started-add")).toBeVisible();

  await expectReadable(planNote(page).getByText("Adding a probe needs"));
  await expectReadable(planNote(page).getByRole("link"));
  await screenshot(page, "network-first-run-free-plan");

  await planNote(page)
    .getByRole("link", { name: "Upgrade your plan in Billing settings" })
    .click();
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "SETTINGS_BILLING",
  );
  await expect(page.getByTestId("stub-page")).toHaveText(
    `/dashboard/${PROJECT_ID}/settings/billing`,
  );
  expect((await fixture(page)).creates).toEqual([]);
});

test("on the free plan, a probe field's Add a probe link opens the dialog on the plan, not on a name", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "plan=free&open=add-probe&devices=4");

  const modal: Locator = dialog(page);
  await expect(modal.getByTestId("modal-title")).toHaveText("Add a probe");
  await expect(modal.getByTestId("add-probe-plan-needed")).toHaveText(
    PLAN_SENTENCE,
  );
  await expect(modal.getByPlaceholder("London office probe")).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-close-button")).toHaveText(
    "Cancel",
  );
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "Upgrade plan",
  );
  await expectReadable(modal.getByTestId("add-probe-plan-needed"));
  await settledDialog(page);
  await screenshot(page, "network-add-probe-free-plan");

  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "SETTINGS_BILLING",
  );

  // Nothing was added, and no probe names were read for a name not asked.
  const state: FixtureState = await fixture(page);
  expect(state.creates).toEqual([]);
  expect(
    state.listRequests.filter((request: Record<string, unknown>) => {
      return request["modelName"] === "Probe";
    }),
  ).toEqual([]);
});

test("on the free plan, a probe added on a trial can still be run", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "plan=free&probes=waiting&connectAfter=never");

  await expect(planNote(page)).toHaveCount(0);
  await page.getByTestId("network-first-run-run-probe").click();
  await expect(dialog(page).getByTestId("modal-title")).toHaveText(
    "Run the probe",
  );
  await expect(dialog(page).getByTestId("add-probe-command")).toBeVisible();
});

test("on the Growth plan, the probe is offered as on any server", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "plan=growth");

  await expect(planNote(page)).toHaveCount(0);
  await page.getByTestId("network-first-run-add-probe").click();
  await expect(
    dialog(page).getByPlaceholder("London office probe"),
  ).toHaveValue("Network probe");
});

test("the plan note fits a phone and reads in the dark theme", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstRun(page, "plan=free&theme=dark");

  await expect(planNote(page)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectReadable(planNote(page).getByText("Adding a probe needs"));
  await expectReadable(planNote(page).getByRole("link"));
  await screenshot(page, "network-first-run-free-plan-phone-dark");

  await open(page, "plan=free&open=add-probe&theme=dark");
  await expectReadable(dialog(page).getByTestId("add-probe-plan-needed"));
  expect(await scrollsSideways(page)).toBe(false);
  await settledDialog(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "network-add-probe-free-plan-phone-dark.png"),
  });
});

test("German readers on the free plan read the plan in German", async ({
  page,
}: {
  page: Page;
}) => {
  await openFirstRun(page, "plan=free&lang=de");

  await expect(planNote(page)).toContainText(
    "Zum Hinzufügen einer Sonde brauchen Sie den Growth-Tarif.",
  );
  await expect(planNote(page).getByRole("link")).toHaveText(
    "Tarif in den Abrechnungseinstellungen upgraden",
  );
});

/*
 * ---------------------------------------------------------------------------
 * A network with devices: the Overview's rows of cards
 * ---------------------------------------------------------------------------
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of
 * cards of different heights side by side. The Overview's four lists - the
 * devices and the sites needing attention, the fleet by vendor and the recent
 * scans - are a CardGrid: two by two where the page has the room, each row
 * ending on one line however long either list is, and a list with nothing in
 * it saying so in the middle of its card.
 */
interface NetworkOverviewCell {
  title: string;
  top: number;
  left: number;
  right: number;
  bottom: number;
  // Where the card's own frame - its border - ends.
  frameBottom: number;
}

test("a busy network's four lists end on one line two by two, and one above the other where there is no room, light and dark", async ({
  page,
}: {
  page: Page;
}) => {
  const ACROSS: Record<number, number> = {
    1440: 2,
    1280: 2,
    1024: 1,
    768: 1,
    390: 1,
  };
  const TITLES: Array<string> = [
    "Devices needing attention",
    "Sites needing attention",
    "Fleet by vendor",
    "Recent discovery scans",
  ];

  for (const width of [1440, 1280, 1024, 768, 390]) {
    for (const theme of ["", "&theme=dark"]) {
      await page.setViewportSize({ width: width, height: 900 });
      await open(page, `devices=6&probes=connected&lists=busy${theme}`);
      await expect(page.getByText("core-switch-01")).toBeVisible();
      await expect(
        page.getByText(
          "No scans yet. Scan a subnet to find the devices on it, then pick the ones to add.",
        ),
      ).toBeVisible();

      const label: string = `${width}px${theme}`;
      const rows: {
        left: number;
        right: number;
        cells: Array<NetworkOverviewCell>;
      } = await page
        .getByTestId("network-overview-cards")
        .evaluate((container: Element) => {
          const grid: Element = container.firstElementChild as Element;
          const box: DOMRect = grid.getBoundingClientRect();

          return {
            left: box.left,
            right: box.right,
            cells: Array.from(grid.children).map((cell: Element) => {
              const cellBox: DOMRect = cell.getBoundingClientRect();
              const frame: Element = cell.querySelector(
                '[data-testid="card"] > div',
              ) as Element;

              return {
                title: (
                  cell.querySelector('[data-testid="card-details-heading"]')
                    ?.textContent || ""
                ).trim(),
                top: Math.round(cellBox.top),
                left: Math.round(cellBox.left),
                right: Math.round(cellBox.right),
                bottom: Math.round(cellBox.bottom),
                frameBottom: Math.round(frame.getBoundingClientRect().bottom),
              };
            }),
          };
        });

      expect([
        label,
        rows.cells.map((cell: NetworkOverviewCell): string => {
          return cell.title;
        }),
      ]).toEqual([label, TITLES]);
      expect([
        label,
        getCardGridColumnsAt(
          { columns: 2, cardWidth: "wide" },
          rows.right - rows.left,
        ),
      ]).toEqual([label, ACROSS[width]]);

      const across: number = ACROSS[width]!;

      for (let index: number = 0; index < rows.cells.length; index += across) {
        const line: Array<NetworkOverviewCell> = rows.cells.slice(
          index,
          index + across,
        );
        const bottom: number = Math.max(
          ...line.map((cell: NetworkOverviewCell): number => {
            return cell.bottom;
          }),
        );

        for (const cell of line) {
          // On one line, each card's frame to the row's bottom.
          expect([
            label,
            cell.title,
            cell.top - line[0]!.top,
            bottom - cell.frameBottom,
          ]).toEqual([label, cell.title, 0, 0]);
        }
        // From the grid's left edge to its right, the grid's 20px between.
        expect([
          label,
          line[0]!.left - Math.round(rows.left),
          Math.round(rows.right) - line[line.length - 1]!.right,
          line.length > 1
            ? line[1]!.left - line[0]!.right
            : CARD_GRID_GAP_IN_PX,
        ]).toEqual([label, 0, 0, CARD_GRID_GAP_IN_PX]);
        // And 20px under the row above.
        if (index > 0) {
          const above: number = Math.max(
            ...rows.cells
              .slice(index - across, index)
              .map((cell: NetworkOverviewCell): number => {
                return cell.bottom;
              }),
          );
          expect([label, line[0]!.top - above]).toEqual([
            label,
            CARD_GRID_GAP_IN_PX,
          ]);
        }
      }

      expect(await scrollsSideways(page)).toBe(false);
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "devices=6&probes=connected&lists=busy");
  await expect(page.getByText("core-switch-01")).toBeVisible();
  // A list with nothing in it says so in the middle of its card.
  const scans: Locator = page.getByTestId("card").filter({
    has: page.getByRole("heading", {
      name: "Recent discovery scans",
      exact: true,
    }),
  });
  const card: { y: number; height: number } | null = await scans.boundingBox();
  const header: { y: number; height: number } | null = await scans
    .getByTestId("card-header")
    .boundingBox();
  const words: { y: number; height: number } | null = await scans
    .getByText(
      "No scans yet. Scan a subnet to find the devices on it, then pick the ones to add.",
    )
    .boundingBox();
  const room: number =
    (header!.y + header!.height + card!.y + card!.height) / 2;
  expect(Math.abs(words!.y + words!.height / 2 - room)).toBeLessThanOrEqual(24);
  await screenshot(page, "network-overview-busy");
});
