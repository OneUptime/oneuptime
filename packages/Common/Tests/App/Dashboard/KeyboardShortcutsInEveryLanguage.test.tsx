import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import Help, {
  HELP_ASK_GROUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import DashboardKeyboardShortcuts from "../../../../App/FeatureSet/Dashboard/src/Components/KeyboardShortcuts/DashboardKeyboardShortcuts";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * THE KEYBOARD SHORTCUTS DIALOG, HELP'S ROW FOR IT AND SEARCH, DRAWN IN
 * EVERY DASHBOARD LANGUAGE (#7235).
 *
 * KeyboardShortcutsWordsInLocale reads the locale files; this draws the
 * three places a reader meets the words, with the Dashboard's real locale
 * files behind a real i18next instance, and reads what is on the screen:
 *
 *  - the Keyboard shortcuts dialog (`?`): its title, its description, its
 *    two groups, its five rows and the "then" between a go-to's two keys;
 *  - Help's menu: its row for the dialog is named as the dialog is, and
 *    choosing it opens the dialog;
 *  - Search (Cmd/Ctrl+K): its name, its placeholder, its key hints, its
 *    empty state, and its Keyboard shortcuts and Ask AI actions, found by
 *    typing their names in the reader's own words.
 *
 * In each language none of the English OneUptime wrote for those places is
 * drawn (Spanish's General aside: it is the Spanish word). A negative
 * control draws Russian with one word put back to English, so the check is
 * known to catch it.
 */

const navigateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
      getCurrentProject: (): null => {
        return null;
      },
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

// A nested key by its path, a flat one (the English text) as it is written.
function valueOf(locale: LocaleTree, key: string): string {
  const flat: string | LocaleTree | undefined = locale[key];

  if (typeof flat === "string") {
    return flat;
  }

  let node: string | LocaleTree | undefined = locale;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      throw new Error(`No ${key}`);
    }

    node = node[segment];
  }

  if (typeof node !== "string") {
    throw new Error(`No ${key}`);
  }

  return node;
}

const ENGLISH: LocaleTree = readLocale("en");

// What the dialog draws as words of its own, the go-to rows' product names aside.
const DIALOG_KEYS: ReadonlyArray<string> = [
  "keyboardShortcuts.title",
  "keyboardShortcuts.description",
  "keyboardShortcuts.groups.general",
  "keyboardShortcuts.groups.goTo",
  "keyboardShortcuts.commandPalette",
  "keyboardShortcuts.askAi",
  "keyboardShortcuts.searchList",
  "keyboardShortcuts.showShortcuts",
  "keyboardShortcuts.dismiss",
  "keyboardShortcuts.then",
  "common.close",
];

// The words a language writes as English does, each with its reason.
const SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  es: {
    "keyboardShortcuts.groups.general": "Spanish for General is General",
  },
};

function isSameAsEnglish(language: string, key: string): boolean {
  return Boolean(SAME_AS_ENGLISH[language]?.[key]);
}

const instances: Map<string, i18n> = new Map<string, i18n>();

// The Dashboard's own configuration (Utils/i18n.ts): default separators, English behind.
async function instanceFor(
  language: string,
  locale: LocaleTree = readLocale(language),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

function inLanguage(instance: i18n, children: ReactElement): ReactElement {
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

// The texts drawn in an element, one per element that holds text of its own.
function drawnTexts(element: HTMLElement): Array<string> {
  const texts: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );

  while (walker.nextNode()) {
    const text: string = (walker.currentNode.textContent || "").trim();

    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

/*
 * The dialog's keys whose English is drawn in it (a text of its own that is
 * the English word), apart from the stated same-as-English words.
 */
function englishInDialog(dialog: HTMLElement, language: string): Array<string> {
  const texts: Array<string> = drawnTexts(dialog);

  return DIALOG_KEYS.filter((key: string): boolean => {
    return (
      !isSameAsEnglish(language, key) && texts.includes(valueOf(ENGLISH, key))
    );
  });
}

function openDialog(): HTMLElement {
  act(() => {
    GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
  });

  return screen.getByRole("dialog");
}

function openSearch(): HTMLElement {
  act(() => {
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  });

  return screen.getByTestId("command-palette");
}

function typeInSearch(query: string): void {
  act(() => {
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: query },
    });
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  // Search's panel schedules its enter frame; fake timers keep it inside act().
  jest.useFakeTimers();
  window.localStorage.clear();
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  getListMock.mockReset();
});

describe("the check itself (negative control)", () => {
  test("English draws every English word, and the check finds them all", async () => {
    render(inLanguage(await instanceFor("en"), <DashboardKeyboardShortcuts />));

    expect(englishInDialog(openDialog(), "en")).toEqual(DIALOG_KEYS);
  });

  test("Russian with its title and its then put back to English, as #7235 found them: the check finds both", async () => {
    const russian: LocaleTree = readLocale("ru");
    const shortcuts: LocaleTree = russian["keyboardShortcuts"] as LocaleTree;
    shortcuts["title"] = "Keyboard shortcuts";
    shortcuts["then"] = "then";
    /*
     * The dialog (Common's Modal) looks its title up once more as a flat
     * key, so the flat twin was English as well: with it worded, the title
     * would still be drawn in Russian.
     */
    russian["Keyboard shortcuts"] = "Keyboard shortcuts";

    render(
      inLanguage(
        await instanceFor("ru", russian),
        <DashboardKeyboardShortcuts />,
      ),
    );

    expect(englishInDialog(openDialog(), "ru")).toEqual([
      "keyboardShortcuts.title",
      "keyboardShortcuts.then",
    ]);
  });

  test("the stated same-as-English words are Spanish's alone, and still the same as English", () => {
    expect(Object.keys(SAME_AS_ENGLISH)).toEqual(["es"]);
    expect(valueOf(readLocale("es"), "keyboardShortcuts.groups.general")).toBe(
      valueOf(ENGLISH, "keyboardShortcuts.groups.general"),
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the keyboard shortcuts in %s",
  (language: string) => {
    const locale: LocaleTree = readLocale(language);
    const title: string = valueOf(locale, "keyboardShortcuts.title");

    beforeAll(async () => {
      instances.set(language, await instanceFor(language));
    });

    function instance(): i18n {
      return instances.get(language)!;
    }

    test("the dialog draws its title, description, groups, rows and then in the language, and none of the English", () => {
      render(inLanguage(instance(), <DashboardKeyboardShortcuts />));

      const dialog: HTMLElement = openDialog();
      const texts: Array<string> = drawnTexts(dialog);

      for (const key of DIALOG_KEYS) {
        expect({
          key: key,
          drawn: texts.includes(valueOf(locale, key)),
        }).toEqual({ key: key, drawn: true });
      }

      // "then" sits between the two keys of every go-to row.
      expect(
        within(dialog).getAllByText(valueOf(locale, "keyboardShortcuts.then"))
          .length,
      ).toBeGreaterThan(5);

      expect(englishInDialog(dialog, language)).toEqual([]);
    });

    test("Help's ask group opens on the dialog's row, named as the dialog is, and choosing it opens the dialog", () => {
      render(
        inLanguage(
          instance(),
          <>
            <Help />
            <DashboardKeyboardShortcuts />
          </>,
        ),
      );

      fireEvent.click(
        screen.getByRole("button", { name: valueOf(locale, "help.label") }),
      );

      const ask: HTMLElement = screen.getByTestId(HELP_ASK_GROUP_TEST_ID);
      // Help's rows are links (IconDropdownItem); the dialog's is the first to ask with.
      const row: HTMLElement = ask.querySelectorAll<HTMLElement>("a")[0]!;

      expect(row).toHaveTextContent(title);
      expect(within(ask).queryByText("Keyboard shortcuts")).toBeNull();

      act(() => {
        fireEvent.click(row);
      });

      const dialog: HTMLElement = screen.getByRole("dialog");
      expect(within(dialog).getAllByText(title).length).toBeGreaterThan(0);
      expect(within(dialog).queryByText("Keyboard shortcuts")).toBeNull();
    });

    test("Search is named, prompts and hints in the language", () => {
      render(inLanguage(instance(), <DashboardCommandPalette />));

      const search: HTMLElement = openSearch();
      const input: HTMLElement = screen.getByTestId("command-palette-input");
      const placeholder: string = valueOf(locale, "Search pages, actions…");

      expect(search).toHaveAttribute(
        "aria-label",
        valueOf(locale, "Command palette"),
      );
      expect(input).toHaveAttribute("placeholder", placeholder);
      expect(input).toHaveAttribute("aria-label", placeholder);

      const footer: Array<string> = drawnTexts(
        screen.getByTestId("command-palette-footer"),
      );

      for (const key of ["to navigate", "to select", "to close"]) {
        expect({
          key: key,
          drawn: footer.includes(valueOf(locale, key)),
        }).toEqual({ key: key, drawn: true });
        expect({ key: key, english: footer.includes(key) }).toEqual({
          key: key,
          english: false,
        });
      }

      typeInSearch("zqxwvzqxwv");

      expect(screen.getByTestId("command-palette-empty")).toHaveTextContent(
        valueOf(locale, "No results found."),
      );
      expect(screen.queryByText("No results found.")).toBeNull();
    });

    test("typing the dialog's name in the language finds Search's Keyboard shortcuts action, which opens the dialog", () => {
      render(
        inLanguage(
          instance(),
          <>
            <DashboardCommandPalette />
            <DashboardKeyboardShortcuts />
          </>,
        ),
      );

      openSearch();
      typeInSearch(title);

      const action: HTMLElement = screen.getByTestId(
        "command-palette-option-action-keyboard-shortcuts",
      );
      expect(action).toHaveTextContent(title);
      expect(action).not.toHaveTextContent("Keyboard shortcuts");

      act(() => {
        fireEvent.click(action);
      });

      expect(screen.queryByTestId("command-palette")).toBeNull();
      expect(
        within(screen.getByRole("dialog")).getAllByText(title).length,
      ).toBeGreaterThan(0);
    });

    test("typing Ask AI in the language finds Search's Ask AI action, named as the dialog's row is", () => {
      const askAi: string = valueOf(locale, "commandPalette.actions.askAi");

      expect(askAi).toBe(valueOf(locale, "keyboardShortcuts.askAi"));

      render(inLanguage(instance(), <DashboardCommandPalette />));

      openSearch();
      typeInSearch(askAi);

      const action: HTMLElement = screen.getByTestId(
        "command-palette-option-action-ask-ai",
      );
      expect(drawnTexts(action)).toContain(askAi);
      expect(drawnTexts(action)).not.toContain("Ask AI");
    });
  },
);
