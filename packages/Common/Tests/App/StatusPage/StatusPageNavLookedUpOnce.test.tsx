import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import StatusPageNavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import spanishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/es.json";

/*
 * A STATUS PAGE'S NAV SAYS ITS PAGES' NAMES AS ITS LANGUAGE DOES (#7790).
 *
 * A status page words its pages and its phone toggles itself (t("nav.*"),
 * t("a11y.*")), and the nav bar's items and the toggles looked each word up
 * again - as the Dashboard's did, where Spanish "Red" (Network) read "Rojo".
 * No status page language shows a wrong word with today's files; here every
 * one of these words reads "Rojo" if looked up again, and each place must
 * read the page's word: the pages' names, on a wide screen and in the
 * phone's menu, and the toggles' names.
 */

const TWICE: string = "Rojo";

type Locale = Record<string, unknown>;

const NAV: Record<string, string> = (spanishLocale as Locale)["nav"] as Record<
  string,
  string
>;
const A11Y: Record<string, string> = (spanishLocale as Locale)[
  "a11y"
] as Record<string, string>;

// The pages this status page shows, by their words.
const PAGE_NAMES: Array<string> = [
  NAV["overview"]!,
  NAV["incidents"]!,
  NAV["subscribe"]!,
];

const TOGGLE_NAMES: Array<string> = [A11Y["navigation"]!, A11Y["moreLinks"]!];

const HEADER_LINKS: Array<Link> = [
  { title: "Website", to: URL.fromString("https://example.com") },
];

const translation: i18n = createInstance();

async function renderBoth(): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={translation}>
        <StatusPageHeader links={HEADER_LINKS} onLogoClicked={() => {}} />
        <StatusPageNavBar
          show={true}
          isPreview={false}
          isPrivateStatusPage={false}
          enableEmailSubscribers={true}
          enableSMSSubscribers={false}
          showIncidentsOnStatusPage={true}
          showAnnouncementsOnStatusPage={false}
          showScheduledMaintenanceEventsOnStatusPage={false}
          showSubscriberPageOnStatusPage={true}
        />
      </I18nextProvider>,
    );
  });
}

// Every link's words, wherever the nav draws one.
function linkTexts(): Array<string> {
  return Array.from(document.body.querySelectorAll("a")).map(
    (link: HTMLAnchorElement): string => {
      return (link.textContent || "").trim();
    },
  );
}

beforeAll(async () => {
  const spanish: Locale = { ...(spanishLocale as Locale) };

  for (const word of [...PAGE_NAMES, ...TOGGLE_NAMES]) {
    spanish[word] = TWICE;
  }

  await translation.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "es",
    resources: { es: { translation: spanish } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("a status page's nav, in Spanish", () => {
  test("each word read again would be Rojo", () => {
    for (const word of [...PAGE_NAMES, ...TOGGLE_NAMES]) {
      expect(
        translation.t(word, {
          keySeparator: false,
          nsSeparator: false,
          defaultValue: word,
        }),
      ).toBe(TWICE);
    }
  });

  test("names each page as the page words it, never Rojo", async () => {
    await renderBoth();

    for (const name of PAGE_NAMES) {
      expect(linkTexts()).toContain(name);
    }
    expect(linkTexts()).not.toContain(TWICE);
  });

  test("in the phone's menu too", async () => {
    await renderBoth();

    await act(async () => {
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    });

    // Each page in the phone's menu, as on a wide screen.
    for (const name of PAGE_NAMES) {
      expect(
        linkTexts().filter((text: string): boolean => {
          return text === name;
        }).length,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(linkTexts()).not.toContain(TWICE);
  });

  test("names its phone toggles as the page words them, never Rojo", async () => {
    await renderBoth();

    expect(screen.getByTestId("mobile-nav-toggle")).toHaveAccessibleName(
      A11Y["navigation"]!,
    );
    expect(screen.getByTestId("mobile-header-toggle")).toHaveAccessibleName(
      A11Y["moreLinks"]!,
    );
  });
});
