/*
 * A setting with a control of its own - a number, a password, a switch, a
 * date - that can still take a value from an earlier step or a variable. Its
 * control cannot show a reference, so it is one or the other: the control
 * with { } beside it, or the picked value as a chip with "abc" to go back.
 *
 * Given a title, it labels itself: a switch is one row - the switch, its
 * title beside it, its help under the title, { } at the end - the way every
 * switch field in a form is drawn, and a picked value sits in a box under
 * the same title.
 */

import ValueSingleField, {
  TYPE_A_VALUE_LABEL,
  ValueSingleFieldKind,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSingleField";
import { INSERT_VALUE_LABEL } from "../../../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import { DEPLOY_ENV, chipsIn, withPicker } from "./ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement, useState } from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

interface FieldOptions {
  withoutPicker?: boolean;
  title?: string;
  description?: string;
  disabled?: boolean;
}

interface FieldProps {
  kind: ValueSingleFieldKind;
  initial: unknown;
  onChange: MockFunction;
  options: FieldOptions;
}

const Field: (props: FieldProps) => ReactElement = (
  props: FieldProps,
): ReactElement => {
  const [value, setValue] = useState<unknown>(props.initial);

  return (
    <div>
      <span id="label">Setting</span>
      <ValueSingleField
        kind={props.kind}
        value={value}
        ariaLabelledby="label"
        title={props.options.title}
        description={props.options.description}
        disabled={props.options.disabled}
        dataTestId="setting"
        onChange={(next: string | boolean) => {
          setValue(next);
          props.onChange(next);
        }}
      />
    </div>
  );
};

type RenderFieldFunction = (
  kind: ValueSingleFieldKind,
  initial?: unknown,
  options?: FieldOptions,
) => { onChange: MockFunction; user: UserEvent };

const renderField: RenderFieldFunction = (
  kind: ValueSingleFieldKind,
  initial: unknown = "",
  options: FieldOptions = {},
): { onChange: MockFunction; user: UserEvent } => {
  const onChange: MockFunction = getJestMockFunction();
  const field: ReactElement = (
    <Field
      kind={kind}
      initial={initial}
      onChange={onChange}
      options={options}
    />
  );

  render(options.withoutPicker ? field : withPicker(field));

  return { onChange: onChange, user: userEvent.setup({ delay: null }) };
};

type PickFunction = (reference: string) => void;

const pick: PickFunction = (reference: string): void => {
  fireEvent.click(
    screen.getAllByRole("option").find((option: HTMLElement) => {
      return option.getAttribute("data-reference") === reference;
    })!,
  );
};

afterEach(() => {
  cleanup();
});

describe("a number", () => {
  test("is a number box with { } beside it, and what is typed is stored", async () => {
    const { onChange, user } = renderField(ValueSingleFieldKind.Number);

    const box: HTMLElement = screen.getByRole("spinbutton", {
      name: "Setting",
    });
    expect(screen.getByTestId("setting-insert-value")).toHaveAccessibleName(
      INSERT_VALUE_LABEL,
    );

    await user.type(box, "30");

    expect(onChange).toHaveBeenLastCalledWith("30");
  });

  test("a picked value replaces it, as a chip", async () => {
    const { onChange } = renderField(ValueSingleFieldKind.Number, "30");

    fireEvent.click(screen.getByTestId("setting-insert-value"));
    pick(DEPLOY_ENV);

    expect(onChange).toHaveBeenLastCalledWith(DEPLOY_ENV);
    await waitFor(() => {
      expect(screen.queryByRole("spinbutton", { name: "Setting" })).toBeNull();
    });
    expect(chipsIn(screen.getByTestId("setting"))).toHaveLength(1);
  });

  test("abc goes back to the number box, empty", async () => {
    const { onChange, user } = renderField(
      ValueSingleFieldKind.Number,
      DEPLOY_ENV,
    );

    await user.click(screen.getByRole("button", { name: TYPE_A_VALUE_LABEL }));

    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("spinbutton", { name: "Setting" })).toHaveValue(
      null,
    );
  });
});

describe("a password", () => {
  test("typed, it stays hidden", () => {
    renderField(ValueSingleFieldKind.Password, "s3cret");

    expect(screen.getByLabelText("Setting")).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("a variable in it shows as the variable, not as dots", () => {
    renderField(ValueSingleFieldKind.Password, DEPLOY_ENV);

    expect(chipsIn(screen.getByTestId("setting"))[0]).toHaveTextContent(
      "Variable›DEPLOY_ENV",
    );
  });
});

describe("a switch", () => {
  test("keeps its switch, with { } beside it", async () => {
    const { onChange, user } = renderField(ValueSingleFieldKind.Boolean, false);

    await user.click(screen.getByTestId("setting"));

    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("setting-insert-value")).toBeInTheDocument();
  });

  test("abc on a picked value goes back to off", async () => {
    const { onChange, user } = renderField(
      ValueSingleFieldKind.Boolean,
      DEPLOY_ENV,
    );

    await user.click(screen.getByRole("button", { name: TYPE_A_VALUE_LABEL }));

    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test("without a title of its own, it is named by the caller's label", () => {
    renderField(ValueSingleFieldKind.Boolean, false);

    expect(screen.getByRole("switch", { name: "Setting" })).toBeInTheDocument();
  });
});

describe("a switch with a title of its own", () => {
  const TITLE: string = "Use Implicit TLS";
  const HELP: string =
    "Optional. Enable for implicit TLS, usually on port 465.";

  test("is one row: the switch, named by its title beside it and described by its help, then { }", () => {
    renderField(ValueSingleFieldKind.Boolean, false, {
      title: TITLE,
      description: HELP,
    });

    // Its own title, not the caller's label, though it was handed both.
    const toggle: HTMLElement = screen.getByRole("switch", { name: TITLE });
    expect(toggle).toHaveAccessibleDescription(HELP);

    const insertButton: HTMLElement = screen.getByTestId(
      "setting-insert-value",
    );
    const row: HTMLElement = insertButton.parentElement!;

    expect(row).toContainElement(toggle);
    expect(row).toContainElement(screen.getByText(TITLE));
    expect(row).toContainElement(screen.getByText(HELP));
    // { } comes after the title and help, at the end of the row.
    expect(row.lastElementChild).toBe(insertButton);
    // Lined up with the switch at the top, not with the middle of the help.
    expect(row).toHaveClass("items-start");
  });

  test("says nothing about being optional, as no switch does", () => {
    renderField(ValueSingleFieldKind.Boolean, false, {
      title: TITLE,
      description: HELP,
    });

    expect(screen.queryByText("(Optional)")).toBeNull();
  });

  test("pressing its title flips it", async () => {
    const { onChange, user } = renderField(
      ValueSingleFieldKind.Boolean,
      false,
      {
        title: TITLE,
      },
    );

    await user.click(screen.getByText(TITLE));

    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("switch", { name: TITLE })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a picked value is a chip in a box under the same title, which names the box", async () => {
    const { onChange } = renderField(ValueSingleFieldKind.Boolean, false, {
      title: TITLE,
      description: HELP,
    });

    fireEvent.click(screen.getByTestId("setting-insert-value"));
    pick(DEPLOY_ENV);

    expect(onChange).toHaveBeenLastCalledWith(DEPLOY_ENV);

    const box: HTMLElement = await screen.findByRole("textbox", {
      name: TITLE,
    });

    expect(chipsIn(box)).toHaveLength(1);
    expect(screen.queryByRole("switch")).toBeNull();
    // The help stays, under the title; still nothing about being optional.
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(screen.queryByText("(Optional)")).toBeNull();
  });

  test("abc goes back to the switch, off, named by its title again", async () => {
    const { onChange, user } = renderField(
      ValueSingleFieldKind.Boolean,
      DEPLOY_ENV,
      { title: TITLE },
    );

    expect(screen.getByRole("textbox", { name: TITLE })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: TYPE_A_VALUE_LABEL }));

    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("switch", { name: TITLE })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("disabled, it cannot be flipped and offers no { }", async () => {
    const { onChange, user } = renderField(
      ValueSingleFieldKind.Boolean,
      false,
      {
        title: TITLE,
        disabled: true,
      },
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: TITLE });
    expect(toggle).toHaveAttribute("aria-disabled", "true");

    await user.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setting-insert-value")).toBeNull();
  });
});

describe("a number with a title of its own", () => {
  test("has the title as a label above its box, with its help", () => {
    renderField(ValueSingleFieldKind.Number, "", {
      title: "Retries",
      description: "Optional. How many times to try again.",
    });

    expect(
      screen.getByRole("spinbutton", { name: "Retries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Optional. How many times to try again."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("setting-insert-value")).toBeInTheDocument();
  });
});

describe("a date", () => {
  test("is a date box with { } beside it", () => {
    renderField(ValueSingleFieldKind.Date);

    expect(screen.getByLabelText("Setting")).toHaveAttribute("type", "date");
    expect(screen.getByTestId("setting-insert-value")).toBeInTheDocument();
  });
});

describe("outside a step's settings", () => {
  test("there is no { }", () => {
    renderField(ValueSingleFieldKind.Number, "", { withoutPicker: true });

    expect(screen.queryByTestId("setting-insert-value")).toBeNull();
  });
});
