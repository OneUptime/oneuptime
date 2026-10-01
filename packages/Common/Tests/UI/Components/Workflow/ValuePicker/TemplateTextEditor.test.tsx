/*
 * The text box that shows references as chips.
 *
 * What is typed is stored exactly as typed; a reference is one thing (the
 * caret steps over it, Backspace takes it whole, copying copies the
 * reference); and everything the browser cannot be trusted with here - Enter,
 * paste, undo - gives the same result every time.
 *
 * jsdom has no layout, so what only a real browser shows (where a click puts
 * the caret, Firefox's caret around a chip) is covered by the browser suite
 * in packages/E2E/ValuePicker.
 */

import TemplateTextEditor, {
  TemplateTextEditorHandle,
  cleanInsertedText,
  toEditorText,
} from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextEditor";
import {
  ReferenceDescription,
  describeReference,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import { ReferenceTrigger } from "../../../../../UI/Components/Workflow/ValuePicker/TemplateText";
import { readTemplateSelection } from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextDom";
import {
  BODY,
  DEPLOY_ENV,
  chipsIn,
  editorValue,
  keys,
  placeCaret,
} from "./ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement, useLayoutEffect, useRef, useState } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

interface HarnessProps {
  initial: unknown;
  multiline?: boolean;
  onChange?: (value: string) => void;
  onEnter?: () => void;
  onTriggerChange?: (trigger: ReferenceTrigger | null) => void;
  placeholder?: string;
  describe?: (reference: string) => ReferenceDescription | null;
  disabled?: boolean;
  handleRef?: React.MutableRefObject<TemplateTextEditorHandle | null>;
}

// A form around the box, as BasicForm is: it stores what the box reports.
const Harness: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const [value, setValue] = useState<unknown>(props.initial);
  const ownRef: React.MutableRefObject<TemplateTextEditorHandle | null> =
    useRef<TemplateTextEditorHandle | null>(null);

  return (
    <div>
      <TemplateTextEditor
        ref={props.handleRef || ownRef}
        value={value}
        multiline={props.multiline ?? true}
        ariaLabel="Message"
        placeholder={props.placeholder}
        disabled={props.disabled}
        describeReference={
          props.describe ||
          ((reference: string) => {
            return describeReference(reference, {});
          })
        }
        onChange={(next: string) => {
          setValue(next);
          props.onChange?.(next);
        }}
        onEnter={props.onEnter}
        onTriggerChange={props.onTriggerChange}
      />
      <button
        type="button"
        onClick={() => {
          setValue("Set from outside");
        }}
      >
        Load another value
      </button>
    </div>
  );
};

type SetupFunction = (props: HarnessProps) => {
  user: UserEvent;
  editor: HTMLElement;
  onChange: MockFunction;
};

const setup: SetupFunction = (
  props: HarnessProps,
): { user: UserEvent; editor: HTMLElement; onChange: MockFunction } => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <Harness
      {...props}
      onChange={(value: string) => {
        onChange(value);
        props.onChange?.(value);
      }}
    />,
  );

  return {
    user: userEvent.setup({ delay: null }),
    editor: screen.getByRole("textbox", { name: "Message" }),
    onChange: onChange,
  };
};

type LastFunction = (mock: MockFunction) => unknown;

const last: LastFunction = (mock: MockFunction): unknown => {
  const calls: Array<Array<unknown>> = mock.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]?.[0];
};

afterEach(() => {
  cleanup();
});

describe("showing a value", () => {
  test("references are chips that say what they read; text is text", () => {
    const { editor, onChange } = setup({
      initial: `Body: ${BODY} in ${DEPLOY_ENV}`,
    });

    expect(
      chipsIn(editor).map((chip: HTMLElement) => {
        return chip.textContent;
      }),
    ).toEqual(["webhook-1›request-body", "Variable›DEPLOY_ENV"]);
    expect(chipsIn(editor)[0]!.getAttribute("title")).toBe(BODY);
    expect(editorValue(editor)).toBe(`Body: ${BODY} in ${DEPLOY_ENV}`);
    // Showing it is not a change.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("it is a named, multi-line text box", () => {
    const { editor } = setup({ initial: "" });

    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveAttribute("aria-multiline", "true");
    expect(editor).toHaveAttribute("data-multiline", "true");
  });

  test("a one-line box says so", () => {
    const { editor } = setup({ initial: "", multiline: false });

    expect(editor).toHaveAttribute("aria-multiline", "false");
  });

  test("the placeholder shows only while it is empty", async () => {
    const { user, editor } = setup({ initial: "", placeholder: "Say hello" });

    expect(screen.getByText("Say hello")).toBeInTheDocument();
    expect(editor).toHaveAttribute("aria-placeholder", "Say hello");

    placeCaret(editor, 0);
    await user.keyboard("Hi");

    expect(screen.queryByText("Say hello")).toBeNull();
  });

  test("a value that is not a string is shown as text", () => {
    expect(toEditorText(42)).toBe("42");
    expect(toEditorText(true)).toBe("true");
    expect(toEditorText({ a: 1 })).toBe('{"a":1}');
    expect(toEditorText(null)).toBe("");
    expect(toEditorText("a\r\nb")).toBe("a\nb");

    const { editor } = setup({ initial: 42 });

    expect(editorValue(editor)).toBe("42");
  });

  test("a disabled box cannot be edited", () => {
    const { editor } = setup({ initial: "x", disabled: true });

    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(editor).toHaveAttribute("aria-disabled", "true");
  });
});

describe("typing", () => {
  test("what is typed is what is stored, wherever the caret is", async () => {
    const { user, editor, onChange } = setup({ initial: "Hello world" });

    placeCaret(editor, 5);
    await user.keyboard(",");

    expect(last(onChange)).toBe("Hello, world");

    placeCaret(editor, 12);
    await user.keyboard("!");

    expect(last(onChange)).toBe("Hello, world!");
  });

  test("Slack formatting and underscores survive exactly", async () => {
    const { user, editor, onChange } = setup({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(
      keys("_Heads up_: *{{local.variables.service_name}}* is down"),
    );

    expect(last(onChange)).toBe(
      "_Heads up_: *{{local.variables.service_name}}* is down",
    );
  });

  test("typing a reference out in full turns it into a chip", async () => {
    const { user, editor, onChange } = setup({ initial: "Env: " });

    placeCaret(editor, 5);
    await user.keyboard(keys(DEPLOY_ENV));

    expect(last(onChange)).toBe(`Env: ${DEPLOY_ENV}`);
    expect(chipsIn(editor)).toHaveLength(1);

    // And the caret is after it: typing goes on after the chip.
    await user.keyboard(".");
    expect(last(onChange)).toBe(`Env: ${DEPLOY_ENV}.`);
  });

  test("it reads what is typed from the moment it is on the page", () => {
    /*
     * A parent's layout effect runs once the box is on the page, and before
     * any passive effect has run. A box that only started listening in a
     * passive effect missed typing that came then - on a busy page, or in a
     * cell drawn once its form had loaded - and the reference stayed text.
     */
    const onChange: MockFunction = getJestMockFunction();
    let chipsWhenFirstTyped: number = -1;

    const TypesAtOnce: () => ReactElement = (): ReactElement => {
      const holder: React.MutableRefObject<HTMLDivElement | null> =
        useRef<HTMLDivElement | null>(null);

      useLayoutEffect(() => {
        const box: HTMLElement = holder.current!.querySelector<HTMLElement>(
          "[data-template-editor]",
        )!;

        box.textContent = DEPLOY_ENV;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        chipsWhenFirstTyped = chipsIn(box).length;
      }, []);

      return (
        <div ref={holder}>
          <TemplateTextEditor
            value=""
            multiline={false}
            ariaLabel="Message"
            describeReference={(reference: string) => {
              return describeReference(reference, {});
            }}
            onChange={(value: string) => {
              onChange(value);
            }}
          />
        </div>
      );
    };

    render(<TypesAtOnce />);

    expect(chipsWhenFirstTyped).toBe(1);
    expect(last(onChange)).toBe(DEPLOY_ENV);
  });

  test("text next to a chip is typed on the right side of it", async () => {
    const { user, editor, onChange } = setup({ initial: `${BODY}` });

    placeCaret(editor, 0);
    await user.keyboard(">");
    expect(last(onChange)).toBe(`>${BODY}`);

    placeCaret(editor, 1 + BODY.length);
    await user.keyboard("<");
    expect(last(onChange)).toBe(`>${BODY}<`);
  });

  test("typing over a selection with a chip in it replaces all of it", async () => {
    const value: string = `Body: ${BODY} end`;
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, 2, value.length - 2);
    await user.keyboard("X");

    expect(last(onChange)).toBe("BoXnd");
    expect(chipsIn(editor)).toHaveLength(0);
  });
});

describe("Enter", () => {
  test("starts a new line in a multi-line box", async () => {
    const { user, editor, onChange } = setup({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard("Webhook received.{Enter}Environment: staging");

    expect(last(onChange)).toBe("Webhook received.\nEnvironment: staging");
    expect(editor.querySelector("div")).toBeNull();
  });

  test("an empty last line is kept", async () => {
    const { user, editor, onChange } = setup({ initial: "one" });

    placeCaret(editor, 3);
    await user.keyboard("{Enter}");

    expect(last(onChange)).toBe("one\n");
    expect(editorValue(editor)).toBe("one\n");
  });

  test("does nothing in a one-line box, but says it was pressed", async () => {
    const onEnter: MockFunction = getJestMockFunction();
    const { user, editor, onChange } = setup({
      initial: "abc",
      multiline: false,
      onEnter: onEnter,
    });

    placeCaret(editor, 3);
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(editorValue(editor)).toBe("abc");
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});

describe("a chip is one thing", () => {
  const value: string = `Body: ${BODY} end`;
  const chipStart: number = 6;
  const chipEnd: number = 6 + BODY.length;

  test("Backspace right after it removes all of it", async () => {
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, chipEnd);
    await user.keyboard("{Backspace}");

    expect(last(onChange)).toBe("Body:  end");
    expect(chipsIn(editor)).toHaveLength(0);
    expect(readTemplateSelection(editor)).toEqual({ start: 6, end: 6 });
  });

  test("Delete right before it removes all of it", async () => {
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, chipStart);
    await user.keyboard("{Delete}");

    expect(last(onChange)).toBe("Body:  end");
  });

  test("Backspace elsewhere deletes one character", async () => {
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, value.length);
    await user.keyboard("{Backspace}");

    expect(last(onChange)).toBe(`Body: ${BODY} en`);
    expect(chipsIn(editor)).toHaveLength(1);
  });

  test("the arrow keys step over it in one press", async () => {
    const { user, editor } = setup({ initial: value });

    placeCaret(editor, chipStart);
    await user.keyboard("{ArrowRight}");
    expect(readTemplateSelection(editor)).toEqual({
      start: chipEnd,
      end: chipEnd,
    });

    await user.keyboard("{ArrowLeft}");
    expect(readTemplateSelection(editor)).toEqual({
      start: chipStart,
      end: chipStart,
    });
  });

  test("a selected range with a chip in it is deleted whole", async () => {
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, 4, chipEnd + 2);
    await user.keyboard("{Backspace}");

    expect(last(onChange)).toBe("Bodynd");
  });
});

/*
 * A browser only uses what a copy handler puts on the clipboard when the
 * handler cancels the event; user-event then leaves its own clipboard alone.
 * What the handler put there is the DataTransfer user-event hands back.
 */
describe("Ctrl+Home and Ctrl+End", () => {
  /*
   * Firefox's Ctrl+End stopped before a chip that ends the value. The start
   * and the end are offsets known exactly, so the caret goes there directly.
   * (Home and End within a line are checked in a real browser, in
   * packages/E2E/ValuePicker.)
   */
  test("go to the very start and the very end, past any chip", async () => {
    const value: string = `${DEPLOY_ENV} middle\nend ${BODY}`;
    const { user, editor } = setup({ initial: value });

    placeCaret(editor, 12);
    await user.keyboard("{Control>}{End}{/Control}");

    expect(readTemplateSelection(editor)).toEqual({
      start: value.length,
      end: value.length,
    });

    await user.keyboard("{Control>}{Home}{/Control}");

    expect(readTemplateSelection(editor)).toEqual({ start: 0, end: 0 });
  });
});

describe("the clipboard carries references, not chip words", () => {
  const value: string = `Body: ${BODY} end`;

  test("copying a chip copies its reference", async () => {
    const { user, editor } = setup({ initial: value });

    placeCaret(editor, 0, value.length);
    const data: DataTransfer | undefined = await user.copy();

    expect(data?.getData("text/plain")).toBe(value);
  });

  test("cutting takes the text out and the references along", async () => {
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, 6, 6 + BODY.length);
    const data: DataTransfer | undefined = await user.cut();

    expect(data?.getData("text/plain")).toBe(BODY);
    expect(last(onChange)).toBe("Body:  end");
  });

  test("pasting text with a reference in it pastes a chip, at the caret", async () => {
    const { user, editor, onChange } = setup({ initial: "Body:  end" });

    placeCaret(editor, 6);
    await user.paste(BODY);

    expect(last(onChange)).toBe(`Body: ${BODY} end`);
    expect(chipsIn(editor)).toHaveLength(1);
    // The caret is after what was pasted.
    expect(readTemplateSelection(editor)).toEqual({
      start: 6 + BODY.length,
      end: 6 + BODY.length,
    });
  });

  test("pasting into a one-line box puts lines on one line", async () => {
    const { user, editor, onChange } = setup({ initial: "", multiline: false });

    placeCaret(editor, 0);
    await user.paste("one\r\ntwo\nthree");

    expect(last(onChange)).toBe("one two three");
    expect(cleanInsertedText("a\r\nb", true)).toBe("a\nb");
  });

  test("pasting over a selection replaces it", async () => {
    const { user, editor, onChange } = setup({ initial: "Hello world" });

    placeCaret(editor, 6, 11);
    await user.paste(DEPLOY_ENV);

    expect(last(onChange)).toBe(`Hello ${DEPLOY_ENV}`);
  });
});

describe("undo and redo", () => {
  test("Ctrl+Z undoes a run of typing in one go, and Ctrl+Shift+Z redoes it", async () => {
    const { user, editor, onChange } = setup({ initial: "Hi" });

    placeCaret(editor, 2);
    await user.keyboard(" there");
    expect(last(onChange)).toBe("Hi there");

    await user.keyboard("{Control>}z{/Control}");
    expect(last(onChange)).toBe("Hi");
    expect(editorValue(editor)).toBe("Hi");

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(last(onChange)).toBe("Hi there");

    await user.keyboard("{Control>}z{/Control}{Control>}y{/Control}");
    expect(last(onChange)).toBe("Hi there");
  });

  test("a removed chip comes back as a chip", async () => {
    const value: string = `Body: ${BODY}`;
    const { user, editor, onChange } = setup({ initial: value });

    placeCaret(editor, value.length);
    await user.keyboard("{Backspace}");
    expect(chipsIn(editor)).toHaveLength(0);

    await user.keyboard("{Meta>}z{/Meta}");
    expect(last(onChange)).toBe(value);
    expect(chipsIn(editor)).toHaveLength(1);
  });

  test("the browser's own undo is answered the same way", () => {
    const { editor, onChange } = setup({ initial: "Hi" });

    placeCaret(editor, 2);
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => {
          return "!";
        },
      },
    });
    expect(last(onChange)).toBe("Hi!");

    const undo: Event = new InputEvent("beforeinput", {
      inputType: "historyUndo",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor.dispatchEvent(undo);
    });

    expect(undo.defaultPrevented).toBe(true);
    expect(last(onChange)).toBe("Hi");
  });
});

describe("no formatting", () => {
  test("Ctrl+B does nothing to the text", async () => {
    const { user, editor, onChange } = setup({ initial: "plain" });

    placeCaret(editor, 0, 5);
    await user.keyboard("{Control>}b{/Control}");

    expect(onChange).not.toHaveBeenCalled();
    expect(editor.querySelector("b, strong")).toBeNull();
  });

  test("a formatting command is refused", () => {
    const { editor } = setup({ initial: "plain" });

    const bold: Event = new InputEvent("beforeinput", {
      inputType: "formatBold",
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(bold);

    expect(bold.defaultPrevented).toBe(true);
  });

  test("dragging text out of it is refused", () => {
    const { editor } = setup({ initial: `x ${BODY}` });

    const dragStart: Event = createEvent.dragStart(chipsIn(editor)[0]!);
    fireEvent(chipsIn(editor)[0]!, dragStart);

    expect(dragStart.defaultPrevented).toBe(true);
  });
});

describe("typing a reference: {{", () => {
  test("is reported with what has been typed after it", async () => {
    const onTriggerChange: MockFunction = getJestMockFunction();
    const { user, editor } = setup({
      initial: "Hi ",
      onTriggerChange: onTriggerChange,
    });

    placeCaret(editor, 3);
    await user.keyboard(keys("{{req"));

    expect(last(onTriggerChange)).toEqual({ start: 3, query: "req", end: 8 });

    await user.keyboard(" ");
    expect(last(onTriggerChange)).toEqual({ start: 3, query: "req ", end: 9 });

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(last(onTriggerChange)).toEqual({ start: 3, query: "", end: 5 });

    await user.keyboard("{Backspace}");
    expect(last(onTriggerChange)).toBeNull();
  });

  test("dismissed, it stays closed for that {{", async () => {
    const onTriggerChange: MockFunction = getJestMockFunction();
    const handleRef: React.MutableRefObject<TemplateTextEditorHandle | null> = {
      current: null,
    };
    const { user, editor } = setup({
      initial: "",
      onTriggerChange: onTriggerChange,
      handleRef: handleRef,
    });

    placeCaret(editor, 0);
    await user.keyboard(keys("{{x"));
    expect(last(onTriggerChange)).toEqual({ start: 0, query: "x", end: 3 });

    act(() => {
      handleRef.current!.dismissTrigger();
    });
    expect(last(onTriggerChange)).toBeNull();

    await user.keyboard("y");
    expect(last(onTriggerChange)).toBeNull();
  });
});

describe("put in from outside", () => {
  test("insert puts text in place of the selection and the caret after it", () => {
    const handleRef: React.MutableRefObject<TemplateTextEditorHandle | null> = {
      current: null,
    };
    const { editor, onChange } = setup({
      initial: "Deploying to  now",
      handleRef: handleRef,
    });

    act(() => {
      handleRef.current!.insert(DEPLOY_ENV, { start: 13, end: 13 });
    });

    expect(last(onChange)).toBe(`Deploying to ${DEPLOY_ENV} now`);
    expect(chipsIn(editor)).toHaveLength(1);
    expect(document.activeElement).toBe(editor);
    expect(readTemplateSelection(editor)).toEqual({
      start: 13 + DEPLOY_ENV.length,
      end: 13 + DEPLOY_ENV.length,
    });
  });

  test("with no caret yet, at the end", () => {
    const handleRef: React.MutableRefObject<TemplateTextEditorHandle | null> = {
      current: null,
    };
    const { onChange } = setup({ initial: "Body: ", handleRef: handleRef });

    expect(handleRef.current!.getSelection()).toEqual({ start: 6, end: 6 });

    act(() => {
      handleRef.current!.insert(BODY);
    });

    expect(last(onChange)).toBe(`Body: ${BODY}`);
  });

  test("a value set from outside is drawn, and undo does not go back past it", async () => {
    const { user, editor, onChange } = setup({ initial: "Typed" });

    placeCaret(editor, 5);
    await user.keyboard("!");
    await user.click(
      screen.getByRole("button", { name: "Load another value" }),
    );

    expect(editorValue(editor)).toBe("Set from outside");

    placeCaret(editor, 0);
    await user.keyboard("{Control>}z{/Control}");

    expect(editorValue(editor)).toBe("Set from outside");
    expect(last(onChange)).toBe("Typed!");
  });

  test("new words for the chips redraw them; the value is untouched", () => {
    const onChange: MockFunction = getJestMockFunction();

    const words: (
      label: string,
    ) => (reference: string) => ReferenceDescription = (label: string) => {
      return (reference: string): ReferenceDescription => {
        return {
          ...describeReference(reference, {})!,
          source: label,
          parts: [],
        };
      };
    };

    const { rerender } = render(
      <TemplateTextEditor
        value={BODY}
        multiline={false}
        ariaLabel="Message"
        describeReference={words("Before")}
        onChange={onChange}
      />,
    );

    expect(chipsIn(screen.getByRole("textbox"))[0]!.textContent).toBe("Before");

    rerender(
      <TemplateTextEditor
        value={BODY}
        multiline={false}
        ariaLabel="Message"
        describeReference={words("After")}
        onChange={onChange}
      />,
    );

    expect(chipsIn(screen.getByRole("textbox"))[0]!.textContent).toBe("After");
    expect(onChange).not.toHaveBeenCalled();
  });
});
