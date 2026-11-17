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
import SessionsWithoutSso from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SessionsWithoutSso";
import {
  SESSIONS_WITHOUT_SSO_COPY,
  SESSIONS_WITHOUT_SSO_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  END_SESSIONS_WITHOUT_SSO_ROUTE,
  SESSIONS_WITHOUT_SSO_ROUTE,
  SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
} from "../../../Types/SSO/SessionsWithoutSso";
import API from "../../../UI/Utils/API/API";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * PEOPLE STILL SIGNED IN WITHOUT SSO, on the Require SSO card while it is on
 * (#6116).
 *
 * Right after Require SSO is turned on - and whenever the page opens while
 * it is - the card says how many people are still signed in without SSO
 * and offers to sign them out. After a dialog it asks the server to end
 * their sessions, then reads the count again: once nobody is left, nothing
 * is drawn. Nothing is drawn either while nobody is, or when the count
 * cannot be read. A refusal stays in the dialog, saying why. Every string is
 * drawn in the reader's language, from the Admin Dashboard's locale files.
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
let endAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

beforeEach(() => {
  asked = [];
  counts = [];
  endAnswer = new HTTPResponse<JSONObject>(200, { sessionsEnded: 3 }, {});

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const request: { method: HTTPMethod; url: URL } = options as {
        method: HTTPMethod;
        url: URL;
      };
      const url: string = String(request.url);

      asked.push({ method: request.method, url });

      if (url.endsWith(END_SESSIONS_WITHOUT_SSO_ROUTE)) {
        return endAnswer;
      }

      if (url.endsWith(SESSIONS_WITHOUT_SSO_ROUTE)) {
        const next: number | Error | undefined = counts.shift();

        if (next instanceof Error || next === undefined) {
          return new HTTPErrorResponse(500, { message: "Not now." }, {});
        }

        return new HTTPResponse<JSONObject>(200, { peopleCount: next }, {});
      }

      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
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
      <SessionsWithoutSso />
    </I18nextProvider>,
  );

  await flush();
}

function countLine(): string {
  return (
    screen.getByTestId(`${SESSIONS_WITHOUT_SSO_TEST_ID}-count`).textContent ||
    ""
  );
}

function signOutButton(): HTMLElement {
  return screen.getByTestId(`${SESSIONS_WITHOUT_SSO_TEST_ID}-sign-out`);
}

const ENGLISH_MANY: string =
  "3 people are still signed in without SSO. They can't open any project until they sign in with SSO.";
const ENGLISH_ONE: string =
  "1 person is still signed in without SSO. They can't open any project until they sign in with SSO.";

describe("how many people are still signed in without SSO", () => {
  test("reads the count from the server, once, by a GET", async () => {
    counts = [3];

    await renderIn();

    expect(asked).toEqual([
      expect.objectContaining({ method: HTTPMethod.GET }),
    ]);
    expect(asked[0]!.url.endsWith(SESSIONS_WITHOUT_SSO_ROUTE)).toBe(true);
  });

  test("says how many, with the button that signs them out", async () => {
    counts = [3];

    await renderIn();

    expect(countLine()).toBe(ENGLISH_MANY);
    expect(signOutButton()).toHaveTextContent("Sign them out");
  });

  test("one person reads as one", async () => {
    counts = [1];

    await renderIn();

    expect(countLine()).toBe(ENGLISH_ONE);
  });

  test("draws nothing while nobody is signed in without SSO", async () => {
    counts = [0];

    await renderIn();

    expect(
      screen.queryByTestId(SESSIONS_WITHOUT_SSO_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("draws nothing when the count cannot be read", async () => {
    counts = [new Error("read failed")];

    await renderIn();

    expect(
      screen.queryByTestId(SESSIONS_WITHOUT_SSO_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("signing them out", () => {
  test("asks first, saying master admins stay signed in", async () => {
    counts = [3];

    await renderIn();

    fireEvent.click(signOutButton());
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      SESSIONS_WITHOUT_SSO_COPY.confirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(SESSIONS_WITHOUT_SSO_COPY.confirmDescription);
    expect(SESSIONS_WITHOUT_SSO_COPY.confirmDescription).toContain(
      "Master admins stay signed in.",
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Sign them out");

    // Nothing is ended by opening the dialog.
    expect(
      asked.filter((call: Asked): boolean => {
        return call.method === HTTPMethod.POST;
      }),
    ).toHaveLength(0);
  });

  test("Cancel signs nobody out", async () => {
    counts = [3];

    await renderIn();

    fireEvent.click(signOutButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-close-button",
      ),
    );
    await flush();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      asked.filter((call: Asked): boolean => {
        return call.method === HTTPMethod.POST;
      }),
    ).toHaveLength(0);
    expect(countLine()).toBe(ENGLISH_MANY);
  });

  test("going ahead ends their sessions on the server, reads the count again, and then draws nothing", async () => {
    counts = [3, 0];

    await renderIn();

    fireEvent.click(signOutButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    const posts: Array<Asked> = asked.filter((call: Asked): boolean => {
      return call.method === HTTPMethod.POST;
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.endsWith(END_SESSIONS_WITHOUT_SSO_ROUTE)).toBe(true);

    // Read again after the sign-out: nobody is left, so nothing is drawn.
    expect(asked[asked.length - 1]!.method).toBe(HTTPMethod.GET);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(SESSIONS_WITHOUT_SSO_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a refusal stays in the dialog, saying why, and nothing else changes", async () => {
    counts = [3];
    endAnswer = new HTTPErrorResponse(
      400,
      { message: SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE },
      {},
    );

    await renderIn();

    fireEvent.click(signOutButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent(
      SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
    );
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
      expect(signOutButton()).toHaveTextContent(
        String(entries[SESSIONS_WITHOUT_SSO_COPY.signOutButton]),
      );

      fireEvent.click(signOutButton());
      await flush();

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
        String(entries[SESSIONS_WITHOUT_SSO_COPY.confirmTitle]),
      );
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        String(entries[SESSIONS_WITHOUT_SSO_COPY.confirmDescription]),
      );
    },
  );
});
