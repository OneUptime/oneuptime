import { IS_BILLING_ENABLED } from "../../Config";
import { Browser, Page, expect, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { createMonitor, MonitorTypeRecipe } from "./Helpers/Monitors";
import {
  assertHeartbeatIngestIsLive,
  buildHeartbeatMonitorSteps,
  buildInertIncomingRequestSteps,
  createItem,
  createOnCallPolicyForUser,
  ensureUserCanBeNotified,
  getItem,
  getProjectDefaults,
  getSessionUser,
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
  sendHeartbeat,
  waitForMonitorStatus,
  waitForMonitorStatusWhilePinging,
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

/* The ingest round trip: nginx -> queue -> worker -> DB. Seconds, in practice. */
const HEARTBEAT_INGEST_TIMEOUT_MS: number = 90000;

/*
 * Recovery needs far LESS room than the outage.
 *
 * Going offline waits out a hard floor: NotRecievedInMinutes rejects 0 and
 * getDifferenceInMinutes truncates, so 120s of silence is the minimum, plus up
 * to 30s of CheckHeartbeat phase and the queue lag before the worker stamps
 * the arrival. Coming back is evaluated inline on the ingest itself, with no
 * cron on the critical path - single-digit seconds.
 */
const MONITOR_RECOVERY_TIMEOUT_MS: number = 180000;
const INCIDENT_TIMEOUT_MS: number = 120000;
const ON_CALL_TIMEOUT_MS: number = 120000;
const USER_ALERTED_TIMEOUT_MS: number = 120000;
const RESOLVE_TIMEOUT_MS: number = 180000;

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
   * The per-monitor secret the heartbeat URL is keyed on. Generated by the
   * server at creation, so it has to be read back rather than chosen.
   */
  type ReadIncomingRequestSecretKeyFunction = (
    monitorId: string,
  ) => Promise<string>;

  const readIncomingRequestSecretKey: ReadIncomingRequestSecretKeyFunction =
    async (monitorId: string): Promise<string> => {
      const monitor: JSONish = await getItem({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/monitor",
        id: monitorId,
        select: { _id: true, incomingRequestSecretKey: true },
      });

      /*
       * The column is an ObjectID, so it arrives as { _type, value } and
       * String() would make it "[object Object]" — which is exactly what the
       * ingest rejected as an invalid route.
       */
      const secretKey: string = toId(monitor["incomingRequestSecretKey"]);

      expect(
        secretKey,
        `monitor ${monitorId} should have been issued an incoming-request secret key`,
      ).not.toBe("");

      return secretKey;
    };

  /*
   * Drives one already-created monitor through the whole flow and returns the
   * ids so the caller can assert further (e.g. auto-resolve).
   *
   * The ORDER here is the design. The caller creates the monitor holding inert
   * criteria; this function then, in sequence:
   *
   *   1. proves the heartbeat ingest round-trips and leaves a real arrival
   *      timestamp on the monitor,
   *   2. attaches the on-call policy,
   *   3. sends one more heartbeat so the silence clock starts at ~0,
   *   4. and only then writes the criteria that can declare an incident.
   *
   * Steps 1 and 3 are what stop the elapsed-silence clock falling back to
   * monitor.createdAt: with the real criteria written at creation, a 120s fuse
   * would start burning immediately, and if create -> policy -> update overran
   * it an incident would open with no on-call policy attached and every
   * downstream assertion would fail for a non-reason. That is the same race
   * the previous probe-based version of this comment described.
   */
  type RunAlertingFlowFunction = (data: {
    monitorId: string;
    monitorName: string;
    secretKey: string;
    ids: MonitorStepIds;
    label: string;
    heartbeatBody?: JSONish | undefined;
    heartbeatHeaders?: Record<string, string> | undefined;
  }) => Promise<AlertingRunResult>;

  const runAlertingFlow: RunAlertingFlowFunction = async (data: {
    monitorId: string;
    monitorName: string;
    secretKey: string;
    ids: MonitorStepIds;
    label: string;
    heartbeatBody?: JSONish | undefined;
    heartbeatHeaders?: Record<string, string> | undefined;
  }): Promise<AlertingRunResult> => {
    /*
     * Ingest hop, and the fail-fast gate. A stack whose telemetry queue or
     * worker is not consuming fails here with a clear message instead of two
     * minutes later on the status poll.
     */
    await assertHeartbeatIngestIsLive({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId: data.monitorId,
      secretKey: data.secretKey,
      timeoutMs: HEARTBEAT_INGEST_TIMEOUT_MS,
    });

    const onCallDutyPolicyId: string = await createOnCallPolicyForUser({
      page: ctx.page,
      projectId: ctx.projectId,
      userId: ctx.user.userId,
      policyName: `E2E On-Call ${data.monitorName}`,
    });

    /* Restart the silence clock immediately before arming the criteria. */
    await sendHeartbeat({
      page: ctx.page,
      secretKey: data.secretKey,
      body: data.heartbeatBody,
      headers: data.heartbeatHeaders,
    });

    // API hop: arm the criteria and point them at the on-call policy.
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/monitor/${data.monitorId}`,
      method: "put",
      body: {
        data: {
          monitorSteps: buildHeartbeatMonitorSteps({
            ids: data.ids,
            monitorName: data.monitorName,
            defaults: ctx.defaults,
            onCallPolicyIds: [onCallDutyPolicyId],
          }),
        },
      },
    });

    await waitForMonitorStatus({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId: data.monitorId,
      expectedMonitorStatusId: ctx.defaults.offlineMonitorStatusId,
      description: `monitor "${data.monitorName}" to be reported offline after the heartbeat stops`,
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

  test("heartbeat monitor created in the dashboard pages the on-call user when it goes silent", async () => {
    test.setTimeout(600000);

    const monitorName: string = `E2E Heartbeat ${Faker.generateName().toString()}`;
    const ids: MonitorStepIds = newMonitorStepIds();

    /*
     * Dashboard hop: created through the real create-monitor form. This recipe
     * is the one CreateMonitors.spec.ts already proves - an Incoming Request
     * monitor takes no destination and no interval.
     */
    const recipe: MonitorTypeRecipe = {
      label: "Incoming Request",
      cardValue: "Incoming Request",
      hasInterval: false,
    };

    const monitorId: string = await createMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorName,
      recipe,
    });

    expect(monitorId, "the created monitor should have an id").not.toBe("");

    const secretKey: string = await readIncomingRequestSecretKey(monitorId);

    /*
     * Overwrite whatever criteria the form defaulted to with inert ones.
     *
     * The dashboard's default incoming-request criteria are body-keyword based
     * and deliberately do not look at the arrival clock, so they would never
     * drive a status change; and criteria that DID look at the clock would
     * start a 120s fuse at creation. Inert steps make this fixture independent
     * of both.
     */
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/monitor/${monitorId}`,
      method: "put",
      body: {
        data: {
          monitorSteps: buildInertIncomingRequestSteps({
            ids,
            monitorName,
            defaults: ctx.defaults,
          }),
        },
      },
    });

    const result: AlertingRunResult = await runAlertingFlow({
      monitorId,
      monitorName,
      secretKey,
      ids,
      label: "heartbeat",
    });

    /*
     * Recovery: start the heartbeat again. Nothing about the monitor changes -
     * the same online criteria that has been in place all along now matches,
     * because a heartbeat has just arrived. The incident was declared with
     * autoResolveIncident against these same criteria and template ids, so it
     * closes itself.
     *
     * Pinging on every poll, rather than once, is deliberate: a CheckHeartbeat
     * tick landing between the POST and the worker stamping its timestamp
     * would re-assert Offline.
     */
    await waitForMonitorStatusWhilePinging({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorId,
      secretKey,
      expectedMonitorStatusId: ctx.defaults.operationalMonitorStatusId,
      description: `monitor "${monitorName}" to recover to operational`,
      timeoutMs: MONITOR_RECOVERY_TIMEOUT_MS,
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

  test("heartbeat monitor created over the api pages the on-call user when it goes silent", async () => {
    test.setTimeout(480000);

    const monitorName: string = `E2E Heartbeat API ${Faker.generateName().toString()}`;
    const ids: MonitorStepIds = newMonitorStepIds();

    /*
     * This one is created straight over the REST API — the path an
     * integration, the Terraform provider or the CLI takes — to prove the
     * pipeline doesn't depend on the browser having assembled the payload.
     * The POST body and custom header ride on the heartbeat itself, so the
     * ingest's capture path is exercised too.
     *
     * Created with INERT criteria for the same reason test 1 is: real criteria
     * written at creation start a 120s fuse against monitor.createdAt, and an
     * incident that opened before the on-call policy was attached would fail
     * every downstream assertion for a non-reason.
     */
    const heartbeatBody: JSONish = { probe: "oneuptime-e2e" };
    const heartbeatHeaders: Record<string, string> = {
      "x-oneuptime-e2e": "true",
    };

    const created: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      item: {
        name: monitorName,
        description: "Created by the OneUptime e2e alerting spec.",
        projectId: ctx.projectId,
        monitorType: "Incoming Request",
        monitorSteps: buildInertIncomingRequestSteps({
          ids,
          monitorName,
          defaults: ctx.defaults,
        }),
      },
    });

    const monitorId: string = toId(created["_id"]);
    expect(monitorId, "the created monitor should have an id").not.toBe("");

    const secretKey: string = await readIncomingRequestSecretKey(monitorId);

    await runAlertingFlow({
      monitorId,
      monitorName,
      secretKey,
      ids,
      label: "heartbeat-api",
      heartbeatBody,
      heartbeatHeaders,
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
