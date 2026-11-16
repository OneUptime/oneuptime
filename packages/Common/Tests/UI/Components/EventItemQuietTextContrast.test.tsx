/*
 * A status page's event card - an incident, an announcement, a maintenance
 * event, on the overview and on each list - ends with the way to its own
 * page, "View Incident", and frames its resources with "Affected
 * resources". Both were gray-400: 2.5:1 on the white card, under WCAG AA's
 * 4.5:1 for text, and the one link a visitor needs read as switched off.
 * So was the uptime bars' shared scale, "90 days ago" ... "Today" (#9016).
 *
 * Held here without a browser, as SecondaryLinkContrast holds the
 * Dashboard's quiet links: each colour as the Tailwind palette paints it on
 * the light cards these sit on, and as Theme.css repaints it in the dark
 * theme on its card surfaces - each at least 4.5:1. Then an event card is
 * drawn, to see that its link, its label and its mini description carry
 * those classes.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import * as React from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Color from "../../../Types/Color";
import Route from "../../../Types/API/Route";
import StatusPageGroupNestingLayoutUtil from "../../../Utils/StatusPage/GroupNestingLayout";
import EventItem, {
  EVENT_ITEM_QUIET_TEXT_CLASS_NAME,
  EVENT_ITEM_VIEW_LINK_CLASS_NAME,
} from "../../../UI/Components/EventItem/EventItem";
import {
  DARK_SURFACES,
  LIGHT_SURFACES,
  TAILWIND_GRAYS,
  TOO_LIGHT_GRAY_TEXT,
  WCAG_AA_TEXT,
  darkContrastOf,
  lightContrastOf,
  shadeOf,
} from "../GrayTextContrast";

// What is held to 4.5:1, with the class list that paints it.
const QUIET_TEXTS: Array<[string, string]> = [
  [
    "View Incident, the card's way to its page",
    EVENT_ITEM_VIEW_LINK_CLASS_NAME,
  ],
  [
    "Affected resources and the mini description",
    EVENT_ITEM_QUIET_TEXT_CLASS_NAME,
  ],
  [
    "the uptime bars' scale, 90 days ago ... Today",
    StatusPageGroupNestingLayoutUtil.getTimeAxisClassName(),
  ],
];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("a status page's event card reads: WCAG AA in both themes (#9016)", () => {
  describe.each(QUIET_TEXTS)("%s", (_name: string, className: string) => {
    const shade: string = shadeOf(className, "text-gray-");

    test.each(LIGHT_SURFACES)(
      "is at least 4.5:1 on %s",
      (_surface: string, surface: string) => {
        expect(lightContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test.each(DARK_SURFACES)(
      "is at least 4.5:1 on %s in the dark theme",
      (_surface: string, surface: string) => {
        expect(darkContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test("is never gray-400 or lighter again", () => {
      expect(className).not.toMatch(TOO_LIGHT_GRAY_TEXT);
    });
  });

  test("gray-400, what they were, is under 4.5:1 on white: the reason for all this", () => {
    expect(lightContrastOf("400", "#ffffff")).toBeLessThan(WCAG_AA_TEXT);
    expect(TAILWIND_GRAYS["gray-400"]).toBe("#9ca3af");
  });

  test("the pointer darkens the link and underlines it, and focus rings it", () => {
    const hover: string = shadeOf(
      EVENT_ITEM_VIEW_LINK_CLASS_NAME,
      "hover:text-gray-",
    );

    expect(lightContrastOf(hover, "#ffffff")).toBeGreaterThan(
      lightContrastOf(
        shadeOf(EVENT_ITEM_VIEW_LINK_CLASS_NAME, "text-gray-"),
        "#ffffff",
      ),
    );
    expect(EVENT_ITEM_VIEW_LINK_CLASS_NAME.split(" ")).toContain(
      "hover:underline",
    );
    expect(EVENT_ITEM_VIEW_LINK_CLASS_NAME).toMatch(/focus-visible:ring-2/);
  });

  test("the scale stays a scale: as small as it was, quiet in size and not in contrast", () => {
    const axis: string =
      StatusPageGroupNestingLayoutUtil.getTimeAxisClassName();

    expect(axis.split(" ")).toContain("text-[11px]");
    expect(axis.split(" ")).toContain("justify-between");
  });
});

describe("an event card carries those classes", () => {
  function renderCard(): void {
    render(
      <EventItem
        eventTitle="Webhook deliveries are delayed"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={false}
        eventSecondDescription="Declared at Nov 16 2026, 11:44 GMT"
        eventMiniDescription="Updated a minute ago"
        eventResourcesAffected={["Webhooks"]}
        eventViewRoute={Route.fromString(
          "/status-page/00000000-0000-4000-8000-000000000001/incidents/00000000-0000-4000-8000-000000000500",
        )}
        eventTimeline={[]}
      />,
    );
  }

  test("its View link is the quiet link that reads, and goes to the event", () => {
    renderCard();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Incident",
    });

    for (const className of EVENT_ITEM_VIEW_LINK_CLASS_NAME.split(" ")) {
      expect(link).toHaveClass(className);
    }

    expect(link).not.toHaveClass("text-gray-400");
    expect(link).toHaveAttribute(
      "href",
      "/status-page/00000000-0000-4000-8000-000000000001/incidents/00000000-0000-4000-8000-000000000500",
    );
  });

  test("Affected resources and the mini description are the quiet text that reads", () => {
    renderCard();

    for (const words of ["Affected resources", "Updated a minute ago"]) {
      const element: HTMLElement = screen.getByText(words);

      for (const className of EVENT_ITEM_QUIET_TEXT_CLASS_NAME.split(" ")) {
        expect(element).toHaveClass(className);
      }

      expect(element).not.toHaveClass("text-gray-400");
    }
  });

  test("a card with no page to go to draws no link", () => {
    render(
      <EventItem
        eventTitle="Database upgrade"
        eventType="Scheduled Maintenance"
        eventTypeColor={new Color("#f59e0b")}
        isDetailItem={true}
        eventSecondDescription="Scheduled at Nov 16 2026, 12:44 GMT"
        eventTimeline={[]}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
