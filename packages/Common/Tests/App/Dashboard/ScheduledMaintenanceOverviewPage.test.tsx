/**
 * @timezone UTC
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The scheduled maintenance overview page, rendered for real with its heavy
 * children replaced by recorders. It covers what only the page decides: the
 * first-load skeleton, that a refresh never unmounts the page, the error and
 * not-found states, the header facts and stat bar, the feed refresh signal,
 * the compact details card (including a resend failure that used to be
 * swallowed) and the full set of affected resource relations.
 */

const EVENT_ID: string = "66666666-6666-4666-8666-666666666666";
const OTHER_EVENT_ID: string = "77777777-7777-4777-8777-777777777777";

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const changeStateRenderMock: MockFunction = getJestMockFunction();
const changeStateMountMock: MockFunction = getJestMockFunction();
const feedRenderMock: MockFunction = getJestMockFunction();
const cardModelDetailRenderMock: MockFunction = getJestMockFunction();
const customFieldsRenderMock: MockFunction = getJestMockFunction();

// Which item each stubbed CardModelDetail renders its field elements against.
const detailItemsByCardName: Record<string, unknown> = {};

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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: string;
        onActionComplete: () => void;
      }): React.ReactElement => {
        changeStateRenderMock(props);
        React.useEffect(() => {
          changeStateMountMock();
        }, []);

        return React.createElement(
          "div",
          { "data-testid": "change-state" },
          React.createElement("h2", {}, props.title),
          React.createElement(
            "button",
            { type: "button", onClick: props.onActionComplete },
            "Complete action",
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed",
  () => {
    return {
      __esModule: true,
      default: (props: unknown): React.ReactElement => {
        feedRenderMock(props);
        return React.createElement("div", { "data-testid": "feed" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/EntityRunbooks",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "runbooks" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return {
      __esModule: true,
      default: (props: unknown): React.ReactElement => {
        customFieldsRenderMock(props);
        return React.createElement("div", { "data-testid": "custom-fields" });
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
      isAffectedResourcesPayload: (value: unknown): boolean => {
        return Boolean(
          value &&
            (value as { __affectedResourcesPayload?: boolean })
              .__affectedResourcesPayload,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "resources" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagesElement",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "status-pages" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onResendNotification: () => void;
      }): React.ReactElement => {
        return React.createElement(
          "button",
          { type: "button", onClick: props.onResendNotification },
          "Resend notifications",
        );
      },
    };
  },
);

/*
 * Renders each field's title, and its element when the test supplied an item
 * for that card, so element-typed fields are exercised for real.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      name: string;
      modelDetailProps: {
        fields: Array<{
          title?: string;
          getElement?: (item: unknown) => React.ReactElement;
        }>;
      };
    }): React.ReactElement => {
      cardModelDetailRenderMock(props);
      const item: unknown = detailItemsByCardName[props.name];

      return React.createElement(
        "section",
        { "data-testid": `card-${props.name}` },
        props.modelDetailProps.fields.map(
          (
            field: {
              title?: string;
              getElement?: (item: unknown) => React.ReactElement;
            },
            index: number,
          ): React.ReactElement => {
            return React.createElement(
              "div",
              { key: index, "data-testid": "detail-field" },
              React.createElement("span", {}, field.title),
              item && field.getElement ? field.getElement(item) : null,
            );
          },
        ),
      );
    },
  };
});

import ScheduledMaintenanceView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { DetailStyle } from "../../../UI/Components/Detail/Detail";
import Navigation from "../../../UI/Utils/Navigation";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: Error) => void) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
    reject: (error: Error): void => {
      rejectPromise!(error);
    },
  };
}

interface ChangeStateProps {
  eventNumber?: string;
  title?: string;
  eventStartsAt?: Date;
  eventEndsAt?: Date;
  facts?: Array<EventStatusFact>;
}

interface FeedProps {
  refreshToken?: number;
}

interface DetailField {
  title?: string;
  field: Record<string, unknown>;
  getElement?: (item: ScheduledMaintenance) => React.ReactElement;
  getCustomElement?: (
    values: Record<string, unknown>,
    elementProps: { onChange?: (value: unknown) => void },
  ) => React.ReactElement;
  onChange?: (
    value: unknown,
    currentValues: Record<string, unknown>,
    setNewFormValues: (values: Record<string, unknown>) => void,
  ) => void;
}

interface CardProps {
  name: string;
  refresher?: boolean;
  isEditable?: boolean;
  editButtonText?: string;
  cardProps: {
    title?: string;
    description?: string;
    headerLayout?: string;
  };
  formFields: Array<DetailField>;
  modelDetailProps: {
    style?: DetailStyle;
    showDetailsInNumberOfColumns?: number;
    onBeforeFetch?: unknown;
    fields: Array<DetailField>;
  };
}

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/scheduled-maintenance-events"),
  currentProject: null,
  hasPaymentMethod: false,
} as unknown as PageComponentProps;

let currentEventId: string = EVENT_ID;

function makeEvent(overrides?: {
  title?: string;
  statusPageNames?: Array<string>;
  createdBy?: User | null;
}): ScheduledMaintenance {
  const now: number = Date.now();
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event.title = overrides?.title || "Primary database failover drill";
  event.scheduledMaintenanceNumber = 58;
  event.scheduledMaintenanceNumberWithPrefix = "#58";
  // Half a minute past the hour, so relative text is not on a boundary.
  event.startsAt = new Date(now + 2 * HOUR + 30 * 1000);
  event.endsAt = new Date(now + 4 * HOUR + 30 * 1000);
  event.statusPages = (
    overrides?.statusPageNames || ["Acme Internal Status", "Acme Public"]
  ).map((name: string): StatusPage => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.name = name;
    return statusPage;
  });

  if (overrides?.createdBy !== null) {
    const user: User = overrides?.createdBy || new User();

    if (!overrides?.createdBy) {
      user.name = new Name("Jane Doe");
    }

    event.createdByUser = user;
  }

  return event;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<RenderResult> {
  const result: RenderResult = render(
    <ScheduledMaintenanceView {...PAGE_PROPS} />,
  );
  await flush();
  return result;
}

function lastProps<T>(mock: MockFunction): T {
  return mock.mock.calls[mock.mock.calls.length - 1]![0] as T;
}

function cardProps(name: string): CardProps {
  const calls: Array<Array<CardProps>> = cardModelDetailRenderMock.mock
    .calls as Array<Array<CardProps>>;

  for (let i: number = calls.length - 1; i >= 0; i--) {
    if (calls[i]![0]!.name === name) {
      return calls[i]![0]!;
    }
  }

  throw new Error(`No CardModelDetail named ${name} was rendered`);
}

describe("Scheduled maintenance overview page", () => {
  beforeEach(() => {
    currentEventId = EVENT_ID;
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
      return new ObjectID(currentEventId);
    });
    getItemMock.mockReset();
    updateByIdMock.mockReset();
    changeStateRenderMock.mockReset();
    changeStateMountMock.mockReset();
    feedRenderMock.mockReset();
    cardModelDetailRenderMock.mockReset();
    customFieldsRenderMock.mockReset();

    for (const key of Object.keys(detailItemsByCardName)) {
      delete detailItemsByCardName[key];
    }
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("loading", () => {
    test("shows the overview skeleton until the event loads, then the page", async () => {
      const item: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();
      getItemMock.mockReturnValue(item.promise);

      await renderPage();

      const skeleton: HTMLElement = screen.getByRole("status");

      expect(skeleton).toHaveTextContent("Loading scheduled maintenance event");
      expect(screen.queryByTestId("change-state")).toBe(null);
      expect(screen.queryByTestId("feed")).toBe(null);

      item.resolve(makeEvent());
      await flush();

      expect(screen.queryByText("Loading scheduled maintenance event")).toBe(
        null,
      );
      expect(screen.getByTestId("change-state")).toBeInTheDocument();
      expect(screen.getByTestId("feed")).toBeInTheDocument();
      expect(changeStateMountMock).toHaveBeenCalledTimes(1);
    });

    test("asks for the header facts in the same request as the dates", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      expect(getItemMock).toHaveBeenCalledTimes(1);

      const request: {
        id: ObjectID;
        modelType: unknown;
        select: Record<string, unknown>;
      } = getItemMock.mock.calls[0]![0];

      expect(request.id.toString()).toBe(EVENT_ID);
      expect(request.modelType).toBe(ScheduledMaintenance);
      expect(request.select).toEqual({
        startsAt: true,
        endsAt: true,
        title: true,
        scheduledMaintenanceNumber: true,
        scheduledMaintenanceNumberWithPrefix: true,
        statusPages: { _id: true, name: true },
        createdByUser: { name: true, email: true },
      });
    });

    test("a failed first load shows the error with a working retry", async () => {
      getItemMock.mockRejectedValueOnce(new Error("Server exploded") as never);

      await renderPage();

      expect(screen.getByText("Server exploded")).toBeInTheDocument();
      expect(screen.queryByTestId("change-state")).toBe(null);

      getItemMock.mockResolvedValueOnce(makeEvent() as never);
      fireEvent.click(screen.getByTestId("refresh-button"));
      await flush();

      expect(screen.queryByText("Server exploded")).toBe(null);
      expect(screen.getByTestId("change-state")).toBeInTheDocument();
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });

    test("says so when the event does not exist", async () => {
      getItemMock.mockResolvedValue(null as never);

      await renderPage();

      expect(
        screen.getByText(
          "This scheduled maintenance event could not be found.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBe(null);
    });

    test("ignores a slow response for the event the reader already left", async () => {
      const first: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();
      const second: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();
      getItemMock
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const view: RenderResult = await renderPage();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(getItemMock).toHaveBeenCalledTimes(2);

      second.resolve(makeEvent({ title: "The event now on screen" }));
      await flush();
      first.resolve(makeEvent({ title: "The event left behind" }));
      await flush();

      expect(
        screen.getByRole("heading", { name: "The event now on screen" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("The event left behind")).toBe(null);
    });

    test("switching to another event shows the skeleton again instead of the old event", async () => {
      const second: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();
      getItemMock
        .mockResolvedValueOnce(makeEvent({ title: "First event" }) as never)
        .mockReturnValueOnce(second.promise);

      const view: RenderResult = await renderPage();

      expect(
        screen.getByRole("heading", { name: "First event" }),
      ).toBeInTheDocument();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(screen.queryByText("First event")).toBe(null);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading scheduled maintenance event",
      );

      second.resolve(makeEvent({ title: "Second event" }));
      await flush();

      expect(
        screen.getByRole("heading", { name: "Second event" }),
      ).toBeInTheDocument();
    });

    /*
     * The page stays mounted across events. A failed first load for the next
     * event used to fall back to the item still in state, which belonged to
     * the previous event: its title, number, dates and facts rendered under
     * the new URL, with a header whose actions acted on the new id.
     */
    test("a failed first load of the next event shows the error, not the previous event", async () => {
      getItemMock
        .mockResolvedValueOnce(makeEvent({ title: "First event" }) as never)
        .mockRejectedValueOnce(new Error("Server exploded") as never);

      const view: RenderResult = await renderPage();

      expect(
        screen.getByRole("heading", { name: "First event" }),
      ).toBeInTheDocument();
      expect(changeStateMountMock).toHaveBeenCalledTimes(1);

      const headerRendersBefore: number =
        changeStateRenderMock.mock.calls.length;

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(getItemMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("First event")).toBe(null);
      expect(screen.getByText("Server exploded")).toBeInTheDocument();
      expect(screen.queryByTestId("change-state")).toBe(null);
      expect(screen.queryByTestId("feed")).toBe(null);
      expect(screen.queryByRole("group", { name: "Maintenance window" })).toBe(
        null,
      );
      // The header never rendered again, not even once, for the new id.
      expect(changeStateRenderMock.mock.calls.length).toBe(headerRendersBefore);

      // The retry recovers the event the reader is actually on.
      getItemMock.mockResolvedValueOnce(
        makeEvent({ title: "Second event" }) as never,
      );
      fireEvent.click(screen.getByTestId("refresh-button"));
      await flush();

      expect(screen.queryByText("Server exploded")).toBe(null);
      expect(
        screen.getByRole("heading", { name: "Second event" }),
      ).toBeInTheDocument();
      expect(
        (getItemMock.mock.calls[2]![0] as { id: ObjectID }).id.toString(),
      ).toBe(OTHER_EVENT_ID);
    });

    test("a failed first load of the next event is not replaced by the previous event on the way back", async () => {
      const backAgain: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();

      getItemMock
        .mockResolvedValueOnce(makeEvent({ title: "First event" }) as never)
        .mockRejectedValueOnce(new Error("Server exploded") as never)
        .mockReturnValueOnce(backAgain.promise);

      const view: RenderResult = await renderPage();

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(screen.getByText("Server exploded")).toBeInTheDocument();

      // Back to the first event: a fresh first load, not the error, not stale data.
      currentEventId = EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(screen.queryByText("Server exploded")).toBe(null);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading scheduled maintenance event",
      );

      backAgain.resolve(makeEvent({ title: "First event, reloaded" }));
      await flush();

      expect(
        screen.getByRole("heading", { name: "First event, reloaded" }),
      ).toBeInTheDocument();
    });
  });

  describe("refreshing", () => {
    test("a state change refreshes the event, details and feed without unmounting the page", async () => {
      getItemMock.mockResolvedValueOnce(makeEvent() as never);

      await renderPage();

      expect(lastProps<FeedProps>(feedRenderMock).refreshToken).toBe(0);
      const refresherBefore: boolean | undefined = cardProps(
        "Scheduled Maintenance Details",
      ).refresher;

      const refetch: Deferred<ScheduledMaintenance> =
        createDeferred<ScheduledMaintenance>();
      getItemMock.mockReturnValueOnce(refetch.promise);

      fireEvent.click(screen.getByRole("button", { name: "Complete action" }));
      await flush();

      // Still mounted while the refetch is in flight: no skeleton, no remount.
      expect(screen.queryByRole("status")).toBe(null);
      expect(screen.getByTestId("change-state")).toBeInTheDocument();
      expect(getItemMock).toHaveBeenCalledTimes(2);
      expect(lastProps<FeedProps>(feedRenderMock).refreshToken).toBe(1);
      expect(cardProps("Scheduled Maintenance Details").refresher).toBe(
        !refresherBefore,
      );

      refetch.resolve(makeEvent({ title: "Renamed drill" }));
      await flush();

      expect(
        screen.getByRole("heading", { name: "Renamed drill" }),
      ).toBeInTheDocument();
      expect(changeStateMountMock).toHaveBeenCalledTimes(1);
    });

    test("a failed background refresh keeps the page on screen", async () => {
      getItemMock
        .mockResolvedValueOnce(makeEvent() as never)
        .mockRejectedValueOnce(new Error("Temporary glitch") as never);

      await renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Complete action" }));
      await flush();

      expect(screen.queryByText("Temporary glitch")).toBe(null);
      expect(screen.getByTestId("change-state")).toBeInTheDocument();
      expect(changeStateMountMock).toHaveBeenCalledTimes(1);
    });

    test("saving either card refreshes the feed", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      await act(async () => {
        (
          cardProps("Scheduled Maintenance Details") as unknown as {
            onSaveSuccess: () => void;
          }
        ).onSaveSuccess();
      });
      await flush();

      expect(lastProps<FeedProps>(feedRenderMock).refreshToken).toBe(1);

      await act(async () => {
        (
          cardProps("Affected Resources") as unknown as {
            onSaveSuccess: () => void;
          }
        ).onSaveSuccess();
      });
      await flush();

      expect(lastProps<FeedProps>(feedRenderMock).refreshToken).toBe(2);
    });
  });

  describe("header", () => {
    test("passes the number, title, window and facts to the header", async () => {
      const event: ScheduledMaintenance = makeEvent();
      getItemMock.mockResolvedValue(event as never);

      await renderPage();

      const props: ChangeStateProps = lastProps<ChangeStateProps>(
        changeStateRenderMock,
      );

      expect(props.eventNumber).toBe("#58");
      expect(props.title).toBe("Primary database failover drill");
      expect(props.eventStartsAt).toBe(event.startsAt);
      expect(props.eventEndsAt).toBe(event.endsAt);
      expect(props.facts).toEqual([
        {
          label: "Status pages",
          value: "Acme Internal Status, Acme Public",
          icon: IconProp.Globe,
        },
        { label: "Created by", value: "Jane Doe", icon: IconProp.User },
      ]);
    });

    const STATUS_PAGE_CASES: Array<[Array<string>, string]> = [
      [[], "None"],
      [["Only page"], "Only page"],
      [["A", "B", "C"], "A, B +1 more"],
      [["A", "B", "C", "D", "E"], "A, B +3 more"],
      [["  ", "Named"], "Named"],
    ];

    test.each(STATUS_PAGE_CASES)(
      "summarises status pages %j as %s",
      async (names: Array<string>, text: string) => {
        getItemMock.mockResolvedValue(
          makeEvent({ statusPageNames: names }) as never,
        );

        await renderPage();

        expect(
          lastProps<ChangeStateProps>(changeStateRenderMock).facts?.[0]?.value,
        ).toBe(text);
      },
    );

    test("falls back to the creator's email, and leaves the fact empty without a creator", async () => {
      const user: User = new User();
      user.email = new Email("jane@example.com");
      getItemMock
        .mockResolvedValueOnce(makeEvent({ createdBy: user }) as never)
        .mockResolvedValueOnce(makeEvent({ createdBy: null }) as never);

      await renderPage();

      expect(
        lastProps<ChangeStateProps>(changeStateRenderMock).facts?.[1]?.value,
      ).toBe("jane@example.com");

      fireEvent.click(screen.getByRole("button", { name: "Complete action" }));
      await flush();

      expect(
        lastProps<ChangeStateProps>(changeStateRenderMock).facts?.[1]?.value,
      ).toBe("");
    });
  });

  describe("stat bar", () => {
    test("shows start, end and window length with relative times, and the timezone inside the bar", async () => {
      const event: ScheduledMaintenance = makeEvent();
      getItemMock.mockResolvedValue(event as never);

      await renderPage();

      const bar: HTMLElement = screen.getByRole("group", {
        name: "Maintenance window",
      });
      const cells: Array<HTMLElement> = Array.from(
        bar.children,
      ) as Array<HTMLElement>;

      expect(cells).toHaveLength(3);
      expect(cells[0]).toHaveTextContent("Starts");
      expect(cells[0]).toHaveTextContent(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          event.startsAt!,
        ),
      );
      expect(cells[0]).toHaveTextContent("in 2 hours");
      expect(cells[1]).toHaveTextContent("Ends");
      expect(cells[1]).toHaveTextContent("in 4 hours");
      expect(cells[2]).toHaveTextContent("Duration");
      expect(cells[2]).toHaveTextContent("2 hours");
      expect(cells[2]).not.toHaveTextContent("0 minutes");
      expect(cells[2]).toHaveTextContent(
        "Planned window · times in " + OneUptimeDate.getCurrentTimezoneString(),
      );

      // Segment cells: no card chrome of their own, values wrap.
      for (const cell of cells) {
        expect(cell).not.toHaveClass("rounded-xl");
        expect(cell).toHaveClass("px-5", "py-4");
      }

      /*
       * The timezone used to be a loose footnote floating under the bar. It
       * is said once, inside the Duration cell, and nowhere else.
       */
      expect(screen.queryByText(/^Times in /)).toBeNull();
      expect(screen.getAllByText(/times in /i)).toHaveLength(1);
      expect(bar.nextElementSibling).toBeNull();
    });

    test("is left out when the event has no window", async () => {
      const event: ScheduledMaintenance = makeEvent();
      delete event.endsAt;
      getItemMock.mockResolvedValue(event as never);

      await renderPage();

      expect(screen.queryByRole("group", { name: "Maintenance window" })).toBe(
        null,
      );
      expect(screen.getByTestId("change-state")).toBeInTheDocument();
    });
  });

  describe("details card", () => {
    test("uses the compact style, one column, no timeline pre-fetch and the agreed field order", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const details: CardProps = cardProps("Scheduled Maintenance Details");

      expect(details.modelDetailProps.style).toBe(DetailStyle.Compact);
      expect(details.modelDetailProps.showDetailsInNumberOfColumns).toBe(1);
      expect(details.modelDetailProps.onBeforeFetch).toBe(undefined);
      expect(
        details.modelDetailProps.fields.map(
          (field: DetailField): string | undefined => {
            return field.title;
          },
        ),
      ).toEqual([
        "Starts At",
        "Ends At",
        "Created At",
        "Shown on Status Pages",
        "Subscriber Reminders",
        "Subscriber Notifications",
        "Labels",
        "Scheduled Maintenance Number",
        "Scheduled Maintenance ID",
      ]);
    });

    test("describes reminders in plain words", async () => {
      const withoutReminders: ScheduledMaintenance = makeEvent();
      detailItemsByCardName["Scheduled Maintenance Details"] = withoutReminders;
      getItemMock.mockResolvedValue(makeEvent() as never);

      const view: RenderResult = await renderPage();

      const card: () => HTMLElement = (): HTMLElement => {
        return screen.getByTestId("card-Scheduled Maintenance Details");
      };

      expect(
        within(card()).getByText("No reminders configured"),
      ).toBeInTheDocument();

      const reminder: Recurring = new Recurring();
      reminder.intervalType = EventInterval.Day;
      reminder.intervalCount = new PositiveNumber(2);

      const nextReminderAt: Date = new Date(Date.now() + HOUR);
      const withReminders: ScheduledMaintenance = makeEvent();
      withReminders.sendSubscriberNotificationsOnBeforeTheEvent = [reminder];
      withReminders.nextSubscriberNotificationBeforeTheEventAt = nextReminderAt;
      detailItemsByCardName["Scheduled Maintenance Details"] = withReminders;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(card()).toHaveTextContent("2 Days before the event begins");
      expect(card()).not.toHaveTextContent("is begins");
      expect(card()).toHaveTextContent(
        "Next reminder: " +
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            nextReminderAt,
          ),
      );

      const noUpcoming: ScheduledMaintenance = makeEvent();
      noUpcoming.sendSubscriberNotificationsOnBeforeTheEvent = [reminder];
      detailItemsByCardName["Scheduled Maintenance Details"] = noUpcoming;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(
        within(card()).getByText("No upcoming reminders"),
      ).toBeInTheDocument();
    });

    test("shows a failed resend instead of swallowing it, and clears it on success", async () => {
      detailItemsByCardName["Scheduled Maintenance Details"] = makeEvent();
      getItemMock.mockResolvedValue(makeEvent() as never);
      updateByIdMock.mockRejectedValueOnce(
        new Error("Permission denied") as never,
      );

      await renderPage();

      fireEvent.click(
        screen.getByRole("button", { name: "Resend notifications" }),
      );
      await flush();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not resend notifications: Permission denied",
      );
      expect(getItemMock).toHaveBeenCalledTimes(1);

      updateByIdMock.mockResolvedValueOnce({} as never);
      fireEvent.click(
        screen.getByRole("button", { name: "Resend notifications" }),
      );
      await flush();

      expect(screen.queryByRole("alert")).toBe(null);
      expect(updateByIdMock).toHaveBeenCalledTimes(2);

      const update: {
        id: ObjectID;
        modelType: unknown;
        data: Record<string, unknown>;
      } = updateByIdMock.mock.calls[1]![0];

      expect(update.id.toString()).toBe(EVENT_ID);
      expect(update.modelType).toBe(ScheduledMaintenance);
      expect(update.data).toEqual({
        subscriberNotificationStatusOnEventScheduled:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessage:
          "Notification queued for resending",
      });
      // A successful resend refreshes the page to show the new status.
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });

    test("a failed resend belongs to its event and is not shown on the next one", async () => {
      detailItemsByCardName["Scheduled Maintenance Details"] = makeEvent();
      getItemMock.mockResolvedValue(makeEvent() as never);
      updateByIdMock.mockRejectedValueOnce(
        new Error("Permission denied") as never,
      );

      const view: RenderResult = await renderPage();

      fireEvent.click(
        screen.getByRole("button", { name: "Resend notifications" }),
      );
      await flush();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not resend notifications: Permission denied",
      );

      currentEventId = OTHER_EVENT_ID;
      view.rerender(<ScheduledMaintenanceView {...PAGE_PROPS} />);
      await flush();

      expect(
        screen.getByRole("button", { name: "Resend notifications" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBe(null);
    });
  });

  describe("right column", () => {
    /*
     * The column is about 300px wide. The old side-by-side headers put "Edit
     * Scheduled Maintenance Event" beside each title and squeezed the title
     * and description into a column one word wide; two resource tiles per
     * row clipped every name.
     */
    test("every card stacks its header and edit buttons just say Edit", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const details: CardProps = cardProps("Scheduled Maintenance Details");
      const resources: CardProps = cardProps("Affected Resources");

      expect(details.cardProps).toEqual({
        title: "Maintenance Details",
        description: "Key facts about this maintenance event.",
        headerLayout: "stacked",
      });
      expect(resources.cardProps).toEqual({
        title: "Affected Resources",
        description:
          "Monitors, services and infrastructure this maintenance affects.",
        headerLayout: "stacked",
      });

      for (const card of [details, resources]) {
        expect(card.editButtonText).toBe("Edit");
        // The short label changes the words, not whether editing is offered.
        expect(card.isEditable).toBe(true);
      }

      expect(
        lastProps<{ headerLayout?: string }>(customFieldsRenderMock)
          .headerLayout,
      ).toBe("stacked");
    });

    test("affected resources render in a single column", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const display: React.ReactElement = cardProps("Affected Resources")
        .modelDetailProps.fields[0]!.getElement!(new ScheduledMaintenance());

      expect((display.props as { columns?: number }).columns).toBe(1);
    });
  });

  describe("affected resources card", () => {
    const RELATIONS: Array<string> = [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "proxmoxClusters",
      "vmwareVCenters",
      "cephClusters",
      "dockerSwarmClusters",
      "iotFleets",
      "networkSites",
      "services",
    ];

    test("offers every resource type the model supports", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const resources: CardProps = cardProps("Affected Resources");
      const picker: React.ReactElement = resources.formFields[0]!
        .getCustomElement!({}, {});
      const pickerProps: Record<string, unknown> = picker.props as Record<
        string,
        unknown
      >;

      expect(pickerProps["resourceTypes"]).toEqual([
        "Monitor",
        "Host",
        "KubernetesCluster",
        "DockerHost",
        "PodmanHost",
        "ProxmoxCluster",
        "VMwareVCenter",
        "CephCluster",
        "DockerSwarmCluster",
        "IoTFleet",
        "NetworkSite",
        "Service",
      ]);

      for (const relation of RELATIONS) {
        expect(pickerProps).toHaveProperty(relation);
      }
    });

    test("writes every relation back from the picker's payload", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const payload: Record<string, unknown> = {
        __affectedResourcesPayload: true,
      };

      for (const relation of RELATIONS) {
        payload[relation] = [`${relation}-id`];
      }

      const setNewFormValues: MockFunction = getJestMockFunction();

      cardProps("Affected Resources").formFields[0]!.onChange!(
        payload,
        { title: "kept" },
        setNewFormValues,
      );
      await flush();

      expect(setNewFormValues).toHaveBeenCalledTimes(1);

      const written: Record<string, unknown> =
        setNewFormValues.mock.calls[0]![0];

      expect(written["title"]).toBe("kept");

      for (const relation of RELATIONS) {
        expect(written[relation]).toEqual([`${relation}-id`]);
      }
    });

    test("registers, selects and displays every relation", async () => {
      getItemMock.mockResolvedValue(makeEvent() as never);

      await renderPage();

      const resources: CardProps = cardProps("Affected Resources");
      const registered: Array<string> = resources.formFields
        .slice(1)
        .map((field: DetailField): string => {
          return Object.keys(field.field)[0]!;
        });

      expect(registered).toEqual(
        RELATIONS.filter((relation: string): boolean => {
          return relation !== "monitors";
        }),
      );

      const displayField: DetailField = resources.modelDetailProps.fields[0]!;

      expect(Object.keys(displayField.field)).toEqual(RELATIONS);

      const display: React.ReactElement = displayField.getElement!(
        new ScheduledMaintenance(),
      );

      for (const relation of RELATIONS) {
        expect((display.props as Record<string, unknown>)[relation]).toEqual(
          [],
        );
      }
    });
  });
});
