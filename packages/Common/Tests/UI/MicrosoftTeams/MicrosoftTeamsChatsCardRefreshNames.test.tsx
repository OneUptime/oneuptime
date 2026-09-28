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

/*
 * Issue #4106: group chats were listed by their members' names instead of
 * their Teams names.
 *
 * On the card, that means: opening the page reads what is stored (GET), and
 * Refresh Chats asks the server to re-read every group chat's name from
 * Microsoft (POST /microsoft-teams/chats/refresh) and shows the result. When
 * Microsoft refuses to share some names, the card says why and what to do,
 * instead of leaving the admin looking at member names with no explanation.
 */

let billingEnabled: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

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

interface RecordedCall {
  method: "get" | "post";
  route: string;
}

type Responder = () => Promise<{ data: JSONObject }>;

let calls: Array<RecordedCall> = [];
let getResponder: Responder;
let postResponder: Responder;

function routeOf(options: { url: { toString: () => string } }): string {
  // Compared without the API base path, which differs between environments.
  return new window.URL(options.url.toString()).pathname.replace(/^\/api/, "");
}

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (options: {
        url: { toString: () => string };
      }): Promise<{ data: JSONObject }> => {
        calls.push({ method: "get", route: routeOf(options) });
        return getResponder();
      },
      post: (options: {
        url: { toString: () => string };
      }): Promise<{ data: JSONObject }> => {
        calls.push({ method: "post", route: routeOf(options) });
        return postResponder();
      },
      getFriendlyErrorMessage: (err: Error): string => {
        return err?.message || "Something went wrong.";
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

const MEMBER_NAME: string =
  "Bibishek G S Steephensen [Contractor], Karthik Kallam [Contractor], Robin Examp…";

const STORED_CHATS: Array<JSONObject> = [
  {
    id: "19:group@thread.v2",
    name: MEMBER_NAME,
    chatType: "groupChat",
    addedAt: null,
  },
  {
    id: "a:personal",
    name: "Jane Doe",
    chatType: "personal",
    addedAt: null,
  },
];

const REFRESHED_CHATS: Array<JSONObject> = [
  {
    id: "a:personal",
    name: "Jane Doe",
    chatType: "personal",
    addedAt: null,
  },
  {
    id: "19:group@thread.v2",
    name: "Platform On-Call",
    chatType: "groupChat",
    addedAt: null,
  },
];

const NOTICE_TEXT: RegExp = /Microsoft Teams would not share the name of/i;

function respond(data: JSONObject): Responder {
  return async (): Promise<{ data: JSONObject }> => {
    return { data: data };
  };
}

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(<MicrosoftTeamsChatsCard />);
  });

  await waitFor(() => {
    expect(
      screen.getByText(/Connected chats|No chats connected yet/),
    ).toBeInTheDocument();
  });
}

async function clickRefresh(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: /Refresh Chats/i }));
  });

  await waitFor(() => {
    expect(
      screen.queryByText(
        /Connected chats|No chats connected yet|Something went wrong|failed/i,
      ),
    ).toBeInTheDocument();
  });
}

function notice(): HTMLElement | null {
  return screen.queryByText(NOTICE_TEXT);
}

// The notice itself — Send Test buttons carry role="status" too.
function noticeElement(): HTMLElement {
  const element: HTMLElement | null = notice();
  expect(element).toBeInTheDocument();
  expect(element).toHaveAttribute("role", "status");
  return element!;
}

beforeEach(() => {
  billingEnabled = false;
  calls = [];
  getResponder = respond({ chats: STORED_CHATS });
  postResponder = respond({
    chats: REFRESHED_CHATS,
    chatNamePermissionDeniedCount: 0,
    chatNameFailedCount: 0,
  });
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

    expect(calls).toEqual([
      { method: "post", route: "/microsoft-teams/chats/refresh" },
    ]);
  });

  test("the issue: after Refresh Chats the group chat shows its Teams name, still tagged 'Group chat'", async () => {
    await renderCard();
    expect(screen.getByText(MEMBER_NAME)).toBeInTheDocument();

    await clickRefresh();

    expect(screen.queryByText(MEMBER_NAME)).not.toBeInTheDocument();
    const name: HTMLElement = screen.getByText("Platform On-Call");
    const row: HTMLElement = name.closest("li") as HTMLElement;
    expect(within(row).getByText("Group chat")).toBeInTheDocument();
  });

  test("1:1 chats keep the other person's name and the '1:1 chat' tag", async () => {
    await renderCard();
    await clickRefresh();

    const row: HTMLElement = screen
      .getByText("Jane Doe")
      .closest("li") as HTMLElement;
    expect(within(row).getByText("1:1 chat")).toBeInTheDocument();
  });

  test("rows follow the order the server returns (sorted by name there)", async () => {
    await renderCard();
    await clickRefresh();

    const names: Array<string> = screen
      .getAllByRole("listitem")
      .map((item: HTMLElement) => {
        return item.querySelector(".font-medium")?.textContent || "";
      })
      .filter((text: string) => {
        return Boolean(text);
      });
    expect(names).toEqual(["Jane Doe", "Platform On-Call"]);
  });

  test("Send Test is labelled with the refreshed name", async () => {
    await renderCard();
    await clickRefresh();

    const row: HTMLElement = screen
      .getByText("Platform On-Call")
      .closest("li") as HTMLElement;
    expect(
      within(row).getByRole("button", { name: /Send Test/i }),
    ).toBeInTheDocument();
  });

  test("a failed refresh shows the error", async () => {
    await renderCard();
    postResponder = async (): Promise<{ data: JSONObject }> => {
      throw new Error("Refresh failed: Microsoft is unavailable");
    };

    await clickRefresh();

    expect(
      screen.getByText("Refresh failed: Microsoft is unavailable"),
    ).toBeInTheDocument();
  });

  test("Refresh can be clicked again and each click refreshes again", async () => {
    await renderCard();
    calls = [];

    await clickRefresh();
    await clickRefresh();

    expect(calls).toEqual([
      { method: "post", route: "/microsoft-teams/chats/refresh" },
      { method: "post", route: "/microsoft-teams/chats/refresh" },
    ]);
  });
});

describe("MicrosoftTeamsChatsCard — when Microsoft will not share chat names", () => {
  test("no notice when every name was read", async () => {
    await renderCard();
    await clickRefresh();

    expect(notice()).not.toBeInTheDocument();
  });

  test("no notice on the first load, which does not ask Microsoft", async () => {
    getResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 4,
    });

    await renderCard();

    expect(notice()).not.toBeInTheDocument();
  });

  test("names failing for other reasons (not permissions) do not show the permission notice", async () => {
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 0,
      chatNameFailedCount: 2,
    });

    await renderCard();
    await clickRefresh();

    expect(notice()).not.toBeInTheDocument();
  });

  test("one refused chat: singular wording, and names the permission", async () => {
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 1,
      chatNameFailedCount: 0,
    });

    await renderCard();
    await clickRefresh();

    const status: HTMLElement = noticeElement();
    expect(status).toHaveTextContent(
      /would not share the name of 1 group chat, so it is listed by member names/i,
    );
    expect(status).toHaveTextContent("ChatSettings.Read.Chat");
  });

  test("several refused chats: plural wording with the count", async () => {
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 3,
      chatNameFailedCount: 0,
    });

    await renderCard();
    await clickRefresh();

    expect(noticeElement()).toHaveTextContent(
      /would not share the name of 3 group chats, so they are listed by member names/i,
    );
  });

  test("self-hosted: tells the admin to re-upload the manifest, then update the app in the chat", async () => {
    billingEnabled = false;
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 2,
    });

    await renderCard();
    await clickRefresh();

    const status: HTMLElement = noticeElement();
    expect(status).toHaveTextContent(
      /Download the app manifest again from Project Settings > Workspace > Microsoft Teams/i,
    );
    expect(status).toHaveTextContent(
      /update the OneUptime app in those chats/i,
    );
    expect(status).toHaveTextContent(/then click Refresh Chats/i);
  });

  test("SaaS: only asks to update the app in the chat — there is no manifest to upload", async () => {
    billingEnabled = true;
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 2,
    });

    await renderCard();
    await clickRefresh();

    const status: HTMLElement = noticeElement();
    expect(status).toHaveTextContent(
      /Update the OneUptime app in those chats in Microsoft Teams, then click Refresh Chats/i,
    );
    expect(status).not.toHaveTextContent(/manifest/i);
  });

  test("the notice goes away once a later refresh reads every name", async () => {
    postResponder = respond({
      chats: STORED_CHATS,
      chatNamePermissionDeniedCount: 1,
    });

    await renderCard();
    await clickRefresh();
    expect(notice()).toBeInTheDocument();

    postResponder = respond({
      chats: REFRESHED_CHATS,
      chatNamePermissionDeniedCount: 0,
    });
    await clickRefresh();

    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByText("Platform On-Call")).toBeInTheDocument();
  });

  test("a missing count is treated as zero", async () => {
    postResponder = respond({ chats: REFRESHED_CHATS });

    await renderCard();
    await clickRefresh();

    expect(notice()).not.toBeInTheDocument();
  });

  test("a non-numeric count is treated as zero", async () => {
    postResponder = respond({
      chats: REFRESHED_CHATS,
      chatNamePermissionDeniedCount: "lots" as unknown as number,
    });

    await renderCard();
    await clickRefresh();

    expect(notice()).not.toBeInTheDocument();
  });

  test("no notice when there are no chats to show", async () => {
    getResponder = respond({ chats: [] });
    postResponder = respond({
      chats: [],
      chatNamePermissionDeniedCount: 1,
    });

    await renderCard();
    await clickRefresh();

    expect(screen.getByText("No chats connected yet")).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });
});
