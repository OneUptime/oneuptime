import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The scheduled maintenance overview changes the event's state from its
 * header, which posts a "state changed" item to this feed. The feed used to
 * load once at mount, so that item only appeared after pressing Refresh. The
 * page now bumps refreshToken after every state change; these tests pin that
 * signal, the request the feed makes, the icon for every event type and the
 * note modals' own names and copy.
 */

const getListMock: MockFunction = getJestMockFunction();
const feedRenderMock: MockFunction = getJestMockFunction();
const modalRenderMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

/* Keep the test about feed state, not markdown parsing or timeline chrome. */
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (props: RenderedFeedProps): React.ReactElement => {
      feedRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "rendered-feed" },
        props.items.map((item: RenderedFeedItem): React.ReactElement => {
          return React.createElement(
            "div",
            { key: item.key },
            item.textInMarkdown,
          );
        }),
      );
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: { title: string }): React.ReactElement => {
      modalRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "note-modal" },
        props.title,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import ScheduledMaintenanceFeedElement, {
  SCHEDULED_MAINTENANCE_FEED_ICONS,
  getScheduledMaintenanceFeedIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";

interface RenderedFeedItem {
  key: string;
  textInMarkdown: string;
  icon: IconProp;
}

interface RenderedFeedProps {
  items: Array<RenderedFeedItem>;
}

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

interface FeedListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  skip: number;
  limit: number;
  sort: Record<string, SortOrder>;
}

interface NoteModalProps {
  name: string;
  title: string;
  formProps: {
    name: string;
    id: string;
    fields: Array<{ title: string; description?: string }>;
  };
}

const EVENT_ID: string = "55555555-5555-4555-8555-555555555555";
const POSTED_AT: Date = new Date("2026-09-14T18:00:00.000Z");

function listResult<T>(data: Array<T>): ListResult<T> {
  return { data: data, count: data.length, skip: 0, limit: DEFAULT_LIMIT };
}

function feedItem(
  eventType: ScheduledMaintenanceFeedEventType,
  text: string,
): ScheduledMaintenanceFeed {
  const item: ScheduledMaintenanceFeed = new ScheduledMaintenanceFeed();
  item.id = ObjectID.generate();
  item.scheduledMaintenanceId = new ObjectID(EVENT_ID);
  item.scheduledMaintenanceFeedEventType = eventType;
  item.feedInfoInMarkdown = text;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function renderFeed(refreshToken?: number): RenderResult {
  return render(
    <ScheduledMaintenanceFeedElement
      scheduledMaintenanceId={new ObjectID(EVENT_ID)}
      refreshToken={refreshToken}
    />,
  );
}

function lastRenderedItems(): Array<RenderedFeedItem> {
  const calls: Array<Array<RenderedFeedProps>> = feedRenderMock.mock
    .calls as Array<Array<RenderedFeedProps>>;

  return calls[calls.length - 1]![0]!.items;
}

function lastModalProps(): NoteModalProps {
  const calls: Array<Array<NoteModalProps>> = modalRenderMock.mock
    .calls as Array<Array<NoteModalProps>>;

  return calls[calls.length - 1]![0]!;
}

async function chooseAction(text: string): Promise<void> {
  const trigger: HTMLElement = screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;

  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: text }));
  await flush();
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  feedRenderMock.mockReset();
  modalRenderMock.mockReset();
});

describe("ScheduledMaintenanceFeedElement refresh", () => {
  test("reads the newest activity first for this event", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    renderFeed(0);
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: FeedListRequest = getListMock.mock
      .calls[0]![0] as FeedListRequest;

    expect(request.modelType).toBe(ScheduledMaintenanceFeed);
    expect(request.query["scheduledMaintenanceId"]?.toString()).toBe(EVENT_ID);
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(DEFAULT_LIMIT);
    expect(request.sort).toEqual({ postedAt: SortOrder.Descending });
    expect(request.select).toEqual(
      expect.objectContaining({
        feedInfoInMarkdown: true,
        scheduledMaintenanceFeedEventType: true,
        postedAt: true,
      }),
    );
  });

  test("a new refreshToken re-reads the feed and shows the state change", async () => {
    getListMock
      .mockResolvedValueOnce(
        listResult([
          feedItem(
            ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
            "Event created",
          ),
        ]) as never,
      )
      .mockResolvedValueOnce(
        listResult([
          feedItem(
            ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
            "Changed to Ongoing",
          ),
          feedItem(
            ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
            "Event created",
          ),
        ]) as never,
      );

    const view: RenderResult = renderFeed(0);
    await flush();

    expect(screen.getByText("Event created")).toBeInTheDocument();
    expect(screen.queryByText("Changed to Ongoing")).toBe(null);

    view.rerender(
      <ScheduledMaintenanceFeedElement
        scheduledMaintenanceId={new ObjectID(EVENT_ID)}
        refreshToken={1}
      />,
    );
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Changed to Ongoing")).toBeInTheDocument();
    expect(lastRenderedItems()[0]!.icon).toBe(IconProp.ArrowCircleRight);
  });

  test("re-rendering with the same token, or a new ObjectID for the same event, does not refetch", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    const view: RenderResult = renderFeed(3);
    await flush();

    view.rerender(
      <ScheduledMaintenanceFeedElement
        scheduledMaintenanceId={new ObjectID(EVENT_ID)}
        refreshToken={3}
      />,
    );
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("works without a refreshToken, as before", async () => {
    getListMock.mockResolvedValue(
      listResult([
        feedItem(ScheduledMaintenanceFeedEventType.PublicNote, "A note"),
      ]) as never,
    );

    renderFeed(undefined);
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A note")).toBeInTheDocument();
  });
});

describe("scheduled maintenance feed icons", () => {
  test("every event type has its own icon rather than the fallback circle", () => {
    for (const eventType of Object.values(ScheduledMaintenanceFeedEventType)) {
      const icon: IconProp = getScheduledMaintenanceFeedIcon(eventType);

      expect(icon).toBeTruthy();
      expect(icon).not.toBe(IconProp.Circle);
      expect(SCHEDULED_MAINTENANCE_FEED_ICONS[eventType]).toBe(icon);
    }
  });

  test("maps the rule events that used to fall back to a circle", () => {
    expect(
      getScheduledMaintenanceFeedIcon(
        ScheduledMaintenanceFeedEventType.OwnerRuleExecuted,
      ),
    ).toBe(IconProp.User);
    expect(
      getScheduledMaintenanceFeedIcon(
        ScheduledMaintenanceFeedEventType.LabelRuleExecuted,
      ),
    ).toBe(IconProp.Tag);
  });

  test("keeps the existing icons", () => {
    expect(SCHEDULED_MAINTENANCE_FEED_ICONS).toEqual(
      expect.objectContaining({
        [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated]:
          IconProp.Alert,
        [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged]:
          IconProp.ArrowCircleRight,
        [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated]:
          IconProp.Edit,
        [ScheduledMaintenanceFeedEventType.OwnerNotificationSent]:
          IconProp.Bell,
        [ScheduledMaintenanceFeedEventType.SubscriberNotificationSent]:
          IconProp.Notification,
        [ScheduledMaintenanceFeedEventType.PublicNote]: IconProp.Announcement,
        [ScheduledMaintenanceFeedEventType.PrivateNote]: IconProp.Lock,
        [ScheduledMaintenanceFeedEventType.OwnerUserAdded]: IconProp.User,
        [ScheduledMaintenanceFeedEventType.OwnerTeamAdded]: IconProp.Team,
        [ScheduledMaintenanceFeedEventType.RemediationNotes]: IconProp.Wrench,
        [ScheduledMaintenanceFeedEventType.RootCause]: IconProp.Cube,
        [ScheduledMaintenanceFeedEventType.OwnerUserRemoved]: IconProp.Close,
        [ScheduledMaintenanceFeedEventType.OwnerTeamRemoved]: IconProp.Close,
        [ScheduledMaintenanceFeedEventType.OnCallNotification]: IconProp.Alert,
        [ScheduledMaintenanceFeedEventType.OnCallPolicy]: IconProp.Call,
      }),
    );
  });

  test("falls back to a circle for a missing or unknown type", () => {
    expect(getScheduledMaintenanceFeedIcon(undefined)).toBe(IconProp.Circle);
    expect(
      getScheduledMaintenanceFeedIcon(
        "SomethingNew" as ScheduledMaintenanceFeedEventType,
      ),
    ).toBe(IconProp.Circle);
  });

  test("hands the mapped icon to each rendered item", async () => {
    getListMock.mockResolvedValue(
      listResult([
        feedItem(ScheduledMaintenanceFeedEventType.LabelRuleExecuted, "Labels"),
        feedItem(ScheduledMaintenanceFeedEventType.OwnerRuleExecuted, "Owners"),
      ]) as never,
    );

    renderFeed(0);
    await flush();

    expect(
      lastRenderedItems().map((item: RenderedFeedItem): IconProp => {
        return item.icon;
      }),
    ).toEqual([IconProp.Tag, IconProp.User]);
  });
});

describe("scheduled maintenance note modals", () => {
  test("the public note modal has its own form name and describes a note, not a state change", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    renderFeed(0);
    await flush();
    await chooseAction("Add Public Note");

    const props: NoteModalProps = lastModalProps();

    expect(props.title).toBe("Add Public Note to this scheduled maintenance");
    expect(props.name).toBe("create-scheduled-maintenance-public-note");
    expect(props.formProps.name).toBe(
      "create-scheduled-maintenance-public-note",
    );
    expect(props.formProps.id).toBe("create-scheduled-maintenance-public-note");

    const noteField: { title: string; description?: string } =
      props.formProps.fields[0]!;

    expect(noteField.title).toBe("Public Note");
    expect(noteField.description).not.toMatch(/state change/i);
    expect(noteField.description).toMatch(/status page/i);
  });

  test("the private note modal has its own correctly spelled form name", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    renderFeed(0);
    await flush();
    await chooseAction("Add Private Note");

    const props: NoteModalProps = lastModalProps();

    expect(props.title).toBe("Add Private Note to this scheduled maintenance");
    expect(props.name).toBe("create-scheduled-maintenance-internal-note");
    expect(props.formProps.name).toBe(
      "create-scheduled-maintenance-internal-note",
    );
    expect(props.formProps.id).toBe(
      "create-scheduled-maintenance-internal-note",
    );
  });
});
