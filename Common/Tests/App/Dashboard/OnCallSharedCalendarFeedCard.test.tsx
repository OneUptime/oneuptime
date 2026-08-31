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
 * The shared (project-owned) calendar links: one per schedule, one for the
 * whole project. Unlike the personal link these are gated - whoever holds the
 * URL sees everybody's shifts - so the assertions here are as much about WHO
 * gets a working button as about what the button does:
 *
 *   - an editor publishes / regenerates / disables;
 *   - a reader with a real-but-insufficient permission sees the same buttons
 *     disabled, with the missing permission named (issue #3306 rule);
 *   - a reader whose permission snapshot has not landed sees no accusation,
 *     just "ask an editor";
 *   - and everybody who can see the schedule may copy a published link.
 *
 * PermissionGate is exercised for real: the permission list and the master
 * admin flag are the only things mocked.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      const fieldTitles: Array<string> = (props["formFields"] || []).map(
        (field: Record<string, unknown>): string => {
          return String(field["title"]);
        },
      );

      return React.createElement(
        "div",
        {
          "data-testid": "card-model-detail-stub",
          "data-model-id": String(props["modelDetailProps"]?.modelId),
          "data-model-name": String(
            new props["modelDetailProps"].modelType().tableName,
          ),
          "data-editable": String(props["isEditable"]),
        },
        `${props["cardProps"]?.title}|${fieldTitles.join(",")}`,
      );
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
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

import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import {
  PROJECT_FEED_CURRENT_PATH,
  PROJECT_FEED_PUBLISH_PATH,
  PROJECT_FEED_ROTATE_PATH,
  SHARED_LINK_OWNERSHIP_COPY,
  buildGoogleAddUrl,
  getScheduleFeedCurrentPath,
  getScheduleFeedPublishPath,
  getScheduleFeedRotatePath,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
  getSharedFeedPaths,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard";
import ScheduleSubscribeCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard";
import OnCallDutyCalendarFeeds from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/CalendarFeeds";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FEED_ID: string = "55555555-5555-4555-8555-555555555555";
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

const HTTPS_URL: string = `https://oneuptime.example.com/api/on-call-calendar/schedule/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/schedule.ics`;
const WEBCAL_URL: string = HTTPS_URL.replace("https:", "webcals:");

// Every project-level role that may publish a shared link.
const EDITOR_PERMISSIONS: Array<Permission> = [Permission.ProjectAdmin];
// May read the schedule (and therefore the card) but never edit it.
const READER_PERMISSIONS: Array<Permission> = [
  Permission.ReadProjectOnCallDutyPolicySchedule,
];

type StatusJsonFunction = (overrides?: JSONObject) => JSONObject;

const publishedJson: StatusJsonFunction = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    exists: true,
    feedId: FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "t34m",
    rotatedAt: "2026-08-01T12:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: {
      includeCoverageGaps: false,
      minimumGapMinutes: 60,
      pastDays: 2,
      futureDays: 90,
      rotateWhenMemberLeaves: false,
    },
    urls: {
      https: HTTPS_URL,
      webcal: WEBCAL_URL,
      googleAdd: buildGoogleAddUrl(HTTPS_URL),
    },
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
};

const UNPUBLISHED_JSON: JSONObject = {
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

type OkFunction = (json: JSONObject) => HTTPResponse<JSONObject>;

const ok: OkFunction = (json: JSONObject): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, json, {});
};

type FailFunction = (status: number, message: string) => HTTPErrorResponse;

const fail: FailFunction = (
  status: number,
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(status, { message: message }, {});
};

type UrlOfFunction = (call: Array<unknown>) => string;

const urlOf: UrlOfFunction = (call: Array<unknown>): string => {
  return String((call[0] as Record<string, unknown>)["url"]);
};

function goToSchedulePage(): void {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${SCHEDULE_ID.toString()}`,
  );
}

function resetMocks(): void {
  getMock.mockReset();
  postMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue(undefined);
  isMasterAdminForTest = false;
  permissionsForTest = EDITOR_PERMISSIONS;
}

function renderScheduleCard(
  timezone?: string | null | undefined,
): ReturnType<typeof render> {
  return render(
    <SharedCalendarFeedCard
      kind={SharedCalendarFeedKind.Schedule}
      scheduleId={SCHEDULE_ID}
      scheduleTimezone={timezone}
      now={NOW}
    />,
  );
}

describe("getSharedFeedPaths", () => {
  test("the schedule kind uses the schedule-feed routes with the id embedded", () => {
    expect(
      getSharedFeedPaths(SharedCalendarFeedKind.Schedule, SCHEDULE_ID),
    ).toEqual({
      current: getScheduleFeedCurrentPath(SCHEDULE_ID.toString()),
      publish: getScheduleFeedPublishPath(SCHEDULE_ID.toString()),
      rotate: getScheduleFeedRotatePath(SCHEDULE_ID.toString()),
    });
  });

  test("the project kind uses the project-feed routes and ignores any schedule id", () => {
    expect(
      getSharedFeedPaths(SharedCalendarFeedKind.Project, SCHEDULE_ID),
    ).toEqual({
      current: PROJECT_FEED_CURRENT_PATH,
      publish: PROJECT_FEED_PUBLISH_PATH,
      rotate: PROJECT_FEED_ROTATE_PATH,
    });
    expect(
      getSharedFeedPaths(SharedCalendarFeedKind.Project, undefined).current,
    ).toBe(PROJECT_FEED_CURRENT_PATH);
  });
});

describe("SharedCalendarFeedCard - publishing", () => {
  beforeEach(() => {
    resetMocks();
    goToSchedulePage();
  });

  afterEach(() => {
    cleanup();
  });

  test("reads the schedule feed's /current on mount", async () => {
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty"),
      ).toBeInTheDocument();
    });

    expect(urlOf(getMock.mock.calls[0] as Array<unknown>)).toContain(
      getScheduleFeedCurrentPath(SCHEDULE_ID.toString()),
    );
  });

  test("an editor gets a working Publish button that posts to /publish", async () => {
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));
    postMock.mockResolvedValue(ok(publishedJson()));

    renderScheduleCard("Europe/Stockholm");

    const publish: HTMLElement = await screen.findByTestId(
      "schedule-shared-calendar-feed-publish",
    );
    expect(publish).not.toBeDisabled();

    fireEvent.click(publish);

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      getScheduleFeedPublishPath(SCHEDULE_ID.toString()),
    );
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-webcal"),
    ).toHaveAttribute("href", WEBCAL_URL);
  });

  test("a master admin is an editor everywhere", async () => {
    isMasterAdminForTest = true;
    permissionsForTest = [];
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));

    renderScheduleCard("Europe/Stockholm");

    const publish: HTMLElement = await screen.findByTestId(
      "schedule-shared-calendar-feed-publish",
    );
    expect(publish).not.toBeDisabled();
  });

  test("a reader with an insufficient permission sees Publish disabled, with the reason", async () => {
    permissionsForTest = READER_PERMISSIONS;
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));

    renderScheduleCard("Europe/Stockholm");

    const publish: HTMLElement = await screen.findByTestId(
      "schedule-shared-calendar-feed-publish",
    );
    expect(publish).toBeDisabled();

    fireEvent.click(publish);
    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-ask-editor"),
    ).not.toBeInTheDocument();
  });

  test("with no permission snapshot yet, the card asks for an editor instead of accusing", async () => {
    permissionsForTest = [];
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-ask-editor"),
      ).toHaveTextContent("Ask an editor of this schedule to publish it.");
    });
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-publish"),
    ).not.toBeInTheDocument();
  });

  test("the project kind asks for a project editor and reads the project-feed route", async () => {
    permissionsForTest = [];
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-ask-editor"),
      ).toHaveTextContent("Ask a project editor to publish it.");
    });
    expect(urlOf(getMock.mock.calls[0] as Array<unknown>)).toContain(
      PROJECT_FEED_CURRENT_PATH,
    );
    expect(
      screen.getByText(/No project-wide link has been published yet/),
    ).toBeInTheDocument();
  });

  test("a failed publish keeps the empty state and shows the server's message", async () => {
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));
    postMock.mockResolvedValue(fail(403, "You need Edit on this schedule"));

    renderScheduleCard("Europe/Stockholm");

    fireEvent.click(
      await screen.findByTestId("schedule-shared-calendar-feed-publish"),
    );

    await waitFor(() => {
      expect(
        screen.getByText("You need Edit on this schedule"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-empty"),
    ).toBeInTheDocument();
  });
});

describe("SharedCalendarFeedCard - a published link", () => {
  beforeEach(() => {
    resetMocks();
    goToSchedulePage();
  });

  afterEach(() => {
    cleanup();
  });

  test("shows the links, the rotation age, the ownership copy and the settings card", async () => {
    getMock.mockResolvedValue(ok(publishedJson()));

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-shared-calendar-feed-links"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-status-line"),
    ).toHaveTextContent("Last rotated 30 days ago");
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-status-line"),
    ).toHaveTextContent("…t34m");
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-ownership"),
    ).toHaveTextContent(SHARED_LINK_OWNERSHIP_COPY);

    const settings: HTMLElement = screen.getByTestId("card-model-detail-stub");
    expect(settings).toHaveAttribute("data-model-id", FEED_ID);
    expect(settings).toHaveAttribute(
      "data-model-name",
      new OnCallDutyPolicyScheduleCalendarFeed().tableName,
    );
    expect(settings).toHaveAttribute("data-editable", "true");
    expect(settings).toHaveTextContent(
      "Shared link settings|Show coverage gaps,Minimum gap to show (minutes),Days of past shifts,Days ahead,Regenerate when someone leaves the project",
    );

    expect(
      screen.getByRole("button", { name: "Regenerate link" }),
    ).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable" })).not.toBeDisabled();
  });

  test("a reader may copy the link but the editor buttons are disabled and the settings read-only", async () => {
    permissionsForTest = READER_PERMISSIONS;
    getMock.mockResolvedValue(ok(publishedJson()));

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Regenerate link" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(screen.getByTestId("card-model-detail-stub")).toHaveAttribute(
      "data-editable",
      "false",
    );
  });

  test("without a permission snapshot the editor buttons are hidden, the link still copyable", async () => {
    permissionsForTest = [];
    getMock.mockResolvedValue(ok(publishedJson()));

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Regenerate link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Disable" }),
    ).not.toBeInTheDocument();
  });

  test("Regenerate confirms first, then posts to /rotate", async () => {
    getMock.mockResolvedValue(ok(publishedJson()));
    postMock.mockResolvedValue(
      ok(
        publishedJson({
          tokenHint: "r0t8",
          previousTokenExpiresAt: "2026-09-30T12:00:00.000Z",
        }),
      ),
    );

    renderScheduleCard("Europe/Stockholm");

    fireEvent.click(
      await screen.findByRole("button", { name: "Regenerate link" }),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Regenerate link" }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      getScheduleFeedRotatePath(SCHEDULE_ID.toString()),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-previous-link"),
      ).toHaveTextContent("The previous link keeps working until");
    });
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-status-line"),
    ).toHaveTextContent("…r0t8");
  });

  test("Disable writes isEnabled=false on the schedule feed model and re-reads", async () => {
    getMock
      .mockResolvedValueOnce(ok(publishedJson()))
      .mockResolvedValueOnce(ok(publishedJson({ isEnabled: false })));

    renderScheduleCard("Europe/Stockholm");

    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const call: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(OnCallDutyPolicyScheduleCalendarFeed);
    expect(String(call["id"])).toBe(FEED_ID);
    expect(call["data"]).toEqual({ isEnabled: false });

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-disabled"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    // The link stays visible under the warning so an editor can still copy it.
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-links"),
    ).toBeInTheDocument();
  });

  test("the project kind writes to the project feed model and posts to the project routes", async () => {
    getMock
      .mockResolvedValueOnce(ok(publishedJson()))
      .mockResolvedValueOnce(ok(publishedJson({ isEnabled: false })));
    postMock.mockResolvedValue(ok(publishedJson({ tokenHint: "pr0j" })));

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("card-model-detail-stub")).toHaveAttribute(
      "data-model-name",
      new ProjectOnCallCalendarFeed().tableName,
    );

    fireEvent.click(screen.getByRole("button", { name: "Regenerate link" }));
    const modal: HTMLElement = await screen.findByTestId("modal");
    fireEvent.click(
      within(modal).getByRole("button", { name: "Regenerate link" }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      PROJECT_FEED_ROTATE_PATH,
    );

    // Let the rotate round trip settle: the card buttons are inert while busy.
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-status-line"),
      ).toHaveTextContent("…pr0j");
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)[
        "modelType"
      ],
    ).toBe(ProjectOnCallCalendarFeed);
  });

  test("an unreadable stored link tells the reader an editor must regenerate it", async () => {
    getMock.mockResolvedValue(
      ok(publishedJson({ needsRegeneration: true, urls: null })),
    );

    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-needs-regeneration"),
      ).toHaveTextContent("until an editor regenerates it");
    });
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-links"),
    ).not.toBeInTheDocument();
  });

  test("a 404 hides the feature; any other failure shows the message", async () => {
    getMock.mockResolvedValueOnce(fail(404, "Not found"));

    const first: ReturnType<typeof render> =
      renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-unsupported"),
      ).toBeInTheDocument();
    });
    first.unmount();

    getMock.mockResolvedValueOnce(fail(500, "Database is away"));
    renderScheduleCard("Europe/Stockholm");

    await waitFor(() => {
      expect(screen.getByText("Database is away")).toBeInTheDocument();
    });
  });
});

describe("SharedCalendarFeedCard - legacy timezone warning", () => {
  beforeEach(() => {
    resetMocks();
    goToSchedulePage();
    getMock.mockResolvedValue(ok(publishedJson()));
  });

  afterEach(() => {
    cleanup();
  });

  test("warns for a schedule without a timezone (null or empty)", async () => {
    renderScheduleCard(null);

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-timezone-warning"),
      ).toHaveTextContent("shown in UTC");
    });
    cleanup();

    renderScheduleCard("");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-timezone-warning"),
      ).toBeInTheDocument();
    });
  });

  test("stays quiet while the schedule is still loading (undefined) and for a real timezone", async () => {
    renderScheduleCard(undefined);

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-timezone-warning"),
    ).not.toBeInTheDocument();
    cleanup();

    renderScheduleCard("America/New_York");

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-timezone-warning"),
    ).not.toBeInTheDocument();
  });

  test("the project kind never warns about a timezone", async () => {
    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        scheduleTimezone={null}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-active"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("project-shared-calendar-feed-timezone-warning"),
    ).not.toBeInTheDocument();
  });
});

describe("ScheduleSubscribeCard", () => {
  beforeEach(() => {
    resetMocks();
    goToSchedulePage();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the personal half narrowed to the schedule and the shared half", async () => {
    getMock.mockImplementation((args: Record<string, unknown>) => {
      const url: string = String(args["url"]);

      if (url.includes("/feed/current")) {
        return Promise.resolve(
          ok(
            publishedJson({
              urls: {
                https: HTTPS_URL.replace("/schedule/", "/user/"),
                webcal: WEBCAL_URL.replace("/schedule/", "/user/"),
                googleAdd: buildGoogleAddUrl(
                  HTTPS_URL.replace("/schedule/", "/user/"),
                ),
              },
            }),
          ),
        );
      }

      return Promise.resolve(ok(publishedJson()));
    });

    render(
      <ScheduleSubscribeCard
        scheduleId={SCHEDULE_ID}
        scheduleTimezone="Europe/Stockholm"
        now={NOW}
      />,
    );

    expect(screen.getByText("Subscribe to this schedule")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-links"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-personal-calendar-feed-webcal"),
    ).toHaveAttribute(
      "href",
      `${WEBCAL_URL.replace("/schedule/", "/user/")}?schedule=${SCHEDULE_ID.toString()}`,
    );
    // The shared link is never narrowed - it is per schedule by construction.
    expect(
      screen.getByTestId("schedule-shared-calendar-feed-webcal"),
    ).toHaveAttribute("href", WEBCAL_URL);

    // Two status reads: the personal feed and the schedule feed.
    const urls: Array<string> = getMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return urlOf(call);
      },
    );
    expect(
      urls.some((url: string): boolean => {
        return url.includes("/feed/current");
      }),
    ).toBe(true);
    expect(
      urls.some((url: string): boolean => {
        return url.includes(getScheduleFeedCurrentPath(SCHEDULE_ID.toString()));
      }),
    ).toBe(true);
  });
});

describe("On-Call Duty > Calendar Feeds page", () => {
  beforeEach(() => {
    resetMocks();
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/on-call-duty/calendar-feeds`,
    );
    getMock.mockResolvedValue(ok(UNPUBLISHED_JSON));
  });

  afterEach(() => {
    cleanup();
  });

  test("maps the three kinds of link and hosts the project-wide card", async () => {
    render(
      <OnCallDutyCalendarFeeds
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    const personalRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
    );
    const schedulesRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
    );

    expect(
      within(screen.getByTestId("calendar-feeds-personal-pointer"))
        .getByText("Open your calendar feed")
        .closest("a"),
    ).toHaveAttribute("href", personalRoute.toString());
    expect(
      within(screen.getByTestId("calendar-feeds-schedule-pointer"))
        .getByText("Go to schedules")
        .closest("a"),
    ).toHaveAttribute("href", schedulesRoute.toString());
    expect(
      screen.getByTestId("calendar-feeds-project-pointer"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-empty"),
      ).toBeInTheDocument();
    });
    expect(urlOf(getMock.mock.calls[0] as Array<unknown>)).toContain(
      PROJECT_FEED_CURRENT_PATH,
    );
  });

  test("the 'Your personal feed' button navigates to the User Settings page", () => {
    const navigateMock: MockFunction = getJestMockFunction();
    const originalNavigate: typeof Navigation.navigate = Navigation.navigate;
    Navigation.navigate = navigateMock as unknown as typeof Navigation.navigate;

    render(
      <OnCallDutyCalendarFeeds
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Your personal feed" }));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
      ).toString(),
    );

    Navigation.navigate = originalNavigate;
  });
});
