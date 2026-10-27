import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The shared "put this in your calendar" block every feed surface renders.
 *
 * A customer reported that adding an on-call schedule to Google Calendar did
 * not work: the Google Calendar button showed an error. The button opened
 * calendar.google.com/calendar/r?cid=<the https:// link>, and Google's
 * add-by-URL page only takes the webcal:// form there ("Unable to add
 * calendar. Check the URL."). The "Apple / other apps" link was webcals://,
 * which iOS refuses to open.
 *
 * Then the card was redesigned ("Please improve the UI of this card"): every
 * part of it was the same small grey text, the subscribe buttons sat in a
 * narrow column, and a permanent paragraph about Google's refresh schedule
 * followed them. What these tests pin:
 *
 *   - one subscribe flow: "Add to your calendar" with one option per app -
 *     its name and what a click opens - then "Or copy the link" with the
 *     link as one field (FeedLinkField, tested on its own);
 *   - the Google option's cid is the webcal:// address, percent-encoded
 *     whole, and the Apple / Outlook option is webcal:// - both rebuilt from
 *     the https address, so a payload from an API before the fix (webcals://,
 *     cid=https://) still produces working links;
 *   - a schedule filter reaches every form of the link, Google's cid included;
 *   - nothing about the link's state lives here any more: the server's
 *     warnings, the truncation notice and Google's refresh note belong to
 *     the card and its status panel, which say them where they matter;
 *   - the two options sit side by side only where each has room for its
 *     name and line, and the block keeps to a reading width on its own.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import CalendarFeedLinks, {
  FEED_SECTION_HEADING_CLASS_NAME,
  SUBSCRIBE_BLOCK_ALONE_CLASS_NAME,
  SUBSCRIBE_OPTIONS_ALONE_GRID_CLASS_NAME,
  SUBSCRIBE_OPTIONS_GRID_CLASS_NAME,
  SUBSCRIBE_OPTION_CLASS_NAME,
  SUBSCRIBE_OPTION_HINT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeedLinks";
import {
  PROVIDER_LOGO_TILE_CLASS_NAME,
  getProviderLogoTileSizeClassName,
} from "../../../UI/Components/ProviderLogo/ProviderLogoImage";
import { PROVIDER_ICON_TILE_TEST_ID } from "../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";
import { FeedUrls } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import { MASK_CHARACTER } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import CalendarSubscriptionLinks, {
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
import ObjectID from "../../../Types/ObjectID";

const TOKEN: string = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

const HTTPS_URL: string = `https://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`;

const WEBCAL_URL: string = HTTPS_URL.replace("https://", "webcal://");

const URLS: FeedUrls = CalendarSubscriptionLinks.build(HTTPS_URL);

/* What an API from before the fix sends: both subscribe forms broken. */
const LEGACY_URLS: FeedUrls = {
  https: HTTPS_URL,
  webcal: HTTPS_URL.replace("https://", "webcals://"),
  googleAdd: `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}${encodeURIComponent(HTTPS_URL)}`,
};

const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function googleAddress(anchor: HTMLElement): string | null {
  return CalendarSubscriptionLinks.readGoogleCalendarAddress(
    anchor.getAttribute("href") || "",
  );
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

describe("CalendarFeedLinks", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Add to your calendar", () => {
    test("is a section of its own, headed, with one option per app", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const heading: HTMLElement = screen.getByRole("heading", {
        name: "Add to your calendar",
      });

      expect(heading.tagName).toBe("H3");
      expect(heading.className).toBe(FEED_SECTION_HEADING_CLASS_NAME);
      expect(heading.closest("section")).toHaveAttribute(
        "aria-labelledby",
        heading.id,
      );

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");
      const webcal: HTMLElement = screen.getByTestId("calendar-feed-webcal");

      expect(google.className).toBe(SUBSCRIBE_OPTION_CLASS_NAME);
      expect(webcal.className).toBe(SUBSCRIBE_OPTION_CLASS_NAME);
    });

    test("each option names its app and says what a click opens", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");
      const webcal: HTMLElement = screen.getByTestId("calendar-feed-webcal");

      expect(google).toHaveTextContent("Google Calendar");
      expect(google).toHaveTextContent("Opens Google Calendar in a new tab");
      expect(webcal).toHaveTextContent("Apple Calendar / Outlook");
      expect(webcal).toHaveTextContent("Opens the calendar app on this device");

      // The longer explanation is still there for a hover.
      expect(google).toHaveAttribute(
        "title",
        "Opens Google Calendar, which asks you to add this calendar.",
      );
      expect(webcal).toHaveAttribute(
        "title",
        "Opens the calendar app on this device that subscribes to calendar links: Apple Calendar on a Mac, iPhone or iPad, or Outlook on Windows.",
      );
    });

    /*
     * What a click opens, under the app's name, wrapped the way a person
     * would set it: on a phone "Opens Google Calendar in a new tab" broke
     * with "tab" alone on its second line.
     */
    test("what each option opens is set in small grey type that never leaves a lone last word", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(SUBSCRIBE_OPTION_HINT_CLASS_NAME.split(" ")).toEqual(
        expect.arrayContaining(["text-pretty", "text-xs", "text-gray-500"]),
      );

      for (const [id, hint] of [
        ["calendar-feed-google", "Opens Google Calendar in a new tab"],
        ["calendar-feed-webcal", "Opens the calendar app on this device"],
      ]) {
        const line: HTMLElement = screen
          .getByTestId(id as string)
          .querySelector(
            `div[class='${SUBSCRIBE_OPTION_HINT_CLASS_NAME}']`,
          ) as HTMLElement;

        expect(line).not.toBeNull();
        expect(line).toHaveTextContent(hint as string);
      }
    });

    /*
     * Official logos audit: Google Calendar is shown by its own logo, where a
     * globe stood for it; the device's calendar app - Apple Calendar or
     * Outlook, two apps - keeps a calendar, on the same neutral tile.
     */
    test("Google Calendar wears its official logo; the device's calendar app a calendar, on the same tile", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");
      const logo: Element | null = google.querySelector(
        "[data-provider-logo='google-calendar']",
      );

      expect(logo).not.toBeNull();
      // The name is written beside it: the logo is not read out again.
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(google.querySelector("[data-provider-logo]")).toBe(logo);

      const webcal: HTMLElement = screen.getByTestId("calendar-feed-webcal");
      const calendar: Element | null = webcal.querySelector(
        `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
      );

      expect(calendar).not.toBeNull();
      expect(calendar!.querySelector("svg")).not.toBeNull();
      expect(webcal.querySelector("[data-provider-logo]")).toBeNull();

      // One tile for both: the logo's neutral tile, 36 pixels square.
      for (const mark of [logo!, calendar!]) {
        const classes: Array<string> = (mark.getAttribute("class") || "")
          .split(" ")
          .filter(Boolean);

        expect(classes).toEqual(
          expect.arrayContaining([
            ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
            ...getProviderLogoTileSizeClassName(36).split(" "),
          ]),
        );
      }
    });

    test("Google Calendar is a real link to Google's add-by-URL page, in a new isolated tab", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");

      expect(google.tagName).toBe("A");
      expect(google).toHaveAttribute("target", "_blank");
      expect(google).toHaveAttribute("rel", "noopener noreferrer");

      const href: URL = new URL(google.getAttribute("href") || "");

      expect(href.origin).toBe("https://calendar.google.com");
      expect(href.pathname).toBe("/calendar/r");
    });

    test("Google's cid is the webcal:// address - with https:// Google answers 'Unable to add calendar'", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");
      const cid: string | null = new URL(
        google.getAttribute("href") || "",
      ).searchParams.get("cid");

      expect(cid).toBe(WEBCAL_URL);
      expect(cid?.startsWith("https:")).toBe(false);
      expect(googleAddress(google)).toBe(WEBCAL_URL);
    });

    test("Apple Calendar / Outlook is a real link to the webcal:// address, never webcals://, in the same tab", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const webcal: HTMLElement = screen.getByTestId("calendar-feed-webcal");

      expect(webcal.tagName).toBe("A");
      expect(webcal).toHaveAttribute("href", WEBCAL_URL);
      expect(webcal.getAttribute("href")?.startsWith("webcals:")).toBe(false);
      expect(webcal).not.toHaveAttribute("target");
    });

    test("an API from before the fix (webcals://, cid=https://) still gets working links: both are rebuilt from the https address", () => {
      render(<CalendarFeedLinks urls={LEGACY_URLS} />);

      expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
        "href",
        WEBCAL_URL,
      );
      expect(googleAddress(screen.getByTestId("calendar-feed-google"))).toBe(
        WEBCAL_URL,
      );
    });

    test("neither option shows the secret address on the page", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      for (const id of ["calendar-feed-google", "calendar-feed-webcal"]) {
        expect(screen.getByTestId(id).textContent).not.toContain(TOKEN);
        expect(screen.getByTestId(id).textContent).not.toContain(
          "on-call-calendar",
        );
      }
    });

    test("there is no third, webcal-copying button any more", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.queryByText("Copy webcal link")).not.toBeInTheDocument();
      expect(screen.queryByText("Apple / other apps")).not.toBeInTheDocument();
    });
  });

  describe("Or copy the link", () => {
    test("is a section of its own, saying what the link is for, over the link field", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const heading: HTMLElement = screen.getByRole("heading", {
        name: "Or copy the link",
      });

      expect(heading.className).toBe(FEED_SECTION_HEADING_CLASS_NAME);

      const section: HTMLElement = heading.closest("section") as HTMLElement;

      expect(section).toHaveTextContent(
        "Paste it into any calendar app that can subscribe to a calendar by URL.",
      );
      expect(section).toContainElement(
        screen.getByTestId("calendar-feed-copy"),
      );
    });

    test("the field holds the https link hidden, ending in the token's last four characters", () => {
      render(<CalendarFeedLinks urls={URLS} tokenHint="EFG!" />);

      const masked: HTMLElement = screen.getByTestId(
        "calendar-feed-link-masked",
      );
      const shown: Array<string> = Array.from(
        masked.querySelectorAll("span[aria-hidden='true']"),
      ).map((part: Element): string => {
        return part.textContent || "";
      });

      expect(shown).toEqual([
        "oneuptime.example.com/",
        `${MASK_CHARACTER.repeat(10)}EFG!`,
      ]);
      expect(masked.textContent).not.toContain(TOKEN);
      expect(screen.queryByText(HTTPS_URL)).not.toBeInTheDocument();
    });

    test("Show reveals the https link in a read-only field", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      fireEvent.click(screen.getByRole("button", { name: "Show link" }));

      expect(screen.getByTestId("calendar-feed-link-value")).toHaveValue(
        HTTPS_URL,
      );
    });

    test("the sections come in the order people use them: the app options, then the link", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const root: HTMLElement = screen.getByTestId("calendar-feed-links");
      const order: Array<string> = Array.from(
        root.querySelectorAll("[data-testid]"),
      ).map((element: Element): string => {
        return element.getAttribute("data-testid") || "";
      });

      expect(order.indexOf("calendar-feed-google")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("calendar-feed-google")).toBeLessThan(
        order.indexOf("calendar-feed-webcal"),
      );
      expect(order.indexOf("calendar-feed-webcal")).toBeLessThan(
        order.indexOf("calendar-feed-copy"),
      );
    });
  });

  describe("a schedule filter", () => {
    test("narrows every form of the link, Google's cid included", () => {
      render(<CalendarFeedLinks urls={URLS} scheduleId={SCHEDULE_ID} />);

      const filteredHttps: string = `${HTTPS_URL}?schedule=${SCHEDULE_ID.toString()}`;
      const filteredWebcal: string = `${WEBCAL_URL}?schedule=${SCHEDULE_ID.toString()}`;

      fireEvent.click(screen.getByRole("button", { name: "Show link" }));

      expect(screen.getByTestId("calendar-feed-link-value")).toHaveValue(
        filteredHttps,
      );

      expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
        "href",
        filteredWebcal,
      );

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");

      expect(googleAddress(google)).toBe(filteredWebcal);
      // The query string travels inside cid, not as a parameter of Google's URL.
      expect(
        Array.from(
          new URL(google.getAttribute("href") || "").searchParams.keys(),
        ),
      ).toEqual(["cid"]);
    });

    test("a string schedule id works the same as an ObjectID", () => {
      render(<CalendarFeedLinks urls={URLS} scheduleId="sched-string" />);

      expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
        "href",
        `${WEBCAL_URL}?schedule=sched-string`,
      );
    });
  });

  /*
   * Google's refresh schedule used to be a paragraph under the buttons,
   * whatever app the reader used, and the server's warnings sat under the
   * link. The card says those things now, where they matter.
   */
  describe("what it leaves to the card", () => {
    test("no refresh note, no reachability line and no warnings inside the block", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      for (const id of [
        "calendar-feed-refresh-alert",
        "calendar-feed-google-refresh-note",
        "calendar-feed-reachability",
        "calendar-feed-host-warning",
        "calendar-feed-protocol-warning",
        "calendar-feed-private-host-warning",
        "calendar-feed-truncated-warning",
      ]) {
        expect(screen.queryByTestId(id)).not.toBeInTheDocument();
      }

      expect(
        screen.queryByText("Troubleshooting and per-app steps"),
      ).not.toBeInTheDocument();
    });
  });

  describe("layout", () => {
    test("beside the status, the options stack wherever each would be narrower than its name", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const grid: HTMLElement = screen.getByTestId("calendar-feed-google")
        .parentElement as HTMLElement;

      expect(grid.className).toBe(SUBSCRIBE_OPTIONS_GRID_CLASS_NAME);
      expect(classesOf(grid)).toEqual(
        expect.arrayContaining([
          "grid-cols-1",
          "sm:grid-cols-2",
          "md:grid-cols-1",
          "lg:grid-cols-2",
          "xl:grid-cols-1",
          "2xl:grid-cols-2",
        ]),
      );
      expect(
        classesOf(screen.getByTestId("calendar-feed-links")),
      ).not.toContain(SUBSCRIBE_BLOCK_ALONE_CLASS_NAME);
    });

    test("alone across a card, the options sit side by side from lg up and the block keeps a reading width", () => {
      render(<CalendarFeedLinks urls={URLS} isAlone={true} />);

      const grid: HTMLElement = screen.getByTestId("calendar-feed-google")
        .parentElement as HTMLElement;

      expect(grid.className).toBe(SUBSCRIBE_OPTIONS_ALONE_GRID_CLASS_NAME);
      expect(classesOf(grid)).not.toContain("xl:grid-cols-1");
      expect(classesOf(screen.getByTestId("calendar-feed-links"))).toContain(
        SUBSCRIBE_BLOCK_ALONE_CLASS_NAME,
      );
    });
  });

  test("idPrefix namespaces every test id so two blocks on one page stay distinct", () => {
    render(<CalendarFeedLinks urls={URLS} idPrefix="shared" />);

    expect(screen.getByTestId("shared-links")).toBeInTheDocument();
    expect(screen.getByTestId("shared-google")).toBeInTheDocument();
    expect(screen.getByTestId("shared-webcal")).toBeInTheDocument();
    expect(screen.getByTestId("shared-copy")).toBeInTheDocument();
    expect(screen.getByTestId("shared-link-masked")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-feed-links")).not.toBeInTheDocument();

    // The headings' ids too, so two sections are never labelled by one heading.
    expect(
      screen.getByRole("heading", { name: "Add to your calendar" }).id,
    ).toBe("shared-add-heading");
    expect(screen.getByRole("heading", { name: "Or copy the link" }).id).toBe(
      "shared-copy-heading",
    );
  });
});
