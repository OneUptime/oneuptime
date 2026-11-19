import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import { getJestSpyOn } from "../../Spy";
import SavedSignInSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SavedSignInSettings";
import {
  SAVED_SIGN_IN_SETTINGS_COPY,
  SAVED_SIGN_IN_SETTINGS_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
  SAVED_SIGN_IN_SETTINGS_ROUTE,
} from "../../../Types/SSO/LocalSignInClearing";
import API from "../../../UI/Utils/API/API";
import Toast from "../../../UI/Utils/Toast";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * SIGN-IN SETTINGS PEOPLE SAVED BEFORE SSO WAS REQUIRED, on the Require SSO
 * card while it is on (#9762).
 *
 * The card says how many people the requirement covers still have a
 * password or two-factor authentication saved - kept, unused, and working
 * again the moment SSO stops being required - and offers to clear them.
 * The dialog says it cannot be undone and that master admins keep theirs;
 * going ahead asks the server to clear them, says how many it cleared, and
 * reads the count again: once nobody is left, nothing is drawn. Nothing is
 * drawn either while nobody has any, or when the count cannot be read. A
 * refusal stays in the dialog, saying why. Every string is drawn in the
 * reader's language, from the Admin Dashboard's locale files.
 */

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

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface Asked {
  method: HTTPMethod;
  url: string;
}

let asked: Array<Asked> = [];
// The counts the server answers, in turn; an Error answers a failed read.
let counts: Array<number | Error> = [];
let clearAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let toasts: Array<string> = [];

beforeEach(() => {
  asked = [];
  counts = [];
  toasts = [];
  clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 3 }, {});

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const request: { method: HTTPMethod; url: URL } = options as {
        method: HTTPMethod;
        url: URL;
      };
      const url: string = String(request.url);

      asked.push({ method: request.method, url });

      if (url.endsWith(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE)) {
        return clearAnswer;
      }

      if (url.endsWith(SAVED_SIGN_IN_SETTINGS_ROUTE)) {
        const next: number | Error | undefined = counts.shift();

        if (next instanceof Error || next === undefined) {
          return new HTTPErrorResponse(500, { message: "Not now." }, {});
        }

        return new HTTPResponse<JSONObject>(200, { peopleCount: next }, {});
      }

      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
    },
  );

  getJestSpyOn(Toast, "success").mockImplementation(
    (title: unknown): string => {
      toasts.push(String(title));
      return "toast";
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderIn(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <SavedSignInSettings />
    </I18nextProvider>,
  );

  await flush();
}

function countLine(): string {
  return (
    screen.getByTestId(`${SAVED_SIGN_IN_SETTINGS_TEST_ID}-count`).textContent ||
    ""
  );
}

function clearButton(): HTMLElement {
  return screen.getByTestId(`${SAVED_SIGN_IN_SETTINGS_TEST_ID}-clear`);
}

function posts(): Array<Asked> {
  return asked.filter((call: Asked): boolean => {
    return call.method === HTTPMethod.POST;
  });
}

const ENGLISH_MANY: string =
  "3 people still have a password or two-factor authentication saved in OneUptime. It would sign them in again if SSO stopped being required.";
const ENGLISH_ONE: string =
  "1 person still has a password or two-factor authentication saved in OneUptime. It would sign them in again if SSO stopped being required.";

describe("how many people still have sign-in settings saved", () => {
  test("reads the count from the server, once, by a GET", async () => {
    counts = [3];

    await renderIn();

    expect(asked).toEqual([
      expect.objectContaining({ method: HTTPMethod.GET }),
    ]);
    expect(asked[0]!.url.endsWith(SAVED_SIGN_IN_SETTINGS_ROUTE)).toBe(true);
  });

  test("says how many, why it matters, and offers to clear them", async () => {
    counts = [3];

    await renderIn();

    expect(countLine()).toBe(ENGLISH_MANY);
    expect(clearButton()).toHaveTextContent("Clear Sign-In Settings");
  });

  test("one person reads as one", async () => {
    counts = [1];

    await renderIn();

    expect(countLine()).toBe(ENGLISH_ONE);
  });

  test("draws nothing while nobody has anything saved", async () => {
    counts = [0];

    await renderIn();

    expect(
      screen.queryByTestId(SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("draws nothing when the count cannot be read", async () => {
    counts = [new Error("read failed")];

    await renderIn();

    expect(
      screen.queryByTestId(SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("clearing them", () => {
  test("asks first, saying it cannot be undone and that master admins keep theirs", async () => {
    counts = [3];

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription);
    expect(SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription).toContain(
      "This cannot be undone.",
    );
    expect(SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription).toContain(
      "Master admins keep theirs.",
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Clear Sign-In Settings");

    // Nothing is cleared by opening the dialog.
    expect(posts()).toHaveLength(0);
  });

  test("the dialog's sentence fits a dialog's description", () => {
    expect(
      SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription.length,
    ).toBeLessThanOrEqual(150);
  });

  test("Cancel clears nothing", async () => {
    counts = [3];

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-close-button",
      ),
    );
    await flush();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(toasts).toEqual([]);
    expect(countLine()).toBe(ENGLISH_MANY);
  });

  test("going ahead clears them on the server, says how many, reads the count again, and then draws nothing", async () => {
    counts = [3, 0];

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.url.endsWith(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE)).toBe(
      true,
    );

    expect(toasts).toEqual(["Cleared the sign-in settings of 3 people."]);

    // Read again after the clear: nobody is left, so nothing is drawn.
    expect(asked[asked.length - 1]!.method).toBe(HTTPMethod.GET);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("one person cleared reads as one", async () => {
    counts = [1, 0];
    clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 1 }, {});

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    expect(toasts).toEqual(["Cleared the sign-in settings of 1 person."]);
  });

  test("an answer that is not one says no count it was not given", async () => {
    counts = [3, 0];
    clearAnswer = new HTTPResponse<JSONObject>(200, { cleared: "yes" }, {});

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    expect(toasts).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a refusal stays in the dialog, saying why, and nothing else changes", async () => {
    counts = [3];
    clearAnswer = new HTTPErrorResponse(
      400,
      { message: CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE },
      {},
    );

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent(
      CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
    );
    expect(toasts).toEqual([]);
    expect(countLine()).toBe(ENGLISH_MANY);
  });
});

describe("in every language", () => {
  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s draws the count, the button and the dialog in that language",
    async (locale: string) => {
      counts = [3];
      const entries: Locale = readLocale(locale);

      await renderIn(locale);

      const line: string = countLine();

      expect(line).not.toBe(ENGLISH_MANY);
      expect(line).not.toContain("{{count}}");
      expect(clearButton()).toHaveTextContent(
        String(entries[SAVED_SIGN_IN_SETTINGS_COPY.clearButton]),
      );

      fireEvent.click(clearButton());
      await flush();

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
        String(entries[SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle]),
      );
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        String(entries[SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription]),
      );
    },
  );
});
