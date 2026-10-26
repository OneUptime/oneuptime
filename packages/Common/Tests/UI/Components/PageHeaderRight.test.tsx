import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import Page, {
  PAGE_HEADER_RIGHT_CLASS_NAME,
  PAGE_HEADER_RIGHT_TEST_ID,
} from "../../../UI/Components/Page/Page";

/*
 * What a page puts on its header's right (headerRight) - the telemetry
 * products' tab bar, a status page's Subscribe button - never makes the
 * page wider than the window. The header lays its title and that side in
 * a row from 640px up, wrapping the side onto a line of its own when they
 * do not fit; the side kept the width of everything in it, so the
 * telemetry tab bar, which scrolls sideways inside itself, pushed the page
 * sideways from 640px to about 700px in German instead of scrolling. It
 * may shrink to its line now (min-w-0, max-w-full), and what is in it
 * scrolls or wraps there.
 */

afterEach(() => {
  cleanup();
});

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

describe("a page header's right side", () => {
  test("may shrink to the line it is on, and is never wider than the header", () => {
    render(
      <Page title="Logs" headerRight={<nav>Viewer Insights AI</nav>}>
        <p>The page</p>
      </Page>,
    );

    const side: HTMLElement = screen.getByTestId(PAGE_HEADER_RIGHT_TEST_ID);

    expect(side).toHaveTextContent("Viewer Insights AI");
    expect(classesOf(side)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full"]),
    );
    expect(side.getAttribute("class")).toBe(PAGE_HEADER_RIGHT_CLASS_NAME);
  });

  test("keeps its place: at the end of the title's row from 640px, its items wrapping when they must", () => {
    expect(PAGE_HEADER_RIGHT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-wrap",
        "items-center",
        "sm:justify-end",
      ]),
    );
  });

  test("is not drawn for a page with nothing there", () => {
    render(
      <Page title="Logs">
        <p>The page</p>
      </Page>,
    );

    expect(screen.queryByTestId(PAGE_HEADER_RIGHT_TEST_ID)).toBeNull();
    expect(screen.getByText("The page")).toBeInTheDocument();
  });
});
