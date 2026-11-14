import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * AN ADMIN DASHBOARD DETAIL CARD'S WORDS FOR AN EMPTY VALUE ARE LOOKED UP
 * ONCE (#7791).
 *
 * The Admin Dashboard words a detail field's empty value itself -
 * t("common.notConfigured"), t("common.none") - and the card handed the
 * translation to PlaceholderText, which looked it up again. No language
 * shows a wrong word with today's files, but where a translation is itself
 * an English key the reader would see the translation of the translation:
 * the Admin Dashboard's Spanish file says "Rojo" for "Red", so an empty
 * value worded "Red" read "Rojo". Now the page says the words are in the
 * reader's language already (isPlaceholderTranslated) and the card draws
 * them as given.
 *
 * Here Settings > Telegram, with nothing set up, in the Admin Dashboard's
 * Spanish - its "Not configured" worded "Red" - shows "Red" for each empty
 * field, never "Rojo".
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

interface MockPageProps {
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
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

import SettingsTelegram from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";

const WAIT_FOR_TIMEOUT: number = 20000;

type Locale = Record<string, unknown>;

const SPANISH: Locale = JSON.parse(
  fs.readFileSync(
    path.join(
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
      "es.json",
    ),
    "utf8",
  ),
) as Locale;

// The page's word for an empty value, and what it reads looked up again.
const ONCE: string = "Red";
const TWICE: string = "Rojo";

// The Admin Dashboard's Spanish, its "Not configured" worded "Red".
const TEST_SPANISH: Locale = {
  ...SPANISH,
  common: { ...(SPANISH["common"] as Locale), notConfigured: ONCE },
};

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

// Telegram, with nothing set up.
async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();

  return item;
}

let translation: i18n;

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Every line of text with nothing else in it.
function drawnTexts(): Array<string> {
  return Array.from(document.body.querySelectorAll("*"))
    .filter((element: Element): boolean => {
      return element.children.length === 0;
    })
    .map((element: Element): string => {
      return (element.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return Boolean(text);
    });
}

beforeEach(async () => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(API, "fetch").mockImplementation(async (): Promise<unknown> => {
    return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
  });

  translation = createInstance();

  await translation.init({
    lng: "es",
    fallbackLng: "es",
    resources: { es: { translation: TEST_SPANISH } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Settings > Telegram, with nothing set up, in Spanish", () => {
  test("the page's word for an empty value is another English key: Red reads Rojo looked up again", () => {
    expect(
      translation.t(ONCE, {
        keySeparator: false,
        nsSeparator: false,
        defaultValue: ONCE,
      }),
    ).toBe(TWICE);
  });

  test("each empty field reads the page's word, looked up once: Red, never Rojo", async () => {
    render(
      <I18nextProvider i18n={translation}>
        <SettingsTelegram />
      </I18nextProvider>,
    );
    await settle();

    // The bot's token, its username and the webhook's secret.
    await waitFor(
      () => {
        expect(
          drawnTexts().filter((text: string): boolean => {
            return text === ONCE;
          }),
        ).toHaveLength(3);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(drawnTexts()).not.toContain(TWICE);
    expect(
      screen.getByText(
        (
          ((TEST_SPANISH["pages"] as Locale)["settings"] as Locale)[
            "telegram"
          ] as Locale
        )["configCardTitle"] as string,
      ),
    ).toBeInTheDocument();
  });
});
