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
  OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
  OPENSTACK_BARE_METAL_STUCK_MINUTES,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";

/*
 * EVERY SCENE OF A REAL IRONIC, THROUGH EVERY BARE METAL TEMPLATE, THROUGH THE REAL READ AND THE REAL
 * EVALUATOR.
 *
 * Noise is a bug, so this is a table with no gaps: for each template, the scenes it fires on and which
 * node it names, and it must stay quiet on every other. A scene is what the agent's exporter answered
 * on a real DevStack with fake hardware (Fixtures/OpenStack/services-ironic), held for a template's
 * whole window at the agent's five-minute scrape, because a recording of a moment can't say how long
 * it lasted. It goes through monitorOpenStack, the worker's own read, with ClickHouse stood in for by
 * SqlGroupedFold, and MonitorCriteriaEvaluator.
 *
 * Each scene is read as the agent's own credential, a project's admin, and with system scope, which
 * sees the nodes that project doesn't own.
 *
 * The one thing nobody recorded is the holding. No node left a failed state or maintenance either, so
 * nothing here shows one of those alerts ending because its node got better: only what the rows of
 * a recovered service read as.
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
const SYSTEM_SCOPE: string = "devstack-system-admin";

const SCENES: ReadonlyArray<string> = [
  "baseline",
  "half-enrolled",
  "maintenance",
  "clean-failed",
  "wait-call-back",
  "deploy-failed",
  "power-off-while-active",
  "conductor-down",
  "api-down",
  "recovered",
];

const IN_ERROR: string = "openstack-bare-metal-node-in-error";
const STUCK: string = "openstack-bare-metal-node-stuck";
const MAINTENANCE: string = "openstack-bare-metal-node-maintenance-too-long";
const POWER: string = "openstack-bare-metal-power-state-unexpected";
const API_DOWN: string = "openstack-bare-metal-api-down";
const CONDUCTOR: string = "openstack-bare-metal-conductor-down";

// Long enough for the whole of each template's window, and no longer than the read reaches.
const HELD_MINUTES: Readonly<Record<string, number>> = {
  [IN_ERROR]: 30,
  [STUCK]: OPENSTACK_BARE_METAL_STUCK_MINUTES + 30,
  [MAINTENANCE]: OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS * 24 * 60 + 30,
  [POWER]: 30,
  [API_DOWN]: 30,
};

const BOTH_FAILED: Array<string> = [
  "ou-node-clean-failed",
  "ou-node-deploy-failed",
];

/*
 * What each template fires on as the agent reads this cloud, by scene and node. Clean failed comes
 * first and never gets better. Nor does the node in maintenance. The other failed node is the one that
 * waited first.
 */
const FIRES_ON: Readonly<Record<string, Record<string, Array<string>>>> = {
  [IN_ERROR]: {
    "clean-failed": ["ou-node-clean-failed"],
    "wait-call-back": ["ou-node-clean-failed"],
    "deploy-failed": BOTH_FAILED,
    "power-off-while-active": BOTH_FAILED,
    "conductor-down": BOTH_FAILED,
    recovered: BOTH_FAILED,
  },
  [STUCK]: {
    "wait-call-back": ["ou-node-deploy-failed"],
  },
  [MAINTENANCE]: {
    maintenance: ["ou-node-maintenance"],
    "clean-failed": ["ou-node-maintenance"],
    "wait-call-back": ["ou-node-maintenance"],
    "deploy-failed": ["ou-node-maintenance"],
    "power-off-while-active": ["ou-node-maintenance"],
    "conductor-down": ["ou-node-maintenance"],
    recovered: ["ou-node-maintenance"],
  },
  // A project is never shown the one node that was deployed, because another project owns it.
  [POWER]: {},
  // The agent's exporter never says so: stopped, it answers nothing at all.
  [API_DOWN]: {},
};

// The same moment with system scope, where it differs from the table above.
const FIRES_ON_WITH_SYSTEM_SCOPE: Readonly<
  Record<string, Record<string, Array<string>>>
> = {
  [POWER]: {
    "power-off-while-active": ["ou-node-active"],
  },
};

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
  templateId: string;
  series: Array<OpenStackRecordedSeries>;
  minutes?: number | undefined;
}): Promise<Verdict> {
  const rows: Array<StoredRow> = holdScene({
    series: data.series.filter((one: OpenStackRecordedSeries): boolean => {
      return one.name.startsWith("openstack_ironic_");
    }),
    minutes: data.minutes || (HELD_MINUTES[data.templateId] as number),
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
            match.labels["hostname"] ||
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

async function differencesFrom(data: {
  table: Readonly<Record<string, Record<string, Array<string>>>>;
  templateIds: ReadonlyArray<string>;
  asCloud?: string | undefined;
}): Promise<Array<string>> {
  const differences: Array<string> = [];

  for (const templateId of data.templateIds) {
    for (const scene of SCENES) {
      const verdict: Verdict = await evaluate({
        templateId,
        series: readOpenStackScene("services-ironic", scene, data.asCloud),
      });
      const expected: Array<string> = data.table[templateId]?.[scene] || [];

      if (JSON.stringify(verdict.firing) !== JSON.stringify(expected)) {
        differences.push(
          `${templateId} on ${scene}: ${JSON.stringify(verdict.firing)} and not ${JSON.stringify(expected)}`,
        );
      }
    }
  }

  return differences;
}

describe("every scene of a real Ironic, through every bare metal template", () => {
  const TEMPLATE_IDS: ReadonlyArray<string> = Object.keys(FIRES_ON);

  test("the table holds every bare metal template there is", () => {
    expect(
      getAllOpenStackAlertTemplates()
        .filter((template: OpenStackAlertTemplate): boolean => {
          return (
            template.forService === OpenStackServiceType.BareMetal &&
            !template.requiresProbe
          );
        })
        .map((template: OpenStackAlertTemplate): string => {
          return template.id;
        })
        .sort(),
    ).toEqual([...TEMPLATE_IDS].sort());
  });

  test("as the agent's own credential reads it, each fires as the table says, and nowhere else", async () => {
    expect(
      await differencesFrom({ table: FIRES_ON, templateIds: TEMPLATE_IDS }),
    ).toEqual([]);
  }, 600000);

  test("with system scope, the node a project can't see is what it fires on", async () => {
    expect(
      await differencesFrom({
        table: FIRES_ON_WITH_SYSTEM_SCOPE,
        templateIds: [POWER],
        asCloud: SYSTEM_SCOPE,
      }),
    ).toEqual([]);
  }, 600000);
});

describe("a node forced to clean failed, and one left in maintenance", () => {
  test("clean failed is an alert of its own, by name, and nothing is in the other templates for it", async () => {
    const series: Array<OpenStackRecordedSeries> = readOpenStackScene(
      "services-ironic",
      "clean-failed",
    );

    expect((await evaluate({ templateId: IN_ERROR, series })).firing).toEqual([
      "ou-node-clean-failed",
    ]);
    expect((await evaluate({ templateId: STUCK, series })).firing).toEqual([]);
    expect((await evaluate({ templateId: POWER, series })).firing).toEqual([]);
  }, 600000);

  test("in maintenance for less than the line is planned: no alert yet", async () => {
    const series: Array<OpenStackRecordedSeries> = readOpenStackScene(
      "services-ironic",
      "maintenance",
    );

    expect(
      (
        await evaluate({
          templateId: MAINTENANCE,
          series,
          minutes:
            (OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS - 1) * 24 * 60,
        })
      ).firing,
    ).toEqual([]);
    expect(
      (await evaluate({ templateId: MAINTENANCE, series })).firing,
    ).toEqual(["ou-node-maintenance"]);
    // And never an error: it is in service in every word but this.
    expect((await evaluate({ templateId: IN_ERROR, series })).firing).toEqual(
      [],
    );
  }, 600000);

  test("a callback still within the line is on its way, and past it stuck", async () => {
    const series: Array<OpenStackRecordedSeries> = readOpenStackScene(
      "services-ironic",
      "wait-call-back",
    );

    expect(
      (await evaluate({ templateId: STUCK, series, minutes: 60 })).firing,
    ).toEqual([]);
    expect((await evaluate({ templateId: STUCK, series })).firing).toEqual([
      "ou-node-deploy-failed",
    ]);
  }, 600000);
});

describe("a stopped conductor, which only a probe can say", () => {
  /*
   * Ironic's own answers: services-ironic/{baseline,conductor-down}/api/ironic-conductors-as-system.json.
   * The exporter has no such series, so these are that answer as the probe's writer turns it into
   * one (OpenStackBareMetalCollection.test.ts holds the two together).
   */
  function conductorSeries(scene: string): Array<OpenStackRecordedSeries> {
    const answer: { conductors: Array<JSONObject> } = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../../Common/Tests/Fixtures/OpenStack/services-ironic",
          scene,
          "api",
          "ironic-conductors-as-system.json",
        ),
        "utf8",
      ),
    );

    return answer.conductors.map(
      (conductor: JSONObject): OpenStackRecordedSeries => {
        return {
          name: "openstack_ironic_agent_state",
          labels: {
            hostname: conductor["hostname"] as string,
            service: "ironic-conductor",
          },
          value: conductor["alive"] ? 1 : 0,
        };
      },
    );
  }

  const UP: OpenStackRecordedSeries = {
    name: "openstack_ironic_up",
    labels: {},
    value: 1,
  };

  test("alive, it reads as nothing wrong", async () => {
    const verdict: Verdict = await evaluate({
      templateId: CONDUCTOR,
      series: [UP, ...conductorSeries("baseline")],
      minutes: 30,
    });

    expect(verdict).toEqual({ firing: [], recovered: true });
  }, 600000);

  test("stopped, it names its host, with Ironic's API still up", async () => {
    const verdict: Verdict = await evaluate({
      templateId: CONDUCTOR,
      series: [UP, ...conductorSeries("conductor-down")],
      minutes: 30,
    });

    expect(verdict.firing).toEqual(["compute-01"]);
  }, 600000);

  test("started again, it reads as recovered", async () => {
    const verdict: Verdict = await evaluate({
      templateId: CONDUCTOR,
      series: [UP, ...conductorSeries("recovered")],
      minutes: 30,
    });

    expect(verdict).toEqual({ firing: [], recovered: true });
  }, 600000);
});

describe("what a stopped Ironic reads as", () => {
  const STOPPED: Array<OpenStackRecordedSeries> = readOpenStackScene(
    "services-ironic",
    "api-down",
  );

  test("the agent's own exporter says nothing, so no template fires and none recovers", async () => {
    for (const templateId of [IN_ERROR, STUCK, MAINTENANCE, POWER, API_DOWN]) {
      const verdict: Verdict = await evaluate({ templateId, series: STOPPED });

      expect({ templateId, ...verdict }).toEqual({
        templateId,
        firing: [],
        recovered: false,
      });
    }
  }, 600000);
});
