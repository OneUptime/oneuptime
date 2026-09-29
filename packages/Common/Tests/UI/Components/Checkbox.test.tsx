import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Checkbox", () => {
  test("uses its visible title as the accessible and clickable label", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <CheckboxElement
        initialValue={false}
        onChange={onChange}
        title="Detections"
      />,
    );

    const checkbox: HTMLElement = screen.getByRole("checkbox", {
      name: "Detections",
    });
    fireEvent.click(screen.getByText("Detections"));

    expect(checkbox).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true, undefined);
  });

  test("does not toggle a disabled checkbox when its label is clicked", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <CheckboxElement
        disabled={true}
        initialValue={true}
        onChange={onChange}
        title="Alerts"
      />,
    );

    const checkbox: HTMLElement = screen.getByRole("checkbox", {
      name: "Alerts",
    });
    fireEvent.click(screen.getByText("Alerts"));

    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("gives each rendered description a unique association", () => {
    render(
      <>
        <CheckboxElement description="First description" title="First" />
        <CheckboxElement description="Second description" title="Second" />
      </>,
    );

    const first: HTMLElement = screen.getByRole("checkbox", { name: "First" });
    const second: HTMLElement = screen.getByRole("checkbox", {
      name: "Second",
    });
    const firstDescriptionId: string =
      first.getAttribute("aria-describedby") || "";
    const secondDescriptionId: string =
      second.getAttribute("aria-describedby") || "";

    expect(firstDescriptionId).not.toBe("");
    expect(secondDescriptionId).not.toBe("");
    expect(firstDescriptionId).not.toBe(secondDescriptionId);
    expect(document.getElementById(firstDescriptionId)).toHaveTextContent(
      "First description",
    );
    expect(document.getElementById(secondDescriptionId)).toHaveTextContent(
      "Second description",
    );
  });
});
