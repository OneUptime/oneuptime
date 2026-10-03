import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import React from "react";
import SaveStatus, {
  SaveState,
} from "../../../UI/Components/SaveStatus/SaveStatus";

/*
 * The "Saving…" / "Saved" beside a setting that saves the moment it changes
 * (the monitor's Monitoring Interval and Probe Agreement cards use it).
 *
 * It must be in the page while nothing is happening - a screen reader hears
 * a live region's new text only if the region was already there - and its
 * markup must be valid where it sits: Icon draws a div, which a span may not
 * hold.
 */

afterEach(() => {
  cleanup();
});

function renderStatus(state: SaveState): RenderResult {
  return render(<SaveStatus state={state} dataTestId="setting-status" />);
}

describe("SaveStatus", () => {
  test("is an empty live region while nothing is happening", () => {
    renderStatus(SaveState.Idle);

    const status: HTMLElement = screen.getByTestId("setting-status");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("");
    expect(status).toBeEmptyDOMElement();
  });

  test("says Saving… while a change is on its way", () => {
    renderStatus(SaveState.Saving);

    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    expect(screen.getByRole("status").querySelector("svg")).toBeNull();
  });

  test("says Saved, with a tick, once it is", () => {
    renderStatus(SaveState.Saved);

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toHaveTextContent("Saved");
    expect(status.querySelector("svg")).not.toBeNull();
  });

  test("the region stays the same element as it changes, so its words are announced", () => {
    const view: RenderResult = renderStatus(SaveState.Idle);
    const before: HTMLElement = screen.getByRole("status");

    view.rerender(<SaveStatus state={SaveState.Saving} />);
    expect(screen.getByRole("status")).toBe(before);

    view.rerender(<SaveStatus state={SaveState.Saved} />);
    expect(screen.getByRole("status")).toBe(before);
    expect(before).toHaveTextContent("Saved");
  });

  test("holds no span around a div: the icon draws a div of its own", () => {
    renderStatus(SaveState.Saved);

    const status: HTMLElement = screen.getByRole("status");

    expect(status.tagName).toBe("DIV");
    expect(status.querySelector("span div")).toBeNull();
  });

  test("takes spacing from where it sits", () => {
    render(<SaveStatus state={SaveState.Idle} className="sm:ml-4" />);

    expect(screen.getByRole("status")).toHaveClass("sm:ml-4");
    expect(screen.getByRole("status")).toHaveClass("inline-flex");
  });
});
