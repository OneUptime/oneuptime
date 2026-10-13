import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import {
  CARD_RULED_BODY_CLASS_NAME,
  CardSurface,
  CardSurfaceContext,
} from "../../../UI/Components/Card/CardSurface";
import FeedCardFooter, {
  FEED_CARD_FOOTER_CLASS_NAME,
  FEED_CARD_FOOTER_SECTION_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedCardFooter";

/*
 * The calendar link card's quiet footer - the personal link's pointer to the
 * On-Call Time Log, the shared link's "it belongs to the project".
 *
 * On a page it is the card's ruled body (CardSurface): edge to edge under a
 * rule across the card, on the card's grey. CardInCardGuard holds every
 * ruled body to that one class, so that in a section of another card - where
 * a rule across would read as a section's divider - it loses the rule. Here:
 * the footer takes the ruled body's class rather than spelling one out, and
 * in a section it is a plain grey line with no rule, ground or edges.
 */

const TOKENS: RegExp = /\s+/;

function footer(): ReactElement {
  return (
    <FeedCardFooter icon={IconProp.Clock} dataTestId="feed-footer">
      This calendar is for planning.
    </FeedCardFooter>
  );
}

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(TOKENS);
}

describe("the calendar link card's footer", () => {
  afterEach(() => {
    cleanup();
  });

  test("on a page: the card's ruled body, filled grey, its corners the card's", () => {
    render(footer());

    const strip: HTMLElement = screen.getByTestId("feed-footer");

    expect(strip.className).toBe(FEED_CARD_FOOTER_CLASS_NAME);
    expect(strip.className.startsWith(`${CARD_RULED_BODY_CLASS_NAME} `)).toBe(
      true,
    );

    for (const token of CARD_RULED_BODY_CLASS_NAME.split(TOKENS)) {
      expect(classesOf(strip)).toContain(token);
    }

    for (const token of ["rounded-b-xl", "bg-gray-50", "text-xs"]) {
      expect(classesOf(strip)).toContain(token);
    }
  });

  test("in a section of another card: the same grey line, with no rule, ground or edges", () => {
    render(
      <CardSurfaceContext.Provider value={CardSurface.Section}>
        {footer()}
      </CardSurfaceContext.Provider>,
    );

    const line: HTMLElement = screen.getByTestId("feed-footer");

    expect(line.className).toBe(FEED_CARD_FOOTER_SECTION_CLASS_NAME);

    for (const token of [
      "border-t",
      "-mx-5",
      "md:-mx-6",
      "-mb-6",
      "bg-gray-50",
      "rounded-b-xl",
    ]) {
      expect(classesOf(line)).not.toContain(token);
    }

    expect(classesOf(line)).toEqual(
      expect.arrayContaining(["text-xs", "text-gray-500"]),
    );
  });

  test("an icon, then the note as one paragraph, on either surface", () => {
    for (const surface of [CardSurface.Page, CardSurface.Section]) {
      render(
        <CardSurfaceContext.Provider value={surface}>
          {footer()}
        </CardSurfaceContext.Provider>,
      );

      const strip: HTMLElement = screen.getByTestId("feed-footer");
      const paragraph: HTMLElement | null = strip.querySelector("p");
      const mark: Element | null = strip.firstElementChild;

      // The icon comes first: an svg, or the element Icon wraps one in.
      expect(mark).not.toBe(paragraph);
      expect(
        mark?.tagName.toLowerCase() === "svg" ||
          mark?.querySelector("svg") !== null,
      ).toBe(true);
      expect(paragraph).toHaveTextContent("This calendar is for planning.");
      expect(strip.lastElementChild).toBe(paragraph);
      expect(strip.children).toHaveLength(2);

      cleanup();
    }
  });
});
