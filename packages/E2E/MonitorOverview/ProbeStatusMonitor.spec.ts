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
 * THE PROBE STATUS MONITOR, IN A REAL BROWSER.
 *
 * Issue #2733 (and #2486 before it): when a probe goes offline, the only
 * signal was a message about each monitor it runs, and nothing could open an
 * incident or page on-call for the outage itself. A Probe Status monitor
 * watches probes; it goes offline, and opens one incident, when one of them
 * disconnects.
 *
 * The production pages (Create Monitor, the monitor overview, Monitoring
 * Logs) against the offline fixture (Fixture/Fixture.js): ?type=probe-status
 * is a monitor watching Frankfurt and Singapore; ?probes= picks which probes
 * the project has. The same guards as the other specs here: a network
 * fence, no uncaught page errors, and no request the fixture does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const CREATE_PATH: string = `${DASHBOARD}/monitors/create`;
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
const MONITOR_ID: string = "70000000-0000-4000-8000-000000000010";
const MONITOR_PATH: string = `${DASHBOARD}/monitors/${MONITOR_ID}`;

interface FixtureProbe {
  id: string;
  name: string;
}

// The fixture's probes (Fixture.js PROBE_DEFINITIONS and GLOBAL_PROBE).
const PROBES: {
  frankfurt: FixtureProbe;
  virginia: FixtureProbe;
  singapore: FixtureProbe;
  selfHosted: FixtureProbe;
} = {
  frankfurt: {
    id: "73000000-0000-4000-8000-000000000001",
    name: "Frankfurt (eu-central-1)",
  },
  virginia: {
    id: "73000000-0000-4000-8000-000000000002",
    name: "N. Virginia (us-east-1)",
  },
  singapore: {
    id: "73000000-0000-4000-8000-000000000003",
    name: "Singapore (ap-southeast-1)",
  },
  selfHosted: {
    id: "73000000-0000-4000-8000-000000000004",
    name: "Self-hosted probe",
  },
};

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function card(scope: Page | Locator, heading: string): Locator {
  const root: Page =
    "page" in scope && typeof scope.page === "function"
      ? (scope as Locator).page()
      : (scope as Page);
  return scope.getByTestId("card").filter({
    has: root.getByRole("heading", { level: 2, name: heading, exact: true }),
  });
}

function hero(page: Page): Locator {
  return page.getByTestId("monitor-overview-hero");
}

async function factValue(page: Page, label: string): Promise<string> {
  const pairs: Array<{ label: string; value: string }> = await hero(page)
    .locator("dl > div")
    .evaluateAll(
      (items: Array<Element>): Array<{ label: string; value: string }> => {
        return items.map((item: Element): { label: string; value: string } => {
          return {
            label: (item.querySelector("dt")?.textContent || "").trim(),
            value: (item.querySelector("dd")?.textContent || "").trim(),
          };
        });
      },
    );
  return (
    pairs.find((pair: { label: string; value: string }): boolean => {
      return pair.label === label;
    })?.value || ""
  );
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${MONITOR_PATH}?type=probe-status${query}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Monitor - Probe health",
    { timeout: 30000 },
  );
  await expect(hero(page)).toBeVisible({ timeout: 30000 });
}

function summary(page: Page): Locator {
  return page.getByTestId("probe-status-monitor-summary");
}

function probeRows(scope: Page | Locator): Locator {
  return scope.getByTestId("probe-status-monitor-probe-row");
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow, "the page does not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("a Probe Status monitor's overview", () => {
  test("every probe connected: Operational, its latest result, what it watches, evaluated every minute", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
    await expect
      .poll(() => {
        return factValue(page, "Latest result");
      })
      .toBe("2 of 2 connected");
    expect(await factValue(page, "Watches")).toBe("2 probes");
    // The pulse says "Every minute"; no fact says it again.
    expect(await factValue(page, "Evaluates")).toBe("");
    await expect(
      hero(page).getByRole("link", { name: "2 probes" }),
    ).toHaveAttribute("href", `${MONITOR_PATH}/criteria`);
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last evaluated",
    );
    await expect(page.getByTestId("monitor-overview-cadence")).toHaveText(
      "Every minute",
    );

    // Not a probe-run monitor: no probes card and no response time.
    await expect(card(page, "Probes")).toHaveCount(0);
    await expect(card(page, "Response time")).toHaveCount(0);

    const summaryCard: Locator = card(page, "Monitor Summary");
    await expect(summaryCard).toContainText(
      "Each probe this monitor watches, as the latest evaluation found it.",
    );
    await expect(summary(page)).toBeVisible({ timeout: 30000 });
    // No count tiles: the Evaluation Logs under the list count the probes.
    await expect(summary(page)).not.toContainText("Checked At");
    await expect(probeRows(page)).toHaveCount(2);
    await expect(probeRows(page).nth(0)).toContainText(PROBES.frankfurt!.name);
    await expect(probeRows(page).nth(1)).toContainText(PROBES.singapore!.name);
    for (const row of await probeRows(page).all()) {
      await expect(row).toContainText("Connected");
      // Connected is a heartbeat in the last three minutes: no time to add.
      await expect(
        row.getByTestId("probe-status-monitor-probe-detail"),
      ).toHaveCount(0);
    }

    // The evaluation that decided it, under the probes.
    await expect(summaryCard).toContainText(
      "Check if every probe is connected",
    );

    await screenshot(page, "probe-status-overview-operational");
  });

  test("a probe disconnected: Offline, that probe first, and the incident it opened", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&state=offline");

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Offline",
    );
    // The hero names the probe that is down.
    await expect
      .poll(() => {
        return factValue(page, "Latest result");
      })
      .toBe(`1 of 2 disconnected${PROBES.singapore!.name}`);
    // In the danger tone (text-red-700).
    await expect(
      page.getByTestId("monitor-overview-fact-latest-result").locator("dd"),
    ).toHaveCSS("color", "rgb(185, 28, 28)");

    // Disconnected first: it is why anyone is looking.
    const first: Locator = probeRows(page).nth(0);
    await expect(first).toContainText(PROBES.singapore!.name);
    await expect(first).toContainText("Disconnected");
    /*
     * Silent since 11:45, evaluated at 11:59: measured to the evaluation,
     * as an incident's stored summary is.
     */
    await expect(
      first.getByTestId("probe-status-monitor-probe-detail"),
    ).toHaveText("No heartbeat for 14 minutes");
    await expect(probeRows(page).nth(1)).toContainText(PROBES.frankfurt!.name);
    await expect(probeRows(page).nth(1)).toContainText("Connected");

    await expect(card(page, "Monitor Summary")).toContainText(
      "Check if a probe is disconnected",
    );
    await expect(
      page.getByText("Probe disconnected: Singapore (ap-southeast-1)").first(),
    ).toBeVisible({
      timeout: 30000,
    });

    await screenshot(page, "probe-status-overview-offline");
  });

  test("before its first evaluation: says it is waiting, and how often it runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&state=awaiting");

    await expect(page.getByTestId("monitor-overview-headline")).toHaveText(
      "Waiting for the first evaluation",
    );
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "This monitor checks the probes it watches every minute. The first result arrives within a minute or two.",
    );
    expect(await factValue(page, "Latest result")).toBe("—No results yet");
    // The hero says when the first result comes; no empty card says it again.
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
  });

  test("watching no probes: Not set up, and Pick probes leads to its criteria", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&state=no-probes");

    await expect(hero(page)).toContainText("Not set up");
    await expect(page.getByTestId("monitor-overview-headline")).toHaveText(
      "This monitor watches no probes",
    );
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "Pick the probes it watches. It opens an incident when one of them disconnects.",
    );
    expect(await factValue(page, "Watches")).toBe("No probes picked");
    // Nothing is evaluated: there is no latest result to give.
    expect(await factValue(page, "Latest result")).toBe("");
    // Nothing was evaluated, and there is nothing to summarise.
    await expect(summary(page)).toHaveCount(0);
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
    await screenshot(page, "probe-status-overview-not-set-up");

    await hero(page).getByRole("link", { name: "Pick probes" }).click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "MONITOR_VIEW_CRITERIA",
    );
  });

  test("fits a phone, and dark mode keeps the probes on a dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openOverview(page, "&state=offline");
    await expect(probeRows(page)).toHaveCount(2, { timeout: 30000 });
    await noSidewaysScroll(page);
    await screenshot(page, "probe-status-overview-phone");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await openOverview(page, "&state=offline&theme=dark");
    await expect(probeRows(page)).toHaveCount(2, { timeout: 30000 });
    // The probe's name is light on the dark card, not gray-900 ink.
    const nameColor: string = await probeRows(page)
      .nth(0)
      .locator("span")
      .first()
      .evaluate((element: Element): string => {
        return window.getComputedStyle(element).color;
      });
    expect(nameColor, "the probe's name is readable in dark mode").not.toBe(
      "rgb(17, 24, 39)",
    );
    await screenshot(page, "probe-status-overview-dark");
  });
});

test.describe("its Monitoring Logs", () => {
  test("View Summary lists the probes that evaluation found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.clock.setFixedTime(NOW);
    await page.goto(`${MONITOR_PATH}/logs?type=probe-status&state=offline`);
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });
    const logs: Locator = card(page, "Monitor Logs");
    await expect(logs).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("row-actions").first()).toBeVisible({
      timeout: 30000,
    });

    await logs.getByText("View Summary").first().click();
    const modal: Locator = page.getByRole("dialog");
    await expect(
      modal.getByTestId("probe-status-monitor-summary"),
    ).toBeVisible();
    await expect(probeRows(modal).nth(0)).toContainText(PROBES.singapore!.name);
    await expect(probeRows(modal).nth(0)).toContainText("Disconnected");
    await screenshot(page, "probe-status-logs-summary");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Create Monitor
 * ---------------------------------------------------------------------------
 */

async function openCreate(page: Page, query: string = ""): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}${query}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });
  return form;
}

function nameInput(form: Locator): Locator {
  return form.locator("input[placeholder='Monitor Name']");
}

async function pickProbeStatus(page: Page, form: Locator): Promise<void> {
  await expect(page.getByTestId("card-select-more")).toBeVisible({
    timeout: 30000,
  });
  await page.getByTestId("card-select-more").click();
  await page.getByTestId("card-select-option-Probe Status").click();
  await expect(page.getByTestId("card-select-summary")).toContainText(
    "Probe Status",
  );
  await expect(nameInput(form)).toBeVisible();
}

// The step's own card, nested inside Create Monitor's card.
function probesHeading(page: Page): Locator {
  return page.getByRole("heading", {
    level: 2,
    name: "Probes to Watch",
    exact: true,
  });
}

function probesPicker(page: Page): Locator {
  return page.getByTestId("probe-status-monitor-step-form");
}

async function pickedProbes(page: Page): Promise<Array<string>> {
  return (
    await probesPicker(page)
      .locator(".ou-select__multi-value__label")
      .allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
}

async function createsRecorded(page: Page): Promise<Array<RecordedCreate>> {
  return page.evaluate((): Array<RecordedCreate> => {
    const state: { creates?: Array<RecordedCreate> } | undefined = (
      window as unknown as {
        __monitorOverviewFixture?: { creates?: Array<RecordedCreate> };
      }
    ).__monitorOverviewFixture;
    return JSON.parse(
      JSON.stringify(state?.creates || []),
    ) as Array<RecordedCreate>;
  });
}

test.describe("Create Monitor: Probe Status", () => {
  test("found by searching for probe, under Other", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    await page.getByTestId("card-select-search").click();
    await page.keyboard.type("probe offline");
    await expect(
      page.getByTestId("card-select-option-Probe Status"),
    ).toBeVisible();

    await page.getByTestId("card-select-search").fill("");
    await page.getByTestId("card-select-more").click();
    const moreOptions: Locator = page.getByTestId("card-select-more-options");
    await expect(
      moreOptions.getByTestId("card-select-option-Probe Status"),
    ).toContainText(
      "Alert when a probe disconnects - one incident per outage, resolved when it reconnects.",
    );
  });

  test("starts watching the project's own probes; Create sends them, with no interval", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page);
    await pickProbeStatus(page, form);
    await nameInput(form).fill("Probe health");

    // Evaluated by OneUptime every minute: no Probes & Interval step.
    await form.getByRole("button", { name: "Next", exact: true }).click();

    await expect(probesHeading(page)).toBeVisible({
      timeout: 60000,
    });
    await expect
      .poll(() => {
        return pickedProbes(page);
      })
      .toEqual([
        PROBES.frankfurt!.name,
        PROBES.virginia!.name,
        PROBES.singapore!.name,
      ]);

    /*
     * One description says what happens and after how long; the picker is
     * the card's only field, named for screen readers, with no second label.
     */
    // The step's own card: the last of the cards that hold its heading.
    await expect(card(page, "Probes to Watch").last()).toContainText(
      "Opens one incident when one of these probes goes three minutes without a heartbeat. It resolves itself when the probe is back.",
    );
    await expect(probesPicker(page).locator("label")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Probes to watch" }),
    ).toBeVisible();

    // The default criteria, folded: a probe down opens the incident.
    const headers: Locator = page.getByTestId("monitor-criteria-header");
    await expect(headers).toHaveCount(2, { timeout: 30000 });
    await expect(headers.nth(0)).toContainText(
      "Check if a probe is disconnected",
    );
    await expect(headers.nth(1)).toContainText(
      "Check if every probe is connected",
    );

    await screenshot(page, "probe-status-create-criteria");

    // Drop one probe: only the two left are sent.
    await probesPicker(page)
      .getByRole("button", { name: `Remove ${PROBES.virginia!.name}` })
      .click();
    await expect
      .poll(() => {
        return pickedProbes(page);
      })
      .toEqual([PROBES.frankfurt!.name, PROBES.singapore!.name]);

    await expect(
      form.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);
    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `${DASHBOARD}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Probe Status");
    expect(creates[0]!.data["name"]).toBe("Probe health");
    expect(creates[0]!.data["monitoringInterval"]).toBeUndefined();

    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain(
      `"probeStatusMonitor":{"probeIds":["${PROBES.frankfurt!.id}","${PROBES.singapore!.id}"]}`,
    );
    expect(steps).toContain('"checkOn":"Disconnected Probes"');
  });

  test("a self-hosted install with no probe of its own starts on its global probe", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page, "?probes=self-hosted");
    await pickProbeStatus(page, form);
    await nameInput(form).fill("Bundled probe");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    await expect(probesHeading(page)).toBeVisible({
      timeout: 60000,
    });
    await expect
      .poll(() => {
        return pickedProbes(page);
      })
      .toEqual([PROBES.selfHosted!.name]);
  });

  test("on OneUptime Cloud, a project with no probe of its own picks none, and saving says to pick one", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(
      page,
      "?probes=self-hosted&billing=true",
    );
    await pickProbeStatus(page, form);
    await nameInput(form).fill("Cloud probes");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    await expect(probesHeading(page)).toBeVisible({
      timeout: 60000,
    });
    // Loaded, with the global probe offered but not picked.
    await page.getByRole("combobox", { name: "Probes to watch" }).click();
    await expect(
      page.getByRole("option", { name: PROBES.selfHosted!.name, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await pickedProbes(page)).toEqual([]);

    await page.getByTestId("Create Monitor").click();
    await expect(
      form.getByText("Pick at least one probe to watch"),
    ).toBeVisible();
    expect(await createsRecorded(page)).toHaveLength(0);
  });

  test("Monitor this probe: the link watches that probe alone, named after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(
      page,
      `?monitorType=${encodeURIComponent("Probe Status")}&watchProbeId=${PROBES.singapore!.id}`,
    );

    await expect(page.getByTestId("card-select-summary")).toContainText(
      "Probe Status",
      { timeout: 30000 },
    );
    await expect(nameInput(form)).toHaveValue(
      "Singapore (ap-southeast-1) status",
    );

    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(probesHeading(page)).toBeVisible({
      timeout: 60000,
    });
    await expect
      .poll(() => {
        return pickedProbes(page);
      })
      .toEqual([PROBES.singapore!.name]);
  });

  test("the probes step fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const form: Locator = await openCreate(page);
    await pickProbeStatus(page, form);
    await nameInput(form).fill("Probe health");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(probesHeading(page)).toBeVisible({
      timeout: 60000,
    });
    await expect
      .poll(() => {
        return pickedProbes(page);
      })
      .toHaveLength(3);
    await noSidewaysScroll(page);
    await screenshot(page, "probe-status-create-phone");
  });
});
