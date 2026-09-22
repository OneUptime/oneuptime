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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * Every dashboard activity feed carries one "Filter & Sort" button, and the
 * unit tests pin its pieces on their own: the rules in FeedOptions, the
 * panel in FeedOptionsButton, the hook that remembers the sort order and the
 * viewKey contract of useFeedItems. None of them can see a product feed
 * wiring the pieces together wrongly - a typo in the event type column, a
 * storage key shared with another feed, a query that forgets the resource,
 * a checklist whose icons disagree with the feed's own items, a resetKey
 * that does not follow the resource the feed reads.
 *
 * So these tests render each REAL product feed with the REAL button and
 * assert the exact requests it sends. Only the network (ModelAPI), the
 * markdown-rendering FeedItem, Icon (so an icon can be read back by name)
 * and the note / runbook modals are stubbed. Every stub the hoisted
 * jest.mock factories close over carries the "mock" prefix jest requires.
 */

interface FeedListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  skip: number;
  limit: number;
  sort: Record<string, unknown>;
}

interface FeedPageResponse {
  data: Array<unknown>;
  count: number;
}

type FeedResponder = (request: FeedListRequest) => Promise<FeedPageResponse>;

const mockGetListCalls: Array<FeedListRequest> = [];

// Every text a feed item was ever rendered with, so "never painted" is checkable.
const mockPaintedItemTexts: Array<string> = [];

const respondWithEmptyFeed: FeedResponder = (): Promise<FeedPageResponse> => {
  return Promise.resolve({ data: [], count: 0 });
};

let mockGetListResponse: FeedResponder = respondWithEmptyFeed;

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
      getList: (request: FeedListRequest): Promise<FeedPageResponse> => {
        mockGetListCalls.push(request);
        return mockGetListResponse(request);
      },
    },
  };
});

/*
 * The real Feed stays - its More button and empty-feed message are part of
 * what is under test. Only the item, which renders markdown, is replaced by
 * one that shows its text and names its icon.
 */
jest.mock("../../../UI/Components/Feed/FeedItem", () => {
  return {
    __esModule: true,
    default: (props: {
      textInMarkdown: string;
      icon: string;
    }): React.ReactElement => {
      mockPaintedItemTexts.push(props.textInMarkdown);
      return React.createElement(
        "li",
        { "data-testid": "feed-item", "data-icon": props.icon },
        props.textInMarkdown,
      );
    },
  };
});

/*
 * An SVG cannot be read back as an IconProp, so Icon renders the name it was
 * given. The module's enums (SizeProp, ThickProp, IconType) stay real.
 */
jest.mock("../../../UI/Components/Icon/Icon", () => {
  const actualIconModule: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Icon/Icon",
  ) as Record<string, unknown>;

  return {
    ...actualIconModule,
    __esModule: true,
    default: (props: { icon: string }): React.ReactElement => {
      return React.createElement("span", {
        "data-testid": "mock-icon",
        "data-icon": props.icon,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import MonitorFeedElement, {
  getMonitorFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFeed";
import IncidentFeedElement, {
  getIncidentFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import AlertFeedElement, {
  getAlertFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import IncidentEpisodeFeedElement, {
  getIncidentEpisodeFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed";
import AlertEpisodeFeedElement, {
  getAlertEpisodeFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodeFeed";
import ScheduledMaintenanceFeedElement, {
  getScheduledMaintenanceFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import OnCallDutyPolicyFeedElement, {
  getOnCallDutyPolicyFeedEventIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallDutyPolicyFeed";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorFeed, {
  MonitorFeedEventType,
} from "../../../Models/DatabaseModels/MonitorFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import IncidentEpisodeFeed, {
  IncidentEpisodeFeedEventType,
} from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import AlertEpisodeFeed, {
  AlertEpisodeFeedEventType,
} from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  FILTERED_FEED_NO_ITEMS_MESSAGE,
  getFeedEventTypeLabel,
} from "../../../UI/Components/Feed/FeedOptions";
import { getSortOrderStorageKey } from "../../../UI/Components/Feed/useFeedOptions";
import LocalStorage from "../../../UI/Utils/LocalStorage";

type FeedModelClass = new () => DatabaseBaseModel;

interface FeedCase {
  name: string;
  render: (resourceId: ObjectID) => React.ReactElement;
  modelType: FeedModelClass;
  resourceId: ObjectID;
  // The query key naming the resource the feed belongs to.
  resourceKey: string;
  // The feed model's event type column, which the filter is keyed by.
  eventTypeColumn: string;
  enumValues: Array<string>;
  // Names the feed kind for the remembered sort order.
  storageKey: string;
  iconFn: (eventType: string) => IconProp;
  // What the feed says when the resource has no activity at all.
  noItemsMessage: string;
  hasActionsMenu: boolean;
}

/*
 * The seven feeds with their own component. ResourceFeed, which backs the
 * infrastructure and service feed pages, has its own suite.
 */
const FEED_CASES: Array<FeedCase> = [
  {
    name: "MonitorFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <MonitorFeedElement monitorId={resourceId} />;
    },
    modelType: MonitorFeed,
    resourceId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    resourceKey: "monitorId",
    eventTypeColumn: "monitorFeedEventType",
    enumValues: Object.values(MonitorFeedEventType),
    storageKey: "monitor",
    iconFn: getMonitorFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this monitor.",
    hasActionsMenu: false,
  },
  {
    name: "IncidentFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <IncidentFeedElement incidentId={resourceId} />;
    },
    modelType: IncidentFeed,
    resourceId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    resourceKey: "incidentId",
    eventTypeColumn: "incidentFeedEventType",
    enumValues: Object.values(IncidentFeedEventType),
    storageKey: "incident",
    iconFn: getIncidentFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this incident.",
    hasActionsMenu: true,
  },
  {
    name: "AlertFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <AlertFeedElement alertId={resourceId} />;
    },
    modelType: AlertFeed,
    resourceId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    resourceKey: "alertId",
    eventTypeColumn: "alertFeedEventType",
    enumValues: Object.values(AlertFeedEventType),
    storageKey: "alert",
    iconFn: getAlertFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this alert.",
    hasActionsMenu: true,
  },
  {
    name: "IncidentEpisodeFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <IncidentEpisodeFeedElement incidentEpisodeId={resourceId} />;
    },
    modelType: IncidentEpisodeFeed,
    resourceId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    resourceKey: "incidentEpisodeId",
    eventTypeColumn: "incidentEpisodeFeedEventType",
    enumValues: Object.values(IncidentEpisodeFeedEventType),
    storageKey: "incident-episode",
    iconFn: getIncidentEpisodeFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this episode.",
    hasActionsMenu: true,
  },
  {
    name: "AlertEpisodeFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <AlertEpisodeFeedElement alertEpisodeId={resourceId} />;
    },
    modelType: AlertEpisodeFeed,
    resourceId: new ObjectID("55555555-5555-4555-8555-555555555555"),
    resourceKey: "alertEpisodeId",
    eventTypeColumn: "alertEpisodeFeedEventType",
    enumValues: Object.values(AlertEpisodeFeedEventType),
    storageKey: "alert-episode",
    iconFn: getAlertEpisodeFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this episode.",
    hasActionsMenu: true,
  },
  {
    name: "ScheduledMaintenanceFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return (
        <ScheduledMaintenanceFeedElement scheduledMaintenanceId={resourceId} />
      );
    },
    modelType: ScheduledMaintenanceFeed,
    resourceId: new ObjectID("66666666-6666-4666-8666-666666666666"),
    resourceKey: "scheduledMaintenanceId",
    eventTypeColumn: "scheduledMaintenanceFeedEventType",
    enumValues: Object.values(ScheduledMaintenanceFeedEventType),
    storageKey: "scheduled-maintenance",
    iconFn: getScheduledMaintenanceFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this scheduled maintenance.",
    hasActionsMenu: true,
  },
  {
    name: "OnCallDutyPolicyFeed",
    render: (resourceId: ObjectID): React.ReactElement => {
      return <OnCallDutyPolicyFeedElement onCallDutyPolicyId={resourceId} />;
    },
    modelType: OnCallDutyPolicyFeed,
    resourceId: new ObjectID("77777777-7777-4777-8777-777777777777"),
    resourceKey: "onCallDutyPolicyId",
    eventTypeColumn: "onCallDutyPolicyFeedEventType",
    enumValues: Object.values(OnCallDutyPolicyFeedEventType),
    storageKey: "on-call-policy",
    iconFn: getOnCallDutyPolicyFeedEventIcon,
    noItemsMessage:
      "Looks like there are no items in this feed for this onCallDutyPolicy.",
    hasActionsMenu: false,
  },
];

// Enough rows on the server that More stays available after one click.
const SERVER_ROW_COUNT: number = 25;

/*
 * The trigger's accessible name is its label alone; what the reader chose
 * (order and filter) is its description. So the name never changes.
 */
const TRIGGER_NAME: string = "Filter & Sort";

interface PendingRequest {
  request: FeedListRequest;
  resolve: (page: FeedPageResponse) => void;
}

type Flush = () => Promise<void>;

const flush: Flush = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

type RenderFeedCase = (feedCase: FeedCase) => RenderResult;

const renderFeedCase: RenderFeedCase = (feedCase: FeedCase): RenderResult => {
  return render(feedCase.render(feedCase.resourceId));
};

/*
 * Waits for the request count to reach exactly `count`, then lets every
 * settled response land and checks nothing else was asked for: one reader
 * action must cost exactly one request. Responses are let land inside act
 * first, so none of them settles in the gap after waitFor returns.
 */
type WaitForRequestCount = (count: number) => Promise<void>;

const waitForRequestCount: WaitForRequestCount = async (
  count: number,
): Promise<void> => {
  await flush();
  await waitFor((): void => {
    expect(mockGetListCalls).toHaveLength(count);
  });
  await flush();
  expect(mockGetListCalls).toHaveLength(count);
};

type GetRequest = (index: number) => FeedListRequest;

const getRequest: GetRequest = (index: number): FeedListRequest => {
  const request: FeedListRequest | undefined = mockGetListCalls[index];

  if (!request) {
    throw new Error(`No request #${index} was made.`);
  }

  return request;
};

type CreateFeedRow = (
  feedCase: FeedCase,
  eventType: string,
  text: string,
  postedAt: Date,
) => DatabaseBaseModel;

const createFeedRow: CreateFeedRow = (
  feedCase: FeedCase,
  eventType: string,
  text: string,
  postedAt: Date,
): DatabaseBaseModel => {
  const row: DatabaseBaseModel = new feedCase.modelType();
  row.id = ObjectID.generate();
  row.setColumnValue(feedCase.eventTypeColumn, eventType);
  row.setColumnValue("feedInfoInMarkdown", text);
  row.setColumnValue("postedAt", postedAt);
  row.setColumnValue("createdAt", postedAt);

  // setColumnValue silently ignores a name that is not a column.
  if (row.getColumnValue(feedCase.eventTypeColumn) !== eventType) {
    throw new Error(
      `${feedCase.eventTypeColumn} is not a column of ${feedCase.name}.`,
    );
  }

  return row;
};

type GetRequestedEventTypes = (
  feedCase: FeedCase,
  request: FeedListRequest,
) => Array<string> | undefined;

const getRequestedEventTypes: GetRequestedEventTypes = (
  feedCase: FeedCase,
  request: FeedListRequest,
): Array<string> | undefined => {
  const filter: unknown = request.query[feedCase.eventTypeColumn];

  return filter instanceof Includes
    ? (filter.values as Array<string>)
    : undefined;
};

/*
 * Names the view a request asked for - "DESC:all", "ASC:PublicNote" - so
 * every painted row says which request it answered.
 */
type GetViewName = (feedCase: FeedCase, request: FeedListRequest) => string;

const getViewName: GetViewName = (
  feedCase: FeedCase,
  request: FeedListRequest,
): string => {
  const eventTypes: Array<string> | undefined = getRequestedEventTypes(
    feedCase,
    request,
  );

  return `${String(request.sort["postedAt"])}:${
    eventTypes ? eventTypes.join("+") : "all"
  }`;
};

type GetViewTexts = (viewName: string, count: number) => Array<string>;

const getViewTexts: GetViewTexts = (
  viewName: string,
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `${viewName}#${index + 1}`;
  });
};

// The page a server holding `total` rows per view returns for a request.
type BuildPage = (
  feedCase: FeedCase,
  request: FeedListRequest,
  total: number,
) => FeedPageResponse;

const buildPage: BuildPage = (
  feedCase: FeedCase,
  request: FeedListRequest,
  total: number,
): FeedPageResponse => {
  const viewName: string = getViewName(feedCase, request);
  const eventTypes: Array<string> =
    getRequestedEventTypes(feedCase, request) || feedCase.enumValues;

  return {
    data: getViewTexts(viewName, Math.min(request.limit, total)).map(
      (text: string, index: number): DatabaseBaseModel => {
        return createFeedRow(
          feedCase,
          eventTypes[index % eventTypes.length]!,
          text,
          new Date(Date.UTC(2026, 8, 1, 0, index)),
        );
      },
    ),
    count: total,
  };
};

type ServeFeed = (feedCase: FeedCase, total: number) => FeedResponder;

const serveFeed: ServeFeed = (
  feedCase: FeedCase,
  total: number,
): FeedResponder => {
  return (request: FeedListRequest): Promise<FeedPageResponse> => {
    return Promise.resolve(buildPage(feedCase, request, total));
  };
};

// Holds every request open until the test answers it.
type HoldRequests = (pending: Array<PendingRequest>) => FeedResponder;

const holdRequests: HoldRequests = (
  pending: Array<PendingRequest>,
): FeedResponder => {
  return (request: FeedListRequest): Promise<FeedPageResponse> => {
    return new Promise<FeedPageResponse>(
      (resolve: (page: FeedPageResponse) => void): void => {
        pending.push({ request, resolve });
      },
    );
  };
};

type AnswerRequest = (
  pending: PendingRequest | undefined,
  page: FeedPageResponse,
) => Promise<void>;

const answerRequest: AnswerRequest = async (
  pending: PendingRequest | undefined,
  page: FeedPageResponse,
): Promise<void> => {
  if (!pending) {
    throw new Error("That request was never made.");
  }

  await act(async (): Promise<void> => {
    pending.resolve(page);
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

type GetRenderedItemTexts = () => Array<string>;

const getRenderedItemTexts: GetRenderedItemTexts = (): Array<string> => {
  return screen.queryAllByTestId("feed-item").map((item: HTMLElement) => {
    return item.textContent || "";
  });
};

type GetTrigger = () => HTMLElement;

const getTrigger: GetTrigger = (): HTMLElement => {
  return screen.getByTestId("feed-options-button");
};

/*
 * Checks the trigger says what the feed shows the way a screen reader hears
 * it: named by its label - found by that name, the badge's count left out -
 * and described by the summary, which is also its tooltip. A name that
 * carried the summary would be read twice, once as name and once as
 * description.
 */
type ExpectTriggerSummary = (summary: string) => void;

const expectTriggerSummary: ExpectTriggerSummary = (summary: string): void => {
  const trigger: HTMLElement = getTrigger();

  expect(screen.getByRole("button", { name: TRIGGER_NAME })).toBe(trigger);
  expect(trigger).toHaveAccessibleName(TRIGGER_NAME);
  expect(trigger).toHaveAccessibleDescription(summary);
  expect(trigger).toHaveAttribute("title", summary);
};

/*
 * The trigger's leading glyph, read back through the Icon mock. The trailing
 * chevron comes after it.
 */
type GetTriggerIcon = () => string | null;

const getTriggerIcon: GetTriggerIcon = (): string | null => {
  const icons: Array<HTMLElement> =
    within(getTrigger()).getAllByTestId("mock-icon");

  return icons[0]!.getAttribute("data-icon");
};

type OpenPanel = () => HTMLElement;

const openPanel: OpenPanel = (): HTMLElement => {
  if (!screen.queryByTestId("feed-options-panel")) {
    fireEvent.click(getTrigger());
  }

  return screen.getByRole("dialog", { name: "Filter and sort feed" });
};

type GetEventTypeCheckbox = (eventType: string) => HTMLElement;

const getEventTypeCheckbox: GetEventTypeCheckbox = (
  eventType: string,
): HTMLElement => {
  return within(openPanel()).getByTestId(
    `feed-options-event-type-${eventType}`,
  );
};

type ToggleEventType = (eventType: string) => void;

const toggleEventType: ToggleEventType = (eventType: string): void => {
  fireEvent.click(getEventTypeCheckbox(eventType));
};

type ChooseSortOrder = (label: "Newest first" | "Oldest first") => void;

const chooseSortOrder: ChooseSortOrder = (
  label: "Newest first" | "Oldest first",
): void => {
  fireEvent.click(within(openPanel()).getByRole("radio", { name: label }));
};

type ClickShowAll = () => void;

const clickShowAll: ClickShowAll = (): void => {
  fireEvent.click(
    within(openPanel()).getByRole("button", { name: "Show all" }),
  );
};

type ClickMore = () => void;

const clickMore: ClickMore = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
};

type IsBefore = (first: Element, second: Element) => boolean;

const isBefore: IsBefore = (first: Element, second: Element): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

type ExpectWindow = (
  feedCase: FeedCase,
  request: FeedListRequest,
  sortOrder: SortOrder,
  limit: number,
) => void;

// The paging and ordering half of a request.
const expectWindow: ExpectWindow = (
  feedCase: FeedCase,
  request: FeedListRequest,
  sortOrder: SortOrder,
  limit: number,
): void => {
  expect(request.modelType).toBe(feedCase.modelType);
  expect(request.sort).toStrictEqual({ postedAt: sortOrder });
  expect(request.skip).toBe(0);
  expect(request.limit).toBe(limit);
};

type ExpectUnfilteredQuery = (
  feedCase: FeedCase,
  request: FeedListRequest,
  resourceId?: ObjectID,
) => void;

/*
 * Exactly the query the feed sent before it had a filter: the resource
 * alone - the case's own resource unless the feed was moved to another.
 */
const expectUnfilteredQuery: ExpectUnfilteredQuery = (
  feedCase: FeedCase,
  request: FeedListRequest,
  resourceId: ObjectID = feedCase.resourceId,
): void => {
  expect(Object.keys(request.query)).toEqual([feedCase.resourceKey]);
  expect(request.query).toStrictEqual({
    [feedCase.resourceKey]: resourceId,
  });
  expect(request.query[feedCase.resourceKey]).toBe(resourceId);
};

type ExpectFilteredQuery = (
  feedCase: FeedCase,
  request: FeedListRequest,
  eventTypes: Array<string>,
) => void;

const expectFilteredQuery: ExpectFilteredQuery = (
  feedCase: FeedCase,
  request: FeedListRequest,
  eventTypes: Array<string>,
): void => {
  expect(Object.keys(request.query).sort()).toEqual(
    [feedCase.resourceKey, feedCase.eventTypeColumn].sort(),
  );
  expect(request.query[feedCase.resourceKey]).toBe(feedCase.resourceId);

  const filter: unknown = request.query[feedCase.eventTypeColumn];

  expect(filter).toBeInstanceOf(Includes);
  expect((filter as Includes).values).toEqual(eventTypes);
};

// Any event type will do where the test is about one being ticked at all.
type GetSampleEventType = (feedCase: FeedCase) => string;

const getSampleEventType: GetSampleEventType = (feedCase: FeedCase): string => {
  return feedCase.enumValues[1]!;
};

/*
 * Two event types whose enum order is the reverse of their checklist order
 * (the checklist is alphabetical by label). Ticking the enum-later one first
 * makes click order, checklist order and enum order all disagree, so the
 * request can only come out in enum order if the feed puts it there.
 */
type GetOutOfOrderPair = (
  enumValues: Array<string>,
) => [string, string] | undefined;

const getOutOfOrderPair: GetOutOfOrderPair = (
  enumValues: Array<string>,
): [string, string] | undefined => {
  for (let i: number = 0; i < enumValues.length; i++) {
    for (let j: number = i + 1; j < enumValues.length; j++) {
      const earlier: string = enumValues[i]!;
      const later: string = enumValues[j]!;

      if (
        getFeedEventTypeLabel(earlier).localeCompare(
          getFeedEventTypeLabel(later),
        ) > 0
      ) {
        return [earlier, later];
      }
    }
  }

  return undefined;
};

beforeEach(() => {
  mockGetListCalls.length = 0;
  mockPaintedItemTexts.length = 0;
  mockGetListResponse = respondWithEmptyFeed;
  // The chosen sort order is remembered, so one test's choice must not leak.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the feed table", () => {
  test("covers seven feeds, each with its own storage key, resource column and event type column", () => {
    expect(FEED_CASES).toHaveLength(7);
    expect(
      new Set(
        FEED_CASES.map((feedCase: FeedCase): string => {
          return feedCase.storageKey;
        }),
      ).size,
    ).toBe(FEED_CASES.length);

    for (const feedCase of FEED_CASES) {
      const row: DatabaseBaseModel = new feedCase.modelType();

      expect(row.isTableColumn(feedCase.resourceKey)).toBe(true);
      expect(row.isTableColumn(feedCase.eventTypeColumn)).toBe(true);
      expect(feedCase.enumValues.length).toBeGreaterThan(1);
    }
  });
});

describe("the first request", () => {
  test.each(FEED_CASES)(
    "$name reads the newest window for its resource, with no event type in the query",
    async (feedCase: FeedCase) => {
      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      const request: FeedListRequest = getRequest(0);

      expectWindow(feedCase, request, SortOrder.Descending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, request);
      expect(request.query[feedCase.eventTypeColumn]).toBeUndefined();
      // The event type drives each item's icon, so it is always read.
      expect(request.select[feedCase.eventTypeColumn]).toBe(true);
      expect(request.select["postedAt"]).toBe(true);

      expect(await screen.findByText(feedCase.noItemsMessage)).toBeVisible();

      // Painting the response must not ask again.
      await flush();
      expect(mockGetListCalls).toHaveLength(1);
    },
  );
});

describe("the header", () => {
  test.each(FEED_CASES)(
    "$name shows one Filter & Sort button, first among the header controls",
    async (feedCase: FeedCase) => {
      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      const emptyMessage: HTMLElement = await screen.findByText(
        feedCase.noItemsMessage,
      );
      const card: HTMLElement = screen.getByTestId("card");
      const heading: HTMLElement = within(card).getByTestId(
        "card-details-heading",
      );
      const triggers: Array<HTMLElement> = within(card).getAllByTestId(
        "feed-options-button",
      );

      expect(triggers).toHaveLength(1);

      const trigger: HTMLElement = triggers[0]!;

      expect(trigger).toHaveTextContent(TRIGGER_NAME);
      expectTriggerSummary("Newest first, all event types");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("feed-options-count")).toBeNull();

      const refresh: HTMLElement = within(card).getByRole("button", {
        name: "Refresh",
      });
      const otherControls: Array<HTMLElement> = [];

      if (feedCase.hasActionsMenu) {
        const actions: HTMLElement | null = within(card)
          .getByText("Actions")
          .closest('[aria-haspopup="menu"]');

        expect(actions).not.toBeNull();
        otherControls.push(actions!);
      } else {
        expect(within(card).queryByText("Actions")).toBeNull();
      }

      otherControls.push(refresh);

      /*
       * The header row holds one slot per control. Walk up from the trigger
       * to its slot - the ancestor whose parent also holds Refresh - and
       * the row's slots must be exactly: Filter & Sort, then the rest in
       * order.
       */
      let triggerSlot: HTMLElement = trigger;

      while (
        triggerSlot.parentElement &&
        !triggerSlot.parentElement.contains(refresh)
      ) {
        triggerSlot = triggerSlot.parentElement;
      }

      const headerRow: HTMLElement = triggerSlot.parentElement!;
      const slots: Array<Element> = Array.from(headerRow.children);

      expect(slots).toHaveLength(otherControls.length + 1);
      expect(slots[0]).toBe(triggerSlot);
      otherControls.forEach((control: HTMLElement, index: number) => {
        expect(slots[index + 1]!.contains(control)).toBe(true);
      });

      // In the header: after the title, before the feed itself.
      expect(isBefore(heading, trigger)).toBe(true);
      expect(isBefore(refresh, emptyMessage)).toBe(true);
      expect(headerRow.contains(emptyMessage)).toBe(false);
    },
  );
});

describe("the event type checklist", () => {
  test.each(FEED_CASES)(
    "$name lists one checkbox per event type, labelled by getFeedEventTypeLabel and iconed like its feed items",
    async (feedCase: FeedCase) => {
      const rows: Array<DatabaseBaseModel> = feedCase.enumValues.map(
        (eventType: string, index: number): DatabaseBaseModel => {
          return createFeedRow(
            feedCase,
            eventType,
            `fixture-${eventType}`,
            new Date(Date.UTC(2026, 8, 1, 0, index)),
          );
        },
      );

      mockGetListResponse = (): Promise<FeedPageResponse> => {
        return Promise.resolve({ data: rows, count: rows.length });
      };

      renderFeedCase(feedCase);
      await waitForRequestCount(1);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toHaveLength(rows.length);
      });

      const itemIcons: Map<string, string | null> = new Map<
        string,
        string | null
      >();

      for (const item of screen.getAllByTestId("feed-item")) {
        itemIcons.set(item.textContent || "", item.getAttribute("data-icon"));
      }

      const panel: HTMLElement = openPanel();
      const checkboxes: Array<HTMLElement> =
        within(panel).getAllByRole("checkbox");

      expect(checkboxes).toHaveLength(feedCase.enumValues.length);
      expect(
        checkboxes
          .map((checkbox: HTMLElement): string => {
            return checkbox.getAttribute("data-testid") || "";
          })
          .sort(),
      ).toEqual(
        feedCase.enumValues
          .map((eventType: string): string => {
            return `feed-options-event-type-${eventType}`;
          })
          .sort(),
      );

      const knownIcons: Array<string> = Object.values(IconProp);

      for (const eventType of feedCase.enumValues) {
        const checkbox: HTMLElement = within(panel).getByTestId(
          `feed-options-event-type-${eventType}`,
        );

        expect(checkbox).toHaveAccessibleName(getFeedEventTypeLabel(eventType));
        expect(checkbox).not.toBeChecked();

        // The icon function is total over the enum: a real icon every time.
        const expectedIcon: IconProp = feedCase.iconFn(eventType);

        expect(knownIcons).toContain(expectedIcon);

        const optionIcons: NodeListOf<Element> = checkbox
          .closest("label")!
          .querySelectorAll('[data-testid="mock-icon"]');

        expect(optionIcons).toHaveLength(1);
        expect(optionIcons[0]!.getAttribute("data-icon")).toBe(expectedIcon);

        // ...and the feed's own item for that event type wears the same one.
        expect(itemIcons.get(`fixture-${eventType}`)).toBe(expectedIcon);
      }

      // Opening the panel is not a change of view.
      expect(mockGetListCalls).toHaveLength(1);
    },
  );
});

describe("Oldest first", () => {
  test.each(FEED_CASES)(
    "$name asks the API for ascending order from the first window and remembers it for its own feed kind",
    async (feedCase: FeedCase) => {
      const storageKey: string = `feed-sort-order:${feedCase.storageKey}`;

      expect(getSortOrderStorageKey(feedCase.storageKey)).toBe(storageKey);

      const view: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(1);

      chooseSortOrder("Oldest first");
      await waitForRequestCount(2);

      const request: FeedListRequest = getRequest(1);

      expectWindow(feedCase, request, SortOrder.Ascending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, request);
      expect(
        within(openPanel()).getByRole("radio", { name: "Oldest first" }),
      ).toHaveAttribute("aria-checked", "true");
      expectTriggerSummary("Oldest first, all event types");

      /*
       * One key, named for this feed kind. LocalStorage writes a string as
       * it is (only objects are JSON-encoded), and reads it back through
       * the same util the hook uses.
       */
      expect(window.localStorage.length).toBe(1);
      expect(window.localStorage.key(0)).toBe(storageKey);
      expect(window.localStorage.getItem(storageKey)).toBe(SortOrder.Ascending);
      expect(LocalStorage.getItem(storageKey)).toBe(SortOrder.Ascending);

      // The hook's read path: a fresh mount starts oldest first.
      view.unmount();
      const remounted: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(3);

      expectWindow(feedCase, getRequest(2), SortOrder.Ascending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, getRequest(2));

      // Going back to the default forgets the choice rather than storing it.
      chooseSortOrder("Newest first");
      await waitForRequestCount(4);

      expectWindow(
        feedCase,
        getRequest(3),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );
      expect(window.localStorage.getItem(storageKey)).toBeNull();

      remounted.unmount();
      renderFeedCase(feedCase);
      await waitForRequestCount(5);

      expectWindow(
        feedCase,
        getRequest(4),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );
    },
  );
});

describe("ticking event types", () => {
  test.each(FEED_CASES)(
    "$name filters on its event type column with Includes, in enum order whatever the click order",
    async (feedCase: FeedCase) => {
      const pair: [string, string] | undefined = getOutOfOrderPair(
        feedCase.enumValues,
      );

      expect(pair).toBeDefined();

      const enumEarlier: string = pair![0];
      const enumLater: string = pair![1];

      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      toggleEventType(enumLater);
      await waitForRequestCount(2);

      expectWindow(
        feedCase,
        getRequest(1),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );
      expectFilteredQuery(feedCase, getRequest(1), [enumLater]);
      expect(getEventTypeCheckbox(enumLater)).toBeChecked();
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^1$/);

      toggleEventType(enumEarlier);
      await waitForRequestCount(3);

      expectWindow(
        feedCase,
        getRequest(2),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );
      expectFilteredQuery(feedCase, getRequest(2), [enumEarlier, enumLater]);
      expect(getEventTypeCheckbox(enumEarlier)).toBeChecked();
      expect(getEventTypeCheckbox(enumLater)).toBeChecked();
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^2$/);
      expectTriggerSummary(
        `Newest first, 2 of ${feedCase.enumValues.length} event types`,
      );

      // Unticking one leaves exactly the other.
      toggleEventType(enumLater);
      await waitForRequestCount(4);

      expectFilteredQuery(feedCase, getRequest(3), [enumEarlier]);

      // The filter is never remembered.
      expect(window.localStorage.length).toBe(0);
    },
  );
});

describe("empty feeds", () => {
  test.each(FEED_CASES)(
    "$name says no event matches the filter when filtered, and uses its own message otherwise",
    async (feedCase: FeedCase) => {
      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      expect(await screen.findByText(feedCase.noItemsMessage)).toBeVisible();
      expect(screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE)).toBeNull();

      toggleEventType(getSampleEventType(feedCase));
      await waitForRequestCount(2);

      expect(
        await screen.findByText(FILTERED_FEED_NO_ITEMS_MESSAGE),
      ).toBeVisible();
      expect(screen.queryByText(feedCase.noItemsMessage)).toBeNull();

      clickShowAll();
      await waitForRequestCount(3);

      expect(await screen.findByText(feedCase.noItemsMessage)).toBeVisible();
      expect(screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE)).toBeNull();

      // Reordering is not filtering: an empty feed is still just empty.
      chooseSortOrder("Oldest first");
      await waitForRequestCount(4);

      expect(await screen.findByText(feedCase.noItemsMessage)).toBeVisible();
      expect(screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE)).toBeNull();
    },
  );
});

describe("Show all", () => {
  test.each(FEED_CASES)(
    "$name returns the query to exactly the resource alone",
    async (feedCase: FeedCase) => {
      const pair: [string, string] = getOutOfOrderPair(feedCase.enumValues)!;
      const enumEarlier: string = pair[0];
      const enumLater: string = pair[1];

      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      toggleEventType(enumEarlier);
      await waitForRequestCount(2);
      toggleEventType(enumLater);
      await waitForRequestCount(3);

      expectFilteredQuery(feedCase, getRequest(2), [enumEarlier, enumLater]);

      clickShowAll();
      await waitForRequestCount(4);

      const request: FeedListRequest = getRequest(3);

      expectWindow(feedCase, request, SortOrder.Descending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, request);

      const panel: HTMLElement = openPanel();

      for (const checkbox of within(panel).getAllByRole("checkbox")) {
        expect(checkbox).not.toBeChecked();
      }
      expect(
        within(panel).queryByRole("button", { name: "Show all" }),
      ).toBeNull();
      expect(screen.queryByTestId("feed-options-count")).toBeNull();
    },
  );
});

describe("the window after More", () => {
  test.each(FEED_CASES)(
    "$name re-reads the first window on a filter or sort change, and More then keeps both",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);

      mockGetListResponse = serveFeed(feedCase, SERVER_ROW_COUNT);

      renderFeedCase(feedCase);
      await waitForRequestCount(1);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts("DESC:all", DEFAULT_LIMIT),
        );
      });

      clickMore();
      await waitForRequestCount(2);

      expectWindow(
        feedCase,
        getRequest(1),
        SortOrder.Descending,
        DEFAULT_LIMIT * 2,
      );
      expectUnfilteredQuery(feedCase, getRequest(1));
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts("DESC:all", DEFAULT_LIMIT * 2),
        );
      });

      // A filter change starts over at one window, not the widened two.
      toggleEventType(eventType);
      await waitForRequestCount(3);

      expectWindow(
        feedCase,
        getRequest(2),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );
      expectFilteredQuery(feedCase, getRequest(2), [eventType]);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts(`DESC:${eventType}`, DEFAULT_LIMIT),
        );
      });

      // More on the filtered view widens it and keeps the filter.
      clickMore();
      await waitForRequestCount(4);

      expectWindow(
        feedCase,
        getRequest(3),
        SortOrder.Descending,
        DEFAULT_LIMIT * 2,
      );
      expectFilteredQuery(feedCase, getRequest(3), [eventType]);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts(`DESC:${eventType}`, DEFAULT_LIMIT * 2),
        );
      });

      // A sort change starts over too, and keeps the filter.
      chooseSortOrder("Oldest first");
      await waitForRequestCount(5);

      expectWindow(feedCase, getRequest(4), SortOrder.Ascending, DEFAULT_LIMIT);
      expectFilteredQuery(feedCase, getRequest(4), [eventType]);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts(`ASC:${eventType}`, DEFAULT_LIMIT),
        );
      });

      // More keeps both the sort and the filter.
      clickMore();
      await waitForRequestCount(6);

      expectWindow(
        feedCase,
        getRequest(5),
        SortOrder.Ascending,
        DEFAULT_LIMIT * 2,
      );
      expectFilteredQuery(feedCase, getRequest(5), [eventType]);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts(`ASC:${eventType}`, DEFAULT_LIMIT * 2),
        );
      });
    },
  );
});

describe("slow responses for a previous view", () => {
  test.each(FEED_CASES)(
    "$name never paints a response for a view the reader has already left",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);
      const pending: Array<PendingRequest> = [];

      mockGetListResponse = holdRequests(pending);

      renderFeedCase(feedCase);
      await waitForRequestCount(1);

      // The reader filters while the first window is still on its way.
      toggleEventType(eventType);
      await waitForRequestCount(2);

      expectFilteredQuery(feedCase, pending[1]!.request, [eventType]);

      // The unfiltered window lands first: it answers a view that is gone.
      await answerRequest(
        pending[0],
        buildPage(feedCase, pending[0]!.request, SERVER_ROW_COUNT),
      );

      expect(getRenderedItemTexts()).toEqual([]);

      // Then they reorder, while the filtered window is still on its way.
      chooseSortOrder("Oldest first");
      await waitForRequestCount(3);

      expectWindow(
        feedCase,
        pending[2]!.request,
        SortOrder.Ascending,
        DEFAULT_LIMIT,
      );
      expectFilteredQuery(feedCase, pending[2]!.request, [eventType]);

      await answerRequest(
        pending[2],
        buildPage(feedCase, pending[2]!.request, SERVER_ROW_COUNT),
      );

      const currentTexts: Array<string> = getViewTexts(
        `ASC:${eventType}`,
        DEFAULT_LIMIT,
      );

      expect(getRenderedItemTexts()).toEqual(currentTexts);

      // The newest-first filtered window lands last, and is dropped too.
      await answerRequest(
        pending[1],
        buildPage(feedCase, pending[1]!.request, SERVER_ROW_COUNT),
      );

      expect(getRenderedItemTexts()).toEqual(currentTexts);

      for (const text of mockPaintedItemTexts) {
        expect(text.startsWith(`ASC:${eventType}#`)).toBe(true);
      }
      expect(mockGetListCalls).toHaveLength(3);
    },
  );

  test.each(FEED_CASES)(
    "$name drops a More still in flight when the reader changes the filter",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);
      const pendingMore: Array<PendingRequest> = [];
      const serve: FeedResponder = serveFeed(feedCase, SERVER_ROW_COUNT);

      mockGetListResponse = (
        request: FeedListRequest,
      ): Promise<FeedPageResponse> => {
        if (
          request.limit > DEFAULT_LIMIT &&
          !getRequestedEventTypes(feedCase, request)
        ) {
          return holdRequests(pendingMore)(request);
        }

        return serve(request);
      };

      renderFeedCase(feedCase);
      await waitForRequestCount(1);
      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(
          getViewTexts("DESC:all", DEFAULT_LIMIT),
        );
      });

      clickMore();
      await waitForRequestCount(2);

      expect(pendingMore).toHaveLength(1);

      toggleEventType(eventType);
      await waitForRequestCount(3);

      const filteredTexts: Array<string> = getViewTexts(
        `DESC:${eventType}`,
        DEFAULT_LIMIT,
      );

      await waitFor((): void => {
        expect(getRenderedItemTexts()).toEqual(filteredTexts);
      });

      await answerRequest(
        pendingMore[0],
        buildPage(feedCase, pendingMore[0]!.request, SERVER_ROW_COUNT),
      );

      expect(getRenderedItemTexts()).toEqual(filteredTexts);
      expect(mockPaintedItemTexts).not.toContain(
        `DESC:all#${DEFAULT_LIMIT + 1}`,
      );

      // The filtered view can still be widened.
      clickMore();
      await waitForRequestCount(4);

      expectWindow(
        feedCase,
        getRequest(3),
        SortOrder.Descending,
        DEFAULT_LIMIT * 2,
      );
      expectFilteredQuery(feedCase, getRequest(3), [eventType]);
    },
  );
});

describe("a later visit", () => {
  test.each(FEED_CASES)(
    "$name restores the sort order but not the event type filter",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);

      const view: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(1);

      chooseSortOrder("Oldest first");
      await waitForRequestCount(2);
      toggleEventType(eventType);
      await waitForRequestCount(3);

      expectWindow(feedCase, getRequest(2), SortOrder.Ascending, DEFAULT_LIMIT);
      expectFilteredQuery(feedCase, getRequest(2), [eventType]);

      view.unmount();
      renderFeedCase(feedCase);
      await waitForRequestCount(4);

      const request: FeedListRequest = getRequest(3);

      expectWindow(feedCase, request, SortOrder.Ascending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, request);

      expect(screen.queryByTestId("feed-options-count")).toBeNull();
      expectTriggerSummary("Oldest first, all event types");

      const panel: HTMLElement = openPanel();

      expect(
        within(panel).getByRole("radio", { name: "Oldest first" }),
      ).toHaveAttribute("aria-checked", "true");
      for (const checkbox of within(panel).getAllByRole("checkbox")) {
        expect(checkbox).not.toBeChecked();
      }
    },
  );

  test.each(FEED_CASES)(
    "$name reads only its own feed kind's stored sort order",
    async (feedCase: FeedCase) => {
      // Every other feed kind chose oldest first; this one never did.
      for (const otherCase of FEED_CASES) {
        if (otherCase.storageKey !== feedCase.storageKey) {
          LocalStorage.setItem(
            getSortOrderStorageKey(otherCase.storageKey),
            SortOrder.Ascending,
          );
        }
      }

      const view: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(1);

      expectWindow(
        feedCase,
        getRequest(0),
        SortOrder.Descending,
        DEFAULT_LIMIT,
      );

      view.unmount();
      LocalStorage.setItem(
        getSortOrderStorageKey(feedCase.storageKey),
        SortOrder.Ascending,
      );

      renderFeedCase(feedCase);
      await waitForRequestCount(2);

      expectWindow(feedCase, getRequest(1), SortOrder.Ascending, DEFAULT_LIMIT);
      expectUnfilteredQuery(feedCase, getRequest(1));
    },
  );
});

describe("moving to another resource", () => {
  test.each(FEED_CASES)(
    "$name reads the new resource unfiltered from its first request, keeps the sort order, and does not bring the filter back",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);
      const storageKey: string = getSortOrderStorageKey(feedCase.storageKey);
      const otherResourceId: ObjectID = ObjectID.generate();

      expect(otherResourceId.toString()).not.toBe(
        feedCase.resourceId.toString(),
      );

      const view: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(1);

      toggleEventType(eventType);
      await waitForRequestCount(2);
      chooseSortOrder("Oldest first");
      await waitForRequestCount(3);

      expectWindow(feedCase, getRequest(2), SortOrder.Ascending, DEFAULT_LIMIT);
      expectFilteredQuery(feedCase, getRequest(2), [eventType]);
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^1$/);

      /*
       * The dashboard moves between resources by handing the same mounted
       * feed a new id. The filter was chosen on the old resource, so it must
       * be gone before the new resource is asked for: exactly one request
       * follows, and it carries the new id alone. A filter dropped a render
       * later (in an effect) would first ask for the new resource with the
       * old filter, then ask again.
       */
      view.rerender(feedCase.render(otherResourceId));
      await waitForRequestCount(4);

      const firstRequestForOther: FeedListRequest = getRequest(3);

      // The order is a preference, not part of the resource: it stays.
      expectWindow(
        feedCase,
        firstRequestForOther,
        SortOrder.Ascending,
        DEFAULT_LIMIT,
      );
      expectUnfilteredQuery(feedCase, firstRequestForOther, otherResourceId);

      expect(screen.queryByTestId("feed-options-count")).toBeNull();
      expectTriggerSummary("Oldest first, all event types");
      // An empty unfiltered feed says so in its own words, not the filter's.
      expect(await screen.findByText(feedCase.noItemsMessage)).toBeVisible();
      expect(screen.queryByText(FILTERED_FEED_NO_ITEMS_MESSAGE)).toBeNull();

      const panel: HTMLElement = openPanel();

      expect(
        within(panel).getByRole("radio", { name: "Oldest first" }),
      ).toHaveAttribute("aria-checked", "true");
      for (const checkbox of within(panel).getAllByRole("checkbox")) {
        expect(checkbox).not.toBeChecked();
      }

      // The stored order is untouched and the filter was never stored.
      expect(window.localStorage.length).toBe(1);
      expect(window.localStorage.getItem(storageKey)).toBe(SortOrder.Ascending);

      /*
       * Going back is another move, not an undo: the first resource's old
       * filter was dropped, not set aside.
       */
      view.rerender(feedCase.render(feedCase.resourceId));
      await waitForRequestCount(5);

      const requestOnReturn: FeedListRequest = getRequest(4);

      expectWindow(
        feedCase,
        requestOnReturn,
        SortOrder.Ascending,
        DEFAULT_LIMIT,
      );
      expectUnfilteredQuery(feedCase, requestOnReturn);
      expect(screen.queryByTestId("feed-options-count")).toBeNull();
      expectTriggerSummary("Oldest first, all event types");

      for (const checkbox of within(openPanel()).getAllByRole("checkbox")) {
        expect(checkbox).not.toBeChecked();
      }
    },
  );
});

describe("the trigger's glyph", () => {
  test.each(FEED_CASES)(
    "$name shows the funnel while newest first and the up arrow while oldest first, whatever the filter",
    async (feedCase: FeedCase) => {
      const eventType: string = getSampleEventType(feedCase);

      const view: RenderResult = renderFeedCase(feedCase);
      await waitForRequestCount(1);

      expect(getTriggerIcon()).toBe(IconProp.Filter);

      // The glyph says the order, so a filter alone leaves the funnel.
      toggleEventType(eventType);
      await waitForRequestCount(2);

      expect(getTriggerIcon()).toBe(IconProp.Filter);

      chooseSortOrder("Oldest first");
      await waitForRequestCount(3);

      expect(getTriggerIcon()).toBe(IconProp.BarsArrowUp);

      // ...and clearing the filter leaves the order, so the arrow stays.
      clickShowAll();
      await waitForRequestCount(4);

      expect(getTriggerIcon()).toBe(IconProp.BarsArrowUp);

      // A remembered order draws the arrow from the first paint.
      view.unmount();
      renderFeedCase(feedCase);

      expect(getTriggerIcon()).toBe(IconProp.BarsArrowUp);

      await waitForRequestCount(5);

      chooseSortOrder("Newest first");
      await waitForRequestCount(6);

      expect(getTriggerIcon()).toBe(IconProp.Filter);
    },
  );
});
