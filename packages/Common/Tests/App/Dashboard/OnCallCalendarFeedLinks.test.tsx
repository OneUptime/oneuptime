import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

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
 * What these tests pin:
 *   - one subscribe flow: "Add to your calendar" with two buttons of equal
 *     weight (Google Calendar; Apple Calendar / Outlook), then "Or copy the
 *     link", then a short note;
 *   - the Google button's cid is the webcal:// address, percent-encoded whole,
 *     and the Apple / Outlook link is webcal:// - both rebuilt from the https
 *     address, so a payload from an API before the fix (webcals://,
 *     cid=https://) still produces working links;
 *   - a schedule filter reaches every form of the link, Google's cid included;
 *   - the link stays hidden until asked for, and the copy button copies the
 *     https link;
 *   - the note says that Google refreshes on its own schedule, and only on a
 *     self-hosted install - with no warning already saying so - that Google
 *     must reach the server from the internet.
 */

let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

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
  SUBSCRIBE_LINK_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeedLinks";
import { FeedUrls } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  PRIVATE_HOST_COPY,
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import CalendarSubscriptionLinks, {
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
import ObjectID from "../../../Types/ObjectID";

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

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

describe("CalendarFeedLinks", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
  });

  afterEach(() => {
    cleanup();
  });

  describe("Add to your calendar", () => {
    test("two subscribe buttons of equal weight, in a section of their own", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.getByText("Add to your calendar")).toBeInTheDocument();

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");
      const webcal: HTMLElement = screen.getByTestId("calendar-feed-webcal");

      expect(google).toHaveTextContent("Google Calendar");
      expect(webcal).toHaveTextContent("Apple Calendar / Outlook");
      expect(google.className).toBe(SUBSCRIBE_LINK_CLASS_NAME);
      expect(webcal.className).toBe(SUBSCRIBE_LINK_CLASS_NAME);
    });

    test("Google Calendar is a real link to Google's add-by-URL page, in a new isolated tab", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const google: HTMLElement = screen.getByTestId("calendar-feed-google");

      expect(google.tagName).toBe("A");
      expect(google).toHaveAttribute("target", "_blank");
      expect(google).toHaveAttribute("rel", "noopener noreferrer");
      expect(
        google
          .getAttribute("href")
          ?.startsWith("https://calendar.google.com/calendar/r?cid="),
      ).toBe(true);
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

    test("Apple Calendar / Outlook is a real link to the webcal:// address, never webcals://", () => {
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

    test("each button says what it opens", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.getByTestId("calendar-feed-google")).toHaveAttribute(
        "title",
        "Opens Google Calendar, which asks you to add this calendar.",
      );
      expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
        "title",
        "Opens the calendar app on this device that subscribes to calendar links: Apple Calendar on a Mac, iPhone or iPad, or Outlook on Windows.",
      );
    });

    test("neither button shows the secret address on the page", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(
        screen.getByTestId("calendar-feed-google").textContent,
      ).not.toContain("on-call-calendar");
      expect(
        screen.getByTestId("calendar-feed-webcal").textContent,
      ).not.toContain("on-call-calendar");
    });

    test("there is no third, webcal-copying button any more", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.queryByText("Copy webcal link")).not.toBeInTheDocument();
      expect(screen.queryByText("Apple / other apps")).not.toBeInTheDocument();
    });
  });

  describe("Or copy the link", () => {
    test("keeps the https link hidden until the reader reveals it", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.queryByText(HTTPS_URL)).not.toBeInTheDocument();
      expect(screen.getByRole("hidden-text")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("hidden-text"));

      expect(screen.getByRole("revealed-text")).toHaveTextContent(HTTPS_URL);
    });

    test("says what the link is for and offers one Copy link button for the https address", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      expect(screen.getByText("Or copy the link")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Paste it into any calendar app that can subscribe to a calendar by URL.",
        ),
      ).toBeInTheDocument();

      const copy: HTMLElement = screen.getByRole("button", {
        name: "Copy https link",
      });

      expect(copy).toHaveTextContent("Copy link");
      expect(
        within(screen.getByTestId("calendar-feed-copy")).getAllByRole("button"),
      ).toHaveLength(1);
    });

    test("the Copy link button puts the https address on the clipboard", async () => {
      const writeText: MockFunction = getJestMockFunction();
      writeText.mockResolvedValue(undefined);

      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      render(<CalendarFeedLinks urls={URLS} />);

      fireEvent.click(screen.getByRole("button", { name: "Copy https link" }));

      await screen.findByText("Copied!");

      expect(writeText).toHaveBeenCalledWith(HTTPS_URL);
    });
  });

  describe("a schedule filter", () => {
    test("narrows every form of the link, Google's cid included", () => {
      render(<CalendarFeedLinks urls={URLS} scheduleId={SCHEDULE_ID} />);

      const filteredHttps: string = `${HTTPS_URL}?schedule=${SCHEDULE_ID.toString()}`;
      const filteredWebcal: string = `${WEBCAL_URL}?schedule=${SCHEDULE_ID.toString()}`;

      fireEvent.click(screen.getByRole("hidden-text"));
      expect(screen.getByRole("revealed-text")).toHaveTextContent(
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

  describe("warnings", () => {
    test("server warnings render only when the server sent them", () => {
      const { rerender } = render(<CalendarFeedLinks urls={URLS} />);

      for (const id of [
        "calendar-feed-host-warning",
        "calendar-feed-protocol-warning",
        "calendar-feed-private-host-warning",
        "calendar-feed-truncated-warning",
      ]) {
        expect(screen.queryByTestId(id)).not.toBeInTheDocument();
      }

      rerender(
        <CalendarFeedLinks
          urls={URLS}
          hostWarning="Set HOST to your public hostname"
          protocolWarning="This link will travel unencrypted"
          lastRenderTruncated={true}
        />,
      );

      expect(
        screen.getByTestId("calendar-feed-host-warning"),
      ).toHaveTextContent("Set HOST to your public hostname");
      expect(
        screen.getByTestId("calendar-feed-protocol-warning"),
      ).toHaveTextContent("This link will travel unencrypted");
      expect(
        screen.getByTestId("calendar-feed-truncated-warning"),
      ).toHaveTextContent(
        "shortened because it would have exceeded the event limit",
      );
    });

    test("a private HOST is named, with what still works", () => {
      render(<CalendarFeedLinks urls={URLS} privateHost="10.20.0.15" />);

      const warning: HTMLElement = screen.getByTestId(
        "calendar-feed-private-host-warning",
      );

      expect(warning).toHaveTextContent(
        PRIVATE_HOST_COPY.replace("{{host}}", "10.20.0.15"),
      );
      expect(warning).toHaveTextContent(
        "Apple Calendar or Outlook on a computer in your network can still subscribe.",
      );
      expect(warning.textContent).not.toContain("{{host}}");
    });

    test("the private-host warning stays away when the HOST warning already says nothing outside can reach the link", () => {
      render(
        <CalendarFeedLinks
          urls={URLS}
          hostWarning="HOST is not set to a public address"
          privateHost="10.20.0.15"
        />,
      );

      expect(
        screen.getByTestId("calendar-feed-host-warning"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("calendar-feed-private-host-warning"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the note", () => {
    test("says Google refreshes on its own schedule, and links to the per-app steps", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const note: HTMLElement = screen.getByTestId(
        "calendar-feed-refresh-alert",
      );

      expect(note).toHaveTextContent(REFRESH_CADENCE_COPY);
      expect(REFRESH_CADENCE_COPY).toContain("every few hours");
      expect(REFRESH_CADENCE_COPY).toContain("Google Calendar");

      const anchor: HTMLElement | null = within(note)
        .getByText("Troubleshooting and per-app steps")
        .closest("a");

      expect(anchor).not.toBeNull();
      expect(anchor!.getAttribute("href")).toContain("/on-call/calendar-feeds");
      expect(anchor!.getAttribute("target")).toBe("_blank");
    });

    test("is a quiet note, not an info banner", () => {
      render(<CalendarFeedLinks urls={URLS} />);

      const note: HTMLElement = screen.getByTestId(
        "calendar-feed-refresh-alert",
      );

      expect(note.className).toContain("text-gray-500");
      expect(note.className).not.toContain("bg-");
      expect(note.querySelector("[role='alert']")).toBeNull();
      expect(REFRESH_CADENCE_COPY.length).toBeLessThan(260);
    });

    test("on a self-hosted install it says Google must reach the server from the internet", () => {
      billingEnabledForTest = false;

      render(<CalendarFeedLinks urls={URLS} />);

      expect(
        screen.getByTestId("calendar-feed-reachability"),
      ).toHaveTextContent(REACHABILITY_COPY);
    });

    test("on OneUptime Cloud, which is always reachable, it does not", () => {
      billingEnabledForTest = true;

      render(<CalendarFeedLinks urls={URLS} />);

      expect(
        screen.getByTestId("calendar-feed-refresh-alert"),
      ).toHaveTextContent(REFRESH_CADENCE_COPY);
      expect(
        screen.queryByTestId("calendar-feed-reachability"),
      ).not.toBeInTheDocument();
    });

    test("it is not said twice when a warning above already says the server cannot be reached", () => {
      const { rerender } = render(
        <CalendarFeedLinks urls={URLS} privateHost="oneuptime.internal" />,
      );

      expect(
        screen.queryByTestId("calendar-feed-reachability"),
      ).not.toBeInTheDocument();

      rerender(
        <CalendarFeedLinks urls={URLS} hostWarning="HOST is localhost" />,
      );

      expect(
        screen.queryByTestId("calendar-feed-reachability"),
      ).not.toBeInTheDocument();
    });

    test("can be switched off when the page renders it once elsewhere", () => {
      render(<CalendarFeedLinks urls={URLS} showRefreshAlert={false} />);

      expect(
        screen.queryByTestId("calendar-feed-refresh-alert"),
      ).not.toBeInTheDocument();
      // The links themselves are still there.
      expect(screen.getByTestId("calendar-feed-webcal")).toBeInTheDocument();
      expect(screen.getByTestId("calendar-feed-google")).toBeInTheDocument();
    });
  });

  test("the sections come in the order people use them: buttons, copy, warnings, note", () => {
    render(
      <CalendarFeedLinks
        urls={URLS}
        protocolWarning="This link will travel unencrypted"
      />,
    );

    const root: HTMLElement = screen.getByTestId("calendar-feed-links");
    const order: Array<string> = Array.from(
      root.querySelectorAll("[data-testid]"),
    ).map((element: Element): string => {
      return element.getAttribute("data-testid") || "";
    });

    const position: (id: string) => number = (id: string): number => {
      return order.indexOf(id);
    };

    expect(position("calendar-feed-google")).toBeGreaterThanOrEqual(0);
    expect(position("calendar-feed-google")).toBeLessThan(
      position("calendar-feed-webcal"),
    );
    expect(position("calendar-feed-webcal")).toBeLessThan(
      position("calendar-feed-copy"),
    );
    expect(position("calendar-feed-copy")).toBeLessThan(
      position("calendar-feed-protocol-warning"),
    );
    expect(position("calendar-feed-protocol-warning")).toBeLessThan(
      position("calendar-feed-refresh-alert"),
    );
  });

  test("idPrefix namespaces every test id so two blocks on one page stay distinct", () => {
    render(
      <CalendarFeedLinks urls={URLS} idPrefix="shared" privateHost="x.lan" />,
    );

    expect(screen.getByTestId("shared-links")).toBeInTheDocument();
    expect(screen.getByTestId("shared-google")).toBeInTheDocument();
    expect(screen.getByTestId("shared-webcal")).toBeInTheDocument();
    expect(screen.getByTestId("shared-copy")).toBeInTheDocument();
    expect(
      screen.getByTestId("shared-private-host-warning"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("shared-refresh-alert")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-feed-links")).not.toBeInTheDocument();
  });
});
