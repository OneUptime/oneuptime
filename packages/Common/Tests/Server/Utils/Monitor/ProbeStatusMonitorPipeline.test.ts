import MetricType from "../../../../Models/DatabaseModels/MetricType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import {
  CheckOn,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "../../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import MonitorLogSummaryUtil from "../../../../Utils/Monitor/MonitorLogSummaryUtil";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryInfoProps,
} from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import ProbeStatusMonitorUtil from "../../../../Utils/Monitor/ProbeStatusMonitorUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a Probe Status evaluation becomes once the pipeline has it: the
 * words of the incident it opens (template variables), the explanation of
 * each check, the "online probes" series it records, and the frozen summary
 * an incident, an alert and a Monitoring Logs row keep of it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000010",
);

function probe(
  name: string,
  isConnected: boolean,
  isGlobalProbe: boolean = false,
): ProbeStatusMonitorProbe {
  return {
    probeId: ObjectID.generate().toString(),
    probeName: name,
    isGlobalProbe: isGlobalProbe,
    isConnected: isConnected,
    lastAliveAt: new Date(
      isConnected ? "2026-09-21T11:59:40.000Z" : "2026-09-21T11:45:00.000Z",
    ),
  };
}

function evaluation(
  probes: Array<ProbeStatusMonitorProbe>,
): ProbeStatusMonitorResponse {
  const connected: number = probes.filter(
    (item: ProbeStatusMonitorProbe): boolean => {
      return item.isConnected;
    },
  ).length;

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probes: probes,
    connectedProbeCount: connected,
    disconnectedProbeCount: probes.length - connected,
    missingProbeIds: [],
    checkedAt: new Date("2026-09-21T12:00:00.000Z"),
  };
}

const singaporeDown: ProbeStatusMonitorResponse = evaluation([
  probe("Frankfurt", true),
  probe("Singapore", false),
]);

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item.id = MONITOR_ID;
  item.name = "Probe health";
  item.monitorType = MonitorType.ProbeStatus;
  return item;
}

describe("template variables of a Probe Status monitor", () => {
  function storageMap(
    dataToProcess: ProbeStatusMonitorResponse,
  ): JSONObject {
    return MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.ProbeStatus,
      dataToProcess: dataToProcess,
      monitor: monitor(),
    });
  }

  test("name the disconnected probes, count both ways, and sum it up", () => {
    const map: JSONObject = storageMap(singaporeDown);

    expect(map["disconnectedProbeNames"]).toBe("Singapore");
    expect(map["connectedProbeNames"]).toBe("Frankfurt");
    expect(map["disconnectedProbeCount"]).toBe(1);
    expect(map["connectedProbeCount"]).toBe(1);
    expect(map["probeStatusSummary"]).toBe(
      "1 of 2 probes is disconnected: Singapore.",
    );
    expect(map["monitorName"]).toBe("Probe health");
  });

  test("list every probe, with its last heartbeat as a timestamp", () => {
    expect(storageMap(singaporeDown)["probes"]).toEqual([
      {
        probeName: "Frankfurt",
        isConnected: true,
        isGlobalProbe: false,
        lastAliveAt: "2026-09-21T11:59:40.000Z",
      },
      {
        probeName: "Singapore",
        isConnected: false,
        isGlobalProbe: false,
        lastAliveAt: "2026-09-21T11:45:00.000Z",
      },
    ]);
  });

  test("are always set: every probe up leaves the disconnected names empty, never the placeholder", () => {
    const map: JSONObject = storageMap(
      evaluation([probe("Frankfurt", true), probe("Singapore", true)]),
    );

    expect(map["disconnectedProbeNames"]).toBe("");
    expect(map["disconnectedProbeCount"]).toBe(0);
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "Down: {{disconnectedProbeNames}}.",
        storageMap: map,
      }),
    ).toBe("Down: .");
  });

  test("render the default incident's title and description", () => {
    const offline: MonitorCriteriaInstance =
      MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
        monitorType: MonitorType.ProbeStatus,
        monitorStatusId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Probe health",
      });
    const map: JSONObject = storageMap(singaporeDown);

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: offline.data!.incidents[0]!.title,
        storageMap: MonitorTemplateUtil.buildTitleStorageMap({
          monitorType: MonitorType.ProbeStatus,
          storageMap: map,
        }),
      }),
    ).toBe("Probe disconnected: Singapore");

    const description: string = MonitorTemplateUtil.processMarkdownTemplateString(
      {
        value: offline.data!.incidents[0]!.description,
        storageMap: map,
      },
    );

    expect(description).toContain("Singapore");
    expect(description).toContain("three minutes");
    expect(description).not.toContain("{{");
  });

  test("a probe named like a link is placed as a reported value: the link cannot form", () => {
    const map: JSONObject = storageMap(
      evaluation([probe("Probe [x](http://evil.example)", false)]),
    );

    const description: string = MonitorTemplateUtil.processMarkdownTemplateString(
      { value: "{{probeStatusSummary}}", storageMap: map },
    );

    expect(description).toContain("is disconnected.");
    expect(description).not.toContain("](http");
  });

  test("the editor's list offers exactly what the server sets", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.ProbeStatus,
      });
    const group: TemplateVariableGroup | undefined = groups.find(
      (item: TemplateVariableGroup): boolean => {
        return item.title === "Probe Status";
      },
    );

    expect(group).toBeDefined();
    const keys: Array<string> = group!.variables.map(
      (variable: TemplateVariable): string => {
        return variable.key;
      },
    );

    expect(keys.sort()).toEqual(
      Object.keys(storageMap(singaporeDown))
        .filter((key: string): boolean => {
          // The identity and series variables have groups of their own.
          return ![
            "monitorName",
            "monitorId",
            "monitorType",
            "seriesResourceSuffix",
            "seriesResourceSummary",
            "seriesResourceBlock",
            "seriesDebugCommands",
          ].includes(key);
        })
        .sort(),
    );
  });
});

describe("explaining a Probe Status check", () => {
  function explain(checkOn: CheckOn): string | null {
    return MonitorCriteriaObservationBuilder.describeFilterObservation({
      monitor: monitor(),
      criteriaFilter: { checkOn: checkOn, filterType: FilterType.GreaterThan, value: 0 },
      dataToProcess: singaporeDown,
      monitorStep: new MonitorStep(),
    });
  }

  test("Disconnected Probes: how many of how many, and which", () => {
    expect(explain(CheckOn.DisconnectedProbes)).toBe(
      "1 of 2 probes disconnected (Singapore).",
    );
  });

  test("Connected Probes: the same, the other way", () => {
    expect(explain(CheckOn.ConnectedProbes)).toBe(
      "1 of 2 probes connected (Frankfurt).",
    );
  });

  test("none disconnected names nobody", () => {
    expect(
      MonitorCriteriaObservationBuilder.describeProbeStatusObservation({
        criteriaFilter: {
          checkOn: CheckOn.DisconnectedProbes,
          filterType: FilterType.EqualTo,
          value: 0,
        },
        dataToProcess: evaluation([probe("Frankfurt", true)]),
      }),
    ).toBe("0 of 1 probe disconnected.");
  });

  test("a payload that is not a Probe Status evaluation explains nothing", () => {
    const probeCheck: ProbeMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      monitoredAt: new Date(),
    };

    expect(
      MonitorCriteriaObservationBuilder.describeProbeStatusObservation({
        criteriaFilter: {
          checkOn: CheckOn.DisconnectedProbes,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
        dataToProcess: probeCheck,
      }),
    ).toBeNull();
  });
});

describe("the series a Probe Status monitor records", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMaps: Array<Dictionary<MetricType>>;

  beforeEach(() => {
    insertedRows = [];
    indexedMaps = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          indexedMaps.push(data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one connected and one disconnected count per evaluation, on the monitor", async () => {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: singaporeDown,
      probeName: undefined,
      monitorName: "Probe health",
    });

    expect(
      insertedRows.map((row: JSONObject): unknown => {
        return row["name"];
      }),
    ).toEqual([
      MonitorMetricType.ConnectedProbes,
      MonitorMetricType.DisconnectedProbes,
    ]);

    for (const row of insertedRows) {
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["primaryEntityId"]).toBe(MONITOR_ID.toString());
      expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
      expect((row["attributes"] as JSONObject)["monitorName"]).toBe(
        "Probe health",
      );
      expect((row["attributes"] as JSONObject)["probeName"]).toBeUndefined();
    }

    expect(insertedRows[0]!["value"]).toBe(1);
    expect(insertedRows[1]!["value"]).toBe(1);
    expect(MonitorMetricType.ConnectedProbes).toBe(
      "oneuptime.monitor.probes.connected",
    );
    expect(MonitorMetricType.DisconnectedProbes).toBe(
      "oneuptime.monitor.probes.disconnected",
    );

    expect(Object.keys(indexedMaps[0] || {}).sort()).toEqual(
      [
        MonitorMetricType.ConnectedProbes,
        MonitorMetricType.DisconnectedProbes,
      ].sort(),
    );
    expect(indexedMaps[0]![MonitorMetricType.ConnectedProbes]!.unit).toBe(
      "probes",
    );
  });

  test("zero is recorded as zero, not left out", async () => {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: evaluation([probe("Frankfurt", true)]),
      probeName: undefined,
      monitorName: "Probe health",
    });

    const disconnected: JSONObject | undefined = insertedRows.find(
      (row: JSONObject): boolean => {
        return row["name"] === MonitorMetricType.DisconnectedProbes;
      },
    );

    expect(disconnected?.["value"]).toBe(0);
  });

  test("a probe's own check records none of them", async () => {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: ObjectID.generate(),
        probeId: ObjectID.generate(),
        failureCause: "",
        isOnline: true,
        monitoredAt: new Date(),
      },
      probeName: "Frankfurt",
      monitorName: "Storefront",
    });

    expect(
      insertedRows.filter((row: JSONObject): boolean => {
        return (
          row["name"] === MonitorMetricType.ConnectedProbes ||
          row["name"] === MonitorMetricType.DisconnectedProbes
        );
      }),
    ).toEqual([]);
  });
});

describe("the summary an incident, an alert and a log row keep", () => {
  test("a Probe Status evaluation is stored as the probes it found, not as a probe's check", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: MonitorType.ProbeStatus,
        dataToProcess: singaporeDown,
        monitorId: MONITOR_ID.toString(),
        monitorName: "Probe health",
        capturedAt: new Date("2026-09-21T12:00:00.000Z"),
      });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.probeStatusMonitorResponse).toBe(singaporeDown);
    expect(snapshot!.probeMonitorResponse).toBeUndefined();
    expect(snapshot!.probeId).toBeUndefined();
    expect(MonitorSummarySnapshotUtil.hasRenderableContent(snapshot)).toBe(
      true,
    );
  });

  test("survives the jsonb column, and reads back into the summary's props", () => {
    const snapshot: MonitorSummarySnapshot =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: MonitorType.ProbeStatus,
        dataToProcess: singaporeDown,
        capturedAt: new Date("2026-09-21T12:00:00.000Z"),
      })!;

    const stored: JSONObject = JSON.parse(
      JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
    ) as JSONObject;
    const restored: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.deserialize(stored);

    const props: MonitorSummaryInfoProps =
      MonitorSummarySnapshotUtil.toSummaryInfoProps(restored!);

    expect(props.monitorType).toBe(MonitorType.ProbeStatus);
    expect(props.probeMonitorResponses).toBeUndefined();

    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse(props.probeStatusMonitorResponse);

    expect(parsed?.disconnectedProbeCount).toBe(1);
    expect(parsed?.probes[1]?.probeName).toBe("Singapore");
    expect(parsed?.probes[1]?.lastAliveAt?.toISOString()).toBe(
      "2026-09-21T11:45:00.000Z",
    );
  });

  test("a payload of another shape is not stored as one", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: MonitorType.ProbeStatus,
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          monitorStepId: ObjectID.generate(),
          probeId: ObjectID.generate(),
          failureCause: "",
          monitoredAt: new Date(),
        },
        capturedAt: new Date(),
      });

    // Nothing worth a card: no probes, no evaluation.
    expect(snapshot).toBeNull();
  });

  test("a Monitoring Logs row shows the probes it evaluated", () => {
    const logBody: JSONObject = JSON.parse(
      JSON.stringify({
        ...singaporeDown,
        evaluationSummary: {
          evaluatedAt: "2026-09-21T12:00:00.000Z",
          criteriaResults: [],
          events: [],
        },
      }),
    ) as JSONObject;

    const props: MonitorSummaryInfoProps =
      MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: MonitorType.ProbeStatus,
        logBody: logBody,
        monitoredAt: new Date("2026-09-21T12:00:00.000Z"),
      });

    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse(props.probeStatusMonitorResponse);

    expect(parsed?.probes).toHaveLength(2);
    expect(parsed?.connectedProbeCount).toBe(1);
    expect(props.probeMonitorResponses).toBeUndefined();
  });

  test("JSONFunctions' round trip keeps the evaluation readable", () => {
    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse(
        JSONFunctions.deserialize(
          JSON.parse(
            JSON.stringify(
              JSONFunctions.serialize(singaporeDown as unknown as JSONObject),
            ),
          ) as JSONObject,
        ),
      );

    expect(parsed?.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(parsed?.checkedAt.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });
});
