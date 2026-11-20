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
import DropMetricModal, {
  countSentence,
  DROP_METRIC_MODAL_TEST_ID,
  DROP_UNAVAILABLE_SENTENCES,
  MAX_METRIC_USERS_SHOWN,
  MAX_WIDGETS_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DropMetricModal";
import FindingRecordsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingRecordsPanel";
import {
  getMetricRecordingRulesRoute,
  METRIC_RECORDING_RULES_OUTPUT_FILTER_KEY,
  METRIC_RECORDING_RULES_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RecordingRule/RecordingRulesRoute";
import IssueTelemetryFindings, {
  FindingSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings";
import {
  DROP_METRIC,
  DROPPED,
  getDropMetricState,
  getScrubItGates,
  getScrubItState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryScrubIt";
import DataSecurityTelemetryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Telemetry";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityDropMetricImpact,
  DataSecurityDropMetricResult,
  DataSecurityDropMetricUnavailableReason,
  DataSecurityMetricUser,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { createTranslator, Translator } from "../../../Types/Translator";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import API from "../../../UI/Utils/API/API";
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
 * DROP THIS METRIC (#9757).
 *
 * No rule takes the data out of a metric's name, so a finding there could
 * only say "rename the metric" while the data kept arriving. Drop This
 * Metric makes a metric pipeline rule that drops the service's metrics so
 * named - their new data points lost for good - and so it is deliberate:
 * offered only on a finding in a metric's name, to a reader who may create
 * metric pipeline rules (locked, saying why, for one who may not), in a
 * dialog that says first that the points are lost for good, how many
 * metrics it drops, what reads them - monitors, dashboards with their
 * widgets, SLOs and recording rules (#9946), each kind saying what happens
 * to it, each record a link, and the ones the reader can't see counted,
 * never named - that what is stored stays and how to undo it - its button
 * locked until the reader ticks that they understand. Once made, the page
 * names the rule, which opens the pipeline rules, and the finding reads
 * Dropped.
 *
 * In Your Telemetry's ModelTable is a stand-in that draws the rows with
 * their row actions, as DataSecurityTelemetryFindingRecords.test.tsx does.
 */

configure({ asyncUtilTimeout: 15000 });

const SERVICE_ID: string = "1a1a1a1a-0000-4000-8000-0000000000a1";
const METRICS_STORE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000c4";
const LOGS_STORE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000c3";
const NAME_FINDING_ID: string = "6f6f6f6f-0000-4000-8000-0000000000f6";
const ATTRIBUTE_FINDING_ID: string = "5e5e5e5e-0000-4000-8000-0000000000e5";
const MONITOR_ID: string = "7a7a7a7a-0000-4000-8000-0000000000a7";
const DASHBOARD_ID: string = "8b8b8b8b-0000-4000-8000-0000000000b8";
const WIDGET_ID: string = "8b8b8b8b-0000-4000-8000-0000000000c8";
const SLO_ID: string = "9d9d9d9d-0000-4000-8000-0000000000d9";
const RECORDING_RULE_ID: string = "9e9e9e9e-0000-4000-8000-0000000000e9";
const RULE_NAME: string =
  "Data Security: drop metrics named with Email address";

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

// Reads what was found and where; makes no rule.
const VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityViewer,
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
  PermissionGate.clearPermissionPropsCache();
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
  finding.maskedSamples = ["s***@a********.count"];
  Object.assign(finding, overrides);
  return finding;
}

function nameFinding(
  overrides: Partial<DataStoreFinding> = {},
): DataStoreFinding {
  return findingOf(NAME_FINDING_ID, METRICS_STORE_ID, {
    location: "name",
    locationKind: "Field",
    ...overrides,
  });
}

function impactOf(
  overrides: Partial<DataSecurityDropMetricImpact> = {},
): DataSecurityDropMetricImpact {
  return {
    isAvailable: true,
    ruleName: RULE_NAME,
    metricsMatched: 3,
    isMetricsMatchedCapped: false,
    metricsCounted: true,
    monitors: [{ id: MONITOR_ID, name: "Signups of Jane" }],
    dashboards: [
      {
        id: DASHBOARD_ID,
        name: "Growth",
        widgets: [
          { id: WIDGET_ID, title: "Signups by plan", type: "Chart" },
          { id: ObjectID.generate().toString(), title: "", type: "Value" },
        ],
      },
    ],
    slos: [{ id: SLO_ID, name: "Signup success" }],
    recordingRules: [
      {
        id: RECORDING_RULE_ID,
        name: "Signup rate",
        outputMetricName: "signup_rate",
      },
    ],
    monitorsChecked: true,
    dashboardsChecked: true,
    slosChecked: true,
    recordingRulesChecked: true,
    monitorsHidden: 0,
    dashboardsHidden: 0,
    slosHidden: 0,
    recordingRulesHidden: 0,
    ...overrides,
  };
}

// Nothing reads them, every kind checked.
const NO_READERS: Partial<DataSecurityDropMetricImpact> = {
  monitors: [],
  dashboards: [],
  slos: [],
  recordingRules: [],
};

function viewRoute(page: PageMap, id: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(id),
  }).toString();
}

let impact: DataSecurityDropMetricImpact;
let impactSpy: SpyInstance<typeof DataSecurityApi.getDropMetricImpact>;
let dropSpy: SpyInstance<typeof DataSecurityApi.dropMetric>;
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
                          data-style={action.buttonStyleType}
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
                {(props.columns || []).map(
                  (column: { title?: string; getElement?: unknown }) => {
                    if (column.title !== "Scrubbed" || !column.getElement) {
                      return null;
                    }

                    return (
                      <span key={column.title} data-testid={`scrubbed-${id}`}>
                        {(
                          column.getElement as (
                            row: DataStoreFinding,
                          ) => React.ReactElement
                        )(row)}
                      </span>
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

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/telemetry`);
  grant(OWNER);
  mockTableProps = null;
  mockRows = [];
  impact = impactOf();
  impactSpy = jest
    .spyOn(DataSecurityApi, "getDropMetricImpact")
    .mockImplementation(async () => {
      return impact;
    });
  dropSpy = jest.spyOn(DataSecurityApi, "dropMetric").mockResolvedValue({
    ruleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
    ruleName: RULE_NAME,
  });
  jest.spyOn(DataSecurityApi, "getFindingOccurrences").mockResolvedValue({
    occurrences: [],
    since: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    until: new Date().toISOString(),
    recordsRead: 0,
    isComplete: true,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderModal(
  props: {
    onClose?: () => void;
    onDropped?: (result: DataSecurityDropMetricResult) => void;
  } = {},
): void {
  render(
    <MemoryRouter>
      <DropMetricModal
        findingId={new ObjectID(NAME_FINDING_ID)}
        dataTypeName="Email address"
        serviceName="checkout"
        onClose={props.onClose || (() => {})}
        onDropped={props.onDropped || (() => {})}
      />
    </MemoryRouter>,
  );
}

function submitButton(): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: "Drop These Metrics",
  });
}

describe("Drop This Metric is offered on a metric's name, to whoever may make the rule", () => {
  test("only a finding in a metric's name, and none in its attributes or in logs", () => {
    const gates: ReturnType<typeof getScrubItGates> = getScrubItGates();

    expect(
      getDropMetricState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "name",
        gates,
      }),
    ).toEqual({ isShown: true, isAllowed: true, disabledReason: undefined });

    for (const [kind, location] of [
      [DataStoreKind.TelemetryMetrics, "attributes.user.email"],
      [DataStoreKind.TelemetryLogs, "name"],
      [DataStoreKind.TelemetryTraces, "name"],
    ] as Array<[DataStoreKind, string]>) {
      expect(getDropMetricState({ kind, location, gates }).isShown).toBe(false);
    }
  });

  test("a reader who may not create metric pipeline rules sees it locked, saying why", () => {
    grant(VIEWER);

    expect(
      getDropMetricState({
        kind: DataStoreKind.TelemetryMetrics,
        location: "name",
        gates: getScrubItGates(),
      }),
    ).toEqual({
      isShown: true,
      isAllowed: false,
      disabledReason:
        "You do not have permission to create metric pipeline rules. You need this permission: Create Metric Pipeline Rule.",
    });
  });
});

describe("the dialog says what dropping loses, before it does", () => {
  test("lost for good first, then how many metrics, who reads them, what stays and how to undo it", async () => {
    renderModal();

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Drop This Metric" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "OneUptime adds a metric pipeline rule that drops new data points of the metrics of checkout whose names hold Email address.",
    );
    expect(
      await within(dialog).findByTestId("data-security-drop-metric-lost"),
    ).toHaveTextContent(
      "From now on, their new data points are lost for good: they are never stored, and deleting the rule later does not bring them back.",
    );
    expect(impactSpy).toHaveBeenCalledWith(new ObjectID(NAME_FINDING_ID));
    expect(
      within(dialog).getByTestId("data-security-drop-metric-count"),
    ).toHaveTextContent("3 metrics written in the last day have such a name.");

    // Everything that reads them, kind by kind, each saying what happens to it.
    const users: HTMLElement = within(dialog).getByTestId(
      "data-security-drop-metric-users",
    );

    expect(users).toHaveTextContent(
      "What reads those metrics gets no new data from them:",
    );

    const monitors: HTMLElement = within(users).getByTestId(
      "data-security-drop-metric-monitors",
    );

    expect(monitors).toHaveTextContent("Monitors");
    expect(monitors).toHaveTextContent(
      "They get no new data from those metrics, so they can no longer alert on their values.",
    );
    expect(
      within(monitors).getByRole("link", { name: "Signups of Jane" }),
    ).toHaveAttribute("href", viewRoute(PageMap.MONITOR_VIEW, MONITOR_ID));

    // A dashboard opens it, with the widgets on it that read them named under it.
    const dashboards: HTMLElement = within(users).getByTestId(
      "data-security-drop-metric-dashboards",
    );

    expect(dashboards).toHaveTextContent(
      "The widgets named under each show no new data from those metrics.",
    );
    expect(
      within(dashboards).getByRole("link", { name: "Growth" }),
    ).toHaveAttribute("href", viewRoute(PageMap.DASHBOARD_VIEW, DASHBOARD_ID));
    expect(
      within(dashboards).getByTestId("data-security-drop-metric-widgets"),
    ).toHaveTextContent(/Signups by plan.*Value/);

    const slos: HTMLElement = within(users).getByTestId(
      "data-security-drop-metric-slos",
    );

    expect(slos).toHaveTextContent("SLOs");
    expect(slos).toHaveTextContent(
      "They count no new events from those metrics, so their error budgets no longer include them.",
    );
    expect(
      within(slos).getByRole("link", { name: "Signup success" }),
    ).toHaveAttribute("href", viewRoute(PageMap.SLO_VIEW, SLO_ID));

    // A recording rule has no page: its list, filtered to the metric it writes.
    const rules: HTMLElement = within(users).getByTestId(
      "data-security-drop-metric-recording-rules",
    );

    expect(rules).toHaveTextContent("Recording Rules");
    expect(rules).toHaveTextContent(
      "They get no new points from those metrics, so their output metrics no longer include them.",
    );
    expect(
      within(rules).getByRole("link", { name: "Signup rate" }),
    ).toHaveAttribute(
      "href",
      getMetricRecordingRulesRoute("signup_rate").toString(),
    );
    // Nobody hidden, nothing unchecked.
    expect(users).not.toHaveTextContent("you can't see");
    expect(users).not.toHaveTextContent("could not be checked");

    expect(
      within(dialog).getByTestId("data-security-drop-metric-stored"),
    ).toHaveTextContent(
      "What is stored already is not deleted. It stays until its retention ends.",
    );

    const undo: HTMLElement = within(dialog).getByTestId(
      "data-security-drop-metric-undo",
    );

    expect(undo).toHaveTextContent(
      "To store them again, delete the rule from the metric pipeline rules.",
    );
    expect(
      within(undo).getByRole("link", { name: "metric pipeline rules" }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );

    // No metric's name anywhere: they hold the data.
    expect(dialog).not.toHaveTextContent("@");
  });

  test("the button stays locked until the reader ticks that the points are lost for good; then it drops, once", async () => {
    const onDropped: Mock<(result: DataSecurityDropMetricResult) => void> =
      jest.fn<(result: DataSecurityDropMetricResult) => void>();

    renderModal({ onDropped });
    await screen.findByTestId("data-security-drop-metric-lost");

    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(dropSpy).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByLabelText(
        "I understand that these data points are lost for good",
      ),
    );
    expect(submitButton()).not.toBeDisabled();
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onDropped).toHaveBeenCalledWith({
        ruleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
        ruleName: RULE_NAME,
      });
    });
    expect(dropSpy).toHaveBeenCalledTimes(1);
    expect(dropSpy).toHaveBeenCalledWith(new ObjectID(NAME_FINDING_ID));
  });

  test("a drop the server refuses says why in the dialog, which stays open", async () => {
    const onDropped: Mock<(result: DataSecurityDropMetricResult) => void> =
      jest.fn<(result: DataSecurityDropMetricResult) => void>();

    dropSpy.mockRejectedValue(
      new Error("You do not have permission to create metric pipeline rules."),
    );
    renderModal({ onDropped });
    await screen.findByTestId("data-security-drop-metric-lost");
    fireEvent.click(
      screen.getByLabelText(
        "I understand that these data points are lost for good",
      ),
    );
    fireEvent.click(submitButton());

    expect(
      await within(screen.getByRole("dialog")).findByText(
        /You do not have permission to create metric pipeline rules/,
      ),
    ).toBeInTheDocument();
    expect(onDropped).not.toHaveBeenCalled();
    expect(screen.getByTestId(DROP_METRIC_MODAL_TEST_ID)).toBeInTheDocument();
  });

  test("nothing reads them: one line says so, naming every kind it looked at", async () => {
    impact = impactOf(NO_READERS);
    renderModal();

    const users: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-users",
    );

    expect(users).toHaveTextContent(
      "No monitor, dashboard, SLO or recording rule reads those metrics.",
    );
    expect(users).not.toHaveTextContent(
      "What reads those metrics gets no new data from them:",
    );

    for (const kind of ["monitors", "dashboards", "slos", "recording-rules"]) {
      expect(
        screen.queryByTestId(`data-security-drop-metric-${kind}`),
      ).not.toBeInTheDocument();
    }
  });

  test("a kind that could not be checked says so, never that none reads them", async () => {
    impact = impactOf({
      ...NO_READERS,
      slosChecked: false,
      recordingRulesChecked: false,
    });
    renderModal();

    const users: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-users",
    );

    // Never "none" when nobody could look.
    expect(users).not.toHaveTextContent("No monitor, dashboard");
    expect(
      within(users).getByTestId("data-security-drop-metric-slos-unchecked"),
    ).toHaveTextContent(
      "Whether an SLO reads those metrics could not be checked.",
    );
    expect(
      within(users).getByTestId(
        "data-security-drop-metric-recording-rules-unchecked",
      ),
    ).toHaveTextContent(
      "Whether a recording rule reads those metrics could not be checked.",
    );
    expect(
      within(users).queryByTestId(
        "data-security-drop-metric-monitors-unchecked",
      ),
    ).not.toBeInTheDocument();

    // Each kind's own words.
    cleanup();
    impact = impactOf({
      ...NO_READERS,
      monitorsChecked: false,
      dashboardsChecked: false,
    });
    renderModal();

    const others: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-users",
    );

    expect(others).toHaveTextContent(
      "Whether a monitor reads those metrics could not be checked.",
    );
    expect(others).toHaveTextContent(
      "Whether a dashboard reads those metrics could not be checked.",
    );
  });

  test("many read them: each kind names the first few, each a link, and counts the rest", async () => {
    const usersNamed: (prefix: string) => Array<DataSecurityMetricUser> = (
      prefix: string,
    ): Array<DataSecurityMetricUser> => {
      return Array.from(
        { length: MAX_METRIC_USERS_SHOWN + 3 },
        (_: unknown, index: number): DataSecurityMetricUser => {
          return {
            id: ObjectID.generate().toString(),
            name: `${prefix} ${index}`,
            outputMetricName: `${prefix.toLowerCase()}_${index}`,
          };
        },
      );
    };

    impact = impactOf({
      monitors: usersNamed("Monitor"),
      dashboards: usersNamed("Dashboard"),
      slos: usersNamed("SLO"),
      recordingRules: usersNamed("Rule"),
    });
    renderModal();

    for (const kind of ["monitors", "dashboards", "slos", "recording-rules"]) {
      const shown: HTMLElement = await screen.findByTestId(
        `data-security-drop-metric-${kind}`,
      );

      expect(within(shown).getAllByRole("link")).toHaveLength(
        MAX_METRIC_USERS_SHOWN,
      );
      expect(shown).toHaveTextContent("and 3 more");
      expect(shown).not.toHaveTextContent("you can't see");
    }

    expect(
      within(screen.getByTestId("data-security-drop-metric-slos")).getByRole(
        "link",
        { name: "SLO 0" },
      ),
    ).toHaveAttribute("href", viewRoute(PageMap.SLO_VIEW, impact.slos[0]!.id));
  });

  test("ones the reader can't see are counted, never named: after the ones they can, or on their own", async () => {
    impact = impactOf({
      monitorsHidden: 2,
      dashboards: [],
      dashboardsHidden: 1,
      slos: [],
      slosHidden: 4,
      recordingRules: [],
      recordingRulesHidden: 0,
    });
    renderModal();

    const users: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-users",
    );

    // After the monitors they can see.
    expect(
      within(users).getByTestId("data-security-drop-metric-monitors-hidden"),
    ).toHaveTextContent("and 2 more you can't see");
    expect(
      within(
        within(users).getByTestId("data-security-drop-metric-monitors"),
      ).getAllByRole("link"),
    ).toHaveLength(1);
    // None they can see: the kind counted on its own, by its own noun.
    expect(
      within(users).getByTestId("data-security-drop-metric-dashboards-hidden"),
    ).toHaveTextContent("1 dashboard you can't see");
    expect(
      within(users).getByTestId("data-security-drop-metric-slos-hidden"),
    ).toHaveTextContent("4 SLOs you can't see");
    expect(
      within(
        within(users).getByTestId("data-security-drop-metric-slos"),
      ).queryAllByRole("link"),
    ).toHaveLength(0);
    // Still what happens to them.
    expect(
      within(users).getByTestId("data-security-drop-metric-slos"),
    ).toHaveTextContent(
      "They count no new events from those metrics, so their error budgets no longer include them.",
    );
    expect(
      screen.queryByTestId("data-security-drop-metric-recording-rules"),
    ).not.toBeInTheDocument();
    // Hidden ones read them too: never "none".
    expect(users).toHaveTextContent(
      "What reads those metrics gets no new data from them:",
    );

    // Only hidden ones, of every kind.
    cleanup();
    impact = impactOf({
      ...NO_READERS,
      monitorsHidden: 1,
      recordingRulesHidden: 3,
    });
    renderModal();

    const hidden: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-users",
    );

    expect(hidden).toHaveTextContent("1 monitor you can't see");
    expect(hidden).toHaveTextContent("3 recording rules you can't see");
    expect(hidden).not.toHaveTextContent("No monitor, dashboard");
    expect(within(hidden).queryAllByRole("link")).toHaveLength(0);
  });

  test("a dashboard's widgets under it: each by its title as written, one without by its kind, the rest counted", async () => {
    const widgets: Array<{ id: string; title: string; type: string }> = [
      { id: ObjectID.generate().toString(), title: "", type: "Gauge" },
      {
        id: ObjectID.generate().toString(),
        title: "p99 <checkout>",
        type: "Chart",
      },
      // A kind the catalog does not know, and no title.
      { id: ObjectID.generate().toString(), title: "", type: "" },
      ...Array.from(
        { length: MAX_WIDGETS_SHOWN },
        (_: unknown, index: number) => {
          return {
            id: ObjectID.generate().toString(),
            title: `Widget ${index}`,
            type: "Chart",
          };
        },
      ),
    ];

    impact = impactOf({
      dashboards: [{ id: DASHBOARD_ID, name: "Growth", widgets }],
    });
    renderModal();

    const shown: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-widgets",
    );

    expect(shown).toHaveTextContent(
      "Gauge, p99 <checkout>, Untitled, Widget 0, Widget 1, and 3 more",
    );
    // The dashboard is the link; its widgets are named, not linked again.
    expect(
      within(
        screen.getByTestId("data-security-drop-metric-dashboards"),
      ).getAllByRole("link"),
    ).toHaveLength(1);

    // A dashboard that reads them outside its widgets: its link alone.
    cleanup();
    impact = impactOf({
      dashboards: [{ id: DASHBOARD_ID, name: "Variables", widgets: [] }],
    });
    renderModal();

    expect(
      await screen.findByRole("link", { name: "Variables" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-drop-metric-widgets"),
    ).not.toBeInTheDocument();
  });

  test("a recording rule opens its list filtered to it, by the list's own Output Metric filter", () => {
    const route: string =
      getMetricRecordingRulesRoute("signup_rate").toString();
    const query: URLSearchParams = new URLSearchParams(route.split("?")[1]);

    expect(route.split("?")[0]).toBe(
      routeFor(PageMap.METRICS_SETTINGS_RECORDING_RULES),
    );
    expect(
      JSON.parse(query.get(`${METRIC_RECORDING_RULES_TABLE_ID}-filter`)!),
    ).toEqual({ [METRIC_RECORDING_RULES_OUTPUT_FILTER_KEY]: "signup_rate" });
    // The list's own key, and the filter it offers.
    expect(METRIC_RECORDING_RULES_TABLE_ID).toBe(
      "metric-recording-rules-table",
    );
    // No output metric: the list itself.
    expect(getMetricRecordingRulesRoute().toString()).toBe(
      routeFor(PageMap.METRICS_SETTINGS_RECORDING_RULES),
    );
  });

  test("a finding no rule can drop says why, and nothing can be dropped", async () => {
    impact = {
      ...impactOf(),
      isAvailable: false,
      unavailableReason: DataSecurityDropMetricUnavailableReason.NoPattern,
    };
    renderModal();

    expect(
      await screen.findByTestId("data-security-drop-metric-unavailable"),
    ).toHaveTextContent(
      DROP_UNAVAILABLE_SENTENCES[
        DataSecurityDropMetricUnavailableReason.NoPattern
      ],
    );
    expect(
      screen.queryByLabelText(
        "I understand that these data points are lost for good",
      ),
    ).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  test("a rule that already drops them is named, opening the pipeline rules, and nothing is made again", async () => {
    impact = impactOf({
      existingRule: {
        id: ObjectID.generate().toString(),
        name: "Drop emailed",
      },
    });
    renderModal();

    const existing: HTMLElement = await screen.findByTestId(
      "data-security-drop-metric-existing",
    );

    expect(existing).toHaveTextContent(
      "The metric pipeline rule Drop emailed already drops these metrics.",
    );
    expect(
      within(existing).getByRole("link", { name: "Drop emailed" }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );
    expect(submitButton()).toBeDisabled();
  });

  test("what it could not read is said, with a way to read it again", async () => {
    impactSpy.mockRejectedValueOnce(
      new Error("The server could not be reached."),
    );
    renderModal();

    expect(
      await screen.findByText(/The server could not be reached/),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  test("the count says at least, or not known, when it is not the whole count", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(countSentence(impactOf({ metricsMatched: 1 }), english)).toBe(
      "1 metric written in the last day has such a name.",
    );
    expect(
      countSentence(
        impactOf({ metricsMatched: 4, isMetricsMatchedCapped: true }),
        english,
      ),
    ).toBe("At least 4 metrics written in the last day have such a name.");
    expect(countSentence(impactOf({ metricsMatched: 0 }), english)).toBe(
      "No metric written in the last day has such a name yet. The rule drops the ones that come.",
    );
    // More names than were read, none of them such: not "none".
    expect(
      countSentence(
        impactOf({ metricsMatched: 0, isMetricsMatchedCapped: true }),
        english,
      ),
    ).toBe("How many metrics have such a name could not be counted.");
    // The names could not be read at all: not "none" either.
    expect(
      countSentence(
        impactOf({ metricsMatched: 0, metricsCounted: false }),
        english,
      ),
    ).toBe("How many metrics have such a name could not be counted.");
  });
});

describe("an issue's Where It Was Found, on a metric's name", () => {
  let onChanged: Mock<() => void>;

  function renderCard(findings: Array<DataStoreFinding>): void {
    const store: DataStore = storeOf(
      METRICS_STORE_ID,
      DataStoreKind.TelemetryMetrics,
    );
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());

    issue.checkId = "sensitive-data-in-telemetry";
    issue.dataStoreId = new ObjectID(METRICS_STORE_ID);
    issue.dataStore = store;
    onChanged = jest.fn<() => void>();
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: findings,
      count: findings.length,
      skip: 0,
      limit: 100,
    } as never);

    render(
      <MemoryRouter>
        <IssueTelemetryFindings
          issue={issue}
          store={store}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );
  }

  test("Drop This Metric beside why it cannot be scrubbed; dropping names the rule, which opens the pipeline rules", async () => {
    renderCard([nameFinding()]);

    expect(
      await screen.findByTestId("data-security-finding-scrub-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-issue-finding-scrub"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("data-security-issue-finding-drop-metric"),
    );
    await screen.findByTestId("data-security-drop-metric-lost");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "the metrics of checkout whose names hold Email address",
    );
    fireEvent.click(
      screen.getByLabelText(
        "I understand that these data points are lost for good",
      ),
    );
    fireEvent.click(submitButton());

    const notice: HTMLElement = await screen.findByTestId(
      "data-security-issue-findings-drop-notice",
    );

    expect(notice).toHaveTextContent(
      `The metric pipeline rule ${RULE_NAME} now drops these metrics' new data points. Delete it to store them again.`,
    );
    expect(
      within(notice).getByRole("link", { name: RULE_NAME }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );
    expect(within(notice).getAllByRole("link")).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("a Security Viewer sees it locked, saying why, and never opens the dialog", async () => {
    grant(VIEWER);
    renderCard([nameFinding()]);

    const drop: HTMLElement = await screen.findByTestId(
      "data-security-issue-finding-drop-metric",
    );

    expect(drop).toBeDisabled();
    fireEvent.click(drop);
    expect(impactSpy).not.toHaveBeenCalled();
  });

  test("a metric's attribute has Scrub It and no drop; a dropped name says Dropped, not Scrubbed", async () => {
    renderCard([
      findingOf(ATTRIBUTE_FINDING_ID, METRICS_STORE_ID),
      nameFinding({ isScrubbed: true }),
    ]);

    expect(
      await screen.findByTestId("data-security-issue-finding-scrub"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-issue-finding-drop-metric"),
    ).not.toBeInTheDocument();

    const [attribute, name] = screen.getAllByTestId(
      "data-security-issue-finding",
    );

    expect(within(name!).getByText(DROPPED)).toBeInTheDocument();
    expect(within(name!).queryByText("Scrubbed")).not.toBeInTheDocument();
    expect(within(attribute!).queryByText(DROPPED)).not.toBeInTheDocument();
  });
});

describe("a finding's records panel, on a metric's name", () => {
  test("offers Drop This Metric under why it cannot be scrubbed", async () => {
    const onDropMetric: Mock<() => void> = jest.fn<() => void>();
    const finding: DataStoreFinding = nameFinding();

    render(
      <MemoryRouter>
        <FindingRecordsPanel
          finding={finding}
          store={storeOf(METRICS_STORE_ID, DataStoreKind.TelemetryMetrics)}
          scrubIt={getScrubItState({
            kind: DataStoreKind.TelemetryMetrics,
            location: "name",
            gates: getScrubItGates(),
          })}
          isScrubbing={false}
          onScrub={() => {}}
          dropMetric={getDropMetricState({
            kind: DataStoreKind.TelemetryMetrics,
            location: "name",
            gates: getScrubItGates(),
          })}
          onDropMetric={onDropMetric}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("data-security-finding-scrub-unavailable"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("data-security-finding-records-drop-metric"),
    );
    expect(onDropMetric).toHaveBeenCalledTimes(1);
  });

  test("a finding a rule drops already offers nothing more, and says Dropped", async () => {
    render(
      <MemoryRouter>
        <FindingSummary
          finding={nameFinding({ isScrubbed: true })}
          namer={(id: string, name?: string): string => {
            return name || id;
          }}
          storeKind={DataStoreKind.TelemetryMetrics}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(DROPPED)).toBeInTheDocument();
  });
});

describe("In Your Telemetry", () => {
  function renderPage(rows: Array<DataStoreFinding>): void {
    const stores: Array<DataStore> = [
      storeOf(LOGS_STORE_ID, DataStoreKind.TelemetryLogs),
      storeOf(METRICS_STORE_ID, DataStoreKind.TelemetryMetrics),
    ];

    mockRows = rows;
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      data: unknown,
    ): Promise<ListResult<BaseModel>> => {
      const modelType: { new (): BaseModel } = (
        data as { modelType: { new (): BaseModel } }
      ).modelType;
      const found: Array<BaseModel> =
        modelType === DataStore ? [...stores] : [];

      return { data: found, count: found.length, skip: 0, limit: 100 };
    }) as never);

    render(
      <MemoryRouter>
        <DataSecurityTelemetryPage {...({} as PageComponentProps)} />
      </MemoryRouter>,
    );
  }

  async function rowOf(findingId: string): Promise<HTMLElement> {
    return await screen.findByTestId(`row-${findingId}`);
  }

  test("a metric's name has Drop This Metric, drawn as destructive; an attribute does not", async () => {
    renderPage([
      findingOf(ATTRIBUTE_FINDING_ID, METRICS_STORE_ID),
      nameFinding(),
    ]);

    const drop: HTMLElement = within(await rowOf(NAME_FINDING_ID)).getByRole(
      "button",
      { name: DROP_METRIC },
    );

    expect(drop).not.toBeDisabled();
    expect(drop).toHaveAttribute(
      "data-style",
      String(ButtonStyleType.HOVER_DANGER_OUTLINE),
    );
    expect(
      within(await rowOf(ATTRIBUTE_FINDING_ID)).queryByRole("button", {
        name: DROP_METRIC,
      }),
    ).not.toBeInTheDocument();
  });

  test("the row's drop opens the dialog; once dropped, the page names the rule and reads the list again", async () => {
    renderPage([nameFinding()]);
    fireEvent.click(
      within(await rowOf(NAME_FINDING_ID)).getByRole("button", {
        name: DROP_METRIC,
      }),
    );
    await screen.findByTestId("data-security-drop-metric-lost");
    fireEvent.click(
      screen.getByLabelText(
        "I understand that these data points are lost for good",
      ),
    );
    fireEvent.click(submitButton());

    const notice: HTMLElement = await screen.findByTestId(
      "data-security-drop-notice",
    );

    expect(dropSpy).toHaveBeenCalledWith(new ObjectID(NAME_FINDING_ID));
    expect(notice).toHaveTextContent(
      `The metric pipeline rule ${RULE_NAME} now drops these metrics' new data points.`,
    );
    expect(
      within(notice).getByRole("link", { name: RULE_NAME }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.METRICS_SETTINGS_PIPELINE_RULES),
    );
    expect(mockTableProps!.refreshToggle).toBe("1");
  });

  test("a Security Viewer sees the drop locked, saying why", async () => {
    grant(VIEWER);
    renderPage([nameFinding()]);

    const drop: HTMLElement = within(await rowOf(NAME_FINDING_ID)).getByRole(
      "button",
      { name: DROP_METRIC },
    );

    expect(drop).toBeDisabled();
    expect(drop).toHaveAttribute(
      "data-tooltip",
      "You do not have permission to create metric pipeline rules. You need this permission: Create Metric Pipeline Rule.",
    );
  });

  test("a dropped name reads Dropped in the Scrubbed column, offering no drop", async () => {
    renderPage([nameFinding({ isScrubbed: true })]);

    const row: HTMLElement = await rowOf(NAME_FINDING_ID);

    expect(
      within(row).getByTestId(`scrubbed-${NAME_FINDING_ID}`),
    ).toHaveTextContent(DROPPED);
    expect(
      within(row).queryByRole("button", { name: DROP_METRIC }),
    ).not.toBeInTheDocument();
  });
});

describe("the Dashboard's client for the drop", () => {
  let posts: Array<{ url: string; data: JSONObject }>;

  function answer(body: JSONObject | HTTPErrorResponse): void {
    jest.spyOn(API, "post").mockImplementation((async (request: {
      url: URL;
      data: JSONObject;
    }): Promise<unknown> => {
      posts.push({ url: request.url.toString(), data: request.data });

      return body instanceof HTTPErrorResponse
        ? body
        : new HTTPResponse<JSONObject>(200, body, {});
    }) as never);
  }

  beforeEach(() => {
    posts = [];
    impactSpy.mockRestore();
    dropSpy.mockRestore();
  });

  test("the impact is read defensively: a user without an id is no user, a widget without an id no widget, a missing count is none", async () => {
    answer({
      isAvailable: true,
      metricsMatched: "many",
      monitors: [
        { id: MONITOR_ID, name: "Signups of Jane" },
        { id: "not an id", name: "Broken" },
        "Growth",
      ],
      dashboards: [
        {
          id: DASHBOARD_ID,
          name: "Growth",
          widgets: [
            { id: WIDGET_ID, title: "Signups", type: "Chart" },
            { title: "No id" },
            { id: "w2", title: 7, type: null },
            null,
          ],
        },
      ],
      slos: "Signup success",
      recordingRules: [
        { id: RECORDING_RULE_ID, name: "Signup rate", outputMetricName: 9 },
      ],
      monitorsChecked: true,
      slosChecked: true,
      monitorsHidden: 3,
      dashboardsHidden: -1,
      slosHidden: 1.5,
      recordingRulesHidden: "2",
    } as unknown as JSONObject);

    const read: DataSecurityDropMetricImpact =
      await DataSecurityApi.getDropMetricImpact(new ObjectID(NAME_FINDING_ID));

    expect(posts[0]!.url).toContain(
      DATA_SECURITY_API_ROUTES.dropMetricImpact(NAME_FINDING_ID),
    );
    expect(read).toMatchObject({
      isAvailable: true,
      metricsMatched: 0,
      metricsCounted: false,
      monitors: [{ id: MONITOR_ID, name: "Signups of Jane" }],
      dashboards: [
        {
          id: DASHBOARD_ID,
          name: "Growth",
          widgets: [
            { id: WIDGET_ID, title: "Signups", type: "Chart" },
            { id: "w2", title: "", type: "" },
          ],
        },
      ],
      slos: [],
      recordingRules: [{ id: RECORDING_RULE_ID, name: "Signup rate" }],
      monitorsChecked: true,
      dashboardsChecked: false,
      slosChecked: true,
      recordingRulesChecked: false,
      monitorsHidden: 3,
      dashboardsHidden: 0,
      slosHidden: 0,
      recordingRulesHidden: 0,
    });
    // An output metric that is no text is none: the rule's link opens the whole list.
    expect(read.recordingRules[0]!.outputMetricName).toBeUndefined();
  });

  test("the drop is asked for with the data loss confirmed, and a refusal is thrown", async () => {
    answer({
      ruleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
      ruleName: RULE_NAME,
    });

    expect(
      await DataSecurityApi.dropMetric(new ObjectID(NAME_FINDING_ID)),
    ).toEqual({
      ruleId: "9c9c9c9c-0000-4000-8000-0000000000c9",
      ruleName: RULE_NAME,
    });
    expect(posts[0]!.url).toContain(
      DATA_SECURITY_API_ROUTES.dropMetric(NAME_FINDING_ID),
    );
    expect(posts[0]!.data).toEqual({ confirmDataLoss: true });

    answer(
      new HTTPErrorResponse(
        403,
        {
          message:
            "You do not have permission to create metric pipeline rules.",
        },
        {},
      ),
    );
    await expect(
      DataSecurityApi.dropMetric(new ObjectID(NAME_FINDING_ID)),
    ).rejects.toThrow();
  });
});
