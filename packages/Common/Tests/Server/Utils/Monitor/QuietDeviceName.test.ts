/*
 * isolated-vm is a native addon the evaluator loads through
 * JavaScript-expression criteria; nothing here runs one.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { SpanService } from "../../../../Server/Services/SpanService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorRecordText, {
  MonitorRecordTextResult,
} from "../../../../Server/Utils/Monitor/MonitorRecordText";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import PerEntityCriteriaFanOut, {
  FanOutEntity,
} from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import {
  ExpectedTraceGroup,
  TRACE_GROUP_DEVICE_CONTEXT,
  TraceGroupBreakdown,
  TraceGroupContextLabel,
  getTraceGroupContextAttributes,
  getTraceGroupContextLabels,
  mergeQuietGroups,
  toGroupContext,
} from "../../../../Server/Utils/Monitor/TraceGroupAbsence";
import TraceGroupCriteriaFanOut from "../../../../Server/Utils/Monitor/TraceGroupCriteriaFanOut";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Query from "../../../../Server/Types/AnalyticsDatabase/Query";
import Span from "../../../../Models/AnalyticsModels/Span";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepTraceMonitorUtil } from "../../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  RumAlertTemplateArgs,
  getRumAlertTemplateById,
} from "../../../../Types/Monitor/RumAlertTemplates";
import SeriesLabelDisplay from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import TraceMonitorGroupResult from "../../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, it, jest } from "@jest/globals";
import { decodedQueryParams } from "../../../Helpers/StatementEcho";

/*
 * #9925: a kiosk fleet's on-call engineer thinks in kiosk names ("Store
 * 0412, lane 3"), not in install UUIDs. Device Stopped Reporting's alert
 * said "Install: 1b4e28ba-2fa1-..." and nothing else; it now names the
 * device by the host.name its last spans carried, and its model, as
 * display-only context beside the install - never part of the group's
 * fingerprint, so a device renamed while its alert is open stays the same
 * alert. A device that sends no name reads by its model and install, and
 * one that sends neither by its install, as before.
 */

const INSTALL: string = "resource.app.installation.id";
const DEVICE_ID: string = "resource.device.id";
const KIOSK: string = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const OTHER_KIOSK: string = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const DEVICE_LABELS: Array<TraceGroupContextLabel> = getTraceGroupContextLabels(
  [INSTALL],
);

function quietInstall(
  id: string,
  context?: JSONObject | undefined,
): TraceMonitorGroupResult {
  const labels: JSONObject = { [INSTALL]: id };

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    spanCount: 0,
    isQuiet: true,
    ...(context ? { context: context } : {}),
  };
}

function groupedResponse(
  groups: Array<TraceMonitorGroupResult>,
): TraceMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    spanCount: 12,
    spanQuery: {},
    groupByAttributes: [INSTALL],
    groupBreakdown: groups,
    totalGroupCount: groups.length,
  };
}

function quietCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "quiet",
    name: "A device sent no spans in an hour",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.LessThan,
        value: 1,
      } as CriteriaFilter,
    ],
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: false,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function groupedStep(): MonitorStep {
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [quietCriteria()] };

  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  step.data!.traceMonitor = {
    ...MonitorStepTraceMonitorUtil.getDefault(),
    lastXSecondsOfSpans: 3600,
    groupByAttributes: [INSTALL],
  };

  return step;
}

function tracesMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.Traces;
  monitor.name = "Kiosk Ordering";
  return monitor;
}

async function evaluate(
  groups: Array<TraceMonitorGroupResult>,
): Promise<ProbeApiIngestResponse> {
  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: groupedResponse(groups) as DataToProcess,
    monitorStep: groupedStep(),
    monitor: tracesMonitor(),
    probeApiIngestResponse: { monitorId: MONITOR_ID, rootCause: null },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

// The words Device Stopped Reporting's alert gets for one quiet install.
function deviceStoppedReportingText(input: {
  install: string;
  context?: JSONObject | undefined;
}): MonitorRecordTextResult {
  const args: RumAlertTemplateArgs = {
    rumApplicationId: ObjectID.generate().toString(),
    monitorName: "Kiosk Ordering",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  } as unknown as RumAlertTemplateArgs;

  const step: MonitorStep = getRumAlertTemplateById(
    "rum-device-stopped-reporting",
  )!.getMonitorStep(args);
  const breach: MonitorCriteriaInstance =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
  const seriesLabels: JSONObject = { [INSTALL]: input.install };

  const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.Traces,
    dataToProcess: groupedResponse([
      quietInstall(input.install, input.context),
    ]) as DataToProcess,
    seriesLabels: seriesLabels,
    seriesContext: input.context,
  });

  return MonitorRecordText.render({
    titleTemplate: breach.data!.alerts[0]!.title,
    descriptionTemplate: breach.data!.alerts[0]!.description,
    monitorType: MonitorType.Traces,
    storageMap: storageMap,
    seriesLabels: seriesLabels,
    seriesContext: input.context,
  });
}

describe("which context a grouped Traces monitor reads about its groups", () => {
  it("reads a device's name and model when a group-by key names one device", () => {
    expect(getTraceGroupContextLabels([INSTALL])).toEqual([
      { label: "device.name", attributes: ["resource.host.name"] },
      {
        label: "device.model.name",
        attributes: [
          "resource.device.model.name",
          "resource.device.model.identifier",
        ],
      },
    ]);
    // An iOS app's devices are grouped by the device.id it sends.
    expect(getTraceGroupContextLabels([DEVICE_ID])).toEqual(
      getTraceGroupContextLabels([INSTALL]),
    );
    expect(getTraceGroupContextLabels([` ${INSTALL} `])).toHaveLength(2);
  });

  it("reads none for a group that is not one device: a route, a status, a screen", () => {
    expect(getTraceGroupContextLabels(["http.route"])).toEqual([]);
    expect(
      getTraceGroupContextLabels(["app.screen.name", "resource.host.name"]),
    ).toEqual([]);
    expect(getTraceGroupContextLabels([])).toEqual([]);
  });

  it("reads nothing the groups are already split by", () => {
    expect(getTraceGroupContextLabels([INSTALL, "resource.host.name"])).toEqual(
      [
        {
          label: "device.model.name",
          attributes: [
            "resource.device.model.name",
            "resource.device.model.identifier",
          ],
        },
      ],
    );
    expect(
      getTraceGroupContextLabels([
        INSTALL,
        "resource.host.name",
        "resource.device.model.name",
        "resource.device.model.identifier",
      ]),
    ).toEqual([]);
  });

  it("asks for each attribute once, in the order the labels name them", () => {
    expect(getTraceGroupContextAttributes(DEVICE_LABELS)).toEqual([
      "resource.host.name",
      "resource.device.model.name",
      "resource.device.model.identifier",
    ]);
    expect(
      getTraceGroupContextAttributes([
        ...TRACE_GROUP_DEVICE_CONTEXT,
        { label: "again", attributes: ["resource.host.name"] },
      ]),
    ).toHaveLength(3);
  });
});

describe("a group's context, from the values its spans last carried", () => {
  it("names the device by its host.name, and its model", () => {
    expect(
      toGroupContext({
        labels: DEVICE_LABELS,
        values: {
          "resource.host.name": "Store 0412, lane 3",
          "resource.device.model.name": "Pixel Tablet",
        },
      }),
    ).toEqual({
      "device.name": "Store 0412, lane 3",
      "device.model.name": "Pixel Tablet",
    });
  });

  it("takes an iPhone's model identifier when no model name was sent", () => {
    expect(
      toGroupContext({
        labels: DEVICE_LABELS,
        values: { "resource.device.model.identifier": "iPhone15,2" },
      }),
    ).toEqual({ "device.model.name": "iPhone15,2" });
    // The name wins over the identifier when both were sent.
    expect(
      toGroupContext({
        labels: DEVICE_LABELS,
        values: {
          "resource.device.model.name": "Pixel 7",
          "resource.device.model.identifier": "panther",
        },
      }),
    ).toEqual({ "device.model.name": "Pixel 7" });
  });

  it("leaves out what was blank, and is nothing when nothing was sent", () => {
    expect(
      toGroupContext({
        labels: DEVICE_LABELS,
        values: {
          "resource.host.name": "   ",
          "resource.device.model.name": "Pixel 7",
        },
      }),
    ).toEqual({ "device.model.name": "Pixel 7" });
    expect(toGroupContext({ labels: DEVICE_LABELS, values: {} })).toBe(
      undefined,
    );
    expect(toGroupContext({ labels: [], values: { a: "b" } })).toBe(undefined);
  });
});

describe("quiet groups keep their context, and their identity stays their labels", () => {
  const named: ExpectedTraceGroup = {
    values: [KIOSK],
    context: { "device.name": "Store 0412, lane 3" },
  };

  it("a quiet device carries what its week's spans last said about it", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [
        {
          values: [OTHER_KIOSK],
          count: 12,
          context: { "device.name": "Store 0412, lane 1" },
        },
      ],
      windowGroupCount: 1,
      expectedGroups: [named, { values: [OTHER_KIOSK] }],
      limit: 100,
    });

    expect(merged.groups).toEqual([
      {
        fingerprint: MetricSeriesFingerprint.computeFingerprint({
          [INSTALL]: KIOSK,
        }),
        labels: { [INSTALL]: KIOSK },
        spanCount: 0,
        isQuiet: true,
        context: { "device.name": "Store 0412, lane 3" },
      },
      {
        fingerprint: MetricSeriesFingerprint.computeFingerprint({
          [INSTALL]: OTHER_KIOSK,
        }),
        labels: { [INSTALL]: OTHER_KIOSK },
        spanCount: 12,
        context: { "device.name": "Store 0412, lane 1" },
      },
    ]);
  });

  it("a device renamed keeps the same fingerprint: the same alert, never a new one", () => {
    const before: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [],
      windowGroupCount: 0,
      expectedGroups: [named],
      limit: 100,
    });
    const after: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [],
      windowGroupCount: 0,
      expectedGroups: [
        { values: [KIOSK], context: { "device.name": "Front desk" } },
      ],
      limit: 100,
    });
    const nameless: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [],
      windowGroupCount: 0,
      expectedGroups: [[KIOSK]],
      limit: 100,
    });

    expect(after.groups[0]!.fingerprint).toBe(before.groups[0]!.fingerprint);
    expect(nameless.groups[0]!.fingerprint).toBe(before.groups[0]!.fingerprint);
    expect(after.groups[0]!.labels).toEqual(before.groups[0]!.labels);
    expect(nameless.groups[0]).not.toHaveProperty("context");
  });

  it("an empty context is no context", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [{ values: [OTHER_KIOSK], count: 3, context: {} }],
      windowGroupCount: 1,
      expectedGroups: [{ values: [KIOSK], context: {} }],
      limit: 100,
    });

    for (const group of merged.groups) {
      expect(group).not.toHaveProperty("context");
    }
  });
});

describe("the context reaches each quiet device's match, beside its identity", () => {
  it("the fan-out hands each group's context to its entity", () => {
    const entities: Array<FanOutEntity> =
      TraceGroupCriteriaFanOut.getGroupEntities({
        dataToProcess: groupedResponse([
          quietInstall(KIOSK, { "device.name": "Store 0412, lane 3" }),
          quietInstall(OTHER_KIOSK),
        ]) as DataToProcess,
      });

    expect(entities[0]!.context).toEqual({
      "device.name": "Store 0412, lane 3",
    });
    expect(entities[0]!.labels).toEqual({ [INSTALL]: KIOSK });
    expect(entities[1]!.context).toBeUndefined();
  });

  it("a match carries the context, and its fingerprint is its labels' alone", async () => {
    const response: ProbeApiIngestResponse = await evaluate([
      quietInstall(KIOSK, {
        "device.name": "Store 0412, lane 3",
        "device.model.name": "Pixel Tablet",
      }),
      quietInstall(OTHER_KIOSK),
    ]);

    const matches: Array<PerSeriesCriteriaMatch> = response.perSeriesMatches!;
    const named: PerSeriesCriteriaMatch = matches.find(
      (match: PerSeriesCriteriaMatch): boolean => {
        return match.labels[INSTALL] === KIOSK;
      },
    )!;
    const unnamed: PerSeriesCriteriaMatch = matches.find(
      (match: PerSeriesCriteriaMatch): boolean => {
        return match.labels[INSTALL] === OTHER_KIOSK;
      },
    )!;

    expect(named.context).toEqual({
      "device.name": "Store 0412, lane 3",
      "device.model.name": "Pixel Tablet",
    });
    expect(named.labels).toEqual({ [INSTALL]: KIOSK });
    expect(named.fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({ [INSTALL]: KIOSK }),
    );
    expect(unnamed).not.toHaveProperty("context");
  });

  it("collectMatches copies an entity's context and nothing into its labels", async () => {
    const matches: Array<PerSeriesCriteriaMatch> =
      await PerEntityCriteriaFanOut.collectMatches({
        criteriaInstance: quietCriteria(),
        entities: [
          {
            labels: { [INSTALL]: KIOSK },
            context: { "device.name": "Store 0412, lane 3" },
            narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
              return filter;
            },
          },
          {
            labels: { [INSTALL]: OTHER_KIOSK },
            context: {},
            narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
              return filter;
            },
          },
        ],
        evaluateNarrowedCriteria: async (): Promise<string | null> => {
          return "quiet";
        },
        monitorId: MONITOR_ID.toString(),
      });

    expect(matches[0]!.context).toEqual({
      "device.name": "Store 0412, lane 3",
    });
    expect(matches[0]!.labels).toEqual({ [INSTALL]: KIOSK });
    expect(matches[1]).not.toHaveProperty("context");
  });
});

describe("Device Stopped Reporting's alert names the device", () => {
  it("by its host.name first, then its install and its model", () => {
    const text: MonitorRecordTextResult = deviceStoppedReportingText({
      install: KIOSK,
      context: {
        "device.name": "Store 0412, lane 3",
        "device.model.name": "Pixel Tablet",
      },
    });

    expect(text.title).toBe(
      `[RUM] Device stopped reporting - Kiosk Ordering - Device: Store 0412, lane 3 | Install: ${KIOSK} | Model: Pixel Tablet`,
    );
    expect(text.description).toContain("**Affected resource**");
    expect(text.description.indexOf("Store 0412, lane 3")).toBeLessThan(
      text.description.indexOf(KIOSK),
    );
    expect(text.description).toContain("Pixel Tablet");
    // The first command still lists the install's spans, by its id.
    expect(text.description).toContain(
      `oneuptime span list --query '{"attributes":{"resource.app.installation.id":"${KIOSK}"}}'`,
    );
  });

  it("with no name, by its install and its model", () => {
    const text: MonitorRecordTextResult = deviceStoppedReportingText({
      install: KIOSK,
      context: { "device.model.name": "Pixel Tablet" },
    });

    expect(text.title).toBe(
      `[RUM] Device stopped reporting - Kiosk Ordering - Install: ${KIOSK} | Model: Pixel Tablet`,
    );
    expect(text.title).not.toContain("Device:");
  });

  it("with neither, by its install, exactly as before", () => {
    const withNothing: MonitorRecordTextResult = deviceStoppedReportingText({
      install: KIOSK,
    });
    const withEmpty: MonitorRecordTextResult = deviceStoppedReportingText({
      install: KIOSK,
      context: {},
    });

    expect(withNothing.title).toBe(
      `[RUM] Device stopped reporting - Kiosk Ordering - Install: ${KIOSK}`,
    );
    expect(withEmpty).toEqual(withNothing);
  });

  it("its template says so", () => {
    const template: { description: string } = getRumAlertTemplateById(
      "rum-device-stopped-reporting",
    )!;

    expect(template.description).toContain(
      "names each device by the host.name it sent",
    );
  });
});

describe("a series' context in its words", () => {
  const install: JSONObject = { [INSTALL]: KIOSK };

  it("is said before the identity, and never stands in for it", () => {
    expect(
      SeriesLabelDisplay.buildInlineSummary(install, {
        context: { "device.name": "Store 0412, lane 3" },
      }),
    ).toBe(`Device: Store 0412, lane 3 | Install: ${KIOSK}`);
    expect(SeriesLabelDisplay.buildInlineSummary(install)).toBe(
      `Install: ${KIOSK}`,
    );
    expect(SeriesLabelDisplay.getFriendlyLabelName("device.model.name")).toBe(
      "Model",
    );
  });

  it("a device grouped by its id reads its id as one, beside its name", () => {
    expect(
      SeriesLabelDisplay.buildInlineSummary(
        { [DEVICE_ID]: "8F3A7C2E-0B1D-4F5A-9E6C-2D4B8A1F3C5E" },
        { context: { "device.name": "Front desk iPad" } },
      ),
    ).toBe(
      "Device: Front desk iPad | Device ID: 8F3A7C2E-0B1D-4F5A-9E6C-2D4B8A1F3C5E",
    );
  });

  it("a long name is cut from the front, as every title value is", () => {
    const longName: string = `Store 0412 ${"x".repeat(120)} lane 3`;
    const summary: string = SeriesLabelDisplay.buildInlineSummary(install, {
      context: { "device.name": longName },
    });

    expect(summary.startsWith("Device: ...")).toBe(true);
    expect(summary).toContain("lane 3 | Install:");
  });

  it("the enricher says it once: a title that names the device is left as it is", () => {
    const context: JSONObject = { "device.name": "Store 0412, lane 3" };
    const once: string = SeriesContextEnricher.enrichTitle({
      title: "Kiosk quiet",
      seriesLabels: install,
      seriesContext: context,
    });

    expect(once).toBe(
      `Kiosk quiet - Device: Store 0412, lane 3 | Install: ${KIOSK}`,
    );
    expect(
      SeriesContextEnricher.enrichTitle({
        title: once,
        seriesLabels: install,
        seriesContext: context,
      }),
    ).toBe(once);
    // A user's template that put the name in itself gets the install only.
    expect(
      SeriesContextEnricher.enrichTitle({
        title: "Store 0412, lane 3 is quiet",
        seriesLabels: install,
        seriesContext: context,
      }),
    ).toBe(`Store 0412, lane 3 is quiet - Install: ${KIOSK}`);
  });

  it("the description's block names it once, however often it is enriched", () => {
    const context: JSONObject = {
      "device.name": "Store 0412, lane 3",
      "device.model.name": "Pixel Tablet",
    };
    const once: string = SeriesContextEnricher.enrichDescription({
      description: "One device went quiet.",
      seriesLabels: install,
      seriesContext: context,
      monitorType: MonitorType.Traces,
    });

    expect(once).toContain(
      SeriesLabelDisplay.buildMarkdownBlock(install, { context: context }),
    );
    expect(
      SeriesContextEnricher.enrichDescription({
        description: once,
        seriesLabels: install,
        seriesContext: context,
        monitorType: MonitorType.Traces,
      }),
    ).toBe(once);
  });

  it("the template's series renderings say it too, and keep it apart from the labels", () => {
    const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.Traces,
      dataToProcess: groupedResponse([]) as DataToProcess,
      seriesLabels: install,
      seriesContext: { "device.name": "Store 0412, lane 3" },
    });

    expect(storageMap["seriesResourceSuffix"]).toBe(
      ` - Device: Store 0412, lane 3 | Install: ${KIOSK}`,
    );
    expect(storageMap["seriesResourceSummary"]).toBe(
      `Device: Store 0412, lane 3 | Install: ${KIOSK}`,
    );
    expect(storageMap["seriesContext"]).toEqual({
      "device.name": "Store 0412, lane 3",
    });
    expect(storageMap["seriesLabels"]).toEqual(install);
  });
});

describe("the grouped count reads each group's last device name and model", () => {
  const service: SpanService = new SpanService();

  const query: Query<Span> = {
    projectId: PROJECT_ID,
    primaryEntityId: new Includes([MONITOR_ID]),
    startTime: new InBetween<Date>(
      new Date("2026-11-19T10:00:00.000Z"),
      new Date("2026-11-19T11:00:00.000Z"),
    ),
  } as Query<Span>;

  it("as the latest value a span gave, every key bound as a parameter", () => {
    const statement: Statement = service.toAttributeGroupCountStatement({
      query: query,
      groupByAttributes: [INSTALL],
      limit: 100,
      contextAttributes: getTraceGroupContextAttributes(DEVICE_LABELS),
    });

    expect(statement.query).toMatch(
      /substringUTF8\(attributes\[\{p\d+:String\}\], 1, 256\) AS __group_0, argMaxIf\(substringUTF8\(attributes\[\{p\d+:String\}\], 1, 256\), startTime, attributes\[\{p\d+:String\}\] != ''\) AS __context_0, argMaxIf/,
    );
    expect(statement.query).toContain("AS __context_2 FROM");
    // Grouped by the install alone: the context never splits a group.
    expect(statement.query).toContain(" GROUP BY __group_0 ");

    const values: Array<unknown> = Object.values(decodedQueryParams(statement));

    expect(values).toContain("resource.host.name");
    expect(values).toContain("resource.device.model.name");
    expect(values).toContain("resource.device.model.identifier");
    expect(statement.query).not.toContain("resource.host.name");
  });

  it("reads none when asked for none, as it always read", () => {
    const statement: Statement = service.toAttributeGroupCountStatement({
      query: query,
      groupByAttributes: [INSTALL],
      limit: 100,
    });

    expect(statement.query).not.toContain("argMaxIf");
    expect(statement.query).not.toContain("__context_");
  });
});
