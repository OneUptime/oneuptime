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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The panel every calendar-feed card shows before a link exists.
 *
 * The state used to be a paragraph of prose with a button under it, and the
 * paragraph was the only place the reader was told that the URL is the
 * credential. What this file guards:
 *
 *   - the panel names the state, says what the button will do, and lists what
 *     the link will contain - each point its own line, so none of it depends
 *     on somebody reading a four-line sentence to the end;
 *   - the privacy caution is on screen BEFORE the link is minted, which is
 *     the only moment it can change what the reader does;
 *   - the action lives inside the panel whoever may take it - a Generate
 *     button, a Publish button, a disabled button naming the missing
 *     permission, an "ask an editor" note, or the plan gate;
 *   - the server's deployment warnings stay ABOVE the panel, where they are
 *     read before the click rather than after it;
 *   - and every panel namespaces its test ids, because the schedule page puts
 *     two of them on one screen.
 */

let translations: Record<string, string> = {};
let permissionsForTest: Array<unknown> = [];

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getList: async (): Promise<Record<string, unknown>> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): unknown => {
      return React.createElement("div", {
        "data-testid": "card-model-detail-stub",
      });
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

/*
 * A real lookup, not the identity stub the other feed tests use: the panel is
 * new copy, and a string that skipped translateString would render in English
 * for every non-English reader without anything failing.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return translations[key] ?? options?.defaultValue ?? key;
        },
      };
    },
  };
});

import ObjectID from "../../../Types/ObjectID";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import { JSONObject } from "../../../Types/JSON";
import FeedEmptyState, {
  FeedEmptyStatePoint,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedEmptyState";
import {
  PERSONAL_FEED_EMPTY_DESCRIPTION,
  PERSONAL_FEED_EMPTY_POINT_COVERING,
  PERSONAL_FEED_EMPTY_POINT_PRIVATE,
  PERSONAL_FEED_EMPTY_POINT_SHIFTS,
  PERSONAL_FEED_EMPTY_TITLE,
  PERSONAL_FEED_ROTATE_PATH,
  SHARED_FEED_EMPTY_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard";
import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FEED_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

const EMPTY_STATUS_JSON: JSONObject = {
  exists: false,
  feedId: null,
  isEnabled: false,
  needsRegeneration: false,
  tokenHint: null,
  rotatedAt: null,
  previousTokenExpiresAt: null,
  lastFetchedAt: null,
  lastFetchedClient: null,
  fetchCount: 0,
  lastRenderTruncated: false,
  settings: { pastDays: 2, futureDays: 90 },
  urls: null,
  hostWarning: null,
  protocolWarning: null,
};

const ACTIVE_STATUS_JSON: JSONObject = {
  ...EMPTY_STATUS_JSON,
  exists: true,
  feedId: FEED_ID,
  isEnabled: true,
  tokenHint: "k3Qx",
  rotatedAt: "2026-08-01T10:00:00.000Z",
  urls: {
    https: HTTPS_URL,
    webcal: HTTPS_URL.replace("https:", "webcals:"),
    googleAdd: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
      HTTPS_URL,
    )}`,
  },
};

type OkFunction = (json: JSONObject) => HTTPResponse<JSONObject>;

const ok: OkFunction = (json: JSONObject): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, json, {});
};

function resetMocks(): void {
  translations = {};
  permissionsForTest = [];
  getMock.mockReset();
  postMock.mockReset();
}

function goToProjectPage(): void {
  window.history.pushState({}, "", `/dashboard/${PROJECT_ID}/on-call-duty`);
}

type IsBeforeFunction = (first: HTMLElement, second: HTMLElement) => boolean;

/** True when `first` comes before `second` in document order. */
const isBefore: IsBeforeFunction = (
  first: HTMLElement,
  second: HTMLElement,
): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

type ActionFunction = (label: string) => React.ReactElement;

const action: ActionFunction = (label: string): React.ReactElement => {
  return <button data-testid="panel-action">{label}</button>;
};

describe("FeedEmptyState", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("names the state, says what the action does and hosts the action itself", () => {
    render(
      <FeedEmptyState
        idPrefix="feed"
        title="No calendar link yet"
        description="Generate one, then subscribe from your calendar app."
        control={action("Generate")}
      />,
    );

    expect(screen.getByTestId("feed-empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("feed-empty-title")).toHaveTextContent(
      "No calendar link yet",
    );
    expect(screen.getByTestId("feed-empty-description")).toHaveTextContent(
      "Generate one, then subscribe from your calendar app.",
    );

    // The action is INSIDE the panel, not loose underneath it.
    expect(
      within(screen.getByTestId("feed-empty-control")).getByTestId(
        "panel-action",
      ),
    ).toBeInTheDocument();
  });

  test("no bullet list at all when there is nothing to list", () => {
    const { rerender } = render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        control={action("Go")}
      />,
    );

    expect(screen.queryByTestId("feed-empty-points")).not.toBeInTheDocument();

    // An empty array is the same as no array - not an empty <ul>.
    rerender(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        points={[]}
        control={action("Go")}
      />,
    );

    expect(screen.queryByTestId("feed-empty-points")).not.toBeInTheDocument();
  });

  test("renders one bullet per point, in the order given", () => {
    const points: Array<FeedEmptyStatePoint> = [
      { icon: IconProp.Check, text: "First point" },
      { icon: IconProp.Check, text: "Second point" },
      { icon: IconProp.Lock, text: "Third point" },
    ];

    render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        points={points}
        control={action("Go")}
      />,
    );

    const list: HTMLElement = screen.getByTestId("feed-empty-points");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    expect(screen.getByTestId("feed-empty-point-0")).toHaveTextContent(
      "First point",
    );
    expect(screen.getByTestId("feed-empty-point-1")).toHaveTextContent(
      "Second point",
    );
    expect(screen.getByTestId("feed-empty-point-2")).toHaveTextContent(
      "Third point",
    );
  });

  /*
   * The ticks and the caution have to read differently at a glance: three
   * identical grey glyphs would make "treat it like a password" look like
   * another feature bullet.
   */
  test("a point keeps its own icon colour, and falls back to the muted default", () => {
    render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        points={[
          {
            icon: IconProp.Check,
            text: "Included",
            iconClassName: "text-indigo-600",
          },
          { icon: IconProp.Lock, text: "Caution" },
        ]}
        control={action("Go")}
      />,
    );

    expect(screen.getByTestId("feed-empty-point-icon-0")).toHaveClass(
      "text-indigo-600",
    );
    expect(screen.getByTestId("feed-empty-point-icon-0")).not.toHaveClass(
      "text-gray-400",
    );
    expect(screen.getByTestId("feed-empty-point-icon-1")).toHaveClass(
      "text-gray-400",
    );
  });

  test("the badge is a calendar unless the caller asks for another icon", () => {
    const { unmount } = render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        control={action("Go")}
      />,
    );

    const defaultBadge: string =
      screen.getByTestId("feed-empty-icon").innerHTML;
    unmount();

    render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        icon={IconProp.Calendar}
        control={action("Go")}
      />,
    );

    expect(screen.getByTestId("feed-empty-icon").innerHTML).toBe(defaultBadge);
    cleanup();

    render(
      <FeedEmptyState
        idPrefix="feed"
        title="Title"
        description="Description"
        icon={IconProp.Team}
        control={action("Go")}
      />,
    );

    expect(screen.getByTestId("feed-empty-icon").innerHTML).not.toBe(
      defaultBadge,
    );
  });

  test("every visible string goes through the translator, bullets included", () => {
    translations = {
      "No calendar link yet": "Noch kein Kalenderlink",
      "Generate a private link.": "Erzeugen Sie einen privaten Link.",
      "Every shift you hold.": "Jede Schicht, die Sie haben.",
    };

    render(
      <FeedEmptyState
        idPrefix="feed"
        title="No calendar link yet"
        description="Generate a private link."
        points={[{ icon: IconProp.Check, text: "Every shift you hold." }]}
        control={action("Go")}
      />,
    );

    expect(screen.getByTestId("feed-empty-title")).toHaveTextContent(
      "Noch kein Kalenderlink",
    );
    expect(screen.getByTestId("feed-empty-description")).toHaveTextContent(
      "Erzeugen Sie einen privaten Link.",
    );
    expect(screen.getByTestId("feed-empty-point-0")).toHaveTextContent(
      "Jede Schicht, die Sie haben.",
    );
  });

  /*
   * The schedule page renders the personal panel and the shared panel one
   * above the other. Un-namespaced ids would make getByTestId ambiguous and,
   * worse, make a passing assertion about the wrong panel.
   */
  test("two panels on one page keep entirely distinct test ids", () => {
    render(
      <div>
        <FeedEmptyState
          idPrefix="mine"
          title="Mine"
          description="My link"
          points={[{ icon: IconProp.Check, text: "My point" }]}
          control={action("Generate")}
        />
        <FeedEmptyState
          idPrefix="theirs"
          title="Theirs"
          description="Team link"
          points={[{ icon: IconProp.Check, text: "Their point" }]}
          control={action("Publish")}
        />
      </div>,
    );

    expect(screen.getByTestId("mine-empty-title")).toHaveTextContent("Mine");
    expect(screen.getByTestId("theirs-empty-title")).toHaveTextContent(
      "Theirs",
    );
    expect(screen.getByTestId("mine-empty-point-0")).toHaveTextContent(
      "My point",
    );
    expect(screen.getByTestId("theirs-empty-point-0")).toHaveTextContent(
      "Their point",
    );
    expect(screen.getAllByTestId("panel-action")).toHaveLength(2);
  });
});

describe("PersonalCalendarFeedCard empty state (settings page)", () => {
  beforeEach(() => {
    resetMocks();
    goToProjectPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("names the state, says what Generate does and lists what the link will hold", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("personal-calendar-feed-empty-title"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_TITLE);
    expect(
      screen.getByTestId("personal-calendar-feed-empty-description"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_DESCRIPTION);

    expect(
      screen.getByTestId("personal-calendar-feed-empty-point-0"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_POINT_SHIFTS);
    expect(
      screen.getByTestId("personal-calendar-feed-empty-point-1"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_POINT_COVERING);
    expect(
      screen.getByTestId("personal-calendar-feed-empty-point-2"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_POINT_PRIVATE);
  });

  /*
   * The URL is the credential: anyone holding it reads the shifts. Saying so
   * after the link is minted and pasted into a shared calendar is too late,
   * so the caution has to be part of the state that offers to mint it.
   */
  test("the reader is told the link is a secret BEFORE minting one", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    const caution: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-empty-point-2",
    );
    expect(caution).toHaveTextContent(/private to you/i);
    expect(caution).toHaveTextContent(/like a password/i);
    expect(
      isBefore(caution, screen.getByTestId("personal-calendar-feed-generate")),
    ).toBe(true);
  });

  test("Generate lives inside the panel and still posts to /feed/rotate", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockResolvedValue(ok(ACTIVE_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty-control"),
      ).toBeInTheDocument();
    });

    const control: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-empty-control",
    );
    fireEvent.click(
      within(control).getByTestId("personal-calendar-feed-generate"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(
      String((postMock.mock.calls[0]![0] as Record<string, unknown>)["url"]),
    ).toContain(PERSONAL_FEED_ROTATE_PATH);

    // The panel is for the absent link only; it goes when the link arrives.
    expect(
      screen.queryByTestId("personal-calendar-feed-empty-state"),
    ).not.toBeInTheDocument();
  });

  /*
   * "This link will be unreachable" is only actionable before the click. The
   * warnings are Alerts, and an Alert buried under three bullets inside a
   * grey panel is an Alert nobody reads.
   */
  test("the deployment warnings sit above the panel, and Generate is still offered", async () => {
    getMock.mockResolvedValue(
      ok({
        ...EMPTY_STATUS_JSON,
        hostWarning: "HOST is not set, so the link points at localhost.",
        protocolWarning: "HTTP_PROTOCOL is http, so the link is not encrypted.",
      }),
    );

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    const panel: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-empty-state",
    );
    const host: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-host-warning",
    );
    const protocol: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-protocol-warning",
    );

    expect(isBefore(host, panel)).toBe(true);
    expect(isBefore(protocol, panel)).toBe(true);
    expect(panel).not.toContainElement(host);
    expect(panel).not.toContainElement(protocol);

    // The warning informs the click; it does not take the button away.
    expect(
      screen.getByTestId("personal-calendar-feed-generate"),
    ).toBeInTheDocument();
  });

  test("a failed Generate leaves the panel standing and shows the reason", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockRejectedValue(new Error("Feeds are disabled on this server."));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-generate"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("personal-calendar-feed-generate"));

    await waitFor(() => {
      expect(
        screen.getByText("Feeds are disabled on this server."),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("personal-calendar-feed-empty-state"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("personal-calendar-feed-generate"),
    ).toBeInTheDocument();
  });
});

describe("PersonalCalendarFeedCard empty state (schedule page)", () => {
  beforeEach(() => {
    resetMocks();
    goToProjectPage();
  });

  afterEach(() => {
    cleanup();
  });

  /*
   * The schedule page is half a card inside somebody else's page. It gets the
   * same panel so the two halves match, but the three lines of "what's in it"
   * stay on the settings page the reader went to for the feature.
   */
  test("the narrow variant shows the same panel without the bullet list", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-personal-calendar-feed-empty-title"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_TITLE);
    expect(
      screen.getByTestId("schedule-personal-calendar-feed-empty-description"),
    ).toHaveTextContent(PERSONAL_FEED_EMPTY_DESCRIPTION);
    expect(
      screen.queryByTestId("schedule-personal-calendar-feed-empty-points"),
    ).not.toBeInTheDocument();

    expect(
      within(
        screen.getByTestId("schedule-personal-calendar-feed-empty-control"),
      ).getByTestId("schedule-personal-calendar-feed-generate"),
    ).toBeInTheDocument();
  });

  test("its test ids never collide with the settings page's", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <div>
        <PersonalCalendarFeedCard
          variant={PersonalCalendarFeedVariant.Full}
          now={NOW}
        />
        <PersonalCalendarFeedCard
          variant={PersonalCalendarFeedVariant.Schedule}
          scheduleId={SCHEDULE_ID}
          now={NOW}
        />
      </div>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    // Both panels are on screen, and each id resolves to exactly one of them.
    expect(
      screen.getAllByTestId("personal-calendar-feed-empty-state"),
    ).toHaveLength(1);
    expect(
      screen.getAllByTestId("schedule-personal-calendar-feed-empty-state"),
    ).toHaveLength(1);
    // Only the settings-page panel carries the bullets.
    expect(
      screen.getAllByTestId("personal-calendar-feed-empty-points"),
    ).toHaveLength(1);
  });
});

describe("SharedCalendarFeedCard empty state", () => {
  beforeEach(() => {
    resetMocks();
    goToProjectPage();
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
  });

  afterEach(() => {
    cleanup();
  });

  test("a schedule with no shared link says who the link is for and offers Publish inside the panel", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Schedule}
        scheduleId={SCHEDULE_ID}
        scheduleTimezone="Europe/Stockholm"
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-shared-calendar-feed-empty-title"),
    ).toHaveTextContent(SHARED_FEED_EMPTY_TITLE);
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-empty-description"),
    ).toHaveTextContent("anyone with the link sees everyone's shifts on it");

    expect(
      within(
        screen.getByTestId("schedule-shared-calendar-feed-empty-control"),
      ).getByTestId("schedule-shared-calendar-feed-publish"),
    ).toBeInTheDocument();
  });

  /*
   * The schedule page stacks the personal panel on the shared one. Same
   * shape, same spacing - so the badge is the only thing carrying "this one
   * is mine, that one is the team's" before the reader starts reading.
   */
  test("the shared panel wears a different badge from the personal one", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      <div>
        <PersonalCalendarFeedCard
          variant={PersonalCalendarFeedVariant.Full}
          now={NOW}
        />
        <SharedCalendarFeedCard
          kind={SharedCalendarFeedKind.Schedule}
          scheduleId={SCHEDULE_ID}
          scheduleTimezone="Europe/Stockholm"
          now={NOW}
        />
      </div>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty-icon"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-shared-calendar-feed-empty-icon").innerHTML,
    ).not.toBe(
      screen.getByTestId("personal-calendar-feed-empty-icon").innerHTML,
    );
  });

  test("the project-wide panel says it covers every schedule in the project", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("project-shared-calendar-feed-empty-title"),
    ).toHaveTextContent(SHARED_FEED_EMPTY_TITLE);
    expect(
      screen.getByTestId("project-shared-calendar-feed-empty-description"),
    ).toHaveTextContent("every shift on every schedule in this project");
  });

  /*
   * Not every reader of a schedule may publish its link, and what stands in
   * for the button differs by how much the client knows: a real-but-
   * insufficient permission gets a disabled button naming what is missing, a
   * permission snapshot that has not landed gets a plain note rather than an
   * accusation. Both belong in the same slot, so the panel reads the same
   * either way.
   */
  test("a reader with an insufficient permission gets a disabled Publish in the action slot", async () => {
    permissionsForTest = [Permission.ReadProjectOnCallDutyPolicySchedule];

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Schedule}
        scheduleId={SCHEDULE_ID}
        scheduleTimezone="Europe/Stockholm"
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    const publish: HTMLElement = within(
      screen.getByTestId("schedule-shared-calendar-feed-empty-control"),
    ).getByTestId("schedule-shared-calendar-feed-publish");

    expect(publish).toBeDisabled();
    // The panel still explains the feature; only the action is withheld.
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-empty-description"),
    ).toHaveTextContent("anyone with the link sees everyone's shifts on it");
  });

  test("a reader with no permissions at all gets the 'ask an editor' note there instead", async () => {
    permissionsForTest = [];

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Schedule}
        scheduleId={SCHEDULE_ID}
        scheduleTimezone="Europe/Stockholm"
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    const control: HTMLElement = screen.getByTestId(
      "schedule-shared-calendar-feed-empty-control",
    );

    expect(
      within(control).getByTestId("schedule-shared-calendar-feed-ask-editor"),
    ).toHaveTextContent("Ask an editor of this schedule to publish it.");
    expect(
      within(control).queryByTestId("schedule-shared-calendar-feed-publish"),
    ).not.toBeInTheDocument();
  });

  test("the deployment warnings sit above the shared panel too", async () => {
    permissionsForTest = [Permission.ProjectAdmin];
    getMock.mockResolvedValue(
      ok({
        ...EMPTY_STATUS_JSON,
        hostWarning: "HOST is not set, so the link points at localhost.",
      }),
    );

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-empty-state"),
      ).toBeInTheDocument();
    });

    const panel: HTMLElement = screen.getByTestId(
      "project-shared-calendar-feed-empty-state",
    );
    const host: HTMLElement = screen.getByTestId(
      "project-shared-calendar-feed-host-warning",
    );

    expect(isBefore(host, panel)).toBe(true);
    expect(panel).not.toContainElement(host);
  });
});
