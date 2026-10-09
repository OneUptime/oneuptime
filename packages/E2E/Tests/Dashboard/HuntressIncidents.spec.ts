import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import StandardWebhookSignature from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import crypto from "crypto";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  JSONish,
  SessionUser,
  createItem,
  createOnCallPolicyForUser,
  ensureUserCanBeNotified,
  getItem,
  getProjectDefaults,
  getSessionUser,
  listItems,
  pollUntil,
  requestJson,
  toId,
  waitForIncidentState,
  waitForOnCallExecution,
  waitForOnCallUserPaged,
} from "./Helpers/MonitorAlerting";

/*
 * Huntress incident reports, end to end:
 *
 *   Huntress (a signed webhook) -> api -> one incident -> on-call -> user paged
 *   -> a comment becomes a note -> closing the report resolves the incident
 *
 * The spec plays Huntress: it signs each delivery the way Huntress's webhook
 * service (Svix) does, with the endpoint's signing secret, and posts it to
 * the connection's URL. Everything else is the real stack - the webhook
 * route, the incident it opens, the on-call policy it executes, the user it
 * pages - and the connection's page in the dashboard, which shows what came
 * in and what was done with it. No call leaves the deployment under test.
 *
 * Each run gets a fresh user and project, so report ids can repeat between
 * runs without colliding.
 *
 * To run locally against a full stack:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/HuntressIncidents.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial", retries: 1 });

test.skip(({ browserName }: { browserName: string }): boolean => {
  return browserName !== "chromium";
}, "The webhook flow is API and worker driven; the chromium run covers it.");

/*
 * On-call execution logs are a Growth feature when billing is enabled, so
 * the billing-mode run creates its project on Growth.
 */
const PREFERRED_PLAN_NAME: string = "Growth";

const INCIDENT_TIMEOUT_MS: number = 120000;
const ON_CALL_TIMEOUT_MS: number = 120000;
const RESOLVE_TIMEOUT_MS: number = 120000;

// A secret as Huntress shows it under View Signing Secret.
const SIGNING_SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;

const REPORT_ID: number = 1234;
const SKIPPED_REPORT_ID: number = 5678;
const ORGANIZATION_NAME: string = "Acme Corp";
const COMMENT: string = "We isolated the host and are reimaging it.";

const SERVER: { timeout: number } = { timeout: 30000 };

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// An incident report as Huntress documents it (api.huntress.io/v1/webhooks_doc.json).
function reportBody(overrides: JSONish = {}): JSONish {
  return {
    event_type: "incident_report.created",
    id: REPORT_ID,
    account: { id: 5, name: "Example MSP" },
    organization: { id: 4, name: ORGANIZATION_NAME },
    agent_id: 12,
    severity: "critical",
    status: "sent",
    subject: `CRITICAL - Incident on DESKTOP-E2E01 (${ORGANIZATION_NAME})`,
    summary:
      "Huntress detected a malicious scheduled task on this host. Remove the file and the scheduled task listed in the remediation steps.",
    platform: "windows",
    indicator_counts: { footholds: 1, process_detections: 2 },
    created_at: "2026-10-09T03:00:00Z",
    sent_at: "2026-10-09T03:05:00Z",
    closed_at: null,
    ...overrides,
  };
}

interface Delivery {
  status: number;
  body: JSONish;
}

interface SharedContext {
  page: Page;
  projectId: string;
  user: SessionUser;
  mostSevereSeverityId: string;
  resolvedIncidentStateId: string;
  onCallDutyPolicyId: string;
  connectionId: string;
  incidentId: string;
}

test.describe("Huntress incident report -> incident -> on-call -> resolved", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    user: { userId: "", email: "" },
    mostSevereSeverityId: "",
    resolvedIncidentStateId: "",
    onCallDutyPolicyId: "",
    connectionId: "",
    incidentId: "",
  };

  const webhookUrl: () => string = (): string => {
    return urlFor(`/api/huntress/webhook/${ctx.connectionId}`);
  };

  // Posts a delivery the way Huntress does: the raw JSON, signed.
  const deliver: (data: {
    body: JSONish;
    messageId?: string | undefined;
    signed?: boolean | undefined;
  }) => Promise<Delivery> = async (data: {
    body: JSONish;
    messageId?: string | undefined;
    signed?: boolean | undefined;
  }): Promise<Delivery> => {
    const raw: string = JSON.stringify(data.body);
    const messageId: string =
      data.messageId || `msg_${crypto.randomBytes(12).toString("hex")}`;
    const timestamp: string = String(Math.floor(Date.now() / 1000));

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (data.signed !== false) {
      headers["svix-id"] = messageId;
      headers["svix-timestamp"] = timestamp;
      headers["svix-signature"] = StandardWebhookSignature.sign({
        secret: SIGNING_SECRET,
        messageId,
        timestamp,
        body: raw,
      });
    }

    const response: APIResponse = await ctx.page.request.post(webhookUrl(), {
      headers,
      data: raw,
    });

    const text: string = await response.text();

    return {
      status: response.status(),
      body: text ? (JSON.parse(text) as JSONish) : {},
    };
  };

  const incidentsTitled: (title: string) => Promise<Array<JSONish>> = async (
    title: string,
  ): Promise<Array<JSONish>> => {
    return await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/incident",
      query: { title },
      select: { _id: true, title: true },
    });
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(600000);

    ctx.page = await browser.newPage();

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Huntress Project",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    ctx.user = await getSessionUser({ page: ctx.page });

    ctx.resolvedIncidentStateId = (
      await getProjectDefaults({ page: ctx.page, projectId: ctx.projectId })
    ).resolvedIncidentStateId;

    // The project's incident severities, most severe first.
    const severities: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/incident-severity",
      select: { _id: true, name: true, order: true },
    });

    severities.sort((a: JSONish, b: JSONish): number => {
      return Number(a["order"]) - Number(b["order"]);
    });

    ctx.mostSevereSeverityId = toId(severities[0]!["_id"]);

    await ensureUserCanBeNotified({
      page: ctx.page,
      projectId: ctx.projectId,
      user: ctx.user,
    });

    ctx.onCallDutyPolicyId = await createOnCallPolicyForUser({
      page: ctx.page,
      projectId: ctx.projectId,
      userId: ctx.user.userId,
      policyName: "E2E Huntress On-Call",
    });

    const connection: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/huntress-connection",
      item: {
        projectId: ctx.projectId,
        name: "Huntress",
        pageOnCallFor: "high",
        resolveIncidentWhenReportCloses: true,
        onCallDutyPolicies: [{ _id: ctx.onCallDutyPolicyId }],
      },
    });

    ctx.connectionId = toId(connection["_id"]);

    expect(ctx.connectionId).not.toBe("");
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("the connection's page walks the setup in Huntress, with its URL", async () => {
    const setup: Locator = ctx.page.getByTestId("huntress-setup");

    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: urlFor(
        `/dashboard/${ctx.projectId}/incidents/integrations/huntress/${ctx.connectionId}`,
      ),
      ready: setup,
    });

    await expect(
      ctx.page.getByTestId("huntress-connection-state"),
    ).toHaveAttribute("data-state", "needs-signing-secret", SERVER);
    await expect(ctx.page.getByTestId("huntress-webhook-url")).toContainText(
      `/api/huntress/webhook/${ctx.connectionId}`,
    );
  });

  test("refuses every delivery until the signing secret is saved", async () => {
    const refused: Delivery = await deliver({ body: reportBody() });

    expect(refused.status).toBe(401);
    expect(String(refused.body["message"])).toContain(
      "no signing secret is saved for this connection yet",
    );
    expect(
      await incidentsTitled("Huntress: Incident on DESKTOP-E2E01 (Acme Corp)"),
    ).toHaveLength(0);
  });

  test("the signing secret is saved from the page, and never read back", async () => {
    await ctx.page.getByTestId("huntress-signing-secret-button").click();

    const dialog: Locator = ctx.page.getByTestId("modal");

    await dialog.getByPlaceholder("whsec_…").fill(SIGNING_SECRET);
    await dialog.getByTestId("modal-footer-submit-button").click();

    await expect(dialog).toBeHidden(SERVER);
    await expect(
      ctx.page.getByTestId("huntress-signing-secret-saved"),
    ).toBeVisible(SERVER);
    await expect(
      ctx.page.getByTestId("huntress-connection-state"),
    ).toHaveAttribute("data-state", "waiting", SERVER);

    const connection: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/huntress-connection",
      id: ctx.connectionId,
      select: { _id: true, isSigningSecretSet: true, signingSecret: true },
    });

    expect(connection["isSigningSecretSet"]).toBe(true);
    expect(connection["signingSecret"]).toBeFalsy();
  });

  test("refuses a delivery that is not signed", async () => {
    const refused: Delivery = await deliver({
      body: reportBody(),
      signed: false,
    });

    expect(refused.status).toBe(401);
  });

  test("a critical report opens one incident at the most severe severity, and pages on-call", async () => {
    test.setTimeout(400000);

    const messageId: string = "msg_e2e_created";
    const delivery: Delivery = await deliver({ body: reportBody(), messageId });

    expect(delivery.status, JSON.stringify(delivery.body)).toBe(200);
    expect(delivery.body["action"]).toBe("incident-opened");
    expect(delivery.body["outcome"]).toBe("IncidentOpened");

    ctx.incidentId = String(delivery.body["incidentId"]);

    const incident: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/incident",
      id: ctx.incidentId,
      select: {
        _id: true,
        title: true,
        description: true,
        incidentSeverityId: true,
        isCreatedAutomatically: true,
        isVisibleOnStatusPage: true,
        labels: { _id: true, name: true },
        onCallDutyPolicies: { _id: true },
      },
    });

    expect(incident["title"]).toBe(
      "Huntress: Incident on DESKTOP-E2E01 (Acme Corp)",
    );
    expect(String(incident["description"])).toContain(
      "https://huntress.io/org/4/incident_reports/1234",
    );
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.mostSevereSeverityId);
    expect(incident["isCreatedAutomatically"]).toBe(true);
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(
      ((incident["labels"] as Array<JSONish>) || []).map((label: JSONish) => {
        return label["name"];
      }),
    ).toContain(ORGANIZATION_NAME);
    expect(
      ((incident["onCallDutyPolicies"] as Array<JSONish>) || []).map(
        (policy: JSONish) => {
          return toId(policy["_id"]);
        },
      ),
    ).toContain(ctx.onCallDutyPolicyId);

    const executionLog: JSONish = await waitForOnCallExecution({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyId: ctx.onCallDutyPolicyId,
      incidentId: ctx.incidentId,
      timeoutMs: ON_CALL_TIMEOUT_MS,
    });

    const paged: JSONish = await waitForOnCallUserPaged({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyExecutionLogId: toId(executionLog["_id"]),
      userId: ctx.user.userId,
      timeoutMs: ON_CALL_TIMEOUT_MS,
    });

    expect(toId(paged["alertSentToUserId"])).toBe(ctx.user.userId);
  });

  test("the same delivery again, or the report sent again, opens nothing more", async () => {
    const again: Delivery = await deliver({
      body: reportBody(),
      messageId: "msg_e2e_created",
    });

    expect(again.status).toBe(200);
    expect(again.body["action"]).toBe("duplicate");
    expect(String(again.body["incidentId"])).toBe(ctx.incidentId);

    const resent: Delivery = await deliver({ body: reportBody() });

    expect(resent.status).toBe(200);
    expect(String(resent.body["incidentId"])).toBe(ctx.incidentId);

    expect(
      await incidentsTitled("Huntress: Incident on DESKTOP-E2E01 (Acme Corp)"),
    ).toHaveLength(1);
  });

  test("a comment in Huntress becomes a private note on the incident", async () => {
    const delivery: Delivery = await deliver({
      body: reportBody({
        event_type: "incident_report.comment_added",
        comment: COMMENT,
      }),
    });

    expect(delivery.status).toBe(200);
    expect(delivery.body["action"]).toBe("note-added");

    const notes: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page: ctx.page,
      description: "the comment's note on the incident",
      timeoutMs: INCIDENT_TIMEOUT_MS,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page: ctx.page,
          projectId: ctx.projectId,
          path: "/api/incident-internal-note",
          query: { incidentId: ctx.incidentId },
          select: { _id: true, note: true },
        });

        return rows.length > 0 ? rows : null;
      },
    });

    expect(
      notes.some((note: JSONish) => {
        return (
          String(note["note"]).includes("Comment added in Huntress") &&
          String(note["note"]).includes(COMMENT)
        );
      }),
    ).toBe(true);
  });

  test("closing the report in Huntress resolves the incident", async () => {
    const delivery: Delivery = await deliver({
      body: reportBody({
        event_type: "incident_report.closed",
        status: "closed",
        closed_at: "2026-10-09T05:00:00Z",
      }),
    });

    expect(delivery.status).toBe(200);
    expect(delivery.body["action"]).toBe("incident-resolved");
    expect(delivery.body["outcome"]).toBe("IncidentResolved");

    await waitForIncidentState({
      page: ctx.page,
      projectId: ctx.projectId,
      incidentId: ctx.incidentId,
      incidentStateId: ctx.resolvedIncidentStateId,
      description:
        "the incident to be resolved when Huntress closes its report",
      timeoutMs: RESOLVE_TIMEOUT_MS,
    });
  });

  test("a report from an organization the connection does not watch opens nothing", async () => {
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/huntress-connection/${ctx.connectionId}`,
      method: "put",
      body: { data: { watchedOrganizations: "Globex" } },
    });

    const delivery: Delivery = await deliver({
      body: reportBody({
        id: SKIPPED_REPORT_ID,
        subject: "HIGH - Incident on LAPTOP-E2E02 (Acme Corp)",
        severity: "high",
      }),
    });

    expect(delivery.status).toBe(200);
    expect(delivery.body["action"]).toBe("skipped");
    expect(delivery.body["outcome"]).toBe("OrganizationNotWatched");
    expect(delivery.body["incidentId"]).toBeNull();
    expect(
      await incidentsTitled("Huntress: Incident on LAPTOP-E2E02 (Acme Corp)"),
    ).toHaveLength(0);
  });

  test("the connection's page shows it receiving, and what was done with each report", async () => {
    const status: Locator = ctx.page.getByTestId("huntress-connection-status");

    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: urlFor(
        `/dashboard/${ctx.projectId}/incidents/integrations/huntress/${ctx.connectionId}`,
      ),
      ready: status,
    });

    await expect(
      ctx.page.getByTestId("huntress-connection-state"),
    ).toHaveAttribute("data-state", "receiving", SERVER);
    await expect(status).toContainText("Receiving reports");

    await expect(ctx.page.getByText("Incident resolved").first()).toBeVisible(
      SERVER,
    );
    await expect(
      ctx.page.getByText("Skipped: organization not watched").first(),
    ).toBeVisible(SERVER);
    await expect(
      ctx.page.getByTestId("huntress-report-headline").filter({
        hasText: "DESKTOP-E2E01",
      }),
    ).toBeVisible(SERVER);
  });
});
