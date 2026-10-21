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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";

/*
 * Copy under an answer in AI chat (the Dashboard's Ask AI). It called
 * navigator.clipboard.writeText directly: on a page served over plain http
 * - a self-hosted install reached by a LAN hostname - the browser has no
 * clipboard API and the click threw, and a refused write said nothing
 * (issue #5132). It copies through the shared helper now, says Copied only
 * once the answer is on the clipboard, and Copy failed when it is not.
 *
 * The answer's own parts (markdown, widgets, approvals, citations) are
 * stubbed: what is under test is the Copy beneath them.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/SafeChatMarkdown",
  () => {
    return {
      __esModule: true,
      default: (props: { text: string }): React.ReactElement => {
        const react: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return react.createElement("p", null, props.text);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationChips",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ChatMessageList from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatMessageList";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import ObjectID from "../../../Types/ObjectID";

const FIRST_ID: string = "11111111-1111-4111-8111-111111111111";
const SECOND_ID: string = "22222222-2222-4222-8222-222222222222";

function answer(id: string, content: string): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage();
  message.id = new ObjectID(id);
  message.role = AIChatMessageRole.Assistant;
  message.status = AIChatMessageStatus.Completed;
  message.contentInMarkdown = content;
  message.createdAt = new Date("2026-10-20T10:00:00.000Z");
  return message;
}

function renderAnswers(): void {
  render(
    <ChatMessageList
      messages={[
        answer(FIRST_ID, "The API is slow because of the database."),
        answer(SECOND_ID, "Restart the worker."),
      ]}
      isSubmittingApproval={false}
      onRespondToApproval={(): void => {}}
    />,
  );
}

function copyButtons(): Array<HTMLElement> {
  return screen.getAllByTestId("ai-chat-copy-answer");
}

async function pressCopy(index: number): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButtons()[index]!);
  });
}

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

function installExecCommand(
  execCommand: ((command: string) => boolean) | undefined,
): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("AI chat - copying an answer", () => {
  test("copies the answer's markdown, and only that answer says Copied, for a moment", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    renderAnswers();

    await pressCopy(0);

    expect(writeText).toHaveBeenCalledWith(
      "The API is slow because of the database.",
    );
    expect(copyButtons()[0]).toHaveTextContent("Copied");
    expect(copyButtons()[0]).toHaveAttribute("data-copy-state", "copied");
    expect(copyButtons()[1]).toHaveTextContent("Copy");
    expect(copyButtons()[1]).not.toHaveTextContent("Copied");

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(copyButtons()[0]).not.toHaveTextContent("Copied");
  });

  test("the bug: with no clipboard API the click no longer throws, and says Copy failed", async () => {
    installClipboard(undefined);

    const errors: Array<unknown> = [];
    const onError: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
      errors.push(event.error);
    };
    window.addEventListener("error", onError);

    renderAnswers();
    await pressCopy(1);

    window.removeEventListener("error", onError);

    expect(errors).toEqual([]);
    expect(copyButtons()[1]).toHaveTextContent("Copy failed");
    expect(copyButtons()[1]).toHaveAttribute("data-copy-state", "failed");
    expect(copyButtons()[0]).not.toHaveTextContent("Copy failed");
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    let copied: string = "";
    installExecCommand((): boolean => {
      copied =
        (
          document.querySelector(
            "textarea[aria-hidden='true']",
          ) as HTMLTextAreaElement | null
        )?.value || "";
      return true;
    });

    renderAnswers();
    await pressCopy(1);

    expect(copied).toBe("Restart the worker.");
    expect(copyButtons()[1]).toHaveTextContent("Copied");
  });

  test("a refused write never says Copied: Copy failed, announced, for four seconds", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );

    renderAnswers();
    await pressCopy(0);

    const said: HTMLElement = copyButtons()[0]!.querySelector(
      "[aria-live='polite']",
    ) as HTMLElement;

    expect(said).toHaveTextContent("Copy failed");
    expect(said).toHaveClass("text-red-600");

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(copyButtons()[0]).toHaveTextContent("Copy");
    expect(copyButtons()[0]).not.toHaveTextContent("Copy failed");
  });
});
