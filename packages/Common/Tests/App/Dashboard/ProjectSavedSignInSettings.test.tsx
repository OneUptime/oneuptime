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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "9a9a9a9a-0000-4000-8000-0000000000cc" };
      },
    },
  };
});

import ProjectSavedSignInSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Project/ProjectSavedSignInSettings";
import {
  PROJECT_SAVED_SIGN_IN_SETTINGS_COPY,
  PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/ProjectSavedSignInSettingsCopy";
import RequireSsoForLoginCard from "../../../../App/FeatureSet/Dashboard/src/Components/Project/RequireSsoForLoginCard";
import { MANAGE_SIGN_IN_WITH_SSO_SWITCH_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Project/ManageSignInWithSsoSwitchCopy";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsRoute,
} from "../../../Types/SSO/LocalSignInClearing";
import API from "../../../UI/Utils/API/API";
import PermissionUtil from "../../../UI/Utils/Permission";
import Toast from "../../../UI/Utils/Toast";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * WHAT A PROJECT'S PEOPLE SAVED BEFORE IT MANAGED SIGN-IN WITH SSO, for its
 * owners to clear (#9820), under Manage Sign-In with SSO on Settings > SSO.
 *
 * The row says how many of the project's people - only people whose every
 * project the owner owns - still have a password or two-factor
 * authentication saved, and offers to clear them: the dialog says it cannot
 * be undone and that each is emailed; going ahead asks the server, says how
 * many it cleared, and reads the count again. Nothing is drawn while nobody
 * has any, when the count cannot be read, or for anybody the server does
 * not answer (it answers only the project's owners). Every request names the
 * project, in its path and its header. Under the card, the row is there only
 * while the project manages sign-in with SSO - and never under the plan's
 * upsell. In every Dashboard language.
 */

const PROJECT_ID: string = "9a9a9a9a-0000-4000-8000-0000000000cc";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
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
  headers: Dictionary<string>;
}

let asked: Array<Asked> = [];
// The counts the server answers, in turn; an Error a failed read, a number refused.
let counts: Array<number | Error | "refused"> = [];
let clearAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let toasts: Array<string> = [];
// The info toasts: what a clear that cleared nobody says (#10776).
let infos: Array<string> = [];

const COUNT_PATH: string = getProjectSavedSignInSettingsRoute(PROJECT_ID);
const CLEAR_PATH: string = getProjectClearSavedSignInSettingsRoute(PROJECT_ID);

beforeEach(() => {
  asked = [];
  counts = [];
  toasts = [];
  infos = [];
  clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 3 }, {});

  const answer: (request: {
    method: HTTPMethod;
    url: URL;
    headers?: Dictionary<string>;
  }) => unknown = (request: {
    method: HTTPMethod;
    url: URL;
    headers?: Dictionary<string>;
  }): unknown => {
    const url: string = String(request.url);

    asked.push({
      method: request.method,
      url,
      headers: request.headers || {},
    });

    if (url.endsWith(CLEAR_PATH)) {
      return clearAnswer;
    }

    if (url.endsWith(COUNT_PATH)) {
      const next: number | Error | "refused" | undefined = counts.shift();

      if (next === "refused") {
        return new HTTPErrorResponse(
          403,
          { message: CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE },
          {},
        );
      }

      if (next instanceof Error || next === undefined) {
        return new HTTPErrorResponse(500, { message: "Not now." }, {});
      }

      return new HTTPResponse<JSONObject>(200, { peopleCount: next }, {});
    }

    return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
  };

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      return answer(
        options as {
          method: HTTPMethod;
          url: URL;
          headers?: Dictionary<string>;
        },
      );
    },
  );

  getJestSpyOn(API, "post").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      return answer({
        ...(options as { url: URL; headers?: Dictionary<string> }),
        method: HTTPMethod.POST,
      });
    },
  );

  getJestSpyOn(Toast, "success").mockImplementation(
    (title: unknown): string => {
      toasts.push(String(title));
      return "toast";
    },
  );

  getJestSpyOn(Toast, "info").mockImplementation((title: unknown): string => {
    infos.push(String(title));
    return "toast";
  });

  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderIn(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ProjectSavedSignInSettings projectId={new ObjectID(PROJECT_ID)} />
    </I18nextProvider>,
  );

  await flush();
}

function countLine(): string {
  return (
    screen.getByTestId(`${PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID}-count`)
      .textContent || ""
  );
}

function clearButton(): HTMLElement {
  return screen.getByTestId(`${PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID}-clear`);
}

function posts(): Array<Asked> {
  return asked.filter((call: Asked): boolean => {
    return call.method === HTTPMethod.POST;
  });
}

async function openAndConfirm(): Promise<void> {
  fireEvent.click(clearButton());
  await flush();

  fireEvent.click(
    within(screen.getByRole("dialog")).getByTestId(
      "modal-footer-submit-button",
    ),
  );
  await flush();
}

const ENGLISH_MANY: string =
  "3 people whose projects are all yours still have a password or two-factor authentication saved in OneUptime.";
const ENGLISH_ONE: string =
  "1 person whose projects are all yours still has a password or two-factor authentication saved in OneUptime.";

describe("how many of the project's people still have sign-in settings saved", () => {
  test("reads the count for this project, once, by a GET that names it in its path and its header", async () => {
    counts = [3];

    await renderIn();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe(HTTPMethod.GET);
    expect(asked[0]!.url.endsWith(COUNT_PATH)).toBe(true);
    expect(asked[0]!.headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("says how many, and offers to clear them", async () => {
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
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("draws nothing when the count cannot be read", async () => {
    counts = [new Error("read failed")];

    await renderIn();

    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("draws nothing for a member who is not an owner: the server does not answer them", async () => {
    counts = ["refused"];

    await renderIn();

    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("clearing them", () => {
  test("asks first, saying it cannot be undone and that each is emailed", async () => {
    counts = [3];

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription);
    expect(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription).toContain(
      "This cannot be undone.",
    );
    expect(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription).toContain(
      "each is emailed",
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Clear Sign-In Settings");

    // Nothing is cleared by opening the dialog.
    expect(posts()).toHaveLength(0);
  });

  test("the dialog's sentence fits a dialog's description", () => {
    expect(
      PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription.length,
    ).toBeLessThanOrEqual(150);
  });

  test("the button and its toast say what the Admin Dashboard's clear says: one name per thing", () => {
    expect(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.clearButton).toBe(
      "Clear Sign-In Settings",
    );
    expect(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.cleared).toEqual({
      one: "Cleared the sign-in settings of {{count}} person.",
      other: "Cleared the sign-in settings of {{count}} people.",
    });
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

  test("going ahead clears them for this project, says how many, reads the count again, and then draws nothing", async () => {
    counts = [3, 0];

    await renderIn();
    await openAndConfirm();

    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.url.endsWith(CLEAR_PATH)).toBe(true);
    expect(posts()[0]!.headers["tenantid"]).toBe(PROJECT_ID);

    expect(toasts).toEqual(["Cleared the sign-in settings of 3 people."]);

    expect(asked[asked.length - 1]!.method).toBe(HTTPMethod.GET);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("one person cleared reads as one", async () => {
    counts = [1, 0];
    clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 1 }, {});

    await renderIn();
    await openAndConfirm();

    expect(toasts).toEqual(["Cleared the sign-in settings of 1 person."]);
  });

  test("people still left - some joined another organization meanwhile - are counted again", async () => {
    counts = [3, 1];
    clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 2 }, {});

    await renderIn();
    await openAndConfirm();

    expect(toasts).toEqual(["Cleared the sign-in settings of 2 people."]);
    expect(countLine()).toBe(ENGLISH_ONE);
  });

  test("an answer that is not one says no count it was not given", async () => {
    counts = [3, 0];
    clearAnswer = new HTTPResponse<JSONObject>(200, { cleared: "yes" }, {});

    await renderIn();
    await openAndConfirm();

    expect(toasts).toEqual([]);
    expect(infos).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /*
   * #10776: another clear of the same people - another owner's, a server
   * admin's, or this dialog sent twice - came first, so the server cleared
   * and recorded nobody, and said so.
   */
  test("an answer that cleared nobody says their settings were already cleared, never a clear of 0 people", async () => {
    counts = [3, 0];
    clearAnswer = new HTTPResponse<JSONObject>(200, { peopleCleared: 0 }, {});

    await renderIn();
    await openAndConfirm();

    expect(toasts).toEqual([]);
    expect(infos).toEqual([
      "These people's sign-in settings were already cleared.",
    ]);
    expect(infos[0]).toBe(PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared);

    // The count is read again, and nobody is left to clear.
    expect(asked[asked.length - 1]!.method).toBe(HTTPMethod.GET);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a refusal stays in the dialog, saying why, and nothing else changes", async () => {
    counts = [3];
    clearAnswer = new HTTPErrorResponse(
      400,
      { message: CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE },
      {},
    );

    await renderIn();
    await openAndConfirm();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent(
      CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
    );
    expect(toasts).toEqual([]);
    expect(countLine()).toBe(ENGLISH_MANY);
  });
});

describe("under Manage Sign-In with SSO, on the Require SSO card", () => {
  function stored(project: Record<string, unknown>): void {
    getItemMock.mockImplementation(async (): Promise<Project> => {
      const item: Project = new Project();
      item._id = PROJECT_ID;
      Object.assign(item, project);
      return item;
    });
  }

  async function renderCard(isPlanLeftover?: boolean): Promise<void> {
    getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue([
      Permission.ProjectOwner,
    ]);

    render(
      <RequireSsoForLoginCard
        projectId={new ObjectID(PROJECT_ID)}
        isPlanLeftover={isPlanLeftover}
      />,
    );
    await flush();
  }

  function countReads(): number {
    return asked.filter((call: Asked): boolean => {
      return call.url.endsWith(COUNT_PATH);
    }).length;
  }

  test("while the project manages sign-in with SSO, the row is under the switch", async () => {
    stored({ requireSsoForLogin: true, manageSignInWithSso: true });
    counts = [2];

    await renderCard();

    expect(
      screen.getByTestId(MANAGE_SIGN_IN_WITH_SSO_SWITCH_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).toBeInTheDocument();
    expect(countReads()).toBe(1);
  });

  test("while it does not, nothing is read and nothing is drawn", async () => {
    stored({ requireSsoForLogin: true, manageSignInWithSso: false });
    counts = [2];

    await renderCard();

    expect(countReads()).toBe(0);
    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("while SSO is not required, nothing is read", async () => {
    stored({ requireSsoForLogin: false, manageSignInWithSso: true });
    counts = [2];

    await renderCard();

    expect(countReads()).toBe(0);
  });

  test("never under the plan's upsell, which is there only to switch things off", async () => {
    stored({ requireSsoForLogin: true, manageSignInWithSso: true });
    counts = [2];

    await renderCard(true);

    expect(countReads()).toBe(0);
    expect(
      screen.queryByTestId(PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("in every language", () => {
  test.each([...DASHBOARD_LANGUAGES])(
    "%s draws the count, the button and the dialog in that language",
    async (locale: string) => {
      counts = [3];
      const entries: Locale = readLocale(locale);

      await renderIn(locale);

      const line: string = countLine();

      expect(line).not.toBe(ENGLISH_MANY);
      expect(line).not.toContain("{{count}}");
      expect(clearButton()).toHaveTextContent(
        String(entries[PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.clearButton]),
      );

      fireEvent.click(clearButton());
      await flush();

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
        String(entries[PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle]),
      );
      expect(
        within(dialog).getByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        String(entries[PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription]),
      );
    },
  );

  test.each(
    DASHBOARD_LANGUAGES.filter((locale: string): boolean => {
      return locale !== "en";
    }),
  )(
    "%s says a clear that cleared nobody in its own words (#10776)",
    async (locale: string) => {
      counts = [3, 0];
      clearAnswer = new HTTPResponse<JSONObject>(
        200,
        { peopleCleared: 0 },
        {},
      );
      const entries: Locale = readLocale(locale);

      await renderIn(locale);
      await openAndConfirm();

      expect(infos).toHaveLength(1);
      expect(infos[0]).toBe(
        String(entries[PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared]),
      );
      expect(infos[0]).not.toBe(
        PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared,
      );
    },
  );
});
