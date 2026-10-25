import EventHeaderSkeleton from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventHeaderSkeleton";
import EventOverviewSkeleton from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventOverviewSkeleton";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The header's placeholder while its states and timeline load: drawn as the
 * loaded header is - number and pills with the buttons beside them, the
 * title, the state track and the facts, on the same card, laid out by the
 * same width - so neither the swap from the page's skeleton nor the swap to
 * the real header moves the page. Every header's own placeholder (incident,
 * alert, episode, scheduled maintenance) and the overview's skeleton draw it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (key === "Loading incident status") {
            return "Vorfallsstatus wird geladen";
          }

          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
});

describe("EventHeaderSkeleton", () => {
  test("is the header's own card: a size container with the header's border and shadow", () => {
    render(<EventHeaderSkeleton testId="incident-state-placeholder" />);

    expect(screen.getByTestId("incident-state-placeholder")).toHaveClass(
      "relative",
      "rounded-xl",
      "border",
      "border-gray-200",
      "bg-white",
      "shadow-sm",
      "[container-type:inline-size]",
    );
  });

  test("says what loads, in the reader's language, as a polite status", () => {
    render(
      <EventHeaderSkeleton
        testId="incident-state-placeholder"
        loadingText="Loading incident status"
      />,
    );

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toBe(screen.getByTestId("incident-state-placeholder"));
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Vorfallsstatus wird geladen");
    // Only the sentence is read: every block is decoration.
    expect(status.textContent).toBe("Vorfallsstatus wird geladen");
  });

  test("says nothing of its own where the page around it already says it loads", () => {
    render(<EventHeaderSkeleton testId="event-overview-skeleton-hero" />);

    const placeholder: HTMLElement = screen.getByTestId(
      "event-overview-skeleton-hero",
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(placeholder).not.toHaveAttribute("aria-live");
    expect(placeholder.textContent).toBe("");
  });

  test("holds room for as many buttons and facts as the loaded header will have", () => {
    render(
      <EventHeaderSkeleton
        testId="alert-state-placeholder"
        buttonCount={3}
        factCount={4}
      />,
    );

    const placeholder: HTMLElement = screen.getByTestId(
      "alert-state-placeholder",
    );
    const buttons: Array<Element> = Array.from(
      placeholder.querySelectorAll(".h-9.rounded-md"),
    );

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveClass("w-32");
    expect(buttons[1]).toHaveClass("w-24");
    expect(buttons[2]).toHaveClass("w-36");

    const facts: Element = placeholder.querySelector(".grid.border-t")!;

    expect(facts.children).toHaveLength(4);
    // The loaded facts' grid: four facts in two rows of two, then one row of four.
    expect(facts).toHaveClass(
      "[@container(min-width:18rem)]:grid-cols-2",
      "[@container(min-width:50rem)]:grid-cols-4",
    );
    expect(facts.className).not.toContain("grid-cols-3");
    expect(facts.className).not.toContain("grid-cols-5");
  });

  test("defaults to two buttons and four facts", () => {
    render(<EventHeaderSkeleton testId="placeholder" />);

    const placeholder: HTMLElement = screen.getByTestId("placeholder");

    expect(placeholder.querySelectorAll(".h-9.rounded-md")).toHaveLength(2);
    expect(placeholder.querySelector(".grid.border-t")!.children).toHaveLength(
      4,
    );
  });

  test("draws no facts row for a header without facts", () => {
    render(<EventHeaderSkeleton testId="placeholder" factCount={0} />);

    expect(
      screen.getByTestId("placeholder").querySelector(".border-t"),
    ).toBeNull();
  });

  test("draws the state track: three steps over their segments", () => {
    render(<EventHeaderSkeleton testId="placeholder" />);

    const track: Element = screen
      .getByTestId("placeholder")
      .querySelector(".grid.grid-cols-3")!;

    expect(track.children).toHaveLength(3);
    for (const step of Array.from(track.children)) {
      expect(step.querySelector(".h-1\\.5.rounded-full")).not.toBeNull();
    }
  });

  test("pulses only for a reader who has not asked for less motion, and offers nothing to press", () => {
    const { container } = render(
      <EventHeaderSkeleton testId="placeholder" loadingText="Loading" />,
    );

    expect(
      container.querySelector('[class~="motion-safe:animate-pulse"]'),
    ).not.toBeNull();
    expect(container.querySelector('[class~="animate-pulse"]')).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the overview's skeleton draws the same header", () => {
  test("its hero is the header's placeholder, inside the page's one status", () => {
    render(<EventOverviewSkeleton loadingText="Loading incident" />);

    const hero: HTMLElement = screen.getByTestId(
      "event-overview-skeleton-hero",
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(hero).toHaveClass("[container-type:inline-size]");
    expect(hero.querySelectorAll(".h-9.rounded-md")).toHaveLength(2);
  });
});
