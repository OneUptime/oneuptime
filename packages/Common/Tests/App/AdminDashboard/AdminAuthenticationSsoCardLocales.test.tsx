import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Admin Dashboard > Settings > Authentication, in every language.
 *
 * The instance-wide "Require SSO for Login" switch is on the page in every
 * edition, between the Sign Up and Project Creation switches, and it asks
 * before it requires SSO. Its strings reach the screen through components
 * that look each one up by its English text: the card's title and
 * description (Card), the switch's name and sentence (Toggle), and the
 * dialog's title, sentence and button (ConfirmModal). This renders the real
 * page with the real locale files, one language at a time, opens the dialog,
 * and reads what those lookups give: every string of the card and the
 * dialog in the page's language, none left in English.
 *
 * The admin API, the page chrome and the side menu are stand-ins. The
 * i18next instance reaches the page through I18nextProvider only;
 * installing it globally would leak a language into the other tests in
 * this worker.
 */

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
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
import { REQUIRE_SSO_SWITCH_TEST_ID } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/AuthenticationSwitchesCopy";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../../Types/ObjectID";
import UserUtil from "../../../UI/Utils/User";

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
const SWITCH_TITLE: string = "Require SSO for Login";
const SWITCH_NOTE: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.";
const CONFIRM_TITLE: string = "Require SSO for everyone?";
const CONFIRM_DESCRIPTION: string =
  "Everyone except master admins will have to sign in with SSO to open any project on this server. Anyone who signs in with a password is locked out of their projects until they sign in with SSO, so check that an SSO provider works for them first.";
const CONFIRM_BUTTON: string = "Require SSO";

const CARD_STRINGS: Array<string> = [
  CARD_TITLE,
  CARD_DESCRIPTION,
  SWITCH_TITLE,
  SWITCH_NOTE,
  CONFIRM_TITLE,
  CONFIRM_DESCRIPTION,
  CONFIRM_BUTTON,
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
  switchTitle: string;
  switchNote: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmButton: string;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
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

  await flush();

  const control: HTMLElement = screen.getByTestId(REQUIRE_SSO_SWITCH_TEST_ID);
  const card: HTMLElement = control.closest(
    '[data-testid="card"]',
  ) as HTMLElement;

  expect(card).not.toBeNull();

  const labelId: string = control.getAttribute("aria-labelledby") || "";
  const descriptionId: string = control.getAttribute("aria-describedby") || "";

  // The card's title and the line under it, and the switch's own words.
  const title: string =
    within(card).getByTestId("card-details-heading").textContent || "";
  const description: string =
    within(card).getByTestId("card-description").textContent || "";
  const switchTitle: string =
    document.getElementById(labelId)?.textContent || "";
  const switchNote: string =
    document.getElementById(descriptionId)?.textContent || "";

  // Requiring SSO asks first: read the dialog it opens.
  fireEvent.click(control);
  await flush();

  const dialog: HTMLElement = screen.getByRole("dialog");

  return {
    title: title,
    description: description,
    switchTitle: switchTitle,
    switchNote: switchNote,
    confirmTitle: within(dialog).getByTestId("modal-title").textContent || "",
    confirmDescription:
      within(dialog).getByTestId("confirm-modal-description").textContent ||
      "",
    confirmButton:
      within(dialog).getByTestId("modal-footer-submit-button").textContent ||
      "",
  };
}

// What the card shows in a language, from that language's locale file.
function expectedIn(entries: Locale): RenderedCard {
  return {
    title: String(entries[CARD_TITLE]),
    description: String(entries[CARD_DESCRIPTION]),
    switchTitle: String(entries[SWITCH_TITLE]),
    switchNote: String(entries[SWITCH_NOTE]),
    confirmTitle: String(entries[CONFIRM_TITLE]),
    confirmDescription: String(entries[CONFIRM_DESCRIPTION]),
    confirmButton: String(entries[CONFIRM_BUTTON]),
  };
}

const ENGLISH_CARD: RenderedCard = {
  title: CARD_TITLE,
  description: CARD_DESCRIPTION,
  switchTitle: SWITCH_TITLE,
  switchNote: SWITCH_NOTE,
  confirmTitle: CONFIRM_TITLE,
  confirmDescription: CONFIRM_DESCRIPTION,
  confirmButton: CONFIRM_BUTTON,
};

describe("Settings > Authentication: the Single Sign-On (SSO) switch in every language", () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockImplementation(async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config._id = ObjectID.getZeroObjectID().toString();
      return config;
    });

    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("English shows the card's and the dialog's own strings", async () => {
    expect(await renderCardIn("en")).toEqual(ENGLISH_CARD);
  });

  test.each(OTHER_LOCALES)(
    "%s shows every string of the card and the dialog in that language",
    async (locale: string) => {
      const entries: Locale = readLocale(locale);
      const card: RenderedCard = await renderCardIn(locale);

      expect(card).toEqual(expectedIn(entries));

      // Nothing on the card is left in English (the title can be a loanword).
      expect(card.description).not.toBe(CARD_DESCRIPTION);
      expect(card.switchTitle).not.toBe(SWITCH_TITLE);
      expect(card.switchNote).not.toBe(SWITCH_NOTE);
      expect(card.confirmTitle).not.toBe(CONFIRM_TITLE);
      expect(card.confirmDescription).not.toBe(CONFIRM_DESCRIPTION);
      expect(card.confirmButton).not.toBe(CONFIRM_BUTTON);
    },
  );

  test("German reads as German", async () => {
    const card: RenderedCard = await renderCardIn("de");

    expect(card.switchTitle).toBe("SSO für die Anmeldung erfordern");
    expect(card.confirmTitle).toBe("SSO für alle erfordern?");
    expect(card.confirmButton).toBe("SSO erfordern");
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
