import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * Issue #4106: group chats were listed by their members' names instead of
 * their Teams names.
 *
 * On the card, that means: opening the page reads what is stored (GET), and
 * Refresh Chats asks the server to re-read every group chat's name from
 * Microsoft (POST /microsoft-teams/chats/refresh) and shows the result. The
 * server also says which chats' names it could not read, split by why:
 *
 *   - chatNamePermissionDeniedChatIds: Microsoft refused, because the app in
 *     that chat has not been granted the permission to share its name. That
 *     takes action from an admin, so those rows are marked and an amber notice
 *     says what to do - which differs between self-hosted and SaaS.
 *   - chatNameFailedChatIds: the read failed for some other reason. Nothing to
 *     fix, so those rows are marked and a gray notice says to try again.
 *
 * Both lists only mean anything right after a refresh, so the first load
 * never shows them. And because the list (with its notices) is swapped for a
 * loader during every refresh, the outcome is announced to screen readers
 * through a live region that stays mounted the whole time.
 *
 * Only the network edge is mocked: API.get and API.post answer from per-test
 * responders, which may resolve an HTTPErrorResponse exactly as the real
 * client does for a 4xx/5xx. Card, Button, the loader and the Send Test
 * button are the production components.
 */

let billingEnabled: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  /*
   * Object.defineProperty, not a getter in an object literal: this file is
   * down-levelled, so `{ ...actual, get X() {} }` becomes Object.assign, which
   * would read the getter once and freeze the value at module-load time.
   */
  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  Object.defineProperty(mockedConfig, "MicrosoftTeamsAppClientId", {
    get: (): string => {
      return "9f6a2c31-self-hosted-registration";
    },
  });

  return mockedConfig;
});

interface ApiRequestOptions {
  url: { toString: () => string };
}

interface RecordedCall {
  method: "get" | "post";
  route: string;
}

/*
 * The real client resolves (it does not reject) with an HTTPErrorResponse
 * when the server answers with an error status, so a responder may too.
 */
type ApiResult = { data: JSONObject } | HTTPErrorResponse;
type Responder = () => Promise<ApiResult>;

let calls: Array<RecordedCall> = [];
let getResponder: Responder;
let postResponder: Responder;

function routeOf(options: ApiRequestOptions): string {
  // Compared without the API base path, which differs between environments.
  return new window.URL(options.url.toString()).pathname.replace(/^\/api/, "");
}

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (options: ApiRequestOptions): Promise<ApiResult> => {
        calls.push({ method: "get", route: routeOf(options) });
        return getResponder();
      },
      post: (options: ApiRequestOptions): Promise<ApiResult> => {
        calls.push({ method: "post", route: routeOf(options) });
        return postResponder();
      },
      getFriendlyErrorMessage: (err: unknown): string => {
        /*
         * Error and HTTPErrorResponse both expose `message`; surface it so a
         * test can see its own error text reach the card.
         */
        if (
          err &&
          typeof err === "object" &&
          typeof (err as { message?: unknown }).message === "string" &&
          (err as { message: string }).message
        ) {
          return (err as { message: string }).message;
        }

        return "Something went wrong.";
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
    },
  };
});

import MicrosoftTeamsChatsCard from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard";

const GROUP_CHAT_ID: string = "19:group@thread.v2";
const PERSONAL_CHAT_ID: string = "a:personal";

// What the issue's screenshot showed in place of the chat's Teams name.
const MEMBER_NAME: string =
  "Bibishek G S Steephensen [Contractor], Karthik Kallam [Contractor], Robin Examp…";
const TEAMS_NAME: string = "Platform On-Call";

const REFRESH_ROUTE: string = "/microsoft-teams/chats/refresh";

const DENIED_MARKER: string = "Microsoft Teams did not share this chat's name";
const FAILED_MARKER: string = "This chat's name could not be read just now";

/*
 * Anchored on words only the notices carry. The live region repeats the
 * start of the permission sentence ("Microsoft Teams did not share the name
 * of ..."), so matching on that would find two elements.
 */
const PERMISSION_NOTICE_TEXT: RegExp = /listed by member names/;
const FAILED_NOTICE_TEXT: RegExp = /OneUptime could not read the name of/;

function groupChat(id: string, name: string): JSONObject {
  return { id: id, name: name, chatType: "groupChat", addedAt: null };
}

function personalChat(id: string, name: string): JSONObject {
  return { id: id, name: name, chatType: "personal", addedAt: null };
}

const STORED_CHATS: Array<JSONObject> = [
  groupChat(GROUP_CHAT_ID, MEMBER_NAME),
  personalChat(PERSONAL_CHAT_ID, "Jane Doe"),
];

// Sorted by name, as the server sends them.
const REFRESHED_CHATS: Array<JSONObject> = [
  personalChat(PERSONAL_CHAT_ID, "Jane Doe"),
  groupChat(GROUP_CHAT_ID, TEAMS_NAME),
];

/*
 * One row per outcome of a name read: refused, failed, read, and a 1:1 chat
 * (whose name is never read from Microsoft at all).
 */
const DENIED_CHAT_ID: string = "19:denied@thread.v2";
const FAILED_CHAT_ID: string = "19:failed@thread.v2";
const DENIED_CHAT_NAME: string =
  "Alice Example, Bob Example, Carol Example + 2 more";
const FAILED_CHAT_NAME: string = "Release Train";

const MIXED_CHATS: Array<JSONObject> = [
  groupChat(DENIED_CHAT_ID, DENIED_CHAT_NAME),
  personalChat(PERSONAL_CHAT_ID, "Jane Doe"),
  groupChat(GROUP_CHAT_ID, TEAMS_NAME),
  groupChat(FAILED_CHAT_ID, FAILED_CHAT_NAME),
];

// Three more group chats, for the plural wording.
const EXTRA_GROUP_CHATS: Array<JSONObject> = [
  groupChat("19:second@thread.v2", "Dave Example, Erin Example"),
  groupChat("19:third@thread.v2", "Frank Example, Grace Example"),
  groupChat("19:fourth@thread.v2", "Heidi Example, Ivan Example"),
];

function respond(data: JSONObject): Responder {
  return async (): Promise<ApiResult> => {
    return { data: data };
  };
}

function refreshResponse(options: {
  chats?: Array<JSONObject>;
  permissionDeniedChatIds?: Array<string>;
  failedChatIds?: Array<string>;
}): Responder {
  const permissionDeniedChatIds: Array<string> =
    options.permissionDeniedChatIds || [];
  const failedChatIds: Array<string> = options.failedChatIds || [];

  // The shape POST /microsoft-teams/chats/refresh answers with.
  return respond({
    chats: options.chats || REFRESHED_CHATS,
    chatNamePermissionDeniedChatIds: permissionDeniedChatIds,
    chatNamePermissionDeniedCount: permissionDeniedChatIds.length,
    chatNameFailedChatIds: failedChatIds,
    chatNameFailedCount: failedChatIds.length,
  });
}

interface Deferred {
  promise: Promise<ApiResult>;
  resolve: (value: ApiResult) => void;
}

function createDeferred(): Deferred {
  const deferred: Partial<Deferred> = {};

  deferred.promise = new Promise<ApiResult>(
    (resolve: (value: ApiResult) => void): void => {
      deferred.resolve = resolve;
    },
  );

  return deferred as Deferred;
}

async function waitForLoaderToGo(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
}

async function renderCard(): Promise<void> {
  // The card fetches /microsoft-teams/chats on mount; settle that inside act.
  await act(async (): Promise<void> => {
    render(<MicrosoftTeamsChatsCard />);
  });

  await waitForLoaderToGo();
}

async function clickRefresh(): Promise<void> {
  const postsBefore: number = calls.filter((call: RecordedCall) => {
    return call.method === "post";
  }).length;

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Refresh Chats" }));
  });

  await waitForLoaderToGo();

  /*
   * Without this a click that did nothing (say, on a disabled button) would
   * leave the previous state on screen for the assertions that follow.
   */
  expect(
    calls.filter((call: RecordedCall) => {
      return call.method === "post";
    }).length,
  ).toBe(postsBefore + 1);
}

function getRows(): Array<HTMLElement> {
  return within(screen.getByRole("list")).getAllByRole("listitem");
}

function getRow(name: string): HTMLElement {
  const row: HTMLElement | null = screen.getByText(name).closest("li");

  if (!row) {
    throw new Error(`"${name}" is not inside a chat row.`);
  }

  return row;
}

function permissionNotice(): HTMLElement | null {
  return screen.queryByText(PERMISSION_NOTICE_TEXT);
}

function failedNotice(): HTMLElement | null {
  return screen.queryByText(FAILED_NOTICE_TEXT);
}

function getPermissionNotice(): HTMLElement {
  const element: HTMLElement | null = permissionNotice();
  expect(element).toBeInTheDocument();
  return element!;
}

function getFailedNotice(): HTMLElement {
  const element: HTMLElement | null = failedNotice();
  expect(element).toBeInTheDocument();
  return element!;
}

/*
 * The card's own live regions. Every Send Test button carries a
 * role="status" of its own (inside its row), and so does the loader (labelled
 * "Loading"); neither is the card's refresh summary.
 */
function cardLiveRegions(): Array<HTMLElement> {
  return screen
    .getAllByRole("status")
    .filter((element: HTMLElement): boolean => {
      return (
        element.closest("li") === null &&
        element.getAttribute("aria-label") !== "Loading"
      );
    });
}

function getLiveRegion(): HTMLElement {
  const regions: Array<HTMLElement> = cardLiveRegions();
  expect(regions).toHaveLength(1);
  return regions[0]!;
}

beforeEach(() => {
  billingEnabled = false;
  calls = [];
  getResponder = respond({ chats: STORED_CHATS });
  postResponder = refreshResponse({});
});

describe("MicrosoftTeamsChatsCard — Refresh Chats re-reads group chat names", () => {
  test("opening the page only reads stored chats (GET), it does not refresh names", async () => {
    await renderCard();

    expect(calls).toEqual([{ method: "get", route: "/microsoft-teams/chats" }]);
  });

  test("Refresh Chats posts to /microsoft-teams/chats/refresh", async () => {
    await renderCard();
    calls = [];

    await clickRefresh();

    expect(calls).toEqual([{ method: "post", route: REFRESH_ROUTE }]);
  });

  test("the issue: after Refresh Chats the group chat shows its Teams name, still tagged 'Group chat'", async () => {
    await renderCard();
    expect(screen.getByText(MEMBER_NAME)).toBeInTheDocument();

    await clickRefresh();

    expect(screen.queryByText(MEMBER_NAME)).not.toBeInTheDocument();
    const row: HTMLElement = getRow(TEAMS_NAME);
    expect(within(row).getByText("Group chat")).toBeInTheDocument();
    expect(within(row).queryByText("1:1 chat")).not.toBeInTheDocument();
  });

  test("1:1 chats keep the other person's name and the '1:1 chat' tag", async () => {
    await renderCard();
    await clickRefresh();

    const row: HTMLElement = getRow("Jane Doe");
    expect(within(row).getByText("1:1 chat")).toBeInTheDocument();
    expect(within(row).queryByText("Group chat")).not.toBeInTheDocument();
  });

  test("rows keep the order the server sends, without re-sorting them", async () => {
    /*
     * Deliberately neither alphabetical nor grouped by chat type, so a card
     * that sorted by name or put group chats first would show a different
     * order than the one sent.
     */
    postResponder = refreshResponse({
      chats: [
        groupChat("19:zeta@thread.v2", "Zeta War Room"),
        personalChat(PERSONAL_CHAT_ID, "Jane Doe"),
        groupChat("19:alpha@thread.v2", "Alpha Ops"),
      ],
    });

    await renderCard();
    await clickRefresh();

    const rows: Array<HTMLElement> = getRows();
    const namesSent: Array<string> = ["Zeta War Room", "Jane Doe", "Alpha Ops"];
    expect(rows).toHaveLength(namesSent.length);
    namesSent.forEach((name: string, index: number) => {
      expect(within(rows[index]!).getByText(name)).toBeInTheDocument();
    });
  });

  test("Send Test is labelled with the refreshed name", async () => {
    await renderCard();
    await clickRefresh();

    const row: HTMLElement = getRow(TEAMS_NAME);
    expect(
      within(row).getByRole("button", {
        name: `Send test notification to ${TEAMS_NAME}`,
      }),
    ).toBeInTheDocument();
    // The member-name label went with the member name.
    expect(
      screen.queryByRole("button", {
        name: `Send test notification to ${MEMBER_NAME}`,
      }),
    ).not.toBeInTheDocument();
  });

  test("the chat name carries its full text as a tooltip, since a long name is truncated", async () => {
    const longName: string =
      "Payments Platform — Production Incident Bridge (EMEA and APAC follow-the-sun)";
    postResponder = refreshResponse({
      chats: [groupChat(GROUP_CHAT_ID, longName)],
    });

    await renderCard();
    await clickRefresh();

    const nameElement: HTMLElement = screen.getByText(longName);
    expect(nameElement).toHaveAttribute("title", longName);
    expect(nameElement).toHaveClass("truncate");
  });

  test("Refresh can be clicked again and each click refreshes again", async () => {
    await renderCard();
    calls = [];

    await clickRefresh();
    await clickRefresh();

    expect(calls).toEqual([
      { method: "post", route: REFRESH_ROUTE },
      { method: "post", route: REFRESH_ROUTE },
    ]);
  });
});

describe("MicrosoftTeamsChatsCard — a refresh that fails", () => {
  const MESSAGE: string =
    "Microsoft Teams is not connected for this project. Connect it again.";

  test.each([
    [
      "rejects",
      async (): Promise<ApiResult> => {
        throw new Error(MESSAGE);
      },
    ],
    [
      "resolves an HTTPErrorResponse, as the client does for a 400",
      async (): Promise<ApiResult> => {
        return new HTTPErrorResponse(400, { message: MESSAGE }, {});
      },
    ],
  ])(
    "shows the error when the request %s, and says so to screen readers",
    async (_label: string, failingResponder: Responder) => {
      await renderCard();
      postResponder = failingResponder;

      await clickRefresh();

      expect(screen.getByText(MESSAGE)).toBeInTheDocument();
      // The error takes the list's place.
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByText(MEMBER_NAME)).not.toBeInTheDocument();
      expect(getLiveRegion().textContent).toBe(
        `Chat names could not be refreshed. ${MESSAGE}`,
      );
    },
  );

  test("the next Refresh Chats brings the list back", async () => {
    await renderCard();
    postResponder = async (): Promise<ApiResult> => {
      return new HTTPErrorResponse(503, { message: MESSAGE }, {});
    };
    await clickRefresh();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();

    postResponder = refreshResponse({});
    await clickRefresh();

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    expect(getRow(TEAMS_NAME)).toBeInTheDocument();
    expect(getLiveRegion().textContent).toBe("Chat names refreshed.");
  });
});

describe("MicrosoftTeamsChatsCard — rows whose name could not be read are marked", () => {
  test("each marker sits on its own row only", async () => {
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      permissionDeniedChatIds: [DENIED_CHAT_ID],
      failedChatIds: [FAILED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    const deniedRow: HTMLElement = getRow(DENIED_CHAT_NAME);
    expect(within(deniedRow).getByText(DENIED_MARKER)).toBeInTheDocument();
    expect(
      within(deniedRow).queryByText(FAILED_MARKER),
    ).not.toBeInTheDocument();

    const failedRow: HTMLElement = getRow(FAILED_CHAT_NAME);
    expect(within(failedRow).getByText(FAILED_MARKER)).toBeInTheDocument();
    expect(
      within(failedRow).queryByText(DENIED_MARKER),
    ).not.toBeInTheDocument();

    for (const name of [TEAMS_NAME, "Jane Doe"]) {
      const row: HTMLElement = getRow(name);
      expect(within(row).queryByText(DENIED_MARKER)).not.toBeInTheDocument();
      expect(within(row).queryByText(FAILED_MARKER)).not.toBeInTheDocument();
    }

    expect(screen.getAllByText(DENIED_MARKER)).toHaveLength(1);
    expect(screen.getAllByText(FAILED_MARKER)).toHaveLength(1);
  });

  test("an id that matches no row marks nothing", async () => {
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      permissionDeniedChatIds: [DENIED_CHAT_ID, "19:removed@thread.v2"],
      failedChatIds: ["19:also-removed@thread.v2"],
    });

    await renderCard();
    await clickRefresh();

    expect(screen.getAllByText(DENIED_MARKER)).toHaveLength(1);
    expect(
      within(getRow(DENIED_CHAT_NAME)).getByText(DENIED_MARKER),
    ).toBeInTheDocument();
    expect(screen.queryByText(FAILED_MARKER)).not.toBeInTheDocument();
  });

  test.each([
    ["a string", GROUP_CHAT_ID],
    ["an object", { [GROUP_CHAT_ID]: true }],
    ["a number", 1],
    ["null", null],
  ])(
    "id lists that arrive as %s are ignored",
    async (_label: string, payload: JSONObject[string]) => {
      postResponder = respond({
        chats: REFRESHED_CHATS,
        chatNamePermissionDeniedChatIds: payload,
        chatNamePermissionDeniedCount: 1,
        chatNameFailedChatIds: payload,
        chatNameFailedCount: 1,
      });

      await renderCard();
      await clickRefresh();

      expect(getRow(TEAMS_NAME)).toBeInTheDocument();
      expect(screen.queryByText(DENIED_MARKER)).not.toBeInTheDocument();
      expect(screen.queryByText(FAILED_MARKER)).not.toBeInTheDocument();
      expect(permissionNotice()).not.toBeInTheDocument();
      expect(failedNotice()).not.toBeInTheDocument();
      // The counts are not what the card goes by; the ids are.
      expect(getLiveRegion().textContent).toBe("Chat names refreshed.");
    },
  );

  test("entries that are not chat ids are skipped, and not counted", async () => {
    postResponder = respond({
      chats: REFRESHED_CHATS,
      chatNamePermissionDeniedChatIds: [
        42,
        null,
        { id: PERSONAL_CHAT_ID },
        "",
        GROUP_CHAT_ID,
      ],
      chatNamePermissionDeniedCount: 5,
    });

    await renderCard();
    await clickRefresh();

    expect(
      within(getRow(TEAMS_NAME)).getByText(DENIED_MARKER),
    ).toBeInTheDocument();
    expect(screen.getAllByText(DENIED_MARKER)).toHaveLength(1);
    // One real id, so one chat - not the five entries sent.
    expect(getPermissionNotice()).toHaveTextContent(
      "did not share the name of 1 group chat, so it is listed by member names",
    );
  });
});

describe("MicrosoftTeamsChatsCard — when Microsoft will not share chat names", () => {
  test("no permission notice when every name was read", async () => {
    await renderCard();
    await clickRefresh();

    expect(permissionNotice()).not.toBeInTheDocument();
    expect(failedNotice()).not.toBeInTheDocument();
  });

  test("self-hosted, one chat: singular wording, re-upload the manifest, or grant the Graph permission", async () => {
    billingEnabled = false;
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      permissionDeniedChatIds: [DENIED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    const notice: HTMLElement = getPermissionNotice();
    expect(notice).toHaveTextContent(
      "Microsoft Teams did not share the name of 1 group chat, so it is listed by member names (marked above).",
    );
    expect(notice).toHaveTextContent(
      "once the OneUptime app in that chat asks for the ChatSettings.Read.Chat permission",
    );
    expect(notice).toHaveTextContent(
      "Click Download App Manifest Zip on this page, upload the zip to Microsoft Teams as an update of the OneUptime app, accept the update in that chat, then click Refresh Chats.",
    );
    expect(notice).toHaveTextContent(
      "Or grant your app registration the Chat.ReadBasic.WhereInstalled application permission (with admin consent)",
    );
    expect(notice).not.toHaveTextContent("they are");
    expect(notice).not.toHaveTextContent("those chats");
    // That button only exists on SaaS.
    expect(notice).not.toHaveTextContent(
      "Download App Manifest for Sideloading",
    );
  });

  test("self-hosted, several chats: plural wording with the count", async () => {
    billingEnabled = false;
    postResponder = refreshResponse({
      chats: [...MIXED_CHATS, ...EXTRA_GROUP_CHATS],
      permissionDeniedChatIds: [
        DENIED_CHAT_ID,
        "19:second@thread.v2",
        "19:third@thread.v2",
      ],
    });

    await renderCard();
    await clickRefresh();

    const notice: HTMLElement = getPermissionNotice();
    expect(notice).toHaveTextContent(
      "Microsoft Teams did not share the name of 3 group chats, so they are listed by member names (marked above).",
    );
    expect(notice).toHaveTextContent(
      "accept the update in those chats, then click Refresh Chats.",
    );
    expect(notice).not.toHaveTextContent("it is listed");
    expect(notice).not.toHaveTextContent("that chat,");
  });

  test("SaaS, one chat: accept the update Teams offers; no application permission to grant", async () => {
    billingEnabled = true;
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      permissionDeniedChatIds: [DENIED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    const notice: HTMLElement = getPermissionNotice();
    expect(notice).toHaveTextContent(
      "Microsoft Teams did not share the name of 1 group chat, so it is listed by member names (marked above).",
    );
    expect(notice).toHaveTextContent("ChatSettings.Read.Chat");
    expect(notice).toHaveTextContent(
      "When Teams offers an update for the OneUptime app in that chat, accept it, then click Refresh Chats.",
    );
    expect(notice).toHaveTextContent(
      "If you sideloaded the app, first download its manifest again (Download App Manifest for Sideloading",
    );
    /*
     * A SaaS customer does not own the app registration, so there is no
     * application permission for them to grant, and no zip button either.
     */
    expect(notice).not.toHaveTextContent("Chat.ReadBasic.WhereInstalled");
    expect(notice).not.toHaveTextContent("Download App Manifest Zip");
  });

  test("SaaS, several chats: plural wording with the count", async () => {
    billingEnabled = true;
    postResponder = refreshResponse({
      chats: [...MIXED_CHATS, ...EXTRA_GROUP_CHATS],
      permissionDeniedChatIds: [
        DENIED_CHAT_ID,
        "19:second@thread.v2",
        "19:third@thread.v2",
        "19:fourth@thread.v2",
      ],
    });

    await renderCard();
    await clickRefresh();

    const notice: HTMLElement = getPermissionNotice();
    expect(notice).toHaveTextContent(
      "did not share the name of 4 group chats, so they are listed by member names",
    );
    expect(notice).toHaveTextContent(
      "When Teams offers an update for the OneUptime app in those chats, accept it",
    );
    expect(notice).not.toHaveTextContent("that chat,");
  });

  test("the notice is not a live region itself; the card's summary announces it", async () => {
    /*
     * The notice arrives already filled (it mounts with the list after the
     * loader), which screen readers tend to skip, and a second live region
     * would read the same news twice.
     */
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      permissionDeniedChatIds: [DENIED_CHAT_ID],
      failedChatIds: [FAILED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    expect(getPermissionNotice()).not.toHaveAttribute("role");
    expect(getPermissionNotice()).not.toHaveAttribute("aria-live");
    expect(getFailedNotice()).not.toHaveAttribute("role");
    expect(getFailedNotice()).not.toHaveAttribute("aria-live");
  });
});

describe("MicrosoftTeamsChatsCard — when a chat name could not be read for another reason", () => {
  test("one chat: singular wording, keeps its current name, try again later", async () => {
    postResponder = refreshResponse({
      chats: MIXED_CHATS,
      failedChatIds: [FAILED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    expect(getFailedNotice()).toHaveTextContent(
      "OneUptime could not read the name of 1 group chat from Microsoft Teams just now, so it keeps its current name (marked above). Click Refresh Chats again in a few minutes.",
    );
    // Nothing for an admin to fix, so no permission advice.
    expect(permissionNotice()).not.toBeInTheDocument();
  });

  test("several chats: plural wording with the count", async () => {
    postResponder = refreshResponse({
      chats: [...MIXED_CHATS, ...EXTRA_GROUP_CHATS],
      failedChatIds: [FAILED_CHAT_ID, "19:second@thread.v2"],
    });

    await renderCard();
    await clickRefresh();

    const notice: HTMLElement = getFailedNotice();
    expect(notice).toHaveTextContent(
      "OneUptime could not read the name of 2 group chats from Microsoft Teams just now, so they keep their current name (marked above).",
    );
    expect(notice).not.toHaveTextContent("it keeps its");
  });

  test("shown alongside the permission notice when both happened", async () => {
    postResponder = refreshResponse({
      chats: [...MIXED_CHATS, ...EXTRA_GROUP_CHATS],
      permissionDeniedChatIds: [DENIED_CHAT_ID, "19:second@thread.v2"],
      failedChatIds: [FAILED_CHAT_ID],
    });

    await renderCard();
    await clickRefresh();

    expect(getPermissionNotice()).toHaveTextContent(
      "did not share the name of 2 group chats",
    );
    expect(getFailedNotice()).toHaveTextContent(
      "could not read the name of 1 group chat from",
    );
  });
});

describe("MicrosoftTeamsChatsCard — when the notices and markers go away", () => {
  const TROUBLED_REFRESH: Responder = refreshResponse({
    chats: MIXED_CHATS,
    permissionDeniedChatIds: [DENIED_CHAT_ID],
    failedChatIds: [FAILED_CHAT_ID],
  });

  test("a later refresh that reads every name clears them", async () => {
    postResponder = TROUBLED_REFRESH;

    await renderCard();
    await clickRefresh();
    expect(permissionNotice()).toBeInTheDocument();
    expect(failedNotice()).toBeInTheDocument();

    postResponder = refreshResponse({ chats: MIXED_CHATS });
    await clickRefresh();

    // Same rows as before, so only the refresh's outcome could remove these.
    expect(getRow(DENIED_CHAT_NAME)).toBeInTheDocument();
    expect(getRow(FAILED_CHAT_NAME)).toBeInTheDocument();
    expect(permissionNotice()).not.toBeInTheDocument();
    expect(failedNotice()).not.toBeInTheDocument();
    expect(screen.queryByText(DENIED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(FAILED_MARKER)).not.toBeInTheDocument();
  });

  test("a failed refresh clears them", async () => {
    postResponder = TROUBLED_REFRESH;

    await renderCard();
    await clickRefresh();
    expect(permissionNotice()).toBeInTheDocument();

    postResponder = async (): Promise<ApiResult> => {
      return new HTTPErrorResponse(500, { message: "Graph is down." }, {});
    };
    await clickRefresh();

    expect(screen.getByText("Graph is down.")).toBeInTheDocument();
    expect(permissionNotice()).not.toBeInTheDocument();
    expect(failedNotice()).not.toBeInTheDocument();
    expect(screen.queryByText(DENIED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(FAILED_MARKER)).not.toBeInTheDocument();
    // Nor does the summary still report the earlier refresh's counts.
    expect(getLiveRegion().textContent).toBe(
      "Chat names could not be refreshed. Graph is down.",
    );
  });

  test("the first load never shows them, even if its payload carried ids", async () => {
    /*
     * The GET only reads what is stored; it asked Microsoft nothing, so there
     * is no outcome to report.
     */
    getResponder = respond({
      chats: MIXED_CHATS,
      chatNamePermissionDeniedChatIds: [DENIED_CHAT_ID],
      chatNamePermissionDeniedCount: 1,
      chatNameFailedChatIds: [FAILED_CHAT_ID],
      chatNameFailedCount: 1,
    });

    await renderCard();

    expect(getRow(DENIED_CHAT_NAME)).toBeInTheDocument();
    expect(permissionNotice()).not.toBeInTheDocument();
    expect(failedNotice()).not.toBeInTheDocument();
    expect(screen.queryByText(DENIED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(FAILED_MARKER)).not.toBeInTheDocument();
    expect(getLiveRegion().textContent).toBe("");
  });
});

describe("MicrosoftTeamsChatsCard — what a screen reader hears after Refresh Chats", () => {
  test("the card has exactly one polite status region, visually hidden and empty after the first load", async () => {
    await renderCard();

    const region: HTMLElement = getLiveRegion();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
    expect(region.textContent).toBe("");
  });

  test("the region stays mounted through a refresh: emptied while loading, then filled with the outcome", async () => {
    await renderCard();
    await clickRefresh();

    const region: HTMLElement = getLiveRegion();
    expect(region.textContent).toBe("Chat names refreshed.");

    const pending: Deferred = createDeferred();
    postResponder = (): Promise<ApiResult> => {
      return pending.promise;
    };

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh Chats" }));
    });

    // Loading: the list has been swapped for the loader...
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    /*
     * ...but the region is the same node, and it has been emptied so the
     * same sentence arriving again is still a change a reader announces.
     */
    expect(getLiveRegion()).toBe(region);
    expect(region.textContent).toBe("");

    await act(async (): Promise<void> => {
      pending.resolve({
        data: {
          chats: REFRESHED_CHATS,
          chatNamePermissionDeniedChatIds: [GROUP_CHAT_ID],
          chatNamePermissionDeniedCount: 1,
          chatNameFailedChatIds: [],
          chatNameFailedCount: 0,
        },
      });
    });
    await waitForLoaderToGo();

    expect(region.isConnected).toBe(true);
    expect(getLiveRegion()).toBe(region);
    expect(region.textContent).toBe(
      "Chat names refreshed. Microsoft Teams did not share the name of 1 group chat.",
    );
  });

  test.each([
    ["every name was read", [], [], "Chat names refreshed."],
    [
      "one name was refused",
      [DENIED_CHAT_ID],
      [],
      "Chat names refreshed. Microsoft Teams did not share the name of 1 group chat.",
    ],
    [
      "two names failed",
      [],
      [FAILED_CHAT_ID, "19:second@thread.v2"],
      "Chat names refreshed. The name of 2 group chats could not be read just now.",
    ],
    [
      "names were both refused and failed",
      [DENIED_CHAT_ID, "19:second@thread.v2", "19:third@thread.v2"],
      [FAILED_CHAT_ID],
      "Chat names refreshed. Microsoft Teams did not share the name of 3 group chats. The name of 1 group chat could not be read just now.",
    ],
  ])(
    "summary when %s",
    async (
      _label: string,
      permissionDeniedChatIds: Array<string>,
      failedChatIds: Array<string>,
      expected: string,
    ) => {
      postResponder = refreshResponse({
        chats: [...MIXED_CHATS, ...EXTRA_GROUP_CHATS],
        permissionDeniedChatIds: permissionDeniedChatIds,
        failedChatIds: failedChatIds,
      });

      await renderCard();
      await clickRefresh();

      expect(getLiveRegion().textContent).toBe(expected);
    },
  );
});
