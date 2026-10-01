/*
 * A long-text column in the record editor - an incident's description, a
 * note - is a multi-line box that grows with what is typed, like the
 * multi-line arguments around it, rather than a box six lines tall on every
 * row whatever it holds. Since the value picker it is the same chip editor as
 * every other text setting, so a description can be built from the
 * webhook's values.
 */
import ColumnValueInput from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { editorValue, placeCaret } from "../ValuePicker/ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

describe("ColumnValueInput — a long-text column", () => {
  test("is a multi-line box that starts three lines tall and grows", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.LongText}
        valueMode={ColumnValueMode.Literal}
        text={"Checkout is failing.\nCustomers see a 500."}
        values={[]}
        dataTestId="description-value"
        onChange={(): void => {}}
      />,
    );

    const box: HTMLElement = screen.getByTestId("description-value");

    expect(box).toHaveAttribute("role", "textbox");
    expect(box).toHaveAttribute("aria-multiline", "true");
    // Three lines when short, and it scrolls only once it is long.
    expect(box.className).toContain("min-h-[4.75rem]");
    expect(box.className).toContain("max-h-80");
    expect(editorValue(box)).toBe("Checkout is failing.\nCustomers see a 500.");
  });

  test("reports every line typed into it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(
      <ColumnValueInput
        control={ModelColumnControl.LongText}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        dataTestId="description-value"
        onChange={onChange}
      />,
    );

    placeCaret(screen.getByTestId("description-value"), 0);
    await user.keyboard("First line{Enter}Second line");

    expect(onChange).toHaveBeenLastCalledWith({
      text: "First line\nSecond line",
      valueMode: ColumnValueMode.Literal,
    });
  });

  test("a one-line column is still one line", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Text}
        valueMode={ColumnValueMode.Literal}
        text="Checkout API"
        values={[]}
        dataTestId="name-value"
        onChange={(): void => {}}
      />,
    );

    expect(screen.getByTestId("name-value")).toHaveAttribute(
      "aria-multiline",
      "false",
    );
  });
});
