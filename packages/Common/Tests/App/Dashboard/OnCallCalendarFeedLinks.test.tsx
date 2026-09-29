import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The shared "put this in your calendar" block. What matters here is that each
 * of the three subscribe actions points at the RIGHT form of the same link
 * (Google wants the https URL behind its cid parameter, Apple wants webcal,
 * Outlook wants webcal pasted), that the secret stays hidden until asked for,
 * and that the schedule filter - when the block is narrowed to one schedule -
 * reaches all three forms, not just the visible one.
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

import CalendarFeedLinks from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeedLinks";
import { FeedUrls } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
  buildGoogleAddUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import ObjectID from "../../../Types/ObjectID";

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";
const WEBCAL_URL: string = HTTPS_URL.replace("https:", "webcals:");

const URLS: FeedUrls = {
  https: HTTPS_URL,
  webcal: WEBCAL_URL,
  googleAdd: buildGoogleAddUrl(HTTPS_URL),
};

const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const windowOpenMock: MockFunction = getJestMockFunction();

describe("CalendarFeedLinks", () => {
  beforeEach(() => {
    windowOpenMock.mockReset();
    Object.defineProperty(window, "open", {
      value: windowOpenMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("keeps the https link hidden until the reader reveals it", () => {
    render(<CalendarFeedLinks urls={URLS} />);

    expect(screen.queryByText(HTTPS_URL)).not.toBeInTheDocument();
    expect(screen.getByRole("hidden-text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("hidden-text"));

    expect(screen.getByRole("revealed-text")).toHaveTextContent(HTTPS_URL);
  });

  test("the copy buttons carry the https and webcal forms respectively", () => {
    render(<CalendarFeedLinks urls={URLS} />);

    // Copy https link (the button next to the hidden text) and Copy webcal link.
    expect(
      screen.getByRole("button", { name: "Copy https link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Outlook: Add calendar, then Subscribe from web, then paste this link.",
      }),
    ).toHaveTextContent("Copy webcal link");
  });

  test("the Apple / other apps action is a real anchor to the webcal URL", () => {
    render(<CalendarFeedLinks urls={URLS} />);

    const anchor: HTMLElement = screen.getByTestId("calendar-feed-webcal");

    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute("href", WEBCAL_URL);
    expect(anchor).toHaveTextContent("Apple / other apps");
  });

  test("the Google button opens the cid deep link in a new, isolated window", () => {
    render(<CalendarFeedLinks urls={URLS} />);

    fireEvent.click(screen.getByTestId("calendar-feed-google"));

    expect(windowOpenMock).toHaveBeenCalledTimes(1);
    expect(windowOpenMock).toHaveBeenCalledWith(
      URLS.googleAdd,
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("a schedule filter narrows every form of the link, including the Google one", () => {
    render(<CalendarFeedLinks urls={URLS} scheduleId={SCHEDULE_ID} />);

    const filteredHttps: string = `${HTTPS_URL}?schedule=${SCHEDULE_ID.toString()}`;

    fireEvent.click(screen.getByRole("hidden-text"));
    expect(screen.getByRole("revealed-text")).toHaveTextContent(filteredHttps);

    expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
      "href",
      `${WEBCAL_URL}?schedule=${SCHEDULE_ID.toString()}`,
    );

    fireEvent.click(screen.getByTestId("calendar-feed-google"));
    expect(windowOpenMock).toHaveBeenCalledWith(
      buildGoogleAddUrl(filteredHttps),
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("a string schedule id works the same as an ObjectID", () => {
    render(<CalendarFeedLinks urls={URLS} scheduleId="sched-string" />);

    expect(screen.getByTestId("calendar-feed-webcal")).toHaveAttribute(
      "href",
      `${WEBCAL_URL}?schedule=sched-string`,
    );
  });

  test("server warnings render only when the server sent them", () => {
    const { rerender } = render(<CalendarFeedLinks urls={URLS} />);

    expect(
      screen.queryByTestId("calendar-feed-host-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-feed-protocol-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-feed-truncated-warning"),
    ).not.toBeInTheDocument();

    rerender(
      <CalendarFeedLinks
        urls={URLS}
        hostWarning="Set HOST to your public hostname"
        protocolWarning="This link will travel unencrypted"
        lastRenderTruncated={true}
      />,
    );

    expect(screen.getByTestId("calendar-feed-host-warning")).toHaveTextContent(
      "Set HOST to your public hostname",
    );
    expect(
      screen.getByTestId("calendar-feed-protocol-warning"),
    ).toHaveTextContent("This link will travel unencrypted");
    expect(
      screen.getByTestId("calendar-feed-truncated-warning"),
    ).toHaveTextContent(
      "shortened because it would have exceeded the event limit",
    );
  });

  test("the refresh alert carries the cadence copy, the reachability sentence and a docs link", () => {
    render(<CalendarFeedLinks urls={URLS} />);

    const alert: HTMLElement = screen.getByTestId(
      "calendar-feed-refresh-alert",
    );

    expect(alert).toHaveTextContent(REFRESH_CADENCE_COPY);
    expect(alert).toHaveTextContent(REACHABILITY_COPY);
    expect(alert).toHaveTextContent(
      "Google Calendar and Outlook on the web fetch this link from their servers; it must be reachable from the internet.",
    );

    const docsLink: HTMLElement = screen.getByText(
      "Troubleshooting and per-app steps",
    );
    const anchor: HTMLElement | null = docsLink.closest("a");

    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toContain("/on-call/calendar-feeds");
    expect(anchor!.getAttribute("target")).toBe("_blank");
  });

  test("the refresh alert can be switched off when the page renders it once elsewhere", () => {
    render(<CalendarFeedLinks urls={URLS} showRefreshAlert={false} />);

    expect(
      screen.queryByTestId("calendar-feed-refresh-alert"),
    ).not.toBeInTheDocument();
    // The links themselves are still there.
    expect(screen.getByTestId("calendar-feed-webcal")).toBeInTheDocument();
  });

  test("idPrefix namespaces every test id so two blocks on one page stay distinct", () => {
    render(<CalendarFeedLinks urls={URLS} idPrefix="shared" />);

    expect(screen.getByTestId("shared-links")).toBeInTheDocument();
    expect(screen.getByTestId("shared-google")).toBeInTheDocument();
    expect(screen.getByTestId("shared-webcal")).toBeInTheDocument();
    expect(screen.getByTestId("shared-refresh-alert")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-feed-links")).not.toBeInTheDocument();
  });
});
