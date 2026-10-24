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
 * "Both of these toggles should be inside of Remediation Rule, inside of
 * More, and they should be checked by default. They should be true by
 * default. If there are no rules, by the way, this should happen by
 * default. So, less things for user to configure. You can remove these
 * toggles from the main card." - the maintainer.
 *
 * Against a real stack:
 *
 *  - Alerts → AI → Settings and Incidents → AI → Settings draw no pull
 *    request switch: fixing is one switch, and turning it on saves it
 *    alone;
 *  - an AI rule - the auto remediation rule it was - holds the two pull
 *    requests, both on unless a write says otherwise, and the code
 *    repositories it names (none: every connected one); a write turns one
 *    off, and it stays off;
 *  - a rule that only investigates, what an investigation rule was, names
 *    its code repositories the same way; an API client that says nothing of
 *    what a rule does gets one that fixes and does not investigate, as an
 *    auto remediation rule did, and the investigation rules' old route
 *    answers 410 Gone, naming the AI rule resource.
 *
 * Nothing here needs an LLM provider: no investigation runs. Whether a pull
 * request then opens is the server's rule, covered by the Common suites
 * (FixFromIncidentAutoTrigger, InstrumentationTaskTrigger,
 * AutomaticFixPullRequests, RemediationRulePullRequests). The rule dialogs
 * themselves are driven offline (AutoRemediationRules/).
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
  trigger: "Incident" | "Alert";
  fix: string;
}

const ALERTS: Lane = {
  name: "alerts",
  trigger: "Alert",
  fix: "enableAutomaticAlertRemediation",
};

const INCIDENTS: Lane = {
  name: "incidents",
  trigger: "Incident",
  fix: "enableAutomaticIncidentRemediation",
};

// The switches the AI card drew before the rules held them.
const RETIRED_TITLES: Array<string> = [
  "Open a fix pull request when an investigation finds a code change",
  "Open a pull request that adds missing telemetry",
];

const switchTestId: (column: string) => string = (column: string): string => {
  return `ai-switch-${column}`;
};

interface StoredRule {
  _id?: string;
  investigates?: boolean;
  fixes?: boolean;
  openCodeFixPullRequests?: boolean;
  openTelemetryPullRequests?: boolean;
  codeRepositories?: Array<unknown>;
}

test.describe("fix pull requests are each AI rule's", () => {
  let page: Page;
  let projectId: string = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E rule pull requests",
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

  // A rule of the lane's kind, created as the API is sent one.
  const createRule: (data: {
    path: "auto-remediation-rule";
    lane: Lane;
    fields?: Record<string, unknown>;
  }) => Promise<string> = async (data: {
    path: "auto-remediation-rule";
    lane: Lane;
    fields?: Record<string, unknown>;
  }): Promise<string> => {
    const response: APIResponse = await page.request.post(
      urlFor(`/api/${data.path}`),
      {
        headers: { tenantid: projectId },
        data: {
          data: {
            projectId,
            name: `E2E ${data.lane.name} rule`,
            isEnabled: true,
            triggerEntityType: data.lane.trigger,
            ...(data.fields || {}),
          },
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);

    const id: string = ((await response.json()) as { _id: string })._id;
    expect(id).toBeTruthy();
    return id;
  };

  const readRule: (data: {
    path: "auto-remediation-rule";
    id: string;
    select: Record<string, unknown>;
  }) => Promise<StoredRule> = async (data: {
    path: "auto-remediation-rule";
    id: string;
    select: Record<string, unknown>;
  }): Promise<StoredRule> => {
    const response: APIResponse = await page.request.post(
      urlFor(`/api/${data.path}/${data.id}/get-item`),
      {
        headers: { tenantid: projectId },
        data: { select: data.select },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as StoredRule;
  };

  test("the alert page draws fixing alone: no pull request switch under it or beside it", async () => {
    await openLane(ALERTS);

    await expect(fixSwitch(ALERTS)).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByTestId(`${switchTestId(ALERTS.fix)}-children`),
    ).toHaveCount(0);

    for (const title of RETIRED_TITLES) {
      await expect(page.getByRole("switch", { name: title })).toHaveCount(0);
    }
  });

  test("turning fixing on saves fixing alone", async () => {
    await openLane(ALERTS);

    const save: Promise<Response> = page.waitForResponse(
      (response: Response): boolean => {
        return (
          response.url().includes(`/api/project/${projectId}`) &&
          response.request().method() === "PUT"
        );
      },
      SERVER,
    );

    await fixSwitch(ALERTS).click();

    const response: Response = await save;
    expect(response.ok(), await response.text()).toBe(true);
    expect(
      (response.request().postDataJSON() as { data: Record<string, unknown> })
        .data,
    ).toEqual({ [ALERTS.fix]: true });
    await expect(fixSwitch(ALERTS)).toHaveAttribute("aria-checked", "true");

    // Still nothing under it.
    await expect(
      page.getByTestId(`${switchTestId(ALERTS.fix)}-children`),
    ).toHaveCount(0);
  });

  test("the incident page draws three switches: investigate, fix, and the postmortem", async () => {
    await openLane(INCIDENTS);

    const card: Locator = page.getByTestId("incident-ai-switches");
    await expect(card.getByRole("switch")).toHaveCount(3);

    for (const title of RETIRED_TITLES) {
      await expect(card.getByRole("switch", { name: title })).toHaveCount(0);
    }
  });

  test("an AI rule opens both pull requests, in every connected repository, unless it says otherwise", async () => {
    for (const lane of [INCIDENTS, ALERTS]) {
      const id: string = await createRule({
        path: "auto-remediation-rule",
        lane,
      });

      const stored: StoredRule = await readRule({
        path: "auto-remediation-rule",
        id,
        select: {
          openCodeFixPullRequests: true,
          openTelemetryPullRequests: true,
          codeRepositories: { _id: true },
        },
      });

      expect(stored.openCodeFixPullRequests).toBe(true);
      expect(stored.openTelemetryPullRequests).toBe(true);
      expect(stored.codeRepositories || []).toEqual([]);
    }
  });

  test("a rule written with a pull request off keeps it off", async () => {
    const id: string = await createRule({
      path: "auto-remediation-rule",
      lane: INCIDENTS,
      fields: { openTelemetryPullRequests: false },
    });

    expect(
      await readRule({
        path: "auto-remediation-rule",
        id,
        select: {
          openCodeFixPullRequests: true,
          openTelemetryPullRequests: true,
        },
      }),
    ).toMatchObject({
      openCodeFixPullRequests: true,
      openTelemetryPullRequests: false,
    });

    const response: APIResponse = await page.request.put(
      urlFor(`/api/auto-remediation-rule/${id}`),
      {
        headers: { tenantid: projectId },
        data: { data: { openCodeFixPullRequests: false } },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);

    expect(
      await readRule({
        path: "auto-remediation-rule",
        id,
        select: {
          openCodeFixPullRequests: true,
          openTelemetryPullRequests: true,
        },
      }),
    ).toMatchObject({
      openCodeFixPullRequests: false,
      openTelemetryPullRequests: false,
    });
  });

  test("a rule that only investigates names no code repository unless it says so: it reads every connected one", async () => {
    const id: string = await createRule({
      path: "auto-remediation-rule",
      lane: ALERTS,
      fields: { investigates: true, fixes: false },
    });

    const stored: StoredRule = await readRule({
      path: "auto-remediation-rule",
      id,
      select: {
        investigates: true,
        fixes: true,
        codeRepositories: { _id: true },
      },
    });

    expect(stored.investigates).toBe(true);
    expect(stored.fixes).toBe(false);
    expect(stored.codeRepositories || []).toEqual([]);
  });

  test("a rule an API client makes without saying what it does fixes, and does not investigate, as an auto remediation rule did", async () => {
    const id: string = await createRule({
      path: "auto-remediation-rule",
      lane: INCIDENTS,
    });

    expect(
      await readRule({
        path: "auto-remediation-rule",
        id,
        select: { investigates: true, fixes: true },
      }),
    ).toMatchObject({ investigates: false, fixes: true });
  });

  test("the investigation rules' old route answers 410 Gone, naming the AI rule resource", async () => {
    const response: APIResponse = await page.request.post(
      urlFor("/api/ai-investigation-rule"),
      {
        headers: { tenantid: projectId },
        data: {
          data: {
            projectId,
            name: "E2E old investigation rule",
            isEnabled: true,
            triggerEntityType: ALERTS.trigger,
          },
        },
      },
    );

    expect(response.status()).toBe(410);
    const answer: string = await response.text();
    expect(answer).toContain("/api/auto-remediation-rule");
    expect(answer).toContain("oneuptime_ai_rule");
  });

  test("a rule cannot name a code repository of another project", async () => {
    const response: APIResponse = await page.request.post(
      urlFor("/api/auto-remediation-rule"),
      {
        headers: { tenantid: projectId },
        data: {
          data: {
            projectId,
            name: "E2E foreign repository",
            isEnabled: true,
            triggerEntityType: INCIDENTS.trigger,
            codeRepositories: [{ _id: "f0f0f0f0-0000-4000-8000-000000000001" }],
          },
        },
      },
    );

    expect(response.ok()).toBe(false);
    expect(await response.text()).toContain(
      "f0f0f0f0-0000-4000-8000-000000000001",
    );
  });
});
