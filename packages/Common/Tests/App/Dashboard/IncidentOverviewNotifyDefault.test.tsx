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
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident overview page, rendered for real with every heavy card
 * stubbed. An incident declared without notifying status page subscribers
 * (the box unticked, or a private incident) must hand the state change
 * header and the feed a "notify subscribers" default of false, so a public
 * note posted from either starts unticked. Everything else keeps notifying.
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed",
  () => {
    return stubModule("IncidentFeed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel",
  () => {
    return stubModule("InvestigationPanel");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources",
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

import IncidentView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

const CHANGE_STATE_KEY: string = "ChangeIncidentState";
const FEED_KEY: string = "IncidentFeed";

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

interface NotifyDefaultProps {
  incidentId?: ObjectID;
  isPrivate?: boolean;
  notifyStatusPageSubscribersByDefault?: boolean;
  title?: string;
  onActionComplete?: () => void;
}

function propsHistory(key: string): Array<NotifyDefaultProps> {
  return (recordedProps[key] || []) as unknown as Array<NotifyDefaultProps>;
}

function latestProps(key: string): NotifyDefaultProps {
  const history: Array<NotifyDefaultProps> = propsHistory(key);

  if (history.length === 0) {
    throw new Error(`${key} was never rendered`);
  }

  return history[history.length - 1]!;
}

// Every notify default a stub was rendered with for the given incident.
function notifyDefaultsFor(
  key: string,
  incidentId: string,
): Array<boolean | undefined> {
  return propsHistory(key)
    .filter((props: NotifyDefaultProps): boolean => {
      return props.incidentId?.toString() === incidentId;
    })
    .map((props: NotifyDefaultProps): boolean | undefined => {
      return props.notifyStatusPageSubscribersByDefault;
    });
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

interface IncidentRow {
  id?: string;
  title?: string;
  isPrivate?: boolean;
  // Left out of the row entirely when the key is absent.
  notifyOnDeclare?: boolean | null;
}

const buildIncident: (row: IncidentRow) => Incident = (
  row: IncidentRow,
): Incident => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(row.id || INCIDENT_ID);
  incident.title = row.title || "Checkout slow";
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  incident.declaredAt = START;
  incident.isPrivate = row.isPrivate === true;

  if (Object.prototype.hasOwnProperty.call(row, "notifyOnDeclare")) {
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      row.notifyOnDeclare as boolean;
  }

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  severity.color = new Color("#ef4444");
  incident.incidentSeverity = severity;

  return incident;
};

const buildStates: () => Array<IncidentState> = (): Array<IncidentState> => {
  const created: IncidentState = new IncidentState();
  created.id = new ObjectID(CREATED_STATE_ID);
  created.name = "Created";
  created.isCreatedState = true;

  const acknowledged: IncidentState = new IncidentState();
  acknowledged.id = new ObjectID(ACKNOWLEDGED_STATE_ID);
  acknowledged.name = "Acknowledged";
  acknowledged.isAcknowledgedState = true;

  const resolved: IncidentState = new IncidentState();
  resolved.id = new ObjectID(RESOLVED_STATE_ID);
  resolved.name = "Resolved";
  resolved.isResolvedState = true;

  return [created, acknowledged, resolved];
};

const buildTimeline: () => Array<IncidentStateTimeline> =
  (): Array<IncidentStateTimeline> => {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.incidentStateId = new ObjectID(CREATED_STATE_ID);
    timeline.startsAt = START;
    return [timeline];
  };

type ServeFunction = (row: IncidentRow) => void;

const serve: ServeFunction = (row: IncidentRow): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentState) {
      return Promise.resolve(listResult(buildStates()));
    }

    if (request.modelType === IncidentStateTimeline) {
      return Promise.resolve(listResult(buildTimeline()));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });

  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildIncident(row));
  });

  updateByIdMock.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
};

const renderPage: () => RenderResult = (): RenderResult => {
  return render(<IncidentView {...pageProps} />);
};

type WaitForPageFunction = () => Promise<void>;

const waitForPage: WaitForPageFunction = async (): Promise<void> => {
  await screen.findByTestId(`stub-${FEED_KEY}`);
  await waitFor(() => {
    expect(mountCounts[FEED_KEY]).toBeGreaterThanOrEqual(1);
    expect(mountCounts[CHANGE_STATE_KEY]).toBeGreaterThanOrEqual(1);
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

interface IncidentItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

const incidentItemRequests: () => Array<IncidentItemRequest> =
  (): Array<IncidentItemRequest> => {
    return getItemMock.mock.calls
      .map((args: Array<unknown>): IncidentItemRequest => {
        return args[0] as IncidentItemRequest;
      })
      .filter((request: IncidentItemRequest): boolean => {
        return request.modelType === Incident;
      });
  };

// The id in the URL. Tests move the reader to another incident by changing it.
let currentIncidentId: string = INCIDENT_ID;

beforeEach(() => {
  currentIncidentId = INCIDENT_ID;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentIncidentId);
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

describe("incident overview: where Notify Status Page Subscribers starts", () => {
  describe("reading the incident", () => {
    test("selects the notify-on-declare flag in the same incident read as the rest of the row", async () => {
      serve({ notifyOnDeclare: false });

      renderPage();
      await waitForPage();

      const requests: Array<IncidentItemRequest> = incidentItemRequests();

      // One read: the flag costs no request of its own.
      expect(requests).toHaveLength(1);
      expect(requests[0]!.id.toString()).toBe(INCIDENT_ID);
      expect(
        requests[0]!.select[
          "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
        ],
      ).toBe(true);
      // Still read alongside the privacy flag the header needs.
      expect(requests[0]!.select["isPrivate"]).toBe(true);
    });

    test("every refresh of the row selects the flag again", async () => {
      serve({ notifyOnDeclare: false });

      renderPage();
      await waitForPage();

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(incidentItemRequests()).toHaveLength(2);
      });

      for (const request of incidentItemRequests()) {
        expect(
          request.select[
            "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
          ],
        ).toBe(true);
      }
    });
  });

  describe("handing the default to the state change header and the feed", () => {
    interface NotifyCase {
      name: string;
      row: IncidentRow;
      expected: boolean;
    }

    const cases: Array<NotifyCase> = [
      {
        name: "declared without notifying subscribers: both start unticked",
        row: { notifyOnDeclare: false, isPrivate: false },
        expected: false,
      },
      {
        name: "declared with subscribers notified: both start ticked",
        row: { notifyOnDeclare: true, isPrivate: false },
        expected: true,
      },
      {
        name: "flag missing from the row: both keep the long-standing ticked default",
        row: { isPrivate: false },
        expected: true,
      },
      {
        name: "flag read back as null: both keep the long-standing ticked default",
        row: { notifyOnDeclare: null, isPrivate: false },
        expected: true,
      },
      {
        name: "a private incident (declared quiet): both start unticked",
        row: { notifyOnDeclare: false, isPrivate: true },
        expected: false,
      },
    ];

    test.each(cases)("$name", async (notifyCase: NotifyCase) => {
      serve(notifyCase.row);

      renderPage();
      await waitForPage();

      const header: NotifyDefaultProps = latestProps(CHANGE_STATE_KEY);
      const feed: NotifyDefaultProps = latestProps(FEED_KEY);

      expect(header.notifyStatusPageSubscribersByDefault).toBe(
        notifyCase.expected,
      );
      expect(feed.notifyStatusPageSubscribersByDefault).toBe(
        notifyCase.expected,
      );
      expect(header.isPrivate).toBe(notifyCase.row.isPrivate === true);
      expect(header.incidentId?.toString()).toBe(INCIDENT_ID);
      expect(feed.incidentId?.toString()).toBe(INCIDENT_ID);

      /*
       * Not one render with the other value: the forms read their starting
       * value when they open, so a default that flipped after mount could
       * already have been used.
       */
      expect(new Set(notifyDefaultsFor(CHANGE_STATE_KEY, INCIDENT_ID))).toEqual(
        new Set([notifyCase.expected]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, INCIDENT_ID))).toEqual(
        new Set([notifyCase.expected]),
      );
    });

    test("follows the stored flag rather than working it out from privacy", async () => {
      // Made private after it was declared with subscribers notified.
      serve({ notifyOnDeclare: true, isPrivate: true });

      renderPage();
      await waitForPage();

      expect(latestProps(CHANGE_STATE_KEY).isPrivate).toBe(true);
      expect(
        latestProps(CHANGE_STATE_KEY).notifyStatusPageSubscribersByDefault,
      ).toBe(true);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        true,
      );
    });

    test("no card is rendered with a default before the incident has loaded", async () => {
      const item: Deferred<Incident> = createDeferred<Incident>();

      serve({ notifyOnDeclare: false });
      getItemMock.mockImplementation(() => {
        return item.promise;
      });

      renderPage();
      await flush();

      expect(propsHistory(CHANGE_STATE_KEY)).toEqual([]);
      expect(propsHistory(FEED_KEY)).toEqual([]);

      await act(async () => {
        item.resolve(buildIncident({ notifyOnDeclare: false }));
      });
      await waitForPage();

      expect(new Set(notifyDefaultsFor(CHANGE_STATE_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
    });
  });

  describe("background refresh", () => {
    test("a state change keeps a quiet incident's default unticked without remounting a card", async () => {
      serve({ notifyOnDeclare: false, title: "Checkout slow" });

      renderPage();
      await waitForPage();

      serve({ notifyOnDeclare: false, title: "Checkout slow (acknowledged)" });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(latestProps(CHANGE_STATE_KEY).title).toBe(
          "Checkout slow (acknowledged)",
        );
      });

      expect(new Set(notifyDefaultsFor(CHANGE_STATE_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
      expect(mountCounts[CHANGE_STATE_KEY]).toBe(1);
      expect(mountCounts[FEED_KEY]).toBe(1);
    });

    test("a refresh that reads a different flag moves both defaults with it", async () => {
      serve({ notifyOnDeclare: true, title: "Checkout slow" });

      renderPage();
      await waitForPage();

      expect(
        latestProps(CHANGE_STATE_KEY).notifyStatusPageSubscribersByDefault,
      ).toBe(true);

      serve({ notifyOnDeclare: false, title: "Checkout slow (updated)" });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(latestProps(CHANGE_STATE_KEY).title).toBe(
          "Checkout slow (updated)",
        );
      });

      expect(
        latestProps(CHANGE_STATE_KEY).notifyStatusPageSubscribersByDefault,
      ).toBe(false);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
    });

    test("a failed refresh keeps the quiet default instead of falling back to notifying", async () => {
      serve({ notifyOnDeclare: false });

      renderPage();
      await waitForPage();

      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("Gateway timeout"));
      });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not refresh this incident. Gateway timeout",
      );

      expect(
        latestProps(CHANGE_STATE_KEY).notifyStatusPageSubscribersByDefault,
      ).toBe(false);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
    });
  });

  /*
   * Following a link to another incident re-renders this page with a new id
   * instead of remounting it, so the previous incident's default is still in
   * state when the next one starts loading.
   */
  describe("moving to another incident on the same route", () => {
    type MoveFunction = (
      first: IncidentRow,
      next: IncidentRow,
    ) => Promise<void>;

    const moveBetween: MoveFunction = async (
      first: IncidentRow,
      next: IncidentRow,
    ): Promise<void> => {
      serve(first);

      const view: RenderResult = renderPage();
      await waitForPage();

      const nextItem: Deferred<Incident> = createDeferred<Incident>();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        const request: IncidentItemRequest = args[0] as IncidentItemRequest;

        if (request.id.toString() === OTHER_INCIDENT_ID) {
          return nextItem.promise;
        }

        return Promise.resolve(buildIncident(first));
      });

      currentIncidentId = OTHER_INCIDENT_ID;
      view.rerender(<IncidentView {...pageProps} />);
      await flush();

      // Still loading: nothing rendered for the next incident yet.
      expect(notifyDefaultsFor(CHANGE_STATE_KEY, OTHER_INCIDENT_ID)).toEqual(
        [],
      );
      expect(notifyDefaultsFor(FEED_KEY, OTHER_INCIDENT_ID)).toEqual([]);

      await act(async () => {
        nextItem.resolve(buildIncident({ ...next, id: OTHER_INCIDENT_ID }));
      });

      await waitFor(() => {
        expect(latestProps(FEED_KEY).incidentId?.toString()).toBe(
          OTHER_INCIDENT_ID,
        );
      });
      await flush();
    };

    test("from a quiet incident to one that notified, the next one starts ticked from its first render", async () => {
      await moveBetween(
        { notifyOnDeclare: false, title: "Checkout slow" },
        { notifyOnDeclare: true, title: "Payments failing" },
      );

      expect(new Set(notifyDefaultsFor(CHANGE_STATE_KEY, INCIDENT_ID))).toEqual(
        new Set([false]),
      );
      expect(
        new Set(notifyDefaultsFor(CHANGE_STATE_KEY, OTHER_INCIDENT_ID)),
      ).toEqual(new Set([true]));
      expect(new Set(notifyDefaultsFor(FEED_KEY, OTHER_INCIDENT_ID))).toEqual(
        new Set([true]),
      );
    });

    test("from an incident that notified to a quiet one, the next one starts unticked from its first render", async () => {
      await moveBetween(
        { notifyOnDeclare: true, title: "Checkout slow" },
        { notifyOnDeclare: false, title: "Payments failing" },
      );

      expect(new Set(notifyDefaultsFor(CHANGE_STATE_KEY, INCIDENT_ID))).toEqual(
        new Set([true]),
      );
      expect(
        new Set(notifyDefaultsFor(CHANGE_STATE_KEY, OTHER_INCIDENT_ID)),
      ).toEqual(new Set([false]));
      expect(new Set(notifyDefaultsFor(FEED_KEY, OTHER_INCIDENT_ID))).toEqual(
        new Set([false]),
      );
    });
  });
});
