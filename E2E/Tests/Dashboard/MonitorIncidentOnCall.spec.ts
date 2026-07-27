import { IS_BILLING_ENABLED } from "../../Config";
import { Browser, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createMonitor,
  fillDestination,
  MonitorTypeRecipe,
} from "./Helpers/Monitors";
import {
  assertMonitorHasProbes,
  assertMonitorTargetsAreUsable,
  buildHttpMonitorSteps,
  createItem,
  createOnCallPolicyForUser,
  downUrl,
  ensureUserCanBeNotified,
  getItem,
  getProjectDefaults,
  getSessionUser,
  HEALTHY_URL,
  JSONish,
  listItems,
  MonitorStepIds,
  newMonitorStepIds,
  NOTIFIED_STATUSES,
  ProjectDefaults,
  requestJson,
  SessionUser,
  toId,
  waitForAlertEmail,
  waitForIncidentForMonitor,
  waitForIncidentState,
  waitForMonitorStatus,
  waitForOnCallExecution,
  waitForOnCallUserPaged,
  waitForUserAlerted,
} from "./Helpers/MonitorAlerting";

/*
 * The full alerting flow, end to end:
 *
 *   dashboard -> api -> probe -> incident -> on-call -> user alerted
 *
 * A monitor is pointed at a URL that reliably fails, a global probe evaluates
 * it, the offline criteria declares an incident, the incident runs an on-call
 * duty policy, the policy pages the on-call user, and an alert email is
 * generated for them. The website scenario then points the monitor back at a
 * healthy URL and asserts the incident auto-resolves.
 *
 * Everything the spec monitors lives inside the OneUptime deployment under
 * test: `${BASE_URL}/status` always answers 200 and `${BASE_URL}/api/<unknown>`
 * always answers 404. No third-party network access, no extra container, and
 * no shared mutable fixture — the three things that make probe-driven e2e
 * tests flaky. The failing URL is unique per run, and each run gets a fresh
 * user and project, so runs can never collide.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/MonitorIncidentOnCall.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial", retries: 1 });

/*
 * The flow is entirely backend driven — the browser only creates the project
 * and one monitor — so running it a second time in firefox would double the
 * wall clock for no extra coverage.
 */
test.skip(({ browserName }: { browserName: string }): boolean => {
  return browserName !== "chromium";
}, "The alerting flow is API and worker driven; the chromium run covers it.");

/*
 * On-call duty policy execution logs and user on-call notification logs are
 * gated behind the Growth plan when billing is enabled, so the billing-mode
 * run has to create its project on Growth rather than the free plan.
 */
const PREFERRED_PLAN_NAME: string = "Growth";

/*
 * Budgets, sized from the slowest path each hop can take.
 *
 * A monitor status transition is the only slow one: the probe fetches work on
 * an every-minute cron and staggers workers by up to ~45s, so a transition is
 * ~2 minutes worst case and ~40s typically. 5 minutes leaves room for a
 * completely lost cycle on a loaded runner.
 *
 * Everything after the probe report — incident, on-call execution, escalation
 * rule, per-user notification — happens in-process off the same tick, with no
 * cron on the critical path (which is why the escalation rule uses
 * escalateAfterInMinutes: 30 and the notification rules use
 * notifyAfterMinutes: 0). Those budgets are generous multiples of the seconds
 * they actually take.
 */
const MONITOR_STATUS_TIMEOUT_MS: number = 300000;
const INCIDENT_TIMEOUT_MS: number = 120000;
const ON_CALL_TIMEOUT_MS: number = 120000;
const USER_ALERTED_TIMEOUT_MS: number = 120000;
const RESOLVE_TIMEOUT_MS: number = 300000;

// On-call execution states that mean the policy is running as intended.
const HEALTHY_EXECUTION_STATUSES: Array<string> = [
  "Scheduled",
  "Started",
  "Executing",
  "Execution Completed",
];

interface SharedContext {
  page: Page;
  projectId: string;
  user: SessionUser;
  defaults: ProjectDefaults;
}

interface AlertingRunResult {
  incidentId: string;
  onCallDutyPolicyId: string;
}

test.describe("Monitor -> Incident -> On-Call -> User Alerted", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    user: { userId: "", email: "" },
    defaults: {
      operationalMonitorStatusId: "",
      offlineMonitorStatusId: "",
      incidentSeverityId: "",
      resolvedIncidentStateId: "",
    },
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(600000);

    ctx.page = await browser.newPage();

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Alerting Project",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    ctx.user = await getSessionUser({ page: ctx.page });

    /*
     * Fail fast and loudly if the URLs the monitors point at don't behave the
     * way the criteria assume, instead of timing out five minutes later
     * waiting for a status that can never change.
     */
    await assertMonitorTargetsAreUsable({
      page: ctx.page,
      sampleDownUrl: downUrl({ label: "precondition", unique: "check" }),
    });

    ctx.defaults = await getProjectDefaults({
      page: ctx.page,
      projectId: ctx.projectId,
    });

    /*
     * Without a verified notification method and the default on-call rules the
     * policy would execute but never reach a human, and the "user alerted"
     * assertions would be vacuous.
     */
    await ensureUserCanBeNotified({
      page: ctx.page,
      projectId: ctx.projectId,
      user: ctx.user,
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  /*
   * Drives one already-created monitor through the whole flow and returns the
   * ids so the caller can assert further (e.g. auto-resolve).
   *
   * The caller creates the monitor pointing at the healthy URL; this function
   * attaches the on-call policy and switches it to the failing URL in a single
   * update. Creating it already-failing would race the probe: a probe cycle
   * landing between "monitor created" and "policy attached" would open an
   * incident with no on-call policy on it, and the run would fail for a
   * non-reason.
   */
  type RunAlertingFlowFunction = (data: {
    monitorId: string;
    monitorName: string;
    ids: MonitorStepIds;
    label: string;
    requestType?: string | undefined;
    requestBody?: string | undefined;
    requestHeaders?: JSONish | undefined;
  }) => Promise<AlertingRunResult>;

  const runAlertingFlow: RunAlertingFlowFunction = async (data: {
    monitorId: string;
    monitorName: string;
    ids: MonitorStepIds;
    label: string;
    requestType?: string | undefined;
    requestBody?: string | undefined;
    requestHeaders?: JSONish | undefined;
  }): Promise<AlertingRunResult> => {
    const onCallDutyPolicyId: string = await createOnCallPolicyForUser({
      page: ctx.page,
      projectId: ctx.projectId,
      userId: ctx.user.userId,
      policyName: `E2E On-Call ${data.monitorName}`,
    });

    const failingUrl: string = downUrl({
      label: data.label,
      unique: Faker.generateName()
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ""),
    });

    // API hop: rewrite the monitor to fail and to page the on-call policy.
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/monitor/${data.monitorId}`,
      method: "put",
      body: {
        data: {
          // Every minute keeps the probe turnaround short in both directions.
          monitoringInterval: "* * * * *",
          /*
           * Without this the monitor status only changes once *every* connected
           * probe has independently reported the same criteria. CI runs one
           * probe, but a local dev stack runs two, and a second probe whose
           * last evaluation predates this update would hold the status back for
           * a whole interval. Requiring one probe removes the largest source of
           * timing variance in the flow.
           */
          minimumProbeAgreement: 1,
          monitorSteps: buildHttpMonitorSteps({
            ids: data.ids,
            destinationUrl: failingUrl,
            monitorName: data.monitorName,
            defaults: ctx.defaults,
            onCallPolicyIds: [onCallDutyPolicyId],
            requestType: data.requestType,
            requestBody: data.requestBody,
            requestHeaders: data.requestHeaders,
          }),
        },
      },
    });

    /*
     * Probe hop. Check the monitor actually has a probe assigned first, so a
     * stack whose probes never registered fails here with a clear message
     * instead of five minutes later on the status poll.
     */
    await assertMonitorHasProbes({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId: data.monitorId,
      timeoutMs: 180000,
    });

    await waitForMonitorStatus({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId: data.monitorId,
      expectedMonitorStatusId: ctx.defaults.offlineMonitorStatusId,
      description: `monitor "${data.monitorName}" to be reported offline by a probe`,
      timeoutMs: MONITOR_STATUS_TIMEOUT_MS,
    });

    // Incident hop.
    const incident: JSONish = await waitForIncidentForMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      incidentTitle: `${data.monitorName} is offline`,
      timeoutMs: INCIDENT_TIMEOUT_MS,
    });

    const incidentId: string = toId(incident["_id"]);

    /*
     * Read the incident back with its relations to prove it really came from
     * this monitor's offline criteria and carries this on-call policy, rather
     * than just that some incident with a matching title exists.
     */
    const incidentDetail: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/incident",
      id: incidentId,
      select: {
        _id: true,
        title: true,
        incidentSeverityId: true,
        isCreatedAutomatically: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        monitors: { _id: true, name: true },
        onCallDutyPolicies: { _id: true, name: true },
      },
    });

    expect(incidentDetail["isCreatedAutomatically"]).toBe(true);
    expect(String(incidentDetail["createdCriteriaId"])).toBe(
      data.ids.offlineCriteriaId,
    );
    expect(String(incidentDetail["createdIncidentTemplateId"])).toBe(
      data.ids.incidentTemplateId,
    );
    expect(toId(incidentDetail["incidentSeverityId"])).toBe(
      ctx.defaults.incidentSeverityId,
    );

    const incidentMonitorIds: Array<string> = (
      (incidentDetail["monitors"] as Array<JSONish>) || []
    ).map((monitor: JSONish) => {
      return toId(monitor["_id"]);
    });
    expect(incidentMonitorIds).toContain(data.monitorId);

    const incidentPolicyIds: Array<string> = (
      (incidentDetail["onCallDutyPolicies"] as Array<JSONish>) || []
    ).map((policy: JSONish) => {
      return toId(policy["_id"]);
    });
    expect(incidentPolicyIds).toContain(onCallDutyPolicyId);

    // On-call hop: the incident starts the policy.
    const executionLog: JSONish = await waitForOnCallExecution({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyId,
      incidentId,
      timeoutMs: ON_CALL_TIMEOUT_MS,
    });

    expect(
      HEALTHY_EXECUTION_STATUSES,
      `unexpected on-call execution status "${String(executionLog["status"])}": ${String(executionLog["statusMessage"])}`,
    ).toContain(String(executionLog["status"]));

    // User hop: the escalation rule pages the on-call user.
    const paged: JSONish = await waitForOnCallUserPaged({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyExecutionLogId: toId(executionLog["_id"]),
      userId: ctx.user.userId,
      timeoutMs: USER_ALERTED_TIMEOUT_MS,
    });

    expect(toId(paged["alertSentToUserId"])).toBe(ctx.user.userId);

    // ...and the per-channel notification log records the attempt.
    const notification: JSONish = await waitForUserAlerted({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyId,
      incidentId,
      userId: ctx.user.userId,
      timeoutMs: USER_ALERTED_TIMEOUT_MS,
    });

    expect(NOTIFIED_STATUSES).toContain(String(notification["status"]));
    expect(toId(notification["userId"])).toBe(ctx.user.userId);
    expect(toId(notification["triggeredByIncidentId"])).toBe(incidentId);
    expect(toId(notification["onCallDutyPolicyId"])).toBe(onCallDutyPolicyId);
    expect(
      toId(notification["userEmailId"]),
      "the notification should have gone to the user's email address",
    ).not.toBe("");

    // ...and a real alert email was produced for that address.
    const emailLog: JSONish = await waitForAlertEmail({
      page: ctx.page,
      projectId: ctx.projectId,
      onCallDutyPolicyId,
      userEmail: ctx.user.email,
      timeoutMs: USER_ALERTED_TIMEOUT_MS,
    });

    expect(String(emailLog["subject"])).toContain(data.monitorName);

    return { incidentId, onCallDutyPolicyId };
  };

  test("website monitor created in the dashboard pages the on-call user when it goes down", async () => {
    test.setTimeout(900000);

    const monitorName: string = `E2E Website ${Faker.generateName().toString()}`;
    const ids: MonitorStepIds = newMonitorStepIds();

    /*
     * Dashboard hop: the monitor is created through the real create-monitor
     * form, pointed at the healthy URL.
     */
    const recipe: MonitorTypeRecipe = {
      label: "Website",
      cardValue: "Website",
      hasInterval: true,
      fillCriteria: async ({ page }: { page: Page }): Promise<void> => {
        await fillDestination({ page, value: HEALTHY_URL });
      },
    };

    const monitorId: string = await createMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorName,
      recipe,
    });

    expect(monitorId, "the created monitor should have an id").not.toBe("");

    const result: AlertingRunResult = await runAlertingFlow({
      monitorId,
      monitorName,
      ids,
      label: "website",
    });

    /*
     * Recovery: point the monitor back at the healthy URL, reusing the same
     * step and criteria ids. The online criteria takes it back to Operational
     * and, because the incident was declared with autoResolveIncident, it
     * resolves itself. Reusing the ids is what makes that possible — the open
     * incident remembers the criteria and template ids it was created from.
     */
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/monitor/${monitorId}`,
      method: "put",
      body: {
        data: {
          monitorSteps: buildHttpMonitorSteps({
            ids,
            destinationUrl: HEALTHY_URL,
            monitorName,
            defaults: ctx.defaults,
            onCallPolicyIds: [result.onCallDutyPolicyId],
          }),
        },
      },
    });

    await waitForMonitorStatus({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId,
      expectedMonitorStatusId: ctx.defaults.operationalMonitorStatusId,
      description: `monitor "${monitorName}" to recover to operational`,
      timeoutMs: MONITOR_STATUS_TIMEOUT_MS,
    });

    await waitForIncidentState({
      page: ctx.page,
      projectId: ctx.projectId,
      incidentId: result.incidentId,
      incidentStateId: ctx.defaults.resolvedIncidentStateId,
      description: `incident for "${monitorName}" to auto-resolve after the monitor recovered`,
      timeoutMs: RESOLVE_TIMEOUT_MS,
    });
  });

  test("api monitor created over the api pages the on-call user when it goes down", async () => {
    test.setTimeout(900000);

    const monitorName: string = `E2E API ${Faker.generateName().toString()}`;
    const ids: MonitorStepIds = newMonitorStepIds();

    /*
     * This one is created straight over the REST API — the path an
     * integration, the Terraform provider or the CLI takes — to prove the
     * pipeline doesn't depend on the browser having assembled the payload.
     * It also exercises a POST check with a body and custom headers, rather
     * than the website monitor's GET.
     */
    const requestBody: string = JSON.stringify({ probe: "oneuptime-e2e" });
    const requestHeaders: JSONish = { "x-oneuptime-e2e": "true" };

    const created: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      item: {
        name: monitorName,
        description: "Created by the OneUptime e2e alerting spec.",
        projectId: ctx.projectId,
        monitorType: "API",
        monitoringInterval: "* * * * *",
        minimumProbeAgreement: 1,
        monitorSteps: buildHttpMonitorSteps({
          ids,
          destinationUrl: HEALTHY_URL,
          monitorName,
          defaults: ctx.defaults,
          onCallPolicyIds: [],
          requestType: "POST",
          requestBody,
          requestHeaders,
        }),
      },
    });

    const monitorId: string = toId(created["_id"]);
    expect(monitorId, "the created monitor should have an id").not.toBe("");

    await runAlertingFlow({
      monitorId,
      monitorName,
      ids,
      label: "api",
      requestType: "POST",
      requestBody,
      requestHeaders,
    });
  });

  test("the on-call user is on the escalation rules that paged them", async () => {
    test.setTimeout(120000);

    /*
     * Guards the setup the two flow tests depend on. If escalation-rule users
     * ever stopped being persisted, those tests would fail with an opaque
     * "user was never alerted" timeout instead of pointing at the cause.
     */
    const ruleUsers: Array<JSONish> = await listItems({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/on-call-duty-policy-escalation-rule-user",
      select: { _id: true, userId: true, onCallDutyPolicyId: true },
    });

    expect(ruleUsers.length).toBeGreaterThan(0);

    const userIds: Array<string> = ruleUsers.map((row: JSONish) => {
      return toId(row["userId"]);
    });

    expect(userIds).toContain(ctx.user.userId);
  });
});
