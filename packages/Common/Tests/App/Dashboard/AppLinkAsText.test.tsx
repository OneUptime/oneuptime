import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import AppLink from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink";
import {
  AppLinkAsTextContext,
  getAppLinkTextClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLinkAsText";
import Route from "../../../Types/API/Route";
import { RIGHT_TO_LEFT } from "../../../Types/ReadingDirection";

/*
 * APPLINK AS ITS WORDS (issue #6859).
 *
 * A dashboard widget's live preview, in its settings dialog, sits over a
 * board being edited, and nothing asks before leaving a board with widgets
 * not saved yet. Every list widget names its rows through AppLink, so the
 * preview gives AppLink a context that draws a link as its words: a span,
 * no address, nothing to click - with the link's colour, size and truncate,
 * and without what says "click me" (a pointer, hover's underline, a row's
 * group-hover colour, a focus ring). Out of that context a link is a link,
 * as everywhere else in the app.
 */

const BOARD_PATH: string = "/dashboard/project/dashboards/board";
const MONITOR_PATH: string = "/dashboard/project/monitors/view/1";

// The class every list widget gives a row's name.
const LIST_NAME_CLASS_NAME: string =
  "hover:underline text-gray-700 group-hover:text-blue-600";

function LocationProbe(): ReactElement {
  const location: ReturnType<typeof useLocation> = useLocation();

  return <output data-testid="app-link-location">{location.pathname}</output>;
}

function currentPath(): string {
  return screen.getByTestId("app-link-location").textContent || "";
}

function drawLink(data: {
  asText: boolean | undefined;
  link: ReactElement;
}): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[BOARD_PATH]}>
      <LocationProbe />
      {data.asText === undefined ? (
        data.link
      ) : (
        <AppLinkAsTextContext.Provider value={data.asText}>
          {data.link}
        </AppLinkAsTextContext.Provider>
      )}
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("getAppLinkTextClassName: a link's classes for its words alone", () => {
  test.each([
    ["a list widget's row name", LIST_NAME_CLASS_NAME, "text-gray-700"],
    ["nothing", undefined, ""],
    ["an empty class", "", ""],
    ["spaces only", "   ", ""],
    [
      "colour, size and truncate stay, in order",
      "text-indigo-600 text-sm font-medium truncate",
      "text-indigo-600 text-sm font-medium truncate",
    ],
    ["a pointer", "cursor-pointer text-gray-700", "text-gray-700"],
    ["an important pointer", "!cursor-pointer text-gray-700", "text-gray-700"],
    ["a pointer at a breakpoint", "md:cursor-pointer md:text-sm", "md:text-sm"],
    [
      "every hover and focus variant",
      "hover:underline group-hover:text-blue-600 peer-hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-within:ring group-focus:underline active:text-blue-900 visited:text-purple-600 text-gray-700",
      "text-gray-700",
    ],
    [
      "hover under a breakpoint or a theme",
      "md:hover:underline dark:hover:text-indigo-200 dark:text-indigo-300",
      "dark:text-indigo-300",
    ],
    ["an important hover", "hover:!text-red-500 text-red-600", "text-red-600"],
    [
      "an arbitrary value with a colon of its own",
      "[overflow-wrap:anywhere] hover:[text-decoration:underline]",
      "[overflow-wrap:anywhere]",
    ],
    [
      "a reading direction's variant",
      "rtl:text-right ltr:text-left",
      "rtl:text-right ltr:text-left",
    ],
    [
      "runs of spaces and new lines between classes",
      "  text-gray-700 \n  hover:underline\ttruncate ",
      "text-gray-700 truncate",
    ],
  ])("%s", (_name: string, className: string | undefined, expected: string) => {
    expect(getAppLinkTextClassName(className)).toBe(expected);
  });
});

describe("AppLink in its words-only context", () => {
  test("a row's name is a span with its words and its look: no address, no pointer, no hover", () => {
    drawLink({
      asText: true,
      link: (
        <AppLink
          to={new Route(MONITOR_PATH)}
          className={LIST_NAME_CLASS_NAME}
          title="Checkout API"
          dataTestId="row-name"
          dir={RIGHT_TO_LEFT}
          isCurrentPage={true}
        >
          Checkout API
        </AppLink>
      ),
    });

    const name: HTMLElement = screen.getByTestId("row-name");

    expect(name.tagName).toBe("SPAN");
    expect(name).toHaveTextContent(/^Checkout API$/);
    expect(name).toHaveAttribute("title", "Checkout API");
    expect(name).toHaveAttribute("dir", "rtl");
    expect(name.className).toBe("text-gray-700");
    expect(name).not.toHaveAttribute("href");
    expect(name).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  test("a click on it stays on the board, and says it went nowhere", () => {
    let navigated: number = 0;

    drawLink({
      asText: true,
      link: (
        <AppLink
          to={new Route(MONITOR_PATH)}
          className={LIST_NAME_CLASS_NAME}
          dataTestId="row-name"
          onNavigateComplete={() => {
            navigated++;
          }}
        >
          Checkout API
        </AppLink>
      ),
    });

    fireEvent.click(screen.getByTestId("row-name"));

    expect(currentPath()).toBe(BOARD_PATH);
    expect(navigated).toBe(0);
  });

  test("a link with nothing but a pointer for a class has no class left", () => {
    drawLink({
      asText: true,
      link: (
        <AppLink to={new Route(MONITOR_PATH)} dataTestId="row-name">
          Checkout API
        </AppLink>
      ),
    });

    expect(screen.getByTestId("row-name")).not.toHaveAttribute("class");
  });

  test("its children are drawn as they are: an icon and words", () => {
    drawLink({
      asText: true,
      link: (
        <AppLink to={new Route(MONITOR_PATH)} dataTestId="row-name">
          {[
            <svg key="icon" data-testid="row-icon" />,
            <span key="words">Checkout API</span>,
          ]}
        </AppLink>
      ),
    });

    const name: HTMLElement = screen.getByTestId("row-name");

    expect(name).toContainElement(screen.getByTestId("row-icon"));
    expect(name).toHaveTextContent("Checkout API");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AppLink out of the words-only context is a link", () => {
  test.each([
    ["with no context above it", undefined],
    ["under the context, set to false", false],
  ])(
    "%s: an <a> to its page, with its pointer, that goes there",
    (_name: string, asText: boolean | undefined) => {
      let navigated: number = 0;

      drawLink({
        asText: asText,
        link: (
          <AppLink
            to={new Route(MONITOR_PATH)}
            className={LIST_NAME_CLASS_NAME}
            dataTestId="row-name"
            onNavigateComplete={() => {
              navigated++;
            }}
          >
            Checkout API
          </AppLink>
        ),
      });

      const link: HTMLElement = screen.getByRole("link", {
        name: "Checkout API",
      });

      expect(link).toBe(screen.getByTestId("row-name"));
      expect(link).toHaveAttribute("href", MONITOR_PATH);
      expect(link).toHaveClass(
        "cursor-pointer",
        "hover:underline",
        "text-gray-700",
        "group-hover:text-blue-600",
      );

      fireEvent.click(link);

      expect(currentPath()).toBe(MONITOR_PATH);
      expect(navigated).toBe(1);
    },
  );
});
