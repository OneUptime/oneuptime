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
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import FindingOccurrences from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingOccurrences";
import {
  getOccurrenceLinks,
  getOccurrenceMetricsRoute,
  getTelemetryStoreOwnerRoute,
  METRIC_WINDOW_IN_MINUTES,
  OccurrenceLink,
  OccurrenceLinkKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingOccurrenceLinks";
import FindingRecordsPanel, {
  FINDING_RECORDS_PANEL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingRecordsPanel";
import IssueTelemetryFindings from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings";
import {
  getRulesRoute,
  getScrubItGates,
  getScrubItState,
  isScrubItOfferedAtAll,
  SCRUB_NOTICES,
  SCRUB_UNAVAILABLE_SENTENCES,
  ScrubItGates,
  ScrubItState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryScrubIt";
import DataSecurityTelemetryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Telemetry";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import Route from "../../../Types/API/Route";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerptPartKind,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesSource,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { TelemetryScrubUnavailableReason } from "../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * A TELEMETRY FINDING'S RECORDS FROM IN YOUR TELEMETRY (#9605), AND A
 * METRIC'S DATA POINTS AMONG THEM (#9604).
 *
 * In Your Telemetry lists what was found across every service; Show
 * Records opens the records each finding was seen in beside the list - the
 * records list an issue's Where It Was Found shows - for a reader who may
 * read the masked samples, with Scrub It as the panel's action. A metric's
 * data point is a record of its own, opening in the metrics explorer on
 * its metric, split by the attribute the data is under, and Scrub It on a
 * metric attribute asks for the metric pipeline rule permission - and on a
 * metric's name says why it cannot instead.
 *
 * The page's ModelTable is a stand-in that draws the page's rows with
 * their row actions, as CustomDomainsPages.test.tsx does; everything else
 * is real.
 */

configure({ asyncUtilTimeout: 15000 });

const SERVICE_ID: string = "1a1a1a1a-0000-4000-8000-0000000000a1";
const LOGS_STORE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000c3";
const METRICS_STORE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000c4";
const LOG_FINDING_ID: string = "4d4d4d4d-0000-4000-8000-0000000000d4";
const METRIC_FINDING_ID: string = "5e5e5e5e-0000-4000-8000-0000000000e5";
const NAME_FINDING_ID: string = "6f6f6f6f-0000-4000-8000-0000000000f6";

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

// Reads what was found and where: never a sample or a record.
const VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityViewer,
];

// Reads the samples, and makes metric pipeline rules but no scrub rule.
const METRIC_RULE_MAKER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityMember,
  Permission.CreateProjectMetricPipelineRule,
];

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function storeOf(id: string, kind: DataStoreKind): DataStore {
  const store: DataStore = new DataStore(new ObjectID(id));
  store.name = `checkout · ${kind}`;
  store.kind = kind;
  store.serviceId = new ObjectID(SERVICE_ID);
  store.storeKey = `telemetry:${SERVICE_ID}:${kind}`;
  return store;
}

function findingOf(
  id: string,
  storeId: string,
  overrides: Partial<DataStoreFinding> = {},
): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(new ObjectID(id));
  finding.dataStoreId = new ObjectID(storeId);
  finding.dataTypeId = "email-address";
  finding.dataTypeName = "Email address";
  finding.sensitivity = DataSensitivity.Confidential;
  finding.location = "attributes.user.email";
  finding.locationKind = "Attribute";
  finding.confidence = DataConfidence.High;
  finding.matchCount = 12;
  finding.valueCount = 40;
  finding.isScrubbed = false;
  finding.isSuppressed = false;
  finding.lastSeenAt = new Date(Date.now() - 5 * 60 * 1000);
  finding.maskedSamples = ["j***@a********.com"];
  Object.assign(finding, overrides);
  return finding;
}

const METRIC_POINT: DataSecurityFindingOccurrence = {
  time: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  recordKind: DataSecurityOccurrenceRecordKind.Metric,
  serviceId: SERVICE_ID,
  name: "user.logins",
  metricName: "user.logins",
  maskedValue: "j***@a********.com",
  excerpt: {
    field: "user.email",
    parts: [
      {
        kind: DataSecurityOccurrenceExcerptPartKind.Match,
        text: "j***@a********.com",
      },
    ],
    isCutAtStart: false,
    isCutAtEnd: false,
  },
};

let stores: Array<DataStore>;
let findings: Array<DataStoreFinding>;
let occurrences: DataSecurityFindingOccurrences;
let occurrencesSpy: SpyInstance<typeof DataSecurityApi.getFindingOccurrences>;
let scrubSpy: SpyInstance<typeof DataSecurityApi.scrubFinding>;
let mockTableProps: ModelTableProps<DataStoreFinding> | null = null;
let mockRows: Array<DataStoreFinding> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<DataStoreFinding>): React.ReactElement => {
      mockTableProps = props;

      return (
        <section data-testid={props.id}>
          {mockRows.map((row: DataStoreFinding): React.ReactElement => {
            const id: string = row._id!.toString();

            return (
              <div key={id} data-testid={`row-${id}`}>
                {(props.actionButtons || [])
                  .filter(
                    (action: ActionButtonSchema<DataStoreFinding>): boolean => {
                      return (
                        !action.isVisible || Boolean(action.isVisible(row))
                      );
                    },
                  )
                  .map(
                    (
                      action: ActionButtonSchema<DataStoreFinding>,
                    ): React.ReactElement => {
                      const reason: string | undefined =
                        action.getDisabledReason?.(row);

                      return (
                        <button
                          key={action.title}
                          type="button"
                          disabled={Boolean(action.disabled || reason)}
                          data-tooltip={reason || action.tooltip || ""}
                          data-placement={action.placement || ""}
                          onClick={() => {
                            void action.onClick(
                              row,
                              () => {},
                              () => {},
                            );
                          }}
                        >
                          {action.title}
                        </button>
                      );
                    },
                  )}
              </div>
            );
          })}
        </section>
      );
    },
  };
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <DataSecurityTelemetryPage {...({} as PageComponentProps)} />
    </MemoryRouter>,
  );
}

async function rowOf(findingId: string): Promise<HTMLElement> {
  return await screen.findByTestId(`row-${findingId}`);
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/telemetry`);
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);
  mockTableProps = null;
  stores = [
    storeOf(LOGS_STORE_ID, DataStoreKind.TelemetryLogs),
    storeOf(METRICS_STORE_ID, DataStoreKind.TelemetryMetrics),
  ];
  findings = [
    findingOf(LOG_FINDING_ID, LOGS_STORE_ID, { location: "body" }),
    findingOf(METRIC_FINDING_ID, METRICS_STORE_ID),
    findingOf(NAME_FINDING_ID, METRICS_STORE_ID, {
      location: "name",
      locationKind: "Field",
      maskedSamples: ["s***@a********.count"],
    }),
  ];
  mockRows = findings;
  occurrences = {
    occurrences: [METRIC_POINT],
    since: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    until: new Date().toISOString(),
    recordsRead: 30,
    isComplete: true,
    source: DataSecurityOccurrencesSource.SampledRecords,
  };

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    data: unknown,
  ): Promise<ListResult<BaseModel>> => {
    const modelType: { new (): BaseModel } = (
      data as { modelType: { new (): BaseModel } }
    ).modelType;
    const rows: Array<BaseModel> = modelType === DataStore ? [...stores] : [];

    return { data: rows, count: rows.length, skip: 0, limit: 100 };
  }) as never);
  occurrencesSpy = jest
    .spyOn(DataSecurityApi, "getFindingOccurrences")
    .mockImplementation(async () => {
      return occurrences;
    });
  scrubSpy = jest.spyOn(DataSecurityApi, "scrubFinding").mockResolvedValue({
    signal: "metric",
    scrubRuleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
    scrubRuleName: "Data Security: Email address in attributes.user.email",
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Scrub It's rule, gate and reason, by where a finding sits", () => {
  function stateOf(
    kind: DataStoreKind,
    location: string,
    gates: ScrubItGates = getScrubItGates(),
  ): ScrubItState {
    return getScrubItState({ kind, location, gates });
  }

  test("each place asks for the permission of the rule it takes", () => {
    expect(stateOf(DataStoreKind.TelemetryLogs, "body").signal).toBe("log");
    expect(stateOf(DataStoreKind.TelemetryTraces, "attributes.a").signal).toBe(
      "trace",
    );
    expect(
      stateOf(DataStoreKind.TelemetryMetrics, "attributes.user.email").signal,
    ).toBe("metric");

    // An owner may make every rule.
    expect(
      stateOf(DataStoreKind.TelemetryMetrics, "attributes.user.email"),
    ).toEqual({
      isShown: true,
      isAllowed: true,
      disabledReason: undefined,
      signal: "metric",
    });
  });

  test("a reader who makes metric pipeline rules scrubs a metric's attribute, and is told why not on a log line", () => {
    grant(METRIC_RULE_MAKER);
    PermissionGate.clearPermissionPropsCache();

    const gates: ScrubItGates = getScrubItGates();
    const metric: ScrubItState = stateOf(
      DataStoreKind.TelemetryMetrics,
      "attributes.user.email",
      gates,
    );
    const log: ScrubItState = stateOf(
      DataStoreKind.TelemetryLogs,
      "body",
      gates,
    );

    expect(metric.isAllowed).toBe(true);
    expect(log.isAllowed).toBe(false);
    expect(log.isShown).toBe(true);
    expect(log.disabledReason).toContain(
      "You do not have permission to create scrub rules.",
    );
    expect(isScrubItOfferedAtAll(gates)).toBe(true);
  });

  test("no rule reaches a metric's name or a session's own details, and why is said", () => {
    expect(stateOf(DataStoreKind.TelemetryMetrics, "name")).toEqual({
      isShown: false,
      isAllowed: false,
      unavailableReason: TelemetryScrubUnavailableReason.MetricName,
    });
    expect(
      stateOf(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserLabel",
      ).unavailableReason,
    ).toBe(TelemetryScrubUnavailableReason.SessionDetails);
    expect(
      SCRUB_UNAVAILABLE_SENTENCES[TelemetryScrubUnavailableReason.MetricName],
    ).toContain("Rename the metric");
  });

  test("a Security Viewer sees Scrub It locked, saying the permission it takes", () => {
    grant(VIEWER);
    PermissionGate.clearPermissionPropsCache();

    const gates: ScrubItGates = getScrubItGates();
    const metric: ScrubItState = stateOf(
      DataStoreKind.TelemetryMetrics,
      "attributes.user.email",
      gates,
    );

    expect(isScrubItOfferedAtAll(gates)).toBe(true);
    expect(metric.isShown).toBe(true);
    expect(metric.isAllowed).toBe(false);
    expect(metric.disabledReason).toContain(
      "You do not have permission to create metric pipeline rules.",
    );
  });

  test("each rule's notice and list", () => {
    expect(getRulesRoute("metric").toString()).toBe(
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );
    expect(getRulesRoute("log").toString()).toBe(
      routeFor(PageMap.LOGS_SETTINGS_SCRUB_RULES),
    );
    expect(getRulesRoute("trace").toString()).toBe(
      routeFor(PageMap.TRACES_SETTINGS_SCRUB_RULES),
    );
    expect(SCRUB_NOTICES.metric).toBe(
      "The metric pipeline rule {{name}} now redacts this data in new metrics.",
    );
  });
});

describe("a metric's data point opens in the metrics explorer", () => {
  function queryOf(route: Route): Record<string, string> {
    const search: string = route.toString().split("?")[1] || "";
    const params: Record<string, string> = {};

    for (const [key, value] of new URLSearchParams(search)) {
      params[key] = value;
    }

    return params;
  }

  test("on its metric, of its service, split by the attribute the data is under, in the half hour around it", () => {
    const route: Route = getOccurrenceMetricsRoute(METRIC_POINT)!;
    const params: Record<string, string> = queryOf(route);
    const time: number = new Date(METRIC_POINT.time).getTime();

    expect(route.toString().split("?")[0]).toBe(routeFor(PageMap.METRIC_VIEW));
    expect(JSON.parse(params["metricQueries"]!)).toEqual([
      {
        metricName: "user.logins",
        serviceIds: [SERVICE_ID],
        groupByAttributeKeys: ["user.email"],
      },
    ]);
    expect(new Date(params["startTime"]!).getTime()).toBe(
      time - METRIC_WINDOW_IN_MINUTES * 60 * 1000,
    );
    expect(new Date(params["endTime"]!).getTime()).toBe(
      time + METRIC_WINDOW_IN_MINUTES * 60 * 1000,
    );
    // Never a value: the attribute's key only.
    expect(route.toString()).not.toContain("a********");
  });

  test("a point whose metric's name holds data names no metric: its service's metrics open", () => {
    const route: Route = getOccurrenceMetricsRoute({
      ...METRIC_POINT,
      name: "s***@a********.count",
      metricName: undefined,
    })!;

    expect(route.toString()).toBe(
      recordRoute(PageMap.SERVICE_VIEW_METRICS, SERVICE_ID),
    );
  });

  test("no time or service, no link; a metric's point has the one link", () => {
    expect(
      getOccurrenceMetricsRoute({ ...METRIC_POINT, time: "never" }),
    ).toBeNull();
    expect(
      getOccurrenceMetricsRoute({ ...METRIC_POINT, serviceId: undefined }),
    ).toBeNull();
    expect(
      getOccurrenceLinks(METRIC_POINT).map((link: OccurrenceLink) => {
        return link.kind;
      }),
    ).toEqual([OccurrenceLinkKind.Metrics]);
  });

  test("a metrics store's service opens at its Metrics", () => {
    expect(
      getTelemetryStoreOwnerRoute({
        kind: DataStoreKind.TelemetryMetrics,
        serviceId: SERVICE_ID,
      })?.toString(),
    ).toBe(recordRoute(PageMap.SERVICE_VIEW_METRICS, SERVICE_ID));
  });

  test("the records list draws it as a metric, with its name, its line and the link", async () => {
    render(
      <MemoryRouter>
        <FindingOccurrences
          findingId={new ObjectID(METRIC_FINDING_ID)}
          ownerName="checkout"
        />
      </MemoryRouter>,
    );

    const record: HTMLElement = await screen.findByTestId(
      "data-security-finding-occurrence",
    );

    expect(within(record).getByText("Metric")).toBeInTheDocument();
    expect(within(record).getByText("user.logins")).toBeInTheDocument();
    expect(
      within(record).getByTestId("data-security-finding-occurrence-excerpt"),
    ).toHaveTextContent("user.email: j***@a********.com");
    expect(
      within(record).getByRole("link", { name: /Open in Metrics/ }),
    ).toBeInTheDocument();
  });
});

// The route of a page of a record, by its id.
function recordRoute(page: PageMap, id: string): string {
  return routeFor(page).replace(":id", id);
}

describe("an issue's Where It Was Found, on a service's metrics", () => {
  function renderCard(findingsOfStore: Array<DataStoreFinding>): void {
    const store: DataStore = storeOf(
      METRICS_STORE_ID,
      DataStoreKind.TelemetryMetrics,
    );
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());

    issue.checkId = "sensitive-data-in-telemetry";
    issue.dataStoreId = new ObjectID(METRICS_STORE_ID);
    issue.dataStore = store;
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: findingsOfStore,
      count: findingsOfStore.length,
      skip: 0,
      limit: 100,
    } as never);

    render(
      <MemoryRouter>
        <IssueTelemetryFindings
          issue={issue}
          store={store}
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );
  }

  test("says it is in the metrics of its service, and Scrub It makes the metric pipeline rule", async () => {
    renderCard([findingOf(METRIC_FINDING_ID, METRICS_STORE_ID)]);

    expect(
      await screen.findByTestId("data-security-issue-findings-owner"),
    ).toHaveTextContent("In the metrics of checkout");

    fireEvent.click(
      await screen.findByTestId("data-security-issue-finding-scrub"),
    );
    // The question says what is made: a metric pipeline rule that redacts.
    expect(
      await screen.findByText(/adds a metric pipeline rule that redacts/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Scrub It",
      }),
    );

    const notice: HTMLElement = await screen.findByTestId(
      "data-security-issue-findings-scrub-notice",
    );

    expect(scrubSpy).toHaveBeenCalledWith(new ObjectID(METRIC_FINDING_ID));
    expect(notice).toHaveTextContent(
      "The metric pipeline rule Data Security: Email address in attributes.user.email now redacts this data in new metrics.",
    );
    expect(
      within(notice).getByRole("link", { name: "View pipeline rules" }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );
  });

  test("a metric's name has no Scrub It: why it cannot be, where the button would be", async () => {
    renderCard([
      findingOf(NAME_FINDING_ID, METRICS_STORE_ID, {
        location: "name",
        locationKind: "Field",
      }),
    ]);

    expect(
      await screen.findByTestId("data-security-finding-scrub-unavailable"),
    ).toHaveTextContent(
      SCRUB_UNAVAILABLE_SENTENCES[TelemetryScrubUnavailableReason.MetricName],
    );
    expect(
      screen.queryByTestId("data-security-issue-finding-scrub"),
    ).not.toBeInTheDocument();
  });
});

describe("a finding's records panel", () => {
  function renderPanel(data: {
    finding: DataStoreFinding;
    store: DataStore;
    scrubIt: ScrubItState;
    scrubError?: string;
    onScrub?: () => void;
  }): { onClose: Mock<() => void> } {
    const onClose: Mock<() => void> = jest.fn<() => void>();

    render(
      <MemoryRouter>
        <FindingRecordsPanel
          finding={data.finding}
          store={data.store}
          scrubIt={data.scrubIt}
          isScrubbing={false}
          scrubError={data.scrubError}
          onScrub={data.onScrub || (() => {})}
          onClose={onClose}
        />
      </MemoryRouter>,
    );

    return { onClose };
  }

  const metricsStore: () => DataStore = (): DataStore => {
    return storeOf(METRICS_STORE_ID, DataStoreKind.TelemetryMetrics);
  };

  test("says what was found and where, reads its records, and Scrub It is its action", async () => {
    const onScrub: Mock<() => void> = jest.fn<() => void>();

    renderPanel({
      finding: findingOf(METRIC_FINDING_ID, METRICS_STORE_ID),
      store: metricsStore(),
      scrubIt: getScrubItState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "attributes.user.email",
        gates: getScrubItGates(),
      }),
      onScrub,
    });

    const panel: HTMLElement = await screen.findByTestId(
      FINDING_RECORDS_PANEL_TEST_ID,
    );

    expect(screen.getByText("Where It Was Found")).toBeInTheDocument();
    expect(within(panel).getByText("Email address")).toBeInTheDocument();
    expect(
      within(panel).getByTestId("data-security-issue-finding-location"),
    ).toHaveTextContent("attributes.user.email");
    expect(
      within(panel).getByTestId("data-security-issue-findings-owner"),
    ).toHaveTextContent("In the metrics of checkout");
    expect(
      await within(panel).findByTestId("data-security-finding-occurrence"),
    ).toHaveTextContent("user.logins");
    expect(occurrencesSpy).toHaveBeenCalledWith(
      new ObjectID(METRIC_FINDING_ID),
    );

    fireEvent.click(screen.getByRole("button", { name: "Scrub It" }));
    expect(onScrub).toHaveBeenCalledTimes(1);
  });

  test("its samples when no record is left to show", async () => {
    occurrences = { ...occurrences, occurrences: [] };

    renderPanel({
      finding: findingOf(METRIC_FINDING_ID, METRICS_STORE_ID),
      store: metricsStore(),
      scrubIt: getScrubItState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "attributes.user.email",
        gates: getScrubItGates(),
      }),
    });

    expect(
      await screen.findByTestId("data-security-issue-finding-samples"),
    ).toHaveTextContent("j***@a********.com");
  });

  test("a metric's name: why it cannot be scrubbed, and no Scrub It", async () => {
    renderPanel({
      finding: findingOf(NAME_FINDING_ID, METRICS_STORE_ID, {
        location: "name",
      }),
      store: metricsStore(),
      scrubIt: getScrubItState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "name",
        gates: getScrubItGates(),
      }),
    });

    expect(
      await screen.findByTestId("data-security-finding-scrub-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scrub It" }),
    ).not.toBeInTheDocument();
  });

  test("a reader who may not make the rule is told why, with no button; a failed Scrub It says why", async () => {
    grant(METRIC_RULE_MAKER);
    PermissionGate.clearPermissionPropsCache();
    renderPanel({
      finding: findingOf(LOG_FINDING_ID, LOGS_STORE_ID, { location: "body" }),
      store: storeOf(LOGS_STORE_ID, DataStoreKind.TelemetryLogs),
      scrubIt: getScrubItState({
        kind: DataStoreKind.TelemetryLogs,
        location: "body",
        gates: getScrubItGates(),
      }),
      scrubError: "The scrub rule was not saved.",
    });

    expect(
      await screen.findByTestId("data-security-finding-records-scrub-locked"),
    ).toHaveTextContent("You do not have permission to create scrub rules.");
    expect(
      screen.queryByRole("button", { name: "Scrub It" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("data-security-finding-records-scrub-error"),
    ).toHaveTextContent("The scrub rule was not saved.");
  });

  test("a scrubbed finding offers nothing to scrub", async () => {
    renderPanel({
      finding: findingOf(METRIC_FINDING_ID, METRICS_STORE_ID, {
        isScrubbed: true,
      }),
      store: metricsStore(),
      scrubIt: getScrubItState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "attributes.user.email",
        gates: getScrubItGates(),
      }),
    });

    await screen.findByTestId(FINDING_RECORDS_PANEL_TEST_ID);
    expect(
      screen.queryByRole("button", { name: "Scrub It" }),
    ).not.toBeInTheDocument();
  });
});

describe("In Your Telemetry", () => {
  test("each row's Show Records is its button, and opens that finding's records beside the list", async () => {
    renderPage();

    const row: HTMLElement = await rowOf(METRIC_FINDING_ID);
    const showRecords: HTMLElement = within(row).getByRole("button", {
      name: "Show Records",
    });

    expect(showRecords).toHaveAttribute("data-placement", "Primary");

    fireEvent.click(showRecords);

    const panel: HTMLElement = await screen.findByTestId(
      FINDING_RECORDS_PANEL_TEST_ID,
    );

    expect(occurrencesSpy).toHaveBeenCalledWith(
      new ObjectID(METRIC_FINDING_ID),
    );
    expect(
      await within(panel).findByTestId("data-security-finding-occurrence"),
    ).toHaveTextContent("user.logins");
    expect(
      within(panel).getByTestId("data-security-issue-findings-owner"),
    ).toHaveTextContent("In the metrics of checkout");
    // The samples are read with the list, for the reader who may read them.
    expect(mockTableProps!.selectMoreFields).toMatchObject({
      maskedSamples: true,
      valueCount: true,
    });
  });

  test("the panel's Scrub It makes the rule, closes, and the page says which rule it made", async () => {
    renderPage();
    fireEvent.click(
      within(await rowOf(METRIC_FINDING_ID)).getByRole("button", {
        name: "Show Records",
      }),
    );
    await screen.findByTestId(FINDING_RECORDS_PANEL_TEST_ID);
    fireEvent.click(
      within(
        screen
          .getByTestId(FINDING_RECORDS_PANEL_TEST_ID)
          .closest("[role='dialog']") as HTMLElement,
      ).getByRole("button", { name: "Scrub It" }),
    );

    const notice: HTMLElement = await screen.findByTestId(
      "data-security-scrub-notice",
    );

    expect(scrubSpy).toHaveBeenCalledWith(new ObjectID(METRIC_FINDING_ID));
    expect(notice).toHaveTextContent(
      "The metric pipeline rule Data Security: Email address in attributes.user.email now redacts this data in new metrics.",
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId(FINDING_RECORDS_PANEL_TEST_ID),
      ).not.toBeInTheDocument();
    });
    // The list is read again.
    expect(mockTableProps!.refreshToggle).toBe("1");
  });

  test("Scrub It on a metric's name is locked, saying why", async () => {
    renderPage();

    const scrub: HTMLElement = within(await rowOf(NAME_FINDING_ID)).getByRole(
      "button",
      { name: "Scrub It" },
    );

    expect(scrub).toBeDisabled();
    expect(scrub).toHaveAttribute(
      "data-tooltip",
      SCRUB_UNAVAILABLE_SENTENCES[TelemetryScrubUnavailableReason.MetricName],
    );
    expect(
      within(await rowOf(METRIC_FINDING_ID)).getByRole("button", {
        name: "Scrub It",
      }),
    ).not.toBeDisabled();
  });

  test("a reader who makes metric pipeline rules scrubs a metric's attribute, and a log line's Scrub It is locked for them", async () => {
    grant(METRIC_RULE_MAKER);
    PermissionGate.clearPermissionPropsCache();
    renderPage();

    expect(
      within(await rowOf(METRIC_FINDING_ID)).getByRole("button", {
        name: "Scrub It",
      }),
    ).not.toBeDisabled();
    expect(
      within(await rowOf(LOG_FINDING_ID)).getByRole("button", {
        name: "Scrub It",
      }),
    ).toBeDisabled();
  });

  test("a Security Viewer, who reads no sample or record, is offered no Show Records, and Scrub It locked", async () => {
    grant(VIEWER);
    PermissionGate.clearPermissionPropsCache();
    renderPage();

    const row: HTMLElement = await rowOf(METRIC_FINDING_ID);

    expect(
      within(row).queryByRole("button", { name: "Show Records" }),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Scrub It" }),
    ).toBeDisabled();
    expect(mockTableProps!.selectMoreFields).not.toHaveProperty(
      "maskedSamples",
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("the page reads each telemetry store with what its records panel needs, metrics among them", async () => {
    const listSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "getList",
    );

    renderPage();
    await rowOf(METRIC_FINDING_ID);

    const storesRead: JSONObject = (
      listSpy.mock.calls[0]![0] as { query: JSONObject; select: JSONObject }
    ).select;

    expect(storesRead).toMatchObject({
      serviceId: true,
      storeKey: true,
      kind: true,
    });
    expect(
      JSON.stringify(
        (listSpy.mock.calls[0]![0] as { query: JSONObject }).query,
      ),
    ).toContain(DataStoreKind.TelemetryMetrics);
  });
});
