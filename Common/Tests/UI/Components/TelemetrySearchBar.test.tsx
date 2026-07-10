import TelemetrySearchBar from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import "@testing-library/jest-dom/extend-expect";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

describe("TelemetrySearchBar", () => {
  afterEach(() => {
    cleanup();
  });

  test("shows the results loader inside the search box while loading", () => {
    const { rerender } = render(
      <TelemetrySearchBar
        value="service:api"
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        isLoading={false}
      />,
    );

    expect(
      screen.queryByRole("status", { name: "Loading results" }),
    ).toBeNull();

    rerender(
      <TelemetrySearchBar
        value="service:api"
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        isLoading={true}
      />,
    );

    const input: HTMLElement = screen.getByRole("textbox");
    const loader: HTMLElement = screen.getByRole("status", {
      name: "Loading results",
    });

    expect(input.parentElement?.contains(loader)).toBe(true);
    expect(input.parentElement?.getAttribute("aria-busy")).toBe("true");
  });

  test("Enter submits and keeps the token when onFieldValueSelect returns false", () => {
    const onChange: (value: string) => void = jest.fn();
    const onSubmit: () => void = jest.fn();
    const onFieldValueSelect: (fieldKey: string, value: string) => boolean =
      jest.fn((_fieldKey: string, _value: string): boolean => {
        return false;
      });

    render(
      <TelemetrySearchBar
        value="name:process"
        onChange={onChange}
        onSubmit={onSubmit}
        onFieldValueSelect={onFieldValueSelect}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onFieldValueSelect).toHaveBeenCalledWith("name", "process");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The token must stay in the input — clearing it would drop the filter.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Enter clears the token when onFieldValueSelect consumes it as a chip", () => {
    const onChange: (value: string) => void = jest.fn();
    const onSubmit: () => void = jest.fn();
    const onFieldValueSelect: (fieldKey: string, value: string) => void =
      jest.fn();

    render(
      <TelemetrySearchBar
        value="@http.method:GET"
        onChange={onChange}
        onSubmit={onSubmit}
        onFieldValueSelect={onFieldValueSelect}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onFieldValueSelect).toHaveBeenCalledWith("http.method", "GET");
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
