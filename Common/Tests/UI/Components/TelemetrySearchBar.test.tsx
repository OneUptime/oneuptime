import TelemetrySearchBar from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchBar";
import "@testing-library/jest-dom/extend-expect";
import { cleanup, render, screen } from "@testing-library/react";
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
});
