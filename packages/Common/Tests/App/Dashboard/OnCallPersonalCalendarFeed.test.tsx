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
 * (there is no client-side token anywhere), the states a feed can be in
 * (absent / active / disabled / unreadable / unsupported / failing) each look
 * different and offer the right next step, every write goes to the right
 * route or model with the right payload, an older API (404) hides the feature
 * rather than erroring, and the schedule variant narrows the same link with
 * ?schedule= while pointing back to the full page for everything else.
 *
 * And the card's redesign ("Please improve the UI of this card"): subscribing
 * comes first, beside whether the link works; Regenerate, Disable / Enable
 * and Delete moved from three header buttons - one a loud red Delete - into
 * the header's ⋯ (Manage link), Regenerate and Delete still asking first; the
 * server's warnings go above both columns; the Time Log pointer is a quiet
 * footer; and a state that needs attention comes first on a phone.
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
 * assertions here are about WHICH model, id, fields and style the card is
 * wired to, not about ModelDetail itself.
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

      const saved: React.ReactElement = React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "card-model-detail-stub-saved",
          onClick: (): void => {
            props["onSaveSuccess"]?.();
          },
        },
        "Saved",
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
          "data-style": String(props["modelDetailProps"]?.style),
          "data-columns": String(
            props["modelDetailProps"]?.showDetailsInNumberOfColumns,
          ),
        },
        `${props["cardProps"]?.title}|${fieldTitles.join(",")}`,
        saved,
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
import { DetailStyle } from "../../../UI/Components/Detail/Detail";
import {
  formatFeedDay,
  getFeedClock,
} from "../../../UI/Components/Feed/FeedTime";
import {
  FEED_ATTENTION_FIRST_CLASS_NAME,
  FEED_BODY_GRID_CLASS_NAME,
  FEED_STATUS_COLUMN_CLASS_NAME,
  FEED_STATUS_FULL_WIDTH_CLASS_NAME,
  FEED_SUBSCRIBE_COLUMN_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedLayout";
import {
  PERSONAL_FEED_CURRENT_PATH,
  PERSONAL_FEED_ROTATE_PATH,
  PERSONAL_NEEDS_REGENERATION_COPY,
  PLANNING_NOT_AUDIT_COPY,
  REFRESH_CADENCE_COPY,
  buildGoogleAddUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import { FEED_CARD_FOOTER_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedCardFooter";
import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard";
import { SUBSCRIBE_BLOCK_ALONE_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeedLinks";
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

const TOKEN: string = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const HTTPS_URL: string = `https://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`;
/*
 * The subscribe link the page renders: webcal://, built from the https link.
 * The payloads below carry webcals:// - what an API from before the Google
 * Calendar fix sends - so every assertion on WEBCAL_URL also proves the page
 * no longer passes that form (which iOS refuses to open) through.
 */
const WEBCAL_URL: string = HTTPS_URL.replace("https:", "webcal:");
const LEGACY_WEBCALS_URL: string = HTTPS_URL.replace("https:", "webcals:");

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
      webcal: LEGACY_WEBCALS_URL,
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

function renderFull(): ReturnType<typeof render> {
  return render(
    <PersonalCalendarFeedCard
      variant={PersonalCalendarFeedVariant.Full}
      now={NOW}
    />,
  );
}

async function waitForActive(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByTestId("personal-calendar-feed-active"),
    ).toBeInTheDocument();
  });
}

// The card's ⋯, opened: the menu that holds Regenerate, Disable and Delete.
function openManageMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Manage link" }));

  return screen.getByRole("menu");
}

function menuItemLabels(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

// The card that holds the link: the subscribe card, not the settings stub.
function linkCard(): HTMLElement {
  return screen
    .getByText("Subscribe to your on-call shifts")
    .closest("[data-testid='card']") as HTMLElement;
}

describe("PersonalCalendarFeedCard (full variant)", () => {
  beforeEach(() => {
    resetMocks();
    goToCalendarFeedPage();
  });

  afterEach(() => {
    cleanup();
  });

  describe("before a link exists", () => {
    test("reads /feed/current on mount and shows the empty state with a Generate button", async () => {
      getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

      renderFull();

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
      // Nothing to manage yet: no ⋯ menu, no header buttons, no settings card.
      expect(
        screen.queryByRole("button", { name: "Manage link" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("card-button")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("card-model-detail-stub"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("personal-calendar-feed-status"),
      ).not.toBeInTheDocument();
    });

    /*
     * The server sends hostWarning / protocolWarning even when no feed exists.
     * Saying "this link will be unreachable" only AFTER the reader has minted
     * one and pasted it into Google Calendar wastes the one moment the warning
     * is actionable.
     */
    test("the empty state shows the deployment warnings the server attached to it", async () => {
      getMock.mockResolvedValue(
        ok({
          ...EMPTY_STATUS_JSON,
          hostWarning: "HOST is not set, so the link points at localhost.",
          protocolWarning:
            "HTTP_PROTOCOL is http, so the link is not encrypted.",
        }),
      );

      renderFull();

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-empty"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("personal-calendar-feed-host-warning"),
      ).toHaveTextContent("HOST is not set");
      expect(
        screen.getByTestId("personal-calendar-feed-protocol-warning"),
      ).toHaveTextContent("HTTP_PROTOCOL is http");
      // Still offered - the warning informs the click, it does not block it.
      expect(
        screen.getByTestId("personal-calendar-feed-generate"),
      ).toBeInTheDocument();
    });

    test("Generate lines up with the panel's text, not a dialog footer's margin", async () => {
      getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

      renderFull();

      const generate: HTMLElement = await screen.findByTestId(
        "personal-calendar-feed-generate",
      );

      expect(generate.className).toContain("md:!ml-0");
    });

    test("Generate posts to /feed/rotate with an empty JSON body and renders the returned link", async () => {
      getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
      postMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();

      fireEvent.click(
        await screen.findByTestId("personal-calendar-feed-generate"),
      );

      await waitForActive();

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
      expect(
        screen.getByTestId("personal-calendar-feed-webcal"),
      ).toHaveAttribute("href", WEBCAL_URL);
      expect(document.body.textContent).not.toContain(TOKEN);

      // The settings card is wired to the personal feed model and this feed id.
      const settings: HTMLElement = screen.getByTestId(
        "card-model-detail-stub",
      );
      expect(settings).toHaveAttribute("data-model-id", FEED_ID);
      expect(settings).toHaveAttribute(
        "data-model-name",
        new UserOnCallCalendarFeed().tableName,
      );
      expect(settings).toHaveTextContent(
        "Calendar feed settings|Include shifts I cover for others,Days of past shifts,Days ahead",
      );
    });

    test("a failed Generate keeps the empty state and says why in red", async () => {
      getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
      postMock.mockResolvedValue(
        fail(402, "Upgrade to Growth to use calendar feeds"),
      );

      renderFull();

      fireEvent.click(
        await screen.findByTestId("personal-calendar-feed-generate"),
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-error"),
        ).toHaveTextContent("Upgrade to Growth to use calendar feeds");
      });
      expect(
        screen.getByTestId("personal-calendar-feed-error"),
      ).toHaveAttribute("role", "alert");
      expect(
        screen.getByTestId("personal-calendar-feed-empty"),
      ).toBeInTheDocument();
    });
  });

  describe("an active link", () => {
    test("subscribing and the status sit side by side, the status in the narrower column", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      const links: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-links",
      );
      const status: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-status",
      );

      const subscribeColumn: HTMLElement = links.parentElement as HTMLElement;
      const statusColumn: HTMLElement = status.parentElement as HTMLElement;

      expect(subscribeColumn.className).toBe(FEED_SUBSCRIBE_COLUMN_CLASS_NAME);
      expect(statusColumn.className).toBe(FEED_STATUS_COLUMN_CLASS_NAME);
      expect(subscribeColumn.parentElement).toBe(statusColumn.parentElement);
      expect((subscribeColumn.parentElement as HTMLElement).className).toBe(
        FEED_BODY_GRID_CLASS_NAME,
      );

      // Subscribing comes first, in the order a phone stacks them.
      expect(
        subscribeColumn.compareDocumentPosition(statusColumn) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(statusColumn.className).not.toContain(
        FEED_ATTENTION_FIRST_CLASS_NAME,
      );
    });

    test("the status says when and by which app, roughly how often, and which link", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Active");
      expect(
        screen.getByTestId("personal-calendar-feed-status-headline"),
      ).toHaveTextContent("Last fetched 2 hours ago by Google Calendar");
      expect(
        screen.getByTestId("personal-calendar-feed-status-line").textContent,
      ).toBe("~143 fetches · link ending in …k3Qx");
      // A personal link was minted by its reader: no rotation age.
      expect(
        screen.getByTestId("personal-calendar-feed-status-line"),
      ).not.toHaveTextContent("Last rotated");
    });

    test("Google's refresh schedule is said to this reader because Google Calendar reads their link", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      expect(
        screen.getByTestId("personal-calendar-feed-google-refresh-note"),
      ).toHaveTextContent(REFRESH_CADENCE_COPY);
    });

    test("a reader on Apple Calendar is not told about Google's schedule", async () => {
      getMock.mockResolvedValue(
        ok(activeStatusJson({ lastFetchedClient: "Apple Calendar" })),
      );

      renderFull();
      await waitForActive();

      expect(
        screen.queryByTestId("personal-calendar-feed-google-refresh-note"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(REFRESH_CADENCE_COPY)).not.toBeInTheDocument();
    });

    test("the Time Log pointer is the card's quiet footer, linking to the report", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      const timeLog: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-time-log",
      );

      expect(timeLog).toHaveTextContent(PLANNING_NOT_AUDIT_COPY);
      expect(timeLog.className).toBe(FEED_CARD_FOOTER_CLASS_NAME);
      expect(timeLog.className).toContain("text-xs");

      const expectedTimeLogRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route,
      );
      expect(
        within(timeLog).getByText("Open the On-Call Time Log").closest("a"),
      ).toHaveAttribute("href", expectedTimeLogRoute.toString());

      // Last in the card, after both columns.
      const active: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-active",
      );
      expect(active.lastElementChild).toBe(timeLog);
    });

    test("the header holds one action - the ⋯ named Manage link - and no buttons", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      const header: HTMLElement = within(linkCard()).getByTestId(
        "card-header-actions",
      );

      expect(within(header).getAllByRole("button")).toHaveLength(1);
      expect(
        within(header).getByRole("button", { name: "Manage link" }),
      ).toHaveAttribute("aria-haspopup", "menu");
      expect(within(linkCard()).queryByTestId("card-button")).toBeNull();

      for (const name of ["Regenerate link", "Disable", "Delete"]) {
        expect(
          screen.queryByRole("button", { name: name }),
        ).not.toBeInTheDocument();
      }
    });

    test("the menu holds Regenerate link, Disable link and a red Delete link, each with an icon", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      const menu: HTMLElement = openManageMenu();

      expect(menuItemLabels(menu)).toEqual([
        "Regenerate link",
        "Disable link",
        "Delete link",
      ]);

      for (const item of within(menu).getAllByRole("menuitem")) {
        expect(item.querySelector("svg")).not.toBeNull();
      }

      expect(
        within(menu).getByRole("menuitem", { name: "Delete link" }).className,
      ).toContain("text-red-600");
      expect(
        within(menu).getByRole("menuitem", { name: "Regenerate link" })
          .className,
      ).not.toContain("text-red-600");
    });

    test("the settings card draws its three settings compact, side by side", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      const settings: HTMLElement = screen.getByTestId(
        "card-model-detail-stub",
      );

      expect(settings).toHaveAttribute("data-style", DetailStyle.Compact);
      expect(settings).toHaveAttribute("data-columns", "3");
    });

    /*
     * What the server does with the rotated-out token inside its grace window
     * is answer with an EMPTY calendar (spec 2.1), not with the old shifts.
     * The line has to say that: "keeps working until <date>" would tell
     * somebody who rotated because a colleague left that the leaver still sees
     * the roster for a month.
     */
    test("a rotated-out previous link is announced as empty until its expiry, not as still working", async () => {
      getMock.mockResolvedValue(
        ok(
          activeStatusJson({
            previousTokenExpiresAt: "2026-09-30T10:00:00.000Z",
          }),
        ),
      );

      renderFull();

      const line: HTMLElement = await screen.findByTestId(
        "personal-calendar-feed-previous-link",
      );

      expect(line).toHaveTextContent(
        "Your previous link returns an empty calendar until",
      );
      expect(line).toHaveTextContent("then stops working");
      expect(line).not.toHaveTextContent("keeps working");
      // The {{date}} placeholder is filled, in the reader's calendar's words.
      expect(line.textContent).not.toContain("{{");
      expect(line.textContent).toContain(
        formatFeedDay(
          new Date("2026-09-30T10:00:00.000Z"),
          getFeedClock({ language: "en", now: NOW }),
        ),
      );
    });

    test("server warnings sit above both columns, at the card's full width", async () => {
      getMock.mockResolvedValue(
        ok(
          activeStatusJson({
            hostWarning: "Set HOST to your public hostname",
            protocolWarning: "This link will travel unencrypted",
            lastRenderTruncated: true,
          }),
        ),
      );

      renderFull();
      await waitForActive();

      const notices: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-notices",
      );

      expect(
        within(notices).getByTestId("personal-calendar-feed-host-warning"),
      ).toHaveTextContent("Set HOST to your public hostname");
      expect(
        within(notices).getByTestId("personal-calendar-feed-protocol-warning"),
      ).toHaveTextContent("This link will travel unencrypted");
      expect(
        within(notices).getByTestId("personal-calendar-feed-truncated-warning"),
      ).toHaveTextContent("shortened because it would have exceeded the event");

      // Above the subscribe options, and not inside them.
      const links: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-links",
      );
      expect(
        notices.compareDocumentPosition(links) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        within(links).queryByTestId("personal-calendar-feed-host-warning"),
      ).toBeNull();
    });

    test("with nothing to warn about there is no empty notice box", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      expect(
        screen.queryByTestId("personal-calendar-feed-notices"),
      ).not.toBeInTheDocument();
    });
  });

  describe("managing the link", () => {
    test("Regenerate link asks for confirmation, then posts to /feed/rotate and shows the new link's status", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));
      postMock.mockResolvedValue(
        ok(
          activeStatusJson({
            tokenHint: "n3wX",
            lastFetchedAt: null,
            lastFetchedClient: null,
            fetchCount: 0,
            rotatedAt: "2026-08-31T11:59:00.000Z",
            previousTokenExpiresAt: "2026-09-30T11:59:00.000Z",
          }),
        ),
      );

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Regenerate link",
        }),
      );

      const modal: HTMLElement = await screen.findByTestId("modal");
      /*
       * The modal must not promise the old link keeps serving shifts: the
       * server answers it with an empty calendar for the 30-day grace, then
       * 404s.
       */
      const description: HTMLElement = within(modal).getByTestId(
        "confirm-modal-description",
      );
      expect(description).toHaveTextContent(
        "For 30 days the old link keeps answering with that empty calendar instead of an error, then it stops working",
      );
      expect(description).not.toHaveTextContent("keeps working for 30 days");
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
      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Waiting for first sync");
      expect(
        screen.getByTestId("personal-calendar-feed-previous-link"),
      ).toBeInTheDocument();
    });

    test("cancelling Regenerate changes nothing", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Regenerate link",
        }),
      );

      const modal: HTMLElement = await screen.findByTestId("modal");

      fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    test("Disable link updates isEnabled on the personal feed row, re-reads, and the card says it is off", async () => {
      getMock
        .mockResolvedValueOnce(ok(activeStatusJson()))
        .mockResolvedValueOnce(ok(activeStatusJson({ isEnabled: false })));

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Disable link",
        }),
      );

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
      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Disabled");

      /*
       * A disabled feed offers Enable link, in the menu and as the status's
       * next step; the link stays visible so the reader can still copy it
       * for later.
       */
      expect(menuItemLabels(openManageMenu())).toContain("Enable link");
      expect(
        screen.getByTestId("personal-calendar-feed-enable"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    test("a disabled link puts its status first while the columns stack", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson({ isEnabled: false })));

      renderFull();
      await waitForActive();

      const statusColumn: HTMLElement = screen.getByTestId(
        "personal-calendar-feed-status",
      ).parentElement as HTMLElement;

      expect(statusColumn.className).toContain(FEED_ATTENTION_FIRST_CLASS_NAME);
    });

    test("Enable link in the status writes isEnabled=true and re-reads", async () => {
      getMock
        .mockResolvedValueOnce(ok(activeStatusJson({ isEnabled: false })))
        .mockResolvedValueOnce(ok(activeStatusJson()));

      renderFull();

      fireEvent.click(
        await screen.findByTestId("personal-calendar-feed-enable"),
      );

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });
      expect(
        (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
      ).toEqual({ isEnabled: true });

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-status-pill"),
        ).toHaveTextContent("Active");
      });
    });

    /*
     * A re-read after an action keeps the card as it is until the answer
     * arrives. The card used to put its loader in place of everything
     * meanwhile, collapsing to a spinner and back under the reader's
     * pointer - the page jumped by the card's height on every Disable,
     * Enable, Delete and settings save.
     */
    test("Disable link keeps the card in place while it re-reads, then shows the answer", async () => {
      let answerReRead: (value: HTTPResponse<JSONObject>) => void = () => {
        // Replaced below, once the re-read is asked for.
      };

      getMock.mockResolvedValueOnce(ok(activeStatusJson())).mockReturnValueOnce(
        new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            answerReRead = resolve;
          },
        ),
      );

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Disable link",
        }),
      );

      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });

      // Asked, not answered: the card is still the link it was.
      expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-links"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Active");

      answerReRead(ok(activeStatusJson({ isEnabled: false })));

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-status-pill"),
        ).toHaveTextContent("Disabled");
      });
      expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    });

    test("saving the settings re-reads the status without the loader", async () => {
      let answerReRead: (value: HTTPResponse<JSONObject>) => void = () => {
        // Replaced below, once the re-read is asked for.
      };

      getMock.mockResolvedValueOnce(ok(activeStatusJson())).mockReturnValueOnce(
        new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            answerReRead = resolve;
          },
        ),
      );

      renderFull();
      await waitForActive();

      fireEvent.click(screen.getByTestId("card-model-detail-stub-saved"));

      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });
      expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-links"),
      ).toBeInTheDocument();

      answerReRead(ok(activeStatusJson({ lastRenderTruncated: true })));

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-truncated-warning"),
        ).toBeInTheDocument();
      });
    });

    test("Try again after a failed first read shows the loader: there is nothing to keep", async () => {
      let answerReRead: (value: HTTPResponse<JSONObject>) => void = () => {
        // Replaced below, once the re-read is asked for.
      };

      getMock
        .mockResolvedValueOnce(fail(500, "Redis is on fire"))
        .mockReturnValueOnce(
          new Promise<HTTPResponse<JSONObject>>(
            (resolve: (value: HTTPResponse<JSONObject>) => void) => {
              answerReRead = resolve;
            },
          ),
        );

      renderFull();

      const error: HTMLElement = await screen.findByTestId(
        "personal-calendar-feed-load-error",
      );

      fireEvent.click(within(error).getAllByRole("button")[0]!);

      await waitFor(() => {
        expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      });

      answerReRead(ok(activeStatusJson()));

      await waitForActive();
      expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    });

    test("a failed Disable says why above the card's body, and the link stays as it was", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));
      updateByIdMock.mockRejectedValue(
        new Error("You are not allowed to do that"),
      );

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Disable link",
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-error"),
        ).toHaveTextContent("You are not allowed to do that");
      });
      expect(
        within(
          screen.getByTestId("personal-calendar-feed-notices"),
        ).getByTestId("personal-calendar-feed-error"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Active");
    });

    test("while an action runs the menu's items wait", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));
      updateByIdMock.mockReturnValue(
        new Promise<void>(() => {
          // Never settles: the action is still running.
        }),
      );

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Disable link",
        }),
      );

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      const menu: HTMLElement = openManageMenu();

      for (const label of ["Regenerate link", "Disable link", "Delete link"]) {
        const item: HTMLElement = within(menu)
          .getByText(label)
          .closest("button") as HTMLElement;

        expect(item).toHaveAttribute("aria-disabled", "true");
      }
    });

    test("Delete link asks for confirmation, then deletes the row and re-reads to the empty state", async () => {
      getMock
        .mockResolvedValueOnce(ok(activeStatusJson()))
        .mockResolvedValueOnce(ok(EMPTY_STATUS_JSON));

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Delete link",
        }),
      );

      const modal: HTMLElement = await screen.findByTestId("modal");
      expect(
        within(modal).getByText("Delete calendar link?"),
      ).toBeInTheDocument();
      expect(deleteItemMock).not.toHaveBeenCalled();
      /*
       * The button says what it does, as the menu item that opened the
       * dialog does - as Regenerate's says "Regenerate link".
       */
      expect(
        within(modal).queryByRole("button", { name: "Delete" }),
      ).not.toBeInTheDocument();

      fireEvent.click(
        within(modal).getByRole("button", { name: "Delete link" }),
      );

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
      expect(
        screen.queryByRole("button", { name: "Manage link" }),
      ).not.toBeInTheDocument();
    });

    test("a failed Delete says why in the dialog, once, and keeps the dialog open", async () => {
      getMock.mockResolvedValue(ok(activeStatusJson()));
      deleteItemMock.mockRejectedValue(new Error("Database is away"));

      renderFull();
      await waitForActive();

      fireEvent.click(
        within(openManageMenu()).getByRole("menuitem", {
          name: "Delete link",
        }),
      );

      const modal: HTMLElement = await screen.findByTestId("modal");

      fireEvent.click(
        within(modal).getByRole("button", { name: "Delete link" }),
      );

      await waitFor(() => {
        expect(within(modal).getByText("Database is away")).toBeInTheDocument();
      });
      // Said in the dialog, not a second time behind it.
      expect(screen.getAllByText("Database is away")).toHaveLength(1);
      expect(
        screen.queryByTestId("personal-calendar-feed-error"),
      ).not.toBeInTheDocument();
    });
  });

  describe("a link that cannot be read", () => {
    test("says why, offers Regenerate link in the status, and shows no link", async () => {
      getMock.mockResolvedValue(
        ok(activeStatusJson({ needsRegeneration: true, urls: null })),
      );

      renderFull();

      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-needs-regeneration"),
        ).toHaveTextContent(PERSONAL_NEEDS_REGENERATION_COPY);
      });

      expect(
        screen.queryByTestId("personal-calendar-feed-links"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("personal-calendar-feed-status-pill"),
      ).toHaveTextContent("Needs regeneration");

      // The status takes the whole row: there is nothing to subscribe with.
      expect(
        screen.getByTestId("personal-calendar-feed-status").parentElement!
          .className,
      ).toContain(FEED_STATUS_FULL_WIDTH_CLASS_NAME);
    });

    test("Regenerate link there still asks before it acts", async () => {
      getMock.mockResolvedValue(
        ok(activeStatusJson({ needsRegeneration: true, urls: null })),
      );
      postMock.mockResolvedValue(ok(activeStatusJson()));

      renderFull();

      fireEvent.click(
        await screen.findByTestId("personal-calendar-feed-regenerate-now"),
      );

      const modal: HTMLElement = await screen.findByTestId("modal");
      expect(postMock).not.toHaveBeenCalled();

      fireEvent.click(
        within(modal).getByRole("button", { name: "Regenerate link" }),
      );

      await waitFor(() => {
        expect(postMock).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("personal-calendar-feed-links"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when the status cannot be read", () => {
    test("a 404 from an older API hides the feature instead of erroring", async () => {
      getMock.mockResolvedValue(fail(404, "Not found"));

      renderFull();

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

    test("any other failure says what failed, the server's reason, and offers Try again", async () => {
      getMock
        .mockResolvedValueOnce(fail(500, "Redis is on fire"))
        .mockResolvedValueOnce(ok(activeStatusJson()));

      renderFull();

      const error: HTMLElement = await screen.findByTestId(
        "personal-calendar-feed-load-error",
      );

      expect(error).toHaveTextContent("Could not load your calendar link.");
      expect(error).toHaveTextContent("Redis is on fire");
      expect(error).toHaveTextContent("Try again");

      fireEvent.click(within(error).getAllByRole("button")[0]!);

      await waitForActive();
      expect(getMock).toHaveBeenCalledTimes(2);
    });
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

  function renderSchedule(): ReturnType<typeof render> {
    return render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Schedule}
        scheduleId={SCHEDULE_ID}
        now={NOW}
      />,
    );
  }

  test("narrows the personal link to the schedule and points at the full page", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson()));

    renderSchedule();

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

    const expectedRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
    );
    expect(
      screen.getByText("Manage your calendar link and reminders").closest("a"),
    ).toHaveAttribute("href", expectedRoute.toString());

    // No manage menu, status panel or settings card in the narrow variant.
    expect(
      screen.queryByRole("button", { name: "Manage link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("schedule-personal-calendar-feed-status"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-model-detail-stub"),
    ).not.toBeInTheDocument();
  });

  test("its subscribe block has the row to itself, so it keeps a reading width", async () => {
    getMock.mockResolvedValue(ok(activeStatusJson()));

    renderSchedule();

    const links: HTMLElement = await screen.findByTestId(
      "schedule-personal-calendar-feed-links",
    );

    expect(links.className).toContain(SUBSCRIBE_BLOCK_ALONE_CLASS_NAME);
  });

  /*
   * A truncated render is a property of the feed, not of the page it is shown
   * on: the same link is short on the schedule page and on the settings page.
   */
  test("the narrow variant carries the truncation warning, like the full one", async () => {
    getMock.mockResolvedValue(
      ok(activeStatusJson({ lastRenderTruncated: true })),
    );

    renderSchedule();

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-links"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-personal-calendar-feed-truncated-warning"),
    ).toHaveTextContent("shortened because it would have exceeded the event");
  });

  test("offers Generate when no link exists and posts to /feed/rotate", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));
    postMock.mockResolvedValue(ok(activeStatusJson()));

    renderSchedule();

    fireEvent.click(
      await screen.findByTestId("schedule-personal-calendar-feed-generate"),
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

    renderSchedule();

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-disabled"),
      ).toHaveTextContent("This link is disabled");
    });
    expect(
      screen.queryByTestId("schedule-personal-calendar-feed-links"),
    ).not.toBeInTheDocument();
  });

  test("an unreadable link says it needs regenerating", async () => {
    getMock.mockResolvedValue(
      ok(activeStatusJson({ needsRegeneration: true, urls: null })),
    );

    renderSchedule();

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "schedule-personal-calendar-feed-needs-regeneration",
        ),
      ).toHaveTextContent(
        "needs to be regenerated before it can be shown here",
      );
    });
  });

  test("a 404 from an older API renders the unsupported note", async () => {
    getMock.mockResolvedValue(fail(404, "Not found"));

    renderSchedule();

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-personal-calendar-feed-unsupported"),
      ).toBeInTheDocument();
    });
  });

  test("a failure says what failed and offers Try again", async () => {
    getMock.mockResolvedValue(fail(500, "Redis is on fire"));

    renderSchedule();

    const error: HTMLElement = await screen.findByTestId(
      "schedule-personal-calendar-feed-load-error",
    );

    expect(error).toHaveTextContent("Redis is on fire");
    expect(error).toHaveTextContent("Try again");
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
      screen.getByText("Upcoming shifts"),
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
