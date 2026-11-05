import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import CriteriaInEffect from "Common/Server/Utils/Monitor/CriteriaInEffect";
import {
  OpenStackRecordedSeries,
  readOpenStackScene,
} from "Common/Tests/Helpers/OpenStackRecordings";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import {
  OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
  OPENSTACK_REGION_ATTRIBUTE,
} from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES,
  OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES,
  OPENSTACK_SHARE_STUCK_MINUTES,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";

/*
 * EVERY SCENE OF A REAL SERVICE, THROUGH EVERY ONE OF ITS TEMPLATES, THROUGH THE REAL READ AND THE REAL EVALUATOR.
 *
 * Noise is a bug, so this is a table with no gaps, as OpenStackBareMetalReplay.test.ts is for Ironic: for each
 * template, the scenes it fires on and what it names, and it must stay quiet on every other. A scene is what the
 * agent's exporter answered on a real DevStack, held for a template's whole window at the agent's five-minute
 * scrape, because a recording of a moment can't say how long it lasted. It goes through monitorOpenStack, the
 * worker's own read, with ClickHouse stood in for by SqlGroupedFold, and MonitorCriteriaEvaluator.
 *
 * What nobody recorded is the holding, and the receiver's own `up` for a job, which a recording of the exporter's
 * text can't hold: it reads 1 here, because the exporter answered each of these.
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

const END_MS: number = Date.UTC(2026, 10, 5, 12, 0, 0);
const CLOUD: string = "recording";
const REGION: string = "RegionOne";
const SCRAPE_EVERY_MINUTES: number = 5;

interface OpenStackServiceReplay {
  group: string;
  service: OpenStackServiceType;
  // The job the agent's collector stamps on what it scrapes for this service.
  job: string;
  metricPrefix: string;
  // Each of this service's scenes, in the order they were recorded.
  scenes: ReadonlyArray<string>;
  /*
   * Where the exporter says nothing of the service at all, so a template can't tell: it holds what it had,
   * neither firing nor recovering, until it hears something.
   */
  saysNothingOn?: ReadonlyArray<string> | undefined;
  heldMinutes: Readonly<Record<string, number>>;
  // By template and scene: what it names. A scene that isn't there fires nothing.
  firesOn: Readonly<Record<string, Readonly<Record<string, Array<string>>>>>;
}

// Neither gets better on any scene after the one that made it: nothing fixes them.
const SHARE_IN_ERROR: Array<string> = ["ou-share-error"];
const SHARE_STUCK: Array<string> = ["ou-share-stuck"];
const BOTH_DATABASES: Array<string> = ["ou-db-no-host", "ou-db-ok"];

const REPLAYS: ReadonlyArray<OpenStackServiceReplay> = [
  {
    group: "services-manila",
    service: OpenStackServiceType.SharedFileSystems,
    job: "sharev2",
    metricPrefix: "openstack_sharev2_",
    scenes: [
      "baseline",
      "share-error",
      "share-stuck",
      "share-service-stopped",
      "share-service-killed",
      "scheduler-stopped",
      "api-down",
      "recovered",
    ],
    heldMinutes: {
      "openstack-share-in-error": 30,
      "openstack-share-stuck": OPENSTACK_SHARE_STUCK_MINUTES + 30,
      "openstack-shared-file-systems-api-down": 30,
    },
    firesOn: {
      "openstack-share-in-error": {
        "share-error": SHARE_IN_ERROR,
        "share-stuck": SHARE_IN_ERROR,
        "share-service-stopped": SHARE_IN_ERROR,
        "share-service-killed": SHARE_IN_ERROR,
        "scheduler-stopped": SHARE_IN_ERROR,
        recovered: SHARE_IN_ERROR,
      },
      "openstack-share-stuck": {
        "share-stuck": SHARE_STUCK,
        "share-service-stopped": SHARE_STUCK,
        "share-service-killed": SHARE_STUCK,
        "scheduler-stopped": SHARE_STUCK,
        recovered: SHARE_STUCK,
      },
      "openstack-shared-file-systems-api-down": {
        "api-down": [REGION],
      },
    },
  },
  {
    group: "services-trove",
    service: OpenStackServiceType.Database,
    job: "database",
    metricPrefix: "openstack_trove_",
    scenes: [
      "baseline",
      "instance-building",
      "instance-error",
      "taskmanager-down",
      "api-down",
    ],
    heldMinutes: {
      "openstack-database-instance-in-error": 30,
      "openstack-database-instance-stuck":
        OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES + 30,
      "openstack-database-volume-nearly-full": 30,
      "openstack-database-api-down": 30,
    },
    firesOn: {
      "openstack-database-instance-in-error": {
        "instance-error": BOTH_DATABASES,
        "taskmanager-down": BOTH_DATABASES,
      },
      "openstack-database-instance-stuck": {
        "instance-building": ["ou-db-ok"],
      },
      // No runner got a guest to ACTIVE, so no real volume has ever read anything but 0 used.
      "openstack-database-volume-nearly-full": {},
      "openstack-database-api-down": {
        "api-down": [REGION],
      },
    },
  },
  {
    group: "services-designate-barbican-swift",
    service: OpenStackServiceType.Dns,
    job: "dns",
    metricPrefix: "openstack_designate_",
    scenes: [
      "designate-baseline",
      "designate-pending",
      "designate-error",
      "designate-api-down",
    ],
    saysNothingOn: ["designate-api-down"],
    heldMinutes: {
      "openstack-dns-zone-in-error": 30,
      "openstack-dns-zone-stuck-pending":
        OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES + 30,
      "openstack-dns-recordset-in-error": 30,
    },
    firesOn: {
      "openstack-dns-zone-in-error": {
        "designate-error": ["ou-error.example.org."],
      },
      "openstack-dns-zone-stuck-pending": {
        "designate-pending": [
          "ou-active.example.org.",
          "ou-pending.example.org.",
        ],
        // The zone with a change on its way when the DNS server stopped, and held there.
        "designate-error": ["ou-active.example.org."],
      },
      // Named by its zone: one failure of a zone's writes is one incident.
      "openstack-dns-recordset-in-error": {
        "designate-error": ["ou-active.example.org."],
      },
    },
  },
];

interface MetricReadQuery {
  query: {
    name: string;
    attributes?: JSONObject;
    time?: { startValue: Date; endValue: Date };
  };
}

interface StoredRow {
  name: string;
  time: Date;
  value: number;
  attributes: JSONObject;
}

// What the agent's collector sends: it drops a label with nothing in it, and stamps the rest.
function storedAttributes(series: OpenStackRecordedSeries): JSONObject {
  const attributes: JSONObject = {
    [OPENSTACK_REGION_ATTRIBUTE]: REGION,
    [OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE]: CLOUD,
  };

  for (const [key, value] of Object.entries(series.labels)) {
    if (value !== "") {
      attributes[key] = value;
    }
  }

  return attributes;
}

function holdScene(data: {
  series: Array<OpenStackRecordedSeries>;
  minutes: number;
}): Array<StoredRow> {
  const rows: Array<StoredRow> = [];

  for (
    let before: number = data.minutes;
    before > 0;
    before -= SCRAPE_EVERY_MINUTES
  ) {
    const time: Date = new Date(END_MS - before * 60000 + 30000);

    for (const one of data.series) {
      rows.push({
        name: one.name,
        time,
        value: one.value,
        attributes: storedAttributes(one),
      });
    }
  }

  return rows;
}

function isRowInQuery(row: StoredRow, args: MetricReadQuery): boolean {
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

function templateOf(id: string): OpenStackAlertTemplate {
  const template: OpenStackAlertTemplate | undefined =
    getAllOpenStackAlertTemplates().find(
      (one: OpenStackAlertTemplate): boolean => {
        return one.id === id;
      },
    );

  if (!template) {
    throw new Error(`No template ${id}`);
  }

  return template;
}

interface Verdict {
  firing: Array<string>;
  recovered: boolean;
}

async function evaluate(data: {
  replay: OpenStackServiceReplay;
  templateId: string;
  series: Array<OpenStackRecordedSeries>;
}): Promise<Verdict> {
  const rows: Array<StoredRow> = holdScene({
    series: [
      ...data.series.filter((one: OpenStackRecordedSeries): boolean => {
        return one.name.startsWith(data.replay.metricPrefix);
      }),
      {
        name: "up",
        labels: { openstack_service: data.replay.job },
        value: 1,
      },
    ],
    minutes: data.replay.heldMinutes[data.templateId] as number,
  });

  metricAggregateBy.mockImplementation(async (args: unknown) => {
    return foldRowsAsSqlRead(
      rows.filter((row: StoredRow): boolean => {
        return isRowInQuery(row, args as MetricReadQuery);
      }),
      args as FoldedReadArgs,
    );
  });
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rows.filter((row: StoredRow): boolean => {
      return isRowInQuery(row, args as MetricReadQuery);
    });
  });

  const step: MonitorStep = templateOf(data.templateId).getMonitorStep({
    cloudIdentifier: CLOUD,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Recording",
  });

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
        return String(
          match.labels["name"] ||
            match.labels["zone_name"] ||
            match.labels["container_name"] ||
            match.labels[OPENSTACK_REGION_ATTRIBUTE],
        );
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
  (OpenStackCloudService.findOneBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue({ id: ObjectID.generate() } as never);
  (OpenStackResourceService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([] as never);
});

describe.each(
  REPLAYS.map(
    (replay: OpenStackServiceReplay): [string, OpenStackServiceReplay] => {
      return [replay.service, replay];
    },
  ),
)(
  "every scene of a real %s, through every template it has",
  (_name: string, replay: OpenStackServiceReplay) => {
    const templateIds: ReadonlyArray<string> = Object.keys(replay.firesOn);

    test("the table holds every template the agent's series can fire", () => {
      expect(
        getAllOpenStackAlertTemplates()
          .filter((template: OpenStackAlertTemplate): boolean => {
            return (
              template.forService === replay.service && !template.requiresProbe
            );
          })
          .map((template: OpenStackAlertTemplate): string => {
            return template.id;
          })
          .sort(),
      ).toEqual([...templateIds].sort());
    });

    test("each fires as the table says, and nowhere else", async () => {
      const differences: Array<string> = [];

      for (const templateId of templateIds) {
        for (const scene of replay.scenes) {
          const verdict: Verdict = await evaluate({
            replay,
            templateId,
            series: readOpenStackScene(replay.group, scene),
          });
          const expected: Array<string> =
            replay.firesOn[templateId]?.[scene] || [];

          if (JSON.stringify(verdict.firing) !== JSON.stringify(expected)) {
            differences.push(
              `${templateId} on ${scene}: ${JSON.stringify(verdict.firing)} and not ${JSON.stringify(expected)}`,
            );
          }

          // What it doesn't fire on, it has recovered on, with no one telling it to.
          const saysNothing: boolean = Boolean(
            replay.saysNothingOn?.includes(scene),
          );
          if (expected.length === 0 && verdict.recovered === saysNothing) {
            differences.push(
              `${templateId} on ${scene}: ${verdict.recovered ? "recovered" : "didn't recover"}`,
            );
          }
        }
      }

      expect(differences).toEqual([]);
    }, 600000);
  },
);
