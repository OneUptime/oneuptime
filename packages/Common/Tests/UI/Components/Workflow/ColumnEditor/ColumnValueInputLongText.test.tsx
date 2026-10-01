/*
 * A long-text column in the record editor - an incident's description, a
 * note - is a multi-line box that grows with what is typed, like the
 * multi-line arguments around it, rather than a box six lines tall on every
 * row whatever it holds.
 */
import ColumnValueInput from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("data-auto-grow", "true");
    expect(box).toHaveAttribute("rows", "3");
    expect((box as HTMLTextAreaElement).value).toBe(
      "Checkout is failing.\nCustomers see a 500.",
    );
  });

  test("reports every line typed into it", () => {
    const onChange: MockFunction = getJestMockFunction();

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

    fireEvent.change(screen.getByTestId("description-value"), {
      target: { value: "First line\nSecond line" },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      text: "First line\nSecond line",
    });
  });

  test("a one-line column is still a one-line input", () => {
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

    expect(screen.getByTestId("name-value").tagName).toBe("INPUT");
  });
});
