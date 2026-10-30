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
import ObjectID from "Common/Types/ObjectID";
import StandardWebhookSignature from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import { HuntressTriggerSetting } from "Common/Types/Workflow/HuntressTrigger";
import {
  HUNTRESS_TEMPLATE_OPTIONS,
  HUNTRESS_TRIGGER_COMPONENT_ID,
  buildHuntressIncidentWorkflowGraph,
} from "Common/Types/Workflow/Templates";
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
 * Huntress incident reports, end to end, as a workflow:
 *
 *   Huntress (a signed webhook) -> the workflow's Huntress trigger -> one
 *   incident -> on-call -> user paged -> a comment becomes a note -> closing
 *   the report resolves the incident
 *
 * The workflow is the one "Open an incident for each Huntress incident
 * report" creates, with the on-call policy picked as the Builder saves it.
 * The spec plays Huntress: it signs each delivery the way Huntress's
 * webhook service (Svix) does, with the endpoint's signing secret, and
 * posts it to the trigger's URL. Everything else is the real stack - the
 * trigger's route, the workflow run, the incident it opens, the on-call
 * policy it executes, the user it pages - and the trigger's panel in the
 * Builder, where the signing secret is saved and Huntress is seen arriving.
 * No call leaves the deployment under test.
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
 * Workflows, and on-call execution logs, are Growth features when billing
 * is enabled, so the billing-mode run creates its project on Growth.
 */
const PREFERRED_PLAN_NAME: string = "Growth";

const INCIDENT_TIMEOUT_MS: number = 120000;
const ON_CALL_TIMEOUT_MS: number = 120000;
const RESOLVE_TIMEOUT_MS: number = 120000;

// A secret as Huntress shows it under View Signing Secret: whsec_ and base64.
const SIGNING_SECRET: string = `whsec_${Buffer.from(
  "huntress-e2e-signing-secret",
).toString("base64")}`;

// How many deliveries were posted, for each one's own svix-id.
let deliveriesPosted: number = 0;

const REPORT_ID: number = 1234;
const SKIPPED_REPORT_ID: number = 5678;
const ORGANIZATION_NAME: string = "Acme Corp";
const COMMENT: string = "We isolated the host and are reimaging it.";
const INCIDENT_TITLE: string =
  "Huntress: Incident on DESKTOP-E2E01 (Acme Corp)";
const SKIPPED_INCIDENT_TITLE: string =
  "Huntress: Incident on LAPTOP-E2E02 (Acme Corp)";

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
  workflowId: string;
  secretKey: string;
  graph: JSONish;
  incidentId: string;
}

test.describe("Huntress incident report -> workflow -> incident -> on-call -> resolved", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    user: { userId: "", email: "" },
    mostSevereSeverityId: "",
    resolvedIncidentStateId: "",
    onCallDutyPolicyId: "",
    workflowId: "",
    secretKey: "",
    graph: {},
    incidentId: "",
  };

  const triggerUrl: () => string = (): string => {
    return urlFor(`/workflow/huntress/${ctx.secretKey}`);
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
    deliveriesPosted++;

    // Each event its own id, as Huntress gives them; a resent one keeps its own.
    const messageId: string =
      data.messageId || `msg_huntress_e2e_${deliveriesPosted}`;
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

    const response: APIResponse = await ctx.page.request.post(triggerUrl(), {
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

  // The workflow's runs that are over, however each ended.
  const finishedRuns: () => Promise<Array<JSONish>> = async (): Promise<
    Array<JSONish>
  > => {
    const runs: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/workflow-log",
      query: { workflowId: ctx.workflowId },
      select: { _id: true, workflowStatus: true },
      limit: 100,
    });

    return runs.filter((run: JSONish): boolean => {
      return ["Success", "Error", "Timeout"].includes(
        String(run["workflowStatus"]),
      );
    });
  };

  const waitForFinishedRuns: (count: number) => Promise<void> = async (
    count: number,
  ): Promise<void> => {
    await pollUntil<Array<JSONish>>({
      page: ctx.page,
      description: `${count} finished run(s) of the Huntress workflow`,
      timeoutMs: INCIDENT_TIMEOUT_MS,
      check: async (): Promise<Array<JSONish> | null> => {
        const runs: Array<JSONish> = await finishedRuns();
        return runs.length >= count ? runs : null;
      },
    });
  };

  // Opens the Builder and the Huntress trigger's settings, on its panel.
  const openTrigger: (ready: string) => Promise<Locator> = async (
    ready: string,
  ): Promise<Locator> => {
    const card: Locator = ctx.page.locator(".react-flow__node", {
      hasText: HUNTRESS_TRIGGER_COMPONENT_ID,
    });

    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: urlFor(
        `/dashboard/${ctx.projectId}/workflows/${ctx.workflowId}/builder`,
      ),
      ready: card,
    });

    await card.click();

    const section: Locator = ctx.page.getByTestId(
      "workflow-component-section-huntress",
    );

    await expect(section).toBeVisible(SERVER);
    await expect(ctx.page.getByTestId(ready)).toBeVisible(SERVER);

    return section;
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

    /*
     * The template's graph, with the policy picked as the create wizard
     * saves it - what "Use this template" leaves once who to page is
     * picked: the trigger, Incident From Another Tool, an If / Else and the
     * Page step.
     */
    ctx.graph = buildHuntressIncidentWorkflowGraph(
      {
        ...HUNTRESS_TEMPLATE_OPTIONS,
        onCallPolicyIds: [ctx.onCallDutyPolicyId],
      },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    const workflow: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/workflow",
      item: {
        projectId: ctx.projectId,
        name: "Huntress incident reports",
        graph: ctx.graph,
      },
    });

    ctx.workflowId = toId(workflow["_id"]);

    /*
     * What the Dashboard reads of it. The trigger the server saves from the
     * graph (triggerId) is the runner's own column, which the API never
     * returns - a select of it is refused outright - and the trigger's URL
     * answers 404 for a workflow whose trigger is not Huntress's: the 401
     * below, for a delivery before the signing secret is saved, is the
     * proof that it was saved.
     */
    const saved: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/workflow",
      id: ctx.workflowId,
      select: {
        _id: true,
        webhookSecretKey: true,
        isEnabled: true,
      },
    });

    ctx.secretKey = String(saved["webhookSecretKey"] || "");

    expect(ctx.secretKey).not.toBe("");
    // New workflows start off.
    expect(Boolean(saved["isEnabled"])).toBe(false);
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("the Builder opens the Huntress trigger on its panel: the URL for Huntress, and the steps in Huntress", async () => {
    const section: Locator = await openTrigger("huntress-trigger-setup");

    await expect(section.getByTestId("huntress-trigger-state")).toHaveAttribute(
      "data-state",
      "needs-signing-secret",
      SERVER,
    );
    await expect(section.getByTestId("huntress-trigger-url")).toContainText(
      `/workflow/huntress/${ctx.secretKey}`,
    );
    await expect(
      section.getByTestId("huntress-trigger-step-endpoint"),
    ).toContainText("Add a webhook endpoint in Huntress");
    await expect(
      section.getByTestId("huntress-trigger-signing-secret-button"),
    ).toContainText("Save Signing Secret");
  });

  test("refuses every delivery until the signing secret is saved", async () => {
    const refused: Delivery = await deliver({ body: reportBody() });

    expect(refused.status).toBe(401);
    expect(String(refused.body["message"])).toContain(
      "no signing secret is saved for this workflow yet",
    );
    expect(await incidentsTitled(INCIDENT_TITLE)).toHaveLength(0);
  });

  test("the signing secret is saved from the trigger's panel, and never read back", async () => {
    const section: Locator = ctx.page.getByTestId(
      "workflow-component-section-huntress",
    );

    await section.getByTestId("huntress-trigger-signing-secret-button").click();

    /*
     * The secret's own dialog, over the trigger's settings - which are a
     * dialog too, and hold this one, so "the modal with the secret's field"
     * is both. It goes by its title, as the offline Builder spec finds it
     * (WorkflowBuilder/WorkflowBuilderHuntressTrigger.spec.ts).
     */
    const dialog: Locator = ctx.page.getByRole("dialog", {
      name: /Signing Secret$/,
    });

    await expect(dialog).toContainText("View Signing Secret");

    await dialog.getByPlaceholder("whsec_…").fill(SIGNING_SECRET);
    await dialog.getByTestId("modal-footer-submit-button").click();

    await expect(dialog).toBeHidden(SERVER);
    await expect(
      section.getByTestId("huntress-trigger-signing-secret-saved"),
    ).toBeVisible(SERVER);
    // The refusal the missing secret left is cleared with it.
    await expect(section.getByTestId("huntress-trigger-state")).toHaveAttribute(
      "data-state",
      "waiting",
      SERVER,
    );

    // The workflow says that a secret is set, and never what it is.
    const workflow: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/workflow",
      id: ctx.workflowId,
      select: { _id: true, isWebhookSigningSecretSet: true },
    });

    expect(workflow["isWebhookSigningSecretSet"]).toBe(true);
    expect(workflow["webhookSigningSecret"]).toBeUndefined();

    /*
     * Asking for the secret by name is refused outright: its read list is
     * empty, and the API refuses a select of a column the caller may not
     * read rather than leaving it out.
     */
    const asked: APIResponse = await ctx.page.request.post(
      urlFor(`/api/workflow/${ctx.workflowId}/get-item`),
      {
        headers: {
          "content-type": "application/json",
          tenantid: ctx.projectId,
          projectid: ctx.projectId,
        },
        data: { select: { _id: true, webhookSigningSecret: true } },
      },
    );
    const askedText: string = await asked.text();

    expect(asked.status(), askedText).toBe(422);
    expect(askedText).toContain("webhookSigningSecret");
    expect(askedText).not.toContain(SIGNING_SECRET);
  });

  test("a workflow that is off refuses Huntress's reports, so Huntress sends them again", async () => {
    const refused: Delivery = await deliver({ body: reportBody() });

    expect(refused.status).toBe(503);
    expect(String(refused.body["message"])).toContain(
      "A request arrived while this workflow is off",
    );
    expect(await incidentsTitled(INCIDENT_TITLE)).toHaveLength(0);

    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/workflow/${ctx.workflowId}`,
      method: "put",
      body: { data: { isEnabled: true } },
    });
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

    const delivery: Delivery = await deliver({
      body: reportBody(),
      messageId: "msg_e2e_created",
    });

    expect(delivery.status, JSON.stringify(delivery.body)).toBe(200);
    expect(delivery.body["event"]).toBe("created");
    expect(delivery.body["status"]).toBe("Scheduled");

    const incidents: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page: ctx.page,
      description: "the incident the Huntress report opens",
      timeoutMs: INCIDENT_TIMEOUT_MS,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await incidentsTitled(INCIDENT_TITLE);
        return rows.length > 0 ? rows : null;
      },
    });

    expect(incidents).toHaveLength(1);
    ctx.incidentId = toId(incidents[0]!["_id"]);

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
        isVisibleOnStatusPage: true,
        customFields: true,
        labels: { _id: true, name: true },
      },
    });

    expect(String(incident["description"])).toContain(
      "https://huntress.io/org/4/incident_reports/1234",
    );
    expect(toId(incident["incidentSeverityId"])).toBe(ctx.mostSevereSeverityId);
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect((incident["customFields"] as JSONish)["huntressReportId"]).toBe(
      "1234",
    );
    expect(
      ((incident["labels"] as Array<JSONish>) || []).map((label: JSONish) => {
        return label["name"];
      }),
    ).toContain(ORGANIZATION_NAME);

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

  test("the same delivery again starts nothing, and the report sent again opens no other incident", async () => {
    const again: Delivery = await deliver({
      body: reportBody(),
      messageId: "msg_e2e_created",
    });

    expect(again.status).toBe(200);
    expect(again.body["duplicate"]).toBe(true);

    const runsBefore: number = (await finishedRuns()).length;

    // A new delivery of the same report: a run, which finds its incident.
    const resent: Delivery = await deliver({ body: reportBody() });

    expect(resent.status).toBe(200);
    expect(resent.body["status"]).toBe("Scheduled");

    await waitForFinishedRuns(runsBefore + 1);

    expect(await incidentsTitled(INCIDENT_TITLE)).toHaveLength(1);
  });

  test("a comment in Huntress becomes a private note on the incident", async () => {
    const delivery: Delivery = await deliver({
      body: reportBody({
        event_type: "incident_report.comment_added",
        comment: COMMENT,
      }),
    });

    expect(delivery.status).toBe(200);
    expect(delivery.body["event"]).toBe("comment-added");

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

        return rows.some((row: JSONish): boolean => {
          return String(row["note"]).includes(COMMENT);
        })
          ? rows
          : null;
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
    expect(delivery.body["event"]).toBe("closed");

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

  test("a report from an organization the trigger leaves out starts nothing", async () => {
    // Only These Organizations, as the trigger's settings save it in the graph.
    const nodes: Array<JSONish> = (ctx.graph["nodes"] as Array<JSONish>).map(
      (node: JSONish): JSONish => {
        const data: JSONish = node["data"] as JSONish;

        if (data["id"] !== HUNTRESS_TRIGGER_COMPONENT_ID) {
          return node;
        }

        return {
          ...node,
          data: {
            ...data,
            arguments: {
              ...(data["arguments"] as JSONish),
              [HuntressTriggerSetting.Organizations]: "Globex",
            },
          },
        };
      },
    );

    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/workflow/${ctx.workflowId}`,
      method: "put",
      body: { data: { graph: { ...ctx.graph, nodes } } },
    });

    const delivery: Delivery = await deliver({
      body: reportBody({
        id: SKIPPED_REPORT_ID,
        subject: "HIGH - Incident on LAPTOP-E2E02 (Acme Corp)",
        severity: "high",
      }),
    });

    expect(delivery.status).toBe(200);
    expect(delivery.body["skipped"]).toBe(true);
    expect(await incidentsTitled(SKIPPED_INCIDENT_TITLE)).toHaveLength(0);
  });

  test("the trigger's panel shows Huntress reaching it", async () => {
    const section: Locator = await openTrigger("huntress-trigger-status");

    await expect(section.getByTestId("huntress-trigger-state")).toHaveAttribute(
      "data-state",
      "receiving",
      SERVER,
    );
    await expect(section.getByTestId("huntress-trigger-status")).toContainText(
      "Receiving reports",
    );
    await expect(
      section.getByTestId("huntress-trigger-last-error"),
    ).toHaveCount(0);
  });
});
