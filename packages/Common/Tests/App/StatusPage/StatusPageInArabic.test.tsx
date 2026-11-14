import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import {
  getReaderLanguageFromAcceptLanguage,
  toReaderLanguage,
} from "../../../Types/ReaderLanguage";
import { isRightToLeftLanguage } from "../../../Types/ReadingDirection";
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import StatusPageNavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import arabicLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/ar.json";

/*
 * A STATUS PAGE IN ARABIC.
 *
 * A visitor whose browser asks for Arabic, or a page whose default language
 * is Arabic, reads the page in Arabic from the right: its header and nav bar
 * in Arabic words, OneUptime's own status names in Arabic, and nothing of
 * the page's own words left in English but product names and examples.
 */

const HEADER_LINKS: Array<Link> = [
  { title: "Website", to: URL.fromString("https://example.com") },
];

type LocaleTree = { [key: string]: string | LocaleTree };

// Every leaf of a locale, as "path": "value".
const leaves: (tree: LocaleTree, prefix?: string) => Record<string, string> = (
  tree: LocaleTree,
  prefix: string = "",
): Record<string, string> => {
  const found: Record<string, string> = {};

  for (const [key, value] of Object.entries(tree)) {
    const path: string = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      found[path] = value;
    } else {
      Object.assign(found, leaves(value, path));
    }
  }

  return found;
};

const ENGLISH: Record<string, string> = leaves(englishLocale as LocaleTree);
const ARABIC: Record<string, string> = leaves(arabicLocale as LocaleTree);

/*
 * What an Arabic status page writes as English does, on purpose: calendar
 * products, chat products and example addresses a visitor types over.
 */
const SAME_AS_ENGLISH: Array<string> = [
  "scheduledEvents.calendar.device",
  "scheduledEvents.calendar.google",
  "subscribe.email.managePlaceholder",
  "subscribe.email.placeholder",
  "subscribe.menu.microsoftTeams",
  "subscribe.menu.slack",
  "subscribe.microsoftTeams.webhookUrlPlaceholder",
  "subscribe.microsoftTeams.workspaceNamePlaceholder",
  "subscribe.slack.webhookUrlPlaceholder",
  "subscribe.slack.workspaceNamePlaceholder",
  "subscribe.sms.placeholder",
  "subscribe.webhook.webhookUrlPlaceholder",
];

const translation: i18n = createInstance();

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "ar",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      ar: { translation: arabicLocale },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

const renderPage: () => Promise<void> = async (): Promise<void> => {
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
          showAnnouncementsOnStatusPage={true}
          showScheduledMaintenanceEventsOnStatusPage={true}
          showSubscriberPageOnStatusPage={true}
        />
      </I18nextProvider>,
    );
  });
};

describe("a status page read in Arabic", () => {
  test("a browser that asks for Arabic gets the page in Arabic, read from the right", () => {
    expect(getReaderLanguageFromAcceptLanguage("ar-EG,ar;q=0.9,en;q=0.5")).toBe(
      "ar",
    );
    expect(getReaderLanguageFromAcceptLanguage("ar-SA")).toBe("ar");
    expect(toReaderLanguage("ar-AE")).toBe("ar");
    expect(isRightToLeftLanguage("ar")).toBe(true);
  });

  test("the nav bar names every page in Arabic", async () => {
    await renderPage();

    for (const word of [
      "نظرة عامة",
      "الحوادث",
      "الإعلانات",
      "الصيانة المجدولة",
      "اشتراك",
    ]) {
      expect([word, screen.queryAllByText(word).length > 0]).toEqual([
        word,
        true,
      ]);
    }

    for (const english of [
      "Overview",
      "Incidents",
      "Announcements",
      "Scheduled Maintenance",
      "Subscribe",
    ]) {
      expect(screen.queryByText(english)).toBeNull();
    }

    // The bar holds the Arabic words, not only the phone menu.
    expect(
      within(screen.getAllByTestId("nav-children")[0]!).queryAllByText(
        "نظرة عامة",
      ).length,
    ).toBeGreaterThan(0);
  });

  test("the phone toggles are named in Arabic", async () => {
    await renderPage();

    expect(screen.getByTestId("mobile-header-toggle")).toHaveAccessibleName(
      ARABIC["a11y.moreLinks"] as string,
    );
    expect(screen.getByTestId("mobile-nav-toggle")).toHaveAccessibleName(
      ARABIC["a11y.navigation"] as string,
    );
    expect(ARABIC["a11y.moreLinks"]).not.toBe(ENGLISH["a11y.moreLinks"]);
  });

  test("OneUptime's own status names are in Arabic", () => {
    expect({
      operational: ARABIC["statusNames.operational"],
      degraded: ARABIC["statusNames.degraded"],
      offline: ARABIC["statusNames.offline"],
      identified: ARABIC["statusNames.identified"],
      acknowledged: ARABIC["statusNames.acknowledged"],
      resolved: ARABIC["statusNames.resolved"],
      majorIncident: ARABIC["statusNames.majorIncident"],
    }).toEqual({
      operational: "يعمل بشكل طبيعي",
      // Degraded is the word for a service that works, but worse (Locales/ARABIC.md).
      degraded: "متدهور",
      offline: "غير متصل",
      identified: "تم التحديد",
      acknowledged: "تم الإقرار",
      resolved: "تم الحل",
      majorIncident: "حادثة كبرى",
    });
  });

  test("the locale has every English key, with the same placeholders", () => {
    expect(Object.keys(ARABIC)).toEqual(Object.keys(ENGLISH));

    const placeholders: (text: string) => Array<string> = (
      text: string,
    ): Array<string> => {
      return (text.match(/\{\{\s*[^{}]+?\s*\}\}/g) || []).sort();
    };

    for (const [path, english] of Object.entries(ENGLISH)) {
      expect([path, placeholders(ARABIC[path] as string)]).toEqual([
        path,
        placeholders(english),
      ]);
    }
  });

  test("nothing is left in English but product names and examples", () => {
    const sameAsEnglish: Array<string> = Object.keys(ENGLISH)
      .filter((path: string): boolean => {
        return (
          ENGLISH[path] === ARABIC[path] &&
          (ENGLISH[path] as string).trim() !== ""
        );
      })
      .sort();

    expect(sameAsEnglish).toEqual(SAME_AS_ENGLISH);
  });

  /*
   * The subscribe page's webhook sentences said "Webhook" in Latin letters
   * ("إلى Webhook هذا الخاص بـ Slack") while its own menu said
   * "خطافات الويب": a webhook in a sentence is خطاف الويب, as the glossary
   * says. Slack's and Teams' own feature name, "Incoming Webhook", and the
   * example addresses keep their Latin letters.
   */
  test("a webhook in a sentence is خطاف الويب, as the subscribe menu says", () => {
    const webhook: RegExp = /webhook/i;
    const sentences: Array<string> = Object.keys(ENGLISH).filter(
      (path: string): boolean => {
        const english: string = ENGLISH[path] as string;

        return (
          webhook.test(english) &&
          !english.includes("Incoming Webhook") &&
          !path.endsWith("Placeholder")
        );
      },
    );

    // The title, the address label, the menu, the channel and the four sentences.
    expect(sentences.length).toBeGreaterThanOrEqual(8);

    for (const path of sentences) {
      const arabic: string = ARABIC[path] as string;

      expect([path, webhook.test(arabic)]).toEqual([path, false]);
      expect([path, arabic.includes("خطاف")]).toEqual([path, true]);
    }

    expect(ARABIC["subscribe.webhook.title"]).toBe("الاشتراك عبر خطاف الويب");
    expect(ARABIC["subscribe.slack.description"]).toBe(
      "ستُرسل جميع تحديثاتنا إلى خطاف الويب هذا في Slack.",
    );
  });

  test("a visitor's search is quoted the Arabic way", () => {
    expect(ENGLISH["search.noResultsDescription"]).toContain('"{{query}}"');
    expect(ARABIC["search.noResultsDescription"]).toBe(
      "لا شيء في هذه الصفحة يطابق «{{query}}». جرّب بحثًا أقصر.",
    );
  });

  test("a question ends in the Arabic question mark", () => {
    const arabicLetter: RegExp = /[ء-ي]/;

    for (const [path, english] of Object.entries(ENGLISH)) {
      const arabic: string = ARABIC[path] as string;

      if (english.trim().endsWith("?") && arabicLetter.test(arabic)) {
        expect([path, arabic.trim().endsWith("؟")]).toEqual([path, true]);
      }
    }
  });
});
