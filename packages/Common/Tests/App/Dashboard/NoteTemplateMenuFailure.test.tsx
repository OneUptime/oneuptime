import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import NoteTemplateMenu, {
  NoteTemplateOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { joinSentences } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import User from "../../../UI/Utils/User";

/*
 * THE NOTE COMPOSER'S TEMPLATES MENU, WHEN ITS TEMPLATES DO NOT LOAD (#7544).
 *
 * The menu drew API.getFriendlyMessage's answer as it came. For the errors
 * the client words itself - a failure the server could not explain, a
 * gateway's 502 or 504 - that is an English sentence: English on every
 * language's page, without #6836's explanation and its reference, and on a
 * Persian page with its full stop at its start. Its failure now reads like
 * every list's (ErrorMessageText): an error nobody explained says what
 * failed, why and what to do next, with the reference to copy; words of
 * their own are in the reader's language where it has them, and read the
 * way they are written where it does not. Its own Try again still reads
 * the templates again.
 *
 * Every language here is the Dashboard's own locale file, as it ships, read
 * by a self-hosted server's member: the reference goes to whoever runs the
 * server, and nothing is said about its logs.
 */

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

const LANGUAGES: Array<string> = ["en", "de", "fa"];

const REFERENCE: string = "a1b2c3d4";

// What the server answers for a failure it could not explain (#6836).
const SERVER_FAILURE: HTTPErrorResponse = new HTTPErrorResponse(
  500,
  {
    message: getUnexplainedServerErrorMessage(REFERENCE),
    reference: REFERENCE,
  },
  {},
);

// A gateway's own page in front of OneUptime: the server did not answer.
const GATEWAY_FAILURE: HTTPErrorResponse = new HTTPErrorResponse(502, {}, {});

// Words of their own, which the Dashboard's languages word.
const OWN_WORDS: string = "You don't have access to this list";

// Words of their own, in English only, as most of the server's answers are.
const ENGLISH_ONLY_WORDS: string =
  "This project was deleted, so its note templates are gone.";

const WHAT_FAILED: string = "Couldn't load note templates.";

const TEMPLATES: Array<NoteTemplateOption> = [
  { id: "1", name: "Identified", note: "**Identified.** We know why." },
  { id: "2", name: "Resolved", note: "**Resolved.** All good." },
];

// Every English sentence the failure can say, but for a quoted reference.
const ENGLISH_SENTENCES: Array<string> = [
  WHAT_FAILED,
  "Try again",
  getUnexplainedServerErrorMessage(REFERENCE),
  SERVER_DOWN_MESSAGE,
  ...Object.values(UnexplainedErrorWords).filter((words: string): boolean => {
    return !words.includes("{{");
  }),
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  // A member, not a master admin: nothing about the server's logs.
  jest.spyOn(User, "isMasterAdmin").mockImplementation((): boolean => {
    return false;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * The words a language has for an English sentence: the sentence itself in
 * English, and a word of the language's own in every other.
 */
const wordsIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  expect({
    language,
    english,
    worded: Boolean(words) && words !== english,
  }).toEqual({ language, english, worded: true });

  return words as string;
};

// The menu on a page in `language`, whose first read of templates fails.
const openFailedMenu: (
  language: string,
  failure: unknown,
) => Promise<{ menu: HTMLElement; loadTemplates: MockFunction }> = async (
  language: string,
  failure: unknown,
): Promise<{ menu: HTMLElement; loadTemplates: MockFunction }> => {
  const loadTemplates: MockFunction = getJestMockFunction();
  loadTemplates.mockRejectedValueOnce(failure as never);
  loadTemplates.mockResolvedValue(TEMPLATES as never);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <NoteTemplateMenu
        loadTemplates={() => {
          return loadTemplates() as Promise<Array<NoteTemplateOption>>;
        }}
        onPick={() => {}}
      />
    </I18nextProvider>,
  );

  fireEvent.click(screen.getByTestId("note-template-menu-button"));
  const menu: HTMLElement = await screen.findByTestId("note-template-menu");
  await within(menu).findByTestId("note-templates-error");

  return { menu, loadTemplates };
};

// Where the menu's footer and its empty state lead, as every page passes it.
const SETTINGS_ROUTE: Route = new Route(
  "/dashboard/security-events/settings/note-templates",
);

/*
 * The menu as a page draws it, opened from the keyboard: Enter on its
 * button, which moves the focus into the menu.
 */
const openMenuFromKeyboard: (
  loadTemplates: MockFunction,
) => Promise<HTMLElement> = async (
  loadTemplates: MockFunction,
): Promise<HTMLElement> => {
  render(
    <I18nextProvider i18n={instances["en"]!}>
      <NoteTemplateMenu
        loadTemplates={() => {
          return loadTemplates() as Promise<Array<NoteTemplateOption>>;
        }}
        onPick={() => {}}
        settingsRoute={SETTINGS_ROUTE}
      />
    </I18nextProvider>,
  );

  const trigger: HTMLElement = screen.getByTestId("note-template-menu-button");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });

  return screen.findByTestId("note-template-menu");
};

// The failure's words as a reader sees them.
const failureText: (menu: HTMLElement) => string = (
  menu: HTMLElement,
): string => {
  return withoutIsolateMarks(
    within(menu).getByTestId("note-templates-error").textContent || "",
  );
};

const expectNoEnglishSentence: (language: string, menu: HTMLElement) => void = (
  language: string,
  menu: HTMLElement,
): void => {
  const text: string = failureText(menu);

  for (const sentence of ENGLISH_SENTENCES) {
    expect({ language, sentence, left: text.includes(sentence) }).toEqual({
      language,
      sentence,
      left: false,
    });
  }
};

// Try again reads the templates again, and the menu lists them.
const expectTryAgainReadsThemAgain: (
  language: string,
  menu: HTMLElement,
  loadTemplates: MockFunction,
) => Promise<void> = async (
  language: string,
  menu: HTMLElement,
  loadTemplates: MockFunction,
): Promise<void> => {
  fireEvent.click(
    within(within(menu).getByTestId("note-templates-error")).getByRole(
      "button",
      { name: wordsIn(language, "Try again") },
    ),
  );

  expect(await within(menu).findAllByText("Identified")).not.toHaveLength(0);
  expect(loadTemplates).toHaveBeenCalledTimes(2);
  expect(within(menu).queryByTestId("note-templates-error")).toBeNull();
};

describe("NoteTemplateMenu, when its templates do not load", () => {
  test.each(LANGUAGES)(
    "in %s, a failure the server could not explain says what failed, why and what to do next, with the reference to copy",
    async (language: string) => {
      const { menu, loadTemplates } = await openFailedMenu(
        language,
        SERVER_FAILURE,
      );
      const failure: HTMLElement = within(menu).getByTestId(
        "note-templates-error",
      );

      expect(within(failure).getByTestId("error-what-failed").textContent).toBe(
        wordsIn(language, WHAT_FAILED),
      );
      expect(
        withoutIsolateMarks(
          within(failure).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverWhy),
          wordsIn(
            language,
            UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
          ),
        ]),
      );

      // The reference as written, left to right, with its copy button.
      const reference: HTMLElement =
        within(failure).getByTestId("error-reference");
      expect(reference.querySelector("code")).toHaveTextContent(REFERENCE);
      expect(reference.querySelector("code")).toHaveAttribute("dir", "ltr");
      expect(within(reference).getAllByRole("button")).toHaveLength(1);

      // A member is told nothing about the server's logs.
      expect(within(failure).queryByTestId("error-where-to-look")).toBeNull();

      // Never the sentence as API.getFriendlyMessage wrote it.
      expect(failureText(menu)).not.toContain(
        getUnexplainedServerErrorMessage(REFERENCE),
      );

      if (language !== "en") {
        expectNoEnglishSentence(language, menu);
      }

      await expectTryAgainReadsThemAgain(language, menu, loadTemplates);
    },
  );

  test.each(LANGUAGES)(
    "in %s, a gateway's 502 says the server did not answer, and what to do about it",
    async (language: string) => {
      const { menu, loadTemplates } = await openFailedMenu(
        language,
        GATEWAY_FAILURE,
      );
      const failure: HTMLElement = within(menu).getByTestId(
        "note-templates-error",
      );

      expect(within(failure).getByTestId("error-what-failed").textContent).toBe(
        wordsIn(language, WHAT_FAILED),
      );
      expect(
        withoutIsolateMarks(
          within(failure).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverDownWhy),
          wordsIn(language, UnexplainedErrorWords.serverDownNext),
        ]),
      );
      // On a self-hosted server, whoever runs it is told where to look.
      expect(
        within(failure).getByTestId("error-where-to-look").textContent,
      ).toBe(wordsIn(language, UnexplainedErrorWords.serverDownWhereToLook));
      expect(within(failure).queryByTestId("error-reference")).toBeNull();
      expect(failureText(menu)).not.toContain(SERVER_DOWN_MESSAGE);

      if (language !== "en") {
        expectNoEnglishSentence(language, menu);
      }

      await expectTryAgainReadsThemAgain(language, menu, loadTemplates);
    },
  );

  test.each(["de", "fa"])(
    "in %s, words of their own are drawn in the reader's language, as the page's own line",
    async (language: string) => {
      const { menu, loadTemplates } = await openFailedMenu(
        language,
        new HTTPErrorResponse(403, { message: OWN_WORDS }, {}),
      );
      const failure: HTMLElement = within(menu).getByTestId(
        "note-templates-error",
      );

      expect(failure.querySelector("p")?.textContent).toBe(
        wordsIn(language, OWN_WORDS),
      );
      expect(failureText(menu)).not.toContain(OWN_WORDS);
      // Not an error nobody explained, and not set apart from the page.
      expect(within(failure).queryByTestId("error-explanation")).toBeNull();
      expect(failure.querySelector("bdi")).toBeNull();

      await expectTryAgainReadsThemAgain(language, menu, loadTemplates);
    },
  );

  test("words the reader's language has not worded read the way they are written: left to right on a Persian page, with their full stop at their end", async () => {
    expect(readDashboardLocale("fa")[ENGLISH_ONLY_WORDS]).toBeUndefined();

    const { menu, loadTemplates } = await openFailedMenu(
      "fa",
      new HTTPErrorResponse(400, { message: ENGLISH_ONLY_WORDS }, {}),
    );
    const failure: HTMLElement = within(menu).getByTestId(
      "note-templates-error",
    );
    const words: HTMLElement | null = failure.querySelector("p bdi");

    expect(words).toHaveTextContent(ENGLISH_ONLY_WORDS);
    expect(words).toHaveAttribute("dir", "ltr");
    expect(within(failure).queryByTestId("error-explanation")).toBeNull();

    await expectTryAgainReadsThemAgain("fa", menu, loadTemplates);
  });

  test("on an English page, English words of their own are drawn as they always were", async () => {
    const { menu } = await openFailedMenu(
      "en",
      new HTTPErrorResponse(400, { message: ENGLISH_ONLY_WORDS }, {}),
    );
    const failure: HTMLElement = within(menu).getByTestId(
      "note-templates-error",
    );

    expect(failure.querySelector("p")?.textContent).toBe(ENGLISH_ONLY_WORDS);
    expect(failure.querySelector("bdi")).toBeNull();
  });

  /*
   * Opened from the keyboard, the menu moves the focus on to what can be
   * pressed once it has loaded. After a failure that is Try again, though
   * the reference's copy button comes before it.
   */
  test("opened from the keyboard, a failure puts the focus on Try again, not on the reference's copy button", async () => {
    const loadTemplates: MockFunction = getJestMockFunction();
    loadTemplates.mockRejectedValueOnce(SERVER_FAILURE as never);

    const menu: HTMLElement = await openMenuFromKeyboard(loadTemplates);
    const failure: HTMLElement = await within(menu).findByTestId(
      "note-templates-error",
    );
    const tryAgain: HTMLElement = within(failure).getByRole("button", {
      name: "Try again",
    });

    expect(
      within(within(failure).getByTestId("error-reference")).getByRole(
        "button",
      ),
    ).not.toBe(tryAgain);

    await waitFor(() => {
      expect(document.activeElement).toBe(tryAgain);
    });
  });
});

/*
 * The menu reads its templates once it has opened, so it has a moment with
 * nothing read yet - with no failure to draw, and no templates. It drew an
 * empty list there, with its footer's Manage templates: in a browser the
 * focus of an opening from the keyboard took the link, and lost it to the
 * page when the read ended and the link went. It draws its loading rows
 * instead, which hold nothing to focus but the menu itself.
 */
describe("NoteTemplateMenu, opened from the keyboard", () => {
  test("the focus lands on the first template, not on Manage templates", async () => {
    const loadTemplates: MockFunction = getJestMockFunction();
    loadTemplates.mockResolvedValue(TEMPLATES as never);

    const menu: HTMLElement = await openMenuFromKeyboard(loadTemplates);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(menu).getByRole("button", { name: /^Identified/ }),
      );
    });
  });
});

// A read of the templates that waits until the test answers it.
interface PendingRead {
  resolve: (templates: Array<NoteTemplateOption>) => void;
  reject: (error: unknown) => void;
}

/*
 * Try again gives way to the loading rows, which hold nothing to focus.
 * Pressed from the keyboard, it leaves the focus with the menu while the
 * templates load again - it fell to the page behind it, and stayed there -
 * and the menu hands it on when they arrive, as after an opening from the
 * keyboard: to the first template, or to Try again if they fail once more.
 */
describe("NoteTemplateMenu's Try again, pressed from the keyboard", () => {
  /*
   * The menu, opened from the keyboard on a failed read, with Try again
   * pressed: the read it starts waits in `pending`.
   */
  const pressTryAgain: () => Promise<{
    menu: HTMLElement;
    pending: Array<PendingRead>;
  }> = async (): Promise<{
    menu: HTMLElement;
    pending: Array<PendingRead>;
  }> => {
    const pending: Array<PendingRead> = [];
    const loadTemplates: MockFunction = getJestMockFunction();
    loadTemplates.mockRejectedValueOnce(SERVER_FAILURE as never);
    loadTemplates.mockImplementation((): Promise<Array<NoteTemplateOption>> => {
      return new Promise<Array<NoteTemplateOption>>(
        (
          resolve: (templates: Array<NoteTemplateOption>) => void,
          reject: (error: unknown) => void,
        ) => {
          pending.push({ resolve, reject });
        },
      );
    });

    const menu: HTMLElement = await openMenuFromKeyboard(loadTemplates);
    const failure: HTMLElement = await within(menu).findByTestId(
      "note-templates-error",
    );
    const tryAgain: HTMLElement = within(failure).getByRole("button", {
      name: "Try again",
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(tryAgain);
    });

    /*
     * Enter or Space on a focused button is a click on it, with the focus
     * where it is.
     */
    fireEvent.click(tryAgain);

    // Loading again, with the focus in the menu - not on the page.
    expect(
      within(menu).getByTestId("note-templates-loading"),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(menu);
    expect(pending).toHaveLength(1);

    return { menu, pending };
  };

  test("when the templates arrive, the focus moves on to the first of them", async () => {
    const { menu, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.resolve(TEMPLATES);
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(menu).getByRole("button", { name: /^Identified/ }),
      );
    });
  });

  test("when they fail once more, the focus moves on to Try again", async () => {
    const { menu, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.reject(GATEWAY_FAILURE);
    });

    const failure: HTMLElement = await within(menu).findByTestId(
      "note-templates-error",
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(failure).getByRole("button", { name: "Try again" }),
      );
    });
  });
});
