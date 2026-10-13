import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * The calendar link card in German, and in Japanese, from the real locale
 * files - the way a reader in those languages sees it.
 *
 * The card's old status line filled "Last fetched {{when}} by {{client}}"
 * with moment's English ("2 hours ago") even inside a German sentence. Now
 * the distance comes from Intl in the reader's language, the app that
 * fetched the link is named as the server reports it - as the docs quote the
 * sentence in every language - and every new word on the card - the pill,
 * the options' lines, the field's buttons, the menu - is the locale's.
 */

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FeedStatusPanel from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedStatusPanel";
import { FeedStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  PERSONAL_NEEDS_REGENERATION_COPY,
  PERSONAL_PREVIOUS_LINK_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import { getFeedManageMenuButtons } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedManageMenu";
import CalendarFeedLinks from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeedLinks";
import CalendarSubscriptionLinks from "../../../Types/Calendar/CalendarSubscriptionLinks";
import IconProp from "../../../Types/Icon/IconProp";

const DE: Record<string, string> = germanLocale as unknown as Record<
  string,
  string
>;
const JA: Record<string, string> = japaneseLocale as unknown as Record<
  string,
  string
>;

const NOW: Date = new Date("2026-08-31T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

// Intl writes a no-break space in some languages' relative times.
const NO_BREAK_SPACES: RegExp = /[  ]/g;

function plain(text: string | null | undefined): string {
  return (text || "").replace(NO_BREAK_SPACES, " ");
}

const status: (overrides?: Partial<FeedStatus>) => FeedStatus = (
  overrides?: Partial<FeedStatus>,
): FeedStatus => {
  return {
    exists: true,
    feedId: "11111111-1111-4111-8111-111111111111",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: "2026-08-01T10:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: new Date(NOW.getTime() - 7 * MINUTE).toISOString(),
    lastFetchedClient: "Google Calendar",
    fetchCount: 1288,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: null,
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
    ...overrides,
  };
};

function instanceFor(language: string, locale: Record<string, string>): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

let german: i18n;
let japanese: i18n;

beforeAll(() => {
  german = instanceFor("de", DE);
  japanese = instanceFor("ja", JA);
});

function inLanguage(instance: i18n, children: ReactElement): void {
  render(<I18nextProvider i18n={instance}>{children}</I18nextProvider>);
}

function panel(feed: FeedStatus): ReactElement {
  return (
    <FeedStatusPanel
      status={feed}
      now={NOW}
      idPrefix="feed"
      previousLinkCopy={PERSONAL_PREVIOUS_LINK_COPY}
      needsRegenerationCopy={PERSONAL_NEEDS_REGENERATION_COPY}
      onEnable={(): void => {}}
    />
  );
}

describe("the calendar link card in German", () => {
  afterEach(() => {
    cleanup();
  });

  test("the status reads as one German sentence: the locale's wording, Intl's distance, the app as the server names it", () => {
    inLanguage(german, panel(status()));

    expect(DE["Last fetched {{when}} by {{client}}"]).toBe(
      "Zuletzt abgerufen {{when}} von {{client}}",
    );
    expect(plain(screen.getByTestId("feed-status-headline").textContent)).toBe(
      "Zuletzt abgerufen vor 7 Minuten von Google Calendar",
    );
    expect(screen.getByTestId("feed-status-pill")).toHaveTextContent(
      DE["Active"] as string,
    );
    expect(
      screen.getByRole("heading", { name: DE["Status"] as string }),
    ).toBeInTheDocument();
  });

  test("the bookkeeping is German, its count written the German way", () => {
    inLanguage(german, panel(status()));

    expect(plain(screen.getByTestId("feed-status-line").textContent)).toBe(
      "~1.288 Abrufe · Link endet auf …k3Qx",
    );
  });

  test("a waiting link and a disabled one say so in German, with German pills", () => {
    inLanguage(
      german,
      panel(
        status({
          lastFetchedAt: null,
          lastFetchedClient: null,
          fetchCount: 0,
          rotatedAt: new Date(NOW.getTime() - 10 * MINUTE).toISOString(),
        }),
      ),
    );

    expect(screen.getByTestId("feed-status-pill")).toHaveTextContent(
      DE["Waiting for first sync"] as string,
    );
    expect(screen.getByTestId("feed-status-headline")).toHaveTextContent(
      DE[
        "No calendar app has fetched this link yet. Most apps do within minutes of subscribing; Google Calendar can take a few hours."
      ] as string,
    );

    cleanup();

    inLanguage(german, panel(status({ isEnabled: false })));

    expect(screen.getByTestId("feed-status-pill")).toHaveTextContent(
      DE["Disabled"] as string,
    );
    expect(screen.getByTestId("feed-enable")).toHaveTextContent(
      DE["Enable link"] as string,
    );
    expect(plain(screen.getByTestId("feed-last-fetched").textContent)).toBe(
      "Zuletzt abgerufen vor 7 Minuten von Google Calendar",
    );
  });

  test("the subscribe options and the link field are German", () => {
    inLanguage(
      german,
      <CalendarFeedLinks
        urls={CalendarSubscriptionLinks.build(HTTPS_URL)}
        tokenHint="k3Qx"
      />,
    );

    const google: HTMLElement = screen.getByTestId("calendar-feed-google");

    expect(google).toHaveTextContent(DE["Google Calendar"] as string);
    expect(google).toHaveTextContent(
      DE["Opens Google Calendar in a new tab"] as string,
    );
    expect(screen.getByTestId("calendar-feed-webcal")).toHaveTextContent(
      DE["Opens the calendar app on this device"] as string,
    );
    expect(screen.getByTestId("calendar-feed-reveal")).toHaveAccessibleName(
      DE["Show link"] as string,
    );
    expect(screen.getByTestId("calendar-feed-copy-button")).toHaveTextContent(
      DE["Copy link"] as string,
    );

    fireEvent.click(screen.getByTestId("calendar-feed-reveal"));

    expect(screen.getByTestId("calendar-feed-link-value")).toHaveAccessibleName(
      DE["Calendar link"] as string,
    );
  });

  test("the menu is named and filled in German", () => {
    inLanguage(
      german,
      <div>
        {getFeedManageMenuButtons({
          idPrefix: "feed",
          actions: [
            {
              key: "regenerate",
              text: "Regenerate link",
              icon: IconProp.Refresh,
              onClick: (): void => {},
              dataTestId: "regenerate",
            },
            {
              key: "toggle",
              text: "Disable link",
              icon: IconProp.BellSlash,
              onClick: (): void => {},
              dataTestId: "toggle",
            },
            {
              key: "delete",
              text: "Delete link",
              icon: IconProp.Trash,
              isDestructive: true,
              onClick: (): void => {},
              dataTestId: "delete",
            },
          ],
        })}
      </div>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: DE["Manage link"] as string }),
    );

    const labels: Array<string> = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(labels).toEqual([
      DE["Regenerate link"],
      DE["Disable link"],
      DE["Delete link"],
    ]);
  });
});

describe("the calendar link card in Japanese", () => {
  afterEach(() => {
    cleanup();
  });

  test("the status is one Japanese sentence with Intl's Japanese distance", () => {
    inLanguage(japanese, panel(status()));

    expect(plain(screen.getByTestId("feed-status-headline").textContent)).toBe(
      "最終取得 7 分前（取得元: Google Calendar）",
    );
    expect(screen.getByTestId("feed-status-pill")).toHaveTextContent(
      JA["Active"] as string,
    );
  });
});
