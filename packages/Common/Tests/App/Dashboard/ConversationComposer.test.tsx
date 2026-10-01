import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ConversationComposer, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/ConversationComposer";
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";

/*
 * Where a responder types to OneUptime AI at the foot of the AI
 * Investigation card. It is one control: the text, what the AI may do with
 * the request (and what that means, beside the choice), and Send. The card
 * used to borrow the Ask AI panel's composer, with the mode picker, its
 * sentence and two hints in three rows under the box.
 */

interface HarnessProps extends Partial<ComponentProps> {
  initialValue?: string;
  initialMode?: AIChatPermissionMode;
}

// Holds the text and the mode, the way the conversation does.
const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [value, setValue] = React.useState<string>(props.initialValue || "");
  const [mode, setMode] = React.useState<AIChatPermissionMode>(
    props.initialMode || AIChatPermissionMode.AutoRun,
  );

  return (
    <ConversationComposer
      value={value}
      onChange={(next: string) => {
        setValue(next);
        props.onChange?.(next);
      }}
      onSend={props.onSend || (() => {})}
      canSend={props.canSend ?? true}
      isWorking={props.isWorking ?? false}
      onStop={props.onStop}
      isStopping={props.isStopping}
      placeholder={props.placeholder || "Ask about this incident…"}
      label={props.label || "Ask OneUptime AI"}
      permissionMode={mode}
      onPermissionModeChange={(next: AIChatPermissionMode) => {
        setMode(next);
        props.onPermissionModeChange?.(next);
      }}
    />
  );
};

function box(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function send(): HTMLElement {
  return screen.getByTitle("Send (Enter)");
}

function frame(): HTMLElement {
  return screen.getByTestId("investigation-conversation-composer")
    .firstElementChild as HTMLElement;
}

function type(text: string): void {
  fireEvent.change(box(), { target: { value: text } });
}

let scrollHeight: number = 0;

beforeEach(() => {
  scrollHeight = 0;
  // jsdom lays nothing out: stand in for the height the text would need.
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get: (): number => {
      return scrollHeight;
    },
  });
});

afterEach(() => {
  cleanup();
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number })
    .scrollHeight;
});

describe("ConversationComposer — sending", () => {
  test("Enter sends what was typed", () => {
    const onSend: MockFunction = getJestMockFunction();
    render(<Harness onSend={onSend} />);

    type("What changed?");
    fireEvent.keyDown(box(), { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("the Send button sends too", () => {
    const onSend: MockFunction = getJestMockFunction();
    render(<Harness onSend={onSend} />);

    type("What changed?");
    fireEvent.click(send());

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("Shift+Enter is a new line, never a send", () => {
    const onSend: MockFunction = getJestMockFunction();
    render(<Harness onSend={onSend} />);

    type("line one");
    const allowed: boolean = fireEvent.keyDown(box(), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSend).not.toHaveBeenCalled();
    // Left to the browser, which inserts the line break.
    expect(allowed).toBe(true);
  });

  test("Enter is swallowed so it does not also add a line break", () => {
    render(<Harness />);

    type("What changed?");

    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
  });

  test.each([[""], ["   "], ["\n\n"], ["\t "]])(
    "an empty or blank box (%j) never sends",
    (text: string) => {
      const onSend: MockFunction = getJestMockFunction();
      render(<Harness onSend={onSend} />);

      type(text);
      fireEvent.keyDown(box(), { key: "Enter" });
      fireEvent.click(send());

      expect(send()).toBeDisabled();
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  test("other keys do nothing but type", () => {
    const onSend: MockFunction = getJestMockFunction();
    render(<Harness onSend={onSend} />);

    type("What changed?");
    for (const key of ["a", "Tab", "Escape", " ", "ArrowUp"]) {
      fireEvent.keyDown(box(), { key });
    }

    expect(onSend).not.toHaveBeenCalled();
  });

  test("keeps the caret in the box after a send, so the next question flows", () => {
    render(<Harness />);

    type("What changed?");
    fireEvent.click(send());

    expect(document.activeElement).toBe(box());
  });

  test("lights Send in the page's primary colour once there is something to send", () => {
    render(<Harness />);

    expect(send()).toBeDisabled();
    expect(send()).toHaveClass("bg-gray-100", "text-gray-400");
    expect(send()).not.toHaveClass("bg-indigo-600");

    type("What changed?");

    expect(send()).toBeEnabled();
    expect(send()).toHaveClass("bg-indigo-600", "text-white");
    expect(send()).not.toHaveClass("bg-gray-100");
  });
});

describe("ConversationComposer — while an answer is being written", () => {
  test("typing is never blocked, sending is", () => {
    const onSend: MockFunction = getJestMockFunction();
    const onChange: MockFunction = getJestMockFunction();
    render(
      <Harness
        onSend={onSend}
        onChange={onChange}
        canSend={false}
        isWorking={true}
      />,
    );

    type("And the node?");
    fireEvent.keyDown(box(), { key: "Enter" });
    fireEvent.click(send());

    expect(box()).toBeEnabled();
    expect(onChange).toHaveBeenCalledWith("And the node?");
    expect(box().value).toBe("And the node?");
    expect(send()).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Send becomes Stop when the answer can be stopped", () => {
    const onStop: MockFunction = getJestMockFunction();
    render(<Harness isWorking={true} canSend={false} onStop={onStop} />);

    expect(screen.queryByTitle("Send (Enter)")).toBeNull();

    const stop: HTMLElement = screen.getByTitle("Stop generating");
    fireEvent.click(stop);

    expect(onStop).toHaveBeenCalledTimes(1);
    // A dark button with a square in it: unmistakably not Send.
    expect(stop).toHaveClass("bg-gray-900", "text-white");
    expect(stop.querySelector(".rounded-\\[2px\\]")).toHaveClass("bg-current");
  });

  test("Stop is locked, with a spinner, while the stop is on its way", () => {
    const onStop: MockFunction = getJestMockFunction();
    render(
      <Harness
        isWorking={true}
        canSend={false}
        onStop={onStop}
        isStopping={true}
      />,
    );

    const stop: HTMLElement = screen.getByTitle("Stop generating");
    fireEvent.click(stop);

    expect(stop).toBeDisabled();
    expect(onStop).not.toHaveBeenCalled();
    expect(stop.querySelector(".motion-safe\\:animate-spin")).not.toBeNull();
  });

  test("a send that is on its way shows a spinner in Send, not Stop", () => {
    // Working with nothing to stop yet: the question is still being sent.
    render(<Harness isWorking={true} canSend={false} initialValue="Hi" />);

    expect(screen.queryByTitle("Stop generating")).toBeNull();
    expect(send()).toBeDisabled();
    expect(send().querySelector(".motion-safe\\:animate-spin")).not.toBeNull();
    expect(send().querySelector("svg")).toBeNull();
  });

  test("an idle composer offers Send even when a stop handler is supplied", () => {
    render(<Harness isWorking={false} onStop={() => {}} />);

    expect(screen.queryByTitle("Stop generating")).toBeNull();
    expect(send()).toBeInTheDocument();
  });
});

describe("ConversationComposer — on the page", () => {
  test("never takes focus when it appears", () => {
    render(<Harness />);

    // Loading an incident must not jump to the bottom of the AI card.
    expect(document.activeElement).not.toBe(box());
    expect(box()).not.toHaveAttribute("autofocus");
  });

  test("the text box is named and says what it is for", () => {
    render(
      <Harness
        label="Ask OneUptime AI"
        placeholder="Ask about this alert, or ask OneUptime AI to act…"
      />,
    );

    expect(box()).toHaveAccessibleName("Ask OneUptime AI");
    expect(box()).toHaveAttribute(
      "placeholder",
      "Ask about this alert, or ask OneUptime AI to act…",
    );
    expect(box()).toHaveAttribute("rows", "1");
  });

  test("grows with its text and stops at six lines", () => {
    render(<Harness />);

    scrollHeight = 72;
    type("one\ntwo\nthree");
    expect(box().style.height).toBe("72px");

    scrollHeight = 400;
    type("a very long question\n".repeat(20));
    expect(box().style.height).toBe("160px");

    // And shrinks back when the text is sent or deleted.
    scrollHeight = 24;
    type("short");
    expect(box().style.height).toBe("24px");
  });

  test("is framed like the dashboard's other inputs, with an indigo focus", () => {
    render(<Harness />);

    expect(frame()).toHaveClass(
      "rounded-xl",
      "border",
      "border-gray-300",
      "bg-white",
      "focus-within:border-indigo-500",
      "focus-within:ring-1",
      "focus-within:ring-indigo-500",
    );
    // The text box draws no frame of its own: the frame is the control.
    expect(box()).toHaveClass("border-0", "bg-transparent", "focus:ring-0");
    expect(frame()).toContainElement(box());
    expect(frame()).toContainElement(send());
  });

  test("says how to send and how to break a line, but not on a phone", () => {
    render(<Harness />);

    const hint: HTMLElement = screen.getByText(/to send/);

    expect(hint).toHaveTextContent(
      "Enter to send · Shift + Enter for a new line",
    );
    expect(hint).toHaveClass("max-sm:hidden");
    // Under the frame, not inside it.
    expect(frame()).not.toContainElement(hint);
  });
});

describe("ConversationComposer — what OneUptime AI may do", () => {
  test("the mode, and what it means, sit inside the box beside Send", () => {
    render(<Harness />);

    const picker: HTMLElement = screen.getByTitle(
      "Choose what the AI is allowed to do",
    );
    const caption: HTMLElement = screen.getByTestId(
      "investigation-conversation-mode",
    );

    expect(frame()).toContainElement(picker);
    expect(frame()).toContainElement(caption);
    expect(picker).toHaveTextContent("Auto-run");
    expect(caption).toHaveTextContent(
      "Acts on clear requests right away, within your permissions.",
    );
    // One row: picker, caption, Send.
    expect(picker.parentElement!.parentElement).toBe(caption.parentElement);
    expect(caption.parentElement).toContainElement(send());
  });

  test.each([
    [
      "Read-only",
      AIChatPermissionMode.ReadOnly,
      "Only reads and answers. It never changes anything.",
    ],
    [
      "Ask for approval",
      AIChatPermissionMode.AskForApproval,
      "Asks for approval before it changes anything.",
    ],
  ])(
    "choosing %s calls back and changes the caption",
    (option: string, mode: AIChatPermissionMode, caption: string) => {
      const onPermissionModeChange: MockFunction = getJestMockFunction();
      render(<Harness onPermissionModeChange={onPermissionModeChange} />);

      fireEvent.click(screen.getByTitle("Choose what the AI is allowed to do"));
      fireEvent.click(
        within(screen.getByRole("menu")).getByText(option, { exact: false }),
      );

      expect(onPermissionModeChange).toHaveBeenCalledWith(mode);
      expect(
        screen.getByTestId("investigation-conversation-mode"),
      ).toHaveTextContent(caption);
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );

  test("the menu opens from the picker's left edge, inside the card", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTitle("Choose what the AI is allowed to do"));

    /*
     * The picker is the first thing in the box. Lined up on its right edge,
     * the 18rem menu opened some 150px past the card's left edge.
     */
    expect(screen.getByRole("menu")).toHaveClass("left-0");
    expect(screen.getByRole("menu")).not.toHaveClass("right-0");
  });

  test("on a phone the caption takes the row under the picker and Send", () => {
    render(<Harness />);

    const caption: HTMLElement = screen.getByTestId(
      "investigation-conversation-mode",
    );

    // Last and full width below sm; in line, taking what is left, from sm up.
    expect(caption).toHaveClass(
      "order-last",
      "basis-full",
      "sm:order-none",
      "sm:flex-1",
      "sm:basis-0",
      "sm:min-w-0",
    );
    expect(caption.parentElement).toHaveClass("flex", "flex-wrap");
    // Send keeps to the right end of the picker's row.
    expect(send().parentElement).toHaveClass("ml-auto", "flex-shrink-0");
  });

  test("a remembered mode is what the composer opens with", () => {
    render(<Harness initialMode={AIChatPermissionMode.ReadOnly} />);

    expect(
      screen.getByTitle("Choose what the AI is allowed to do"),
    ).toHaveTextContent("Read-only");
    expect(
      screen.getByTestId("investigation-conversation-mode"),
    ).toHaveTextContent("Only reads and answers. It never changes anything.");
  });
});
