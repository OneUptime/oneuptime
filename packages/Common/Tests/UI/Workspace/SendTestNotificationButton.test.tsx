import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { APP_API_URL } from "../../../UI/Config";

/*
 * SendTestNotificationButton sits on every row of the Slack channels card and
 * the Microsoft Teams channels and chats cards. One click posts a test
 * notification to that one destination - no confirmation dialog - and the row
 * reports the outcome: a "Sent" badge on success, and on failure a "Failed"
 * badge plus a dialog (with a single "Close" button) that carries the
 * server's error. Both badges appear inside one polite live region that is
 * mounted from the first render, and an optional onSendingChange callback
 * tells the card when each send starts and settles.
 *
 * API and ModelAPI are mocked the same way the chats card test mocks them: a
 * module-level object whose functions forward to mutable test state, so each
 * test decides what the server "answers" without jest.resetModules() (which
 * would hand the component a second copy of React). Every request the
 * component makes is recorded so the tests can assert on the URL, body and
 * headers it sent.
 */

interface PostRequest {
  url: URL;
  data: JSONObject;
  headers: Record<string, string>;
}

type PostResult = HTTPResponse<JSONObject> | HTTPErrorResponse;
type ApiPostFunction = (request: PostRequest) => Promise<PostResult>;
type FriendlyErrorMessageFunction = (error: unknown) => string;

const COMMON_HEADERS: Record<string, string> = {
  tenantid: "5f8b9c2e-project-under-test",
  authorization: "Bearer test-token",
};

const postRequests: Array<PostRequest> = [];
const friendlyErrorMessageArguments: Array<unknown> = [];
let commonHeadersCallCount: number = 0;

const successResponse: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };

const defaultApiPost: ApiPostFunction = async (): Promise<PostResult> => {
  return successResponse();
};

/*
 * The real getFriendlyErrorMessage reads `.message` off whatever it is given.
 * HTTPErrorResponse exposes the server's { message } body through a getter, so
 * this default mirrors what the dashboard would show for both shapes.
 */
const defaultFriendlyErrorMessage: FriendlyErrorMessageFunction = (
  error: unknown,
): string => {
  if (error instanceof HTTPErrorResponse) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
};

let apiPost: ApiPostFunction = defaultApiPost;
let friendlyErrorMessage: FriendlyErrorMessageFunction =
  defaultFriendlyErrorMessage;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: PostRequest): Promise<PostResult> => {
        postRequests.push(request);
        return apiPost(request);
      },
      getFriendlyErrorMessage: (error: unknown): string => {
        friendlyErrorMessageArguments.push(error);
        return friendlyErrorMessage(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        commonHeadersCallCount += 1;
        return COMMON_HEADERS;
      },
    },
  };
});

import SendTestNotificationButton, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  return {
    promise: promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

/*
 * Hands every subsequent post the same pending promise, so the test controls
 * exactly when the request "comes back".
 */
function holdNextPosts(): Deferred<PostResult> {
  const deferred: Deferred<PostResult> = createDeferred<PostResult>();

  apiPost = (): Promise<PostResult> => {
    return deferred.promise;
  };

  return deferred;
}

async function settle(
  deferred: Deferred<PostResult>,
  outcome: { resolveWith: PostResult } | { rejectWith: unknown },
): Promise<void> {
  await act(async (): Promise<void> => {
    if ("resolveWith" in outcome) {
      deferred.resolve(outcome.resolveWith);
    } else {
      deferred.reject(outcome.rejectWith);
    }

    try {
      await deferred.promise;
    } catch {
      // The component handles the rejection; this only waits it out.
    }
  });
}

const SLACK_PROPS: ComponentProps = {
  route: "/slack/channels/test",
  requestBody: { channelId: "C0123ALERTS" },
  destinationName: "#alerts",
  workspaceName: "Slack",
};

const TEAMS_CHANNEL_PROPS: ComponentProps = {
  route: "/microsoft-teams/channels/test",
  requestBody: {
    teamId: "a1b2c3d4-team-platform",
    channelId: "19:general-thread@thread.tacv2",
  },
  destinationName: "General",
  workspaceName: "Microsoft Teams",
};

const TEAMS_CHAT_PROPS: ComponentProps = {
  route: "/microsoft-teams/chats/test",
  requestBody: { chatId: "19:groupchat-war-room@thread.v2" },
  destinationName: "Incident War Room",
  workspaceName: "Microsoft Teams",
};

const SENT_TEST_ID: string = "send-test-notification-sent";
const FAILED_TEST_ID: string = "send-test-notification-failed";
const BUTTON_TEST_ID: string = "send-test-notification-button";
const ERROR_MODAL_TITLE: string = "Test Notification Failed";

function renderButton(props: ComponentProps = SLACK_PROPS): RenderResult {
  return render(<SendTestNotificationButton {...props} />);
}

function getSendButton(destinationName: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Send test notification to ${destinationName}`,
  });
}

function querySentStatus(
  scope: HTMLElement = document.body,
): HTMLElement | null {
  return within(scope).queryByTestId(SENT_TEST_ID);
}

function queryFailedStatus(
  scope: HTMLElement = document.body,
): HTMLElement | null {
  return within(scope).queryByTestId(FAILED_TEST_ID);
}

function queryErrorModal(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: ERROR_MODAL_TITLE });
}

function getSpinner(button: HTMLElement): Element | null {
  return button.querySelector("svg.animate-spin");
}

async function clickSend(button: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(button);
  });
}

/*
 * The modal mounts transparent and fades in on the next frame. Waiting for the
 * fade both proves the dialog actually becomes visible and keeps that
 * follow-up state update inside act.
 */
async function waitForErrorModal(): Promise<HTMLElement> {
  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: ERROR_MODAL_TITLE,
  });

  await waitFor(() => {
    expect(dialog).toHaveClass("opacity-100");
  });

  return dialog;
}

async function waitForSent(scope: HTMLElement = document.body): Promise<void> {
  await waitFor(() => {
    expect(querySentStatus(scope)).toBeInTheDocument();
  });
}

beforeEach(() => {
  postRequests.length = 0;
  friendlyErrorMessageArguments.length = 0;
  commonHeadersCallCount = 0;
  apiPost = defaultApiPost;
  friendlyErrorMessage = defaultFriendlyErrorMessage;
});

describe("SendTestNotificationButton", () => {
  describe("initial render", () => {
    test('renders an enabled "Send Test" button labelled with the destination', () => {
      renderButton(SLACK_PROPS);

      const button: HTMLElement = getSendButton("#alerts");

      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("Send Test");
      expect(button).toHaveAttribute(
        "aria-label",
        "Send test notification to #alerts",
      );
      expect(button).toHaveAttribute("data-testid", BUTTON_TEST_ID);
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-disabled", "false");
    });

    test("is a plain button, so it can never submit a surrounding form", () => {
      renderButton(SLACK_PROPS);

      expect(getSendButton("#alerts")).toHaveAttribute("type", "button");
    });

    test.each([
      ["a Slack channel", "#alerts"],
      ["a Teams channel", "General"],
      ["a group chat named after its members", "Alice, Bob"],
      ["a name with quotes", 'Ops "Night" Shift'],
    ])(
      "uses the destination name verbatim in the accessible name for %s",
      (_label: string, destinationName: string) => {
        renderButton({ ...SLACK_PROPS, destinationName: destinationName });

        expect(
          screen.getByRole("button", {
            name: `Send test notification to ${destinationName}`,
          }),
        ).toBeInTheDocument();
      },
    );

    test("shows no status, no dialog and no spinner before it is clicked", () => {
      renderButton(SLACK_PROPS);

      const button: HTMLElement = getSendButton("#alerts");

      expect(querySentStatus()).not.toBeInTheDocument();
      expect(queryFailedStatus()).not.toBeInTheDocument();
      // The live region is already there, but it has nothing to say yet.
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(getSpinner(button)).toBeNull();
      // The send icon is drawn instead of the spinner.
      expect(button.querySelector("svg")).not.toBeNull();
    });

    test("sends nothing on mount", () => {
      renderButton(SLACK_PROPS);

      expect(postRequests).toHaveLength(0);
      expect(commonHeadersCallCount).toBe(0);
    });

    test("wraps its content in a non-shrinking flex row so a long name cannot squash it", () => {
      const { container } = renderButton(SLACK_PROPS);

      const root: HTMLElement = container.firstElementChild as HTMLElement;

      expect(root.tagName).toBe("DIV");
      expect(root).toHaveClass("flex", "flex-none", "items-center", "gap-2");
      expect(root).toContainElement(getSendButton("#alerts"));
    });

    test("uses the small button size", () => {
      renderButton(SLACK_PROPS);

      expect(getSendButton("#alerts")).toHaveClass("px-2", "py-1");
    });

    test("keeps the row's text size and hugs the right edge when a narrow row wraps it", () => {
      const { container } = renderButton(SLACK_PROPS);

      const root: HTMLElement = container.firstElementChild as HTMLElement;

      /*
       * Button is text-base below md; in a list row it has to match the
       * row's text-sm. ml-auto keeps the control right-aligned whether it
       * sits beside the name or on a line of its own under it.
       */
      expect(getSendButton("#alerts")).toHaveClass("!text-sm");
      expect(root).toHaveClass("ml-auto");
    });
  });

  describe("status live region", () => {
    /*
     * Screen readers often ignore a live region that is inserted already
     * filled, so the component keeps one polite role="status" region mounted
     * from the first render and only swaps what is inside it. The tests hold
     * on to the node from the idle render and check it is the very same node
     * that later carries the result.
     */
    function getLiveRegion(): HTMLElement {
      return screen.getByRole("status");
    }

    test("is mounted, polite and empty while idle", () => {
      renderButton(SLACK_PROPS);

      const liveRegion: HTMLElement = getLiveRegion();

      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toBeEmptyDOMElement();
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    test('stays empty while sending, then the same node announces "Sent"', async () => {
      renderButton(SLACK_PROPS);

      const liveRegion: HTMLElement = getLiveRegion();
      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toBeEmptyDOMElement();

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveTextContent("Sent");
      expect(liveRegion).toContainElement(screen.getByTestId(SENT_TEST_ID));
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    test('the same node announces "Failed" when the send fails', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Nope." }, {});
      };

      renderButton(SLACK_PROPS);

      const liveRegion: HTMLElement = getLiveRegion();

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveTextContent("Failed");
      expect(liveRegion).toContainElement(screen.getByTestId(FAILED_TEST_ID));
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    test("one node carries every outcome across sends: idle, Sent, empty again, Failed", async () => {
      renderButton(SLACK_PROPS);

      const liveRegion: HTMLElement = getLiveRegion();

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toHaveTextContent("Sent");

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      // The retry clears the old result without replacing the region.
      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toBeEmptyDOMElement();

      await settle(deferred, {
        resolveWith: new HTTPErrorResponse(400, { message: "Nope." }, {}),
      });
      await waitForErrorModal();

      expect(getLiveRegion()).toBe(liveRegion);
      expect(liveRegion).toHaveTextContent("Failed");
      expect(liveRegion).not.toHaveTextContent("Sent");
    });
  });

  describe("sending", () => {
    test("posts once, immediately, without asking for confirmation", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      fireEvent.click(getSendButton("#alerts"));

      // The request goes out synchronously on click - no dialog in between.
      expect(postRequests).toHaveLength(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
    });

    test("posts to the route under APP_API_URL with the request body and the common headers", async () => {
      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(postRequests).toHaveLength(1);

      const request: PostRequest = postRequests[0]!;

      expect(request.url).toBeInstanceOf(URL);
      expect(request.url.toString().endsWith("/slack/channels/test")).toBe(
        true,
      );
      expect(request.url.toString()).toBe(
        URL.fromURL(APP_API_URL).addRoute("/slack/channels/test").toString(),
      );
      expect(request.url.toString().startsWith(APP_API_URL.toString())).toBe(
        true,
      );

      expect(request.data).toEqual({ channelId: "C0123ALERTS" });

      /*
       * This is a custom route, so the tenantid header only arrives through
       * getCommonHeaders() - without it the server cannot tell which project
       * the test is sent from.
       */
      expect(commonHeadersCallCount).toBe(1);
      expect(request.headers).toBe(COMMON_HEADERS);
      expect(request.headers).toEqual({
        tenantid: "5f8b9c2e-project-under-test",
        authorization: "Bearer test-token",
      });
    });

    test.each([
      ["a Slack channel", SLACK_PROPS],
      ["a Microsoft Teams channel", TEAMS_CHANNEL_PROPS],
      ["a Microsoft Teams chat", TEAMS_CHAT_PROPS],
    ])(
      "sends the route and body the card passes for %s",
      async (_label: string, props: ComponentProps) => {
        renderButton(props);

        await clickSend(getSendButton(props.destinationName));
        await waitForSent();

        expect(postRequests).toHaveLength(1);
        expect(postRequests[0]!.url.toString().endsWith(props.route)).toBe(
          true,
        );
        expect(postRequests[0]!.data).toEqual(props.requestBody);
        expect(postRequests[0]!.headers).toBe(COMMON_HEADERS);
      },
    );

    test("sends the Teams channel's team id alongside its channel id", async () => {
      renderButton(TEAMS_CHANNEL_PROPS);

      await clickSend(getSendButton("General"));
      await waitForSent();

      expect(postRequests[0]!.data).toEqual({
        teamId: "a1b2c3d4-team-platform",
        channelId: "19:general-thread@thread.tacv2",
      });
      expect(postRequests[0]!.data).not.toHaveProperty("chatId");
    });

    test("builds a fresh URL for every click and never mutates APP_API_URL", async () => {
      const appApiUrlBefore: string = APP_API_URL.toString();

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(postRequests).toHaveLength(2);
      expect(postRequests[0]!.url).not.toBe(APP_API_URL);
      expect(postRequests[1]!.url).not.toBe(APP_API_URL);
      expect(postRequests[0]!.url).not.toBe(postRequests[1]!.url);

      // No route piles up on the shared config URL between clicks.
      expect(postRequests[1]!.url.toString()).toBe(
        postRequests[0]!.url.toString(),
      );
      expect(APP_API_URL.toString()).toBe(appApiUrlBefore);
      expect(
        postRequests[1]!.url.toString().split("/slack/channels/test"),
      ).toHaveLength(2);
    });
  });

  describe("while the request is in flight", () => {
    test("disables the button and shows its loading spinner", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      const button: HTMLElement = getSendButton("#alerts");

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(getSpinner(button)).not.toBeNull();
      expect(button).toHaveTextContent("Send Test");

      expect(querySentStatus()).not.toBeInTheDocument();
      expect(queryFailedStatus()).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();
    });

    test("a second click does not post again", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));
      expect(postRequests).toHaveLength(1);

      await clickSend(getSendButton("#alerts"));
      expect(postRequests).toHaveLength(1);

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
      expect(commonHeadersCallCount).toBe(1);
    });

    test("a burst of clicks still posts only once", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      for (let i: number = 0; i < 5; i++) {
        await clickSend(getSendButton("#alerts"));
      }

      expect(postRequests).toHaveLength(1);

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
    });

    test("two clicks in the same frame, before the disabled state renders, still post only once", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();
      const button: HTMLElement = getSendButton("#alerts");

      /*
       * Both clicks land inside one act() scope, so React has not re-rendered
       * the button as disabled when the second one arrives. Only the
       * synchronous in-flight guard can stop it.
       */
      act(() => {
        button.click();
        button.click();
      });

      expect(postRequests).toHaveLength(1);

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
    });

    test("re-enables the button and drops the spinner once the request settles", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));
      expect(getSendButton("#alerts")).toBeDisabled();

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      const button: HTMLElement = getSendButton("#alerts");

      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-disabled", "false");
      expect(getSpinner(button)).toBeNull();
    });
  });

  describe("success", () => {
    test('shows a "Sent" status that tells the user where to look', async () => {
      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      const sent: HTMLElement = screen.getByTestId(SENT_TEST_ID);

      expect(sent).toHaveTextContent("Sent");
      expect(sent).toHaveAttribute(
        "title",
        "Test notification sent to #alerts. Check Slack to confirm it arrived.",
      );
      expect(sent).toHaveClass("text-emerald-700");
      expect(sent.querySelector("svg")).not.toBeNull();
      // The badge is announced through the row's one live region.
      expect(sent).not.toHaveAttribute("role");
      expect(screen.getByRole("status")).toContainElement(sent);
    });

    test.each([
      [
        "a Slack channel",
        SLACK_PROPS,
        "Test notification sent to #alerts. Check Slack to confirm it arrived.",
      ],
      [
        "a Microsoft Teams channel",
        TEAMS_CHANNEL_PROPS,
        "Test notification sent to General. Check Microsoft Teams to confirm it arrived.",
      ],
      [
        "a Microsoft Teams chat",
        TEAMS_CHAT_PROPS,
        "Test notification sent to Incident War Room. Check Microsoft Teams to confirm it arrived.",
      ],
    ])(
      "names the destination and workspace in the Sent title for %s",
      async (_label: string, props: ComponentProps, expectedTitle: string) => {
        renderButton(props);

        await clickSend(getSendButton(props.destinationName));
        await waitForSent();

        expect(screen.getByTestId(SENT_TEST_ID)).toHaveAttribute(
          "title",
          expectedTitle,
        );
      },
    );

    test("shows no failure, no dialog and no error text on success", async () => {
      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(queryFailedStatus()).not.toBeInTheDocument();
      expect(queryErrorModal()).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(friendlyErrorMessageArguments).toHaveLength(0);
      expect(getSendButton("#alerts")).toBeEnabled();
    });

    test("treats any non-error response as success, whatever its body", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPResponse<JSONObject>(200, { ok: true }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));
      await waitForSent();

      expect(queryFailedStatus()).not.toBeInTheDocument();
    });
  });

  describe("failure", () => {
    const SERVER_MESSAGE: string =
      "This chat is no longer connected to OneUptime. Add the OneUptime app to the chat in Microsoft Teams, click Refresh Chats, and try again.";

    test("an HTTPErrorResponse result opens the failure dialog with the friendly error", async () => {
      const errorResponse: HTTPErrorResponse = new HTTPErrorResponse(
        400,
        { message: SERVER_MESSAGE },
        {},
      );

      apiPost = async (): Promise<PostResult> => {
        return errorResponse;
      };

      friendlyErrorMessage = (): string => {
        return "Friendly: this chat is no longer connected.";
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
        ERROR_MODAL_TITLE,
      );
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "OneUptime could not send a test notification to Incident War Room in Microsoft Teams.",
      );
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Friendly: this chat is no longer connected.",
      );

      // The exact response object is what gets turned into the message.
      expect(friendlyErrorMessageArguments).toHaveLength(1);
      expect(friendlyErrorMessageArguments[0]).toBe(errorResponse);
    });

    test("shows the server's message when the friendly error is taken from the response", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: SERVER_MESSAGE }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        SERVER_MESSAGE,
      );
    });

    test.each([
      [
        "a Slack channel",
        SLACK_PROPS,
        "OneUptime could not send a test notification to #alerts in Slack.",
      ],
      [
        "a Microsoft Teams channel",
        TEAMS_CHANNEL_PROPS,
        "OneUptime could not send a test notification to General in Microsoft Teams.",
      ],
      [
        "a Microsoft Teams chat",
        TEAMS_CHAT_PROPS,
        "OneUptime could not send a test notification to Incident War Room in Microsoft Teams.",
      ],
    ])(
      "names the destination and workspace in the dialog for %s",
      async (
        _label: string,
        props: ComponentProps,
        expectedDescription: string,
      ) => {
        apiPost = async (): Promise<PostResult> => {
          return new HTTPErrorResponse(
            500,
            { message: "Upstream failure." },
            {},
          );
        };

        renderButton(props);

        await clickSend(getSendButton(props.destinationName));

        const dialog: HTMLElement = await waitForErrorModal();

        expect(
          within(dialog).getByTestId("confirm-modal-description"),
        ).toHaveTextContent(expectedDescription);
      },
    );

    test('shows a "Failed" status carrying the error while the dialog is open', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: SERVER_MESSAGE }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));
      await waitForErrorModal();

      const failed: HTMLElement = screen.getByTestId(FAILED_TEST_ID);

      expect(failed).toHaveTextContent("Failed");
      expect(failed).toHaveAttribute("title", SERVER_MESSAGE);
      expect(failed).toHaveClass("text-red-700");
      expect(failed.querySelector("svg")).not.toBeNull();
      // The badge is announced through the row's one live region.
      expect(failed).not.toHaveAttribute("role");
      expect(screen.getByRole("status")).toContainElement(failed);

      expect(querySentStatus()).not.toBeInTheDocument();
    });

    test('the dialog\'s footer has exactly one button, "Close", and no "Cancel"', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: SERVER_MESSAGE }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));

      const dialog: HTMLElement = await waitForErrorModal();
      const footer: HTMLElement = within(dialog).getByTestId("modal-footer");
      const footerButtons: Array<HTMLElement> =
        within(footer).getAllByRole("button");

      /*
       * The dialog only reports an outcome, so it offers one way out. A
       * "Cancel" beside "Close" would be two buttons doing the same thing.
       */
      expect(footerButtons).toHaveLength(1);
      expect(footerButtons[0]).toHaveTextContent("Close");
      expect(footerButtons[0]).toHaveAttribute(
        "data-testid",
        "modal-footer-submit-button",
      );
      expect(
        within(dialog).queryByTestId("modal-footer-close-button"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/cancel/i)).not.toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    test("re-enables the button after a failure", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: SERVER_MESSAGE }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));
      await waitForErrorModal();

      const button: HTMLElement = getSendButton("Incident War Room");

      expect(button).toBeEnabled();
      expect(getSpinner(button)).toBeNull();
    });

    test("a rejected request opens the same dialog with the friendly error", async () => {
      const networkError: Error = new Error("Network Error");

      apiPost = async (): Promise<PostResult> => {
        throw networkError;
      };

      friendlyErrorMessage = (): string => {
        return "Could not reach OneUptime. Check your connection.";
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
        ERROR_MODAL_TITLE,
      );
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "OneUptime could not send a test notification to #alerts in Slack.",
      );
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Could not reach OneUptime. Check your connection.",
      );

      expect(friendlyErrorMessageArguments[0]).toBe(networkError);

      const failed: HTMLElement = screen.getByTestId(FAILED_TEST_ID);

      expect(failed).toHaveAttribute(
        "title",
        "Could not reach OneUptime. Check your connection.",
      );
      expect(querySentStatus()).not.toBeInTheDocument();
    });

    test("a request that fails before returning a promise is still reported", async () => {
      apiPost = (): Promise<PostResult> => {
        throw new Error("URL is required for static method");
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "URL is required for static method",
      );
      expect(screen.getByTestId(FAILED_TEST_ID)).toBeInTheDocument();
      expect(getSendButton("#alerts")).toBeEnabled();
    });

    test("an HTTPErrorResponse thrown as a rejection is reported like a returned one", async () => {
      const errorResponse: HTTPErrorResponse = new HTTPErrorResponse(
        403,
        {
          message:
            "You do not have permission to send test notifications in this project.",
        },
        {},
      );

      apiPost = async (): Promise<PostResult> => {
        throw errorResponse;
      };

      renderButton(TEAMS_CHANNEL_PROPS);

      await clickSend(getSendButton("General"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "You do not have permission to send test notifications in this project.",
      );
      expect(friendlyErrorMessageArguments[0]).toBe(errorResponse);
    });

    test("a failure that settles later, after the in-flight state, lands in the dialog", async () => {
      renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));
      expect(queryErrorModal()).not.toBeInTheDocument();

      await settle(deferred, {
        resolveWith: new HTTPErrorResponse(
          400,
          { message: "The Slack channel id is not valid." },
          {},
        ),
      });

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "The Slack channel id is not valid.",
      );
    });

    test("still reports a failure when no friendly message can be derived", async () => {
      apiPost = async (): Promise<PostResult> => {
        throw new Error("");
      };

      friendlyErrorMessage = (): string => {
        return "";
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(screen.getByTestId(FAILED_TEST_ID)).toBeInTheDocument();
      // The dialog never shows an empty error banner.
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Could not send the test notification. Please try again.",
      );
    });

    test("does not retry on its own after a failure", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: SERVER_MESSAGE }, {});
      };

      renderButton(TEAMS_CHAT_PROPS);

      await clickSend(getSendButton("Incident War Room"));
      await waitForErrorModal();

      expect(postRequests).toHaveLength(1);
    });
  });

  describe("closing the failure dialog", () => {
    async function closeErrorModal(): Promise<void> {
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(queryErrorModal()).not.toBeInTheDocument();
      });
    }

    test('closing with "Close" leaves a "Failed" status and an enabled button', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(
          400,
          { message: "The Slack channel id is not valid." },
          {},
        );
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await closeErrorModal();

      const failed: HTMLElement = screen.getByTestId(FAILED_TEST_ID);

      expect(failed).toHaveTextContent("Failed");
      // The error survives as the badge's tooltip once the dialog is gone.
      expect(failed).toHaveAttribute(
        "title",
        "The Slack channel id is not valid.",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(querySentStatus()).not.toBeInTheDocument();

      const button: HTMLElement = getSendButton("#alerts");

      expect(button).toBeEnabled();
      expect(getSpinner(button)).toBeNull();

      // Dismissing the dialog is not a retry.
      expect(postRequests).toHaveLength(1);
    });

    test("the dialog stays closed until the next failure", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "First failure." }, {});
      };

      const { rerender } = renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await closeErrorModal();

      /*
       * The card re-renders its rows whenever its own state changes, so the
       * button gets the same props again - once as the very same object, and
       * once with a request body that is equal but freshly built, the way an
       * inline `{ channelId: channel.id }` arrives on every render. Neither
       * may bring the dialog back or clear the badge.
       */
      rerender(<SendTestNotificationButton {...SLACK_PROPS} />);

      await act(async (): Promise<void> => {
        await Promise.resolve();
      });

      expect(queryErrorModal()).not.toBeInTheDocument();
      expect(screen.getByTestId(FAILED_TEST_ID)).toHaveAttribute(
        "title",
        "First failure.",
      );

      const equalButNewRequestBody: JSONObject = { channelId: "C0123ALERTS" };

      expect(equalButNewRequestBody).not.toBe(SLACK_PROPS.requestBody);
      expect(equalButNewRequestBody).toEqual(SLACK_PROPS.requestBody);

      rerender(
        <SendTestNotificationButton
          {...SLACK_PROPS}
          requestBody={equalButNewRequestBody}
        />,
      );

      await act(async (): Promise<void> => {
        await Promise.resolve();
      });

      expect(queryErrorModal()).not.toBeInTheDocument();
      expect(screen.getByTestId(FAILED_TEST_ID)).toHaveAttribute(
        "title",
        "First failure.",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(getSendButton("#alerts")).toBeEnabled();

      // Re-rendering never sends anything on its own.
      expect(postRequests).toHaveLength(1);

      // The next failure opens it again, with its own error.
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Second failure." }, {});
      };

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Second failure.",
      );
      expect(postRequests).toHaveLength(2);
      expect(postRequests[1]!.data).toEqual({ channelId: "C0123ALERTS" });
    });
  });

  describe("retrying", () => {
    test('a retry that succeeds shows "Sent" and drops the "Failed" status', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(
          400,
          { message: "The Slack channel id is not valid." },
          {},
        );
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(queryErrorModal()).not.toBeInTheDocument();
      });

      expect(screen.getByTestId(FAILED_TEST_ID)).toBeInTheDocument();

      apiPost = defaultApiPost;

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(queryFailedStatus()).not.toBeInTheDocument();
      expect(queryErrorModal()).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getAllByRole("status")).toHaveLength(1);

      expect(postRequests).toHaveLength(2);
      expect(postRequests[1]!.data).toEqual(postRequests[0]!.data);
      expect(postRequests[1]!.url.toString()).toBe(
        postRequests[0]!.url.toString(),
      );
    });

    test('the old "Failed" status and error clear as soon as the retry starts', async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "First failure." }, {});
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(queryErrorModal()).not.toBeInTheDocument();
      });

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      expect(queryFailedStatus()).not.toBeInTheDocument();
      expect(querySentStatus()).not.toBeInTheDocument();
      expect(screen.queryByText("First failure.")).not.toBeInTheDocument();
      expect(getSendButton("#alerts")).toBeDisabled();

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();
    });

    test('a retry after success clears "Sent" while in flight and reports a new failure', async () => {
      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      expect(querySentStatus()).not.toBeInTheDocument();
      expect(getSendButton("#alerts")).toBeDisabled();

      await settle(deferred, {
        resolveWith: new HTTPErrorResponse(
          400,
          { message: "The bot was removed from the channel." },
          {},
        ),
      });

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "The bot was removed from the channel.",
      );
      expect(screen.getByTestId(FAILED_TEST_ID)).toBeInTheDocument();
      expect(querySentStatus()).not.toBeInTheDocument();
      expect(postRequests).toHaveLength(2);
    });

    test("a second failure shows only the new error", async () => {
      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "First failure." }, {});
      };

      renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(queryErrorModal()).not.toBeInTheDocument();
      });

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Second failure." }, {});
      };

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Second failure.",
      );
      expect(screen.queryByText("First failure.")).not.toBeInTheDocument();
      expect(screen.getByTestId(FAILED_TEST_ID)).toHaveAttribute(
        "title",
        "Second failure.",
      );
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    test("many sequential sends each post exactly once", async () => {
      renderButton(TEAMS_CHANNEL_PROPS);

      for (let i: number = 1; i <= 3; i++) {
        await clickSend(getSendButton("General"));
        await waitForSent();
        expect(postRequests).toHaveLength(i);
      }
    });
  });

  describe("several buttons on one page", () => {
    const ALERTS_PROPS: ComponentProps = SLACK_PROPS;
    const OPS_PROPS: ComponentProps = {
      route: "/slack/channels/test",
      requestBody: { channelId: "C0456OPS" },
      destinationName: "#ops",
      workspaceName: "Slack",
    };

    function renderTwoRows(): { alertsRow: HTMLElement; opsRow: HTMLElement } {
      render(
        <ul>
          <li data-testid="row-alerts">
            <span>#alerts</span>
            <SendTestNotificationButton {...ALERTS_PROPS} />
          </li>
          <li data-testid="row-ops">
            <span>#ops</span>
            <SendTestNotificationButton {...OPS_PROPS} />
          </li>
        </ul>,
      );

      return {
        alertsRow: screen.getByTestId("row-alerts"),
        opsRow: screen.getByTestId("row-ops"),
      };
    }

    test("each row posts its own destination", async () => {
      renderTwoRows();

      await clickSend(getSendButton("#ops"));
      await waitFor(() => {
        expect(postRequests).toHaveLength(1);
      });

      expect(postRequests[0]!.data).toEqual({ channelId: "C0456OPS" });
    });

    test("a success on one row leaves the other untouched", async () => {
      const { alertsRow, opsRow } = renderTwoRows();

      await clickSend(getSendButton("#alerts"));
      await waitForSent(alertsRow);

      expect(postRequests).toHaveLength(1);
      expect(postRequests[0]!.data).toEqual({ channelId: "C0123ALERTS" });

      expect(querySentStatus(alertsRow)).toBeInTheDocument();
      expect(querySentStatus(opsRow)).not.toBeInTheDocument();
      expect(queryFailedStatus(opsRow)).not.toBeInTheDocument();
      expect(getSendButton("#ops")).toBeEnabled();
    });

    test("a failure on one row does not disturb the other row's success", async () => {
      const { alertsRow, opsRow } = renderTwoRows();

      await clickSend(getSendButton("#alerts"));
      await waitForSent(alertsRow);

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(
          400,
          { message: "OneUptime is not in #ops." },
          {},
        );
      };

      await clickSend(getSendButton("#ops"));

      const dialog: HTMLElement = await waitForErrorModal();

      // The dialog names the row that failed, not its neighbour.
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "OneUptime could not send a test notification to #ops in Slack.",
      );

      expect(queryFailedStatus(opsRow)).toBeInTheDocument();
      expect(querySentStatus(opsRow)).not.toBeInTheDocument();

      expect(querySentStatus(alertsRow)).toBeInTheDocument();
      expect(queryFailedStatus(alertsRow)).not.toBeInTheDocument();

      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    test("a send in flight on one row does not disable the other", async () => {
      const { alertsRow, opsRow } = renderTwoRows();

      const alertsDeferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      expect(getSendButton("#alerts")).toBeDisabled();
      expect(getSendButton("#ops")).toBeEnabled();
      expect(getSpinner(getSendButton("#ops"))).toBeNull();

      const opsDeferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#ops"));

      expect(postRequests).toHaveLength(2);
      expect(postRequests[0]!.data).toEqual({ channelId: "C0123ALERTS" });
      expect(postRequests[1]!.data).toEqual({ channelId: "C0456OPS" });

      // Settle them out of order: ops first, then alerts.
      await settle(opsDeferred, { resolveWith: successResponse() });
      await waitForSent(opsRow);

      expect(getSendButton("#alerts")).toBeDisabled();
      expect(querySentStatus(alertsRow)).not.toBeInTheDocument();

      await settle(alertsDeferred, { resolveWith: successResponse() });
      await waitForSent(alertsRow);

      expect(getSendButton("#alerts")).toBeEnabled();
      expect(getSendButton("#ops")).toBeEnabled();
    });

    test("closing one row's dialog keeps that row's Failed status and nothing else changes", async () => {
      const { alertsRow, opsRow } = renderTwoRows();

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Nope." }, {});
      };

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(queryErrorModal()).not.toBeInTheDocument();
      });

      expect(queryFailedStatus(alertsRow)).toBeInTheDocument();
      expect(queryFailedStatus(opsRow)).not.toBeInTheDocument();
      expect(querySentStatus(opsRow)).not.toBeInTheDocument();
    });
  });

  describe("changing props", () => {
    test("the next click posts the new request body and route", async () => {
      const { rerender } = renderButton(TEAMS_CHANNEL_PROPS);

      await clickSend(getSendButton("General"));
      await waitForSent();

      const nextProps: ComponentProps = {
        ...TEAMS_CHANNEL_PROPS,
        requestBody: {
          teamId: "e5f6-team-support",
          channelId: "19:escalations@thread.tacv2",
        },
        destinationName: "Escalations",
      };

      rerender(<SendTestNotificationButton {...nextProps} />);

      await clickSend(getSendButton("Escalations"));

      await waitFor(() => {
        expect(postRequests).toHaveLength(2);
      });

      expect(postRequests[0]!.data).toEqual({
        teamId: "a1b2c3d4-team-platform",
        channelId: "19:general-thread@thread.tacv2",
      });
      expect(postRequests[1]!.data).toEqual({
        teamId: "e5f6-team-support",
        channelId: "19:escalations@thread.tacv2",
      });

      await waitForSent();
    });

    test("a new route is used from the next click on", async () => {
      const { rerender } = renderButton(SLACK_PROPS);

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      rerender(<SendTestNotificationButton {...TEAMS_CHAT_PROPS} />);

      await clickSend(getSendButton("Incident War Room"));
      await waitForSent();

      expect(postRequests).toHaveLength(2);
      expect(
        postRequests[0]!.url.toString().endsWith("/slack/channels/test"),
      ).toBe(true);
      expect(
        postRequests[1]!.url.toString().endsWith("/microsoft-teams/chats/test"),
      ).toBe(true);
      expect(postRequests[1]!.data).toEqual({
        chatId: "19:groupchat-war-room@thread.v2",
      });
    });

    test("the accessible name follows the destination name", () => {
      const { rerender } = renderButton(SLACK_PROPS);

      expect(getSendButton("#alerts")).toBeInTheDocument();

      rerender(
        <SendTestNotificationButton
          {...SLACK_PROPS}
          destinationName="#renamed"
        />,
      );

      expect(getSendButton("#renamed")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "Send test notification to #alerts",
        }),
      ).not.toBeInTheDocument();
    });

    test("a request already in flight keeps the body it was sent with", async () => {
      const { rerender } = renderButton(SLACK_PROPS);

      const deferred: Deferred<PostResult> = holdNextPosts();

      await clickSend(getSendButton("#alerts"));

      rerender(
        <SendTestNotificationButton
          {...SLACK_PROPS}
          requestBody={{ channelId: "C0999OTHER" }}
          destinationName="#other"
        />,
      );

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
      expect(postRequests[0]!.data).toEqual({ channelId: "C0123ALERTS" });
    });

    test("the failure dialog names the destination the row shows now", async () => {
      const { rerender } = renderButton(SLACK_PROPS);

      rerender(
        <SendTestNotificationButton
          {...SLACK_PROPS}
          requestBody={{ channelId: "C0777INC" }}
          destinationName="#incidents"
        />,
      );

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Nope." }, {});
      };

      await clickSend(getSendButton("#incidents"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "OneUptime could not send a test notification to #incidents in Slack.",
      );
      expect(postRequests[0]!.data).toEqual({ channelId: "C0777INC" });
    });
  });

  describe("reporting sends in flight (onSendingChange)", () => {
    /*
     * The cards count sends in flight through this callback and lock
     * Refresh (and the Teams team picker) while the count is above zero, so
     * every send has to report exactly one true when it starts and exactly
     * one false when it settles - an unmatched true would lock the card for
     * good, an extra false would unlock it while a send is still out.
     */
    let sendingChanges: Array<boolean> = [];

    const recordSendingChange: (isSending: boolean) => void = (
      isSending: boolean,
    ): void => {
      sendingChanges.push(isSending);
    };

    const withSendingChange: (props: ComponentProps) => ComponentProps = (
      props: ComponentProps,
    ): ComponentProps => {
      return { ...props, onSendingChange: recordSendingChange };
    };

    beforeEach(() => {
      sendingChanges = [];
    });

    test("reports nothing on mount", () => {
      renderButton(withSendingChange(SLACK_PROPS));

      expect(sendingChanges).toEqual([]);
    });

    test.each([
      [
        "succeeds",
        { resolveWith: successResponse() },
        (): Promise<void> => {
          return waitForSent();
        },
      ],
      [
        "comes back as an HTTPErrorResponse",
        {
          resolveWith: new HTTPErrorResponse(400, { message: "Nope." }, {}),
        },
        async (): Promise<void> => {
          await waitForErrorModal();
        },
      ],
      [
        "is rejected with an error",
        { rejectWith: new Error("Network Error") },
        async (): Promise<void> => {
          await waitForErrorModal();
        },
      ],
      [
        "is rejected with an HTTPErrorResponse",
        {
          rejectWith: new HTTPErrorResponse(403, { message: "Denied." }, {}),
        },
        async (): Promise<void> => {
          await waitForErrorModal();
        },
      ],
    ])(
      "a send that %s reports true when it starts and false once it settles",
      async (
        _label: string,
        outcome: { resolveWith: PostResult } | { rejectWith: unknown },
        waitForResult: () => Promise<void>,
      ) => {
        renderButton(withSendingChange(SLACK_PROPS));

        const deferred: Deferred<PostResult> = holdNextPosts();

        await clickSend(getSendButton("#alerts"));

        // Started, not yet settled.
        expect(postRequests).toHaveLength(1);
        expect(sendingChanges).toEqual([true]);

        await settle(deferred, outcome);
        await waitForResult();

        expect(sendingChanges).toEqual([true, false]);
      },
    );

    test("a request that fails before returning a promise still reports true then false", async () => {
      apiPost = (): Promise<PostResult> => {
        throw new Error("URL is required for static method");
      };

      renderButton(withSendingChange(SLACK_PROPS));

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      expect(sendingChanges).toEqual([true, false]);
    });

    test("two clicks in the same frame while in flight still report one true and one false", async () => {
      renderButton(withSendingChange(SLACK_PROPS));

      const deferred: Deferred<PostResult> = holdNextPosts();
      const button: HTMLElement = getSendButton("#alerts");

      /*
       * Both clicks land before the disabled state renders; the second is
       * dropped by the in-flight guard, and a dropped click must not report
       * anything either.
       */
      act(() => {
        button.click();
        button.click();
      });

      expect(postRequests).toHaveLength(1);
      expect(sendingChanges).toEqual([true]);

      // A later click on the now-disabled button reports nothing as well.
      await clickSend(getSendButton("#alerts"));

      expect(postRequests).toHaveLength(1);
      expect(sendingChanges).toEqual([true]);

      await settle(deferred, { resolveWith: successResponse() });
      await waitForSent();

      expect(postRequests).toHaveLength(1);
      expect(sendingChanges).toEqual([true, false]);
    });

    test("each send reports its own pair, in order", async () => {
      renderButton(withSendingChange(SLACK_PROPS));

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      expect(sendingChanges).toEqual([true, false]);

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Nope." }, {});
      };

      await clickSend(getSendButton("#alerts"));
      await waitForErrorModal();

      expect(sendingChanges).toEqual([true, false, true, false]);
    });

    test("sending works the same when no onSendingChange is passed", async () => {
      renderButton(SLACK_PROPS);

      expect(SLACK_PROPS.onSendingChange).toBeUndefined();

      await clickSend(getSendButton("#alerts"));
      await waitForSent();

      apiPost = async (): Promise<PostResult> => {
        return new HTTPErrorResponse(400, { message: "Nope." }, {});
      };

      await clickSend(getSendButton("#alerts"));

      const dialog: HTMLElement = await waitForErrorModal();

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Nope.");
      expect(screen.getByTestId(FAILED_TEST_ID)).toBeInTheDocument();
      expect(getSendButton("#alerts")).toBeEnabled();
      expect(postRequests).toHaveLength(2);
    });
  });

  describe("unmounting mid-request", () => {
    /*
     * A card reload (Refresh, or a team switch in the Teams channels card)
     * unmounts its rows. A send still in flight then has no row to report
     * to, but its parent still has to hear that it settled, or the card's
     * count of sends in flight would never come back down.
     */
    test.each([
      ["succeeds", { resolveWith: successResponse() }],
      [
        "fails",
        {
          resolveWith: new HTTPErrorResponse(400, { message: "Late." }, {}),
        },
      ],
      ["rejects", { rejectWith: new Error("Late network error.") }],
    ])(
      "a request that %s after the row is gone still reports onSendingChange(false)",
      async (
        _label: string,
        outcome: { resolveWith: PostResult } | { rejectWith: unknown },
      ) => {
        const sendingChanges: Array<boolean> = [];

        const { unmount } = renderButton({
          ...SLACK_PROPS,
          onSendingChange: (isSending: boolean): void => {
            sendingChanges.push(isSending);
          },
        });

        const deferred: Deferred<PostResult> = holdNextPosts();

        await clickSend(getSendButton("#alerts"));

        expect(sendingChanges).toEqual([true]);

        unmount();

        // Unmounting alone does not settle the send.
        expect(sendingChanges).toEqual([true]);

        await settle(deferred, outcome);

        await waitFor(() => {
          expect(sendingChanges).toEqual([true, false]);
        });

        // Nothing is left on screen to show the late result.
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(postRequests).toHaveLength(1);
      },
    );
  });
});
