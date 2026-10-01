/*
 * Two things a workflow step's multi-line fields need from TextArea.
 *
 * It follows a value that changes from outside. A form field passes its value
 * in as initialValue, and the form changes that value without the box being
 * typed into whenever "pick this value from a component or a variable" adds a
 * reference. The box used to ignore it: the reference went into the form, the
 * box kept the old text, and the next keystroke wrote the old text back.
 *
 * It can grow with its text. jsdom has no layout, so scrollHeight, the
 * computed box metrics and ResizeObserver are stood in for below, and the
 * tests read the height TextArea writes.
 */
import TextArea, {
  AUTO_GROW_MAX_ROWS,
  AUTO_GROW_MIN_ROWS,
  DEFAULT_TEXT_AREA_ROWS,
} from "../../../UI/Components/TextArea/TextArea";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

const LINE_HEIGHT: number = 20;
const PADDING_Y: number = 16; // py-2, top and bottom
const BORDER_Y: number = 2; // 1px top and bottom

// The tallest an auto-growing box gets at the default maxRows.
const TALLEST: number = LINE_HEIGHT * AUTO_GROW_MAX_ROWS + PADDING_Y + BORDER_Y;

const getTextArea: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
};

afterEach(() => {
  cleanup();
});

describe("TextArea follows a value that changes from outside", () => {
  test("shows a value the form changes without the box being typed into", () => {
    const view: RenderResult = render(
      <TextArea initialValue="Webhook received." />,
    );

    expect(getTextArea().value).toBe("Webhook received.");

    view.rerender(
      <TextArea initialValue="Webhook received. {{local.variables.ENV}}" />,
    );

    expect(getTextArea().value).toBe(
      "Webhook received. {{local.variables.ENV}}",
    );
  });

  test("text typed after the outside change keeps that change", () => {
    const onChange: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      <TextArea initialValue="Hello" onChange={onChange} />,
    );

    view.rerender(
      <TextArea
        initialValue="Hello {{local.variables.NAME}}"
        onChange={onChange}
      />,
    );

    fireEvent.change(getTextArea(), {
      target: { value: "Hello {{local.variables.NAME}}!" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "Hello {{local.variables.NAME}}!",
    );
    expect(getTextArea().value).toBe("Hello {{local.variables.NAME}}!");
  });

  test("a form echoing back what was typed changes nothing, the caret included", () => {
    const onChange: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      <TextArea initialValue="" onChange={onChange} />,
    );

    const textArea: HTMLTextAreaElement = getTextArea();

    fireEvent.change(textArea, { target: { value: "first second" } });
    textArea.setSelectionRange(5, 5);

    view.rerender(<TextArea initialValue="first second" onChange={onChange} />);

    expect(textArea.value).toBe("first second");
    expect(textArea.selectionStart).toBe(5);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("an initialValue taken away leaves what the box holds", () => {
    const view: RenderResult = render(<TextArea initialValue="Keep me" />);

    view.rerender(<TextArea initialValue={undefined} />);

    expect(getTextArea().value).toBe("Keep me");
  });

  test("a value cleared from outside clears the box", () => {
    const view: RenderResult = render(<TextArea initialValue="Old text" />);

    view.rerender(<TextArea initialValue="" />);

    expect(getTextArea().value).toBe("");
  });

  test("the value prop still drives the box as before", () => {
    const view: RenderResult = render(<TextArea value="one" />);

    view.rerender(<TextArea value="two" />);

    expect(getTextArea().value).toBe("two");
  });
});

describe("TextArea height", () => {
  test("a fixed text area is unchanged: six rows, a minimum height, no auto-grow", () => {
    render(<TextArea initialValue="" />);

    const textArea: HTMLTextAreaElement = getTextArea();

    expect(DEFAULT_TEXT_AREA_ROWS).toBe(6);
    expect(textArea).toHaveAttribute("rows", "6");
    expect(textArea).toHaveClass("min-h-32");
    expect(textArea).not.toHaveAttribute("data-auto-grow");
    expect(textArea.style.height).toBe("");
  });

  test("an auto-growing text area starts three lines tall, without the six-line floor", () => {
    render(<TextArea initialValue="" autoGrow={true} />);

    const textArea: HTMLTextAreaElement = getTextArea();

    expect(AUTO_GROW_MIN_ROWS).toBe(3);
    expect(textArea).toHaveAttribute("rows", "3");
    expect(textArea).not.toHaveClass("min-h-32");
    expect(textArea).toHaveAttribute("data-auto-grow", "true");
    // Still resizable by hand, like every other text area.
    expect(textArea).toHaveClass("resize-y");
  });

  test("rows sets how tall it starts", () => {
    render(<TextArea initialValue="" autoGrow={true} rows={2} />);

    expect(getTextArea()).toHaveAttribute("rows", "2");
  });
});

describe("TextArea auto-grow sizing", () => {
  let scrollHeight: number = 0;
  let width: number = 600;
  let realGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    scrollHeight = 0;
    width = 600;

    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(): number {
        return scrollHeight;
      },
    });

    Object.defineProperty(
      HTMLTextAreaElement.prototype,
      "getBoundingClientRect",
      {
        configurable: true,
        value(): DOMRect {
          return { width: width, height: 0 } as DOMRect;
        },
      },
    );

    realGetComputedStyle = window.getComputedStyle.bind(window);

    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation(
        (element: Element, pseudo?: string | null): CSSStyleDeclaration => {
          if (element instanceof HTMLTextAreaElement) {
            return {
              borderTopWidth: "1px",
              borderBottomWidth: "1px",
              paddingTop: "8px",
              paddingBottom: "8px",
              lineHeight: `${LINE_HEIGHT}px`,
            } as CSSStyleDeclaration;
          }

          return realGetComputedStyle(element, pseudo);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (
      HTMLTextAreaElement.prototype as unknown as Record<string, unknown>
    )["scrollHeight"];
    delete (
      HTMLTextAreaElement.prototype as unknown as Record<string, unknown>
    )["getBoundingClientRect"];
    delete (window as unknown as Record<string, unknown>)["ResizeObserver"];
  });

  test("fits its height to the text, border included, with no scrollbar while it grows", () => {
    scrollHeight = 96; // four lines of text plus padding

    render(<TextArea initialValue={"one\ntwo\nthree\nfour"} autoGrow={true} />);

    const textArea: HTMLTextAreaElement = getTextArea();

    expect(textArea.style.height).toBe(`${96 + BORDER_Y}px`);
    expect(textArea.style.overflowY).toBe("hidden");
  });

  test("grows as lines are typed and shrinks when they are deleted", () => {
    scrollHeight = 76;

    render(<TextArea initialValue="one line" autoGrow={true} />);

    const textArea: HTMLTextAreaElement = getTextArea();
    expect(textArea.style.height).toBe(`${76 + BORDER_Y}px`);

    scrollHeight = 156;
    fireEvent.change(textArea, {
      target: { value: "1\n2\n3\n4\n5\n6\n7" },
    });
    expect(textArea.style.height).toBe(`${156 + BORDER_Y}px`);

    scrollHeight = 76;
    fireEvent.change(textArea, { target: { value: "1" } });
    expect(textArea.style.height).toBe(`${76 + BORDER_Y}px`);
  });

  test("stops at maxRows and scrolls from there", () => {
    scrollHeight = 2000;

    render(<TextArea initialValue={"x\n".repeat(100)} autoGrow={true} />);

    const textArea: HTMLTextAreaElement = getTextArea();

    expect(textArea.style.height).toBe(`${TALLEST}px`);
    expect(textArea.style.overflowY).toBe("auto");
  });

  test("a smaller maxRows stops it sooner", () => {
    scrollHeight = 2000;

    render(
      <TextArea initialValue={"x\n".repeat(100)} autoGrow={true} maxRows={5} />,
    );

    expect(getTextArea().style.height).toBe(
      `${LINE_HEIGHT * 5 + PADDING_Y + BORDER_Y}px`,
    );
  });

  test("grows when a value set from outside makes it longer", () => {
    scrollHeight = 76;

    const view: RenderResult = render(
      <TextArea initialValue="short" autoGrow={true} />,
    );

    scrollHeight = 136;
    view.rerender(
      <TextArea initialValue={"short\n{{local.variables.A}}\n\n\n"} autoGrow />,
    );

    expect(getTextArea().style.height).toBe(`${136 + BORDER_Y}px`);
  });

  test("leaves the height to rows while it is not laid out", () => {
    scrollHeight = 0;

    render(<TextArea initialValue="hidden" autoGrow={true} />);

    const textArea: HTMLTextAreaElement = getTextArea();

    expect(textArea.style.height).toBe("");
    expect(textArea.style.overflowY).toBe("");
  });

  test("a fixed text area never sets its own height", () => {
    scrollHeight = 2000;

    render(<TextArea initialValue={"x\n".repeat(100)} />);

    const textArea: HTMLTextAreaElement = getTextArea();

    fireEvent.change(textArea, { target: { value: "y\n".repeat(200) } });

    expect(textArea.style.height).toBe("");
  });

  test("measures again when its width changes, and not for a change of height alone", () => {
    let notifyResize: () => void = (): void => {};
    const disconnect: MockFunction = getJestMockFunction();

    class FakeResizeObserver {
      public constructor(callback: () => void) {
        notifyResize = callback;
      }

      public observe(): void {}

      public disconnect(): void {
        disconnect();
      }
    }

    (window as unknown as Record<string, unknown>)["ResizeObserver"] =
      FakeResizeObserver;

    scrollHeight = 76;

    const view: RenderResult = render(
      <TextArea
        initialValue="A sentence long enough to wrap when narrow."
        autoGrow={true}
      />,
    );

    const textArea: HTMLTextAreaElement = getTextArea();
    expect(textArea.style.height).toBe(`${76 + BORDER_Y}px`);

    // The box's own height change reports in too; it must not re-measure.
    scrollHeight = 116;
    act(() => {
      notifyResize();
    });
    expect(textArea.style.height).toBe(`${76 + BORDER_Y}px`);

    // Narrower: the text wraps onto more lines.
    width = 240;
    act(() => {
      notifyResize();
    });
    expect(textArea.style.height).toBe(`${116 + BORDER_Y}px`);

    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("a fixed text area does not watch its width", () => {
    const observe: MockFunction = getJestMockFunction();

    class FakeResizeObserver {
      public observe(): void {
        observe();
      }

      public disconnect(): void {}
    }

    (window as unknown as Record<string, unknown>)["ResizeObserver"] =
      FakeResizeObserver;

    render(<TextArea initialValue="fixed" />);

    expect(observe).not.toHaveBeenCalled();
  });
});
