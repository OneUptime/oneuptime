import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  Response,
  expect,
  test,
} from "@playwright/test";

/*
 * "The two dots below should be auto-turned on when the 'Fix new alerts
 * automatically' is turned on, and it should actually be a child of 'Fix
 * new alerts automatically'. Can you please do this for incidents as
 * well?" - the maintainer.
 *
 * Against a real stack, on Alerts → AI → Settings and Incidents → AI →
 * Settings:
 *
 *  - a new project starts with fixing off, and the two pull-request
 *    switches are not offered under it;
 *  - turning fixing on is ONE request that turns it and both pull requests
 *    on, and they appear under it, on, in a group named for it; reloaded,
 *    they are still there;
 *  - while fixing is on, one pull request is turned off on its own;
 *  - turning fixing off turns all three off, and the pull requests go;
 *    turning it on again brings both back on;
 *  - the incident page nests its own two the same way, before the
 *    postmortem, and leaves the alert switches alone;
 *  - the server stores what an API write sets: a pull request left on
 *    under fixing that is off is kept, and the page does not offer it.
 *
 * Nothing here needs an LLM provider: no investigation runs. Whether a pull
 * request then opens is the server's rule, covered by the Common suites
 * (FixFromIncidentAutoTrigger, InstrumentationTaskTrigger,
 * AutomaticFixSwitches).
 *
 * One project for the whole file, in order.
 */

test.describe.configure({ mode: "serial" });

const urlFor: (path: string) => string = (path: string): string => {
  return `${BASE_URL.toString().replace(/\/$/, "")}${path}`;
};

const SERVER: { timeout: number } = { timeout: 30000 };

interface Lane {
  name: "incidents" | "alerts";
  fixTitle: string;
  fix: string;
  codeFix: string;
  telemetry: string;
}

const ALERTS: Lane = {
  name: "alerts",
  fixTitle: "Fix new alerts automatically",
  fix: "enableAutomaticAlertRemediation",
  codeFix: "enableAutomaticAlertCodeFixes",
  telemetry: "enableAlertInstrumentationFixTasks",
};

const INCIDENTS: Lane = {
  name: "incidents",
  fixTitle: "Fix new incidents automatically",
  fix: "enableAutomaticIncidentRemediation",
  codeFix: "enableAutomaticIncidentCodeFixes",
  telemetry: "enableIncidentInstrumentationFixTasks",
};

const CODE_FIX_TITLE: string =
  "Open a fix pull request when an investigation finds a code change";
const TELEMETRY_TITLE: string =
  "Open a pull request that adds missing telemetry";

const switchTestId: (column: string) => string = (column: string): string => {
  return `ai-switch-${column}`;
};

test.describe("Fix new alerts/incidents automatically: its pull requests are part of it", () => {
  let page: Page;
  let projectId: string = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E fix switch children",
    });
  });

  test.afterAll(async () => {
    try {
      if (projectId) {
        await page.request.delete(urlFor(`/api/project/${projectId}`), {
          headers: { tenantid: projectId },
        });
      }
    } finally {
      await page?.close();
    }
  });

  const openLane: (lane: Lane) => Promise<void> = async (
    lane: Lane,
  ): Promise<void> => {
    await gotoProjectPage({
      page,
      projectId,
      url: urlFor(`/dashboard/${projectId}/${lane.name}/ai/settings`),
      ready: page.getByTestId(switchTestId(lane.fix)),
    });
  };

  const fixSwitch: (lane: Lane) => Locator = (lane: Lane): Locator => {
    return page.getByTestId(switchTestId(lane.fix));
  };

  const childrenOf: (lane: Lane) => Locator = (lane: Lane): Locator => {
    return page.getByTestId(`${switchTestId(lane.fix)}-children`);
  };

  // The three columns, as the server holds them.
  const stored: (lane: Lane) => Promise<Record<string, unknown>> = async (
    lane: Lane,
  ): Promise<Record<string, unknown>> => {
    const response: APIResponse = await page.request.post(
      urlFor(`/api/project/${projectId}/get-item`),
      {
        headers: { tenantid: projectId },
        data: {
          select: {
            [lane.fix]: true,
            [lane.codeFix]: true,
            [lane.telemetry]: true,
          },
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);

    const project: Record<string, unknown> = (await response.json()) as Record<
      string,
      unknown
    >;

    return {
      [lane.fix]: project[lane.fix] ?? false,
      [lane.codeFix]: project[lane.codeFix] ?? false,
      [lane.telemetry]: project[lane.telemetry] ?? false,
    };
  };

  const allThree: (lane: Lane, isOn: boolean) => Record<string, boolean> = (
    lane: Lane,
    isOn: boolean,
  ): Record<string, boolean> => {
    return { [lane.fix]: isOn, [lane.codeFix]: isOn, [lane.telemetry]: isOn };
  };

  /*
   * Presses a switch and waits for its save: the one PUT of the project
   * it sends, handed back as the columns it wrote.
   */
  const pressAndSave: (
    control: Locator,
  ) => Promise<Record<string, unknown>> = async (
    control: Locator,
  ): Promise<Record<string, unknown>> => {
    const save: Promise<Response> = page.waitForResponse(
      (response: Response): boolean => {
        return (
          response.url().includes(`/api/project/${projectId}`) &&
          response.request().method() === "PUT"
        );
      },
      SERVER,
    );

    await control.click();

    const response: Response = await save;
    expect(response.ok(), await response.text()).toBe(true);

    return (
      (response.request().postDataJSON() as { data: Record<string, unknown> })
        .data || {}
    );
  };

  test("a new project starts with fixing off, and offers no pull-request switch under it", async () => {
    await openLane(ALERTS);

    await expect(fixSwitch(ALERTS)).toHaveAttribute("aria-checked", "false");
    await expect(childrenOf(ALERTS)).toHaveCount(0);
    await expect(page.getByTestId(switchTestId(ALERTS.codeFix))).toHaveCount(0);
    await expect(page.getByTestId(switchTestId(ALERTS.telemetry))).toHaveCount(
      0,
    );

    expect(await stored(ALERTS)).toEqual(allThree(ALERTS, false));
  });

  test("turning fixing on is one save that turns both pull requests on, and they appear under it", async () => {
    await openLane(ALERTS);

    const written: Record<string, unknown> = await pressAndSave(
      fixSwitch(ALERTS),
    );

    expect(written).toEqual(allThree(ALERTS, true));

    await expect(
      page.getByTestId(`${switchTestId(ALERTS.fix)}-status`),
    ).toContainText("Saved");

    const group: Locator = page.getByRole("group", { name: ALERTS.fixTitle });
    await expect(group).toBeVisible();
    await expect(group.getByRole("switch")).toHaveCount(2);
    await expect(
      group.getByRole("switch", { name: CODE_FIX_TITLE, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      group.getByRole("switch", { name: TELEMETRY_TITLE, exact: true }),
    ).toHaveAttribute("aria-checked", "true");

    expect(await stored(ALERTS)).toEqual(allThree(ALERTS, true));
  });

  test("reloaded, they are still there under fixing, on", async () => {
    await openLane(ALERTS);

    await expect(fixSwitch(ALERTS)).toHaveAttribute("aria-checked", "true");
    await expect(childrenOf(ALERTS)).toBeVisible();
    await expect(
      childrenOf(ALERTS).getByTestId(switchTestId(ALERTS.codeFix)),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      childrenOf(ALERTS).getByTestId(switchTestId(ALERTS.telemetry)),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("while fixing is on, one pull request is turned off on its own", async () => {
    await openLane(ALERTS);

    const written: Record<string, unknown> = await pressAndSave(
      page.getByTestId(switchTestId(ALERTS.telemetry)),
    );

    expect(written).toEqual({ [ALERTS.telemetry]: false });
    await expect(
      page.getByTestId(`${switchTestId(ALERTS.telemetry)}-status`),
    ).toContainText("Saved");
    expect(await stored(ALERTS)).toEqual({
      [ALERTS.fix]: true,
      [ALERTS.codeFix]: true,
      [ALERTS.telemetry]: false,
    });

    await openLane(ALERTS);
    await expect(
      page.getByTestId(switchTestId(ALERTS.telemetry)),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByTestId(switchTestId(ALERTS.codeFix)),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("turning fixing off turns all three off, and the pull requests go", async () => {
    await openLane(ALERTS);

    const written: Record<string, unknown> = await pressAndSave(
      fixSwitch(ALERTS),
    );

    expect(written).toEqual(allThree(ALERTS, false));
    await expect(fixSwitch(ALERTS)).toHaveAttribute("aria-checked", "false");
    await expect(childrenOf(ALERTS)).toHaveCount(0);
    expect(await stored(ALERTS)).toEqual(allThree(ALERTS, false));
  });

  test("turning fixing on again brings both back on, the one turned off by hand too", async () => {
    await openLane(ALERTS);

    expect(await pressAndSave(fixSwitch(ALERTS))).toEqual(
      allThree(ALERTS, true),
    );
    await expect(
      page.getByTestId(switchTestId(ALERTS.telemetry)),
    ).toHaveAttribute("aria-checked", "true");
    expect(await stored(ALERTS)).toEqual(allThree(ALERTS, true));
  });

  test("the incident page nests its own two the same way, before the postmortem, and leaves the alerts alone", async () => {
    await openLane(INCIDENTS);

    await expect(fixSwitch(INCIDENTS)).toHaveAttribute("aria-checked", "false");
    await expect(childrenOf(INCIDENTS)).toHaveCount(0);

    const written: Record<string, unknown> = await pressAndSave(
      fixSwitch(INCIDENTS),
    );

    expect(written).toEqual(allThree(INCIDENTS, true));

    const card: Locator = page.getByTestId("incident-ai-switches");
    await expect(card.getByRole("switch")).toHaveCount(5);

    const names: Array<string> = [];
    for (const control of await card.getByRole("switch").all()) {
      const labelId: string | null =
        await control.getAttribute("aria-labelledby");
      names.push(
        labelId
          ? (
              (await page.locator(`[id="${labelId}"]`).textContent()) || ""
            ).trim()
          : "",
      );
    }
    expect(names).toEqual([
      "Investigate new incidents",
      INCIDENTS.fixTitle,
      CODE_FIX_TITLE,
      TELEMETRY_TITLE,
      "Draft a postmortem when an incident resolves",
    ]);

    expect(await stored(INCIDENTS)).toEqual(allThree(INCIDENTS, true));
    // The alert switches are as the alert page left them.
    expect(await stored(ALERTS)).toEqual(allThree(ALERTS, true));
  });

  test("the server stores what an API write sets: a pull request left on under fixing that is off is kept, and not offered", async () => {
    const response: APIResponse = await page.request.put(
      urlFor(`/api/project/${projectId}`),
      {
        headers: { tenantid: projectId },
        data: { data: { [INCIDENTS.fix]: false } },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);

    // Only what was written changed: no switch went off with fixing.
    expect(await stored(INCIDENTS)).toEqual({
      [INCIDENTS.fix]: false,
      [INCIDENTS.codeFix]: true,
      [INCIDENTS.telemetry]: true,
    });

    await openLane(INCIDENTS);
    await expect(fixSwitch(INCIDENTS)).toHaveAttribute("aria-checked", "false");
    await expect(childrenOf(INCIDENTS)).toHaveCount(0);

    // Turning fixing on from the page writes all three, as always.
    expect(await pressAndSave(fixSwitch(INCIDENTS))).toEqual(
      allThree(INCIDENTS, true),
    );
    await expect(childrenOf(INCIDENTS)).toBeVisible();
  });
});
