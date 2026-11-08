import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An episode's Root Cause page (issue #6320): beside the root cause, the
 * metrics behind the episode, as the same card an incident's and an alert's
 * Root Cause pages show (issues #6249 and #6304) - the investigation the
 * episode's Overview shows, metrics only: the ranges around the episode,
 * the episode's moments on the charts, Edit metrics, Copy link, Reset and
 * Open in Metric Explorer, under URL names of its own. An episode groups
 * many incidents or alerts from one root cause, and its Root Cause page is
 * where somebody writes that cause down; it used to show the text alone, so
 * they had to open the Overview, or a member's page, to read the evidence.
 *
 * It charts what the episode's Overview charts: the metrics of its first
 * member - the earliest declared incident, or the earliest created alert -
 * anchored on the episode itself, with that member's monitor rule drawn and
 * every member marked on the charts. When that member kept no metric
 * snapshot, its monitor's metrics as the monitor reads them now, which the
 * card says.
 *
 * Every test runs for an incident episode and for an alert episode. The
 * page is rendered for real (the root cause text card stubbed), and so are
 * the card, the investigation and MetricView; MetricCharts is stood in for
 * by buttons that call exactly the handlers MetricView hands the charts,
 * and the reads by a fake server that sorts and pages as the API does.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: {
        filterData: { metricName?: unknown; attributes?: unknown };
      };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  timeReferenceLines?:
    | Array<{ date: Date; label?: string; subtitle?: string; kind?: string }>
    | undefined;
  referenceRegions?:
    | Array<{
        startDate: Date;
        endDate: Date;
        label?: string;
        subtitle?: string;
      }>
    | undefined;
}

let mockLatestCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:35:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        mockLatestCharts = props;
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the chart
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [{ name: "system.memory.utilization" }],
            telemetryServices: [],
          });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (input: Record<string, unknown>) => {
        eventLinesInputs.push(input);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="root-cause-text" />;
    },
  };
});

import IncidentEpisodeRootCausePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/RootCause";
import AlertEpisodeRootCausePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EVENT_METRIC_SCOPE_NOTE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import { EPISODE_MEMBER_IDS_PER_REQUEST } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/FetchEpisodeMembers";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const EPISODE_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_EPISODE_ID: string = "55555555-5555-4555-8555-555555555555";
// The episode's first member, and one that joined it before but started later.
const FIRST_MEMBER_ID: string = "66666666-6666-4666-8666-666666666666";
const LATER_MEMBER_ID: string = "77777777-7777-4777-8777-777777777777";
const OTHER_MEMBER_ID: string = "88888888-8888-4888-8888-888888888888";
const MONITOR_ID: string = "99999999-9999-4999-8999-999999999999";
const RULE_ID: string = "criteria-1";

const NOW: Date = new Date("2026-09-28T13:00:00.000Z");
// When the episode started: declared (an incident episode) or created.
const EPISODE_STARTED_AT: Date = new Date("2026-09-28T11:30:00.000Z");
/*
 * An incident episode's row says when it was created too, a little after it
 * was declared: its Overview starts it when it was declared.
 */
const EPISODE_CREATED_AT: Date = new Date("2026-09-28T11:32:00.000Z");
/*
 * Its state timeline's first entry is written a minute after it started:
 * the Overview starts the episode when it started, never then.
 */
const FIRST_STATE_AT: Date = new Date("2026-09-28T11:31:00.000Z");
/*
 * Its first member started twenty minutes before the episode opened (a
 * grouping rule waited for more), and the monitor evaluated the five
 * minutes before that: the card is anchored on the episode, never on the
 * member.
 */
const MEMBER_STARTED_AT: Date = new Date("2026-09-28T11:10:00.000Z");
// Inside the range the card starts on, so a line for it would be drawn.
const MEMBER_IMPACT_STARTED_AT: Date = new Date("2026-09-28T11:20:00.000Z");
const EVALUATED_START: Date = new Date("2026-09-28T11:05:00.000Z");
// Around the start: 30 minutes on either side of the episode's start.
const AROUND_START: [string, string] = [
  "2026-09-28T11:00:00.000Z",
  "2026-09-28T12:00:00.000Z",
];
// What the same range would be around the member's own start: never charted.
const AROUND_MEMBER_START: [string, string] = [
  "2026-09-28T10:40:00.000Z",
  "2026-09-28T11:40:00.000Z",
];
const HOUR_BEFORE: [string, string] = [
  "2026-09-28T10:30:00.000Z",
  "2026-09-28T11:30:00.000Z",
];
const DAY_BEFORE: [string, string] = [
  "2026-09-27T11:30:00.000Z",
  "2026-09-28T11:30:00.000Z",
];
const ACKNOWLEDGED_AT: Date = new Date("2026-09-28T11:40:00.000Z");
const RESOLVED_AT: Date = new Date("2026-09-28T12:10:00.000Z");
// Start to resolution: 15 minutes before the start to 15 after the resolve.
const START_TO_RESOLUTION: [string, string] = [
  "2026-09-28T11:15:00.000Z",
  "2026-09-28T12:25:00.000Z",
];
// Start to now: 15 minutes before the start, to now.
const START_TO_NOW: [string, string] = [
  "2026-09-28T11:15:00.000Z",
  "2026-09-28T13:00:00.000Z",
];
// The other episode, which started earlier that morning.
const OTHER_STARTED_AT: Date = new Date("2026-09-28T09:00:00.000Z");
const OTHER_AROUND_START: [string, string] = [
  "2026-09-28T08:30:00.000Z",
  "2026-09-28T09:30:00.000Z",
];

function queryConfig(metricName: string): Record<string, unknown> {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
      groupByAttributeKeys: ["resource.host.name"],
    },
  };
}

// The metric snapshot a member keeps, as its row stores it: JSON.
function metricSnapshot(metricName: string): Record<string, unknown> {
  return {
    telemetryType: "Metric",
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(EVALUATED_START, MEMBER_STARTED_AT),
      ),
      queryConfigs: [queryConfig(metricName)],
      formulaConfigs: [],
    },
  };
}

const LOGS_SNAPSHOT: Record<string, unknown> = {
  telemetryType: "Log",
  telemetryQuery: {},
  metricViewData: null,
};

function monitorOf(
  monitorType: MonitorType,
  stepKey: string,
  settings: Record<string, unknown>,
  metricName: string,
): Record<string, unknown> {
  return {
    _id: MONITOR_ID,
    monitorType: monitorType,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              id: "step-1",
              [stepKey]: {
                ...settings,
                metricViewConfig: {
                  queryConfigs: [queryConfig(metricName)],
                  formulaConfigs: [],
                },
              },
            },
          },
        ],
      },
    },
  };
}

function metricsMonitor(metricName: string): Record<string, unknown> {
  return monitorOf(MonitorType.Metrics, "metricMonitor", {}, metricName);
}

// A monitor that reads no metrics at all: a website's.
const WEBSITE_MONITOR: Record<string, unknown> = {
  _id: MONITOR_ID,
  monitorType: MonitorType.Website,
  monitorSteps: {
    data: { monitorStepsInstanceArray: [{ data: { id: "step-1" } }] },
  },
};

interface MemberData {
  id: string;
  // When it was declared (an incident) or created (an alert); null: unread.
  startedAt?: Date | null | undefined;
  impactStartedAt?: Date | undefined;
  // Its snapshot; left out, a metric snapshot of its own metric.
  telemetryQuery?: Record<string, unknown> | null | undefined;
  metricName?: string | undefined;
  seriesLabels?: Record<string, unknown> | undefined;
  createdCriteriaId?: string | undefined;
  monitor?: Record<string, unknown> | null | undefined;
  // Its row comes back without its id (a column the reader may not read).
  isIdUnread?: boolean | undefined;
}

interface EpisodeData {
  // When it was declared (an incident episode) or created; null: none.
  startedAt?: Date | null | undefined;
  createdAt?: Date | undefined;
  resolvedAt?: Date | undefined;
  // In the order they joined it; left out, the one first member.
  members?: Array<MemberData> | undefined;
  // Its state timeline: by default created, acknowledged and resolved.
  timeline?: Array<[string, Date]> | undefined;
}

const FIRST_MEMBER: MemberData = {
  id: FIRST_MEMBER_ID,
  startedAt: MEMBER_STARTED_AT,
  metricName: "system.cpu.utilization",
};

let mockEpisode: EpisodeData = {};

const OTHER_EPISODE: EpisodeData = {
  startedAt: OTHER_STARTED_AT,
  createdAt: OTHER_STARTED_AT,
  members: [
    {
      id: OTHER_MEMBER_ID,
      startedAt: OTHER_STARTED_AT,
      telemetryQuery: null,
      monitor: metricsMonitor("system.memory.utilization"),
    },
  ],
  timeline: [["created", OTHER_STARTED_AT]],
};

function episodeFor(id: string): EpisodeData {
  return id === OTHER_EPISODE_ID ? OTHER_EPISODE : mockEpisode;
}

function membersOf(episode: EpisodeData): Array<MemberData> {
  return episode.members || [FIRST_MEMBER];
}

function memberById(id: string): MemberData | undefined {
  return [...membersOf(mockEpisode), ...membersOf(OTHER_EPISODE)].find(
    (member: MemberData): boolean => {
      return member.id === id;
    },
  );
}

/*
 * What the page shows for one kind of episode: its models, the columns the
 * card reads, and the words it speaks of the episode with.
 */
interface EpisodeKind {
  name: string;
  Page: React.FunctionComponent<PageComponentProps>;
  pagePath: (episodeId: string) => string;
  episodeModel: unknown;
  membershipModel: unknown;
  memberModel: unknown;
  timelineModel: unknown;
  stateModel: unknown;
  // A member's own state timeline: never read here.
  memberTimelineModel: unknown;
  membershipEpisodeField: string;
  membershipMemberField: string;
  timelineEpisodeField: string;
  timelineStateField: string;
  // When a member started: what the first one is the earliest by.
  memberStartField: string;
  episodeSelect: Record<string, unknown>;
  memberSelect: Record<string, unknown>;
  // What the charts read of the member to draw its rule.
  ruleSelect: Record<string, unknown>;
  episodeRow: (episode: EpisodeData) => Record<string, unknown>;
  // The member's monitor, as its row holds it.
  monitorColumns: (
    monitor: Record<string, unknown> | null,
  ) => Record<string, unknown>;
  // The member's criteria and monitor, as the rule's read hands them back.
  ruleRow: (member: MemberData) => Record<string, unknown>;
  startedLabel: string;
  presetsHeading: string;
  description: string;
  scopedDescription: (seriesSummary: string) => string;
  evaluatedSubtitle: string;
  markedField: string;
  otherMarkedField: string;
}

function episodeStartOf(episode: EpisodeData): Date | undefined {
  return episode.startedAt === null
    ? undefined
    : episode.startedAt || EPISODE_STARTED_AT;
}

const INCIDENT_EPISODE: EpisodeKind = {
  name: "an incident episode",
  Page: IncidentEpisodeRootCausePage,
  pagePath: (episodeId: string): string => {
    return `/dashboard/project-1/incidents/episodes/${episodeId}/root-cause`;
  },
  episodeModel: IncidentEpisode,
  membershipModel: IncidentEpisodeMember,
  memberModel: Incident,
  timelineModel: IncidentEpisodeStateTimeline,
  stateModel: IncidentState,
  memberTimelineModel: IncidentStateTimeline,
  membershipEpisodeField: "incidentEpisodeId",
  membershipMemberField: "incidentId",
  timelineEpisodeField: "incidentEpisodeId",
  timelineStateField: "incidentStateId",
  memberStartField: "declaredAt",
  episodeSelect: { declaredAt: true, createdAt: true, resolvedAt: true },
  memberSelect: {
    _id: true,
    telemetryQuery: true,
    seriesLabels: true,
    createdCriteriaId: true,
    monitors: { _id: true, monitorType: true, monitorSteps: true },
    declaredAt: true,
  },
  ruleSelect: { _id: true, createdCriteriaId: true, monitors: { _id: true } },
  episodeRow: (episode: EpisodeData): Record<string, unknown> => {
    return {
      declaredAt: episodeStartOf(episode),
      createdAt: episode.createdAt || EPISODE_CREATED_AT,
      resolvedAt: episode.resolvedAt,
    };
  },
  monitorColumns: (
    monitor: Record<string, unknown> | null,
  ): Record<string, unknown> => {
    return { monitors: monitor ? [monitor] : [] };
  },
  ruleRow: (member: MemberData): Record<string, unknown> => {
    return {
      createdCriteriaId: member.createdCriteriaId,
      monitors: member.monitor
        ? [{ _id: MONITOR_ID, id: new ObjectID(MONITOR_ID) }]
        : [],
    };
  },
  startedLabel: "Declared",
  presetsHeading: "Around this episode",
  description: "Metrics related to this episode's first incident.",
  scopedDescription: (seriesSummary: string): string => {
    return `Metrics related to this episode's first incident, scoped to the affected series (${seriesSummary}).`;
  },
  evaluatedSubtitle:
    "What the monitor evaluated when it opened this episode's first incident.",
  markedField: "excludedIncidentIds",
  otherMarkedField: "excludedAlertIds",
};

const ALERT_EPISODE: EpisodeKind = {
  name: "an alert episode",
  Page: AlertEpisodeRootCausePage,
  pagePath: (episodeId: string): string => {
    return `/dashboard/project-1/alerts/episodes/${episodeId}/root-cause`;
  },
  episodeModel: AlertEpisode,
  membershipModel: AlertEpisodeMember,
  memberModel: Alert,
  timelineModel: AlertEpisodeStateTimeline,
  stateModel: AlertState,
  memberTimelineModel: AlertStateTimeline,
  membershipEpisodeField: "alertEpisodeId",
  membershipMemberField: "alertId",
  timelineEpisodeField: "alertEpisodeId",
  timelineStateField: "alertStateId",
  memberStartField: "createdAt",
  episodeSelect: { createdAt: true, resolvedAt: true },
  memberSelect: {
    _id: true,
    telemetryQuery: true,
    seriesLabels: true,
    createdCriteriaId: true,
    monitor: { _id: true, monitorType: true, monitorSteps: true },
    createdAt: true,
  },
  ruleSelect: { _id: true, createdCriteriaId: true, monitorId: true },
  episodeRow: (episode: EpisodeData): Record<string, unknown> => {
    return {
      createdAt: episodeStartOf(episode),
      resolvedAt: episode.resolvedAt,
    };
  },
  monitorColumns: (
    monitor: Record<string, unknown> | null,
  ): Record<string, unknown> => {
    return { monitor: monitor };
  },
  ruleRow: (member: MemberData): Record<string, unknown> => {
    return {
      createdCriteriaId: member.createdCriteriaId,
      monitorId: member.monitor ? new ObjectID(MONITOR_ID) : undefined,
    };
  },
  startedLabel: "Created",
  presetsHeading: "Around this episode",
  description: "Metrics for this episode's first alert.",
  scopedDescription: (seriesSummary: string): string => {
    return `Metrics for this episode's first alert, scoped to the affected series (${seriesSummary}).`;
  },
  evaluatedSubtitle:
    "What the monitor evaluated when it opened this episode's first alert.",
  markedField: "excludedAlertIds",
  otherMarkedField: "excludedIncidentIds",
};

const KINDS: Array<EpisodeKind> = [INCIDENT_EPISODE, ALERT_EPISODE];

let kind: EpisodeKind = INCIDENT_EPISODE;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/episodes/view/root-cause"),
  currentProject: null,
  hasPaymentMethod: true,
};

function page(): string {
  return kind.pagePath(EPISODE_ID);
}

function memberRow(member: MemberData): Record<string, unknown> {
  return {
    _id: member.isIdUnread ? undefined : member.id,
    id: member.isIdUnread ? undefined : new ObjectID(member.id),
    [kind.memberStartField]:
      member.startedAt === null
        ? undefined
        : member.startedAt || MEMBER_STARTED_AT,
    impactStartedAt: member.impactStartedAt,
    telemetryQuery:
      member.telemetryQuery === undefined
        ? metricSnapshot(member.metricName || "system.cpu.utilization")
        : member.telemetryQuery,
    seriesLabels: member.seriesLabels,
    createdCriteriaId: member.createdCriteriaId,
    ...kind.monitorColumns(
      member.monitor === undefined ? null : member.monitor,
    ),
  };
}

// The order Postgres gives: earliest first, NULL last, ties by id.
function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftStart: unknown = left[kind.memberStartField];
  const rightStart: unknown = right[kind.memberStartField];
  const leftMs: number =
    leftStart instanceof Date ? leftStart.getTime() : Number.POSITIVE_INFINITY;
  const rightMs: number =
    rightStart instanceof Date
      ? rightStart.getTime()
      : Number.POSITIVE_INFINITY;

  if (leftMs !== rightMs) {
    return leftMs < rightMs ? -1 : 1;
  }

  return String(left["_id"]) < String(right["_id"]) ? -1 : 1;
}

function list(
  data: Array<Record<string, unknown>>,
  count?: number,
): Record<string, unknown> {
  return {
    data: data,
    count: count === undefined ? data.length : count,
    skip: 0,
    limit: 10000,
  };
}

function serve(): void {
  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown; id: ObjectID } = args[0] as {
      modelType: unknown;
      id: ObjectID;
    };

    if (request.modelType === kind.episodeModel) {
      return kind.episodeRow(episodeFor(request.id.toString()));
    }

    // The charts' own read of the rule they draw.
    if (request.modelType === kind.memberModel) {
      const member: MemberData | undefined = memberById(request.id.toString());
      return member ? kind.ruleRow(member) : null;
    }

    if (request.modelType === Monitor) {
      return null;
    }

    return null;
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
    } = args[0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
    };

    if (request.modelType === kind.membershipModel) {
      const episode: EpisodeData = episodeFor(
        String(request.query[kind.membershipEpisodeField]),
      );
      const rows: Array<Record<string, unknown>> = membersOf(episode).map(
        (member: MemberData): Record<string, unknown> => {
          return { [kind.membershipMemberField]: new ObjectID(member.id) };
        },
      );

      return list(
        rows.slice(request.skip, request.skip + request.limit),
        rows.length,
      );
    }

    if (request.modelType === kind.memberModel) {
      const ids: Array<string> = (request.query["_id"] as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      );
      const rows: Array<Record<string, unknown>> = [
        ...membersOf(mockEpisode),
        ...membersOf(OTHER_EPISODE),
      ]
        .filter((member: MemberData): boolean => {
          return ids.includes(member.id);
        })
        .map(memberRow)
        .sort(compareRows);

      return list(rows.slice(0, request.limit), rows.length);
    }

    if (request.modelType === kind.stateModel) {
      return list([
        { _id: "created", name: "Created", order: 1 },
        {
          _id: "acknowledged",
          name: "Acknowledged",
          isAcknowledgedState: true,
          order: 2,
        },
        { _id: "resolved", name: "Resolved", isResolvedState: true, order: 3 },
      ]);
    }

    if (request.modelType === kind.timelineModel) {
      const episode: EpisodeData = episodeFor(
        String(request.query[kind.timelineEpisodeField]),
      );
      const timeline: Array<[string, Date]> = episode.timeline || [
        ["created", FIRST_STATE_AT],
        ["acknowledged", ACKNOWLEDGED_AT],
        ["resolved", RESOLVED_AT],
      ];

      return list(
        timeline.map(([stateId, startsAt]: [string, Date]) => {
          return {
            [kind.timelineStateField]: new ObjectID(stateId),
            startsAt: startsAt,
          };
        }),
      );
    }

    return list([]);
  });
}

type Window = [string, string];

function fetchedWindows(): Array<Window> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): Window => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return [
      data.startAndEndDate!.startValue.toISOString(),
      data.startAndEndDate!.endValue.toISOString(),
    ];
  });
}

function lastFetchedWindow(): Window | undefined {
  const windows: Array<Window> = fetchedWindows();
  return windows[windows.length - 1];
}

function lastFetchedQuery(): MetricViewData {
  const call: Array<unknown> =
    fetchResultsMock.mock.calls[fetchResultsMock.mock.calls.length - 1]!;
  return (call[0] as { metricViewData: MetricViewData }).metricViewData;
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The chart has not rendered");
  }
  return mockLatestCharts;
}

function chartedMetricNames(): Array<string> {
  return charts().metricViewData.queryConfigs.map(
    (queryConfig: {
      metricQueryData: { filterData: { metricName?: unknown } };
    }): string => {
      return String(queryConfig.metricQueryData.filterData.metricName);
    },
  );
}

function momentLabels(): Array<string | undefined> {
  return (charts().timeReferenceLines || []).map((line: { label?: string }) => {
    return line.label;
  });
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
}

function pickerOptions(): HTMLElement {
  fireEvent.click(pickerButton());
  return screen.getByTestId("metric-investigation-time-dropdown");
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

async function renderPage(): Promise<RenderResult> {
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(<kind.Page {...PAGE_PROPS} />);
  });
  /*
   * MetricView draws its charts once before it loads, then shows a loader
   * until its first fetch lands: wait for that fetch and the charts after.
   */
  await waitFor(() => {
    expect(fetchedWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  return rendered!;
}

// A page with no card: rendered, and every read it makes landed.
async function renderPageWithoutCard(): Promise<void> {
  await act(async () => {
    render(<kind.Page {...PAGE_PROPS} />);
  });
  await waitFor(() => {
    expect(screen.queryByText("Metrics")).toBeNull();
  });
}

function pick(label: string): void {
  fireEvent.click(pickerButton());
  fireEvent.click(
    within(screen.getByTestId("metric-investigation-time-dropdown")).getByText(
      label,
    ),
  );
}

interface Read {
  modelType: unknown;
  id?: ObjectID;
  query?: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
}

function itemReads(): Array<Read> {
  return getItemMock.mock.calls.map((call: Array<unknown>): Read => {
    return call[0] as Read;
  });
}

function listReads(): Array<Read> {
  return getListMock.mock.calls.map((call: Array<unknown>): Read => {
    return call[0] as Read;
  });
}

function readsOf(modelType: unknown): Array<Read> {
  return [...itemReads(), ...listReads()].filter((read: Read): boolean => {
    return read.modelType === modelType;
  });
}

// The card's reads of the members: the first one, by the membership.
function memberReads(): Array<Read> {
  return listReads().filter((read: Read): boolean => {
    return read.modelType === kind.memberModel;
  });
}

let consoleErrors: Array<string> = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  getListMock.mockReset();
  fetchResultsMock.mockReset();
  eventLinesInputs.length = 0;
  mockLatestCharts = null;
  mockEpisode = {};
  consoleErrors = [];
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(EPISODE_ID);
  });
  // What React warns about while the page renders, for the note's test.
  jest
    .spyOn(console, "error")
    .mockImplementation((...args: Array<unknown>): void => {
      consoleErrors.push(args.map(String).join(" "));
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe.each(KINDS)("Root Cause of $name", (episodeKind: EpisodeKind) => {
  beforeEach(() => {
    kind = episodeKind;
    window.history.replaceState({}, "", page());
    serve();
  });

  describe("the episode's metrics, untouched", () => {
    test("charts its first member's metrics around when the episode started, beside the root cause, with nothing to reset and nothing in the URL", async () => {
      await renderPage();

      expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
      expect(lastFetchedWindow()).toEqual(AROUND_START);
      // Around the episode's start, not its first member's.
      expect(fetchedWindows()).not.toContainEqual(AROUND_MEMBER_START);
      expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
      expect(pickerButton()).toHaveTextContent("Around the start");
      expect(screen.getByText("Metrics")).toBeVisible();
      // It says whose metrics they are.
      expect(screen.getByText(kind.description)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
      expect(screen.queryByText("Copy link")).toBeNull();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
      // Charted from what the member kept: no note that it is the monitor now.
      expect(screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toBeNull();
      expect(window.location.search).toBe("");
    });

    test("an untouched card writes nothing to the URL, refreshed or not", async () => {
      await renderPage();

      const fetches: number = fetchResultsMock.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

      await waitFor(() => {
        expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(fetches);
      });
      expect(lastFetchedWindow()).toEqual(AROUND_START);
      expect(window.location.search).toBe("");
    });

    test("the metrics alone: no Logs, Traces or Exceptions tabs, which the Overview has", async () => {
      await renderPage();

      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
    });

    test("the episode's own moments are on the charts, as an episode's: started, acknowledged, resolved", async () => {
      await renderPage();

      expect(
        charts().timeReferenceLines?.map(
          (line: { date: Date; label?: string; subtitle?: string }) => {
            return [line.date.toISOString(), line.label, line.subtitle];
          },
        ),
      ).toEqual([
        [EPISODE_STARTED_AT.toISOString(), kind.startedLabel, "This episode"],
        [ACKNOWLEDGED_AT.toISOString(), "Acknowledged", "This episode"],
      ]);
      // Resolved at 12:10 is past this range's end; a wider range shows it.
      pick("Start to resolution");
      await waitFor(() => {
        expect(momentLabels()).toEqual([
          kind.startedLabel,
          "Acknowledged",
          "Resolved",
        ]);
      });
    });

    test("its first member's own start and impact are not the episode's, and are not marked as its moments", async () => {
      mockEpisode = {
        members: [{ ...FIRST_MEMBER, impactStartedAt: MEMBER_IMPACT_STARTED_AT }],
      };

      await renderPage();

      const marked: Array<string> = (charts().timeReferenceLines || []).map(
        (line: { date: Date }): string => {
          return line.date.toISOString();
        },
      );
      expect(marked).not.toContain(MEMBER_STARTED_AT.toISOString());
      expect(marked).not.toContain(MEMBER_IMPACT_STARTED_AT.toISOString());
      expect(momentLabels()).not.toContain("Impact started");
    });

    test("what the monitor evaluated for its first member is shaded, and every member is marked as one of the episode's", async () => {
      await renderPage();

      expect(
        charts().referenceRegions?.map(
          (region: {
            startDate: Date;
            endDate: Date;
            label?: string;
            subtitle?: string;
          }) => {
            return [
              region.startDate.toISOString(),
              region.endDate.toISOString(),
              region.label,
              region.subtitle,
            ];
          },
        ),
      ).toEqual([
        [
          EVALUATED_START.toISOString(),
          MEMBER_STARTED_AT.toISOString(),
          "What the monitor saw",
          kind.evaluatedSubtitle,
        ],
      ]);
      const lastLines: Record<string, unknown> =
        eventLinesInputs[eventLinesInputs.length - 1]!;
      // No member is left out of the incidents or alerts in the window.
      expect(lastLines[kind.markedField]).toBeUndefined();
      expect(lastLines[kind.otherMarkedField]).toBeUndefined();
    });

    test("a grouped monitor's first member is narrowed to its own series, and says so", async () => {
      mockEpisode = {
        members: [
          { ...FIRST_MEMBER, seriesLabels: { "resource.host.name": "prod-01" } },
        ],
      };

      await renderPage();

      expect(
        screen.getByText(kind.scopedDescription("resource.host.name = prod-01")),
      ).toBeVisible();
      expect(
        lastFetchedQuery().queryConfigs[0]?.metricQueryData.filterData
          .attributes,
      ).toEqual({ "resource.host.name": "prod-01" });
    });

    test("it reads the episode's members by its membership, its first member with only what the card needs, then the episode's own start and moments", async () => {
      await renderPage();

      // The membership: which members the episode holds, and nothing else.
      const membership: Array<Read> = readsOf(kind.membershipModel);
      expect(membership).toHaveLength(1);
      expect(
        String(membership[0]!.query![kind.membershipEpisodeField]),
      ).toBe(EPISODE_ID);
      expect(membership[0]!.select).toEqual({
        [kind.membershipMemberField]: true,
      });
      expect(membership[0]!.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(membership[0]!.limit).toBe(EPISODE_MEMBER_IDS_PER_REQUEST);

      // The first member: by its id, the earliest started, one of them.
      expect(memberReads()).toHaveLength(1);
      const member: Read = memberReads()[0]!;
      expect(Object.keys(member.query!)).toEqual(["_id"]);
      expect(member.query!["_id"]).toBeInstanceOf(Includes);
      expect((member.query!["_id"] as Includes).values).toEqual([
        FIRST_MEMBER_ID,
      ]);
      expect(member.select).toEqual(kind.memberSelect);
      expect(member.sort).toEqual({
        [kind.memberStartField]: SortOrder.Ascending,
      });
      expect(member.limit).toBe(1);

      // The episode itself: when it started and was resolved.
      const episodeReads: Array<Read> = readsOf(kind.episodeModel);
      expect(episodeReads).toHaveLength(1);
      expect(episodeReads[0]!.id!.toString()).toBe(EPISODE_ID);
      expect(episodeReads[0]!.select).toEqual(kind.episodeSelect);

      // Its state timeline, and the project's states.
      const timelines: Array<Read> = readsOf(kind.timelineModel);
      expect(timelines).toHaveLength(1);
      expect(String(timelines[0]!.query![kind.timelineEpisodeField])).toBe(
        EPISODE_ID,
      );
      expect(timelines[0]!.select).toEqual({
        _id: true,
        startsAt: true,
        [kind.timelineStateField]: true,
      });
      expect(timelines[0]!.sort).toEqual({ startsAt: SortOrder.Ascending });
      const states: Array<Read> = readsOf(kind.stateModel);
      expect(states).toHaveLength(1);
      expect(states[0]!.select).toEqual({
        _id: true,
        name: true,
        isAcknowledgedState: true,
        isResolvedState: true,
        order: true,
      });

      // Never a member's own timeline: the moments are the episode's.
      expect(readsOf(kind.memberTimelineModel)).toHaveLength(0);
      // Nothing else of its own.
      expect(getListMock).toHaveBeenCalledTimes(4);
    });

    test("the rule the charts draw is its first member's: they read that member's criteria and monitor", async () => {
      await renderPage();

      await waitFor(() => {
        expect(
          itemReads().filter((read: Read): boolean => {
            return read.modelType === kind.memberModel;
          }),
        ).toHaveLength(1);
      });
      const rule: Read = itemReads().find((read: Read): boolean => {
        return read.modelType === kind.memberModel;
      })!;
      expect(rule.id!.toString()).toBe(FIRST_MEMBER_ID);
      expect(rule.select).toEqual(kind.ruleSelect);
      // Never the episode's id read as an incident's or an alert's.
      expect(
        itemReads().filter((read: Read): boolean => {
          return (
            read.modelType === kind.memberModel &&
            read.id?.toString() === EPISODE_ID
          );
        }),
      ).toEqual([]);
    });

    test("a first member whose id it cannot read draws no rule, and the episode's id is never read as an incident's or an alert's", async () => {
      mockEpisode = { members: [{ ...FIRST_MEMBER, isIdUnread: true }] };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
      expect(
        itemReads().filter((read: Read): boolean => {
          return read.modelType === kind.memberModel;
        }),
      ).toEqual([]);
    });

    test("a first member opened by a rule of its monitor has that monitor read for the rule's line", async () => {
      mockEpisode = {
        members: [
          {
            ...FIRST_MEMBER,
            createdCriteriaId: RULE_ID,
            monitor: metricsMonitor("system.cpu.utilization"),
          },
        ],
      };

      await renderPage();

      await waitFor(() => {
        expect(readsOf(Monitor)).toHaveLength(1);
      });
      expect(readsOf(Monitor)[0]!.id!.toString()).toBe(MONITOR_ID);
    });
  });

  describe("which member is the first", () => {
    test("the earliest started member, not the first to join: as the Overview picks it", async () => {
      mockEpisode = {
        members: [
          {
            id: LATER_MEMBER_ID,
            startedAt: new Date("2026-09-28T11:25:00.000Z"),
            metricName: "joined.first.started.later",
          },
          FIRST_MEMBER,
        ],
      };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
      expect(
        (memberReads()[0]!.query!["_id"] as Includes).values,
      ).toEqual([LATER_MEMBER_ID, FIRST_MEMBER_ID]);
    });

    test("two members that started together: the one with the lower id", async () => {
      mockEpisode = {
        members: [
          {
            id: LATER_MEMBER_ID,
            startedAt: MEMBER_STARTED_AT,
            metricName: "higher.id",
          },
          { id: FIRST_MEMBER_ID, startedAt: MEMBER_STARTED_AT, metricName: "lower.id" },
        ],
      };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["lower.id"]);
    });

    test("a member whose start it cannot read comes after every one it can", async () => {
      mockEpisode = {
        members: [
          { id: FIRST_MEMBER_ID, startedAt: null, metricName: "no.start" },
          {
            id: LATER_MEMBER_ID,
            startedAt: new Date("2026-09-28T11:50:00.000Z"),
            metricName: "started",
          },
        ],
      };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["started"]);
    });

    test("a later member's metrics do not stand in for a first member with none: no card, as the Overview charts none", async () => {
      mockEpisode = {
        members: [
          {
            id: FIRST_MEMBER_ID,
            startedAt: MEMBER_STARTED_AT,
            telemetryQuery: null,
            monitor: WEBSITE_MONITOR,
          },
          {
            id: LATER_MEMBER_ID,
            startedAt: new Date("2026-09-28T11:25:00.000Z"),
            metricName: "later.metric",
          },
        ],
      };

      await renderPageWithoutCard();

      expect(fetchResultsMock).not.toHaveBeenCalled();
      expect(getListMock).toHaveBeenCalledTimes(2);
      expect(getItemMock).not.toHaveBeenCalled();
    });

    test(`an episode of more members than one read names (${EPISODE_MEMBER_IDS_PER_REQUEST}): the first of all of them`, async () => {
      const many: Array<MemberData> = [];

      for (let index: number = 0; index < EPISODE_MEMBER_IDS_PER_REQUEST + 3; index++) {
        many.push({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          startedAt: new Date(
            new Date("2026-09-28T11:20:00.000Z").getTime() + index * 1000,
          ),
          metricName: `member.${index}`,
        });
      }

      // The earliest of them all joined last, on the second read.
      many.push({ ...FIRST_MEMBER, metricName: "joined.last.started.first" });
      mockEpisode = { members: many };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["joined.last.started.first"]);
      expect(readsOf(kind.membershipModel)).toHaveLength(2);
      expect(memberReads()).toHaveLength(2);
    });
  });

  describe("an open episode and a resolved one", () => {
    test("a resolved episode offers its start to its resolution, 15 minutes either side", async () => {
      await renderPage();

      const options: HTMLElement = pickerOptions();
      expect(within(options).getByText("Start to resolution")).toBeVisible();
      expect(within(options).queryByText("Start to now")).toBeNull();
      fireEvent.click(within(options).getByText("Start to resolution"));

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(START_TO_RESOLUTION);
      });
    });

    test("an open episode offers its start to now, and marks no resolution", async () => {
      mockEpisode = {
        timeline: [
          ["created", EPISODE_STARTED_AT],
          ["acknowledged", ACKNOWLEDGED_AT],
        ],
      };

      await renderPage();

      const options: HTMLElement = pickerOptions();
      expect(within(options).getByText("Start to now")).toBeVisible();
      expect(within(options).queryByText("Start to resolution")).toBeNull();
      fireEvent.click(within(options).getByText("Start to now"));

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(START_TO_NOW);
      });
      expect(momentLabels()).toEqual([kind.startedLabel, "Acknowledged"]);
    });

    test("an episode reopened after it was resolved is open again: its start to now", async () => {
      mockEpisode = {
        timeline: [
          ["created", EPISODE_STARTED_AT],
          ["resolved", RESOLVED_AT],
          ["acknowledged", new Date("2026-09-28T12:20:00.000Z")],
        ],
        // Its row still says when it was last resolved: the timeline decides.
        resolvedAt: RESOLVED_AT,
      };

      await renderPage();

      const options: HTMLElement = pickerOptions();
      expect(within(options).getByText("Start to now")).toBeVisible();
      expect(within(options).queryByText("Start to resolution")).toBeNull();
    });

    test("an episode with no state timeline ends when its row says it was resolved, as its Overview says", async () => {
      mockEpisode = { timeline: [], resolvedAt: RESOLVED_AT };

      await renderPage();

      pick("Start to resolution");
      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(START_TO_RESOLUTION);
      });
    });
  });

  describe("picking a time range", () => {
    test("the picker offers the ranges around the episode, each with what it covers", async () => {
      await renderPage();

      const dropdown: HTMLElement = pickerOptions();

      expect(within(dropdown).getByText(kind.presetsHeading)).toBeVisible();
      expect(within(dropdown).queryByText("Around this incident")).toBeNull();
      expect(within(dropdown).queryByText("Around this alert")).toBeNull();
      for (const label of [
        "Around the start",
        "The hour before it started",
        "The day before it started",
        "Start to resolution",
        "What the monitor saw",
        "Relative to now",
        "Past 1 Hour",
        "Custom Range...",
      ]) {
        expect(within(dropdown).getByText(label)).toBeVisible();
      }
    });

    test("a range picked re-queries it, is kept in the URL under the page's own names, and offers Copy link and Reset", async () => {
      await renderPage();

      pick("The hour before it started");

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
      });
      expect(pickerButton()).toHaveTextContent("The hour before it started");
      expect(urlParam("rootCauseMetricsTime")).toBe("hour-before");
      // Never the Overview's names: the two cards keep their own.
      expect(urlParam("metricsTime")).toBeNull();
      expect(screen.getByText("Copy link")).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(AROUND_START);
      });
      expect(screen.queryByText("Copy link")).toBeNull();
      expect(window.location.search).toBe("");
    });

    test("what the monitor saw is exactly the window it evaluated when it opened the first member", async () => {
      await renderPage();

      pick("What the monitor saw");

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual([
          EVALUATED_START.toISOString(),
          MEMBER_STARTED_AT.toISOString(),
        ]);
      });
      expect(urlParam("rootCauseMetricsTime")).toBe("evaluated");
    });

    test("Copy link copies a link to this page that opens the very same charts", async () => {
      const writeText: MockFunction = getJestMockFunction();
      writeText.mockImplementation(() => {
        return Promise.resolve();
      });
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeText },
        configurable: true,
        writable: true,
      });

      await renderPage();
      pick("The day before it started");
      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(DAY_BEFORE);
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Copy link"));
      });

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      const copied: URL = new URL(String(writeText.mock.calls[0]![0]));
      expect(copied.pathname).toBe(page());
      expect(copied.searchParams.get("rootCauseMetricsTime")).toBe(
        "day-before",
      );
    });

    test("a reload keeps the range picked", async () => {
      window.history.replaceState(
        {},
        "",
        `${page()}?rootCauseMetricsTime=day-before`,
      );

      await renderPage();

      expect(lastFetchedWindow()).toEqual(DAY_BEFORE);
      expect(fetchedWindows()).not.toContainEqual(AROUND_START);
      expect(pickerButton()).toHaveTextContent("The day before it started");
      expect(urlParam("rootCauseMetricsTime")).toBe("day-before");
    });

    test("a reload keeps a range of the reader's own, to the minute", async () => {
      const start: string = "2026-09-28T10:05:00.000Z";
      const end: string = "2026-09-28T10:50:00.000Z";
      window.history.replaceState(
        {},
        "",
        `${page()}?rootCauseMetricsTime=custom&rootCauseMetricsStart=${start}&rootCauseMetricsEnd=${end}`,
      );

      await renderPage();

      expect(lastFetchedWindow()).toEqual([start, end]);
      expect(fetchedWindows()).not.toContainEqual(AROUND_START);
      expect(urlParam("rootCauseMetricsStart")).toBe(start);
    });

    test("the Overview's range in the address is not this card's", async () => {
      window.history.replaceState({}, "", `${page()}?metricsTime=hour-before`);

      await renderPage();

      expect(lastFetchedWindow()).toEqual(AROUND_START);
      expect(urlParam("metricsTime")).toBe("hour-before");
    });
  });

  describe("changing the metrics", () => {
    test("a metric added in Edit metrics is charted and kept in the URL; Reset brings back the first member's", async () => {
      await renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Add Metric" }),
      );

      await waitFor(() => {
        expect(charts().metricViewData.queryConfigs).toHaveLength(2);
      });
      expect(
        screen.getByText(
          "The metrics you picked. Reset brings back the metrics the monitor watched.",
        ),
      ).toBeVisible();
      expect(urlParam("rootCauseMetricsQueries")).toContain(
        "system.cpu.utilization",
      );
      expect(urlParam("metricsQueries")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));

      await waitFor(() => {
        expect(charts().metricViewData.queryConfigs).toHaveLength(1);
      });
      expect(screen.getByText(kind.description)).toBeVisible();
      expect(window.location.search).toBe("");
    });

    test("Open in Metric Explorer takes the metrics and the time range charted to the explorer", async () => {
      const navigate: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});

      await renderPage();
      pick("The hour before it started");
      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open in Metric Explorer" }),
      );

      expect(navigate).toHaveBeenCalledTimes(1);
      const target: URL = new URL(String(navigate.mock.calls[0]![0]));
      expect(target.searchParams.get("metricQueries")).toContain(
        "system.cpu.utilization",
      );
      expect(target.searchParams.get("startTime")).toBe(HOUR_BEFORE[0]);
      expect(target.searchParams.get("endTime")).toBe(HOUR_BEFORE[1]);
    });
  });

  describe("a drag across the chart (issue #4105)", () => {
    test("a drag re-queries the dragged window and offers the way back", async () => {
      await renderPage();

      fireEvent.click(
        screen.getByRole("button", { name: "Drag across the chart" }),
      );

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual([
          MOCK_DRAG.start.toISOString(),
          MOCK_DRAG.end.toISOString(),
        ]);
      });
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      expect(
        screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
      // The episode's start stays marked on the zoomed chart.
      expect(charts().timeReferenceLines?.[0]?.date.toISOString()).toBe(
        EPISODE_STARTED_AT.toISOString(),
      );
    });

    test("a double-click, or Reset zoom, returns to the range around the episode's start, not to now", async () => {
      await renderPage();

      fireEvent.click(
        screen.getByRole("button", { name: "Drag across the chart" }),
      );
      await waitFor(() => {
        expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Double-click the chart" }),
      );

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(AROUND_START);
      });
      expect(charts().onTimeRangeReset).toBeUndefined();

      fireEvent.click(
        screen.getByRole("button", { name: "Drag across the chart" }),
      );
      fireEvent.click(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      );

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(AROUND_START);
      });
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });
  });

  describe("a first member that kept no metric snapshot", () => {
    test("charts its monitor's metrics as the monitor reads them now, around the episode's start, and says so", async () => {
      mockEpisode = {
        members: [
          {
            ...FIRST_MEMBER,
            telemetryQuery: null,
            monitor: metricsMonitor("system.cpu.utilization"),
          },
        ],
      };

      await renderPage();

      expect(lastFetchedWindow()).toEqual(AROUND_START);
      expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
      expect(
        screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
      ).toHaveTextContent("Charted for what this monitor checks now.");
      // Nothing the monitor evaluated to shade, or to offer.
      expect(charts().referenceRegions).toBeUndefined();
      expect(
        within(pickerOptions()).queryByText("What the monitor saw"),
      ).toBeNull();
    });

    test("an infrastructure monitor's member is charted for what the monitor checks, and names it", async () => {
      mockEpisode = {
        members: [
          {
            ...FIRST_MEMBER,
            telemetryQuery: null,
            monitor: monitorOf(
              MonitorType.Host,
              "hostMonitor",
              { hostIdentifier: "web-01" },
              "system.cpu.utilization",
            ),
          },
        ],
      };

      await renderPage();

      expect(
        screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
      ).toHaveTextContent("Charted for web-01, which this monitor checks now.");
      expect(
        lastFetchedQuery().queryConfigs[0]?.metricQueryData.filterData
          .attributes,
      ).toEqual(expect.objectContaining({ "resource.host.name": "web-01" }));
    });

    test("the note is one line of its own, a div that holds its icon, and it goes once the reader picks metrics of their own", async () => {
      mockEpisode = {
        members: [
          {
            ...FIRST_MEMBER,
            telemetryQuery: null,
            monitor: metricsMonitor("system.cpu.utilization"),
          },
        ],
      };

      await renderPage();

      const note: HTMLElement = screen.getByTestId(
        EVENT_METRIC_SCOPE_NOTE_TEST_ID,
      );
      expect(note.tagName).toBe("DIV");
      expect(note.closest("p")).toBeNull();
      expect(
        consoleErrors.filter((message: string): boolean => {
          return message.includes("validateDOMNesting");
        }),
      ).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Add Metric" }),
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
        ).toBeNull();
      });
    });

    test("a snapshot of logs is no metric snapshot: the first member's metrics monitor is charted", async () => {
      mockEpisode = {
        members: [
          {
            ...FIRST_MEMBER,
            telemetryQuery: LOGS_SNAPSHOT,
            monitor: metricsMonitor("http.server.errors"),
          },
        ],
      };

      await renderPage();

      expect(chartedMetricNames()).toEqual(["http.server.errors"]);
      expect(screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toBeVisible();
    });
  });

  describe("an episode with no metrics behind it shows no card, and reads nothing more", () => {
    test("an episode with no member: the membership, read once, and nothing else", async () => {
      mockEpisode = { members: [] };

      await renderPageWithoutCard();

      expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
      expect(screen.queryByText(kind.description)).toBeNull();
      expect(getListMock).toHaveBeenCalledTimes(1);
      expect(readsOf(kind.membershipModel)).toHaveLength(1);
      expect(getItemMock).not.toHaveBeenCalled();
      expect(fetchResultsMock).not.toHaveBeenCalled();
    });

    test.each([
      ["no monitor and no snapshot", { telemetryQuery: null, monitor: null }],
      [
        "a monitor that reads no metrics, and no snapshot",
        { telemetryQuery: null, monitor: WEBSITE_MONITOR },
      ],
      [
        "a snapshot of logs, and no monitor",
        { telemetryQuery: LOGS_SNAPSHOT, monitor: null },
      ],
      [
        "a metrics monitor with no metric picked yet, and no snapshot",
        { telemetryQuery: null, monitor: metricsMonitor("") },
      ],
    ])(
      "a first member with %s: the membership and that member, and nothing else",
      async (_name: string, member: Partial<MemberData>) => {
        mockEpisode = { members: [{ ...FIRST_MEMBER, ...member }] };

        await renderPageWithoutCard();

        expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
        expect(screen.queryByText(kind.description)).toBeNull();
        expect(getListMock).toHaveBeenCalledTimes(2);
        expect(readsOf(kind.membershipModel)).toHaveLength(1);
        expect(memberReads()).toHaveLength(1);
        // Its moments, and the episode itself, are read only for a card.
        expect(getItemMock).not.toHaveBeenCalled();
        expect(fetchResultsMock).not.toHaveBeenCalled();
      },
    );

    test("members the reader may not see are no members: no card", async () => {
      // The membership names one, but the member read finds none it may see.
      getListMock.mockImplementation(async (...args: Array<unknown>) => {
        const request: { modelType: unknown } = args[0] as {
          modelType: unknown;
        };

        if (request.modelType === kind.membershipModel) {
          return list([
            { [kind.membershipMemberField]: new ObjectID(FIRST_MEMBER_ID) },
          ]);
        }

        return list([]);
      });

      await renderPageWithoutCard();

      expect(getListMock).toHaveBeenCalledTimes(2);
      expect(getItemMock).not.toHaveBeenCalled();
    });
  });

  describe("reading the episode", () => {
    test("a read of its members that fails says so, in the card", async () => {
      getListMock.mockImplementation(async () => {
        throw new Error("The episode's members could not be read");
      });

      await act(async () => {
        render(<kind.Page {...PAGE_PROPS} />);
      });

      expect(
        await screen.findByText("The episode's members could not be read"),
      ).toBeVisible();
      expect(screen.getByText("Metrics")).toBeVisible();
      expect(screen.getByText(kind.description)).toBeVisible();
      expect(getItemMock).not.toHaveBeenCalled();
      expect(fetchResultsMock).not.toHaveBeenCalled();
    });

    test("a read of the episode itself that fails says so too, in the card", async () => {
      getItemMock.mockImplementation(async () => {
        throw new Error("The episode could not be read");
      });

      await act(async () => {
        render(<kind.Page {...PAGE_PROPS} />);
      });

      expect(
        await screen.findByText("The episode could not be read"),
      ).toBeVisible();
      expect(screen.getByText("Metrics")).toBeVisible();
      expect(fetchResultsMock).not.toHaveBeenCalled();
    });

    test("while it reads, the card says it is loading, under the investigation's own title", async () => {
      let finish: (() => void) | null = null;
      getListMock.mockImplementation(() => {
        return new Promise<Record<string, unknown>>(
          (resolve: (value: Record<string, unknown>) => void) => {
            finish = (): void => {
              resolve(list([]));
            };
          },
        );
      });

      await act(async () => {
        render(<kind.Page {...PAGE_PROPS} />);
      });

      expect(screen.getByText("Metrics")).toBeVisible();
      expect(screen.getByText(kind.description)).toBeVisible();
      expect(screen.queryByTestId("metric-charts")).toBeNull();
      expect(getItemMock).not.toHaveBeenCalled();

      // An episode with no member, once read: no card at all.
      await act(async () => {
        finish?.();
      });
      expect(screen.queryByText("Metrics")).toBeNull();
    });

    test("another episode's page starts on that episode's own first member and range, not on what the reader picked here", async () => {
      const rendered: RenderResult = await renderPage();

      pick("The hour before it started");
      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
      });

      // The reader follows a link to another episode's Root Cause page.
      window.history.replaceState({}, "", kind.pagePath(OTHER_EPISODE_ID));
      jest
        .spyOn(Navigation, "getLastParamAsObjectID")
        .mockImplementation(() => {
          return new ObjectID(OTHER_EPISODE_ID);
        });
      await act(async () => {
        rendered.rerender(<kind.Page {...PAGE_PROPS} />);
      });

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(OTHER_AROUND_START);
      });
      expect(chartedMetricNames()).toEqual(["system.memory.utilization"]);
      expect(pickerButton()).toHaveTextContent("Around the start");
      expect(window.location.search).toBe("");
      // That episode's members, read afresh, once.
      expect(
        readsOf(kind.membershipModel).map((read: Read): string => {
          return String(read.query![kind.membershipEpisodeField]);
        }),
      ).toEqual([EPISODE_ID, OTHER_EPISODE_ID]);
      expect(
        readsOf(kind.episodeModel).map((read: Read): string => {
          return read.id!.toString();
        }),
      ).toEqual([EPISODE_ID, OTHER_EPISODE_ID]);
    });
  });
});

describe("an incident episode's own start", () => {
  beforeEach(() => {
    kind = INCIDENT_EPISODE;
    window.history.replaceState({}, "", page());
    serve();
  });

  test("an episode older than declaredAt started when it was created, as its Overview says", async () => {
    mockEpisode = {
      startedAt: null,
      createdAt: new Date("2026-09-28T11:30:00.000Z"),
    };

    await renderPage();

    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(charts().timeReferenceLines?.[0]?.label).toBe("Declared");
  });

  test("declared before it was created: it started when it was declared", async () => {
    mockEpisode = {
      startedAt: EPISODE_STARTED_AT,
      createdAt: new Date("2026-09-28T12:45:00.000Z"),
    };

    await renderPage();

    expect(lastFetchedWindow()).toEqual(AROUND_START);
  });
});
