import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionPoller from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  DAY_MS,
  GoogleSecOpsTenant,
  HOUR_MS,
  MINUTE_MS,
  PollPersistence,
  TENANT_CURATED_RULE_ID,
  TenantRequest,
  eventUidsOf,
  findCheck,
  lastUpdate,
  secOpsConnection,
  stubPollPersistence,
} from "./GoogleSecOpsPollingFixtures";

/*
 * The reported failure, end to end: a Google SecOps connection that polled
 * cleanly — every check green, "0 imported; 0 already imported", status
 * empty, cursor advancing — while the tenant had alerts that never reached
 * OneUptime. The run the customer shared:
 *
 *   window 2026-09-15T12:47:15.762Z .. 12:51:55.794Z, basis created-time,
 *   Read rule detections by created time: 0, Read curated rule detections
 *   by created time: 0, Read alerts view by detection time: 0
 *
 * Two defects produced it, and both answer HTTP 200 with nothing, which is
 * why nothing looked wrong:
 *
 *  1. Curated (Google-authored) rule detections were searched with
 *     ruleId=-. legacySearchCuratedDetections has no wildcard; its ruleId is
 *     "The specific Curated Rule ID". The simulated tenant answers that the
 *     way Google does, with an empty success.
 *  2. The alerts view filters on detection time and was read only over the
 *     poll's own few minutes, so an alert Google made readable after the
 *     poll that covered its detection time was skipped for good.
 *
 * The REAL poller, connector and client run here over the simulated tenant;
 * only the transport and persistence are fake.
 */

jest.mock(
  "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const NOW: Date = new Date("2026-09-15T12:51:55.794Z");
// The customer's saved cursor: the window starts one overlap minute earlier.
const CURSOR: string = "2026-09-15T12:48:15.762Z";

let tenant: GoogleSecOpsTenant;
let persistence: PollPersistence;

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  persistence = stubPollPersistence();
  tenant = new GoogleSecOpsTenant();
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

async function poll(
  connection: SecurityEventConnection = secOpsConnection({
    cursor: CURSOR,
    alertingOnly: false,
  }),
): Promise<SecurityEventConnectionRunResult> {
  return SecurityEventConnectionPoller.executeConnection(
    connection,
    { type: "poll" },
    tenant.overrides(),
  );
}

function curatedRuleIdsSent(): Array<string> {
  return tenant.requestsTo("curated").map((request: TenantRequest): string => {
    return request.url.searchParams.get("ruleId") || "";
  });
}

describe("Google SecOps polls that imported nothing from a tenant with alerts", () => {
  test("the customer's poll window now imports the curated detections created in it", async () => {
    // Two curated rules fired inside the window; their events are older.
    tenant.add({
      id: "de_curated_1",
      curated: true,
      curatedRuleId: "ur_ttp_GCP_MassSecretDeletion",
      createdMs: NOW.getTime() - 2 * MINUTE_MS,
      detectionMs: NOW.getTime() - 40 * MINUTE_MS,
    });
    tenant.add({
      id: "de_curated_2",
      curated: true,
      createdMs: NOW.getTime() - MINUTE_MS,
      detectionMs: NOW.getTime() - 5 * HOUR_MS,
    });

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.windowStart).toBe("2026-09-15T12:47:15.762Z");
    expect(result.windowEnd).toBe("2026-09-15T12:51:55.794Z");
    expect(result).toMatchObject({
      status: "success",
      complete: true,
      ingestedCount: 2,
    });
    expect(eventUidsOf(persistence.insertedBatches[0]!)).toEqual([
      "de_curated_1",
      "de_curated_2",
    ]);
    // Never the wildcard: one search per curated rule the counts named.
    expect(curatedRuleIdsSent().sort()).toEqual(
      [TENANT_CURATED_RULE_ID, "ur_ttp_GCP_MassSecretDeletion"].sort(),
    );
    expect(curatedRuleIdsSent()).not.toContain("-");
    expect(tenant.requestsTo("curatedCounts")).toHaveLength(1);
    expect(
      findCheck(result.checks, "read-curated-detections").message,
    ).toContain("2 curated rule detections returned for the window");
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
  });

  test("the wildcard request the connector used to send really does come back empty from this tenant", async () => {
    tenant.add({
      id: "de_curated_1",
      curated: true,
      createdMs: NOW.getTime() - 2 * MINUTE_MS,
      detectionMs: NOW.getTime() - 40 * MINUTE_MS,
    });

    const reply: { text: () => Promise<string>; status: number } =
      await tenant.fetch(
        `https://us-chronicle.googleapis.com/v1alpha/projects/test-project/locations/us/instances/test-instance/legacy:legacySearchCuratedDetections?ruleId=-&startTime=2026-09-15T12%3A47%3A15.762Z&endTime=2026-09-15T12%3A51%3A55.794Z&listBasis=CREATED_TIME&pageSize=1000`,
        {
          method: "GET",
          headers: { Authorization: "Bearer tenant-access-token" },
        },
      );

    // The shape of the silent failure: success, and nothing in it.
    expect(reply.status).toBe(200);
    expect(JSON.parse(await reply.text())).toEqual({});
  });

  test("an alert Google made readable after the poll covering its detection time is imported by the next poll", async () => {
    // Poll 1: nothing readable yet.
    const first: SecurityEventConnectionRunResult = await poll();
    expect(first.ingestedCount).toBe(0);

    /*
     * Google makes a SOAR alert readable now. Its detection time is three
     * hours ago, far behind the cursor poll 1 wrote, and neither detection
     * search knows about it.
     */
    tenant.add({
      id: "soar_alert_1",
      alertsViewOnly: true,
      createdMs: NOW.getTime(),
      detectionMs: NOW.getTime() - 3 * HOUR_MS,
      record: {
        id: "soar_alert_1",
        type: "SOAR_ALERT",
        createdTime: NOW.toISOString(),
        detectionTime: new Date(NOW.getTime() - 3 * HOUR_MS).toISOString(),
        soarAlertMetadata: { sourceRule: "Impossible travel" },
      },
    });

    const later: Date = new Date(NOW.getTime() + 5 * MINUTE_MS);
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(later);
    const requestsBefore: number = tenant.requests.length;

    const second: SecurityEventConnectionRunResult = await poll(
      secOpsConnection({
        cursor: String(lastUpdate(persistence)["cursor"]),
        alertingOnly: false,
      }),
    );

    expect(second).toMatchObject({
      status: "success",
      complete: true,
      ingestedCount: 1,
    });
    expect(
      eventUidsOf(
        persistence.insertedBatches[persistence.insertedBatches.length - 1]!,
      ),
    ).toEqual(["soar_alert_1"]);
    expect(findCheck(second.checks, "read-late-alerts-view").status).toBe(
      "pass",
    );

    // The sweep asked for alerts only, over the day before the window.
    const alertsRequests: Array<TenantRequest> = tenant.requests
      .slice(requestsBefore)
      .filter((request: TenantRequest): boolean => {
        return request.route === "alerts";
      });
    expect(alertsRequests).toHaveLength(2);
    const sweep: URLSearchParams = alertsRequests[1]!.url.searchParams;
    expect(sweep.get("timeRange.startTime")).toBe(
      new Date(later.getTime() - DAY_MS).toISOString(),
    );
    expect(sweep.get("timeRange.endTime")).toBe(second.windowStart);
    expect(sweep.get("includeNonAlertingDetections")).toBe(
      "ALERTS_FEATURE_PREFERENCE_DISABLED",
    );

    // A third poll re-reads it in the sweep and stores nothing twice.
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      new Date(later.getTime() + 5 * MINUTE_MS),
    );
    const third: SecurityEventConnectionRunResult = await poll(
      secOpsConnection({
        cursor: String(lastUpdate(persistence)["cursor"]),
        alertingOnly: false,
      }),
    );
    expect(third).toMatchObject({ ingestedCount: 0, duplicateCount: 1 });
  });

  test("a sweep Google rejects leaves the poll complete and moves the cursor", async () => {
    tenant.add({
      id: "rule_1",
      createdMs: NOW.getTime() - 2 * MINUTE_MS,
      detectionMs: NOW.getTime() - 3 * MINUTE_MS,
    });
    tenant.scripts.alerts = (
      request: TenantRequest,
    ): { status: number; body: string } | undefined => {
      // Only the sweep (ending at the window start) fails.
      return request.url.searchParams.get("timeRange.endTime") ===
        "2026-09-15T12:47:15.762Z"
        ? {
            status: 503,
            body: JSON.stringify({
              error: { code: 503, status: "UNAVAILABLE", message: "later" },
            }),
          }
        : undefined;
    };

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      ingestedCount: 1,
    });
    expect(findCheck(result.checks, "read-late-alerts-view").status).toBe(
      "warn",
    );
    const written: JSONObject = lastUpdate(persistence);
    expect(written["cursor"]).toBe(NOW.toISOString());
    // A complete poll clears Last Error; the warning stays on the run.
    expect(written["lastError"]).toBeNull();
    expect(
      result.warnings.some((warning: string): boolean => {
        return warning.startsWith(
          "The late-alert sweep of the alerts view could not be read",
        );
      }),
    ).toBe(true);
  });
});
