import "@testing-library/jest-dom";
import Toast from "../../../UI/Utils/Toast";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A CHAT TOOL'S SEND TEST THAT DID NOT GO OUT SAYS SO (#7272).
 *
 * Slack's, Microsoft Teams' and Mattermost's Send Test answer a message that
 * was not sent with ok false and the reason, on a successful request. Each
 * page read only the reason and said it in a green "sent" toast: a person
 * whose Teams app was not installed read "Test message sent"'s corner,
 * with the failure's words in it, and went on believing pages would reach
 * them. A failure is said in the page's "Test message not sent" dialog,
 * and only a test that went out in the corner (ChatTestAnswer).
 */

const postMock: MockFunction = getJestMockFunction();

type ModelTableProps = Record<string, any>;

const tableProps: Map<string, ModelTableProps> = new Map();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, any>): ReactElement => {
      tableProps.set(props["id"] as string, props);
      return <div data-testid={`table-${props["id"] as string}`} />;
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          (error as { message?: string } | undefined)?.message ||
          "The server ran into a problem it could not explain, so this did not finish. Try again in a moment."
        );
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

import SlackMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack";
import MicrosoftTeamsMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams";
import MattermostMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Mattermost";
import {
  ChatTestAnswer,
  readChatTestAnswer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ChatTestAnswer";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { UNEXPLAINED_ERROR_MESSAGES } from "../../../Types/Exception/UnexplainedError";
import { JSONObject } from "../../../Types/JSON";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ITEM_ID: string = "11111111-7777-4777-8777-777777777777";

interface ChatPage {
  name: string;
  Component: () => ReactElement;
  tableId: string;
  sent: string;
}

const CHAT_PAGES: Array<ChatPage> = [
  {
    name: "Slack",
    Component: SlackMethods,
    tableId: "user-slack",
    sent: "Test message sent. Check your Slack direct messages.",
  },
  {
    name: "Microsoft Teams",
    Component: MicrosoftTeamsMethods,
    tableId: "user-microsoft-teams",
    sent: "Test message sent. Check your Microsoft Teams chats.",
  },
  {
    name: "Mattermost",
    Component: MattermostMethods,
    tableId: "user-mattermost",
    sent: "Test message sent. Check your Mattermost direct messages.",
  },
];

const REASON: string =
  "To receive direct messages, install the OneUptime app in Microsoft Teams, then send the test again.";

let answer: JSONObject;

const sendTest: (page: ChatPage) => Promise<void> = async (
  page: ChatPage,
): Promise<void> => {
  const props: ModelTableProps | undefined = tableProps.get(page.tableId);

  if (!props) {
    throw new Error(`${page.name} drew no table`);
  }

  const sendButton: Record<string, any> = (
    props["actionButtons"] as Array<Record<string, any>>
  ).find((button: Record<string, any>): boolean => {
    return button["title"] === "Send Test Message";
  }) as Record<string, any>;

  await act(async (): Promise<void> => {
    await sendButton["onClick"](
      { _id: ITEM_ID },
      (): void => {},
      (): void => {},
    );
  });
};

beforeEach(() => {
  localStorage.setItem("user_id", USER_ID);
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  tableProps.clear();
  answer = {};

  postMock.mockReset();
  postMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, answer, {}));
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("readChatTestAnswer", () => {
  test("a test that was not sent is not sent, with its reason", () => {
    const answer: ChatTestAnswer = readChatTestAnswer(
      { ok: false, statusMessage: REASON },
      "Sent.",
    );

    expect(answer).toEqual({ isSent: false, message: REASON, details: null });
  });

  test("a test that was not sent carries the tool's own answer, for the dialog's Details (#7268)", () => {
    expect(
      readChatTestAnswer(
        { ok: false, statusMessage: REASON, otherSystemDetails: "is_archived" },
        "Sent.",
      ),
    ).toEqual({ isSent: false, message: REASON, details: "is_archived" });
  });

  test("a test that was not sent and gave no reason says the server's sentence", () => {
    expect(readChatTestAnswer({ ok: false }, "Sent.")).toEqual({
      isSent: false,
      message: UNEXPLAINED_ERROR_MESSAGES.server,
      details: null,
    });
  });

  test("a test that went out is sent, in the server's words or the page's", () => {
    expect(
      readChatTestAnswer({ ok: true, statusMessage: "On its way." }, "Sent."),
    ).toEqual({ isSent: true, message: "On its way.", details: null });
    expect(readChatTestAnswer({ ok: true }, "Sent.")).toEqual({
      isSent: true,
      message: "Sent.",
      details: null,
    });
    // An older server that never said ok.
    expect(readChatTestAnswer({}, "Sent.")).toEqual({
      isSent: true,
      message: "Sent.",
      details: null,
    });
    expect(readChatTestAnswer(undefined, "Sent.")).toEqual({
      isSent: true,
      message: "Sent.",
      details: null,
    });
  });
});

describe.each(CHAT_PAGES)("$name's Send Test", (page: ChatPage) => {
  test("a test the server could not send opens Test message not sent with its reason, and no toast", async () => {
    const success: ReturnType<typeof jest.spyOn> = jest.spyOn(Toast, "success");

    answer = { ok: false, statusMessage: REASON };

    render(<page.Component />);
    await sendTest(page);

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Test message not sent",
      );
    });

    expect(document.body.textContent).toContain(REASON);
    expect(success).not.toHaveBeenCalled();
    // No words of the tool's: no Details to open.
    expect(screen.queryByTestId("other-system-details-toggle")).toBeNull();
  });

  test("the tool's own answer is folded under Details, under the reason, and opens as it was given (#7268)", async () => {
    answer = {
      ok: false,
      statusMessage: REASON,
      otherSystemDetails: "is_archived",
    };

    render(<page.Component />);
    await sendTest(page);

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Test message not sent",
      );
    });

    expect(
      screen.getByTestId("confirm-modal-description"),
    ).toHaveTextContent(REASON);
    expect(
      screen.getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("is_archived");

    const toggle: HTMLElement = screen.getByTestId(
      "other-system-details-toggle",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(
      screen.getByTestId("other-system-details-words").textContent,
    ).toBe("is_archived");
  });

  test("a test that went out is said in the corner, with no dialog", async () => {
    const success: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Toast, "success")
      .mockImplementation((): string => {
        return "toast";
      });

    answer = { ok: true, statusMessage: page.sent };

    render(<page.Component />);
    await sendTest(page);

    await waitFor(() => {
      expect(success).toHaveBeenCalledWith(page.sent);
    });

    expect(screen.queryByTestId("modal-title")).toBeNull();
  });
});
