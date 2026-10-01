/*
 * A setting with a control of its own - a number, a password, a switch, a
 * date - that can still take a value from an earlier step or a variable. Its
 * control cannot show a reference, so it is one or the other: the control
 * with { } beside it, or the picked value as a chip with "abc" to go back.
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

interface FieldProps {
  kind: ValueSingleFieldKind;
  initial: unknown;
  onChange: MockFunction;
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
  options?: { withoutPicker?: boolean },
) => { onChange: MockFunction; user: UserEvent };

const renderField: RenderFieldFunction = (
  kind: ValueSingleFieldKind,
  initial: unknown = "",
  options: { withoutPicker?: boolean } = {},
): { onChange: MockFunction; user: UserEvent } => {
  const onChange: MockFunction = getJestMockFunction();
  const field: ReactElement = (
    <Field kind={kind} initial={initial} onChange={onChange} />
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

    const box: HTMLElement = screen.getByRole("spinbutton", { name: "Setting" });
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
      expect(
        screen.queryByRole("spinbutton", { name: "Setting" }),
      ).toBeNull();
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
    expect(
      screen.getByRole("spinbutton", { name: "Setting" }),
    ).toHaveValue(null);
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
