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
 * Is the link working? The status panel beside a calendar link's subscribe
 * options.
 *
 * It replaced one line of grey bookkeeping ("Not fetched yet · link ending in
 * …sMG4") and a permanent paragraph about Google Calendar's refresh schedule
 * that every reader got, whatever app they used. What these tests pin:
 *
 *   - a pill that names the state - Active, Waiting for first sync, Not
 *     fetched yet, Disabled, Needs regeneration - and only one at a time,
 *     in the order the questions matter (unreadable, off, read, how long);
 *   - the sentence under it: when the link was last read and by which app,
 *     in words ("7 minutes ago", never moment's "a day ago"), or what the
 *     state means; the app is left out when the server cannot name it;
 *   - the bookkeeping under that, which wraps between its parts, never
 *     inside one, and never starts a line with a separator;
 *   - the state's one next step in the panel - Enable link, Regenerate link
 *     - only where the card lets the reader take it;
 *   - Google's refresh note only for a link Google Calendar reads, the
 *     reachability line only on a self-hosted install before any app has
 *     read the link, and the previous link's end date after a rotation;
 *   - the per-app help, always, and no {{placeholder}} ever on screen.
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

import FeedStatusPanel, {
  FEED_HEALTH_TONES,
  FeedHealthPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedStatusPanel";
import { FeedStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  CALENDAR_FEED_DOCS_PATH,
  DISABLED_FEED_COPY,
  FEED_HEALTH_LABELS,
  FeedHealth,
  NOTHING_FETCHED_COPY,
  PERSONAL_NEEDS_REGENERATION_COPY,
  PERSONAL_PREVIOUS_LINK_COPY,
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
  SHARED_NEEDS_REGENERATION_COPY,
  SHARED_PREVIOUS_LINK_COPY,
  WAITING_FOR_FIRST_SYNC_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import {
  FeedClock,
  formatFeedDay,
  formatFeedFullTime,
  getFeedClock,
} from "../../../UI/Components/Feed/FeedTime";
import URL from "../../../Types/API/URL";
import { DOCS_URL } from "../../../UI/Config";

const NOW: Date = new Date("2026-08-31T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(milliseconds: number): string {
  return new Date(NOW.getTime() - milliseconds).toISOString();
}

type StatusFunction = (overrides?: Partial<FeedStatus>) => FeedStatus;

const status: StatusFunction = (
  overrides?: Partial<FeedStatus>,
): FeedStatus => {
  return {
    exists: true,
    feedId: "11111111-1111-4111-8111-111111111111",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: ago(30 * DAY),
    previousTokenExpiresAt: null,
    lastFetchedAt: ago(7 * MINUTE),
    lastFetchedClient: "Google Calendar",
    fetchCount: 143,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: null,
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
    ...overrides,
  };
};

const NEVER_FETCHED: Partial<FeedStatus> = {
  lastFetchedAt: null,
  lastFetchedClient: null,
  fetchCount: 0,
};

interface PanelOptions {
  showRotatedAgo?: boolean;
  onEnable?: () => void;
  onRegenerate?: () => void;
  isBusy?: boolean;
  shared?: boolean;
}

function renderPanel(
  feed: FeedStatus,
  options: PanelOptions = {},
): ReturnType<typeof render> {
  return render(
    <FeedStatusPanel
      status={feed}
      now={NOW}
      idPrefix="feed"
      showRotatedAgo={options.showRotatedAgo}
      previousLinkCopy={
        options.shared ? SHARED_PREVIOUS_LINK_COPY : PERSONAL_PREVIOUS_LINK_COPY
      }
      needsRegenerationCopy={
        options.shared
          ? SHARED_NEEDS_REGENERATION_COPY
          : PERSONAL_NEEDS_REGENERATION_COPY
      }
      onEnable={options.onEnable}
      onRegenerate={options.onRegenerate}
      isBusy={options.isBusy}
    />,
  );
}

function pill(): HTMLElement {
  return screen.getByTestId("feed-status-pill");
}

function clock(): FeedClock {
  return getFeedClock({ language: "en", now: NOW });
}

describe("FeedStatusPanel", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
  });

  afterEach(() => {
    cleanup();
  });

  describe("the pill", () => {
    test("a link a calendar app has read is Active, in green", () => {
      renderPanel(status());

      expect(pill()).toHaveTextContent("Active");
      expect(pill()).toHaveAttribute("data-health", FeedHealth.Active);
      expect(pill().className).toContain("bg-green-50");
      expect(screen.getByTestId("feed-status")).toHaveAttribute(
        "data-health",
        FeedHealth.Active,
      );
    });

    test("a link nothing has read yet, in its first two days, is Waiting for first sync, in blue", () => {
      renderPanel(status({ ...NEVER_FETCHED, rotatedAt: ago(2 * HOUR) }));

      expect(pill()).toHaveTextContent("Waiting for first sync");
      expect(pill().className).toContain("bg-blue-50");
    });

    test("two days on and still never read, it is Not fetched yet, in amber", () => {
      renderPanel(status({ ...NEVER_FETCHED, rotatedAt: ago(49 * HOUR) }));

      expect(pill()).toHaveTextContent("Not fetched yet");
      expect(pill().className).toContain("bg-amber-50");
    });

    test("a link that is off is Disabled, whatever has read it", () => {
      renderPanel(status({ isEnabled: false }));

      expect(pill()).toHaveTextContent("Disabled");
      expect(pill().className).toContain("bg-amber-50");
    });

    test("a link that cannot be read is Needs regeneration, in red, before anything else", () => {
      renderPanel(status({ needsRegeneration: true, isEnabled: false }));

      expect(pill()).toHaveTextContent("Needs regeneration");
      expect(pill().className).toContain("bg-red-50");
    });

    test("every state has a label and a tone, and the pill draws a dot in the tone's colour", () => {
      for (const health of Object.values(FeedHealth)) {
        expect(FEED_HEALTH_LABELS[health]).toBeTruthy();
        expect(FEED_HEALTH_TONES[health].pill).toMatch(
          /^bg-\S+ text-\S+ ring-\S+$/,
        );
        expect(FEED_HEALTH_TONES[health].dot).toMatch(/^bg-[a-z]+-500$/);

        const { unmount } = render(
          <FeedHealthPill health={health} idPrefix="pill" />,
        );

        const dot: Element | null = screen
          .getByTestId("pill-status-pill")
          .querySelector("span[aria-hidden='true']");

        expect(dot).not.toBeNull();
        expect(dot!.className).toContain(FEED_HEALTH_TONES[health].dot);
        expect(screen.getByTestId("pill-status-pill")).toHaveTextContent(
          FEED_HEALTH_LABELS[health],
        );

        unmount();
      }
    });
  });

  describe("the sentence", () => {
    test("an active link says when it was last read and by which app, in words", () => {
      renderPanel(status());

      expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
        "Last fetched 7 minutes ago by Google Calendar",
      );
    });

    test("the exact time is there on hover", () => {
      renderPanel(status());

      expect(screen.getByTestId("feed-status-headline")).toHaveAttribute(
        "title",
        formatFeedFullTime(new Date(ago(7 * MINUTE)), clock()),
      );
    });

    test("the distance is counted the way a person rounds it", () => {
      const cases: Array<[number, string]> = [
        [20 * 1000, "1 minute ago"],
        [44 * MINUTE, "44 minutes ago"],
        [2 * HOUR, "2 hours ago"],
        [21 * HOUR, "21 hours ago"],
        [23 * HOUR, "1 day ago"],
        [3 * DAY, "3 days ago"],
        [40 * DAY, "1 month ago"],
      ];

      for (const [age, words] of cases) {
        const { unmount } = renderPanel(
          status({
            lastFetchedAt: ago(age),
            lastFetchedClient: "Apple Calendar",
          }),
        );

        expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
          `Last fetched ${words} by Apple Calendar`,
        );

        unmount();
      }
    });

    test("an app the server could not name is left out, rather than 'by Other'", () => {
      const { rerender } = renderPanel(status({ lastFetchedClient: "Other" }));

      expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
        "Last fetched 7 minutes ago",
      );
      expect(
        screen.getByTestId("feed-status-headline").textContent,
      ).not.toContain(" by ");

      rerender(
        <FeedStatusPanel
          status={status({ lastFetchedClient: null })}
          now={NOW}
          idPrefix="feed"
          previousLinkCopy={PERSONAL_PREVIOUS_LINK_COPY}
          needsRegenerationCopy={PERSONAL_NEEDS_REGENERATION_COPY}
        />,
      );

      expect(screen.getByTestId("feed-status-headline").textContent).toBe(
        "Last fetched 7 minutes ago",
      );
    });

    test("a fetch stamped a moment ahead of this clock is still in the past", () => {
      renderPanel(
        status({
          lastFetchedAt: new Date(NOW.getTime() + 90 * 1000).toISOString(),
        }),
      );

      expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
        "Last fetched 1 minute ago by Google Calendar",
      );
    });

    test("waiting, the sentence says nothing is wrong yet and names Google's delay", () => {
      renderPanel(status({ ...NEVER_FETCHED, rotatedAt: ago(5 * MINUTE) }));

      expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
        WAITING_FOR_FIRST_SYNC_COPY,
      );
      expect(WAITING_FOR_FIRST_SYNC_COPY).toContain("Google Calendar");
    });

    test("never read in two days, the sentence asks whether the server can be reached", () => {
      renderPanel(status({ ...NEVER_FETCHED, rotatedAt: ago(3 * DAY) }));

      expect(screen.getByTestId("feed-nothing-fetched-hint")).toHaveTextContent(
        NOTHING_FETCHED_COPY,
      );
      expect(
        screen.queryByTestId("feed-status-headline"),
      ).not.toBeInTheDocument();
    });

    test("disabled, the sentence says what subscribers see, and the last fetch keeps a line of its own", () => {
      renderPanel(status({ isEnabled: false, lastFetchedAt: ago(2 * DAY) }));

      expect(screen.getByTestId("feed-disabled")).toHaveTextContent(
        DISABLED_FEED_COPY,
      );

      const lastFetched: HTMLElement = screen.getByTestId("feed-last-fetched");

      expect(lastFetched).toHaveTextContent(
        "Last fetched 2 days ago by Google Calendar",
      );
      expect(lastFetched).toHaveAttribute(
        "title",
        formatFeedFullTime(new Date(ago(2 * DAY)), clock()),
      );
    });

    test("unreadable, the sentence says why, in the personal or the shared wording", () => {
      const { unmount } = renderPanel(status({ needsRegeneration: true }));

      expect(screen.getByTestId("feed-needs-regeneration")).toHaveTextContent(
        PERSONAL_NEEDS_REGENERATION_COPY,
      );

      unmount();

      renderPanel(status({ needsRegeneration: true }), { shared: true });

      expect(screen.getByTestId("feed-needs-regeneration")).toHaveTextContent(
        SHARED_NEEDS_REGENERATION_COPY,
      );
    });

    test("an explanation reads as prose; only the last fetch is in full weight", () => {
      const { unmount } = renderPanel(status());

      expect(screen.getByTestId("feed-status-headline").className).toContain(
        "font-medium",
      );

      unmount();

      renderPanel(status({ isEnabled: false }));

      expect(screen.getByTestId("feed-disabled").className).not.toContain(
        "font-medium",
      );
    });

    test("the sentence is a status region, so a change is announced", () => {
      renderPanel(status());

      expect(screen.getByRole("status")).toContainElement(
        screen.getByTestId("feed-status-headline"),
      );
    });
  });

  describe("the bookkeeping", () => {
    test("roughly how often, and which link - never more of it than four characters", () => {
      renderPanel(status());

      expect(screen.getByTestId("feed-status-line").textContent).toBe(
        "~143 fetches · link ending in …k3Qx",
      );
    });

    test("one fetch is singular, and a large count is written with separators", () => {
      const { unmount } = renderPanel(status({ fetchCount: 1 }));

      expect(screen.getByTestId("feed-status-line")).toHaveTextContent(
        "~1 fetch ·",
      );

      unmount();

      renderPanel(status({ fetchCount: 12880 }));

      expect(screen.getByTestId("feed-status-line")).toHaveTextContent(
        "~12,880 fetches",
      );
    });

    test("a link never read has no count, only which link it is", () => {
      renderPanel(status({ ...NEVER_FETCHED, rotatedAt: ago(HOUR) }));

      expect(screen.getByTestId("feed-status-line").textContent).toBe(
        "link ending in …k3Qx",
      );
    });

    test("the rotation age is for shared links only, in today / 1 day / N days", () => {
      const { unmount } = renderPanel(status());

      expect(screen.getByTestId("feed-status-line")).not.toHaveTextContent(
        "Last rotated",
      );

      unmount();

      const cases: Array<[string, string]> = [
        [ago(30 * DAY), "Last rotated 30 days ago"],
        [ago(DAY + HOUR), "Last rotated 1 day ago"],
        [ago(2 * HOUR), "Last rotated today"],
      ];

      for (const [rotatedAt, words] of cases) {
        const rendered: ReturnType<typeof render> = renderPanel(
          status({ rotatedAt: rotatedAt }),
          { showRotatedAgo: true },
        );

        expect(screen.getByTestId("feed-status-line")).toHaveTextContent(words);

        rendered.unmount();
      }
    });

    test("it wraps between its parts, never inside one, and no line starts with a separator", () => {
      renderPanel(status(), { showRotatedAgo: true });

      const parts: Array<Element> = Array.from(
        screen.getByTestId("feed-status-line").querySelectorAll("span"),
      );

      expect(parts).toHaveLength(3);

      parts.forEach((part: Element, index: number) => {
        expect(part.className).toBe("whitespace-nowrap");
        expect((part.textContent || "").startsWith("·")).toBe(false);
        expect((part.textContent || "").endsWith(" ·")).toBe(
          index < parts.length - 1,
        );
      });
    });
  });

  describe("the next step", () => {
    test("a disabled link offers Enable link, when the card lets the reader take it", () => {
      const onEnable: MockFunction = getJestMockFunction();

      renderPanel(status({ isEnabled: false }), {
        onEnable: onEnable as unknown as () => void,
      });

      fireEvent.click(screen.getByTestId("feed-enable"));

      expect(onEnable).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("feed-enable")).toHaveTextContent(
        "Enable link",
      );
    });

    test("an unreadable link offers Regenerate link", () => {
      const onRegenerate: MockFunction = getJestMockFunction();

      renderPanel(status({ needsRegeneration: true }), {
        onRegenerate: onRegenerate as unknown as () => void,
      });

      fireEvent.click(screen.getByTestId("feed-regenerate-now"));

      expect(onRegenerate).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("feed-regenerate-now")).toHaveTextContent(
        "Regenerate link",
      );
    });

    test("no step is offered where the card gives none - a shared link's reader", () => {
      const { unmount } = renderPanel(status({ isEnabled: false }));

      expect(screen.queryByTestId("feed-enable")).not.toBeInTheDocument();

      unmount();

      renderPanel(status({ needsRegeneration: true }));

      expect(
        screen.queryByTestId("feed-regenerate-now"),
      ).not.toBeInTheDocument();
    });

    test("an active link has no step to take", () => {
      renderPanel(status(), {
        onEnable: (): void => {},
        onRegenerate: (): void => {},
      });

      expect(screen.queryByTestId("feed-enable")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-regenerate-now"),
      ).not.toBeInTheDocument();
    });

    test("Enable link waits while the card is busy", () => {
      renderPanel(status({ isEnabled: false }), {
        onEnable: (): void => {},
        isBusy: true,
      });

      expect(screen.getByTestId("feed-enable")).toBeDisabled();
    });
  });

  describe("the notes", () => {
    test("Google's refresh schedule is said to a reader whose link Google Calendar reads", () => {
      renderPanel(status());

      expect(screen.getByTestId("feed-google-refresh-note")).toHaveTextContent(
        REFRESH_CADENCE_COPY,
      );
    });

    test("and to nobody else - not to an Apple Calendar reader, not on a disabled link", () => {
      const { unmount } = renderPanel(
        status({ lastFetchedClient: "Apple Calendar" }),
      );

      expect(
        screen.queryByTestId("feed-google-refresh-note"),
      ).not.toBeInTheDocument();

      unmount();

      renderPanel(status({ isEnabled: false }));

      expect(
        screen.queryByTestId("feed-google-refresh-note"),
      ).not.toBeInTheDocument();
    });

    test("on a self-hosted install, before any app has read the link, it says Google needs to reach the server", () => {
      billingEnabledForTest = false;

      for (const rotatedAt of [ago(HOUR), ago(3 * DAY)]) {
        const { unmount } = renderPanel(
          status({ ...NEVER_FETCHED, rotatedAt: rotatedAt }),
        );

        expect(screen.getByTestId("feed-reachability")).toHaveTextContent(
          REACHABILITY_COPY,
        );

        unmount();
      }
    });

    test("not on OneUptime Cloud, not once an app has read the link, and not twice beside a warning that says so", () => {
      billingEnabledForTest = true;

      const cloud: ReturnType<typeof render> = renderPanel(
        status({ ...NEVER_FETCHED, rotatedAt: ago(HOUR) }),
      );

      expect(screen.queryByTestId("feed-reachability")).not.toBeInTheDocument();
      cloud.unmount();

      billingEnabledForTest = false;

      for (const overrides of [
        {},
        {
          ...NEVER_FETCHED,
          rotatedAt: ago(HOUR),
          hostWarning: "HOST is localhost",
        },
        { ...NEVER_FETCHED, rotatedAt: ago(HOUR), privateHost: "10.0.0.5" },
      ] as Array<Partial<FeedStatus>>) {
        const { unmount } = renderPanel(status(overrides));

        expect(
          screen.queryByTestId("feed-reachability"),
        ).not.toBeInTheDocument();

        unmount();
      }
    });

    test("after a rotation, the previous link's last day, as the reader's calendar writes it", () => {
      const expiresAt: string = new Date(
        NOW.getTime() + 29 * DAY,
      ).toISOString();

      renderPanel(
        status({
          ...NEVER_FETCHED,
          rotatedAt: ago(HOUR),
          previousTokenExpiresAt: expiresAt,
        }),
      );

      const line: HTMLElement = screen.getByTestId("feed-previous-link");
      const day: string = formatFeedDay(new Date(expiresAt), clock());

      expect(line.textContent).toBe(
        PERSONAL_PREVIOUS_LINK_COPY.replace("{{date}}", day),
      );
      expect(line).not.toHaveTextContent("keeps working");
    });

    test("the shared wording for a shared link, and nothing for a date it cannot read", () => {
      const expiresAt: string = new Date(
        NOW.getTime() + 29 * DAY,
      ).toISOString();

      const shared: ReturnType<typeof render> = renderPanel(
        status({ previousTokenExpiresAt: expiresAt }),
        { shared: true },
      );

      expect(screen.getByTestId("feed-previous-link")).toHaveTextContent(
        "The previous link returns an empty calendar until",
      );

      shared.unmount();

      renderPanel(status({ previousTokenExpiresAt: "not a date" }));

      expect(
        screen.queryByTestId("feed-previous-link"),
      ).not.toBeInTheDocument();
    });
  });

  test("the per-app help is always there, opening in a new tab", () => {
    renderPanel(status());

    const anchor: HTMLElement | null = screen
      .getByText("Troubleshooting and per-app steps")
      .closest("a");

    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      URL.fromString(DOCS_URL.toString())
        .addRoute(CALENDAR_FEED_DOCS_PATH)
        .toString(),
    );
    expect(anchor!.getAttribute("target")).toBe("_blank");
  });

  test("the panel is a section labelled 'Status', and no {{placeholder}} ever reaches it", () => {
    const states: Array<Partial<FeedStatus>> = [
      {},
      { ...NEVER_FETCHED, rotatedAt: ago(HOUR) },
      { ...NEVER_FETCHED, rotatedAt: ago(3 * DAY) },
      { isEnabled: false },
      { needsRegeneration: true },
      { previousTokenExpiresAt: new Date(NOW.getTime() + DAY).toISOString() },
    ];

    for (const overrides of states) {
      const { unmount } = renderPanel(status(overrides), {
        showRotatedAgo: true,
      });

      const section: HTMLElement = screen.getByTestId("feed-status");

      expect(section.tagName).toBe("SECTION");
      expect(section).toHaveAccessibleName("Status");
      expect(section.textContent).not.toContain("{{");
      expect(section.textContent).not.toContain("}}");

      unmount();
    }
  });
});
