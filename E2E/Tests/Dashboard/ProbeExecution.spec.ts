import { HOST, HTTP_PROTOCOL, IS_BILLING_ENABLED } from "../../Config";
import { Browser, Page, expect, test } from "@playwright/test";
import Protocol from "Common/Types/API/Protocol";
import Faker from "Common/Utils/Faker";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  assertMonitorHasProbes,
  assertTargetRefusedUnderEveryProbePolicy,
  createItem,
  getProjectDefaults,
  JSONish,
  listItems,
  MonitorStepIds,
  newMonitorStepIds,
  pollUntil,
  ProjectDefaults,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";

/*
 * The probe leg: a probe claiming work, opening a real socket, and its result
 * surviving the whole way back into the database.
 *
 * MonitorIncidentOnCall.spec.ts used to carry this, incidentally, by pointing
 * a Website monitor at the stack's own URL. Since 78b19735bd that cannot work:
 * every address which reaches this stack is loopback or RFC1918, an HTTP
 * monitor runs DataSourceEgressGuard over the RESOLVED address before opening
 * a socket, and a probe holding a REGISTER_PROBE_KEY refuses both tiers. Worse,
 * a refusal is indistinguishable from an outage, so that spec's outage half
 * passed for entirely the wrong reason while its recovery half could never
 * complete. It is now driven by a heartbeat monitor and involves no probe.
 *
 * This spec restores the probe coverage honestly, using the one probeable
 * monitor type that does NOT go through the HTTP egress guard: PortMonitor
 * opens a TCP connection and never calls assertUrlAllowed, so it can check the
 * ingress this stack publishes. That is a real, current boundary, pinned by
 * Probe/Tests/Utils/Monitors/MonitorTypes/PortMonitorEgressBoundary.test.ts -
 * if a future change puts Port monitors behind the guard, both files should be
 * updated deliberately rather than this one reverted.
 *
 * A separate file on purpose: the alerting spec runs serially, so a failure
 * there skips everything after it, and probe coverage must not evaporate with
 * an unrelated regression.
 *
 * Neither monitor here changes status, declares an incident or raises an
 * alert. The assertions read MonitorProbe.lastMonitoringLog directly, which is
 * what the probe writes, so probe count does not matter - the release stack
 * runs one probe, a dev stack runs two.
 */

const bareHost: string = HOST.split(":")[0] || "localhost";
const hostPort: string = HOST.includes(":") ? HOST.split(":")[1] || "" : "";

/*
 * Dial the IP literal, not the name: "localhost" can resolve to ::1 first
 * while compose publishes on 0.0.0.0, and it costs a DNS round trip either
 * way.
 */
const PROBE_TCP_HOST: string =
  bareHost === "localhost" ? "127.0.0.1" : bareHost;

/* The port nginx publishes (docker-compose.base.yml). */
const PROBE_TCP_PORT: number =
  Number(hostPort) || (HTTP_PROTOCOL === Protocol.HTTPS ? 443 : 80);

/*
 * 240.0.0.0/4 is "reserved address" in the guard's ALWAYS_BLOCKED tier, so it
 * is refused whatever a deployment's private-network policy says. Nothing is
 * listening on it, so even a fail-open regression could not exfiltrate
 * anything - it would simply fail to connect, and this test would still go red
 * because the refusal wording would be missing.
 */
const PROBE_ALWAYS_REFUSED_URL: string = "http://240.0.0.1/";

/*
 * A probe picks its work up from /monitor/list once a minute, after a random
 * stagger of up to 45 seconds, and the first cycle also has registration in
 * front of it.
 */
const PROBE_REPORT_TIMEOUT_MS: number = 300000;

interface MonitorProbeEntry {
  isOnline?: boolean | undefined;
  failureCause?: string | undefined;
  responseCode?: number | undefined;
  responseBody?: string | undefined;
  responseHeaders?: JSONish | undefined;
}

interface SharedContext {
  page: Page;
  projectId: string;
  defaults: ProjectDefaults;
  portMonitorId: string;
  portStepIds: MonitorStepIds;
  refusedMonitorId: string;
  refusedStepIds: MonitorStepIds;
}

/*
 * The probe never sees a browser: this spec creates its monitors over the API
 * and reads back what the probe wrote. Running it a second time in firefox
 * would double the wall clock, and would put two projects' worth of
 * every-minute monitors on the same single probe, for no extra coverage.
 */
test.skip(({ browserName }: { browserName: string }): boolean => {
  return browserName !== "chromium";
}, "Probe execution is API driven; the chromium run covers it.");

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("Probe executes checks and reports them", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    defaults: {
      operationalMonitorStatusId: "",
      offlineMonitorStatusId: "",
      incidentSeverityId: "",
      resolvedIncidentStateId: "",
    },
    portMonitorId: "",
    portStepIds: undefined as unknown as MonitorStepIds,
    refusedMonitorId: "",
    refusedStepIds: undefined as unknown as MonitorStepIds,
  };

  /*
   * A monitor whose criteria can never change its status, declare an incident
   * or raise an alert. All this spec wants is for the probe to run the check
   * and write what happened; anything else would add on-call noise to a suite
   * that already asserts that elsewhere.
   */
  type BuildInertStepFunction = (data: {
    ids: MonitorStepIds;
    monitorName: string;
    destination: JSONish;
    extra: JSONish;
    filters: Array<JSONish>;
  }) => JSONish;

  const buildInertProbeStep: BuildInertStepFunction = (data: {
    ids: MonitorStepIds;
    monitorName: string;
    destination: JSONish;
    extra: JSONish;
    filters: Array<JSONish>;
  }): JSONish => {
    return {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: {
              id: data.ids.stepId,
              monitorDestination: data.destination,
              ...(data.extra as Record<string, unknown>),
              monitorCriteria: {
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: [
                    {
                      _type: "MonitorCriteriaInstance",
                      value: {
                        id: data.ids.onlineCriteriaId,
                        monitorStatusId:
                          ctx.defaults.operationalMonitorStatusId,
                        filterCondition: FilterCondition.All,
                        filters: data.filters,
                        incidents: [],
                        alerts: [],
                        createAlerts: false,
                        createIncidents: false,
                        changeMonitorStatus: false,
                        name: `Observe ${data.monitorName}`,
                        description: `Records what the probe saw for ${data.monitorName}`,
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        defaultMonitorStatusId: ctx.defaults.operationalMonitorStatusId,
      },
    };
  };

  type ReadProbeEntryFunction = (data: {
    monitorId: string;
    stepId: string;
    description: string;
  }) => Promise<MonitorProbeEntry>;

  /*
   * The first lastMonitoringLog entry any probe has written for this step.
   * Reading per MonitorProbe row rather than aggregating means a stack with
   * two probes answers as soon as either has reported.
   */
  const readProbeEntry: ReadProbeEntryFunction = async (data: {
    monitorId: string;
    stepId: string;
    description: string;
  }): Promise<MonitorProbeEntry> => {
    return pollUntil<MonitorProbeEntry>({
      page: ctx.page,
      description: data.description,
      timeoutMs: PROBE_REPORT_TIMEOUT_MS,
      intervalMs: 5000,
      check: async (): Promise<MonitorProbeEntry | null> => {
        const rows: Array<JSONish> = await listItems({
          page: ctx.page,
          projectId: ctx.projectId,
          path: "/api/monitor-probe",
          query: { monitorId: data.monitorId },
          select: { _id: true, probeId: true, lastMonitoringLog: true },
          limit: 10,
        });

        for (const row of rows) {
          const log: JSONish | undefined = row["lastMonitoringLog"] as
            | JSONish
            | undefined;

          const entry: MonitorProbeEntry | undefined = log
            ? ((log as Record<string, unknown>)[data.stepId] as
                | MonitorProbeEntry
                | undefined)
            : undefined;

          if (entry) {
            return entry;
          }
        }

        return null;
      },
    });
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(420000);

    ctx.page = await browser.newPage();

    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Probe Execution Project",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });

    ctx.defaults = await getProjectDefaults({
      page: ctx.page,
      projectId: ctx.projectId,
    });

    ctx.portStepIds = newMonitorStepIds();
    ctx.refusedStepIds = newMonitorStepIds();

    const portMonitorName: string = `E2E Port ${Faker.generateName().toString()}`;

    /*
     * No Response Status Code filter anywhere: APIRequestCriteria gates that
     * branch on a responseCode a Port response never sets, so under a
     * filterCondition of All it would make the criteria permanently
     * unmatchable.
     */
    const portMonitor: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      item: {
        name: portMonitorName,
        description: "Created by the OneUptime e2e probe-execution spec.",
        projectId: ctx.projectId,
        monitorType: "Port",
        monitoringInterval: "* * * * *",
        minimumProbeAgreement: 1,
        monitorSteps: buildInertProbeStep({
          ids: ctx.portStepIds,
          monitorName: portMonitorName,
          destination: { _type: "IP", value: PROBE_TCP_HOST },
          extra: {
            monitorDestinationPort: { _type: "Port", value: PROBE_TCP_PORT },
          },
          filters: [{ checkOn: CheckOn.IsOnline, filterType: FilterType.True }],
        }),
      },
    });

    ctx.portMonitorId = toId(portMonitor["_id"]);
    expect(ctx.portMonitorId, "the Port monitor should have an id").not.toBe(
      "",
    );

    const refusedMonitorName: string = `E2E Refused ${Faker.generateName().toString()}`;

    const refusedMonitor: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      item: {
        name: refusedMonitorName,
        description: "Created by the OneUptime e2e probe-execution spec.",
        projectId: ctx.projectId,
        monitorType: "API",
        monitoringInterval: "* * * * *",
        minimumProbeAgreement: 1,
        monitorSteps: buildInertProbeStep({
          ids: ctx.refusedStepIds,
          monitorName: refusedMonitorName,
          destination: { _type: "URL", value: PROBE_ALWAYS_REFUSED_URL },
          extra: { requestType: "GET", requestHeaders: {}, requestBody: "" },
          filters: [
            { checkOn: CheckOn.IsOnline, filterType: FilterType.False },
          ],
        }),
      },
    });

    ctx.refusedMonitorId = toId(refusedMonitor["_id"]);
    expect(
      ctx.refusedMonitorId,
      "the refused-target monitor should have an id",
    ).not.toBe("");

    /*
     * Nothing here can happen without a probe. Assert the assignment exists so
     * a stack whose probe never registered fails with a clear message rather
     * than five minutes later on a report poll.
     */
    for (const monitorId of [ctx.portMonitorId, ctx.refusedMonitorId]) {
      await assertMonitorHasProbes({
        page: ctx.page,
        projectId: ctx.projectId,
        monitorId,
        timeoutMs: 180000,
      });
    }
  });

  test.afterAll(async () => {
    /*
     * Both monitors are checked every minute for the life of the stack
     * otherwise. Best effort: a cleanup failure must never fail the suite.
     */
    for (const monitorId of [ctx.portMonitorId, ctx.refusedMonitorId]) {
      if (!monitorId) {
        continue;
      }

      try {
        await requestJson({
          page: ctx.page,
          projectId: ctx.projectId,
          path: `/api/monitor/${monitorId}`,
          method: "put",
          body: { data: { disableActiveMonitoring: true } },
        });
      } catch {
        // Cleanup is best effort.
      }
    }

    await ctx.page.close();
  });

  test("a probe executes a real check and reports the result", async () => {
    test.setTimeout(420000);

    const entry: MonitorProbeEntry = await readProbeEntry({
      monitorId: ctx.portMonitorId,
      stepId: ctx.portStepIds.stepId,
      description: `a probe to report a check of ${PROBE_TCP_HOST}:${PROBE_TCP_PORT}`,
    });

    /*
     * This is the assertion that goes red if a probe stops registering, stops
     * claiming work from /monitor/list, stops opening sockets, or stops
     * reporting through /probe/response/ingest — the class of failure nothing
     * else in the repo detects.
     */
    expect(
      entry.isOnline,
      `A probe should have reached the ingress at ${PROBE_TCP_HOST}:${PROBE_TCP_PORT}`,
    ).toBe(true);
  });

  test("a probe refuses an always-blocked target and reports the refusal", async () => {
    test.setTimeout(420000);

    /*
     * The guard's own words, asserted to be identical under both values of
     * blockPrivateAddresses — a target refused only under the strict policy
     * would stop being refused on a deployment that allows private networks,
     * and this test would quietly stop meaning anything.
     */
    const expectedRefusal: string =
      await assertTargetRefusedUnderEveryProbePolicy(PROBE_ALWAYS_REFUSED_URL);

    const entry: MonitorProbeEntry = await readProbeEntry({
      monitorId: ctx.refusedMonitorId,
      stepId: ctx.refusedStepIds.stepId,
      description: `a probe to report its refusal of ${PROBE_ALWAYS_REFUSED_URL} (expected: ${expectedRefusal})`,
    });

    /*
     * Deliberately NOT asserting failureCause === expectedRefusal: the helper
     * calls the same Common build the probe does, so that comparison would be
     * tautological. The substring is the part that carries meaning.
     */
    expect(
      String(entry.failureCause),
      "the probe should report the guard's refusal as the cause",
    ).toContain("is not allowed: reserved address");

    /*
     * And these three are what actually prove no socket was opened: a probe
     * that connected would have something to say about the response.
     */
    expect(
      entry.responseCode,
      "no response code — nothing was dialled",
    ).toBeFalsy();
    expect(
      entry.responseBody,
      "no response body — nothing was dialled",
    ).toBeFalsy();

    /*
     * Headers default to {} rather than being absent, so emptiness is the
     * assertion — an empty header map is exactly as much proof that no socket
     * was opened as a missing one, and toBeFalsy() rejects it.
     */
    expect(
      Object.keys(entry.responseHeaders || {}),
      "no response headers — nothing was dialled",
    ).toEqual([]);
  });
});
