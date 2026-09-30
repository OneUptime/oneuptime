import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

/*
 * Admin Dashboard > Settings > Authentication, in every language.
 *
 * The instance-wide "Require SSO for Login" card is on the page in every
 * edition, next to the "Disable Sign Up" and project creation cards. Its
 * strings reach the screen through components that look each one up by its
 * English text: the card's title and description (Card), its edit button
 * (Button), and the toggle's title and description in the form and in the
 * saved value's details (FieldLabel). This renders the real page with the
 * real locale files, one language at a time, and reads what those lookups
 * give: every string of the card in the page's language, none left in
 * English.
 *
 * CardModelDetail is replaced by a stand-in that hands each string to
 * useTranslateValue - the hook Card, Button and FieldLabel use - so the page
 * renders without an API. The i18next instance reaches the page through
 * I18nextProvider only; installing it globally would leak a language into
 * the other tests in this worker.
 */

interface CardModelDetailField {
  field: Record<string, boolean>;
  title?: string | undefined;
  description?: string | undefined;
}

interface CardModelDetailProps {
  name: string;
  cardProps: { title: string; description?: string | undefined };
  editButtonText?: string | undefined;
  formFields: Array<CardModelDetailField>;
  modelDetailProps: { fields: Array<CardModelDetailField> };
}

// What the stand-in uses of Common/UI/Utils/Translation.
interface TranslationModule {
  default: () => {
    translateString: (value: string | undefined) => string | undefined;
  };
}

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const translation: TranslationModule = jest.requireActual(
    "../../../UI/Utils/Translation",
  ) as TranslationModule;

  return {
    __esModule: true,
    default: (props: CardModelDetailProps): ReactElement => {
      const { translateString } = translation.default();

      return (
        <section data-testid={`card-${props.name}`}>
          <h2 data-testid="card-title">
            {translateString(props.cardProps.title)}
          </h2>
          <p data-testid="card-description">
            {translateString(props.cardProps.description)}
          </p>
          <button data-testid="card-edit-button">
            {translateString(props.editButtonText)}
          </button>
          {props.formFields.map((formField: CardModelDetailField) => {
            const column: string = Object.keys(formField.field)[0] || "";

            return (
              <div key={column} data-testid={`form-${column}`}>
                <span data-testid="form-title">
                  {translateString(formField.title)}
                </span>
                <span data-testid="form-description">
                  {translateString(formField.description)}
                </span>
              </div>
            );
          })}
          {props.modelDetailProps.fields.map(
            (detailField: CardModelDetailField) => {
              const column: string = Object.keys(detailField.field)[0] || "";

              return (
                <div key={column} data-testid={`detail-${column}`}>
                  <span data-testid="detail-title">
                    {translateString(detailField.title)}
                  </span>
                  <span data-testid="detail-description">
                    {translateString(detailField.description)}
                  </span>
                </div>
              );
            },
          )}
        </section>
      );
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import AuthenticationSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/Index";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const CARD_TITLE: string = "Single Sign-On (SSO)";
const CARD_DESCRIPTION: string =
  "Control whether users must sign in with SSO across this server.";
const EDIT_BUTTON: string = "Edit SSO Settings";
const TOGGLE_TITLE: string = "Require SSO for Login";
const TOGGLE_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.";
const DETAIL_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt.";

const CARD_STRINGS: Array<string> = [
  CARD_TITLE,
  CARD_DESCRIPTION,
  EDIT_BUTTON,
  TOGGLE_TITLE,
  TOGGLE_DESCRIPTION,
  DETAIL_DESCRIPTION,
];

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// An instance like the Admin Dashboard's: one language, English as the fallback.
async function instanceFor(
  locale: string,
  resource: Locale = readLocale(locale),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: resource },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface RenderedCard {
  title: string;
  description: string;
  editButton: string;
  toggleTitle: string;
  toggleDescription: string;
  detailTitle: string;
  detailDescription: string;
}

function textOf(container: HTMLElement, testId: string): string {
  return (
    container.querySelector(`[data-testid="${testId}"]`)?.textContent || ""
  );
}

async function renderCardIn(
  locale: string,
  resource?: Locale | undefined,
): Promise<RenderedCard> {
  const instance: i18n = await instanceFor(locale, resource);

  render(
    <I18nextProvider i18n={instance}>
      <AuthenticationSettings />
    </I18nextProvider>,
  );

  const card: HTMLElement = screen.getByTestId("card-SSO Settings");
  const toggle: HTMLElement = screen.getByTestId("form-requireSsoForLogin");
  const detail: HTMLElement = screen.getByTestId("detail-requireSsoForLogin");

  expect(card).toContainElement(toggle);
  expect(card).toContainElement(detail);

  return {
    title: textOf(card, "card-title"),
    description: textOf(card, "card-description"),
    editButton: textOf(card, "card-edit-button"),
    toggleTitle: textOf(toggle, "form-title"),
    toggleDescription: textOf(toggle, "form-description"),
    detailTitle: textOf(detail, "detail-title"),
    detailDescription: textOf(detail, "detail-description"),
  };
}

// What the card shows in a language, from that language's locale file.
function expectedIn(entries: Locale): RenderedCard {
  return {
    title: String(entries[CARD_TITLE]),
    description: String(entries[CARD_DESCRIPTION]),
    editButton: String(entries[EDIT_BUTTON]),
    toggleTitle: String(entries[TOGGLE_TITLE]),
    toggleDescription: String(entries[TOGGLE_DESCRIPTION]),
    detailTitle: String(entries[TOGGLE_TITLE]),
    detailDescription: String(entries[DETAIL_DESCRIPTION]),
  };
}

const ENGLISH_CARD: RenderedCard = {
  title: CARD_TITLE,
  description: CARD_DESCRIPTION,
  editButton: EDIT_BUTTON,
  toggleTitle: TOGGLE_TITLE,
  toggleDescription: TOGGLE_DESCRIPTION,
  detailTitle: TOGGLE_TITLE,
  detailDescription: DETAIL_DESCRIPTION,
};

describe("Settings > Authentication: the Single Sign-On (SSO) card in every language", () => {
  afterEach(() => {
    cleanup();
  });

  test("English shows the card's own strings", async () => {
    expect(await renderCardIn("en")).toEqual(ENGLISH_CARD);
  });

  test.each(OTHER_LOCALES)(
    "%s shows every string of the card in that language",
    async (locale: string) => {
      const entries: Locale = readLocale(locale);
      const card: RenderedCard = await renderCardIn(locale);

      expect(card).toEqual(expectedIn(entries));

      // Nothing on the card is left in English (the title can be a loanword).
      expect(card.description).not.toBe(CARD_DESCRIPTION);
      expect(card.editButton).not.toBe(EDIT_BUTTON);
      expect(card.toggleTitle).not.toBe(TOGGLE_TITLE);
      expect(card.toggleDescription).not.toBe(TOGGLE_DESCRIPTION);
      expect(card.detailDescription).not.toBe(DETAIL_DESCRIPTION);
    },
  );

  test("German reads as German", async () => {
    const card: RenderedCard = await renderCardIn("de");

    expect(card.toggleTitle).toBe("SSO für die Anmeldung erfordern");
    expect(card.detailDescription).toBe(
      "Wenn aktiviert, müssen sich alle Benutzer mit SSO anmelden, um auf ein Projekt auf diesem Server zuzugreifen. Master-Administratoren sind ausgenommen.",
    );
    expect(card.editButton).toBe("SSO-Einstellungen bearbeiten");
  });

  /*
   * Without the entries the lookups fall back to English: what the checks
   * above would see if the card's strings changed and the locales did not
   * follow.
   */
  test("a language without the card's entries shows it in English (negative control)", async () => {
    const withoutCard: Locale = { ...readLocale("fr") };

    for (const key of CARD_STRINGS) {
      delete withoutCard[key];
    }

    expect(await renderCardIn("fr", withoutCard)).toEqual(ENGLISH_CARD);
  });
});
