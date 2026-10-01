/*
 * A text setting with the value picker in it: { } at the end of the field,
 * or "{{" typed in it, and the value lands where the caret was, as a chip.
 *
 * This is the replacement for "Pick this value from other component or from
 * variable", which appended the reference to the end of the field whatever
 * the caret was doing.
 */

import ValueTextField, {
  INSERT_VALUE_LABEL,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import Modal from "../../../../../UI/Components/Modal/Modal";
import { readTemplateSelection } from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextDom";
import {
  BODY,
  DEPLOY_ENV,
  HEADERS,
  chipsIn,
  editorValue,
  keys,
  placeCaret,
  withPicker,
} from "./ValuePickerTestUtils";
import Components from "../../../../../Types/Workflow/Components";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement, useState } from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

interface FieldHarnessProps {
  initial: string;
  multiline?: boolean;
  onChange?: (value: string) => void;
  error?: string;
}

const Field: (props: FieldHarnessProps) => ReactElement = (
  props: FieldHarnessProps,
): ReactElement => {
  const [value, setValue] = useState<string>(props.initial);

  return (
    <ValueTextField
      value={value}
      multiline={props.multiline ?? true}
      ariaLabel="Message"
      error={props.error}
      dataTestId="message"
      onChange={(next: string) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
};

interface Rendered {
  user: UserEvent;
  editor: HTMLElement;
  onChange: MockFunction;
}

type RenderFieldFunction = (
  props: FieldHarnessProps,
  options?: { withoutPicker?: boolean; graphComponents?: Array<NodeDataProp> },
) => Rendered;

const renderField: RenderFieldFunction = (
  props: FieldHarnessProps,
  options: { withoutPicker?: boolean; graphComponents?: Array<NodeDataProp> } = {},
): Rendered => {
  const onChange: MockFunction = getJestMockFunction();
  const field: ReactElement = <Field {...props} onChange={onChange} />;

  render(
    options.withoutPicker
      ? field
      : withPicker(field, { graphComponents: options.graphComponents }),
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

type InsertButtonFunction = () => HTMLElement;

const insertButton: InsertButtonFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: INSERT_VALUE_LABEL });
};

type OptionFunction = (reference: string) => HTMLElement;

const option: OptionFunction = (reference: string): HTMLElement => {
  return screen
    .getAllByRole("option")
    .find((candidate: HTMLElement) => {
      return candidate.getAttribute("data-reference") === reference;
    })!;
};

afterEach(() => {
  cleanup();
});

describe("the { } button", () => {
  test("sits in the field, named for what it does", () => {
    renderField({ initial: "" });

    expect(insertButton()).toHaveTextContent("{ }");
    expect(insertButton()).toHaveAttribute("title", INSERT_VALUE_LABEL);
    expect(insertButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("message-box")).toContainElement(insertButton());
  });

  test("opens the list, with the focus in its search box", async () => {
    const { user } = renderField({ initial: "" });

    await user.click(insertButton());

    expect(insertButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("value-picker-search")).toHaveFocus();
  });

  test("the picked value goes where the caret was, not at the end", async () => {
    const { user, editor, onChange } = renderField({
      initial: "Deploying to  now.",
    });

    placeCaret(editor, 13);
    fireEvent.mouseDown(insertButton());
    fireEvent.click(insertButton());
    fireEvent.click(option(DEPLOY_ENV));

    expect(last(onChange)).toBe(`Deploying to ${DEPLOY_ENV} now.`);
    expect(screen.queryByTestId("value-picker")).toBeNull();
    // Back in the field, the caret after the chip, ready to type on.
    expect(editor).toHaveFocus();
    expect(readTemplateSelection(editor)).toEqual({
      start: 13 + DEPLOY_ENV.length,
      end: 13 + DEPLOY_ENV.length,
    });

    await user.keyboard("!");
    expect(last(onChange)).toBe(`Deploying to ${DEPLOY_ENV}! now.`);
  });

  test("it replaces a selection", () => {
    const { editor, onChange } = renderField({ initial: "Hello world" });

    placeCaret(editor, 6, 11);
    fireEvent.mouseDown(insertButton());
    fireEvent.click(insertButton());
    fireEvent.click(option(DEPLOY_ENV));

    expect(last(onChange)).toBe(`Hello ${DEPLOY_ENV}`);
  });

  test("never in the field: the value goes at the end", () => {
    const { onChange } = renderField({ initial: "Body: " });

    fireEvent.click(insertButton());
    fireEvent.click(option(BODY));

    expect(last(onChange)).toBe(`Body: ${BODY}`);
  });

  test("the value shows as a chip, not as {{...}}", () => {
    const { editor } = renderField({ initial: "" });

    fireEvent.click(insertButton());
    fireEvent.click(option(BODY));

    expect(chipsIn(editor)).toHaveLength(1);
    expect(editor.textContent).not.toContain("{{");
  });

  test("pressed again, it closes the list", async () => {
    const { user } = renderField({ initial: "" });

    await user.click(insertButton());
    await user.click(insertButton());

    expect(screen.queryByTestId("value-picker")).toBeNull();
  });

  test("Escape closes the list, puts the focus back, and leaves the dialog open", async () => {
    const onClose: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(
      withPicker(
        <Modal title="Log" onClose={onClose} onSubmit={() => {}}>
          <Field initial="Hi" />
        </Modal>,
      ),
    );

    const editor: HTMLElement = screen.getByRole("textbox", {
      name: "Message",
    });

    await user.click(insertButton());
    expect(screen.getByTestId("value-picker-search")).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("value-picker")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
  });

  test("Tab leaves the list for the field", async () => {
    const { user, editor } = renderField({ initial: "" });

    await user.click(insertButton());
    await user.keyboard("{Tab}");

    expect(screen.queryByTestId("value-picker")).toBeNull();
    expect(editor).toHaveFocus();
  });

  test("a press outside closes the list and nothing else", async () => {
    const { user } = renderField({ initial: "" });

    await user.click(insertButton());
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByTestId("value-picker")).toBeNull();
    });
  });
});

describe("typing {{", () => {
  test("opens the list under the field, filtered by what follows", async () => {
    const { user, editor } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(keys("{{headers"));

    const inline: HTMLElement = screen.getByTestId("value-picker-inline");

    expect(within(inline).queryByTestId("value-picker-search")).toBeNull();
    expect(
      within(inline)
        .getAllByRole("option")
        .map((candidate: HTMLElement) => {
          return candidate.getAttribute("data-reference");
        }),
    ).toEqual([HEADERS]);
    // The field keeps the focus, and points at the list and its first value.
    expect(editor).toHaveFocus();
    expect(editor).toHaveAttribute("aria-controls");
    await waitFor(() => {
      expect(editor).toHaveAttribute(
        "aria-activedescendant",
        within(inline).getAllByRole("option")[0]!.id,
      );
    });
  });

  test("Enter puts the value in place of what was typed", async () => {
    const { user, editor, onChange } = renderField({ initial: "Hi " });

    placeCaret(editor, 3);
    await user.keyboard(`${keys("{{head")}{Enter}`);

    expect(last(onChange)).toBe(`Hi ${HEADERS}`);
    expect(chipsIn(editor)).toHaveLength(1);
    expect(screen.queryByTestId("value-picker-inline")).toBeNull();
    expect(editorValue(editor)).toBe(`Hi ${HEADERS}`);
  });

  test("the arrow keys choose, and Tab takes it", async () => {
    const { user, editor, onChange } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(`${keys("{{")}{ArrowDown}{Tab}`);

    expect(last(onChange)).toBe(HEADERS);
  });

  test("a closing }} already typed goes too", async () => {
    const { user, editor, onChange } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(keys("{{}}"));
    placeCaret(editor, 2);
    await user.keyboard(`body{Enter}`);

    expect(last(onChange)).toBe(BODY);
  });

  test("clicking a value takes it too", async () => {
    const { user, editor, onChange } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(keys("{{"));
    fireEvent.click(option(DEPLOY_ENV));

    expect(last(onChange)).toBe(DEPLOY_ENV);
  });

  test("Escape closes the list and keeps what was typed", async () => {
    const { user, editor, onChange } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(`${keys("{{x")}{Escape}`);

    expect(screen.queryByTestId("value-picker-inline")).toBeNull();
    expect(last(onChange)).toBe("{{x");

    // And it stays closed while that same {{ is typed on.
    await user.keyboard("y");
    expect(screen.queryByTestId("value-picker-inline")).toBeNull();
  });

  test("leaving the field closes it", async () => {
    const { user, editor } = renderField({ initial: "" });

    placeCaret(editor, 0);
    await user.keyboard(keys("{{"));
    expect(screen.getByTestId("value-picker-inline")).toBeInTheDocument();

    fireEvent.blur(editor, { relatedTarget: document.body });

    expect(screen.queryByTestId("value-picker-inline")).toBeNull();
  });
});

describe("chips name what they read", () => {
  test("by the step's title, from the workflow the field is in", () => {
    const metadata: ComponentMetadata = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.Webhook;
      },
    )!;

    const webhook: NodeDataProp = {
      error: "",
      id: "webhook-1",
      nodeType: NodeType.Node,
      metadata: metadata,
      metadataId: metadata.id,
      internalId: "webhook-internal",
      arguments: {},
      returnValues: {},
      componentType: metadata.componentType,
    };

    const { editor } = renderField(
      { initial: `Body: ${BODY}` },
      { graphComponents: [webhook] },
    );

    expect(chipsIn(editor)[0]).toHaveTextContent("Webhook›Request Body");
    expect(chipsIn(editor)[0]).toHaveAttribute("title", BODY);
  });

  test("a reference to a step that is not there is a warning chip saying so", () => {
    const { editor } = renderField(
      { initial: "{{local.components.gone-1.returnValues.x}}" },
      { graphComponents: [] },
    );

    expect(chipsIn(editor)[0]).toHaveAttribute("data-tone", "Warning");
    expect(chipsIn(editor)[0]!.getAttribute("title")).toContain(
      'No step in this workflow has the ID "gone-1".',
    );
  });
});

describe("outside a step's settings", () => {
  test("there is nothing to pick, so no { } and no list", async () => {
    const { user, editor } = renderField(
      { initial: "" },
      { withoutPicker: true },
    );

    expect(
      screen.queryByRole("button", { name: INSERT_VALUE_LABEL }),
    ).toBeNull();

    placeCaret(editor, 0);
    await user.keyboard(keys("{{"));

    expect(screen.queryByTestId("value-picker-inline")).toBeNull();
  });
});

describe("an error", () => {
  test("is shown under the field and read with it", () => {
    const { editor } = renderField({ initial: "", error: "Value is required." });

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(message).toHaveTextContent("Value is required.");
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(editor).toHaveAttribute("aria-describedby", message.id);
  });
});
