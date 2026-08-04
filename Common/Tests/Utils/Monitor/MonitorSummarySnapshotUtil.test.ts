import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
  MonitorSummaryInfoProps,
  MonitorSummaryResponseBodyMaxLengthInChars,
} from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * When a monitor trips and opens an incident, the incident page showed
 * nothing about what the monitor actually saw - the "Monitor Summary" card
 * lived only on the monitor page, fed by live data. And that data does not
 * last: MonitorLog rows are dropped by a ClickHouse TTL whose default is
 * one day, and MonitorProbe.lastMonitoringLog is overwritten by the very
 * next check. So an incident older than a day had no recoverable evidence
 * at all.
 *
 * The fix freezes the summary onto the incident/alert row at creation.
 * These tests pin the part that decides *what* gets frozen and how it is
 * read back, for every monitor type - because the routing is by
 * monitorType, and a type routed to the wrong slot renders an empty card
 * that looks exactly like "this monitor had no data".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_STEP_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const CAPTURED_AT: Date = OneUptimeDate.fromString("2026-07-31T10:00:00.000Z");

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: CAPTURED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-1",
      criteriaName: "Is Offline",
      filterCondition: FilterCondition.Any,
      met: true,
      message: "Monitor is offline",
      filters: [],
    },
  ],
  events: [
    {
      type: "criteria-met",
      title: "Criteria met",
      message: 'Criteria "Is Offline" was met.',
      at: CAPTURED_AT,
    },
  ],
};

/*
 * Which payload slot each monitor type has to land in. Written out by hand
 * rather than derived from the helpers, so that a change to
 * isTelemetryMonitor / isProbableMonitor has to be reflected here too -
 * silently reclassifying a type is exactly the regression this guards.
 */
enum PayloadKind {
  Probe = "Probe",
  Server = "Server",
  IncomingRequest = "IncomingRequest",
  IncomingEmail = "IncomingEmail",
  Telemetry = "Telemetry",
  None = "None",
}

const EXPECTED_PAYLOAD_KIND: Record<MonitorType, PayloadKind> = {
  [MonitorType.Manual]: PayloadKind.None,

  [MonitorType.Website]: PayloadKind.Probe,
  [MonitorType.API]: PayloadKind.Probe,
  [MonitorType.Ping]: PayloadKind.Probe,
  [MonitorType.IP]: PayloadKind.Probe,
  [MonitorType.Port]: PayloadKind.Probe,
  [MonitorType.SSLCertificate]: PayloadKind.Probe,
  [MonitorType.SyntheticMonitor]: PayloadKind.Probe,
  [MonitorType.CustomJavaScriptCode]: PayloadKind.Probe,
  [MonitorType.DNS]: PayloadKind.Probe,
  [MonitorType.DNSSEC]: PayloadKind.Probe,
  [MonitorType.Domain]: PayloadKind.Probe,
  [MonitorType.SQLQuery]: PayloadKind.Probe,
  [MonitorType.ExternalStatusPage]: PayloadKind.Probe,
  /*
   * Not a "probeable" monitor - the device owns its polling schedule - but
   * its walks and traps still arrive as a ProbeMonitorResponse, and
   * SummaryInfo renders it with SnmpMonitorView.
   */
  [MonitorType.NetworkDevice]: PayloadKind.Probe,

  [MonitorType.Server]: PayloadKind.Server,
  [MonitorType.IncomingRequest]: PayloadKind.IncomingRequest,
  [MonitorType.IncomingEmail]: PayloadKind.IncomingEmail,

  [MonitorType.Logs]: PayloadKind.Telemetry,
  [MonitorType.Metrics]: PayloadKind.Telemetry,
  [MonitorType.Traces]: PayloadKind.Telemetry,
  [MonitorType.Exceptions]: PayloadKind.Telemetry,
  [MonitorType.Profiles]: PayloadKind.Telemetry,
  [MonitorType.Kubernetes]: PayloadKind.Telemetry,
  [MonitorType.Docker]: PayloadKind.Telemetry,
  [MonitorType.Host]: PayloadKind.Telemetry,
  [MonitorType.Podman]: PayloadKind.Telemetry,
  [MonitorType.DockerSwarm]: PayloadKind.Telemetry,
  [MonitorType.Proxmox]: PayloadKind.Telemetry,
  [MonitorType.Ceph]: PayloadKind.Telemetry,
  [MonitorType.IoTDevice]: PayloadKind.Telemetry,
};

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

function probeResponse(
  overrides?: Partial<Record<string, unknown>>,
): MonitorSummaryDataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: MONITOR_STEP_ID,
    probeId: PROBE_ID,
    isOnline: false,
    failureCause: "Connection refused",
    responseTimeInMs: 1234,
    responseCode: 503,
    monitoredAt: CAPTURED_AT,
    ...(overrides || {}),
  } as unknown as MonitorSummaryDataToProcess;
}

function serverResponse(): MonitorSummaryDataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    hostname: "prod-db-01",
    requestReceivedAt: CAPTURED_AT,
    onlyCheckRequestReceivedAt: false,
    failureCause: "Disk usage above 90%",
  } as unknown as MonitorSummaryDataToProcess;
}

function incomingRequest(): MonitorSummaryDataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    incomingRequestReceivedAt: CAPTURED_AT,
    checkedAt: CAPTURED_AT,
    requestBody: { status: "degraded" },
  } as unknown as MonitorSummaryDataToProcess;
}

function incomingEmail(): MonitorSummaryDataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "alerts@example.com",
    emailTo: "monitor@oneuptime.com",
    emailSubject: "Backup failed",
    emailBody: "The nightly backup did not complete.",
    emailReceivedAt: CAPTURED_AT,
    checkedAt: CAPTURED_AT,
  } as unknown as MonitorSummaryDataToProcess;
}

function telemetryResponse(
  monitorType: MonitorType,
): MonitorSummaryDataToProcess {
  const base: JSONObject = {
    projectId: PROJECT_ID as unknown as JSONObject,
    monitorId: MONITOR_ID as unknown as JSONObject,
  };

  if (monitorType === MonitorType.Logs) {
    return { ...base, logCount: 412 } as unknown as MonitorSummaryDataToProcess;
  }
  if (monitorType === MonitorType.Traces) {
    return { ...base, spanCount: 7 } as unknown as MonitorSummaryDataToProcess;
  }
  if (monitorType === MonitorType.Exceptions) {
    return {
      ...base,
      exceptionCount: 3,
    } as unknown as MonitorSummaryDataToProcess;
  }
  if (monitorType === MonitorType.Profiles) {
    return {
      ...base,
      profileCount: 11,
    } as unknown as MonitorSummaryDataToProcess;
  }

  // Metrics and every infrastructure type built on it.
  return {
    ...base,
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
  } as unknown as MonitorSummaryDataToProcess;
}

function payloadFor(
  monitorType: MonitorType,
): MonitorSummaryDataToProcess | undefined {
  switch (EXPECTED_PAYLOAD_KIND[monitorType]) {
    case PayloadKind.Probe:
      return probeResponse();
    case PayloadKind.Server:
      return serverResponse();
    case PayloadKind.IncomingRequest:
      return incomingRequest();
    case PayloadKind.IncomingEmail:
      return incomingEmail();
    case PayloadKind.Telemetry:
      return telemetryResponse(monitorType);
    default:
      return undefined;
  }
}

function build(
  monitorType: MonitorType,
  overrides?: {
    dataToProcess?: MonitorSummaryDataToProcess | undefined;
    probeName?: string | undefined;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    maxSizeInBytes?: number | undefined;
  },
): MonitorSummarySnapshot | null {
  return MonitorSummarySnapshotUtil.buildSnapshot({
    monitorType: monitorType,
    dataToProcess:
      overrides && "dataToProcess" in overrides
        ? overrides.dataToProcess
        : payloadFor(monitorType),
    monitorId: MONITOR_ID.toString(),
    monitorName: "Production API",
    probeName: overrides?.probeName ?? "US West Probe",
    evaluationSummary:
      overrides && "evaluationSummary" in overrides
        ? overrides.evaluationSummary
        : EVALUATION_SUMMARY,
    capturedAt: CAPTURED_AT,
    maxSizeInBytes: overrides?.maxSizeInBytes,
  });
}

describe("MonitorSummarySnapshotUtil - every monitor type is covered", () => {
  it("has an expected payload slot declared for every MonitorType", () => {
    /*
     * A new monitor type added to the enum without a line in
     * EXPECTED_PAYLOAD_KIND would otherwise silently store nothing and
     * render a blank card on its incidents.
     */
    for (const monitorType of ALL_MONITOR_TYPES) {
      expect(EXPECTED_PAYLOAD_KIND[monitorType]).toBeDefined();
    }

    expect(Object.keys(EXPECTED_PAYLOAD_KIND).length).toBe(
      ALL_MONITOR_TYPES.length,
    );
  });

  it("agrees with MonitorTypeHelper about which types are telemetry", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      expect(MonitorTypeHelper.isTelemetryMonitor(monitorType)).toBe(
        EXPECTED_PAYLOAD_KIND[monitorType] === PayloadKind.Telemetry,
      );
    }
  });

  it("routes every probeable type into probeMonitorResponse", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (!MonitorTypeHelper.isProbableMonitor(monitorType)) {
        continue;
      }

      const snapshot: MonitorSummarySnapshot | null = build(monitorType);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.probeMonitorResponse).toBeDefined();
      expect(snapshot!.serverMonitorResponse).toBeUndefined();
      expect(snapshot!.incomingMonitorRequest).toBeUndefined();
      expect(snapshot!.incomingEmailMonitorRequest).toBeUndefined();
      expect(snapshot!.telemetryMonitorSummary).toBeUndefined();
    }
  });

  it("builds a renderable snapshot for every non-manual monitor type", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const snapshot: MonitorSummarySnapshot | null = build(monitorType);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.monitorType).toBe(monitorType);
      expect(MonitorSummarySnapshotUtil.hasRenderableContent(snapshot)).toBe(
        true,
      );
    }
  });

  it("puts each monitor type's payload in exactly the slot its summary view reads", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const snapshot: MonitorSummarySnapshot = build(monitorType)!;
      const kind: PayloadKind = EXPECTED_PAYLOAD_KIND[monitorType];

      expect(Boolean(snapshot.probeMonitorResponse)).toBe(
        kind === PayloadKind.Probe,
      );
      expect(Boolean(snapshot.serverMonitorResponse)).toBe(
        kind === PayloadKind.Server,
      );
      expect(Boolean(snapshot.incomingMonitorRequest)).toBe(
        kind === PayloadKind.IncomingRequest,
      );
      expect(Boolean(snapshot.incomingEmailMonitorRequest)).toBe(
        kind === PayloadKind.IncomingEmail,
      );
      expect(Boolean(snapshot.telemetryMonitorSummary)).toBe(
        kind === PayloadKind.Telemetry,
      );
    }
  });

  it("survives a serialize / deserialize round trip for every monitor type", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const snapshot: MonitorSummarySnapshot = build(monitorType)!;

      const stored: JSONObject | null =
        MonitorSummarySnapshotUtil.serialize(snapshot);

      expect(stored).not.toBeNull();

      /*
       * Through the jsonb column and back over the API - JSON.parse of the
       * stringified form is what the browser actually receives.
       */
      const readBack: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(
          JSON.parse(JSON.stringify(stored)) as JSONObject,
        );

      expect(readBack).not.toBeNull();
      expect(readBack!.monitorType).toBe(monitorType);
      expect(readBack!.monitorName).toBe("Production API");
      expect(
        readBack!.evaluationSummary?.criteriaResults[0]?.criteriaName,
      ).toBe("Is Offline");
    }
  });

  it("produces SummaryInfo props the matching view can render, for every monitor type", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const snapshot: MonitorSummarySnapshot = build(monitorType)!;
      const props: MonitorSummaryInfoProps =
        MonitorSummarySnapshotUtil.toSummaryInfoProps(snapshot);

      expect(props.monitorType).toBe(monitorType);
      expect(props.evaluationSummary).toBeDefined();

      const kind: PayloadKind = EXPECTED_PAYLOAD_KIND[monitorType];

      if (kind === PayloadKind.Probe) {
        /*
         * SummaryInfo takes an ARRAY here because a monitor can have
         * several steps. A snapshot is one check, so it must still be
         * wrapped - handing the bare object over renders nothing.
         */
        expect(props.probeMonitorResponses).toHaveLength(1);
        // Every probeable leaf view renders a "Probe" info card.
        expect(props.probeName).toBe("US West Probe");
      }

      if (kind === PayloadKind.Server) {
        expect(props.serverMonitorResponse).toBeDefined();
      }

      if (kind === PayloadKind.IncomingRequest) {
        expect(props.incomingMonitorRequest).toBeDefined();
        /*
         * The live card shows the monitor's current heartbeat time; on a
         * frozen capture the honest equivalent is when this request was
         * checked.
         */
        expect(props.incomingRequestMonitorHeartbeatCheckedAt).toEqual(
          CAPTURED_AT,
        );
      }

      if (kind === PayloadKind.IncomingEmail) {
        expect(props.incomingEmailMonitorRequest).toBeDefined();
        expect(props.incomingEmailMonitorHeartbeatCheckedAt).toEqual(
          CAPTURED_AT,
        );
      }

      if (kind === PayloadKind.Telemetry) {
        expect(props.telemetryMonitorSummary?.lastCheckedAt).toEqual(
          CAPTURED_AT,
        );
        /*
         * Never "next check at" - the capture is historical, and a future
         * check time on a closed incident is a lie.
         */
        expect(props.telemetryMonitorSummary?.nextCheckAt).toBeUndefined();
      }
    }
  });
});

describe("MonitorSummarySnapshotUtil.buildSnapshot", () => {
  it("stores nothing for a manual monitor, which has no summary card at all", () => {
    expect(build(MonitorType.Manual)).toBeNull();
  });

  it("stores nothing when there is neither a payload nor an evaluation to show", () => {
    expect(
      build(MonitorType.Website, {
        dataToProcess: undefined,
        evaluationSummary: undefined,
      }),
    ).toBeNull();
  });

  it("still stores the evaluation log when the payload is missing", () => {
    /*
     * "Why did this fire?" is answerable from the criteria evaluation
     * alone, so a check with no usable response is still worth keeping.
     */
    const snapshot: MonitorSummarySnapshot | null = build(MonitorType.Website, {
      dataToProcess: undefined,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.probeMonitorResponse).toBeUndefined();
    expect(snapshot!.evaluationSummary).toBeDefined();
  });

  it("stamps the version and marks the snapshot as captured", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Ping)!;

    expect(snapshot.version).toBe(MonitorSummarySnapshotVersion);
    expect(snapshot.source).toBe(MonitorSummarySnapshotSource.Captured);
    expect(snapshot.capturedAt).toEqual(CAPTURED_AT);
    expect(snapshot.monitorId).toBe(MONITOR_ID.toString());
  });

  it("records the probe id off the check so the capture names its source", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.API)!;

    expect(snapshot.probeId).toBe(PROBE_ID.toString());
  });

  it("falls back to the evaluation summary carried on the response itself", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.API, {
      dataToProcess: probeResponse({
        evaluationSummary: EVALUATION_SUMMARY,
      }),
      evaluationSummary: undefined,
    })!;

    expect(snapshot.evaluationSummary?.criteriaResults[0]?.criteriaName).toBe(
      "Is Offline",
    );
  });

  it("drops a payload whose shape does not match the monitor type rather than rendering it as a broken check", () => {
    /*
     * A cron re-evaluation or a monitor whose type changed can hand the
     * wrong payload down. Stuffing a server response into the probe slot
     * would reach WebsiteMonitorView, which reads fields that are not
     * there.
     */
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Website, {
      dataToProcess: serverResponse(),
    })!;

    expect(snapshot.probeMonitorResponse).toBeUndefined();
    // The evaluation log is still worth keeping.
    expect(snapshot.evaluationSummary).toBeDefined();
  });

  it("keeps the observed count that tripped a telemetry monitor", () => {
    const logs: MonitorSummarySnapshot = build(MonitorType.Logs)!;
    expect(logs.telemetryMonitorSummary?.observedCount).toBe(412);
    expect(logs.telemetryMonitorSummary?.observedCountTitle).toBe(
      "Log Records",
    );

    const traces: MonitorSummarySnapshot = build(MonitorType.Traces)!;
    expect(traces.telemetryMonitorSummary?.observedCount).toBe(7);
    expect(traces.telemetryMonitorSummary?.observedCountTitle).toBe("Spans");

    const exceptions: MonitorSummarySnapshot = build(MonitorType.Exceptions)!;
    expect(exceptions.telemetryMonitorSummary?.observedCount).toBe(3);

    const profiles: MonitorSummarySnapshot = build(MonitorType.Profiles)!;
    expect(profiles.telemetryMonitorSummary?.observedCount).toBe(11);
  });

  it("leaves the observed count unset for metric monitors, which aggregate a series instead of counting rows", () => {
    const metrics: MonitorSummarySnapshot = build(MonitorType.Metrics)!;

    expect(metrics.telemetryMonitorSummary?.monitoredAt).toEqual(CAPTURED_AT);
    expect(metrics.telemetryMonitorSummary?.observedCount).toBeUndefined();
  });

  it("captures a zero observed count rather than treating it as missing", () => {
    /*
     * "0 logs matched" is exactly what a log-absence criteria fires on, so
     * a falsy-check here would blank the one number that explains it.
     */
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Logs, {
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        logCount: 0,
      } as unknown as MonitorSummaryDataToProcess,
    })!;

    expect(snapshot.telemetryMonitorSummary?.observedCount).toBe(0);
  });
});

describe("MonitorSummarySnapshotUtil size budget", () => {
  function screenshotResponse(
    sizeInChars: number,
  ): MonitorSummaryDataToProcess {
    return probeResponse({
      syntheticMonitorResponse: [
        {
          browserType: "Chromium",
          screenSizeType: "Desktop",
          result: undefined,
          logMessages: [],
          capturedMetrics: [],
          executionTimeInMS: 900,
          screenshots: {
            "home-page": "A".repeat(sizeInChars),
          },
        },
      ],
    });
  }

  it("keeps synthetic screenshots when the capture fits", () => {
    const snapshot: MonitorSummarySnapshot = build(
      MonitorType.SyntheticMonitor,
      {
        dataToProcess: screenshotResponse(100),
      },
    )!;

    expect(
      snapshot.probeMonitorResponse?.syntheticMonitorResponse?.[0]?.screenshots,
    ).toBeDefined();
    expect(snapshot.areScreenshotsOmitted).toBeFalsy();
  });

  it("drops synthetic screenshots - and says so - rather than storing a multi-megabyte row", () => {
    const snapshot: MonitorSummarySnapshot = build(
      MonitorType.SyntheticMonitor,
      {
        dataToProcess: screenshotResponse(5000),
        maxSizeInBytes: 2000,
      },
    )!;

    expect(
      snapshot.probeMonitorResponse?.syntheticMonitorResponse?.[0]?.screenshots,
    ).toBeUndefined();
    expect(snapshot.areScreenshotsOmitted).toBe(true);

    // Everything else about the check has to survive the shed.
    expect(
      snapshot.probeMonitorResponse?.syntheticMonitorResponse?.[0]
        ?.executionTimeInMS,
    ).toBe(900);
    expect(snapshot.evaluationSummary).toBeDefined();
  });

  it("truncates an oversized response body once there are no screenshots left to shed", () => {
    const bodyLength: number = MonitorSummaryResponseBodyMaxLengthInChars + 500;

    const snapshot: MonitorSummarySnapshot = build(MonitorType.Website, {
      dataToProcess: probeResponse({
        responseBody: "B".repeat(bodyLength),
      }),
      maxSizeInBytes: 2000,
    })!;

    expect(snapshot.isResponseBodyTruncated).toBe(true);
    expect((snapshot.probeMonitorResponse?.responseBody as string).length).toBe(
      MonitorSummaryResponseBodyMaxLengthInChars,
    );
    // The head is kept, because that is where an error page's message is.
    expect(
      (snapshot.probeMonitorResponse?.responseBody as string).startsWith("BBB"),
    ).toBe(true);
  });

  it("leaves a response body that is already under the cap alone", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Website, {
      dataToProcess: probeResponse({ responseBody: "Service Unavailable" }),
      maxSizeInBytes: 10,
    })!;

    expect(snapshot.isResponseBodyTruncated).toBeFalsy();
    expect(snapshot.probeMonitorResponse?.responseBody).toBe(
      "Service Unavailable",
    );
  });

  it("keeps an oversized capture rather than storing nothing when there is nothing safe to shed", () => {
    const snapshot: MonitorSummarySnapshot | null = build(MonitorType.Ping, {
      maxSizeInBytes: 1,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.probeMonitorResponse).toBeDefined();
  });
});

describe("MonitorSummarySnapshotUtil.deserialize", () => {
  it("returns null for a missing column, so the reader can fall back to the legacy log", () => {
    expect(MonitorSummarySnapshotUtil.deserialize(undefined)).toBeNull();
    expect(MonitorSummarySnapshotUtil.deserialize(null)).toBeNull();
    expect(MonitorSummarySnapshotUtil.deserialize({})).toBeNull();
  });

  it("refuses a snapshot written by a future version instead of half-rendering it", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Ping)!;
    const stored: JSONObject = MonitorSummarySnapshotUtil.serialize(snapshot)!;

    stored["version"] = MonitorSummarySnapshotVersion + 1;

    expect(MonitorSummarySnapshotUtil.deserialize(stored)).toBeNull();
  });

  it("restores dates as Dates, not as the strings jsonb hands back", () => {
    const snapshot: MonitorSummarySnapshot = build(MonitorType.Website)!;
    const stored: JSONObject = JSON.parse(
      JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
    ) as JSONObject;

    const readBack: MonitorSummarySnapshot =
      MonitorSummarySnapshotUtil.deserialize(stored)!;

    expect(readBack.capturedAt instanceof Date).toBe(true);
    expect(readBack.capturedAt!.getTime()).toBe(CAPTURED_AT.getTime());
  });
});

describe("MonitorSummarySnapshotUtil.serialize", () => {
  it("returns null for nothing to store, so the column is left NULL", () => {
    expect(MonitorSummarySnapshotUtil.serialize(null)).toBeNull();
    expect(MonitorSummarySnapshotUtil.serialize(undefined)).toBeNull();
  });
});

describe("MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog", () => {
  /*
   * Incidents and alerts created before the snapshot column existed. Their
   * createdStateLog holds the same evaluated payload, written with a plain
   * JSON.stringify - so its dates are ISO strings and its ObjectIDs are
   * flattened. Reconstructing from it is what stops every pre-existing
   * incident from showing a blank card.
   */
  function legacyLog(payload: MonitorSummaryDataToProcess): JSONObject {
    return JSON.parse(JSON.stringify(payload)) as JSONObject;
  }

  it("reconstructs a probe check from the stored state log", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: legacyLog(probeResponse()),
        monitorType: MonitorType.Website,
        monitorId: MONITOR_ID.toString(),
        monitorName: "Production API",
        capturedAt: CAPTURED_AT,
      });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.probeMonitorResponse?.responseCode).toBe(503);
    expect(snapshot!.source).toBe(MonitorSummarySnapshotSource.Legacy);
  });

  it("reconstructs every non-manual monitor type from its own state log", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      if (monitorType === MonitorType.Manual) {
        continue;
      }

      const payload: MonitorSummaryDataToProcess | undefined =
        payloadFor(monitorType);

      const snapshot: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
          createdStateLog: legacyLog(payload!),
          monitorType: monitorType,
          capturedAt: CAPTURED_AT,
        });

      expect(snapshot).not.toBeNull();
      expect(snapshot!.monitorType).toBe(monitorType);
      expect(snapshot!.source).toBe(MonitorSummarySnapshotSource.Legacy);
    }
  });

  it("recovers the evaluation summary that the state log embedded", () => {
    /*
     * dataToProcess.evaluationSummary is the same object the pipeline
     * mutates, so the old JSON.stringify dump already carries the criteria
     * results - the reconstruction must not throw them away.
     */
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: legacyLog(
          probeResponse({ evaluationSummary: EVALUATION_SUMMARY }),
        ),
        monitorType: MonitorType.API,
      });

    expect(snapshot!.evaluationSummary?.criteriaResults[0]?.criteriaName).toBe(
      "Is Offline",
    );
  });

  it("gives up rather than guessing when the monitor type is unknown", () => {
    /*
     * The monitor was deleted, or the viewer cannot read it. Guessing a
     * type would route the payload into the wrong view.
     */
    expect(
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: legacyLog(probeResponse()),
        monitorType: undefined,
      }),
    ).toBeNull();
  });

  it("gives up when there is no state log to reconstruct from", () => {
    expect(
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: undefined,
        monitorType: MonitorType.Website,
      }),
    ).toBeNull();

    expect(
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: null,
        monitorType: MonitorType.Website,
      }),
    ).toBeNull();
  });

  it("has no probe name to recover, because the old log never carried one", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: legacyLog(probeResponse()),
        monitorType: MonitorType.Ping,
      });

    expect(snapshot!.probeName).toBeUndefined();
    // The probe id is on the response itself, so that much does survive.
    expect(snapshot!.probeId).toBe(PROBE_ID.toString());
  });

  it("stores nothing for a manual monitor's state log", () => {
    expect(
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: legacyLog(probeResponse()),
        monitorType: MonitorType.Manual,
      }),
    ).toBeNull();
  });
});

describe("MonitorSummarySnapshotUtil.hasRenderableContent", () => {
  it("is false for nothing at all", () => {
    expect(MonitorSummarySnapshotUtil.hasRenderableContent(null)).toBe(false);
    expect(MonitorSummarySnapshotUtil.hasRenderableContent(undefined)).toBe(
      false,
    );
  });

  it("is false for a snapshot that carries only its own type stamp", () => {
    expect(
      MonitorSummarySnapshotUtil.hasRenderableContent({
        version: MonitorSummarySnapshotVersion,
        source: MonitorSummarySnapshotSource.Captured,
        monitorType: MonitorType.Website,
        capturedAt: CAPTURED_AT,
      }),
    ).toBe(false);
  });

  it("is true when only the evaluation log survived", () => {
    expect(
      MonitorSummarySnapshotUtil.hasRenderableContent({
        version: MonitorSummarySnapshotVersion,
        source: MonitorSummarySnapshotSource.Captured,
        monitorType: MonitorType.Website,
        capturedAt: CAPTURED_AT,
        evaluationSummary: EVALUATION_SUMMARY,
      }),
    ).toBe(true);
  });
});
