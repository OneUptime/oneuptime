import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * WHERE MASTER ADMINS ARE TOLD WHEN EMAIL OR THE GLOBAL PROBES STOP (#6879),
 * on Settings > Emails.
 *
 * The card says what is told, when and through what, and shows where it
 * goes: the number texted (or none) and whether pushes go to the master
 * admins' devices - on, on a self-hosted server where nobody chose, as the
 * job reads it. Its edit form starts the switch there too. Every word is in
 * every language the Admin Dashboard speaks.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import ServerAlertsCard, {
  SERVER_ALERTS_CARD_TEST_ID,
  SERVER_ALERTS_COPY,
  isServerAlertPushOn,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/ServerAlertsCard";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Phone from "../../../Types/Phone";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

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

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

let stored: Partial<GlobalConfig> = {};

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderIn(locale: string = "en"): Promise<void> {
  const translation: i18n = createInstance();

  await translation.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={translation}>
      <ServerAlertsCard />
    </I18nextProvider>,
  );

  await settle();
}

beforeEach(() => {
  stored = {};
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(async (): Promise<unknown> => {
    const item: GlobalConfig = new GlobalConfig();
    Object.assign(item, stored);
    return item;
  });

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(API, "fetch").mockImplementation(async (): Promise<unknown> => {
    return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
  });
});

afterEach(() => {
  cleanup();
});

describe("the card", () => {
  test("says what is told, when, and never through the channel that stopped", async () => {
    await renderIn();

    const card: HTMLElement = screen.getByTestId(SERVER_ALERTS_CARD_TEST_ID);

    expect(card).toHaveTextContent(SERVER_ALERTS_COPY.title);
    expect(card).toHaveTextContent("never through the channel that stopped");
    expect(card).toHaveTextContent("at most once an hour");
  });

  test("reads the two choices it shows, and nothing it does not", async () => {
    await renderIn();

    const select: Record<string, unknown> = (
      mockGetItem.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select).toMatchObject({
      serverAlertPhoneNumber: true,
      isServerAlertPushOn: true,
    });
    expect(select).not.toHaveProperty("serverAlertState");
  });

  test("with nobody's choice on a self-hosted server, pushes are on and no number is texted", async () => {
    await renderIn();

    const card: HTMLElement = screen.getByTestId(SERVER_ALERTS_CARD_TEST_ID);

    expect(card).toHaveTextContent(SERVER_ALERTS_COPY.pushTitle);
    expect(card).toHaveTextContent(SERVER_ALERTS_COPY.on);
    expect(card).toHaveTextContent(SERVER_ALERTS_COPY.none);
  });

  test("shows the number texted, and pushes a master admin turned off", async () => {
    stored = {
      serverAlertPhoneNumber: new Phone("+15550100"),
      isServerAlertPushOn: false,
    };

    await renderIn();

    const card: HTMLElement = screen.getByTestId(SERVER_ALERTS_CARD_TEST_ID);

    expect(card).toHaveTextContent("+15550100");
    expect(card).toHaveTextContent(SERVER_ALERTS_COPY.off);
  });

  test("the push switch reads as the job reads it", () => {
    expect(isServerAlertPushOn(undefined)).toBe(true);
    expect(isServerAlertPushOn(null)).toBe(true);
    expect(isServerAlertPushOn(true)).toBe(true);
    expect(isServerAlertPushOn(false)).toBe(false);
  });

  test("a German reader reads it in German", async () => {
    await renderIn("de");

    const german: Locale = readLocale("de");
    const card: HTMLElement = screen.getByTestId(SERVER_ALERTS_CARD_TEST_ID);

    expect(card).toHaveTextContent(german[SERVER_ALERTS_COPY.title] as string);
    expect(card).toHaveTextContent(
      german[SERVER_ALERTS_COPY.pushTitle] as string,
    );
  });
});

describe("in every language", () => {
  const WORDS: Array<string> = [
    SERVER_ALERTS_COPY.title,
    SERVER_ALERTS_COPY.description,
    SERVER_ALERTS_COPY.editButton,
    SERVER_ALERTS_COPY.phoneTitle,
    SERVER_ALERTS_COPY.phoneDescription,
    SERVER_ALERTS_COPY.pushTitle,
    SERVER_ALERTS_COPY.pushDescription,
  ];

  test("English holds every word as itself", () => {
    const english: Locale = readLocale("en");

    for (const word of WORDS) {
      expect(english[word]).toBe(word);
    }
  });

  test.each(
    ADMIN_DASHBOARD_LANGUAGES.map((code: string) => {
      return [code];
    }),
  )("%s words every one of them", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const word of WORDS) {
      expect(locale[word]).toBeTruthy();
      expect(locale[word]).not.toBe(word);
    }
  });
});
