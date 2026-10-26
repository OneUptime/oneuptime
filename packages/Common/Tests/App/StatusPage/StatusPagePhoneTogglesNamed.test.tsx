import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import StatusPageNavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/de.json";

/*
 * A status page's two phone toggles - the header's ⋯, which opens the
 * owner's header links, and the nav bar's ☰, which opens the page's
 * sections - are icons alone. They had no accessible name, so a screen
 * reader said only "button". Each is now named for what it opens, in the
 * page's language, and says whether it is open (aria-expanded), as Common's
 * NavBar toggle does since #5272.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);

const HEADER_LINKS: Array<Link> = [
  { title: "Website", to: URL.fromString("https://example.com") },
  { title: "Support", to: URL.fromString("https://example.com/support") },
];

const translation: i18n = createInstance();

const renderBoth: () => Promise<void> = async (): Promise<void> => {
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
};

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await translation.changeLanguage("en");
});

describe("a status page's phone toggles are named for what they open", () => {
  test("the header's ⋯ is More links, and says when it is open", async () => {
    await renderBoth();

    const toggle: HTMLElement = screen.getByTestId("mobile-header-toggle");

    expect(toggle).toHaveAccessibleName("More links");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getByTestId("mobile-header-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Open or closed, the same name: what it opens, not its icon.
    expect(screen.getByTestId("mobile-header-toggle")).toHaveAccessibleName(
      "More links",
    );
  });

  test("the nav bar's ☰ is Navigation, and says when it is open", async () => {
    await renderBoth();

    const toggle: HTMLElement = screen.getByTestId("mobile-nav-toggle");

    expect(toggle).toHaveAccessibleName("Navigation");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getByTestId("mobile-nav-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("in the page's language", async () => {
    await act(async () => {
      await translation.changeLanguage("de");
    });

    await renderBoth();

    expect(screen.getByTestId("mobile-header-toggle")).toHaveAccessibleName(
      "Weitere Links",
    );
    expect(screen.getByTestId("mobile-nav-toggle")).toHaveAccessibleName(
      "Navigation",
    );
  });

  test("both names are in all 17 languages", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const a11y: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      )["a11y"];

      for (const key of ["moreLinks", "navigation"]) {
        const value: unknown = a11y[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
