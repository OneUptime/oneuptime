import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CONNECT BUTTON FROM SLACK OR MICROSOFT TEAMS, ON THE SETTINGS PAGE IT
 * OPENS.
 *
 * Somebody whose chat account is not connected pressed a button in Slack or
 * Microsoft Teams, and was answered there with a Connect button. It opens
 * their own settings page for that chat with `?connect=` and the press's
 * token. The page connects the account in one step: it starts the sign-in
 * with the token on its own, saying meanwhile that it is connecting. When
 * the sign-in comes back with `?pressed=`, the page says what became of the
 * press - with, for Slack, a link back to the channel the press was in. A
 * Connect button that can no longer be used says so, the page's own Connect
 * button right below. Every value is taken off the address once read, and
 * nothing the address carries is shown as itself.
 *
 * The Connect Slack account link in a Slack channel's note - the people
 * OneUptime could not add to it - opens the Slack page with
 * `?connectAccount=true`: somebody not connected yet is taken to Slack to
 * connect at once, with no press to finish; anybody connected already sees
 * the page as usual.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const TOKEN: string = `${"aZ09_-".repeat(7)}q`;
const SLACK_AUTHORIZE: string =
  "https://slack.com/openid/connect/authorize?state=s";
// Where the server sends a sign-in: the project's tenant (MicrosoftTeamsSignInAuthority).
const TEAMS_AUTHORIZE: string =
  "https://login.microsoftonline.com/0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11/oauth2/v2.0/authorize?state=s";

const query: Record<string, string | null> = {};
const setQueryStringMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    SlackAppClientId: "slack-client-id",
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (name: string): string | null => {
        return query[name] ?? null;
      },
      setQueryString: (...args: Array<unknown>): void => {
        setQueryStringMock(...args);
      },
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      getLocation: () => {
        return { pathname: "/" };
      },
      getCurrentRoute: () => {
        return {
          toString: () => {
            return `/dashboard/${PROJECT_ID}/user-settings/slack-integration`;
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return PROJECT_ID;
          },
        };
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "user-id";
          },
        };
      },
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return String(error);
      },
      getFriendlyErrorMessage: (error: unknown) => {
        // An HTTPErrorResponse reads as the message the server sent.
        const message: unknown = (error as { message?: unknown } | null)
          ?.message;
        return typeof message === "string" && message ? message : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      deleteItem: async () => {
        return undefined;
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import MicrosoftTeamsIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import SlackIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

// Whether the project is connected to the chat, as the page reads it.
let projectConnected: boolean = true;
// Whether the person's own chat account is connected.
let userConnected: boolean = false;
/*
 * What the sign-in start answers: its authorization address, a 400 for a
 * Connect button that can no longer be used, or a 400 for anything else.
 */
let signInAnswer: "start" | "gone" | "refused" | "failed" = "start";

beforeEach(() => {
  for (const name of Object.keys(query)) {
    delete query[name];
  }

  projectConnected = true;
  userConnected = false;
  signInAnswer = "start";
  setQueryStringMock.mockReset();
  navigateMock.mockReset();

  getListMock.mockReset();
  getListMock.mockImplementation(async (options: unknown) => {
    const modelName: string = (options as { modelType: { name: string } })
      .modelType.name;
    const workspaceType: unknown = (
      options as { query: { workspaceType?: unknown } }
    ).query.workspaceType;

    let data: Array<unknown> = [];

    if (modelName === "WorkspaceProjectAuthToken" && projectConnected) {
      data = [
        {
          id: {
            toString: () => {
              return "project-auth";
            },
          },
          miscData:
            workspaceType === WorkspaceType.MicrosoftTeams
              ? { adminConsentGranted: true }
              : { teamName: "Acme" },
        },
      ];
    }

    if (modelName === "WorkspaceUserAuthToken" && userConnected) {
      data = [
        {
          id: {
            toString: () => {
              return "user-auth";
            },
          },
        },
      ];
    }

    return { data: data, count: data.length, skip: 0, limit: 1 };
  });

  apiGetMock.mockReset();
  apiGetMock.mockImplementation(async (options: unknown) => {
    const url: string = (options as { url: URL }).url.toString();

    if (url.includes("/sign-in-url")) {
      if (signInAnswer === "gone") {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "This Connect button has expired or was already used. Press the button in Slack again.",
          },
          {},
        );
      }

      if (signInAnswer === "refused") {
        return new HTTPErrorResponse(
          400,
          { message: "Slack sign-in is not set up on this server." },
          {},
        );
      }

      if (signInAnswer === "failed") {
        return new HTTPErrorResponse(
          500,
          { message: "OneUptime could not reach Slack. Please try again." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(
        200,
        {
          authorizationUrl: url.includes("/slack/")
            ? SLACK_AUTHORIZE
            : TEAMS_AUTHORIZE,
        },
        {},
      );
    }

    // The Slack app manifest the page shows for connecting the project.
    return new HTTPResponse<JSONObject>(200, {}, {});
  });
});

afterEach(() => {
  cleanup();
});

async function renderSlack(): Promise<void> {
  await act(async () => {
    render(
      <SlackIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
        startPage={ConnectStartPage.UserSettings}
      />,
    );
  });
}

async function renderTeams(): Promise<void> {
  await act(async () => {
    render(
      <MicrosoftTeamsIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
        startPage={ConnectStartPage.UserSettings}
      />,
    );
  });
}

// The sign-in starts asked for, as addresses.
function signInStarts(): Array<globalThis.URL> {
  return apiGetMock.mock.calls
    .map((call: Array<unknown>): string => {
      return (call[0] as { url: URL }).url.toString();
    })
    .filter((url: string): boolean => {
      return url.includes("/sign-in-url");
    })
    .map((url: string): globalThis.URL => {
      return new globalThis.URL(url);
    });
}

function navigatedTo(): Array<string> {
  return navigateMock.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

describe("the Slack page, opened from a Connect button in Slack", () => {
  test("starts the sign-in on its own, carrying the press, and takes the browser to Slack", async () => {
    query["connect"] = TOKEN;

    await renderSlack();

    const starts: Array<globalThis.URL> = signInStarts();
    expect(starts).toHaveLength(1);
    expect(starts[0]!.pathname.endsWith("/slack/sign-in-url")).toBe(true);
    expect(starts[0]!.searchParams.get("connect")).toBe(TOKEN);
    expect(starts[0]!.searchParams.get("from")).toBe("user-settings");
    expect(navigatedTo()).toEqual([SLACK_AUTHORIZE]);
    // Taken off the address: a reload does not start it again.
    expect(setQueryStringMock).toHaveBeenCalledWith({ connect: null });
  });

  test("says it is connecting while the browser is on its way", async () => {
    query["connect"] = TOKEN;
    // The browser never leaves in a test: the page stays as it was left.
    await renderSlack();

    expect(screen.getByTestId("connect-request-connecting")).toHaveTextContent(
      "Connecting your Slack account…",
    );
    expect(screen.getByTestId("connect-request-connecting")).toHaveTextContent(
      "Taking you to Slack to confirm it's you.",
    );
  });

  /*
   * Most Connect buttons are pressed in Slack's phone app. A card's
   * description is hidden below md, so the connecting card says what is
   * happening in its own body - and as a status, which a screen reader reads
   * out.
   */
  test("what it says while connecting is a status, and not a description a phone hides", async () => {
    query["connect"] = TOKEN;
    await renderSlack();

    const status: HTMLElement = within(
      screen.getByTestId("connect-request-connecting"),
    ).getByRole("status");
    expect(status).toHaveTextContent("Connecting your Slack account…");
    expect(status).toHaveTextContent(
      "Taking you to Slack to confirm it's you.",
    );
    expect(
      screen
        .getByTestId("connect-request-connecting")
        .querySelector('[data-testid="card-description"]'),
    ).toBeNull();
  });

  test("a sign-in that cannot start says why above the page, and the page's own Connect button is right there to try again", async () => {
    query["connect"] = TOKEN;
    signInAnswer = "failed";

    await renderSlack();

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-request-connecting")).toBeNull();
    const notice: HTMLElement = screen.getByTestId(
      "connect-request-start-error",
    );
    expect(notice).toHaveTextContent("Slack was not connected");
    expect(notice).toHaveTextContent(
      "OneUptime could not reach Slack. Please try again.",
    );
    // Never that the button expired: it did not.
    expect(screen.queryByTestId("connect-request-link-gone")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connect my account with Slack" }),
    ).toBeInTheDocument();
  });

  test("the card below says what to do, and names the Slack workspace to connect in", async () => {
    query["connect"] = TOKEN;
    signInAnswer = "gone";

    await renderSlack();

    expect(screen.getByText("Connect your Slack account")).toBeInTheDocument();
    expect(
      screen.getByText(
        "OneUptime is installed in the Acme Slack workspace. Connect your account there to acknowledge incidents and get messages as yourself, in Slack.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("disconnected from Slack");
  });

  test("a Connect button that can no longer be used says so, and the page's own Connect button is right there", async () => {
    query["connect"] = TOKEN;
    signInAnswer = "gone";

    await renderSlack();

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("connect-request-link-gone")).toHaveTextContent(
      "This Connect button has expired",
    );
    expect(screen.getByTestId("connect-request-link-gone")).toHaveTextContent(
      "Press the button in Slack again for a new one, or connect your account here.",
    );
    expect(screen.queryByTestId("connect-request-connecting")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connect my account with Slack" }),
    ).toBeInTheDocument();
  });

  test("a Connect button used already, opened by somebody connected already: nothing to connect, and no warning", async () => {
    query["connect"] = TOKEN;
    signInAnswer = "gone";
    userConnected = true;

    await renderSlack();

    const notice: HTMLElement = screen.getByTestId("connect-request-link-gone");
    expect(notice).toHaveTextContent("Your Slack account is already connected");
    expect(notice).toHaveTextContent(
      "This Connect button was used already. Go back to Slack and press the button again.",
    );
    expect(notice).not.toHaveTextContent("expired");
    expect(notice).not.toHaveTextContent("connect your account here");
    // News, not a warning.
    expect(notice.className).toContain("bg-blue-50");
    // The card for your own account says so.
    expect(
      screen.getByRole("heading", { name: "Your Slack account is connected" }),
    ).toBeInTheDocument();
  });

  test("a token that is not one starts nothing", async () => {
    query["connect"] = "../../evil?x=1";

    await renderSlack();

    expect(signInStarts()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("in a project not connected to Slack, nothing starts: the page shows itself as usual", async () => {
    query["connect"] = TOKEN;
    projectConnected = false;

    await renderSlack();

    expect(signInStarts()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("back from the sign-in: what became of the press, and a link back to the channel it was in", async () => {
    query["pressed"] = "done";
    query["slackChannel"] = "C0INC2";
    query["slackTeam"] = "T0TEAM";

    await renderSlack();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent("Your Slack account is connected");
    expect(notice).toHaveTextContent(
      "OneUptime finished what you pressed in Slack and answered you there.",
    );
    expect(screen.getByRole("link", { name: "Back to Slack" })).toHaveAttribute(
      "href",
      "https://slack.com/app_redirect?channel=C0INC2&team=T0TEAM",
    );
    expect(setQueryStringMock).toHaveBeenCalledWith({
      pressed: null,
      slackChannel: null,
      slackTeam: null,
    });
  });

  test("a press answered without being done: the page says where the answer is, never that it was finished", async () => {
    query["pressed"] = "answered";
    query["slackChannel"] = "C0INC2";
    query["slackTeam"] = "T0TEAM";

    await renderSlack();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent(
      "OneUptime answered you in Slack, where you pressed the button.",
    );
    expect(notice).not.toHaveTextContent("finished");
    // The way back is its own line, not a word at the end of the sentence.
    const backToSlack: HTMLElement = screen.getByRole("link", {
      name: "Back to Slack",
    });
    expect(backToSlack.closest("p")).toBeNull();
  });

  /*
   * A question to OneUptime AI - an @mention, a direct message - was asked
   * in a message: there is no button to go back and press, and the page
   * used to say there was (#4768).
   */
  test("back from the sign-in after a question: says to ask it again, names no button, and links back to the channel it was asked in", async () => {
    query["pressed"] = "ask";
    query["slackChannel"] = "C0OPS";
    query["slackTeam"] = "T0TEAM";

    await renderSlack();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent("Your Slack account is connected");
    expect(notice).toHaveTextContent(
      "Go back to Slack and ask your question again.",
    );
    expect(notice).not.toHaveTextContent("press the button");
    expect(screen.getByRole("link", { name: "Back to Slack" })).toHaveAttribute(
      "href",
      "https://slack.com/app_redirect?channel=C0OPS&team=T0TEAM",
    );
    expect(setQueryStringMock).toHaveBeenCalledWith({
      pressed: null,
      slackChannel: null,
      slackTeam: null,
    });
  });

  test("…asked in the app's direct messages, which name no channel: the same sentence, and no link to nowhere", async () => {
    query["pressed"] = "ask";

    await renderSlack();

    expect(screen.getByTestId("connect-request-notice")).toHaveTextContent(
      "Go back to Slack and ask your question again.",
    );
    expect(screen.queryByRole("link", { name: "Back to Slack" })).toBeNull();
  });

  test("a press Slack took no answer for: the page says to look at the record", async () => {
    query["pressed"] = "unanswered";

    await renderSlack();

    expect(screen.getByTestId("connect-request-notice")).toHaveTextContent(
      "OneUptime could not answer you in Slack. Open the record in OneUptime to see where it stands.",
    );
    // No channel named: no way back to offer.
    expect(screen.queryByRole("link", { name: "Back to Slack" })).toBeNull();
  });

  test("words in the address are never shown, and a channel that is not an id links nowhere", async () => {
    query["pressed"] = "<img src=x onerror=alert(1)>Sign in again";
    query["slackChannel"] = "C0INC2&team=T9EVIL";
    query["slackTeam"] = "T0TEAM";

    await renderSlack();

    expect(screen.queryByTestId("connect-request-notice")).toBeNull();
    expect(document.body.textContent).not.toContain("Sign in again");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the Slack page, opened from the Connect Slack account link in a channel's note", () => {
  test("somebody not connected yet is taken to Slack at once: no token, no press to finish", async () => {
    query["connectAccount"] = "true";

    await renderSlack();

    const starts: Array<globalThis.URL> = signInStarts();
    expect(starts).toHaveLength(1);
    expect(starts[0]!.pathname.endsWith("/slack/sign-in-url")).toBe(true);
    expect(starts[0]!.searchParams.get("connect")).toBeNull();
    expect(starts[0]!.searchParams.get("from")).toBe("user-settings");
    expect(navigatedTo()).toEqual([SLACK_AUTHORIZE]);
    // Taken off the address: a reload, or the back button, does not start it again.
    expect(setQueryStringMock).toHaveBeenCalledWith({ connectAccount: null });
    expect(screen.getByTestId("connect-request-connecting")).toHaveTextContent(
      "Connecting your Slack account…",
    );
  });

  test("somebody connected already: nothing starts, and the page says they are connected", async () => {
    query["connectAccount"] = "true";
    userConnected = true;

    await renderSlack();

    expect(signInStarts()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-request-connecting")).toBeNull();
    // The card for your own account says so.
    expect(
      screen.getByRole("heading", { name: "Your Slack account is connected" }),
    ).toBeInTheDocument();
  });

  test("in a project not connected to Slack, nothing starts: installing the app is a choice for the page", async () => {
    query["connectAccount"] = "true";
    projectConnected = false;

    await renderSlack();

    expect(signInStarts()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test.each(["1", "yes", "TRUE", ""])(
    "?connectAccount=%p starts nothing",
    async (value: string) => {
      query["connectAccount"] = value;

      await renderSlack();

      expect(signInStarts()).toEqual([]);
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  test("a sign-in that cannot start says why - and never that a Connect button expired, as there was none", async () => {
    query["connectAccount"] = "true";
    signInAnswer = "refused";

    await renderSlack();

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-request-connecting")).toBeNull();
    expect(screen.queryByTestId("connect-request-link-gone")).toBeNull();
    expect(screen.getByTestId("connect-request-start-error")).toHaveTextContent(
      "Slack sign-in is not set up on this server.",
    );
    // Above the page, which stays: its Connect button is right there.
    expect(
      screen.getByRole("button", { name: "Connect my account with Slack" }),
    ).toBeInTheDocument();
  });
});

describe("the Microsoft Teams page, opened from a Connect button in Teams", () => {
  test("starts the Microsoft sign-in on its own, carrying the press", async () => {
    query["connect"] = TOKEN;

    await renderTeams();

    const starts: Array<globalThis.URL> = signInStarts();
    expect(starts).toHaveLength(1);
    expect(starts[0]!.pathname.endsWith("/microsoft-teams/sign-in-url")).toBe(
      true,
    );
    expect(starts[0]!.searchParams.get("connect")).toBe(TOKEN);
    expect(navigatedTo()).toEqual([TEAMS_AUTHORIZE]);
  });

  test("a Microsoft sign-in that cannot start says why above the page, which stays as it is", async () => {
    query["connect"] = TOKEN;
    signInAnswer = "failed";

    await renderTeams();

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-request-connecting")).toBeNull();
    expect(screen.getByTestId("connect-request-start-error")).toHaveTextContent(
      "Microsoft Teams was not connected",
    );
    expect(
      screen.getByRole("button", {
        name: "Connect my account with Microsoft Teams",
      }),
    ).toBeInTheDocument();
  });

  test("back from the sign-in, told to press again: says so, with no Slack link", async () => {
    query["pressed"] = "again";

    await renderTeams();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent(
      "Your Microsoft Teams account is connected",
    );
    expect(notice).toHaveTextContent(
      "Go back to Microsoft Teams and press the button again.",
    );
    expect(screen.queryByRole("link", { name: "Back to Slack" })).toBeNull();
  });

  /*
   * A command typed to the bot - "oncall", "show active incidents" - is
   * typed again, as the conversation says: no button sent it.
   */
  test("back from the sign-in after a command: says to type it again, and names no button", async () => {
    query["pressed"] = "run";

    await renderTeams();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent(
      "Go back to Microsoft Teams and type the command again.",
    );
    expect(notice).not.toHaveTextContent("press the button");
    expect(setQueryStringMock).toHaveBeenCalledWith({ pressed: null });
  });

  test("back from the sign-in after a question: says to ask it again, and names no button", async () => {
    query["pressed"] = "ask";

    await renderTeams();

    const notice: HTMLElement = screen.getByTestId("connect-request-notice");
    expect(notice).toHaveTextContent(
      "Your Microsoft Teams account is connected",
    );
    expect(notice).toHaveTextContent(
      "Go back to Microsoft Teams and ask your question again.",
    );
    expect(notice).not.toHaveTextContent("press the button");
    expect(screen.queryByRole("link", { name: "Back to Slack" })).toBeNull();
    expect(setQueryStringMock).toHaveBeenCalledWith({ pressed: null });
  });
});
