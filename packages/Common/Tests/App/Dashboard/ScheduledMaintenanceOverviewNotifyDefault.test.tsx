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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The scheduled maintenance overview page, rendered for real with every heavy
 * card stubbed. An event created without notifying status page subscribers
 * ("Event Created: Notify Status Page Subscribers" unticked) must hand the
 * feed a "notify subscribers" default of false, so a public note posted from
 * it starts unticked; everything else keeps notifying. The state change
 * header gets the event's subscriber notification settings instead - Event
 * Created, Event Ongoing and Event Ended - because moving a quiet event to
 * ongoing or ended by hand also follows that change's own setting.
 */

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
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState",
  () => {
    return stubModule("ChangeScheduledMaintenanceState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed",
  () => {
    return stubModule("ScheduledMaintenanceFeed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/EntityRunbooks",
  () => {
    return stubModule("Runbooks");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return stubModule("CustomFields");
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
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagesElement",
  () => {
    return stubModule("StatusPagesElement");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus",
  () => {
    return stubModule("SubscriberNotificationStatus");
  },
);

import ScheduledMaintenanceView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault, {
  ScheduledMaintenanceStateChangeSubscriberNotificationSetting,
  ScheduledMaintenanceTargetState,
} from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Navigation from "../../../UI/Utils/Navigation";

const EVENT_ID: string = "66666666-6666-4666-8666-666666666666";
const OTHER_EVENT_ID: string = "77777777-7777-4777-8777-777777777777";

const HOUR: number = 60 * 60 * 1000;

const CHANGE_STATE_KEY: string = "ChangeScheduledMaintenanceState";
const FEED_KEY: string = "ScheduledMaintenanceFeed";
const NOTIFY_ON_CREATE_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnEventCreated";
const NOTIFY_ON_ONGOING_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing";
const NOTIFY_ON_ENDED_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded";

const ONGOING_TARGET: ScheduledMaintenanceTargetState = {
  isOngoingState: true,
};
const ENDED_TARGET: ScheduledMaintenanceTargetState = { isEndedState: true };
const RESOLVED_TARGET: ScheduledMaintenanceTargetState = {
  isResolvedState: true,
};
// A custom state, with none of the flags.
const CUSTOM_TARGET: ScheduledMaintenanceTargetState = {};

const pageProps: PageComponentProps = {
  pageRoute: new Route("/scheduled-maintenance-events"),
  currentProject: null,
  hasPaymentMethod: false,
} as unknown as PageComponentProps;

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
  scheduledMaintenanceId?: ObjectID;
  notifyStatusPageSubscribersByDefault?: boolean;
  subscriberNotificationSettings?: ScheduledMaintenanceStateChangeSubscriberNotificationSetting;
  title?: string;
  refreshToken?: number;
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

function propsFor(key: string, eventId: string): Array<NotifyDefaultProps> {
  return propsHistory(key).filter((props: NotifyDefaultProps): boolean => {
    return props.scheduledMaintenanceId?.toString() === eventId;
  });
}

// Every notify default the feed was rendered with for the given event.
function notifyDefaultsFor(
  key: string,
  eventId: string,
): Array<boolean | undefined> {
  return propsFor(key, eventId).map(
    (props: NotifyDefaultProps): boolean | undefined => {
      return props.notifyStatusPageSubscribersByDefault;
    },
  );
}

/*
 * The three settings the header was handed, as "created/ongoing/ended", so
 * a render with any of them different stands out.
 */
function describeSettings(
  settings:
    | ScheduledMaintenanceStateChangeSubscriberNotificationSetting
    | undefined,
): string {
  return [
    settings?.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    settings?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    settings?.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
  ]
    .map((value: boolean | null | undefined): string => {
      return String(value);
    })
    .join("/");
}

// Every set of settings the header was rendered with for the given event.
function headerSettingsFor(eventId: string): Array<string> {
  return propsFor(CHANGE_STATE_KEY, eventId).map(
    (props: NotifyDefaultProps): string => {
      return describeSettings(props.subscriberNotificationSettings);
    },
  );
}

// Where the header's form would start for a move to the given state.
function headerStartsTicked(
  targetState: ScheduledMaintenanceTargetState,
): boolean {
  return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange(
    latestProps(CHANGE_STATE_KEY).subscriberNotificationSettings,
    targetState,
  );
}

interface EventRow {
  id?: string;
  title?: string;
  // Each flag is left out of the row entirely when its key is absent.
  notifyOnCreate?: boolean | null;
  notifyOnOngoing?: boolean | null;
  notifyOnEnded?: boolean | null;
  statusPageNames?: Array<string>;
}

const buildEvent: (row: EventRow) => ScheduledMaintenance = (
  row: EventRow,
): ScheduledMaintenance => {
  const now: number = Date.now();
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event.id = new ObjectID(row.id || EVENT_ID);
  event.title = row.title || "Primary database failover drill";
  event.scheduledMaintenanceNumber = 58;
  event.scheduledMaintenanceNumberWithPrefix = "#58";
  event.startsAt = new Date(now + 2 * HOUR);
  event.endsAt = new Date(now + 4 * HOUR);
  event.statusPages = (row.statusPageNames || ["Acme Public"]).map(
    (name: string): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage.name = name;
      return statusPage;
    },
  );

  if (Object.prototype.hasOwnProperty.call(row, "notifyOnCreate")) {
    event.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      row.notifyOnCreate as boolean;
  }

  if (Object.prototype.hasOwnProperty.call(row, "notifyOnOngoing")) {
    event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
      row.notifyOnOngoing as boolean;
  }

  if (Object.prototype.hasOwnProperty.call(row, "notifyOnEnded")) {
    event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
      row.notifyOnEnded as boolean;
  }

  return event;
};

type ServeFunction = (row: EventRow) => void;

const serve: ServeFunction = (row: EventRow): void => {
  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildEvent(row));
  });

  updateByIdMock.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
};

const renderPage: () => RenderResult = (): RenderResult => {
  return render(<ScheduledMaintenanceView {...pageProps} />);
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

interface EventItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

const eventItemRequests: () => Array<EventItemRequest> =
  (): Array<EventItemRequest> => {
    return getItemMock.mock.calls
      .map((args: Array<unknown>): EventItemRequest => {
        return args[0] as EventItemRequest;
      })
      .filter((request: EventItemRequest): boolean => {
        return request.modelType === ScheduledMaintenance;
      });
  };

// The id in the URL. Tests move the reader to another event by changing it.
let currentEventId: string = EVENT_ID;

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

describe("scheduled maintenance overview: where Notify Status Page Subscribers starts", () => {
  describe("reading the event", () => {
    test("selects the three notify settings in the same event read as the rest of the row", async () => {
      serve({ notifyOnCreate: false, notifyOnOngoing: true });

      renderPage();
      await waitForPage();

      const requests: Array<EventItemRequest> = eventItemRequests();

      // One read: the settings cost no request of their own.
      expect(requests).toHaveLength(1);
      expect(requests[0]!.id.toString()).toBe(EVENT_ID);
      expect(requests[0]!.select[NOTIFY_ON_CREATE_FIELD]).toBe(true);
      expect(requests[0]!.select[NOTIFY_ON_ONGOING_FIELD]).toBe(true);
      expect(requests[0]!.select[NOTIFY_ON_ENDED_FIELD]).toBe(true);
      // Still read alongside the header facts.
      expect(requests[0]!.select["title"]).toBe(true);
      expect(requests[0]!.select["startsAt"]).toBe(true);
      expect(requests[0]!.select["endsAt"]).toBe(true);
    });

    test("every refresh of the row selects the settings again", async () => {
      serve({ notifyOnCreate: false });

      renderPage();
      await waitForPage();

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(eventItemRequests()).toHaveLength(2);
      });

      for (const request of eventItemRequests()) {
        expect(request.select[NOTIFY_ON_CREATE_FIELD]).toBe(true);
        expect(request.select[NOTIFY_ON_ONGOING_FIELD]).toBe(true);
        expect(request.select[NOTIFY_ON_ENDED_FIELD]).toBe(true);
      }
    });
  });

  describe("handing the settings to the state change header and the default to the feed", () => {
    interface NotifyCase {
      name: string;
      row: EventRow;
      // The feed's public note default: the Event Created rule.
      expectedFeed: boolean;
      // The header's settings, as "created/ongoing/ended".
      expectedHeaderSettings: string;
      // Where the header's form starts for a move to each kind of state.
      expectedHeaderOngoing: boolean;
      expectedHeaderEnded: boolean;
      expectedHeaderCustom: boolean;
    }

    const cases: Array<NotifyCase> = [
      {
        name: "created quietly, announcing neither ongoing nor ended: every form starts unticked",
        row: {
          notifyOnCreate: false,
          notifyOnOngoing: false,
          notifyOnEnded: false,
        },
        expectedFeed: false,
        expectedHeaderSettings: "false/false/false",
        expectedHeaderOngoing: false,
        expectedHeaderEnded: false,
        expectedHeaderCustom: false,
      },
      {
        name: "created quietly, announcing ongoing and ended: the feed stays unticked, marking it ongoing or ended starts ticked",
        row: {
          notifyOnCreate: false,
          notifyOnOngoing: true,
          notifyOnEnded: true,
        },
        expectedFeed: false,
        expectedHeaderSettings: "false/true/true",
        expectedHeaderOngoing: true,
        expectedHeaderEnded: true,
        expectedHeaderCustom: false,
      },
      {
        name: "created quietly, announcing only ongoing: only marking it ongoing starts ticked",
        row: {
          notifyOnCreate: false,
          notifyOnOngoing: true,
          notifyOnEnded: false,
        },
        expectedFeed: false,
        expectedHeaderSettings: "false/true/false",
        expectedHeaderOngoing: true,
        expectedHeaderEnded: false,
        expectedHeaderCustom: false,
      },
      {
        name: "created with subscribers notified, announcing neither: every form starts ticked",
        row: {
          notifyOnCreate: true,
          notifyOnOngoing: false,
          notifyOnEnded: false,
        },
        expectedFeed: true,
        expectedHeaderSettings: "true/false/false",
        expectedHeaderOngoing: true,
        expectedHeaderEnded: true,
        expectedHeaderCustom: true,
      },
      {
        name: "flags missing from the row: every form keeps the long-standing ticked default",
        row: {},
        expectedFeed: true,
        expectedHeaderSettings: "undefined/undefined/undefined",
        expectedHeaderOngoing: true,
        expectedHeaderEnded: true,
        expectedHeaderCustom: true,
      },
      {
        name: "created flag read back as null: every form keeps the long-standing ticked default",
        row: {
          notifyOnCreate: null,
          notifyOnOngoing: false,
          notifyOnEnded: false,
        },
        expectedFeed: true,
        expectedHeaderSettings: "null/false/false",
        expectedHeaderOngoing: true,
        expectedHeaderEnded: true,
        expectedHeaderCustom: true,
      },
    ];

    test.each(cases)("$name", async (notifyCase: NotifyCase) => {
      serve(notifyCase.row);

      renderPage();
      await waitForPage();

      const header: NotifyDefaultProps = latestProps(CHANGE_STATE_KEY);
      const feed: NotifyDefaultProps = latestProps(FEED_KEY);

      // The header gets the loaded event itself, not a boolean.
      expect(header.subscriberNotificationSettings).toBeInstanceOf(
        ScheduledMaintenance,
      );
      expect(
        (
          header.subscriberNotificationSettings as ScheduledMaintenance
        ).id?.toString(),
      ).toBe(EVENT_ID);
      expect(describeSettings(header.subscriberNotificationSettings)).toBe(
        notifyCase.expectedHeaderSettings,
      );
      expect(header.notifyStatusPageSubscribersByDefault).toBeUndefined();

      expect(headerStartsTicked(ONGOING_TARGET)).toBe(
        notifyCase.expectedHeaderOngoing,
      );
      expect(headerStartsTicked(ENDED_TARGET)).toBe(
        notifyCase.expectedHeaderEnded,
      );
      expect(headerStartsTicked(RESOLVED_TARGET)).toBe(
        notifyCase.expectedHeaderEnded,
      );
      expect(headerStartsTicked(CUSTOM_TARGET)).toBe(
        notifyCase.expectedHeaderCustom,
      );

      // The feed keeps following only how the event was created.
      expect(feed.notifyStatusPageSubscribersByDefault).toBe(
        notifyCase.expectedFeed,
      );
      expect(feed.subscriberNotificationSettings).toBeUndefined();
      expect(header.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
      expect(feed.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);

      /*
       * Not one render with other values: the forms read their starting
       * value when they open, so settings that flipped after mount could
       * already have been used.
       */
      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set([notifyCase.expectedHeaderSettings]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, EVENT_ID))).toEqual(
        new Set([notifyCase.expectedFeed]),
      );
    });

    test("follows the stored flags rather than working them out from the status pages", async () => {
      // Shown on no status page at all, but created with subscribers notified.
      serve({ notifyOnCreate: true, statusPageNames: [] });

      renderPage();
      await waitForPage();

      expect(
        latestProps(CHANGE_STATE_KEY).subscriberNotificationSettings
          ?.shouldStatusPageSubscribersBeNotifiedOnEventCreated,
      ).toBe(true);
      expect(headerStartsTicked(CUSTOM_TARGET)).toBe(true);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        true,
      );
    });

    test("no card is rendered with a default before the event has loaded", async () => {
      const item: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();

      serve({ notifyOnCreate: false });
      getItemMock.mockImplementation(() => {
        return item.promise;
      });

      renderPage();
      await flush();

      expect(propsHistory(CHANGE_STATE_KEY)).toEqual([]);
      expect(propsHistory(FEED_KEY)).toEqual([]);

      await act(async () => {
        item.resolve(
          buildEvent({
            notifyOnCreate: false,
            notifyOnOngoing: true,
            notifyOnEnded: false,
          }),
        );
      });
      await waitForPage();

      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set(["false/true/false"]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, EVENT_ID))).toEqual(
        new Set([false]),
      );
    });
  });

  describe("background refresh", () => {
    test("a state change keeps a quiet event's settings without remounting a card", async () => {
      serve({
        notifyOnCreate: false,
        notifyOnOngoing: true,
        notifyOnEnded: false,
        title: "Failover drill",
      });

      renderPage();
      await waitForPage();

      serve({
        notifyOnCreate: false,
        notifyOnOngoing: true,
        notifyOnEnded: false,
        title: "Failover drill (ongoing)",
      });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(latestProps(CHANGE_STATE_KEY).title).toBe(
          "Failover drill (ongoing)",
        );
      });

      expect(latestProps(FEED_KEY).refreshToken).toBe(1);
      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set(["false/true/false"]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, EVENT_ID))).toEqual(
        new Set([false]),
      );
      expect(mountCounts[CHANGE_STATE_KEY]).toBe(1);
      expect(mountCounts[FEED_KEY]).toBe(1);
    });

    test("a refresh that reads different flags moves the header's settings and the feed's default with them", async () => {
      serve({
        notifyOnCreate: true,
        notifyOnOngoing: true,
        notifyOnEnded: true,
        title: "Failover drill",
      });

      renderPage();
      await waitForPage();

      expect(headerStartsTicked(ENDED_TARGET)).toBe(true);

      serve({
        notifyOnCreate: false,
        notifyOnOngoing: true,
        notifyOnEnded: false,
        title: "Failover drill (updated)",
      });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(latestProps(CHANGE_STATE_KEY).title).toBe(
          "Failover drill (updated)",
        );
      });

      expect(
        describeSettings(
          latestProps(CHANGE_STATE_KEY).subscriberNotificationSettings,
        ),
      ).toBe("false/true/false");
      expect(headerStartsTicked(ONGOING_TARGET)).toBe(true);
      expect(headerStartsTicked(ENDED_TARGET)).toBe(false);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
      expect(mountCounts[CHANGE_STATE_KEY]).toBe(1);
      expect(mountCounts[FEED_KEY]).toBe(1);
    });

    test("a failed refresh keeps the quiet settings instead of falling back to notifying", async () => {
      serve({
        notifyOnCreate: false,
        notifyOnOngoing: false,
        notifyOnEnded: false,
      });

      renderPage();
      await waitForPage();

      getItemMock.mockImplementationOnce(() => {
        return Promise.reject(new Error("Gateway timeout"));
      });

      act(() => {
        latestProps(CHANGE_STATE_KEY).onActionComplete!();
      });

      await waitFor(() => {
        expect(eventItemRequests()).toHaveLength(2);
      });
      await flush();

      // The page already on screen stays, cards and all.
      expect(
        screen.getByTestId(`stub-${CHANGE_STATE_KEY}`),
      ).toBeInTheDocument();
      expect(screen.getByTestId(`stub-${FEED_KEY}`)).toBeInTheDocument();
      expect(headerStartsTicked(ONGOING_TARGET)).toBe(false);
      expect(headerStartsTicked(ENDED_TARGET)).toBe(false);
      expect(latestProps(FEED_KEY).notifyStatusPageSubscribersByDefault).toBe(
        false,
      );
      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set(["false/false/false"]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, EVENT_ID))).toEqual(
        new Set([false]),
      );
      expect(mountCounts[CHANGE_STATE_KEY]).toBe(1);
    });
  });

  /*
   * Following a link to another event re-renders this page with a new id
   * instead of remounting it, so the previous event is still in state when
   * the next one starts loading.
   */
  describe("moving to another event on the same route", () => {
    type MoveFunction = (first: EventRow, next: EventRow) => Promise<void>;

    const moveBetween: MoveFunction = async (
      first: EventRow,
      next: EventRow,
    ): Promise<void> => {
      serve(first);

      const view: RenderResult = renderPage();
      await waitForPage();

      const nextItem: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();

      getItemMock.mockImplementation((...args: Array<unknown>) => {
        const request: EventItemRequest = args[0] as EventItemRequest;

        if (request.id.toString() === OTHER_EVENT_ID) {
          return nextItem.promise;
        }

        return Promise.resolve(buildEvent(first));
      });

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...pageProps} />);
      await flush();

      // Still loading: nothing rendered for the next event yet.
      expect(headerSettingsFor(OTHER_EVENT_ID)).toEqual([]);
      expect(notifyDefaultsFor(FEED_KEY, OTHER_EVENT_ID)).toEqual([]);

      await act(async () => {
        nextItem.resolve(buildEvent({ ...next, id: OTHER_EVENT_ID }));
      });

      await waitFor(() => {
        expect(latestProps(FEED_KEY).scheduledMaintenanceId?.toString()).toBe(
          OTHER_EVENT_ID,
        );
      });
      await flush();
    };

    test("from a quiet event to one that notified, the next one's settings apply from its first render", async () => {
      await moveBetween(
        {
          notifyOnCreate: false,
          notifyOnOngoing: false,
          notifyOnEnded: false,
          title: "Failover drill",
        },
        {
          notifyOnCreate: true,
          notifyOnOngoing: true,
          notifyOnEnded: true,
          title: "Network upgrade",
        },
      );

      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set(["false/false/false"]),
      );
      expect(new Set(headerSettingsFor(OTHER_EVENT_ID))).toEqual(
        new Set(["true/true/true"]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, OTHER_EVENT_ID))).toEqual(
        new Set([true]),
      );
    });

    test("from an event that notified to a quiet one, the next one's settings apply from its first render", async () => {
      await moveBetween(
        {
          notifyOnCreate: true,
          notifyOnOngoing: true,
          notifyOnEnded: true,
          title: "Failover drill",
        },
        {
          notifyOnCreate: false,
          notifyOnOngoing: false,
          notifyOnEnded: false,
          title: "Network upgrade",
        },
      );

      expect(new Set(headerSettingsFor(EVENT_ID))).toEqual(
        new Set(["true/true/true"]),
      );
      expect(new Set(headerSettingsFor(OTHER_EVENT_ID))).toEqual(
        new Set(["false/false/false"]),
      );
      expect(new Set(notifyDefaultsFor(FEED_KEY, OTHER_EVENT_ID))).toEqual(
        new Set([false]),
      );
    });
  });
});
