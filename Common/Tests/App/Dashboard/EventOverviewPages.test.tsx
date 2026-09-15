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
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident and alert overview pages, rendered for real with every heavy
 * card stubbed. What is under test is the page itself: the first load, the
 * background refresh that must never unmount a card, moving to another event
 * on the same route (the page is not remounted, so nothing of the previous
 * event may leak into the next), the stat bar's numbers, the header facts and
 * AI summary it assembles, and the order of the cards.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

const recordedProps: Record<string, Array<Record<string, unknown>>> = {};
const mountCounts: Record<string, number> = {};

/*
 * Function declarations, so they are hoisted along with the jest.mock calls
 * that use them. Everything they touch is dereferenced lazily, at render
 * time, after the module's consts are initialised.
 */
function recordProps(key: string, props: Record<string, unknown>): void {
  if (!recordedProps[key]) {
    recordedProps[key] = [];
  }

  recordedProps[key]!.push(props);
}

function stubModule(key: string): {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordProps(key, props);

      React.useEffect(() => {
        mountCounts[key] = (mountCounts[key] || 0) + 1;
      }, []);

      return React.createElement("div", { "data-testid": `stub-${key}` });
    },
  };
}

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordProps(`CardModelDetail:${props["name"] as string}`, props);

      return React.createElement("div", {
        "data-testid": `stub-card-${props["name"] as string}`,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState",
  () => {
    return stubModule("ChangeIncidentState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState",
  () => {
    return stubModule("ChangeAlertState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel",
  () => {
    return stubModule("InvestigationPanel");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed",
  () => {
    return stubModule("Feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed",
  () => {
    return stubModule("Feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources",
  () => {
    return stubModule("SeriesResource");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AffectedResources",
  () => {
    return stubModule("SeriesResource");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSummarySnapshotCard",
  () => {
    return stubModule("MonitorSummary");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/EntityRunbooks",
  () => {
    return stubModule("Runbooks");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard",
  () => {
    return stubModule("Remediation");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment",
  () => {
    return stubModule("Roles");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return stubModule("CustomFields");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return stubModule("Telemetry");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotWindowAlert",
  () => {
    return stubModule("SnapshotWindow");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return stubModule("LogsViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return stubModule("TracesViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return stubModule("MetricView");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return stubModule("ExceptionsViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay",
  () => {
    return stubModule("AffectedResourcesDisplay");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker",
  () => {
    return {
      ...stubModule("AffectedResourcesPicker"),
      isAffectedResourcesPayload: (): boolean => {
        return false;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus",
  () => {
    return stubModule("SubscriberNotificationStatus");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicies",
  () => {
    return stubModule("OnCallPolicies");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return stubModule("User");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor",
  () => {
    return {
      __esModule: true,
      default: (props: { monitor: { name?: string } }): ReactElement => {
        return React.createElement(
          "span",
          { "data-testid": "monitor-element" },
          props.monitor.name,
        );
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisode",
  () => {
    return {
      __esModule: true,
      default: (props: { alertEpisode: { title?: string } }): ReactElement => {
        return React.createElement(
          "span",
          { "data-testid": "episode-element" },
          props.alertEpisode.title,
        );
      },
    };
  },
);

import IncidentView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import AlertView from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { DetailStyle } from "../../../UI/Components/Detail/Detail";
import Navigation from "../../../UI/Utils/Navigation";

const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID: string = "22222222-2222-4222-8222-222222222222";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

const minutesAfterStart: (minutes: number) => Date = (
  minutes: number,
): Date => {
  return new Date(START.getTime() + minutes * 60 * 1000);
};

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}

function propsHistory<T>(key: string): Array<T> {
  return (recordedProps[key] || []) as unknown as Array<T>;
}

function latestProps<T>(key: string): T {
  const history: Array<T> = propsHistory<T>(key);

  if (history.length === 0) {
    throw new Error(`${key} was never rendered`);
  }

  return history[history.length - 1]!;
}

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

const listResult: (data: Array<unknown>) => ListResultShape = (
  data: Array<unknown>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: 10000 };
};

interface ChangeStateProps {
  title?: string;
  eventNumber?: string;
  eventStartsAt?: Date;
  isPrivate?: boolean;
  severity?: { name: string; color: Color };
  facts?: Array<EventStatusFact>;
  aiInvestigationStatus?: AIRunStatus | null;
  aiInvestigationSummary?: string | null;
  onActionComplete: () => void;
}

interface InvestigationPanelProps {
  subjectType: string;
  onStatusChange: (status: AIRunStatus | null) => void;
  onReportSummaryChange: (summary: string | null) => void;
  onAnalysisAvailable: () => void;
}

interface DetailFieldProps {
  title?: string;
  field?: Record<string, unknown>;
  getElement?: (item: unknown) => ReactElement;
}

interface CardModelDetailProps {
  refresher?: boolean;
  onSaveSuccess?: () => void;
  modelDetailProps: {
    style?: DetailStyle;
    onBeforeFetch?: unknown;
    onItemLoaded?: (item: unknown) => void;
    fields: Array<DetailFieldProps>;
  };
}

interface PageCase {
  noun: "incident" | "alert";
  pageElement: () => ReactElement;
  renderPage: () => RenderResult;
  eventModel: typeof Incident | typeof Alert;
  stateModel: typeof IncidentState | typeof AlertState;
  timelineModel: typeof IncidentStateTimeline | typeof AlertStateTimeline;
  changeStateKey: string;
  buildEvent: (title: string) => Incident | Alert;
  buildStates: () => Array<IncidentState | AlertState>;
  buildTimeline: (
    entries: Array<[string, number]>,
  ) => Array<IncidentStateTimeline | AlertStateTimeline>;
  startFactLabel: string;
  statBarName: string;
  detailsCardName: string;
  expectedDetailTitles: Array<string>;
  leftColumnOrder: Array<string>;
  rightColumnOrder: Array<string>;
}

interface StateSpec {
  id: string;
  name: string;
  flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const STATE_SPECS: Array<StateSpec> = [
  { id: CREATED_STATE_ID, name: "Created", flag: "isCreatedState" },
  {
    id: ACKNOWLEDGED_STATE_ID,
    name: "Acknowledged",
    flag: "isAcknowledgedState",
  },
  { id: RESOLVED_STATE_ID, name: "Resolved", flag: "isResolvedState" },
];

const INCIDENT_CASE: PageCase = {
  noun: "incident",
  pageElement: (): ReactElement => {
    return <IncidentView {...pageProps} />;
  },
  renderPage: (): RenderResult => {
    return render(<IncidentView {...pageProps} />);
  },
  eventModel: Incident,
  stateModel: IncidentState,
  timelineModel: IncidentStateTimeline,
  changeStateKey: "ChangeIncidentState",
  buildEvent: (title: string): Incident => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(EVENT_ID);
    incident.title = title;
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    incident.declaredAt = START;
    incident.isPrivate = true;
    incident.seriesLabels = { "host.name": "prod-01" };

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    severity.color = new Color("#ef4444");
    incident.incidentSeverity = severity;

    return incident;
  },
  buildStates: (): Array<IncidentState> => {
    return STATE_SPECS.map((spec: StateSpec): IncidentState => {
      const state: IncidentState = new IncidentState();
      state.id = new ObjectID(spec.id);
      state.name = spec.name;
      state[spec.flag] = true;
      return state;
    });
  },
  buildTimeline: (
    entries: Array<[string, number]>,
  ): Array<IncidentStateTimeline> => {
    return entries.map(
      ([stateId, minutes]: [string, number]): IncidentStateTimeline => {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentStateId = new ObjectID(stateId);
        timeline.startsAt = minutesAfterStart(minutes);
        return timeline;
      },
    );
  },
  startFactLabel: "Declared",
  statBarName: "Incident response times",
  detailsCardName: "Incident Details",
  expectedDetailTitles: [
    "Declared At",
    "Declared By",
    "On-Call Duty Policies",
    "Subscriber Notification Status",
    "Labels",
    "Incident Number",
    "Incident ID",
  ],
  leftColumnOrder: [
    "stub-InvestigationPanel",
    "stub-MonitorSummary",
    "stub-SeriesResource",
    "stub-Remediation",
    "stub-Runbooks",
    "stub-Feed",
  ],
  rightColumnOrder: [
    "stub-card-Incident Details",
    "stub-Roles",
    "stub-card-Affected Resources",
    "stub-CustomFields",
  ],
};

const ALERT_CASE: PageCase = {
  noun: "alert",
  pageElement: (): ReactElement => {
    return <AlertView {...pageProps} />;
  },
  renderPage: (): RenderResult => {
    return render(<AlertView {...pageProps} />);
  },
  eventModel: Alert,
  stateModel: AlertState,
  timelineModel: AlertStateTimeline,
  changeStateKey: "ChangeAlertState",
  buildEvent: (title: string): Alert => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(EVENT_ID);
    alert.title = title;
    alert.alertNumber = 12;
    alert.alertNumberWithPrefix = "ALR-12";
    alert.createdAt = START;
    alert.isPrivate = true;
    alert.seriesLabels = { "host.name": "prod-01" };

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Critical";
    severity.color = new Color("#ef4444");
    alert.alertSeverity = severity;

    return alert;
  },
  buildStates: (): Array<AlertState> => {
    return STATE_SPECS.map((spec: StateSpec): AlertState => {
      const state: AlertState = new AlertState();
      state.id = new ObjectID(spec.id);
      state.name = spec.name;
      state[spec.flag] = true;
      return state;
    });
  },
  buildTimeline: (
    entries: Array<[string, number]>,
  ): Array<AlertStateTimeline> => {
    return entries.map(
      ([stateId, minutes]: [string, number]): AlertStateTimeline => {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertStateId = new ObjectID(stateId);
        timeline.startsAt = minutesAfterStart(minutes);
        return timeline;
      },
    );
  },
  startFactLabel: "Created",
  statBarName: "Alert response times",
  detailsCardName: "Alert Details",
  expectedDetailTitles: [
    "Created At",
    "Created By",
    "Monitor",
    "Episode",
    "On-Call Duty Policies",
    "Labels",
    "Alert Number",
    "Alert ID",
  ],
  leftColumnOrder: [
    "stub-InvestigationPanel",
    "stub-MonitorSummary",
    "stub-SeriesResource",
    "stub-Remediation",
    "stub-Runbooks",
    "stub-Feed",
  ],
  rightColumnOrder: [
    "stub-card-Alert Details",
    "stub-card-Affected Resources",
    "stub-CustomFields",
  ],
};

// Created, acknowledged at 5m, resolved at 20m, reopened at 60m, acknowledged again at 70m.
const REOPENED_TIMELINE: Array<[string, number]> = [
  [CREATED_STATE_ID, 0],
  [ACKNOWLEDGED_STATE_ID, 5],
  [RESOLVED_STATE_ID, 20],
  [CREATED_STATE_ID, 60],
  [ACKNOWLEDGED_STATE_ID, 70],
];

interface FakeServer {
  timeline: Array<[string, number]>;
  title: string;
}

type ServeFunction = (pageCase: PageCase, server: FakeServer) => void;

const serve: ServeFunction = (pageCase: PageCase, server: FakeServer): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === pageCase.stateModel) {
      return Promise.resolve(listResult(pageCase.buildStates()));
    }

    if (request.modelType === pageCase.timelineModel) {
      return Promise.resolve(
        listResult(pageCase.buildTimeline(server.timeline)),
      );
    }

    return Promise.reject(new Error("Unexpected list request"));
  });

  getItemMock.mockImplementation(() => {
    return Promise.resolve(pageCase.buildEvent(server.title));
  });

  updateByIdMock.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
};

const countItemReads: () => number = (): number => {
  return getItemMock.mock.calls.length;
};

const factsOf: (pageCase: PageCase) => Array<EventStatusFact> = (
  pageCase: PageCase,
): Array<EventStatusFact> => {
  return latestProps<ChangeStateProps>(pageCase.changeStateKey).facts || [];
};

const factLabelsOf: (pageCase: PageCase) => Array<string> = (
  pageCase: PageCase,
): Array<string> => {
  return factsOf(pageCase).map((fact: EventStatusFact) => {
    return fact.label;
  });
};

type WaitForPageFunction = () => Promise<void>;

const waitForPage: WaitForPageFunction = async (): Promise<void> => {
  await screen.findByTestId("stub-InvestigationPanel");
  /*
   * The stub counts its mount in a passive effect, which can land after the
   * DOM query resolves on a loaded machine. Wait for it so mount-count
   * assertions never race the effect.
   */
  await waitFor(() => {
    expect(mountCounts["InvestigationPanel"]).toBeGreaterThanOrEqual(1);
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

// The id in the URL. Tests move the reader to another event by changing it.
let currentEventId: string = EVENT_ID;

/*
 * Every stub that was ever rendered with `id` in an id prop: its own
 * incidentId / alertId / subjectId / modelId, or a detail card's
 * modelDetailProps.modelId.
 */
function stubsRenderedWithId(id: string): Array<string> {
  const keys: Array<string> = [];

  for (const key of Object.keys(recordedProps)) {
    const rendersWithId: boolean = (recordedProps[key] || []).some(
      (props: Record<string, unknown>): boolean => {
        const detailProps: Record<string, unknown> | undefined = props[
          "modelDetailProps"
        ] as Record<string, unknown> | undefined;

        return [
          props["incidentId"],
          props["alertId"],
          props["subjectId"],
          props["modelId"],
          detailProps?.["modelId"],
        ].some((value: unknown): boolean => {
          return value instanceof ObjectID && value.toString() === id;
        });
      },
    );

    if (rendersWithId) {
      keys.push(key);
    }
  }

  return keys;
}

type ItemRequestIdFunction = (args: Array<unknown>) => string;

const itemRequestId: ItemRequestIdFunction = (args: Array<unknown>): string => {
  return (args[0] as { id: ObjectID }).id.toString();
};

beforeEach(() => {
  currentEventId = EVENT_ID;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentEventId);
    });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();

  for (const key of Object.keys(recordedProps)) {
    delete recordedProps[key];
  }

  for (const key of Object.keys(mountCounts)) {
    delete mountCounts[key];
  }

  jest.restoreAllMocks();
});

describe.each([
  ["incident", INCIDENT_CASE],
  ["alert", ALERT_CASE],
])("%s overview page", (_name: string, pageCase: PageCase) => {
  describe("first load", () => {
    test("starts on the skeleton and mounts no card until the data lands", async () => {
      const item: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();

      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });
      getItemMock.mockImplementation(() => {
        return item.promise;
      });

      pageCase.renderPage();

      const skeleton: HTMLElement = screen.getByRole("status");

      expect(skeleton).toHaveTextContent(`Loading ${pageCase.noun}`);
      expect(screen.queryByTestId("stub-InvestigationPanel")).toBeNull();
      expect(mountCounts["InvestigationPanel"]).toBeUndefined();
      expect(document.querySelector(".mt-52")).toBeNull();

      await act(async () => {
        item.resolve(pageCase.buildEvent("Checkout slow"));
      });

      await waitForPage();

      expect(screen.queryByText(`Loading ${pageCase.noun}`)).toBeNull();
      // Mounted once: the page no longer renders its cards and then unmounts them.
      expect(mountCounts["InvestigationPanel"]).toBe(1);
      expect(mountCounts["Feed"]).toBe(1);
    });

    test("reads the timeline, the states and the row in parallel", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const item: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      const pendingLists: Array<Deferred<unknown>> = [];

      getListMock.mockImplementation(() => {
        const deferred: Deferred<unknown> = createDeferred<unknown>();
        pendingLists.push(deferred);
        return deferred.promise;
      });
      getItemMock.mockImplementation(() => {
        return item.promise;
      });

      pageCase.renderPage();

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(2);
      });
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    test("a failed first load shows the error with a retry that recovers", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });
      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("The database is asleep"));
      });

      pageCase.renderPage();

      expect(
        await screen.findByText("The database is asleep"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("stub-InvestigationPanel")).toBeNull();

      fireEvent.click(screen.getByTestId("refresh-button"));

      await waitForPage();

      expect(screen.queryByText("The database is asleep")).toBeNull();
    });
  });

  describe("header", () => {
    test("hands the header the row's title, number, severity, privacy and start", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const props: ChangeStateProps = latestProps<ChangeStateProps>(
        pageCase.changeStateKey,
      );

      expect(props.title).toBe("Checkout slow");
      expect(props.eventNumber).toBe(
        pageCase.noun === "incident" ? "INC-42" : "ALR-12",
      );
      expect(props.severity?.name).toBe("Critical");
      expect(props.isPrivate).toBe(true);
      expect(props.eventStartsAt).toEqual(START);
    });

    test("leads the facts with the absolute start time", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const startFact: EventStatusFact | undefined = factsOf(pageCase)[0];

      expect(startFact?.label).toBe(pageCase.startFactLabel);
      expect(startFact?.value).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(START),
      );
    });

    test("lifts the investigation status and summary into the header", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const panel: InvestigationPanelProps =
        latestProps<InvestigationPanelProps>("InvestigationPanel");

      expect(panel.subjectType).toBe(pageCase.noun);
      expect(
        latestProps<ChangeStateProps>(pageCase.changeStateKey)
          .aiInvestigationStatus,
      ).toBeNull();

      act(() => {
        panel.onStatusChange(AIRunStatus.Running);
      });

      expect(
        latestProps<ChangeStateProps>(pageCase.changeStateKey)
          .aiInvestigationStatus,
      ).toBe(AIRunStatus.Running);

      act(() => {
        latestProps<InvestigationPanelProps>(
          "InvestigationPanel",
        ).onStatusChange(AIRunStatus.Completed);
        latestProps<InvestigationPanelProps>(
          "InvestigationPanel",
        ).onReportSummaryChange("Pool exhaustion in checkout-api.");
      });

      let header: ChangeStateProps = latestProps<ChangeStateProps>(
        pageCase.changeStateKey,
      );

      expect(header.aiInvestigationStatus).toBe(AIRunStatus.Completed);
      expect(header.aiInvestigationSummary).toBe(
        "Pool exhaustion in checkout-api.",
      );

      act(() => {
        latestProps<InvestigationPanelProps>(
          "InvestigationPanel",
        ).onReportSummaryChange(null);
      });

      header = latestProps<ChangeStateProps>(pageCase.changeStateKey);

      expect(header.aiInvestigationSummary).toBeNull();
      // Status and summary changes never remount the panel.
      expect(mountCounts["InvestigationPanel"]).toBe(1);
    });
  });

  describe("stat bar", () => {
    test("counts to the FIRST acknowledgement and resolution of a reopened event", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const statBar: HTMLElement = screen.getByRole("group", {
        name: pageCase.statBarName,
      });
      const cells: Array<Element> = Array.from(statBar.children);

      expect(cells).toHaveLength(3);
      expect(cells[0]).toHaveTextContent("Acknowledged in");
      expect(cells[0]).toHaveTextContent("5 minutes");
      expect(cells[0]).toHaveTextContent(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          minutesAfterStart(5),
        ),
      );
      expect(cells[1]).toHaveTextContent("Resolved in");
      expect(cells[1]).toHaveTextContent("20 minutes");
      expect(cells[2]).toHaveTextContent("Duration");
      // Reopened, so the duration is still running and has no end.
      expect(cells[2]).not.toHaveTextContent("Ended");
    });

    test("says not yet for an event nobody has answered", async () => {
      serve(pageCase, {
        timeline: [[CREATED_STATE_ID, 0]],
        title: "Checkout slow",
      });

      pageCase.renderPage();
      await waitForPage();

      const statBar: HTMLElement = screen.getByRole("group", {
        name: pageCase.statBarName,
      });

      expect(within(statBar).getByText("Not yet acknowledged")).toBeVisible();
      expect(within(statBar).getByText("Not yet resolved")).toBeVisible();
    });

    test("ends the duration at the current resolution", async () => {
      serve(pageCase, {
        timeline: [
          [CREATED_STATE_ID, 0],
          [RESOLVED_STATE_ID, 90],
        ],
        title: "Checkout slow",
      });

      pageCase.renderPage();
      await waitForPage();

      const cells: Array<Element> = Array.from(
        screen.getByRole("group", { name: pageCase.statBarName }).children,
      );

      // Resolved without an acknowledgement: the resolution answered it.
      expect(cells[0]).toHaveTextContent("1 hour, 30 minutes");
      expect(cells[1]).toHaveTextContent("1 hour, 30 minutes");
      expect(cells[2]).toHaveTextContent("1 hour, 30 minutes");
      expect(cells[2]).toHaveTextContent(
        `Ended ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          minutesAfterStart(90),
        )}`,
      );
    });

    test("sits between the header and the card grid", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const header: HTMLElement = screen.getByTestId(
        `stub-${pageCase.changeStateKey}`,
      );
      const statBar: HTMLElement = screen.getByRole("group", {
        name: pageCase.statBarName,
      });
      const panel: HTMLElement = screen.getByTestId("stub-InvestigationPanel");

      expect(
        header.compareDocumentPosition(statBar) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        statBar.compareDocumentPosition(panel) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("layout", () => {
    const expectInDocumentOrder: (testIds: Array<string>) => void = (
      testIds: Array<string>,
    ): void => {
      const elements: Array<HTMLElement> = testIds.map((testId: string) => {
        return screen.getByTestId(testId);
      });

      for (let index: number = 1; index < elements.length; index++) {
        expect(
          elements[index - 1]!.compareDocumentPosition(elements[index]!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    };

    test("the left column leads with the AI investigation", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      expectInDocumentOrder(pageCase.leftColumnOrder);
    });

    test("the right column orders details, then the rest, custom fields last", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      expectInDocumentOrder(pageCase.rightColumnOrder);
    });

    test("the details card is compact, fetches nothing extra, and lists when and who first", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const details: CardModelDetailProps = latestProps<CardModelDetailProps>(
        `CardModelDetail:${pageCase.detailsCardName}`,
      );

      expect(details.modelDetailProps.style).toBe(DetailStyle.Compact);
      expect(details.modelDetailProps.onBeforeFetch).toBeUndefined();
      expect(
        details.modelDetailProps.fields.map((field: DetailFieldProps) => {
          return field.title;
        }),
      ).toEqual(pageCase.expectedDetailTitles);

      const resources: CardModelDetailProps = latestProps<CardModelDetailProps>(
        "CardModelDetail:Affected Resources",
      );

      expect(resources.modelDetailProps.style).toBe(DetailStyle.Compact);
    });

    /*
     * The right column is about 300px wide. Side-by-side headers squeezed
     * each card's title into a one-word-per-line column beside a long
     * "Edit Incident" button, and two resource tiles per row clipped every
     * name, so every card there stacks its header and the resources render
     * in one column.
     */
    test("every right-column card stacks its header, edit buttons say Edit, resources use one column", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      interface SidebarCardProps {
        editButtonText?: string;
        isEditable?: boolean;
        cardProps: {
          title?: string;
          description?: string;
          headerLayout?: string;
          buttons?: Array<unknown>;
        };
        modelDetailProps: {
          fields: Array<DetailFieldProps>;
        };
      }

      const details: SidebarCardProps = latestProps<SidebarCardProps>(
        `CardModelDetail:${pageCase.detailsCardName}`,
      );
      const resources: SidebarCardProps = latestProps<SidebarCardProps>(
        "CardModelDetail:Affected Resources",
      );

      for (const card of [details, resources]) {
        expect(card.cardProps.headerLayout).toBe("stacked");
        expect(card.editButtonText).toBe("Edit");
        // Still editable: the short label changes the words, not the gating.
        expect(card.isEditable).toBe(true);
        expect(card.cardProps.description).toBeTruthy();
        expect((card.cardProps.description || "").length).toBeLessThan(70);
      }

      expect(details.cardProps.title).toBe(pageCase.detailsCardName);
      expect(details.cardProps.description).toBe(
        `Key facts about this ${pageCase.noun}.`,
      );
      expect(resources.cardProps.title).toBe("Affected Resources");

      const displayField: DetailFieldProps | undefined =
        resources.modelDetailProps.fields.find((field: DetailFieldProps) => {
          return Boolean(field.getElement);
        });

      expect(displayField).toBeDefined();

      const display: ReactElement = displayField!.getElement!(
        new pageCase.eventModel(),
      );

      expect((display.props as { columns?: number }).columns).toBe(1);

      expect(
        latestProps<{ headerLayout?: string }>("CustomFields").headerLayout,
      ).toBe("stacked");

      if (pageCase.noun === "incident") {
        expect(
          latestProps<{ headerLayout?: string }>("Roles").headerLayout,
        ).toBe("stacked");
      }
    });

    test("hands the series labels it already read to the resource card", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      expect(
        latestProps<{ seriesLabels: unknown }>("SeriesResource").seriesLabels,
      ).toEqual({ "host.name": "prod-01" });
    });
  });

  describe("background refresh", () => {
    test("an action refreshes the page without unmounting a single card", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const skeletonSeen: Array<boolean> = [];
      const observer: MutationObserver = new MutationObserver(() => {
        if (document.body.textContent?.includes(`Loading ${pageCase.noun}`)) {
          skeletonSeen.push(true);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const readsBefore: number = countItemReads();
      const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
        "Feed",
      ).refreshToken;

      serve(pageCase, {
        timeline: [...REOPENED_TIMELINE, [RESOLVED_STATE_ID, 100]],
        title: "Checkout slow (resolved)",
      });

      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Checkout slow (resolved)");
      });

      observer.disconnect();

      expect(countItemReads()).toBe(readsBefore + 1);
      expect(skeletonSeen).toEqual([]);
      expect(mountCounts["InvestigationPanel"]).toBe(1);
      expect(mountCounts["Feed"]).toBe(1);
      expect(mountCounts[pageCase.changeStateKey]).toBe(1);
      // The state change is a new feed entry.
      expect(latestProps<{ refreshToken: number }>("Feed").refreshToken).toBe(
        feedTokenBefore + 1,
      );
      expect(
        screen.getByRole("group", { name: pageCase.statBarName }),
      ).toHaveTextContent("Ended");
    });

    test("saving the details card refreshes the header data and the feed", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
        "Feed",
      ).refreshToken;

      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Renamed" });

      act(() => {
        latestProps<CardModelDetailProps>(
          `CardModelDetail:${pageCase.detailsCardName}`,
        ).onSaveSuccess!();
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Renamed");
      });

      expect(latestProps<{ refreshToken: number }>("Feed").refreshToken).toBe(
        feedTokenBefore + 1,
      );
      expect(mountCounts["InvestigationPanel"]).toBe(1);
    });

    test("a failed refresh keeps the page and says so, with a working retry", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("Gateway timeout"));
      });

      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });

      const banner: HTMLElement = await screen.findByRole("alert");

      expect(banner).toHaveTextContent(
        `Could not refresh this ${pageCase.noun}. Gateway timeout`,
      );
      expect(screen.getByTestId("stub-InvestigationPanel")).toBeInTheDocument();
      expect(mountCounts["InvestigationPanel"]).toBe(1);

      fireEvent.click(
        within(banner).getByRole("button", { name: "Try again" }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    test("the refresh banner can be dismissed", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("Gateway timeout"));
      });

      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });

      const banner: HTMLElement = await screen.findByRole("alert");

      fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("an older refresh that answers last cannot overwrite a newer one", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      pageCase.renderPage();
      await waitForPage();

      const older: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      const newer: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();

      getItemMock
        .mockImplementationOnce(() => {
          return older.promise;
        })
        .mockImplementationOnce(() => {
          return newer.promise;
        });

      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });
      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });

      await act(async () => {
        newer.resolve(pageCase.buildEvent("Newest title"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Newest title");
      });

      await act(async () => {
        older.resolve(pageCase.buildEvent("Stale title"));
      });

      expect(latestProps<ChangeStateProps>(pageCase.changeStateKey).title).toBe(
        "Newest title",
      );
    });
  });

  /*
   * The overview is an index route inside the event's layout, and the AI
   * report links one event to another on the same route, so following such a
   * link re-renders this page with a new id instead of remounting it. The
   * first render for the new id used to hand every card the new id over the
   * previous event's header and numbers (each card firing its requests) before
   * an effect flipped the page back to its skeleton and the cards fetched
   * again once the new event landed.
   */
  describe("moving to another event on the same route", () => {
    type ServeOtherFunction = (
      otherItem: Promise<Incident | Alert>,
      fallbackTitle: string,
    ) => void;

    // The next event's row answers when the test says; the first one's at once.
    const serveOther: ServeOtherFunction = (
      otherItem: Promise<Incident | Alert>,
      fallbackTitle: string,
    ): void => {
      getItemMock.mockImplementation((...args: Array<unknown>) => {
        if (itemRequestId(args) === OTHER_EVENT_ID) {
          return otherItem;
        }

        return Promise.resolve(pageCase.buildEvent(fallbackTitle));
      });
    };

    test("shows the skeleton at once and mounts no card for the new id before its data lands", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const view: RenderResult = pageCase.renderPage();
      await waitForPage();
      await flush();

      expect(mountCounts["InvestigationPanel"]).toBe(1);

      const otherItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      serveOther(otherItem.promise, "Checkout slow");

      const readsBefore: number = countItemReads();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());

      // Straight after the re-render: the skeleton, and not one card.
      expect(screen.getByRole("status")).toHaveTextContent(
        `Loading ${pageCase.noun}`,
      );
      expect(screen.queryByTestId("stub-InvestigationPanel")).toBeNull();
      expect(
        screen.queryByTestId(`stub-${pageCase.changeStateKey}`),
      ).toBeNull();
      expect(
        screen.queryByRole("group", { name: pageCase.statBarName }),
      ).toBeNull();

      await waitFor(() => {
        expect(countItemReads()).toBe(readsBefore + 1);
      });
      await flush();

      expect(itemRequestId(getItemMock.mock.calls[readsBefore]!)).toBe(
        OTHER_EVENT_ID,
      );
      // No card rendered (and so none fetched) for the new id yet.
      expect(stubsRenderedWithId(OTHER_EVENT_ID)).toEqual([]);
      expect(mountCounts["InvestigationPanel"]).toBe(1);

      await act(async () => {
        otherItem.resolve(pageCase.buildEvent("Payments failing"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Payments failing");
      });
      // Let the mount effects of that render run before counting mounts.
      await flush();

      // Exactly one mount per event: the first one's and the next one's.
      expect(mountCounts["InvestigationPanel"]).toBe(2);
      expect(mountCounts["Feed"]).toBe(2);
      expect(mountCounts[pageCase.changeStateKey]).toBe(2);
      expect(
        (
          latestProps<{ subjectId: ObjectID }>("InvestigationPanel")
            .subjectId as ObjectID
        ).toString(),
      ).toBe(OTHER_EVENT_ID);

      // The header never showed the previous event's title under the new id.
      const headerTitlesForOther: Array<string | undefined> = propsHistory<
        ChangeStateProps & Record<string, unknown>
      >(pageCase.changeStateKey)
        .filter((props: ChangeStateProps & Record<string, unknown>) => {
          const id: unknown = props["incidentId"] || props["alertId"];
          return id instanceof ObjectID && id.toString() === OTHER_EVENT_ID;
        })
        .map((props: ChangeStateProps) => {
          return props.title;
        });

      expect(headerTitlesForOther.length).toBeGreaterThan(0);
      expect(new Set(headerTitlesForOther)).toEqual(
        new Set(["Payments failing"]),
      );
    });

    test("a background refresh of the previous event that answers late is ignored", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const view: RenderResult = pageCase.renderPage();
      await waitForPage();

      const lateRefresh: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      const otherItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        return itemRequestId(args) === OTHER_EVENT_ID
          ? otherItem.promise
          : lateRefresh.promise;
      });

      // A refresh of the first event is in flight when the reader moves on.
      act(() => {
        latestProps<ChangeStateProps>(
          pageCase.changeStateKey,
        ).onActionComplete();
      });

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());
      await flush();

      await act(async () => {
        lateRefresh.resolve(pageCase.buildEvent("Stale title"));
      });
      await flush();

      expect(screen.getByRole("status")).toHaveTextContent(
        `Loading ${pageCase.noun}`,
      );
      expect(stubsRenderedWithId(OTHER_EVENT_ID)).toEqual([]);

      await act(async () => {
        otherItem.resolve(pageCase.buildEvent("Payments failing"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Payments failing");
      });
      // Let the mount effects of that render run before counting mounts.
      await flush();

      expect(
        propsHistory<ChangeStateProps>(pageCase.changeStateKey).map(
          (props: ChangeStateProps) => {
            return props.title;
          },
        ),
      ).not.toContain("Stale title");
      expect(mountCounts["InvestigationPanel"]).toBe(2);
    });

    test("a first load of the previous event that answers after the switch is ignored", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const firstItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      const otherItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        return itemRequestId(args) === OTHER_EVENT_ID
          ? otherItem.promise
          : firstItem.promise;
      });

      const view: RenderResult = pageCase.renderPage();
      await flush();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());
      await flush();

      await act(async () => {
        firstItem.resolve(pageCase.buildEvent("Left behind"));
      });
      await flush();

      // Still loading the event the reader is on; nothing mounted at all.
      expect(screen.getByRole("status")).toHaveTextContent(
        `Loading ${pageCase.noun}`,
      );
      expect(mountCounts["InvestigationPanel"]).toBeUndefined();

      await act(async () => {
        otherItem.resolve(pageCase.buildEvent("Payments failing"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Payments failing");
      });
      // Let the mount effects of that render run before counting mounts.
      await flush();

      expect(mountCounts["InvestigationPanel"]).toBe(1);
      expect(
        propsHistory<ChangeStateProps>(pageCase.changeStateKey).map(
          (props: ChangeStateProps) => {
            return props.title;
          },
        ),
      ).not.toContain("Left behind");
    });

    test("a failed first load of the next event shows its error, not the previous event", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const view: RenderResult = pageCase.renderPage();
      await waitForPage();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        return itemRequestId(args) === OTHER_EVENT_ID
          ? Promise.reject(new Error("The database is asleep"))
          : Promise.resolve(pageCase.buildEvent("Checkout slow"));
      });

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());

      expect(
        await screen.findByText("The database is asleep"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("stub-InvestigationPanel")).toBeNull();
      expect(stubsRenderedWithId(OTHER_EVENT_ID)).toEqual([]);

      serve(pageCase, {
        timeline: REOPENED_TIMELINE,
        title: "Payments failing",
      });
      fireEvent.click(screen.getByTestId("refresh-button"));

      await waitForPage();

      expect(screen.queryByText("The database is asleep")).toBeNull();
      expect(latestProps<ChangeStateProps>(pageCase.changeStateKey).title).toBe(
        "Payments failing",
      );
    });

    test("a refresh fired late by a card of the previous event cannot cancel the next event's load", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const view: RenderResult = pageCase.renderPage();
      await waitForPage();

      // Handed to the previous event's header; it can still call it later.
      const previousOnActionComplete: () => void =
        latestProps<ChangeStateProps>(pageCase.changeStateKey).onActionComplete;

      const otherItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      serveOther(otherItem.promise, "Stale title");

      const readsBefore: number = countItemReads();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());

      await waitFor(() => {
        expect(countItemReads()).toBe(readsBefore + 1);
      });

      // e.g. a state change on the previous event whose save lands now.
      act(() => {
        previousOnActionComplete();
      });
      await flush();

      // It read nothing: the previous event is not on screen any more.
      expect(countItemReads()).toBe(readsBefore + 1);

      await act(async () => {
        otherItem.resolve(pageCase.buildEvent("Payments failing"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Payments failing");
      });
      // Let the mount effects of that render run before counting mounts.
      await flush();

      expect(
        propsHistory<ChangeStateProps>(pageCase.changeStateKey).map(
          (props: ChangeStateProps) => {
            return props.title;
          },
        ),
      ).not.toContain("Stale title");
    });

    test("the AI status and summary of the previous event never reach the next one's header", async () => {
      serve(pageCase, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

      const view: RenderResult = pageCase.renderPage();
      await waitForPage();

      const previousPanel: InvestigationPanelProps =
        latestProps<InvestigationPanelProps>("InvestigationPanel");

      act(() => {
        previousPanel.onStatusChange(AIRunStatus.Completed);
        previousPanel.onReportSummaryChange("Pool exhaustion in checkout-api.");
      });

      const otherItem: Deferred<Incident | Alert> = createDeferred<
        Incident | Alert
      >();
      serveOther(otherItem.promise, "Checkout slow");

      currentEventId = OTHER_EVENT_ID;
      view.rerender(pageCase.pageElement());
      await flush();

      await act(async () => {
        otherItem.resolve(pageCase.buildEvent("Payments failing"));
      });

      await waitFor(() => {
        expect(
          latestProps<ChangeStateProps>(pageCase.changeStateKey).title,
        ).toBe("Payments failing");
      });
      // Let the mount effects of that render run before counting mounts.
      await flush();

      const header: ChangeStateProps = latestProps<ChangeStateProps>(
        pageCase.changeStateKey,
      );

      expect(header.aiInvestigationStatus).toBeNull();
      expect(header.aiInvestigationSummary).toBeNull();
    });
  });
});

describe("incident-only behaviour", () => {
  test("the header names who declared the incident once the details card has read it", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    expect(factLabelsOf(INCIDENT_CASE)).not.toContain("Declared by");

    const incident: Incident = new Incident();
    const probe: Probe = new Probe();
    probe.name = "Probe US";
    incident.createdByProbe = probe;

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Incident Details")
        .modelDetailProps.onItemLoaded!(incident);
    });

    const declaredBy: EventStatusFact | undefined = factsOf(INCIDENT_CASE).find(
      (fact: EventStatusFact) => {
        return fact.label === "Declared by";
      },
    );

    expect(declaredBy?.value).toBe("Probe US");
  });

  test("the header lists affected monitors as links, with a count past two", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    const buildMonitor: (id: string, name: string) => Monitor = (
      id: string,
      name: string,
    ): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.id = new ObjectID(id);
      monitor.name = name;
      return monitor;
    };

    const incident: Incident = new Incident();
    incident.monitors = [buildMonitor(MONITOR_ID, "checkout-api")];

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Affected Resources")
        .modelDetailProps.onItemLoaded!(incident);
    });

    let monitorFact: EventStatusFact | undefined = factsOf(INCIDENT_CASE).find(
      (fact: EventStatusFact) => {
        return fact.label === "Monitor";
      },
    );

    expect(monitorFact).toBeDefined();

    const single: ReturnType<typeof render> = render(<>{monitorFact!.value}</>);
    const link: HTMLElement = within(single.container).getByRole("link", {
      name: "checkout-api",
    });

    expect(link.getAttribute("href")).toContain(MONITOR_ID);
    single.unmount();

    incident.monitors = [
      buildMonitor(MONITOR_ID, "checkout-api"),
      buildMonitor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "payments-api"),
      buildMonitor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", "search-api"),
      buildMonitor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", "cart-api"),
    ];

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Affected Resources")
        .modelDetailProps.onItemLoaded!(incident);
    });

    monitorFact = factsOf(INCIDENT_CASE).find((fact: EventStatusFact) => {
      return fact.label === "Monitors";
    });

    const several: ReturnType<typeof render> = render(
      <>{monitorFact!.value}</>,
    );

    expect(within(several.container).getAllByRole("link")).toHaveLength(2);
    expect(several.container).toHaveTextContent(
      "checkout-api, payments-api +2 more",
    );
  });

  test("an incident with no monitors gets no monitor fact", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Affected Resources")
        .modelDetailProps.onItemLoaded!(new Incident());
    });

    expect(factLabelsOf(INCIDENT_CASE)).not.toContain("Monitor");
    expect(factLabelsOf(INCIDENT_CASE)).not.toContain("Monitors");
  });

  test("a role change refreshes only the feed", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    const readsBefore: number = countItemReads();
    const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
      "Feed",
    ).refreshToken;

    await act(async () => {
      await latestProps<{ onMemberChange: () => Promise<void> }>(
        "Roles",
      ).onMemberChange();
    });

    expect(countItemReads()).toBe(readsBefore);
    expect(latestProps<{ refreshToken: number }>("Feed").refreshToken).toBe(
      feedTokenBefore + 1,
    );
    expect(mountCounts["Roles"]).toBe(1);
  });

  test("resending subscriber notifications re-reads only the details card", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    const details: CardModelDetailProps = latestProps<CardModelDetailProps>(
      "CardModelDetail:Incident Details",
    );
    const refresherBefore: boolean | undefined = details.refresher;
    const statusField: DetailFieldProps | undefined =
      details.modelDetailProps.fields.find((field: DetailFieldProps) => {
        return field.title === "Subscriber Notification Status";
      });

    const incident: Incident = new Incident();
    incident.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Failed;

    render(statusField!.getElement!(incident));

    const readsBefore: number = countItemReads();

    await act(async () => {
      latestProps<{ onResendNotification: () => void }>(
        "SubscriberNotificationStatus",
      ).onResendNotification();
    });

    await waitFor(() => {
      expect(
        latestProps<CardModelDetailProps>("CardModelDetail:Incident Details")
          .refresher,
      ).toBe(!refresherBefore);
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data,
    ).toEqual({
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessage: "Notification queued for resending",
    });
    expect(countItemReads()).toBe(readsBefore);
    expect(mountCounts["InvestigationPanel"]).toBe(1);
  });

  /*
   * The details card is stubbed, so the status row is rendered here from the
   * card's latest props, the way the real card renders it on every page
   * render.
   */
  type RenderStatusFieldFunction = () => RenderResult;

  const renderStatusField: RenderStatusFieldFunction = (): RenderResult => {
    const statusField: DetailFieldProps | undefined =
      latestProps<CardModelDetailProps>(
        "CardModelDetail:Incident Details",
      ).modelDetailProps.fields.find((field: DetailFieldProps) => {
        return field.title === "Subscriber Notification Status";
      });

    const incident: Incident = new Incident();
    incident.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Failed;

    return render(statusField!.getElement!(incident));
  };

  type ResendFunction = () => Promise<void>;

  const resend: ResendFunction = async (): Promise<void> => {
    await act(async () => {
      latestProps<{ onResendNotification: () => void }>(
        "SubscriberNotificationStatus",
      ).onResendNotification();
    });
    await flush();
  };

  test("a failed resend shows under the notification status, not as a refresh failure", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    let status: RenderResult = renderStatusField();

    updateByIdMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("Not allowed"));
    });

    await resend();

    status.unmount();
    status = renderStatusField();

    expect(within(status.container).getByRole("alert")).toHaveTextContent(
      "Could not resend notifications: Not allowed",
    );
    // It is the only alert: the page's refresh banner did not claim it.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(/Could not refresh this incident/)).toBeNull();
    expect(screen.getByTestId("stub-InvestigationPanel")).toBeInTheDocument();
    expect(mountCounts["InvestigationPanel"]).toBe(1);
  });

  test("a successful page refresh keeps the resend error, and a successful resend clears it", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    INCIDENT_CASE.renderPage();
    await waitForPage();

    let status: RenderResult = renderStatusField();

    updateByIdMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("Not allowed"));
    });

    await resend();

    // A refresh does not retry the resend, so it must not hide that it failed.
    const readsBefore: number = countItemReads();

    act(() => {
      latestProps<ChangeStateProps>(
        INCIDENT_CASE.changeStateKey,
      ).onActionComplete();
    });

    await waitFor(() => {
      expect(countItemReads()).toBe(readsBefore + 1);
    });
    await flush();

    status.unmount();
    status = renderStatusField();

    expect(within(status.container).getByRole("alert")).toHaveTextContent(
      "Could not resend notifications: Not allowed",
    );

    // Resending again, successfully, clears it.
    await resend();

    status.unmount();
    status = renderStatusField();

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(within(status.container).queryByRole("alert")).toBeNull();
  });

  test("a failed resend belongs to its incident and is not shown on the next one", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    const view: RenderResult = INCIDENT_CASE.renderPage();
    await waitForPage();

    let status: RenderResult = renderStatusField();

    updateByIdMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("Not allowed"));
    });

    await resend();

    status.unmount();
    status = renderStatusField();

    // Shown for the incident it failed on...
    expect(within(status.container).getByRole("alert")).toHaveTextContent(
      "Could not resend notifications: Not allowed",
    );

    status.unmount();

    // ...and gone once the reader is on another incident.
    currentEventId = OTHER_EVENT_ID;
    view.rerender(INCIDENT_CASE.pageElement());

    await waitFor(() => {
      expect(
        stubsRenderedWithId(OTHER_EVENT_ID).includes("InvestigationPanel"),
      ).toBe(true);
    });

    status = renderStatusField();

    expect(within(status.container).queryByRole("alert")).toBeNull();
  });

  test("header facts reported for the previous incident never show on the next", async () => {
    serve(INCIDENT_CASE, {
      timeline: REOPENED_TIMELINE,
      title: "Checkout slow",
    });

    const view: RenderResult = INCIDENT_CASE.renderPage();
    await waitForPage();

    const previousDetails: CardModelDetailProps =
      latestProps<CardModelDetailProps>("CardModelDetail:Incident Details");
    const previousResources: CardModelDetailProps =
      latestProps<CardModelDetailProps>("CardModelDetail:Affected Resources");

    const declaredByProbe: (name: string) => Incident = (
      name: string,
    ): Incident => {
      const incident: Incident = new Incident();
      const probe: Probe = new Probe();
      probe.name = name;
      incident.createdByProbe = probe;
      return incident;
    };

    const withMonitor: Incident = new Incident();
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(MONITOR_ID);
    monitor.name = "checkout-api";
    withMonitor.monitors = [monitor];

    act(() => {
      previousDetails.modelDetailProps.onItemLoaded!(
        declaredByProbe("Probe US"),
      );
      previousResources.modelDetailProps.onItemLoaded!(withMonitor);
    });

    expect(factLabelsOf(INCIDENT_CASE)).toEqual([
      "Declared",
      "Declared by",
      "Monitor",
    ]);

    const otherItem: Deferred<Incident | Alert> = createDeferred<
      Incident | Alert
    >();

    getItemMock.mockImplementation((...args: Array<unknown>) => {
      return itemRequestId(args) === OTHER_EVENT_ID
        ? otherItem.promise
        : Promise.resolve(INCIDENT_CASE.buildEvent("Checkout slow"));
    });

    currentEventId = OTHER_EVENT_ID;
    view.rerender(INCIDENT_CASE.pageElement());
    await flush();

    // The previous incident's cards report in late, after the switch.
    act(() => {
      previousDetails.modelDetailProps.onItemLoaded!(
        declaredByProbe("Probe EU"),
      );
      previousResources.modelDetailProps.onItemLoaded!(withMonitor);
    });

    await act(async () => {
      otherItem.resolve(INCIDENT_CASE.buildEvent("Payments failing"));
    });

    await waitFor(() => {
      expect(
        latestProps<ChangeStateProps>(INCIDENT_CASE.changeStateKey).title,
      ).toBe("Payments failing");
    });

    // Every header render for the new incident carried only its own facts.
    for (const props of propsHistory<
      ChangeStateProps & Record<string, unknown>
    >(INCIDENT_CASE.changeStateKey)) {
      if ((props["incidentId"] as ObjectID).toString() !== OTHER_EVENT_ID) {
        continue;
      }

      expect(
        (props.facts || []).map((fact: EventStatusFact) => {
          return fact.label;
        }),
      ).toEqual(["Declared"]);
    }

    // Its own cards still report in as usual.
    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Incident Details")
        .modelDetailProps.onItemLoaded!(declaredByProbe("Probe AP"));
    });

    expect(
      factsOf(INCIDENT_CASE).find((fact: EventStatusFact) => {
        return fact.label === "Declared by";
      })?.value,
    ).toBe("Probe AP");
  });
});

describe("alert-only behaviour", () => {
  test("the header shows the monitor and episode once the details card has read them", async () => {
    serve(ALERT_CASE, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

    ALERT_CASE.renderPage();
    await waitForPage();

    expect(factLabelsOf(ALERT_CASE)).toEqual(["Created"]);

    const alert: Alert = new Alert();
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(MONITOR_ID);
    monitor.name = "checkout-api";
    alert.monitor = monitor;

    const episode: AlertEpisode = new AlertEpisode();
    episode.id = new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
    episode.title = "Checkout errors across regions";
    alert.alertEpisode = episode;

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Alert Details")
        .modelDetailProps.onItemLoaded!(alert);
    });

    expect(factLabelsOf(ALERT_CASE)).toEqual(["Created", "Monitor", "Episode"]);

    const facts: Array<EventStatusFact> = factsOf(ALERT_CASE);
    const rendered: ReturnType<typeof render> = render(
      <>
        {facts[1]!.value}
        {facts[2]!.value}
      </>,
    );

    expect(
      within(rendered.container).getByTestId("monitor-element"),
    ).toHaveTextContent("checkout-api");
    expect(
      within(rendered.container).getByTestId("episode-element"),
    ).toHaveTextContent("Checkout errors across regions");
  });

  test("an alert outside any episode gets no episode fact", async () => {
    serve(ALERT_CASE, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

    ALERT_CASE.renderPage();
    await waitForPage();

    act(() => {
      latestProps<CardModelDetailProps>("CardModelDetail:Alert Details")
        .modelDetailProps.onItemLoaded!(new Alert());
    });

    expect(factLabelsOf(ALERT_CASE)).toEqual(["Created"]);
  });

  test("the episode row never selects columns a relation query cannot read", async () => {
    serve(ALERT_CASE, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

    ALERT_CASE.renderPage();
    await waitForPage();

    const episodeField: DetailFieldProps | undefined =
      latestProps<CardModelDetailProps>(
        "CardModelDetail:Alert Details",
      ).modelDetailProps.fields.find((field: DetailFieldProps) => {
        return field.title === "Episode";
      });

    expect(episodeField?.field).toEqual({
      alertEpisode: { title: true, _id: true },
    });
  });

  test("the monitor and episode reported for the previous alert never show on the next", async () => {
    serve(ALERT_CASE, { timeline: REOPENED_TIMELINE, title: "Checkout slow" });

    const view: RenderResult = ALERT_CASE.renderPage();
    await waitForPage();

    const previousDetails: CardModelDetailProps =
      latestProps<CardModelDetailProps>("CardModelDetail:Alert Details");

    const previousAlert: Alert = new Alert();
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(MONITOR_ID);
    monitor.name = "checkout-api";
    previousAlert.monitor = monitor;

    const episode: AlertEpisode = new AlertEpisode();
    episode.id = new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
    episode.title = "Checkout errors across regions";
    previousAlert.alertEpisode = episode;

    act(() => {
      previousDetails.modelDetailProps.onItemLoaded!(previousAlert);
    });

    expect(factLabelsOf(ALERT_CASE)).toEqual(["Created", "Monitor", "Episode"]);

    const otherItem: Deferred<Incident | Alert> = createDeferred<
      Incident | Alert
    >();

    getItemMock.mockImplementation((...args: Array<unknown>) => {
      return itemRequestId(args) === OTHER_EVENT_ID
        ? otherItem.promise
        : Promise.resolve(ALERT_CASE.buildEvent("Checkout slow"));
    });

    currentEventId = OTHER_EVENT_ID;
    view.rerender(ALERT_CASE.pageElement());
    await flush();

    // The previous alert's details card reports in late, after the switch.
    act(() => {
      previousDetails.modelDetailProps.onItemLoaded!(previousAlert);
    });

    await act(async () => {
      otherItem.resolve(ALERT_CASE.buildEvent("Payments failing"));
    });

    await waitFor(() => {
      expect(
        latestProps<ChangeStateProps>(ALERT_CASE.changeStateKey).title,
      ).toBe("Payments failing");
    });

    for (const props of propsHistory<
      ChangeStateProps & Record<string, unknown>
    >(ALERT_CASE.changeStateKey)) {
      if ((props["alertId"] as ObjectID).toString() !== OTHER_EVENT_ID) {
        continue;
      }

      expect(
        (props.facts || []).map((fact: EventStatusFact) => {
          return fact.label;
        }),
      ).toEqual(["Created"]);
    }
  });
});
