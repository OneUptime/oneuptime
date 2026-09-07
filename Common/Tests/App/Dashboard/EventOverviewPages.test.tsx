import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { FunctionComponent, ReactElement } from "react";
import IncidentView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import AlertView from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index";
import ScheduledMaintenanceView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import IncidentViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Layout";
import AlertViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Layout";
import ScheduledMaintenanceViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Layout";

/*
 * Exercise the actual pages, shared layout, metric tiles, and live duration.
 * Independent cards/dialogs are mocked at their boundary to isolate each page's
 * layout and refresh contracts from unrelated API requests.
 */
interface DetailField {
  title: string;
  field: Record<string, unknown>;
}
interface DetailProps {
  name: string;
  cardProps: { title: string };
  compact?: boolean | undefined;
  isEditable?: boolean | undefined;
  editButtonText?: string | undefined;
  onSaveSuccess?: (() => void) | undefined;
  formFields: Array<DetailField>;
  modelDetailProps: {
    fields: Array<DetailField>;
    modelId: ObjectID;
    selectMoreFields?: Record<string, unknown> | undefined;
  };
}
interface HeaderProps {
  title?: string | undefined;
  eventNumber?: string | undefined;
  isPrivate?: boolean | undefined;
  severity?: { name: string } | undefined;
  onActionComplete: () => Promise<void>;
}
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const detailCards: Map<string, DetailProps> = new Map();
let currentItem: Record<string, any> = {};

function MockHeader(props: HeaderProps): ReactElement {
  return (
    <header>
      <h2>{props.title}</h2>
      <span>{props.eventNumber}</span>
      <span>{props.severity?.name}</span>
      {props.isPrivate && <span>Private event</span>}
      <button
        type="button"
        onClick={() => {
          void props.onActionComplete();
        }}
      >
        Complete state change
      </button>
    </header>
  );
}
function MockFeed(props: { refreshToken?: number | undefined }): ReactElement {
  return (
    <div data-testid="activity-feed">
      Feed revision {props.refreshToken || 0}
    </div>
  );
}
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: DetailProps): ReactElement => {
      detailCards.set(props.name, props);
      return (
        <section aria-label={props.cardProps.title}>
          <h3>{props.cardProps.title}</h3>
          <button type="button" onClick={props.onSaveSuccess}>
            {props.editButtonText}
          </button>
          {props.modelDetailProps.fields.map(
            (field: DetailField, index: number) => {
              return <div key={index}>{field.title}</div>;
            },
          )}
        </section>
      );
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel",
  () => {
    return {
      __esModule: true,
      default: (props: { onAnalysisAvailable: () => void }): ReactElement => {
        return (
          <button type="button" onClick={props.onAnalysisAvailable}>
            Publish analysis
          </button>
        );
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/EntityRunbooks",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="runbooks">Runbooks</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState",
  () => {
    return {
      __esModule: true,
      default: (props: HeaderProps): ReactElement => {
        return <MockHeader {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshToken?: number | undefined }): ReactElement => {
        return <MockFeed {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState",
  () => {
    return {
      __esModule: true,
      default: (props: HeaderProps): ReactElement => {
        return <MockHeader {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshToken?: number | undefined }): ReactElement => {
        return <MockFeed {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState",
  () => {
    return {
      __esModule: true,
      default: (props: HeaderProps): ReactElement => {
        return <MockHeader {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshToken?: number | undefined }): ReactElement => {
        return <MockFeed {...props} />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicies",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotWindowAlert",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSummarySnapshotCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisode",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagesElement",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AffectedResources",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
      isAffectedResourcesPayload: (): boolean => {
        return false;
      },
    };
  },
);

const EVENT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const pageProps: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/incidents/event"),
  currentProject: null,
  hasPaymentMethod: false,
};
interface EventSpec {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  detailName: string;
  detailTitle: string;
  numberField: string;
  severityField?: string | undefined;
  activityTitle: string;
  resourceFields: Array<string>;
}
const eventSpecs: Array<EventSpec> = [
  {
    name: "incident",
    Page: IncidentView,
    detailName: "Incident Details",
    detailTitle: "Incident Details",
    numberField: "incidentNumber",
    severityField: "incidentSeverity",
    activityTitle: "Response activity",
    resourceFields: [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "proxmoxClusters",
      "cephClusters",
      "dockerSwarmClusters",
      "iotFleets",
      "services",
    ],
  },
  {
    name: "alert",
    Page: AlertView,
    detailName: "Alert Details",
    detailTitle: "Alert Details",
    numberField: "alertNumber",
    severityField: "alertSeverity",
    activityTitle: "Response activity",
    resourceFields: [
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "proxmoxClusters",
      "cephClusters",
      "dockerSwarmClusters",
      "iotFleets",
      "services",
    ],
  },
  {
    name: "scheduled maintenance",
    Page: ScheduledMaintenanceView,
    detailName: "Scheduled Maintenance Details",
    detailTitle: "Maintenance Details",
    numberField: "scheduledMaintenanceNumber",
    activityTitle: "Maintenance activity",
    resourceFields: [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "networkSites",
      "services",
    ],
  },
];
function setItem(spec: EventSpec): void {
  currentItem = {
    _id: EVENT_ID.toString(),
    title: "Database latency in the primary region",
    [spec.numberField]: 42,
    [spec.numberField + "WithPrefix"]: "EVT-42",
    declaredAt: new Date("2026-08-01T10:00:00Z"),
    createdAt: new Date("2026-08-01T10:00:00Z"),
    startsAt: new Date("2026-08-01T10:00:00Z"),
    endsAt: new Date("2026-08-01T12:00:00Z"),
  };
  if (spec.severityField) {
    currentItem[spec.severityField] = {
      name: "Critical",
      color: new Color("#dc2626"),
    };
  }
}
async function renderOverview(spec: EventSpec): Promise<void> {
  render(<spec.Page {...pageProps} />);
  await screen.findByRole("heading", { name: currentItem["title"] as string });
}
function getDetails(spec: EventSpec): DetailProps {
  const details: DetailProps | undefined = detailCards.get(spec.detailName);
  if (!details) {
    throw new Error("Details card did not render");
  }
  return details;
}
beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  detailCards.clear();
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(EVENT_ID);
  getItemMock.mockImplementation(async () => {
    return currentItem;
  });
  getListMock.mockResolvedValue({ data: [], count: 0 });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(eventSpecs)("$name overview", (spec: EventSpec) => {
  beforeEach(() => {
    setItem(spec);
  });
  test("places the summary before activity and keeps context in the sidebar", async () => {
    await renderOverview(spec);
    const summary: HTMLElement = screen.getByRole("region", {
      name: "Event summary",
    });
    const activity: HTMLElement = screen.getByRole("region", {
      name: spec.activityTitle,
    });
    const context: HTMLElement = screen.getByRole("complementary", {
      name: "Event context",
    });
    expect(
      summary.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(activity).getByTestId("activity-feed")).toBeVisible();
    expect(
      within(context).getByRole("region", { name: spec.detailTitle }),
    ).toBeVisible();
    expect(
      within(activity).queryByRole("region", { name: spec.detailTitle }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("EVT-42")).toHaveLength(1);
    expect(within(summary).getAllByRole("term")).toHaveLength(3);
  });
  test("puts updates ahead of optional runbooks", async () => {
    await renderOverview(spec);
    expect(
      screen
        .getByTestId("activity-feed")
        .compareDocumentPosition(screen.getByTestId("runbooks")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  test("preserves editable fields and compact, clearly named editing actions", async () => {
    await renderOverview(spec);
    const details: DetailProps = getDetails(spec);
    expect(details.isEditable).toBe(true);
    expect(details.compact).toBe(true);
    expect(details.editButtonText).toBe("Edit details");
    expect(details.modelDetailProps.modelId.toString()).toBe(
      EVENT_ID.toString(),
    );
    expect(
      details.formFields.some((field: DetailField) => {
        return field.field["title"] === true;
      }),
    ).toBe(true);
    const resources: DetailProps | undefined =
      detailCards.get("Affected Resources");
    expect(resources?.isEditable).toBe(true);
    expect(resources?.compact).toBe(true);
    expect(resources?.editButtonText).toBe("Edit resources");
    const registered: Array<string> = resources!.formFields.flatMap(
      (field: DetailField) => {
        return Object.keys(field.field);
      },
    );
    expect(registered).toEqual(expect.arrayContaining(spec.resourceFields));
  });
  test("refreshes the title after saving details", async () => {
    await renderOverview(spec);
    currentItem = { ...currentItem, title: "Database latency mitigated" };
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    await screen.findByRole("heading", { name: "Database latency mitigated" });
    expect(getItemMock.mock.calls.length).toBeGreaterThan(1);
  });
  test("refreshes the page after a status action completes", async () => {
    await renderOverview(spec);
    currentItem = { ...currentItem, title: "Response completed" };
    fireEvent.click(
      screen.getByRole("button", { name: "Complete state change" }),
    );
    await screen.findByRole("heading", { name: "Response completed" });
  });
  test("falls back to a numeric identifier when no prefix is available", async () => {
    delete currentItem[spec.numberField + "WithPrefix"];
    await renderOverview(spec);
    expect(screen.getByText("#42")).toBeVisible();
  });
});
describe.each(eventSpecs.slice(0, 2))(
  "$name response state",
  (spec: EventSpec) => {
    beforeEach(() => {
      setItem(spec);
    });
    test("shows pending metrics without inventing a completion time", async () => {
      await renderOverview(spec);
      const summary: HTMLElement = screen.getByRole("region", {
        name: "Event summary",
      });
      expect(within(summary).getByText("Not yet acknowledged")).toBeVisible();
      expect(within(summary).getByText("Not yet resolved")).toBeVisible();
    });
    test("updates severity and private visibility after editing", async () => {
      await renderOverview(spec);
      currentItem = {
        ...currentItem,
        isPrivate: true,
        [spec.severityField!]: { name: "Low", color: new Color("#16a34a") },
      };
      fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
      await screen.findByText("Low");
      expect(screen.getByText("Private event")).toBeVisible();
      expect(screen.queryByText("Critical")).not.toBeInTheDocument();
    });
    test("refreshes the feed when investigation publishes analysis", async () => {
      await renderOverview(spec);
      fireEvent.click(screen.getByRole("button", { name: "Publish analysis" }));
      await screen.findByText("Feed revision 1");
    });
    test("shows a useful loading failure", async () => {
      getItemMock.mockRejectedValue(new Error("Could not load event"));
      render(<spec.Page {...pageProps} />);
      await screen.findByText("Could not load event");
      expect(screen.queryByTestId("event-overview")).not.toBeInTheDocument();
    });
  },
);
describe("maintenance window", () => {
  const spec: EventSpec = eventSpecs[2]!;
  beforeEach(() => {
    setItem(spec);
  });
  test("shows the planned window and timezone, keeping duplicate dates out of context", async () => {
    await renderOverview(spec);
    const summary: HTMLElement = screen.getByRole("region", {
      name: "Event summary",
    });
    expect(within(summary).getByText("Scheduled duration")).toBeVisible();
    expect(within(summary).getByText("2 hours, 0 minutes")).toBeVisible();
    expect(
      within(summary).getByText(
        "Your local timezone (" +
          OneUptimeDate.getCurrentTimezoneString() +
          ")",
      ),
    ).toBeVisible();
    expect(
      within(summary).getByText(
        OneUptimeDate.getDateAsLocalFormattedString(currentItem["startsAt"]),
      ),
    ).toBeVisible();
    const details: DetailProps = getDetails(spec);
    expect(
      details.modelDetailProps.fields.some((field: DetailField) => {
        return Boolean(field.field["startsAt"] || field.field["endsAt"]);
      }),
    ).toBe(false);
    expect(
      details.formFields.some((field: DetailField) => {
        return field.field["startsAt"] === true;
      }),
    ).toBe(true);
    expect(
      details.formFields.some((field: DetailField) => {
        return field.field["endsAt"] === true;
      }),
    ).toBe(true);
  });
  test.each(["startsAt", "endsAt"])(
    "keeps the known date when %s is absent",
    async (missing: string) => {
      const known: Date =
        currentItem[missing === "startsAt" ? "endsAt" : "startsAt"];
      delete currentItem[missing];
      await renderOverview(spec);
      const summary: HTMLElement = screen.getByRole("region", {
        name: "Event summary",
      });
      expect(
        within(summary).getByText(
          OneUptimeDate.getDateAsLocalFormattedString(known),
        ),
      ).toBeVisible();
      expect(within(summary).getByText("Not set")).toBeVisible();
      expect(within(summary).getByText("-")).toBeVisible();
    },
  );
  test("uses empty values when the window is unavailable", async () => {
    delete currentItem["startsAt"];
    delete currentItem["endsAt"];
    await renderOverview(spec);
    const summary: HTMLElement = screen.getByRole("region", {
      name: "Event summary",
    });
    expect(within(summary).getAllByText("Not set")).toHaveLength(2);
    expect(within(summary).getByText("-")).toBeVisible();
  });
  test("updates the window after editing and preserves subscriber configuration", async () => {
    await renderOverview(spec);
    currentItem = { ...currentItem, endsAt: new Date("2026-08-01T13:00:00Z") };
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    await screen.findByText("3 hours, 0 minutes");
    const details: DetailProps = getDetails(spec);
    expect(
      details.modelDetailProps.fields.map((field: DetailField) => {
        return field.title;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Subscriber Reminders",
        "Subscriber Notification Status",
        "Shown on Status Pages",
      ]),
    );
    expect(
      details.modelDetailProps.selectMoreFields?.[
        "nextSubscriberNotificationBeforeTheEventAt"
      ],
    ).toBe(true);
  });
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { hideTitle?: boolean | undefined }): ReactElement => {
      return (
        <div data-testid="model-page-heading" data-hidden={props.hideTitle} />
      );
    },
  };
});

interface LayoutSpec {
  name: string;
  Layout: FunctionComponent<PageComponentProps>;
  segment: string;
}

const layouts: Array<LayoutSpec> = [
  { name: "incident", Layout: IncidentViewLayout, segment: "incidents" },
  { name: "alert", Layout: AlertViewLayout, segment: "alerts" },
  {
    name: "maintenance",
    Layout: ScheduledMaintenanceViewLayout,
    segment: "scheduled-maintenance-events",
  },
];

describe.each(layouts)("$name page heading", (spec: LayoutSpec) => {
  test.each([
    ["", "true"],
    ["/", "true"],
    ["/state-timeline", "false"],
    ["/settings", "false"],
  ])(
    "hides the duplicate title only on overview route suffix '%s'",
    (suffix: string, expectedHidden: string) => {
      const pathname: string =
        "/dashboard/22222222-2222-4222-8222-222222222222/" +
        spec.segment +
        "/" +
        EVENT_ID.toString() +
        suffix;
      Navigation.setLocation({
        pathname,
        search: "",
        hash: "",
        state: null,
        key: "overview-test",
      });
      render(
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <RouterRoute
              path={"/dashboard/:projectId/" + spec.segment + "/:id/*"}
              element={<spec.Layout {...pageProps} />}
            />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByTestId("model-page-heading")).toHaveAttribute(
        "data-hidden",
        expectedHidden,
      );
    },
  );
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue || key;
        },
      };
    },
  };
});
