import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN EPISODE'S ROOT CAUSE PAGE CHARTS WHAT ITS OVERVIEW CHARTS (issue
 * #6320), over generated episodes.
 *
 * Both pages are rendered for real against one fake server, which sorts,
 * filters and pages as the API does: the Overview with its telemetry card
 * stood in for by a recorder, the Root Cause page with its investigation
 * stood in for by another. For every episode drawn - from none to many
 * members, joined in any order, starts that tie or cannot be read, members
 * the reader may not see, snapshots of metrics, of logs or none, monitors
 * that read metrics or not, an open, resolved or reopened episode - the two
 * pick the same member, the earliest started one, draw its rule, chart the
 * same metrics over the same window and series, and anchor them on the same
 * start, end, state timeline and states. The Root Cause page shows a card
 * exactly when that member has metrics behind it: a metric snapshot, or a
 * monitor that reads metrics, which it charts as it reads now and says so.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const overviewPanels: Array<Record<string, unknown>> = [];
const rootCausePanels: Array<Record<string, unknown>> = [];

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
      getCommonHeaders: (...args: Array<unknown>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Logger", () => {
  const silent: () => undefined = (): undefined => {
    return undefined;
  };
  return {
    __esModule: true,
    Logger: { error: silent, warn: silent, log: silent, info: silent },
  };
});

// The Overview's telemetry card: what it was handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel",
  () => {
    return {
      __esModule: true,
      EVENT_TELEMETRY_TIME_URL_PREFIX: "telemetry",
      default: (props: Record<string, unknown>) => {
        overviewPanels.push(props);
        return <div data-testid="overview-telemetry" />;
      },
    };
  },
);

// The Root Cause page's investigation: what it was handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel",
  () => {
    return {
      __esModule: true,
      EVENT_METRIC_INVESTIGATION_URL_PREFIX: "metrics",
      EVENT_METRIC_SCOPE_NOTE_TEST_ID: "event-metric-scope-note",
      default: (props: Record<string, unknown>) => {
        rootCausePanels.push(props);
        return <div data-testid="root-cause-investigation" />;
      },
    };
  },
);

function stub(name: string): Record<string, unknown> {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid={name} />;
    },
  };
}

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return stub("card-model-detail");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard",
  () => {
    return stub("episode-members");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState",
  () => {
    return stub("incident-episode-header");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/ChangeState",
  () => {
    return stub("alert-episode-header");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed",
  () => {
    return stub("incident-episode-feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodeFeed",
  () => {
    return stub("alert-episode-feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment",
  () => {
    return stub("incident-episode-roles");
  },
);

import IncidentEpisodeOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Index";
import AlertEpisodeOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Index";
import IncidentEpisodeRootCause from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/RootCause";
import AlertEpisodeRootCause from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import { EPISODE_MEMBER_IDS_PER_REQUEST } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/FetchEpisodeMembers";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "44444444-4444-4444-8444-444444444444";
const BASE_MS: number = new Date("2026-09-28T11:00:00.000Z").getTime();
const MINUTE_MS: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(BASE_MS + minutes * MINUTE_MS);
}

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/episodes"),
  currentProject: null,
  hasPaymentMethod: true,
};

function queryConfig(metricName: string): Record<string, unknown> {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
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

function metricSnapshot(
  metricName: string,
  startedAt: Date,
): Record<string, unknown> {
  return {
    telemetryType: "Metric",
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(
          new Date(startedAt.getTime() - 5 * MINUTE_MS),
          startedAt,
        ),
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
  metricName: string,
): Record<string, unknown> {
  return {
    _id: "99999999-9999-4999-8999-999999999999",
    monitorType: monitorType,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              id: "step-1",
              metricMonitor: {
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

const STATES: Array<{
  id: string;
  name: string;
  order: number;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}> = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Created", order: 1 },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    name: "Acknowledged",
    order: 2,
    isAcknowledgedState: true,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
  // A state of the project's own, placed after Resolved: resolved too.
  { id: "aaaaaaaa-0000-4000-8000-000000000004", name: "Closed", order: 4 },
];

interface GeneratedMember {
  id: string;
  // When it was declared (an incident) or created (an alert).
  startedAt: Date | undefined;
  // An incident's createdAt too, in no order with when it was declared.
  createdAt: Date | undefined;
  isHidden: boolean;
  telemetryQuery: Record<string, unknown> | null;
  seriesLabels: Record<string, unknown> | undefined;
  monitor: Record<string, unknown> | null;
  // What the test knows it holds, to say whether it has metrics behind it.
  snapshotHasMetric: boolean;
  monitorHasMetric: boolean;
}

interface GeneratedEpisode {
  declaredAt: Date | undefined;
  createdAt: Date | undefined;
  resolvedAt: Date | undefined;
  members: Array<GeneratedMember>;
  membership: Array<string>;
  timeline: Array<{ stateId: string; startsAt: Date }>;
}

interface EpisodeKind {
  name: string;
  Overview: React.FunctionComponent<PageComponentProps>;
  RootCause: React.FunctionComponent<PageComponentProps>;
  subject: EventMetricSubject;
  episodeModel: { new (): BaseModel };
  membershipModel: unknown;
  memberModel: { new (): BaseModel };
  timelineModel: { new (): BaseModel };
  stateModel: { new (): BaseModel };
  membershipMemberField: string;
  timelineStateField: string;
  memberStartField: string;
  seed: number;
}

const KINDS: Array<EpisodeKind> = [
  {
    name: "an incident episode",
    Overview: IncidentEpisodeOverview,
    RootCause: IncidentEpisodeRootCause,
    subject: EventMetricSubject.IncidentEpisode,
    episodeModel: IncidentEpisode,
    membershipModel: IncidentEpisodeMember,
    memberModel: Incident,
    timelineModel: IncidentEpisodeStateTimeline,
    stateModel: IncidentState,
    membershipMemberField: "incidentId",
    timelineStateField: "incidentStateId",
    memberStartField: "declaredAt",
    seed: 632001,
  },
  {
    name: "an alert episode",
    Overview: AlertEpisodeOverview,
    RootCause: AlertEpisodeRootCause,
    subject: EventMetricSubject.AlertEpisode,
    episodeModel: AlertEpisode,
    membershipModel: AlertEpisodeMember,
    memberModel: Alert,
    timelineModel: AlertEpisodeStateTimeline,
    stateModel: AlertState,
    membershipMemberField: "alertId",
    timelineStateField: "alertStateId",
    memberStartField: "createdAt",
    seed: 632002,
  },
];

function pick<T>(random: SeededRandom, values: Array<T>): T {
  return values[random(values.length)]!;
}

function generateEpisode(random: SeededRandom, draw: number): GeneratedEpisode {
  // Every 25th episode holds more members than one read names.
  const count: number =
    draw % 25 === 7 ? EPISODE_MEMBER_IDS_PER_REQUEST + random(5) : random(7);
  const members: Array<GeneratedMember> = [];

  for (let index: number = 0; index < count; index++) {
    // The few draws with thousands of members keep them plain.
    const isPlain: boolean = count > 50 && index > 3;
    const startKind: number = random(10);
    const startedAt: Date | undefined =
      startKind === 0 ? undefined : at(startKind < 4 ? random(3) : random(120));
    const snapshotKind: number = isPlain ? 3 : random(4);
    const monitorKind: number = isPlain ? 0 : random(4);
    const metricName: string = random(5) ? `m-${draw}-${index}` : "";

    members.push({
      id: `66666666-6666-4666-8666-${String(draw * 100000 + ((index * 7919) % 100000)).padStart(12, "0")}`,
      startedAt: startedAt,
      createdAt: at(random(120)),
      isHidden: !isPlain && random(8) === 0,
      telemetryQuery: [
        metricSnapshot(metricName, startedAt || at(0)),
        LOGS_SNAPSHOT,
        // A metric snapshot that kept no metric: none to chart.
        metricSnapshot("", startedAt || at(0)),
        null,
      ][snapshotKind]!,
      seriesLabels: pick(random, [
        { "resource.host.name": `host-${index}` },
        undefined,
      ]),
      monitor: [
        null,
        monitorOf(MonitorType.Metrics, metricName ? `${metricName}-now` : ""),
        monitorOf(MonitorType.Metrics, `${metricName || "x"}-now`),
        monitorOf(MonitorType.API, "api.metric"),
      ][monitorKind]!,
      snapshotHasMetric: snapshotKind === 0 && metricName !== "",
      monitorHasMetric:
        (monitorKind === 1 && metricName !== "") || monitorKind === 2,
    });
  }

  const membership: Array<string> = shuffled(
    members.map((member: GeneratedMember): string => {
      return member.id;
    }),
    random,
  );

  const timeline: Array<{ stateId: string; startsAt: Date }> = [];
  const entries: number = random(5);

  for (let entry: number = 0; entry < entries; entry++) {
    timeline.push({
      stateId: pick(random, STATES).id,
      startsAt: at(random(240)),
    });
  }

  return {
    declaredAt: random(4) ? at(random(60)) : undefined,
    createdAt: random(10) ? at(random(60)) : undefined,
    resolvedAt: random(2) ? at(random(240)) : undefined,
    members: members,
    membership: membership,
    timeline: timeline,
  };
}

// The member both pages should chart: the earliest started visible one.
function firstMemberOf(episode: GeneratedEpisode): GeneratedMember | undefined {
  return episode.members
    .filter((member: GeneratedMember): boolean => {
      return !member.isHidden;
    })
    .sort((left: GeneratedMember, right: GeneratedMember): number => {
      const leftMs: number = left.startedAt
        ? left.startedAt.getTime()
        : Number.POSITIVE_INFINITY;
      const rightMs: number = right.startedAt
        ? right.startedAt.getTime()
        : Number.POSITIVE_INFINITY;

      if (leftMs !== rightMs) {
        return leftMs - rightMs;
      }

      return left.id < right.id ? -1 : 1;
    })[0];
}

/*
 * Postgres's order: by the column, NULL last when ascending and first when
 * descending, then by id, as DatabaseService completes every sort.
 */
function postgresOrder(
  left: BaseModel,
  right: BaseModel,
  sortField: string,
  sortOrder: unknown,
): number {
  const leftValue: unknown = (left as unknown as Record<string, unknown>)[
    sortField
  ];
  const rightValue: unknown = (right as unknown as Record<string, unknown>)[
    sortField
  ];
  const leftMs: number | null =
    leftValue instanceof Date ? leftValue.getTime() : null;
  const rightMs: number | null =
    rightValue instanceof Date ? rightValue.getTime() : null;

  if (leftMs !== rightMs) {
    let ascending: number = -1;

    if (leftMs === null) {
      ascending = 1;
    } else if (rightMs !== null && leftMs > rightMs) {
      ascending = 1;
    }

    return sortOrder === SortOrder.Descending ? -ascending : ascending;
  }

  return left.id!.toString() < right.id!.toString() ? -1 : 1;
}

let kind: EpisodeKind = KINDS[0]!;
let episode: GeneratedEpisode | null = null;

function modelOf(
  modelType: { new (): BaseModel },
  values: Record<string, unknown>,
): BaseModel {
  const model: BaseModel = new modelType();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      (model as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return model;
}

function listOf(data: Array<unknown>, count?: number): Record<string, unknown> {
  return {
    data: data,
    count: count === undefined ? data.length : count,
    skip: 0,
    limit: 10000,
  };
}

function serve(): void {
  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === kind.episodeModel && episode) {
      const row: BaseModel = modelOf(kind.episodeModel, {
        createdAt: episode.createdAt,
        resolvedAt: episode.resolvedAt,
        title: "Checkout is down",
        episodeNumber: 7,
        isManuallyCreated: false,
      });
      row.id = new ObjectID(EPISODE_ID);

      if (kind.episodeModel === IncidentEpisode && episode.declaredAt) {
        (row as IncidentEpisode).declaredAt = episode.declaredAt;
      }

      return row;
    }

    return null;
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      skip: number;
      limit: number;
    } = args[0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      skip: number;
      limit: number;
    };

    if (!episode) {
      return listOf([]);
    }

    if (request.modelType === kind.membershipModel) {
      return listOf(
        episode.membership
          .slice(request.skip, request.skip + request.limit)
          .map((id: string): Record<string, unknown> => {
            return { [kind.membershipMemberField]: new ObjectID(id) };
          }),
        episode.membership.length,
      );
    }

    if (request.modelType === kind.memberModel) {
      const ids: Set<string> = new Set<string>(
        (request.query["_id"] as Includes).values.map((id: unknown): string => {
          return String(id);
        }),
      );
      // Sorted by what the request sorts by, as Postgres sorts it.
      const [sortField, sortOrder]: [string, unknown] = Object.entries(
        (args[0] as { sort: Record<string, unknown> }).sort,
      )[0]!;
      const rows: Array<BaseModel> = episode.members
        .filter((member: GeneratedMember): boolean => {
          return ids.has(member.id) && !member.isHidden;
        })
        .map((member: GeneratedMember): BaseModel => {
          const row: BaseModel = modelOf(kind.memberModel, {
            createdAt: member.createdAt,
            [kind.memberStartField]: member.startedAt,
            telemetryQuery: member.telemetryQuery,
            seriesLabels: member.seriesLabels,
          });
          row.id = new ObjectID(member.id);

          if (kind.memberModel === Incident) {
            (row as unknown as Record<string, unknown>)["monitors"] =
              member.monitor ? [member.monitor] : [];
          } else {
            (row as unknown as Record<string, unknown>)["monitor"] =
              member.monitor;
          }

          return row;
        })
        .sort((left: BaseModel, right: BaseModel): number => {
          return postgresOrder(left, right, sortField, sortOrder);
        });

      return listOf(rows.slice(0, request.limit), rows.length);
    }

    if (request.modelType === kind.timelineModel) {
      return listOf(
        episode.timeline.map(
          (entry: { stateId: string; startsAt: Date }): BaseModel => {
            return modelOf(kind.timelineModel, {
              [kind.timelineStateField]: new ObjectID(entry.stateId),
              startsAt: entry.startsAt,
            });
          },
        ),
      );
    }

    if (request.modelType === kind.stateModel) {
      return listOf(
        STATES.map((state: (typeof STATES)[number]): BaseModel => {
          const model: BaseModel = modelOf(kind.stateModel, {
            name: state.name,
            order: state.order,
            isAcknowledgedState: state.isAcknowledgedState,
            isResolvedState: state.isResolvedState,
          });
          model.id = new ObjectID(state.id);
          return model;
        }),
      );
    }

    return listOf([]);
  });
}

async function renderOverview(): Promise<Record<string, unknown> | undefined> {
  overviewPanels.length = 0;

  await act(async () => {
    render(<kind.Overview {...PAGE_PROPS} />);
  });
  await waitFor(() => {
    expect(
      screen.getByRole("group", { name: "Episode timing" }),
    ).toBeInTheDocument();
  });

  const panel: Record<string, unknown> | undefined =
    overviewPanels[overviewPanels.length - 1];
  cleanup();
  return panel;
}

async function renderRootCause(): Promise<Record<string, unknown> | undefined> {
  rootCausePanels.length = 0;

  await act(async () => {
    render(<kind.RootCause {...PAGE_PROPS} />);
  });
  // Read, and settled: no loader and no error card left.
  await waitFor(() => {
    expect(screen.queryByText("Metrics")).toBeNull();
  });

  const panel: Record<string, unknown> | undefined =
    rootCausePanels[rootCausePanels.length - 1];
  cleanup();
  return panel;
}

function msOf(value: unknown): number | undefined {
  return value instanceof Date ? value.getTime() : undefined;
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue({});
  overviewPanels.length = 0;
  rootCausePanels.length = 0;
  episode = null;

  const path: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}`;
  window.history.replaceState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(EPISODE_ID);
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe.each(KINDS)(
  "seeded: $name's Root Cause page charts what its Overview charts",
  (episodeKind: EpisodeKind) => {
    test("the same first member, rule, metrics, window, series and moments, over 70 generated episodes", async () => {
      kind = episodeKind;
      serve();

      const random: SeededRandom = seededRandom(kind.seed);
      let compared: number = 0;
      let rootCauseOnly: number = 0;
      let neither: number = 0;
      let resolved: number = 0;
      let paged: number = 0;

      for (let draw: number = 0; draw < 70; draw++) {
        episode = generateEpisode(random, draw);
        paged +=
          episode.members.length > EPISODE_MEMBER_IDS_PER_REQUEST ? 1 : 0;

        const first: GeneratedMember | undefined = firstMemberOf(episode);
        const overview: Record<string, unknown> | undefined =
          await renderOverview();
        const rootCause: Record<string, unknown> | undefined =
          await renderRootCause();

        // Both pick the earliest started member the reader may see.
        if (overview) {
          expect({ draw, member: overview["metricRuleEventId"] }).toEqual({
            draw,
            member: first?.id,
          });
        }

        // A Root Cause card exactly when that member has metrics behind it.
        expect({ draw, card: Boolean(rootCause) }).toEqual({
          draw,
          card: Boolean(
            first && (first.snapshotHasMetric || first.monitorHasMetric),
          ),
        });

        if (!rootCause) {
          neither += overview ? 0 : 1;
          continue;
        }

        // The member's rule, the episode's subject, and no event of its own.
        expect({ draw, rule: rootCause["ruleEventId"] }).toEqual({
          draw,
          rule: first!.id,
        });
        expect(rootCause["eventId"]).toBeUndefined();
        expect(rootCause["subject"]).toBe(kind.subject);
        expect(rootCause["impactStartedAt"]).toBeUndefined();

        const query: TelemetryQuery = rootCause[
          "telemetryQuery"
        ] as TelemetryQuery;

        if (first!.snapshotHasMetric) {
          // Charted from its snapshot: exactly what the Overview charts.
          expect(overview).toBeDefined();
          expect(overview!["telemetryQuery"]).toEqual(query);
          expect(overview!["snapshotWindow"]).toEqual(
            rootCause["evaluationWindow"],
          );
          expect(overview!["seriesSummary"]).toBe(rootCause["seriesSummary"]);
          expect(overview!["subject"]).toBe(kind.subject);
          expect(rootCause["chartedFromMonitorNow"]).toBeUndefined();
        } else {
          // Its monitor as it reads now, which it says.
          expect(rootCause["chartedFromMonitorNow"]).toEqual({
            resourceName: "",
          });
          expect(rootCause["evaluationWindow"]).toBeNull();
          expect(
            query.metricViewData?.queryConfigs[0]?.metricQueryData.filterData
              .metricName,
          ).toMatch(/-now$/);
          rootCauseOnly++;
        }

        // Anchored alike, whenever the Overview shows a card to anchor.
        if (overview) {
          expect({ draw, start: msOf(rootCause["startedAt"]) }).toEqual({
            draw,
            start: msOf(overview["startedAt"]),
          });
          expect({ draw, end: msOf(rootCause["endedAt"]) }).toEqual({
            draw,
            end: msOf(overview["endedAt"]),
          });
          expect(rootCause["stateTimeline"]).toEqual(overview["stateTimeline"]);
          expect(
            (rootCause["states"] as Array<BaseModel>).map(
              (state: BaseModel): string => {
                return state.id!.toString();
              },
            ),
          ).toEqual(
            (overview["states"] as Array<BaseModel>).map(
              (state: BaseModel): string => {
                return state.id!.toString();
              },
            ),
          );
          compared++;
          resolved += rootCause["endedAt"] ? 1 : 0;
        }
      }

      // The draws reach every case, not one of them over and over.
      expect(compared).toBeGreaterThan(10);
      expect(rootCauseOnly).toBeGreaterThan(5);
      expect(neither).toBeGreaterThan(5);
      expect(resolved).toBeGreaterThan(3);
      expect(paged).toBeGreaterThan(0);
    }, 300000);
  },
);
