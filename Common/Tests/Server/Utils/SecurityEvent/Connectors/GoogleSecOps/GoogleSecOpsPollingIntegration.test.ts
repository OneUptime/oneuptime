import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService from "../../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../../Server/Utils/AnalyticsDatabase/Statement";
import SecurityEventConnectionPoller from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import SecurityEventDedupe from "../../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher, {
  EnrichmentResult,
} from "../../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
  SECURITY_CONNECTION_ID_ATTRIBUTE,
  SecurityEventConnectionRunResult,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import GoogleSecOpsAlertNormalizer from "../../../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { secOpsSettings } from "./GoogleSecOpsConnectorFixtures";
import {
  CONNECTION_ID,
  DAY_MS,
  GoogleSecOpsTenant,
  HOUR_MS,
  MINUTE_MS,
  PROJECT_ID,
  PollPersistence,
  TenantDetection,
  TenantRequest,
  eventUidsOf,
  findCheck,
  keysAndStatuses,
  lastUpdate,
  requestWindow,
  secOpsConnection,
  storedResult,
  streamReply,
  stubPollPersistence,
  googleError,
} from "./GoogleSecOpsPollingFixtures";

/*
 * One Google SecOps poll at a time through the shared loop: the REAL
 * SecurityEventConnectionPoller.executeConnection (and pollConnection) with
 * the REAL GoogleSecOpsConnector and GoogleSecOpsClient over a simulated
 * tenant, injected through PollerOverrides the way the generic poller suite
 * injects its fake connector.
 *
 * These are the cases the retired GoogleSecOpsPoller, GoogleSecOpsPollerHardening,
 * GoogleSecOpsThreePassPoller and GoogleSecOpsDiagnostics suites pinned on
 * the poller side: which outcomes may move the cursor, what the window
 * resolves to for a missing, stale, unreadable or future cursor, how records
 * Google returns but OneUptime cannot import are counted, what a preview and
 * a backfill may write, and that detections stay in the Google /
 * Google SecOps dedupe scope connections carried over from that poller
 * already imported under. Where the shared loop intentionally behaves
 * differently, the test asserts the new behaviour and names the old one.
 *
 * The registry is mocked out, as in the generic poller suite, so importing
 * the poller does not load every other provider's connector.
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

const NOW: Date = new Date("2026-09-10T12:00:00.000Z");
const CURSOR: string = "2026-09-10T11:55:00.000Z";

function iso(timeMs: number): string {
  return new Date(timeMs).toISOString();
}

// A rule detection created and detected inside the window a CURSOR poll reads.
function recentDetection(
  id: string,
  changes: Partial<TenantDetection> = {},
): TenantDetection {
  return {
    id,
    createdMs: NOW.getTime() - 2 * MINUTE_MS,
    detectionMs: NOW.getTime() - 3 * MINUTE_MS,
    ...changes,
  };
}

/*
 * A Collection whose detection entry names a rule and carries a matched UDM
 * sample event, so the finding row has entities rather than an empty shell.
 */
function alertOneRecord(): JSONObject {
  return {
    id: "alert-1",
    type: "RULE_DETECTION",
    detectionTime: iso(NOW.getTime() - 3 * MINUTE_MS),
    createdTime: iso(NOW.getTime() - 2 * MINUTE_MS),
    detection: [
      {
        ruleName: "Suspicious PowerShell",
        ruleId: "ru_1a2b",
        severity: "HIGH",
        alertState: "ALERTING",
      },
    ],
    collectionElements: [
      {
        label: "e1",
        references: [
          {
            event: {
              metadata: {
                eventType: "PROCESS_LAUNCH",
                eventTimestamp: iso(NOW.getTime() - 4 * MINUTE_MS),
              },
              principal: {
                hostname: "workstation-14",
                ip: ["10.1.2.3"],
                user: { userid: "jsmith" },
              },
              target: { ip: ["203.0.113.9"], port: 443 },
            },
          },
        ],
      },
    ],
  };
}

function durationOf(window: { startTime: string; endTime: string }): number {
  return Date.parse(window.endTime) - Date.parse(window.startTime);
}

function onlyAlertsRequest(
  tenant: GoogleSecOpsTenant,
  fromIndex: number = 0,
): TenantRequest {
  const alerts: Array<TenantRequest> = tenant.requests
    .slice(fromIndex)
    .filter((request: TenantRequest): boolean => {
      return request.route === "alerts";
    });
  expect(alerts).toHaveLength(1);
  return alerts[0]!;
}

/*
 * Replaces the normalizer for the records whose id is listed, so a record
 * fails the way a normalizer fault does. A hostile getter cannot survive
 * the JSON the real client parses, so this is the seam the retired
 * diagnostics suite used for the same purpose.
 */
function failNormalizationFor(ids: Array<string>): void {
  const normalize: (alert: JSONObject) => NormalizedSecurityEvent =
    GoogleSecOpsAlertNormalizer.normalize.bind(GoogleSecOpsAlertNormalizer);
  getJestSpyOn(GoogleSecOpsAlertNormalizer, "normalize").mockImplementation(((
    alert: JSONObject,
  ): NormalizedSecurityEvent => {
    if (ids.includes(String(alert["id"]))) {
      throw new Error("broken data");
    }
    return normalize(alert);
  }) as never);
}

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
  connection: SecurityEventConnection = secOpsConnection({ cursor: CURSOR }),
): Promise<SecurityEventConnectionRunResult> {
  return SecurityEventConnectionPoller.executeConnection(
    connection,
    { type: "poll" },
    tenant.overrides(),
  );
}

describe("Google SecOps through the shared poller: ingest and bookkeeping", () => {
  test("ingests detections as Detection Finding rows and advances the cursor", async () => {
    tenant.add(
      recentDetection("alert-1", {
        record: {
          id: "alert-1",
          detectionTime: iso(NOW.getTime() - 3 * MINUTE_MS),
          createdTime: iso(NOW.getTime() - 2 * MINUTE_MS),
          detection: [{ ruleName: "Brute force", severity: "HIGH" }],
        },
      }),
    );

    const ingested: number = await SecurityEventConnectionPoller.pollConnection(
      secOpsConnection({ cursor: CURSOR }),
      tenant.overrides(),
    );

    // Read by the created-time search AND the alerts view, imported once.
    expect(ingested).toBe(1);
    expect(persistence.insertedBatches).toHaveLength(1);
    const row: JSONObject = persistence.insertedBatches[0]![0]!;
    expect(row["classUid"]).toBe(2004);
    expect(row["className"]).toBe("Detection Finding");
    expect(row["ruleName"]).toBe("Brute force");
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["vendorName"]).toBe("Google");
    expect(row["productName"]).toBe("Google SecOps");

    expect(persistence.updates).toHaveLength(1);
    const written: JSONObject = persistence.updates[0]!.data;
    expect(typeof written["cursor"]).toBe("string");
    expect(written["cursor"]).toBe(NOW.toISOString());
    expect(written["lastError"]).toBeNull();
  });

  test("the cursor written is exactly the endTime every pass was asked for", async () => {
    // The alerts view answers in its real chunked envelope.
    tenant.scripts.alerts = (): ReturnType<typeof streamReply> => {
      return streamReply([
        { alerts: { alerts: [alertOneRecord()] } },
        { complete: true, progress: 1 },
      ]);
    };

    const result: SecurityEventConnectionRunResult =
      await poll(secOpsConnection());

    const sent: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant),
    );
    // The parameter really is an ISO instant, not some other rendering.
    expect(new Date(sent.endTime).toISOString()).toBe(sent.endTime);
    for (const request of [
      ...tenant.requestsTo("search"),
      ...tenant.requestsTo("curated"),
    ]) {
      expect(requestWindow(request)).toEqual(sent);
    }

    const written: JSONObject = lastUpdate(persistence);
    expect(written["cursor"]).toBe(sent.endTime);
    expect(written["cursor"]).toBe(result.windowEnd);
    expect((written["lastPolledAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      Date.parse(sent.endTime),
    );
    // ...and the window it closes really did start earlier than it ends.
    expect(Date.parse(sent.startTime)).toBeLessThan(Date.parse(sent.endTime));
    expect(result.ingestedCount).toBe(1);
  });

  test("no detections: no telemetry service resolution, no insert, one bookkeeping write, and the cursor still advances", async () => {
    const ingested: number = await SecurityEventConnectionPoller.pollConnection(
      secOpsConnection({ cursor: CURSOR }),
      tenant.overrides(),
    );

    expect(ingested).toBe(0);
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(persistence.updates).toHaveLength(1);
    expect(persistence.updates[0]!.data["cursor"]).toBe(NOW.toISOString());
  });

  test("a recognized quiet stream is an empty, complete poll that clears lastError and stamps lastSuccessfulPollAt", async () => {
    // Recognized chunk fields, zero alerts, complete; the searches answer {}.
    tenant.scripts.alerts = (): ReturnType<typeof streamReply> => {
      return streamReply([{ complete: true, progress: 1 }]);
    };

    await poll(secOpsConnection());

    const written: JSONObject = lastUpdate(persistence);
    expect(written).toEqual(
      expect.objectContaining({
        cursor: expect.any(String),
        lastPolledAt: expect.any(Date),
        lastPollResult: expect.any(Object),
      }),
    );
    expect(written["cursor"]).toBe(
      requestWindow(onlyAlertsRequest(tenant)).endTime,
    );
    expect(written["lastError"]).toBeNull();
    expect(written["lastPollResult"]).toEqual(
      expect.objectContaining({
        status: "empty",
        fetchedCount: 0,
        ingestedCount: 0,
        complete: true,
      }),
    );
    expect(written["lastSuccessfulPollAt"]).toBeInstanceOf(Date);
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
  });

  test("a complete quiet poll echoes its run id and writes cursor, lastSuccessfulPollAt, lastPollResult and a null lastError", async () => {
    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll", runId: "run-checkpoint-1" },
        tenant.overrides(),
      );

    expect(result.status).toBe("empty");
    expect(result.runId).toBe("run-checkpoint-1");
    expect(lastUpdate(persistence)).toMatchObject({
      cursor: NOW.toISOString(),
      lastSuccessfulPollAt: NOW,
      lastPollResult: result,
      lastError: null,
    });
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("the ingested count is returned and matches the rows written, with the unrecognized record counted as rejected", async () => {
    tenant.add(recentDetection("alert-1", { record: alertOneRecord() }));
    tenant.add(recentDetection("alert-2"));
    /*
     * A stream-chunk-shaped object handed back as a detection. Detected long
     * ago, so only the created-time search returns it.
     */
    tenant.add({
      id: "envelope",
      createdMs: NOW.getTime() - MINUTE_MS,
      detectionMs: NOW.getTime() - 30 * DAY_MS,
      record: { progress: 0.5, complete: false },
    });

    const ingested: number = await SecurityEventConnectionPoller.pollConnection(
      secOpsConnection({ cursor: CURSOR }),
      tenant.overrides(),
    );

    expect(ingested).toBe(2);
    expect(persistence.insertedBatches[0]!).toHaveLength(ingested);
    expect(lastUpdate(persistence)["lastPollResult"]).toEqual(
      expect.objectContaining({
        fetchedCount: 3,
        ingestedCount: 2,
        rejectedCount: 1,
      }),
    );
  });

  test("a multi-detection batch is written in a single synchronous insert", async () => {
    tenant.add(recentDetection("alert-1", { record: alertOneRecord() }));
    tenant.add(recentDetection("alert-2"));

    await poll();

    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledTimes(1);
    expect(persistence.insertedBatches).toHaveLength(1);
    expect(eventUidsOf(persistence.insertedBatches[0]!)).toEqual([
      "alert-1",
      "alert-2",
    ]);
    expect(persistence.insertOptions[0]).toEqual({
      clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
    });
  });

  test("threat intel is stamped on polled detections before the rows are built", async () => {
    const enrichCalls: Array<{
      projectId: ObjectID;
      events: Array<NormalizedSecurityEvent>;
    }> = [];
    /*
     * Replacing the implementation on the spy already installed, rather
     * than spying again, so the restore returns the real method.
     */
    getJestSpyOn(
      ThreatIntelEnricher,
      "enrichNormalizedEvents",
    ).mockImplementation(((data: {
      projectId: ObjectID;
      events: Array<NormalizedSecurityEvent>;
    }): Promise<EnrichmentResult> => {
      enrichCalls.push(data);
      for (const event of data.events) {
        event.attributes["threat.matched"] = "true";
      }
      return Promise.resolve({
        eventsMatched: data.events.length,
        valuesLookedUp: 1,
      });
    }) as never);
    tenant.add(recentDetection("alert-1", { record: alertOneRecord() }));

    await poll();

    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(enrichCalls[0]!.events).toHaveLength(1);
    expect(enrichCalls[0]!.events[0]!.classUid).toBe(2004);

    /*
     * The stamp survives into the row, which is only true if enrichment
     * runs ahead of buildSecurityEventDbRow.
     */
    const row: JSONObject = persistence.insertedBatches[0]![0]!;
    expect((row["attributes"] as JSONObject)["threat.matched"]).toBe("true");
    expect(row["attributeKeys"] as Array<string>).toContain("threat.matched");
    expect(row["principalHost"]).toBe("workstation-14");
  });

  test("the success path still clears lastError and advances a stale cursor", async () => {
    const staleCursor: Date = new Date(NOW.getTime() - 30 * MINUTE_MS);

    const ingested: number = await SecurityEventConnectionPoller.pollConnection(
      secOpsConnection({ cursor: staleCursor.toISOString() }),
      tenant.overrides(),
    );

    expect(ingested).toBe(0);
    expect(persistence.updates).toHaveLength(1);
    const written: JSONObject = persistence.updates[0]!.data;
    expect(written["lastError"]).toBeNull();
    expect(written["lastPolledAt"]).toBeInstanceOf(Date);
    expect(new Date(written["cursor"] as string).getTime()).toBeGreaterThan(
      staleCursor.getTime(),
    );
  });
});

describe("Google SecOps through the shared poller: windows and the cursor", () => {
  test("the first poll looks back 24 hours, and a cursor poll overlaps the cursor by one minute", async () => {
    await poll(secOpsConnection());

    const first: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant),
    );
    expect(durationOf(first)).toBe(DAY_MS);

    const cursor: Date = new Date(NOW.getTime() - 5 * MINUTE_MS);
    const before: number = tenant.requests.length;
    await poll(secOpsConnection({ cursor: cursor.toISOString() }));

    const second: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant, before),
    );
    expect(cursor.getTime() - Date.parse(second.startTime)).toBe(MINUTE_MS);
  });

  test("a week-old cursor reads one day past the cursor plus the one minute overlap", async () => {
    const cursor: string = iso(NOW.getTime() - 7 * DAY_MS);

    await poll(secOpsConnection({ cursor }));

    /*
     * Review finding alerts-view-budget-pins-cursor-forever (F1): the
     * catch-up chunk is measured from the cursor rather than from the
     * overlapped window start.
     */
    const window: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant),
    );
    expect(durationOf(window)).toBe(DAY_MS + MINUTE_MS);
    expect(Date.parse(window.endTime)).toBe(Date.parse(cursor) + DAY_MS);
  });

  test("an unreadable cursor polls the default 24 hour window, exactly like a first poll", async () => {
    const windows: Array<{ startTime: string; endTime: string }> = [];

    for (const cursor of [
      undefined,
      iso(NOW.getTime() - 7 * DAY_MS),
      "garbage",
    ]) {
      const before: number = tenant.requests.length;
      await poll(secOpsConnection(cursor === undefined ? {} : { cursor }));
      windows.push(requestWindow(onlyAlertsRequest(tenant, before)));
    }

    const [firstPoll, stale, garbage] = windows;
    expect(durationOf(firstPoll!)).toBe(DAY_MS);
    // F1: a day of new time past the cursor plus the overlap minute before it.
    expect(durationOf(stale!)).toBe(DAY_MS + MINUTE_MS);
    /*
     * An unreadable cursor means "no usable cursor", which is what a first
     * poll means: it ends now, rather than a day after wherever the garbage
     * would have pointed.
     */
    expect(durationOf(garbage!)).toBe(durationOf(firstPoll!));
    expect(garbage!.endTime).toBe(firstPoll!.endTime);
    expect(Date.parse(stale!.endTime)).toBeLessThan(
      Date.parse(firstPoll!.endTime),
    );
  });

  test("an unreadable cursor is reported in the persisted diagnostics", async () => {
    await poll(secOpsConnection({ cursor: "2026-13-45T99:99:99Z" }));

    expect(storedResult(lastUpdate(persistence)).warnings.join(" ")).toMatch(
      /cursor is unreadable/,
    );
  });

  test("a cursor in the future never produces an inverted time range", async () => {
    await poll(secOpsConnection());
    const firstPoll: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant),
    );

    // Clock skew on the writer, or a restored backup.
    const before: number = tenant.requests.length;
    await poll(secOpsConnection({ cursor: iso(NOW.getTime() + HOUR_MS) }));
    const future: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant, before),
    );

    expect(Date.parse(future.startTime)).toBeLessThan(
      Date.parse(future.endTime),
    );
    expect(durationOf(future)).toBe(durationOf(firstPoll));
    expect(persistence.logs.warn.join(" ")).toMatch(/cursor is in the future/);
  });

  test("a stale cursor catches up from its original boundary without discarding the gap", async () => {
    const cursor: string = iso(NOW.getTime() - 7 * DAY_MS);

    await poll(secOpsConnection({ cursor }));

    const stale: { startTime: string; endTime: string } = requestWindow(
      onlyAlertsRequest(tenant),
    );
    // F1: a day past the cursor, plus the overlap minute before it.
    expect(durationOf(stale)).toBe(DAY_MS + MINUTE_MS);
    expect(Date.parse(stale.endTime)).toBe(Date.parse(cursor) + DAY_MS);
    expect(Date.parse(stale.startTime)).toBe(Date.parse(cursor) - MINUTE_MS);
    expect(Date.parse(stale.endTime)).toBeLessThan(NOW.getTime() - 5 * DAY_MS);
    const written: JSONObject = lastUpdate(persistence);
    expect(written["cursor"]).toBe(stale.endTime);
    expect(storedResult(written).warnings.join(" ")).toMatch(/Catching up/);
  });

  test("stale cursors process the earliest backlog instead of skipping to yesterday", async () => {
    const result: SecurityEventConnectionRunResult = await poll(
      secOpsConnection({ cursor: "2026-09-01T12:00:00.000Z" }),
    );

    expect(result.windowStart).toBe("2026-09-01T11:59:00.000Z");
    // F1: the 24 hour chunk is measured from the cursor, not the overlapped start.
    expect(result.windowEnd).toBe("2026-09-02T12:00:00.000Z");
    expect(lastUpdate(persistence)["cursor"]).toBe(result.windowEnd);
  });
});

describe("Google SecOps through the shared poller: records that cannot be imported", () => {
  test("rejected objects are counted and warned but do not hold the cursor", async () => {
    tenant.add(recentDetection("ok"));
    tenant.add({
      id: "envelope",
      createdMs: NOW.getTime() - MINUTE_MS,
      detectionMs: NOW.getTime() - 30 * DAY_MS,
      record: { arbitrary: "envelope" },
    });

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      rejectedCount: 1,
      ingestedCount: 1,
    });
    /*
     * The retired poller named this check "Normalize detections" and warned
     * that rejected objects "do not hold the poll cursor". The shared loop
     * reports it on its summary read check and words the warning itself.
     */
    expect(findCheck(result.checks, "read").status).toBe("warn");
    expect(result.warnings).toContain(
      "1 returned records were discarded because they do not look like Google SecOps detections.",
    );
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
    expect(lastUpdate(persistence)["lastError"]).toBeNull();
  });

  test("unrecognized payloads in the alerts view are counted and warned without holding the cursor", async () => {
    tenant.scripts.alerts = (): ReturnType<typeof streamReply> => {
      return streamReply([
        {
          alerts: {
            alerts: [
              { arbitrary: "envelope" },
              {
                id: "alert-1",
                detectionTime: iso(NOW.getTime() - 3 * MINUTE_MS),
                detection: [{ ruleName: "Suspicious sign-in" }],
              },
            ],
          },
          complete: true,
          progress: 1,
          baselineAlertsCount: 2,
          filteredAlertsCount: 2,
        },
      ]);
    };

    const result: SecurityEventConnectionRunResult = await poll();

    /*
     * A permanently unrecognizable object used to hold the cursor, which
     * pinned the window until the 24 hour chunk could never reach the
     * present. It is counted, warned, and shown as a "warn" check.
     */
    expect(result).toMatchObject({
      status: "success",
      complete: true,
      rejectedCount: 1,
      ingestedCount: 1,
    });
    expect(result.warnings.join(" ")).toMatch(/discarded/);
    expect(findCheck(result.checks, "read").status).toBe("warn");
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
  });

  test("a normalization failure still holds the cursor", async () => {
    failNormalizationFor(["poison"]);
    tenant.add(recentDetection("poison"));
    tenant.add(recentDetection("ok"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "partial",
      failedCount: 1,
      ingestedCount: 1,
      complete: false,
    });
    // The retired poller's "Normalize detections: failed" is the read check now.
    expect(findCheck(result.checks, "read").status).toBe("fail");
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
  });

  test("detections that all fail to normalize hold the first poll at its anchor rather than skipping the window", async () => {
    failNormalizationFor(["poison-1", "poison-2"]);
    tenant.add({
      id: "poison-1",
      createdMs: NOW.getTime() - 2 * HOUR_MS,
      detectionMs: NOW.getTime() - 2 * HOUR_MS,
    });
    tenant.add({
      id: "poison-2",
      createdMs: NOW.getTime() - HOUR_MS,
      detectionMs: NOW.getTime() - HOUR_MS,
    });

    const ingested: number = await SecurityEventConnectionPoller.pollConnection(
      secOpsConnection(),
      tenant.overrides(),
    );

    expect(ingested).toBe(0);
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    const written: JSONObject = lastUpdate(persistence);
    expect(written["lastPollResult"]).toEqual(
      expect.objectContaining({ complete: false }),
    );
    expect(written["lastSuccessfulPollAt"]).toBeUndefined();
    const result: SecurityEventConnectionRunResult = storedResult(written);
    expect(result.status).toBe("partial");
    expect(result.failedCount).toBe(2);
    expect(Date.parse(String(written["cursor"])) - MINUTE_MS).toBe(
      Date.parse(result.windowStart),
    );
  });

  test("a mixed normalization failure preserves retry coverage even after other records import", async () => {
    failNormalizationFor(["broken"]);
    tenant.add(recentDetection("valid"));
    tenant.add(recentDetection("broken"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "partial",
      ingestedCount: 1,
      failedCount: 1,
      complete: false,
    });
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
  });

  test("a partial alerts-view stream imports what arrived but holds the whole prior cursor", async () => {
    // The stream ends without complete=true on every attempt the client makes.
    tenant.scripts.alerts = (): ReturnType<typeof streamReply> => {
      return streamReply([
        {
          alerts: {
            alerts: [
              {
                id: "alert-1",
                detectionTime: iso(NOW.getTime() - 3 * MINUTE_MS),
                detection: [{ ruleName: "Suspicious sign-in" }],
              },
            ],
          },
          progress: 0.5,
        },
      ]);
    };

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.status).toBe("partial");
    expect(result.ingestedCount).toBe(1);
    // The client re-issued the unfinished GET before handing back what it had.
    expect(tenant.requestsTo("alerts")).toHaveLength(3);
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
    expect(lastUpdate(persistence)).not.toHaveProperty("lastSuccessfulPollAt");
    expect(lastUpdate(persistence)["lastError"]).toMatch(/complete/);
  });

  test("a partial first poll anchors its window so a delayed retry re-covers it from the same start in half the chunk", async () => {
    tenant.scripts.alerts = (): ReturnType<typeof streamReply> => {
      return streamReply([{ progress: 0.5 }]);
    };
    const item: SecurityEventConnection = secOpsConnection();

    const first: SecurityEventConnectionRunResult = await poll(item);

    expect(first.chunkMinutes).toBe(24 * 60);
    expect(first.nextChunkMinutes).toBe(12 * 60);
    item.cursor = String(lastUpdate(persistence)["cursor"]);
    // The row is reloaded with the result it was written with.
    item.lastPollResult = JSON.parse(
      JSON.stringify(lastUpdate(persistence)["lastPollResult"]),
    ) as JSONObject;
    delete tenant.scripts.alerts;
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      new Date("2026-09-10T14:00:00.000Z"),
    );

    const retry: SecurityEventConnectionRunResult = await poll(item);

    expect(retry.windowStart).toBe(first.windowStart);
    /*
     * Review finding alerts-view-budget-pins-cursor-forever (F1): the retry
     * keeps the start and reads half the chunk, measured from the anchored
     * cursor.
     */
    expect(retry.windowEnd).toBe("2026-09-10T00:01:00.000Z");
    expect(retry.chunkMinutes).toBe(12 * 60);
    /*
     * The retired poller worded this "12 hour windows"; the shared loop
     * names any chunk shorter than a day in minutes.
     */
    expect(retry.warnings).toContain(
      "Catching up from the saved cursor in 720 minute windows. Later records will be fetched by subsequent polls.",
    );
    expect(lastUpdate(persistence)["cursor"]).toBe("2026-09-10T00:01:00.000Z");
  });
});

describe("Google SecOps through the shared poller: the three passes on the stored run", () => {
  test("per-pass checks and providerDetails are kept on the run result and on the stored lastPollResult", async () => {
    // Window [11:54, 12:00). a and b are rule detections created in it.
    tenant.add({
      id: "a",
      createdMs: Date.parse("2026-09-10T11:56:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:55:30.000Z"),
    });
    tenant.add({
      id: "b",
      createdMs: Date.parse("2026-09-10T11:57:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:56:00.000Z"),
    });
    // c is a curated rule detection.
    tenant.add({
      id: "c",
      curated: true,
      createdMs: Date.parse("2026-09-10T11:58:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:57:00.000Z"),
    });
    // d was created before the window: only the alerts view sees it.
    tenant.add({
      id: "d",
      createdMs: Date.parse("2026-09-10T11:30:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:59:00.000Z"),
    });

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      fetchedCount: 4,
      ingestedCount: 4,
      requestCount: 3,
    });
    /*
     * The retired poller stored these as "Validate configuration:success",
     * the three pass names, "Normalize detections" and "Import detections".
     * The pass names are unchanged; the statuses and the last two steps are
     * the shared loop's.
     */
    expect(
      result.checks.map(
        (check: { key: string; name: string; status: string }): string => {
          return `${check.key}|${check.name}|${check.status}`;
        },
      ),
    ).toEqual([
      "configuration|Validate configuration|pass",
      "read-rule-detections|Read rule detections by created time|pass",
      "read-curated-detections|Read curated rule detections by created time|pass",
      "read-alerts-view|Read alerts view by detection time|pass",
      "read|Read detections from Google SecOps|pass",
      "import|Import records|pass",
    ]);
    expect(result.providerDetails).toEqual({
      basis: "created-time",
      sourceCounts: { ruleDetections: 2, curatedDetections: 1, alertsView: 4 },
      creationLag: { measured: 4, lateCount: 0, maxLagMinutes: 1 },
      includeNonAlertingDetections: false,
    });

    const stored: SecurityEventConnectionRunResult = storedResult(
      lastUpdate(persistence),
    );
    expect(keysAndStatuses(stored.checks)).toEqual(
      keysAndStatuses(result.checks),
    );
    expect(stored.providerDetails).toEqual(result.providerDetails);
    expect(eventUidsOf(persistence.insertedBatches[0]!)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("a curated route answering HTTP 403 is a warning check in the run and the poll still completes", async () => {
    tenant.scripts.curated = (): ReturnType<typeof googleError> => {
      return googleError(
        403,
        "PERMISSION_DENIED",
        "Caller does not have permission 'chronicle.legacies.legacySearchCuratedDetections'.",
      );
    };
    tenant.add(recentDetection("rule-detection"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      ingestedCount: 1,
    });
    const curated: ReturnType<typeof findCheck> = findCheck(
      result.checks,
      "read-curated-detections",
    );
    expect(curated).toMatchObject({
      name: "Read curated rule detections by created time",
      status: "warn",
      details: { httpStatus: 403 },
    });
    expect(curated.remediation).toContain("Curated (Google-authored)");
    expect(curated.message).toContain(
      "Google SecOps detections search failed (HTTP 403)",
    );
    expect(result.warnings.join(" ")).toContain("(HTTP 403)");
    // The alerts view still ran after the curated pass degraded.
    expect(tenant.requestsTo("alerts")).toHaveLength(1);
    const written: JSONObject = lastUpdate(persistence);
    expect(written["cursor"]).toBe(NOW.toISOString());
    expect(written["lastError"]).toBeNull();
    expect(
      findCheck(storedResult(written).checks, "read-curated-detections").status,
    ).toBe("warn");
  });

  test("pollIntervalInMinutes reaches the connector's creation-lag measurement", async () => {
    // Created twenty minutes after its detection time, inside the created-time window.
    tenant.add({
      id: "late",
      createdMs: Date.parse("2026-09-10T11:58:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:38:00.000Z"),
    });

    const hourly: SecurityEventConnectionRunResult = await poll(
      secOpsConnection({ cursor: CURSOR, pollIntervalInMinutes: 30 }),
    );
    const everyFive: SecurityEventConnectionRunResult = await poll(
      secOpsConnection({ cursor: CURSOR, pollIntervalInMinutes: 5 }),
    );

    // Within 30 minutes plus the one minute grace: measured, not late.
    expect(hourly.providerDetails?.["creationLag"]).toEqual({
      measured: 1,
      lateCount: 0,
      maxLagMinutes: 20,
    });
    expect(hourly.warnings.join(" ")).not.toMatch(/created more than/);
    // Beyond 5 minutes plus the grace: late, and the warning says why.
    expect(everyFive.providerDetails?.["creationLag"]).toEqual({
      measured: 1,
      lateCount: 1,
      maxLagMinutes: 20,
    });
    expect(everyFive.warnings).toContain(
      "1 of 1 detections were created more than 6 minutes after their detection time (up to 20 minutes). This is why the connector polls by created time: a cursor over detection time would already have moved past them.",
    );
    // Informational: both runs are complete and move the cursor.
    expect(hourly.status).toBe("success");
    expect(everyFive.complete).toBe(true);
  });
});

describe("Google SecOps through the shared poller: preview and backfill", () => {
  test.each([
    ["bad", NOW.toISOString()],
    [NOW.toISOString(), "bad"],
    [NOW.toISOString(), NOW.toISOString()],
    [NOW.toISOString(), "2026-09-09T00:00:00Z"],
    ["2026-09-01T00:00:00Z", NOW.toISOString()],
    ["2026-09-09T00:00:00Z", "2026-09-11T00:00:00Z"],
  ])(
    "rejects invalid or excessive preview range %s to %s",
    async (startTime: string, endTime: string) => {
      await expect(
        SecurityEventConnectionPoller.executeConnection(
          secOpsConnection({ cursor: CURSOR }),
          { type: "preview", startTime, endTime },
          tenant.overrides(),
        ),
      ).rejects.toThrow(/seven days/);
      // Nothing, not even the token exchange, reached Google.
      expect(tenant.requests).toHaveLength(0);
      expect(persistence.updates).toHaveLength(0);
    },
  );

  test("accepts an exact seven day historical range", async () => {
    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        {
          type: "preview",
          startTime: "2026-09-03T12:00:00Z",
          endTime: NOW.toISOString(),
        },
        tenant.overrides(),
      );

    expect(result.status).toBe("empty");
  });

  test("a preview reads the search passes by created and detection time, reports the detection-time basis and never moves the cursor", async () => {
    tenant.add({
      id: "x",
      alerting: false,
      createdMs: Date.parse("2026-09-10T04:16:00.000Z"),
      detectionMs: Date.parse("2026-09-09T01:30:00.000Z"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR, alertingOnly: false }),
        {
          type: "preview",
          startTime: "2026-09-09T00:00:00.000Z",
          endTime: NOW.toISOString(),
        },
        tenant.overrides(secOpsSettings({ alertingOnly: false })),
      );

    expect(
      tenant.requests
        .filter((request: TenantRequest): boolean => {
          return request.route === "search" || request.route === "curated";
        })
        .map((request: TenantRequest): string => {
          return `${request.route}:${request.url.searchParams.get("listBasis")}:${request.url.searchParams.get("alertState")}`;
        }),
    ).toEqual([
      "search:CREATED_TIME:null",
      "search:DETECTION_TIME:null",
      "curated:CREATED_TIME:null",
      "curated:DETECTION_TIME:null",
    ]);
    expect(
      tenant
        .requestsTo("alerts")[0]!
        .url.searchParams.get("includeNonAlertingDetections"),
    ).toBe("ALERTS_FEATURE_PREFERENCE_ENABLED");
    expect(result.providerDetails).toMatchObject({
      basis: "detection-time",
      sourceCounts: { ruleDetections: 2, curatedDetections: 0, alertsView: 1 },
      includeNonAlertingDetections: true,
    });
    // The same record read by both bases and the alerts view is one record.
    expect(result.fetchedCount).toBe(1);
    expect(findCheck(result.checks, "read-rule-detections").name).toBe(
      "Read rule detections by created and detection time",
    );
    expect(result.samples).toEqual([
      {
        id: "x",
        title: "Rule for x",
        severity: "High",
        createdTime: "2026-09-10T04:16:00.000Z",
        eventTime: "2026-09-09T01:30:00.000Z",
        isAlert: false,
      },
    ]);
    expect(result.chunkMinutes).toBeUndefined();
    expect(persistence.updates).toHaveLength(0);
    expect(persistence.insertedBatches).toHaveLength(0);
    expect(persistence.dedupeLookups).toHaveLength(0);
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  test("backfill imports source event timestamps, reads both bases and records the event range without changing poll state", async () => {
    tenant.add({
      id: "alert-1",
      alerting: false,
      createdMs: Date.parse("2026-09-10T04:16:00.000Z"),
      detectionMs: Date.parse("2026-09-09T01:30:00.000Z"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR, alertingOnly: false }),
        {
          type: "backfill",
          startTime: "2026-09-09T00:00:00.000Z",
          endTime: NOW.toISOString(),
        },
        tenant.overrides(secOpsSettings({ alertingOnly: false })),
      );

    expect(
      tenant
        .requestsTo("search")
        .map((request: TenantRequest): string | null => {
          return request.url.searchParams.get("listBasis");
        }),
    ).toEqual(["CREATED_TIME", "DETECTION_TIME"]);
    expect(result.ingestedCount).toBe(1);
    expect(result.eventTimeStart).toBe("2026-09-09T01:30:00.000Z");
    expect(result.eventTimeEnd).toBe(result.eventTimeStart);
    // Only lastEventIngestedAt: the cursor and the poll bookkeeping are untouched.
    expect(persistence.updates).toHaveLength(1);
    expect(lastUpdate(persistence)).toEqual({ lastEventIngestedAt: NOW });
    const attributes: JSONObject = persistence.insertedBatches[0]![0]![
      "attributes"
    ] as JSONObject;
    /*
     * The retired poller stamped oneuptime.google_secops.connection_id. The
     * shared loop stamps its own attribute and leaves eventAttributeKey
     * unset; only runs carried over by the data migration name the legacy
     * key.
     */
    expect(attributes[SECURITY_CONNECTION_ID_ATTRIBUTE]).toBe(
      CONNECTION_ID.toString(),
    );
    expect(attributes).not.toHaveProperty(
      LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
    );
    expect(result.eventAttributeKey).toBeUndefined();
  });
});

describe("Google SecOps through the shared poller: duplicates and storage", () => {
  test("the dedupe lookup is scoped to Google / Google SecOps and the telemetry service is Google SecOps", async () => {
    // Imported by the retired poller under the same scope.
    persistence.stored.add("already");
    tenant.add(recentDetection("already"));
    tenant.add(
      recentDetection("new", { createdMs: NOW.getTime() - MINUTE_MS }),
    );

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.duplicateCount).toBe(1);
    expect(result.ingestedCount).toBe(1);
    expect(persistence.dedupeLookups).toHaveLength(1);
    expect(persistence.dedupeLookups[0]).toEqual({
      projectId: PROJECT_ID,
      vendorName: "Google",
      productName: "Google SecOps",
      ids: expect.arrayContaining(["already", "new"]),
    });
    expect(OTelIngestService.telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "Google SecOps",
      projectId: PROJECT_ID,
    });
    expect(eventUidsOf(persistence.insertedBatches[0]!)).toEqual(["new"]);
  });

  test("replaying a previously imported detection skips its persisted event uid", async () => {
    persistence.stored.add("alert-1");
    tenant.add(recentDetection("alert-1"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      ingestedCount: 0,
      duplicateCount: 1,
      complete: true,
    });
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(SecurityEventDedupe.findExistingEventUids).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      vendorName: "Google",
      productName: "Google SecOps",
      ids: ["alert-1"],
    });
  });

  test("two overlapping polls only insert each detection once", async () => {
    tenant.add(recentDetection("alert-1"));

    const first: SecurityEventConnectionRunResult = await poll();
    const second: SecurityEventConnectionRunResult = await poll();

    expect(first.ingestedCount).toBe(1);
    expect(second.duplicateCount).toBe(1);
    expect(second.ingestedCount).toBe(0);
    expect(persistence.insertedBatches).toHaveLength(1);
    expect(persistence.stored).toEqual(new Set(["alert-1"]));
  });

  test("a failed insert records the failure and never advances the cursor or reports imported events", async () => {
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockRejectedValue(
      new Error("Event storage unavailable") as never,
    );
    tenant.add(recentDetection("alert-1"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result).toMatchObject({
      status: "failed",
      complete: false,
      ingestedCount: 0,
    });
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
    expect(result.error).toMatch(/storage unavailable/);
    expect(findCheck(result.checks, "failure").name).toBe("Import records");
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("a failed duplicate lookup does not insert potentially duplicate records", async () => {
    getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockRejectedValue(new Error("Read store unavailable") as never);
    tenant.add(recentDetection("alert-1"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Read store unavailable");
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
  });
});

/*
 * The duplicate lookup itself, under a real poll: SecurityEventDedupe runs
 * for real and only SecurityEventService.executeQuery is stubbed, so the
 * statement the poll sends ClickHouse is the one asserted.
 */
describe("Google SecOps through the shared poller: duplicate lookup database contract", () => {
  let statements: Array<Statement>;

  beforeEach(() => {
    statements = [];
    getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockRestore();
  });

  function answerLookups(
    rows: (statement: Statement) => Array<JSONObject>,
  ): void {
    getJestSpyOn(SecurityEventService, "executeQuery").mockImplementation(((
      statement: Statement,
    ): Promise<unknown> => {
      statements.push(statement);
      return Promise.resolve({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: rows(statement) };
        },
      });
    }) as never);
  }

  test("binds untrusted identifiers, scopes the source to Google / Google SecOps and reads every replica without partial timeout results", async () => {
    const id: string = "id'); DROP TABLE SecurityEvent; --";
    // Stored twice on two replicas: still one identifier.
    answerLookups((): Array<JSONObject> => {
      return [{ eventUid: id }, { eventUid: id }];
    });
    tenant.add(recentDetection(id));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.duplicateCount).toBe(1);
    expect(result.ingestedCount).toBe(0);
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.query).toMatch(
      /SELECT DISTINCT eventUid FROM clusterAllReplicas/,
    );
    expect(statements[0]!.query).toMatch(/timeout_overflow_mode = 'throw'/);
    expect(statements[0]!.query).toMatch(/skip_unavailable_shards = 0/);
    expect(statements[0]!.query).not.toContain(id);
    const values: Array<unknown> = Object.values(statements[0]!.query_params);
    expect(values).toContain(PROJECT_ID.toString());
    expect(values).toContain("Google");
    expect(values).toContain("Google SecOps");
    expect(values).toContain("SecurityEventItemV1Local");
    expect(values).toContainEqual([id]);
  });

  test("chunks the UID lookup of a large poll so no query carries unbounded parameters", async () => {
    answerLookups((): Array<JSONObject> => {
      return [];
    });
    for (let index: number = 0; index < 2501; index++) {
      tenant.add({
        id: `id-${index}`,
        createdMs: NOW.getTime() - 5 * MINUTE_MS + index * 100,
        // Detected long ago, so only the created-time search returns them.
        detectionMs: NOW.getTime() - 30 * DAY_MS,
      });
    }

    const result: SecurityEventConnectionRunResult = await poll();

    expect(tenant.requestsTo("search")).toHaveLength(3);
    expect(result.fetchedCount).toBe(2501);
    expect(result.ingestedCount).toBe(2501);
    expect(
      statements.map((statement: Statement): number => {
        return (
          Object.values(statement.query_params).find(
            Array.isArray,
          ) as Array<string>
        ).length;
      }),
    ).toEqual([1000, 1000, 501]);
  });

  test("an unavailable replica fails the poll instead of importing possible duplicates", async () => {
    getJestSpyOn(SecurityEventService, "executeQuery").mockRejectedValue(
      new Error("Replica unavailable") as never,
    );
    tenant.add(recentDetection("alert-1"));

    const result: SecurityEventConnectionRunResult = await poll();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Replica unavailable");
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
  });
});
