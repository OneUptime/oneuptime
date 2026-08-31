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
 * The reader's own calendar link, rendered for real against a stubbed API.
 *
 * What this file guards: the link is only ever minted through POST /rotate
 * (there is no client-side token anywhere), the four states a feed can be in
 * (absent / active / disabled / unreadable) each look different and offer the
 * right next step, every write goes to the right route or model with the
 * right payload, an older API (404) hides the feature rather than erroring,
 * and the schedule variant narrows the same link with ?schedule= while
 * pointing back to the full page for everything else.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
        if (error instanceof Error) {
          return error.message;
        }

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
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

/*
 * The settings card is ModelDetail machinery (its own fetch, its own form).
 * It is replaced with a stub that prints what it was asked to show, so the
 * assertions here are about WHICH model, id and fields the card is wired to,
 * not about ModelDetail itself.
 */
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
      getUserId: (): ObjectID => {
        return new ObjectID("44444444-4444-4444-8444-444444444444");
      },
      isMasterAdmin: (): boolean => {
        return false;
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import UserOnCallCalendarFeed from "../../../Models/DatabaseModels/UserOnCallCalendarFeed";
import FeedStatusLine from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedStatusLine";
import { FeedStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  PERSONAL_FEED_CURRENT_PATH,
  PERSONAL_FEED_ROTATE_PATH,
  PLANNING_NOT_AUDIT_COPY,
  buildGoogleAddUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard";
import UserSettingsOnCallCalendarFeed from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallCalendarFeed";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FEED_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

const HTTPS_URL: string = `https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics`;
const WEBCAL_URL: string = HTTPS_URL.replace("https:", "webcals:");

type StatusJsonFunction = (overrides?: JSONObject) => JSONObject;

const activeStatusJson: StatusJsonFunction = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    exists: true,
    feedId: FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: "2026-08-01T10:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: "2026-08-31T10:00:00.000Z",
    lastFetchedClient: "Google Calendar",
    fetchCount: 143,
    lastRenderTruncated: false,
    settings: {
      includeCoveringShifts: true,
      pastDays: 2,
      futureDays: 90,
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

type StatusFunction = (overrides?: Partial<FeedStatus>) => FeedStatus;

const status: StatusFunction = (
  overrides?: Partial<FeedStatus>,
): FeedStatus => {
  return {
    exists: true,
    feedId: FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: "2026-08-01T10:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: null,
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
};

function goToCalendarFeedPage(): void {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/user-settings/calendar-feed`,
  );
}

function resetMocks(): void {
  getMock.mockReset();
  postMock.mockReset();
  updateByIdMock.mockReset();
  deleteItemMock.mockReset();
  getListMock.mockReset();
  updateByIdMock.mockResolvedValue(undefined);
  deleteItemMock.mockResolvedValue(undefined);
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
}

describe("FeedStatusLine", () => {
  afterEach(() => {
    cleanup();
  });

  test("says 'Not fetched yet' and the link hint when nothing has fetched the link", () => {
    render(<FeedStatusLine status={status()} now={NOW} />);

    const line: HTMLElement = screen.getByTestId("calendar-feed-status-line");

    expect(line).toHaveTextContent("Not fetched yet");
    expect(line).toHaveTextContent("link ending in …k3Qx");
    expect(line).not.toHaveTextContent("Last rotated");
  });

  test("composes last fetched / client / approximate count / hint", () => {
    render(
      <FeedStatusLine
        status={status({
          lastFetchedAt: "2026-08-31T10:00:00.000Z",
          lastFetchedClient: "Google Calendar",
          fetchCount: 143,
        })}
        now={NOW}
      />,
    );

    const line: HTMLElement = screen.getByTestId("calendar-feed-status-line");

    expect(line).toHaveTextContent("Last fetched");
    expect(line).toHaveTextContent("by Google Calendar");
    expect(line).toHaveTextContent("~143 fetches");
    expect(line).toHaveTextContent("link ending in …k3Qx");
  });

  test("uses the singular for exactly one fetch and omits the count at zero", () => {
    const { rerender } = render(
      <FeedStatusLine
        status={status({
          lastFetchedAt: "2026-08-31T10:00:00.000Z",
          fetchCount: 1,
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("calendar-feed-status-line")).toHaveTextContent(
      "~1 fetch",
    );

    rerender(
      <FeedStatusLine
        status={status({
          lastFetchedAt: "2026-08-31T10:00:00.000Z",
          fetchCount: 0,
        })}
        now={NOW}
      />,
    );

    expect(
      screen.getByTestId("calendar-feed-status-line"),
    ).not.toHaveTextContent("~");
  });

  test("shows the rotation age only when asked, with today / 1 day / N days phrasing", () => {
    const { rerender } = render(
      <FeedStatusLine
        status={status({ rotatedAt: "2026-08-01T10:00:00.000Z" })}
        now={NOW}
        showRotatedAgo={true}
      />,
    );

    expect(screen.getByTestId("calendar-feed-status-line")).toHaveTextContent(
      "Last rotated 30 days ago",
    );

    rerender(
      <FeedStatusLine
        status={status({ rotatedAt: "2026-08-30T08:00:00.000Z" })}
        now={NOW}
        showRotatedAgo={true}
      />,
    );

    expect(screen.getByTestId("calendar-feed-status-line")).toHaveTextContent(
      "Last rotated 1 day ago",
    );

    rerender(
      <FeedStatusLine
        status={status({ rotatedAt: "2026-08-31T08:00:00.000Z" })}
        now={NOW}
        showRotatedAgo={true}
      />,
    );

    expect(screen.getByTestId("calendar-feed-status-line")).toHaveTextContent(
      "Last rotated today",
    );
  });

  test("the reachability hint appears only after 48 hours without a fetch", () => {
    const { rerender } = render(
      <FeedStatusLine
        status={status({ rotatedAt: "2026-08-01T10:00:00.000Z" })}
        now={NOW}
      />,
    );

    expect(
      screen.getByTestId("calendar-feed-nothing-fetched-hint"),
    ).toHaveTextContent("Nothing has fetched this link yet");

    rerender(
      <FeedStatusLine
        status={status({ rotatedAt: "2026-08-31T00:00:00.000Z" })}
        now={NOW}
      />,
    );

    expect(
      screen.queryByTestId("calendar-feed-nothing-fetched-hint"),
    ).not.toBeInTheDocument();
  });

  test("idPrefix namespaces the test ids", () => {
    render(<FeedStatusLine status={status()} now={NOW} idPrefix="shared" />);

    expect(screen.getByTestId("shared-status-line")).toBeInTheDocument();
  });
});

describe("PersonalCalendarFeedCard (full variant)", () => {
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("reads /feed/current on mount and shows the empty state with a Generate button", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty"),
      ).toBeInTheDocument();
    });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(urlOf(getMock.mock.calls[0] as Array<unknown>)).toContain(
      PERSONAL_FEED_CURRENT_PATH,
    );
    expect(
      screen.getByTestId("personal-calendar-feed-generate"),
    ).toBeInTheDocument();
    // No card buttons (regenerate / disable / delete) before a link exists.
    expect(screen.queryByTestId("card-button")).not.toBeInTheDocument();
    // No settings card before a link exists.
    expect(
      screen.queryByTestId("card-model-detail-stub"),
    ).not.toBeInTheDocument();
  });

  test("Generate posts to /feed/rotate with an empty JSON body and renders the returned link", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockResolvedValue(ok(activeStatusJson()));

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
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      PERSONAL_FEED_ROTATE_PATH,
    );
    expect(
      (postMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({});

    // The link block, hidden until revealed, and the webcal anchor.
    expect(
      screen.getByTestId("personal-calendar-feed-links"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("personal-calendar-feed-webcal")).toHaveAttribute(
      "href",
      WEBCAL_URL,
    );
    expect(screen.queryByText(HTTPS_URL)).not.toBeInTheDocument();

    // The settings card is wired to the personal feed model and this feed id.
    const settings: HTMLElement = screen.getByTestId("card-model-detail-stub");
    expect(settings).toHaveAttribute("data-model-id", FEED_ID);
    expect(settings).toHaveAttribute(
      "data-model-name",
      new UserOnCallCalendarFeed().tableName,
    );
    expect(settings).toHaveTextContent(
      "Calendar feed settings|Include shifts I cover for others,Days of past shifts,Days ahead",
    );
  });

  test("an active feed shows the bookkeeping line, the Time Log pointer and the refresh alert", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson()));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("personal-calendar-feed-status-line"),
    ).toHaveTextContent("by Google Calendar");
    expect(
      screen.getByTestId("personal-calendar-feed-status-line"),
    ).toHaveTextContent("~143 fetches");

    const timeLog: HTMLElement = screen.getByTestId(
      "personal-calendar-feed-time-log",
    );
    expect(timeLog).toHaveTextContent(PLANNING_NOT_AUDIT_COPY);
    const expectedTimeLogRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route,
    );
    expect(
      within(timeLog).getByText("Open the On-Call Time Log").closest("a"),
    ).toHaveAttribute("href", expectedTimeLogRoute.toString());

    expect(
      screen.getByTestId("personal-calendar-feed-refresh-alert"),
    ).toBeInTheDocument();

    // Regenerate / Disable / Delete are offered once a link exists.
    expect(
      screen.getByRole("button", { name: "Regenerate link" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  test("a rotated-out previous link is announced with its expiry", async () => {
    getMock.mockResolvedValue(
      ok(
        activeStatusJson({
          previousTokenExpiresAt: "2026-09-30T10:00:00.000Z",
        }),
      ),
    );

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-previous-link"),
      ).toHaveTextContent("Your previous link keeps working until");
    });
  });

  test("Regenerate asks for confirmation, then posts to /feed/rotate", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson()));
    postMock.mockResolvedValue(ok(activeStatusJson({ tokenHint: "n3wX" })));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Regenerate link" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate link" }));

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(
      within(modal).getByTestId("confirm-modal-description"),
    ).toHaveTextContent("The old link keeps working for 30 days");
    // Nothing is posted until the reader confirms.
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Regenerate link" }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      PERSONAL_FEED_ROTATE_PATH,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId("personal-calendar-feed-status-line"),
    ).toHaveTextContent("…n3wX");
  });

  test("Disable updates isEnabled on the personal feed row and re-reads the status", async () => {
    getMock
      .mockResolvedValueOnce(ok(activeStatusJson()))
      .mockResolvedValueOnce(ok(activeStatusJson({ isEnabled: false })));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Disable" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const call: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(UserOnCallCalendarFeed);
    expect(String(call["id"])).toBe(FEED_ID);
    expect(call["data"]).toEqual({ isEnabled: false });

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-disabled"),
      ).toBeInTheDocument();
    });
    expect(getMock).toHaveBeenCalledTimes(2);
    /*
     * A disabled feed offers Enable; the link stays visible under the
     * warning so the reader can still copy it for later.
     */
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(
      screen.getByTestId("personal-calendar-feed-links"),
    ).toBeInTheDocument();
  });

  test("Delete asks for confirmation, then deletes the row and re-reads", async () => {
    getMock
      .mockResolvedValueOnce(ok(activeStatusJson()))
      .mockResolvedValueOnce(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Delete" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(deleteItemMock).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    const call: Record<string, unknown> = deleteItemMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["modelType"]).toBe(UserOnCallCalendarFeed);
    expect(String(call["id"])).toBe(FEED_ID);

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty"),
      ).toBeInTheDocument();
    });
  });

  test("an unreadable stored link shows the regenerate warning and no link", async () => {
    getMock.mockResolvedValue(
      ok(activeStatusJson({ needsRegeneration: true, urls: null })),
    );

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-needs-regeneration"),
      ).toHaveTextContent("encryption secret changed");
    });

    expect(
      screen.queryByTestId("personal-calendar-feed-links"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerate link" }),
    ).toBeInTheDocument();
  });

  test("server warnings attached to the link are shown next to it", async () => {
    getMock.mockResolvedValue(
      ok(
        activeStatusJson({
          hostWarning: "Set HOST to your public hostname",
          protocolWarning: "This link will travel unencrypted",
          lastRenderTruncated: true,
        }),
      ),
    );

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-host-warning"),
      ).toHaveTextContent("Set HOST to your public hostname");
    });
    expect(
      screen.getByTestId("personal-calendar-feed-protocol-warning"),
    ).toHaveTextContent("This link will travel unencrypted");
    expect(
      screen.getByTestId("personal-calendar-feed-truncated-warning"),
    ).toBeInTheDocument();
  });

  test("a 404 from an older API hides the feature instead of erroring", async () => {
    getMock.mockResolvedValue(fail(404, "Not found"));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-unsupported"),
      ).toHaveTextContent("does not offer calendar feeds yet");
    });

    expect(
      screen.queryByTestId("personal-calendar-feed-generate"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
  });

  test("any other failure surfaces the server's own message", async () => {
    getMock.mockResolvedValue(fail(500, "Redis is on fire"));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Redis is on fire")).toBeInTheDocument();
    });
  });

  test("a failed Generate keeps the empty state and shows the reason", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockResolvedValue(
      fail(402, "Upgrade to Growth to use calendar feeds"),
    );

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
        screen.getByText("Upgrade to Growth to use calendar feeds"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("personal-calendar-feed-empty"),
    ).toBeInTheDocument();
  });
});

describe("PersonalCalendarFeedCard (schedule variant)", () => {
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("narrows the personal link to the schedule and points at the full page", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson()));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-personal-calendar-feed-webcal"),
    ).toHaveAttribute(
      "href",
      `${WEBCAL_URL}?schedule=${SCHEDULE_ID.toString()}`,
    );
    // The page renders the refresh alert once, so the schedule half does not.
    expect(
      screen.queryByTestId("schedule-personal-calendar-feed-refresh-alert"),
    ).not.toBeInTheDocument();

    const expectedRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
    );
    expect(
      screen.getByText("Manage your calendar link and reminders").closest("a"),
    ).toHaveAttribute("href", expectedRoute.toString());

    // No regenerate / disable / delete controls in the narrow variant.
    expect(screen.queryByTestId("card-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-model-detail-stub"),
    ).not.toBeInTheDocument();
  });

  test("offers Generate when no link exists and posts to /feed/rotate", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockResolvedValue(ok(activeStatusJson()));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-generate"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTestId("schedule-personal-calendar-feed-generate"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-links"),
      ).toBeInTheDocument();
    });
    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      PERSONAL_FEED_ROTATE_PATH,
    );
  });

  test("a disabled link explains itself rather than showing a dead URL", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson({ isEnabled: false })));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/This link is disabled/)).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("schedule-personal-calendar-feed-links"),
    ).not.toBeInTheDocument();
  });

  test("an unreadable link says it needs regenerating", async () => {
    getMock.mockResolvedValue(
      ok(activeStatusJson({ needsRegeneration: true, urls: null })),
    );

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/needs to be regenerated before it can be shown here/),
      ).toBeInTheDocument();
    });
  });

  test("a 404 from an older API renders the unsupported note", async () => {
    getMock.mockResolvedValue(fail(404, "Not found"));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-unsupported"),
      ).toBeInTheDocument();
    });
  });
});

describe("User Settings > Calendar Feed page", () => {
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the link card, the upcoming shifts card and the reminders card", async () => {
    getMock.mockImplementation((args: Record<string, unknown>) => {
      const url: string = String(args["url"]);

      if (url.includes("/my-shifts")) {
        return Promise.resolve(
          ok({ shifts: [], truncated: false, generatedAt: NOW.toISOString() }),
        );
      }

      return Promise.resolve(ok(activeStatusJson()));
    });

    render(
      <UserSettingsOnCallCalendarFeed
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("upcoming-shifts-empty")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("shift-reminder-chip-custom"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Subscribe to your on-call shifts"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Upcoming shifts (next 30 days)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Remind me before shifts")).toBeInTheDocument();

    // The reminders card asked for the signed-in user's rows in this project.
    expect(getListMock).toHaveBeenCalledTimes(1);
    const listCall: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = listCall["query"] as Record<
      string,
      unknown
    >;
    expect(String(query["projectId"])).toBe(PROJECT_ID);
    expect(String(query["userId"])).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });
});
