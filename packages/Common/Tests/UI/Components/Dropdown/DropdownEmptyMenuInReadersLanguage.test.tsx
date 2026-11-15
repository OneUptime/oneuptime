// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import Dropdown, {
  DROPDOWN_LOADING_MESSAGE,
  DROPDOWN_NO_MATCHES_MESSAGE,
  DROPDOWN_NO_OPTIONS_MESSAGE,
  DropdownOption,
  getDropdownNoOptionsMessage,
} from "../../../../UI/Components/Dropdown/Dropdown";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";

/*
 * A DROPDOWN'S SEARCH AND ITS EMPTY MENU, IN THE READER'S LANGUAGE (#7805).
 *
 * A Dropdown draws its options in the reader's language, and since #7613 its
 * search finds an option by the words it shows as well as by its English,
 * value and aliases. But a search that found nothing, or a list with
 * nothing in it, said react-select's own "No options" - in English on every
 * page, in every language - unless the caller worded a message of its own.
 * And a list on its way said react-select's "Loading...".
 *
 * Now the empty menu says the product's own words, looked up in the
 * reader's language: "No matches found" after a search, "No options
 * available" before one, and "Loading..." while the options load. A
 * caller's own words still win. The Dashboard words them in every
 * language, and the other front ends that draw the shared Dropdown - the
 * Admin Dashboard and a status page's subscribe forms - hold them in their
 * own locale files, worded the same. (Accounts draws no Dropdown, and a
 * public dashboard's widgets are drawn as they are.)
 *
 * Rendered through the real i18next with the Dashboard's locale files.
 */

const RENDERED: ReadonlyArray<string> = ["de", "ar", "fa"];

// The operators' words, worded in every language, and two options of other kinds.
const OPTIONS: Array<DropdownOption> = [
  { value: "Wildcard", label: "matches" },
  { value: "NotWildcard", label: "does not match" },
  { value: "Includes", label: "is any of", aliases: ["membership"] },
  // A record's name, drawn as written: never looked up, never searched as a word.
  { value: "network-label", label: "Network", isUserContent: true },
];

function box(): HTMLElement {
  return screen.getByRole("combobox");
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(box(), { key: "ArrowDown" });
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
}

function listed(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function notice(): string | null {
  return (
    document.querySelector<HTMLElement>(".ou-select__menu-notice")
      ?.textContent || null
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> =
    {};

  for (const language of RENDERED) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the empty menu's words", () => {
  test("are the product's own keys: a search's, a list's, a load's", () => {
    expect(DROPDOWN_NO_MATCHES_MESSAGE).toBe("No matches found");
    expect(DROPDOWN_NO_OPTIONS_MESSAGE).toBe("No options available");
    expect(DROPDOWN_LOADING_MESSAGE).toBe("Loading...");
    expect(getDropdownNoOptionsMessage("rabbit")).toBe("No matches found");
    // Nothing typed, or only spaces: the list itself is empty.
    expect(getDropdownNoOptionsMessage("")).toBe("No options available");
    expect(getDropdownNoOptionsMessage("   ")).toBe("No options available");
  });

  test.each(DASHBOARD_LANGUAGES)("%s words each of them", (language: string) => {
    expect(
      [
        DROPDOWN_NO_MATCHES_MESSAGE,
        DROPDOWN_NO_OPTIONS_MESSAGE,
        DROPDOWN_LOADING_MESSAGE,
      ].filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      }),
    ).toEqual([]);
  });

  test("in English they read as before, in the product's words", async () => {
    await inLanguage("en");
    render(<Dropdown ariaLabel="Operator" options={OPTIONS} />);

    await openMenu();
    await type("rabbit");

    expect(listed()).toEqual([]);
    expect(notice()).toBe("No matches found");

    cleanup();
    render(<Dropdown ariaLabel="Operator" options={[]} />);
    await openMenu();

    expect(notice()).toBe("No options available");
  });

  test.each(RENDERED)(
    "in %s a search that finds nothing says so in the language, never No options",
    async (language: string) => {
      await inLanguage(language);
      const words: Record<string, string> = readDashboardLocale(language);

      render(<Dropdown ariaLabel="Operator" options={OPTIONS} />);
      await openMenu();
      await type("rabbit");

      expect(listed()).toEqual([]);
      expect(notice()).toBe(words["No matches found"]);
      expect(notice()).not.toMatch(/No options|No matches/);
    },
  );

  test.each(RENDERED)(
    "in %s an empty list says it has nothing, and a list on its way that it is loading",
    async (language: string) => {
      await inLanguage(language);
      const words: Record<string, string> = readDashboardLocale(language);

      render(<Dropdown ariaLabel="Operator" options={[]} />);
      await openMenu();

      expect(notice()).toBe(words["No options available"]);

      cleanup();
      render(<Dropdown ariaLabel="Operator" options={[]} isLoading={true} />);
      await openMenu();

      expect(notice()).toBe(words["Loading..."]);
      expect(notice()).not.toBe("Loading...");
    },
  );

  test("a caller's own words still replace them, in every language", async () => {
    await inLanguage("de");

    render(
      <Dropdown
        ariaLabel="Operator"
        options={[]}
        isLoading={true}
        loadingMessage="Komponenten werden geladen…"
      />,
    );
    await openMenu();
    expect(notice()).toBe("Komponenten werden geladen…");

    cleanup();
    render(
      <Dropdown
        ariaLabel="Operator"
        options={OPTIONS}
        noOptionsMessage={(input: string): string => {
          return `Nichts heißt ${input}.`;
        }}
      />,
    );
    await openMenu();
    await type("rabbit");

    expect(notice()).toBe("Nichts heißt rabbit.");
  });

  test("the product's short line stays centred; a caller's sentence starts at the start", async () => {
    await inLanguage("de");

    render(<Dropdown ariaLabel="Operator" options={[]} />);
    await openMenu();

    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>(".ou-select__menu-notice")!,
      ).textAlign,
    ).toBe("center");

    cleanup();
    render(
      <Dropdown
        ariaLabel="Operator"
        options={[]}
        noOptionsMessage={(): string => {
          return "Geben Sie den Namen einer Komponente ein.";
        }}
      />,
    );
    await openMenu();

    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>(".ou-select__menu-notice")!,
      ).textAlign,
    ).toBe("start");
  });
});

describe("the search, in the reader's language", () => {
  test.each(RENDERED)(
    "in %s the shown words find an option, and so do its English, value and aliases",
    async (language: string) => {
      await inLanguage(language);
      const words: Record<string, string> = readDashboardLocale(language);

      render(<Dropdown ariaLabel="Operator" options={OPTIONS} />);
      await openMenu();

      await type(words["does not match"]!);
      expect(listed()).toEqual([words["does not match"]]);

      // The English someone types still finds it.
      await type("does not match");
      expect(listed()).toEqual([words["does not match"]]);

      // Its stored value and an alias too.
      await type("NotWildcard");
      expect(listed()).toEqual([words["does not match"]]);

      await type("membership");
      expect(listed()).toEqual([words["is any of"]]);
    },
  );

  test("a name someone gave is found by its own words only", async () => {
    await inLanguage("de");
    const words: Record<string, string> = readDashboardLocale("de");

    // German words "Network" as "Netzwerk" - the label is a name, not a word.
    expect(words["Network"]).toBe("Netzwerk");

    render(<Dropdown ariaLabel="Operator" options={OPTIONS} />);
    await openMenu();

    await type("Network");
    expect(listed()).toEqual(["Network"]);

    await type("Netzwerk");
    expect(listed()).toEqual([]);
    expect(notice()).toBe(words["No matches found"]);
  });
});

/*
 * The other front ends that draw the shared Dropdown keep locale files of
 * their own: there a key missing from its file read English whatever the
 * Dashboard says.
 */
const APPS_DRAWING_A_DROPDOWN: ReadonlyArray<string> = [
  "AdminDashboard",
  "StatusPage",
];

function readAppLocale(app: string, language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        `../../../../../App/FeatureSet/${app}/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The empty menu's words a file leaves out, or words otherwise than the Dashboard.
function unwordedIn(
  words: Record<string, string>,
  language: string,
): Array<string> {
  const dashboard: Record<string, string> = readDashboardLocale(language);

  return [
    DROPDOWN_NO_MATCHES_MESSAGE,
    DROPDOWN_NO_OPTIONS_MESSAGE,
    DROPDOWN_LOADING_MESSAGE,
  ].filter((key: string): boolean => {
    return words[key] === undefined || words[key] !== dashboard[key];
  });
}

describe("the other front ends that draw a Dropdown word its empty menu as the Dashboard does", () => {
  for (const app of APPS_DRAWING_A_DROPDOWN) {
    test(`${app}'s English holds the keys`, () => {
      const english: Record<string, string> = readAppLocale(app, "en");

      expect(english[DROPDOWN_NO_MATCHES_MESSAGE]).toBe("No matches found");
      expect(english[DROPDOWN_NO_OPTIONS_MESSAGE]).toBe(
        "No options available",
      );
      expect(english[DROPDOWN_LOADING_MESSAGE]).toBe("Loading...");
    });

    test.each(DASHBOARD_LANGUAGES)(`${app} in %s`, (language: string) => {
      expect(unwordedIn(readAppLocale(app, language), language)).toEqual([]);
    });
  }

  test("a key a file leaves out, or holds in English, is caught (control)", () => {
    const left: Record<string, string> = readAppLocale("StatusPage", "de");
    delete left[DROPDOWN_NO_MATCHES_MESSAGE];
    expect(unwordedIn(left, "de")).toEqual([DROPDOWN_NO_MATCHES_MESSAGE]);

    const english: Record<string, string> = {
      ...readAppLocale("AdminDashboard", "ar"),
      [DROPDOWN_NO_OPTIONS_MESSAGE]: DROPDOWN_NO_OPTIONS_MESSAGE,
    };
    expect(unwordedIn(english, "ar")).toEqual([DROPDOWN_NO_OPTIONS_MESSAGE]);
  });
});

/*
 * The Dropdown hands react-select both of its messages whatever the caller
 * passes: left to react-select, either one is English on every page.
 */
describe("the Dropdown never leaves react-select to word its menu", () => {
  const source: string = fs.readFileSync(
    path.join(__dirname, "../../../../UI/Components/Dropdown/Dropdown.tsx"),
    "utf8",
  );

  test("both messages are always handed over", () => {
    const block: string =
      source.match(
        /const menuMessageProps: Record<string, unknown> = \{[\s\S]*?\n {2}\};/,
      )?.[0] || "";

    expect(block).toContain("loadingMessage: ");
    expect(block).toContain("noOptionsMessage: ");
    expect(block).not.toMatch(/if \(props\.(noOptionsMessage|loadingMessage)\)/);
    expect(source).toContain("{...menuMessageProps}");
  });

  test("the default words are looked up in the reader's language", () => {
    expect(source).toContain("tx(DROPDOWN_LOADING_MESSAGE)");
    expect(source).toContain("tx(getDropdownNoOptionsMessage(inputValue))");
  });
});
