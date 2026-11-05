import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import CriteriaInEffect from "Common/Server/Utils/Monitor/CriteriaInEffect";
import {
  RecordedScene,
  SCENE_CLOUD,
  RecordedDrill,
  RecordedReading,
  StoredMetricRow,
  foldIntoInventory,
  getClusterSceneNames,
  getCloudDrillNames,
  holdScene,
  readCloudDrill,
  readClusterScene,
  rowsOfReading,
} from "Common/Tests/Types/Monitor/Utils/OpenStackControlPlaneScenes";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import { getAllOpenStackControlPlaneAlertTemplates } from "Common/Types/Monitor/OpenStackControlPlaneAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { OPENSTACK_EXPORTER_HOST_LABEL } from "Common/Types/OpenStack/OpenStackControlPlane";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";

/*
 * EVERY SCENE, THROUGH EVERY TEMPLATE, THROUGH THE REAL READ AND THE REAL EVALUATOR.
 *
 * Noise is a bug, so this is a table with no gaps: for each template, the scenes it fires on and
 * which part it names. It must stay quiet on every other scene, and every scene it does not fire
 * on that is about its own dependency must read as recovered.
 *
 * A scene is what real clusters said (OpenStackControlPlaneScenes), held for a template's whole
 * window, because a recording of a moment cannot say how long it lasted. It goes through
 * monitorOpenStack, the worker's own read, with ClickHouse stood in for by SqlGroupedFold, and
 * MonitorCriteriaEvaluator. What happens after that, incidents and their dependencies, is
 * OpenStackControlPlaneOneIncident.test.ts.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});
jest.mock("Common/Server/Services/OpenStackResourceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackResourceService from "Common/Server/Services/OpenStackResourceService";
import { monitorOpenStack } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const cloudFindOneBy: jest.Mock =
  OpenStackCloudService.findOneBy as unknown as jest.Mock;
const inventoryFindBy: jest.Mock =
  OpenStackResourceService.findBy as unknown as jest.Mock;

const END_MS: number = Date.UTC(2026, 10, 4, 12, 0, 0);
const HELD_MINUTES: number = 16;

const TEMPLATES: Array<OpenStackAlertTemplate> =
  getAllOpenStackControlPlaneAlertTemplates();

interface MetricReadQuery {
  query: {
    name: string;
    attributes?: JSONObject;
    time?: { startValue: Date; endValue: Date };
  };
}

function isRowInQuery(row: StoredMetricRow, args: MetricReadQuery): boolean {
  if (row.name !== args.query.name) {
    return false;
  }

  const window: { startValue: Date; endValue: Date } | undefined =
    args.query.time;

  if (
    window &&
    (row.time.getTime() < new Date(window.startValue).getTime() ||
      row.time.getTime() > new Date(window.endValue).getTime())
  ) {
    return false;
  }

  for (const [key, value] of Object.entries(args.query.attributes || {})) {
    if (row.attributes[key] !== value) {
      return false;
    }
  }

  return true;
}

function serveRows(rows: Array<StoredMetricRow>): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    return foldRowsAsSqlRead(
      rows.filter((row: StoredMetricRow): boolean => {
        return isRowInQuery(row, args as MetricReadQuery);
      }),
      args as FoldedReadArgs,
    );
  });
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rows.filter((row: StoredMetricRow): boolean => {
      return isRowInQuery(row, args as MetricReadQuery);
    });
  });
  // What the scan made of the same rows, as the cloud's inventory holds it.
  inventoryFindBy.mockImplementation(async () => {
    return foldIntoInventory(rows);
  });
}

function stepOf(template: OpenStackAlertTemplate): MonitorStep {
  return template.getMonitorStep({
    cloudIdentifier: SCENE_CLOUD,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Recording",
  });
}

interface Verdict {
  // What the firing criteria names, one word for each series.
  firing: Array<string>;
  recovered: boolean;
}

// The part a series is about, in as few words as a table can hold.
function partOf(labels: JSONObject): string {
  const words: Array<string> = [];

  for (const key of [OPENSTACK_EXPORTER_HOST_LABEL, "queue", "proxy", "database"]) {
    const value: unknown = labels[key];

    if (typeof value === "string" && value) {
      words.push(value);
    }
  }

  return words.length > 0
    ? words.join("/")
    : String(labels[OPENSTACK_REGION_ATTRIBUTE]);
}

async function evaluate(data: {
  template: OpenStackAlertTemplate;
  rows: Array<StoredMetricRow>;
}): Promise<Verdict> {
  const step: MonitorStep = stepOf(data.template);

  serveRows(data.rows);

  const monitorId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  const read: MetricMonitorResponse = await monitorOpenStack({
    monitorStep: step,
    monitorId,
    projectId,
    evaluateUntil: new Date(END_MS),
  });

  const monitor: Monitor = new Monitor();
  monitor.id = monitorId;
  monitor.projectId = projectId;
  monitor.monitorType = MonitorType.OpenStack;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: read,
      monitorStep: step,
      monitor,
      probeApiIngestResponse: { monitorId, rootCause: null },
      evaluationSummary: {
        evaluatedAt: new Date(END_MS),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
      criteriaInEffect: {
        isInEffect: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
      } as unknown as CriteriaInEffect,
    });

  const [firing, recovery] = step.data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];

  return {
    firing: (response.matchedCriteria || [])
      .filter((matched: MatchedCriteriaResult): boolean => {
        return matched.criteriaId === firing.data!.id?.toString();
      })
      .flatMap(
        (matched: MatchedCriteriaResult): Array<PerSeriesCriteriaMatch> => {
          return matched.perSeriesMatches;
        },
      )
      .map((match: PerSeriesCriteriaMatch): string => {
        return partOf(match.labels);
      })
      .sort(),
    recovered:
      response.criteriaMetId?.toString() === recovery.data!.id?.toString(),
  };
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] } as never);
  metricFindBy.mockReset().mockResolvedValue([] as never);
  (MetricTypeService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([] as never);
  cloudFindOneBy.mockReset().mockResolvedValue({ id: ObjectID.generate() } as never);
  inventoryFindBy.mockReset().mockResolvedValue([] as never);
});

// A drill as a timeline: what came before, each minute it lasted, and what came after.
function rowsOfDrill(data: {
  drill: RecordedDrill;
  endOfOutageMs: number;
  heldMinutes: number;
  minutesAfter: number;
}): Array<StoredMetricRow> {
  const { drill } = data;
  const readings: Array<{ minute: number; reading: RecordedReading }> = [];
  const outage: number = Math.max(drill.minutes.length, data.heldMinutes);

  for (let minute: number = -HELD_MINUTES; minute < 0; minute++) {
    readings.push({ minute, reading: drill.before });
  }
  for (let minute: number = 0; minute < outage; minute++) {
    readings.push({
      minute,
      reading: drill.minutes[Math.min(minute, drill.minutes.length - 1)]!,
    });
  }
  for (let minute: number = 0; minute < data.minutesAfter; minute++) {
    readings.push({ minute: outage + minute, reading: drill.recovered });
  }

  return readings.flatMap(
    (
      one: { minute: number; reading: RecordedReading },
      index: number,
    ): Array<StoredMetricRow> => {
      return rowsOfReading({
        scene: {
          name: drill.name,
          readings: [readings[Math.max(index - 1, 0)]!.reading, one.reading],
        },
        reading: one.reading,
        time: new Date(
          data.endOfOutageMs + (one.minute - outage) * 60000 + 30000,
        ),
      });
    },
  );
}

describe("every scene of the recording, through every template", () => {
  const scenes: Array<RecordedScene> = getClusterSceneNames().map(
    readClusterScene,
  );

  test("prints the table", async () => {
    const lines: Array<string> = [];

    for (const template of TEMPLATES) {
      const firesOn: Array<string> = [];
      const notRecovered: Array<string> = [];

      for (const scene of scenes) {
        const verdict: Verdict = await evaluate({
          template,
          rows: holdScene({
            scene,
            fromMs: END_MS - HELD_MINUTES * 60000,
            minutes: HELD_MINUTES,
          }),
        });

        if (verdict.firing.length > 0) {
          firesOn.push(`${scene.name}=[${verdict.firing.join(",")}]`);
        } else if (!verdict.recovered) {
          notRecovered.push(scene.name);
        }
      }

      lines.push(
        `${template.id}\n  fires: ${firesOn.join(" ")}\n  neither: ${notRecovered.join(" ")}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(lines.length).toBe(TEMPLATES.length);
  }, 600000);

  test("prints the drills", async () => {
    const lines: Array<string> = [];
    const all: Array<OpenStackAlertTemplate> = getAllOpenStackAlertTemplates();

    for (const release of ["gazpacho-ovn", "gazpacho-ovs"]) {
      for (const name of getCloudDrillNames(release)) {
        const drill: RecordedDrill = readCloudDrill(release, name);
        const fires: Array<string> = [];
        const afterwards: Array<string> = [];

        for (const template of all) {
          const during: Verdict = await evaluate({
            template,
            rows: rowsOfDrill({
              drill,
              endOfOutageMs: END_MS,
              heldMinutes: 16,
              minutesAfter: 0,
            }),
          });
          if (during.firing.length > 0) {
            fires.push(`${template.id}=[${during.firing.join(",")}]`);
          }
          const after: Verdict = await evaluate({
            template,
            rows: rowsOfDrill({
              drill,
              endOfOutageMs: END_MS - 16 * 60000,
              heldMinutes: 16,
              minutesAfter: 16,
            }),
          });
          if (after.firing.length > 0) {
            afterwards.push(`${template.id}=[${after.firing.join(",")}]`);
          }
        }
        lines.push(
          `${release} ${name}\n  during: ${fires.join(" ")}\n  after: ${afterwards.join(" ")}`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
  }, 900000);
});
