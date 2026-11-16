// UX rule: Docs/ux/README.md#folds
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
import React, { ReactElement, useState } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import CardSelect, {
  CardSelectCatalog,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { withNoBreakSpaces } from "../../../Types/NoBreakSpaces";

/*
 * A FOLDED LINE NEVER CUTS OFF THE CHOICE IT NAMES (#8380).
 *
 * Folded while the choice is one of the types it holds, Create Monitor's
 * More monitor types names that choice after its words and a dot: "More
 * monitor types · Selected: Kubernetes", so nothing in force is out of
 * sight. The type names are worded in every language (2351d870f14), and
 * German's "Ausgewählt: Benutzerdefinierter JavaScript-Code" is wider than a
 * 390px phone's line by itself. The browser suite's German phone test held
 * the choice to one line and went red; the issue asked which side was
 * wrong: the German name, or a layout that lets it wrap.
 *
 * The German is right, and so is the wrap. A fold never cuts off what it
 * holds (Docs/ux/README.md#folds), and an ellipsis with the full name in a
 * tooltip would hide it on the phone, where no pointer shows a tooltip. So
 * the line is built to keep the choice whole:
 *
 *   - the words and the dot are one unbreakable piece (whitespace-nowrap),
 *     and the choice is not in it;
 *   - the choice is one unit on the line (inline-block): beside the words
 *     when it fits, under them, whole, when it does not, never its start on
 *     the words' line and its rest under them;
 *   - never wider than its column (max-w-full), which can shrink (min-w-0)
 *     and breaks inside a word only when the word is longer than the line
 *     (break-words): a choice longer than a line by itself wraps between its
 *     words;
 *   - nothing on the way from the choice to More cuts it off: no truncate,
 *     ellipsis, line clamp, hidden overflow, nowrap or fixed height.
 *
 * jsdom lays nothing out, so this holds the classes that draw it; the
 * browser suite (packages/E2E/MonitorOverview/CreateMonitor.spec.ts, "More
 * monitor types folds the rest away again") measures the line as drawn on a
 * phone, in English, German and Persian, for every type More holds.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const SELECTED_KEY: string = "Selected: {{name}}";
const MORE_KEY: string = "More monitor types";
const LONG_TYPE: string = "Custom JavaScript Code";

// Classes that cut a line's words off, or keep them from wrapping.
const CUTTING_CLASS: RegExp =
  /^(?:[a-z-]+:)*(?:truncate|text-ellipsis|text-clip|overflow-(?:x-)?(?:hidden|clip)|line-clamp-\S+|whitespace-nowrap|whitespace-pre|text-nowrap|break-all|h-\S+|max-h-\S+|max-w-\[\S+\]|max-w-(?:xs|sm|md|lg|xl|\dxl))$/;

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const CATALOG: CardSelectCatalog = {
  commonOptionValues: ["Website"],
  moreOptionsText: MORE_KEY,
};

const OPTIONS: Array<CardSelectOptionGroup> = [
  {
    label: "Basic Monitoring",
    options: [
      {
        value: "Website",
        title: "Website",
        description: "Check a page loads and responds.",
        icon: IconProp.Globe,
      },
    ],
  },
  {
    label: "Advanced",
    options: [
      {
        value: LONG_TYPE,
        title: LONG_TYPE,
        description: "Run your own JavaScript code on a schedule.",
        icon: IconProp.Code,
      },
    ],
  },
];

const Picker: () => ReactElement = (): ReactElement => {
  const [value, setValue] = useState<string | undefined>(LONG_TYPE);

  return (
    <CardSelect
      options={OPTIONS}
      value={value}
      onChange={setValue}
      catalog={CATALOG}
    />
  );
};

// Change on a Custom JavaScript Code monitor, then More folded.
function foldAwayTheChoice(): {
  more: HTMLElement;
  title: HTMLElement;
  choice: HTMLElement;
} {
  render(<Picker />);
  fireEvent.click(screen.getByTestId("card-select-change"));
  fireEvent.click(screen.getByTestId("card-select-more"));

  const more: HTMLElement = screen.getByTestId("card-select-more");

  expect(more).toHaveAttribute("aria-expanded", "false");

  return {
    more,
    title: screen.getByTestId("card-select-more-title"),
    choice: screen.getByTestId("card-select-more-selection"),
  };
}

// The elements from the choice up to More itself: each could cut it off.
function choiceToMore(choice: HTMLElement, more: HTMLElement): Array<Element> {
  const chain: Array<Element> = [];
  let element: Element | null = choice;

  while (element) {
    chain.push(element);

    if (element === more) {
      return chain;
    }

    element = element.parentElement;
  }

  throw new Error("The choice is not inside More.");
}

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of DASHBOARD_LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("de");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("a folded line never cuts off the choice it names", () => {
  test("the class pattern flags what cuts a line off, and leaves what wraps it alone", () => {
    for (const cutting of [
      "truncate",
      "text-ellipsis",
      "overflow-hidden",
      "overflow-x-hidden",
      "overflow-clip",
      "line-clamp-1",
      "whitespace-nowrap",
      "text-nowrap",
      "break-all",
      "h-6",
      "max-h-6",
      "max-w-[12rem]",
      "max-w-xs",
      "sm:truncate",
      "md:max-w-sm",
    ]) {
      expect({ cutting, flagged: CUTTING_CLASS.test(cutting) }).toEqual({
        cutting,
        flagged: true,
      });
    }

    for (const wrapping of [
      "inline-block",
      "max-w-full",
      "min-w-0",
      "break-words",
      "font-medium",
      "text-gray-600",
      "leading-6",
      "inline-flex",
      "group-hover:underline",
    ]) {
      expect({ wrapping, flagged: CUTTING_CLASS.test(wrapping) }).toEqual({
        wrapping,
        flagged: false,
      });
    }
  });

  test("German: the whole name, on the line and in More's description", () => {
    const { more, title, choice } = foldAwayTheChoice();

    expect(title).toHaveTextContent(/^Weitere Monitortypen$/);
    expect(choice).toHaveTextContent(
      /^Ausgewählt: Benutzerdefinierter JavaScript-Code$/,
    );
    expect(more).toHaveAccessibleName("Weitere Monitortypen");
    expect(more).toHaveAccessibleDescription(
      "Ausgewählt: Benutzerdefinierter JavaScript-Code",
    );
    // Nothing is left for a tooltip to say: the line says it all.
    expect(choice).not.toHaveAttribute("title");
  });

  test("the choice is one unit on the line, never wider than its column", () => {
    const { choice } = foldAwayTheChoice();

    expect(choice).toHaveClass("inline-block", "max-w-full");
  });

  test("its column can shrink, and breaks a word only when it is longer than the line", () => {
    const { choice } = foldAwayTheChoice();
    const column: HTMLElement = choice.parentElement!;

    expect(column).toHaveClass("min-w-0", "break-words");
  });

  test("the words keep the dot on their line, and the choice is not part of that piece", () => {
    const { more, title, choice } = foldAwayTheChoice();
    const titleAndDot: HTMLElement = title.parentElement!;

    expect(titleAndDot).toHaveClass("whitespace-nowrap");
    expect(titleAndDot).toHaveTextContent(/^Weitere Monitortypen\s*·$/);
    expect(titleAndDot).not.toContainElement(choice);
    // A space between the piece and the choice: the line may break there.
    expect(titleAndDot.nextSibling?.textContent).toBe(" ");
    expect(titleAndDot.nextSibling?.nextSibling).toBe(choice);
    expect(choice.closest(".whitespace-nowrap")).toBeNull();
    expect(more).toContainElement(choice);
  });

  test("nothing from the choice up to More cuts it off", () => {
    const { more, choice } = foldAwayTheChoice();
    const chain: Array<Element> = choiceToMore(choice, more);

    // The choice, its column and More.
    expect(chain).toHaveLength(3);

    for (const element of chain) {
      const testId: string =
        element.getAttribute("data-testid") || element.tagName.toLowerCase();

      expect({
        element: testId,
        cutting: classesOf(element).filter((name: string): boolean => {
          return CUTTING_CLASS.test(name);
        }),
      }).toEqual({ element: testId, cutting: [] });
      expect((element as HTMLElement).style.overflow).toBe("");
      expect((element as HTMLElement).style.whiteSpace).toBe("");
      expect((element as HTMLElement).style.textOverflow).toBe("");
    }

    // More is as wide as the line at most, and grows to hold the choice.
    expect(more).toHaveClass("max-w-full", "items-start");
  });

  test("every language the Dashboard ships names the long type whole, its words as its locale gives them", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);
      const sentence: string = locale[SELECTED_KEY] || SELECTED_KEY;
      const name: string = locale[LONG_TYPE] || LONG_TYPE;

      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      const { more, choice } = foldAwayTheChoice();
      // As the page draws the words: French's colon kept with its word.
      const expected: string = withNoBreakSpaces(
        sentence,
        SELECTED_KEY,
        language,
      )
        .split("{{name}}")
        .join(withNoBreakSpaces(name, LONG_TYPE, language));

      expect({ language, line: choice.textContent }).toEqual({
        language,
        line: expected,
      });
      expect({
        language,
        inMore: more.textContent?.endsWith(expected),
      }).toEqual({ language, inMore: true });
      expect({
        language,
        classes: choice.className,
      }).toEqual({
        language,
        classes: expect.stringContaining("inline-block max-w-full"),
      });

      cleanup();
    }
  });
});
