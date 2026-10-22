import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * "Archived", beside a value a record still has but nobody can pick again
 * (Common/Utils/ArchivableValues), and the quiet line a dialog shows while
 * it is still asking the server something.
 *
 * ArchivedTag is one look wherever an archived value is drawn - a picker's
 * value, a menu option, a multi-select chip, a role card - written in
 * sentence case like the settings tables' "Built-in" tag, in the reader's
 * language, and coloured with classes the dark theme re-colours.
 *
 * The translation hook answers in German here, so every test also proves
 * the words are looked up rather than written in.
 */

const mockGerman: Record<string, string> = {
  Archived: "Archiviert",
  "Checking what still uses it…": "Es wird geprüft, was es noch verwendet…",
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value ? mockGerman[value] ?? value : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ArchivedTag, {
  ARCHIVED_TAG_CLASS_NAME,
  ARCHIVED_TAG_COMPACT_CLASS_NAME,
  ARCHIVED_TAG_TEST_ID,
} from "../../../UI/Components/ArchivedTag/ArchivedTag";
import { ARCHIVED_VALUE_TAG } from "../../../UI/Components/ArchivedTag/ArchivedTagCopy";
import InlineLoadingLine from "../../../UI/Components/Loader/InlineLoadingLine";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";

afterEach(() => {
  cleanup();
});

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const WHITESPACE: RegExp = /\s+/;
const SELECTOR_SEPARATORS: RegExp = /[\s,():]+/;
// Sizes and layout, not colours.
const TEXT_SIZE_CLASS: RegExp = /^text-(xs|sm|base|lg|xl|\[)/;
const RING_LAYOUT_CLASS: RegExp = /^ring-(inset|1|2|offset)/;
const ONLY_ARCHIVIERT: RegExp = /^Archiviert$/;

const THEME_CSS: string = fs
  .readFileSync(
    path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
    "utf8",
  )
  .replace(BLOCK_COMMENT, " ");

/*
 * A colour class the dark theme re-colours: Theme.css names it in a rule
 * under html.dark (".bg-gray-50" in an :is() list, or on its own).
 */
const isRecolouredInDark: (cssClass: string) => boolean = (
  cssClass: string,
): boolean => {
  const name: string = `.${cssClass}`;

  for (const rule of THEME_CSS.split("}")) {
    const selector: string = rule.split("{")[0] || "";

    if (!selector.includes("html.dark")) {
      continue;
    }

    for (const part of selector.split(SELECTOR_SEPARATORS)) {
      if (part === name) {
        return true;
      }
    }
  }

  return false;
};

const COLOUR_PREFIXES: Array<string> = ["bg-", "text-", "ring-", "border-"];

const colourClassesOf: (classes: string) => Array<string> = (
  classes: string,
): Array<string> => {
  return classes.split(WHITESPACE).filter((cssClass: string): boolean => {
    return (
      COLOUR_PREFIXES.some((prefix: string): boolean => {
        return cssClass.startsWith(prefix);
      }) &&
      !TEXT_SIZE_CLASS.test(cssClass) &&
      !RING_LAYOUT_CLASS.test(cssClass)
    );
  });
};

describe("ArchivedTag", () => {
  test("says Archived, in the reader's language", () => {
    expect(ARCHIVED_VALUE_TAG).toBe("Archived");

    render(<ArchivedTag />);

    const tag: HTMLElement = screen.getByTestId(ARCHIVED_TAG_TEST_ID);

    expect(tag).toHaveTextContent(ONLY_ARCHIVIERT);
  });

  test("is an inline span, so it sits inside a picker's label or a chip", () => {
    render(<ArchivedTag dataTestId="role-tag" />);

    const tag: HTMLElement = screen.getByTestId("role-tag");

    expect(tag.tagName).toBe("SPAN");
    expect(tag.querySelector("div")).toBeNull();
  });

  test("written in sentence case like Built-in, never shouted in capitals", () => {
    for (const classes of [
      ARCHIVED_TAG_CLASS_NAME,
      ARCHIVED_TAG_COMPACT_CLASS_NAME,
    ]) {
      expect(classes.split(WHITESPACE)).not.toContain("uppercase");
      // One line, never squeezed by the name beside it.
      expect(classes.split(WHITESPACE)).toEqual(
        expect.arrayContaining(["whitespace-nowrap", "flex-none"]),
      );
    }
  });

  test("a size smaller inside a multi-select's chip", () => {
    render(
      <>
        <ArchivedTag dataTestId="regular" />
        <ArchivedTag dataTestId="compact" isCompact={true} />
      </>,
    );

    expect(screen.getByTestId("regular").className).toBe(
      ARCHIVED_TAG_CLASS_NAME,
    );
    expect(screen.getByTestId("compact").className).toBe(
      ARCHIVED_TAG_COMPACT_CLASS_NAME,
    );
    expect(ARCHIVED_TAG_CLASS_NAME).toContain("text-xs");
    expect(ARCHIVED_TAG_COMPACT_CLASS_NAME).toContain("text-[11px]");
  });

  test("every colour it uses is re-coloured by the dark theme", () => {
    const colours: Array<string> = colourClassesOf(
      `${ARCHIVED_TAG_CLASS_NAME} ${ARCHIVED_TAG_COMPACT_CLASS_NAME}`,
    );

    expect(colours).toEqual(
      expect.arrayContaining(["bg-gray-50", "text-gray-600", "ring-gray-200"]),
    );

    for (const colour of colours) {
      expect({ colour, dark: isRecolouredInDark(colour) }).toEqual({
        colour,
        dark: true,
      });
    }
  });
});

describe("InlineLoadingLine", () => {
  test("a status a screen reader hears once, in the reader's language", () => {
    render(
      <InlineLoadingLine
        text="Checking what still uses it…"
        dataTestId="checking"
      />,
    );

    const line: HTMLElement = screen.getByTestId("checking");

    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveTextContent("Es wird geprüft, was es noch verwendet…");
  });

  test("a small spinner beside the words, still for anyone who asks for less motion", () => {
    render(<InlineLoadingLine text="Loading" />);

    const line: HTMLElement = screen.getByTestId("inline-loading-line");
    const spinner: SVGElement | null = line.querySelector("svg");

    expect(spinner).not.toBeNull();

    const spinnerClasses: string =
      spinner!.getAttribute("class") ||
      (spinner!.parentElement as HTMLElement).className;

    expect(spinnerClasses).toContain("animate-spin");
    expect(spinnerClasses).toContain("motion-reduce:animate-none");
  });

  test("takes the spacing its place asks for", () => {
    render(<InlineLoadingLine text="Loading" className="mt-3" />);

    expect(screen.getByTestId("inline-loading-line")).toHaveClass(
      "mt-3",
      "flex",
    );
  });

  test("its colours are re-coloured by the dark theme", () => {
    render(<InlineLoadingLine text="Loading" />);

    for (const colour of colourClassesOf(
      screen.getByTestId("inline-loading-line").className,
    )) {
      expect({ colour, dark: isRecolouredInDark(colour) }).toEqual({
        colour,
        dark: true,
      });
    }
  });
});

/*
 * The react-select Dropdown (monitor criteria, workflow settings): a record
 * that keeps an archived value shows it with the tag, and the menu offers it
 * marked and disabled - the tag, not a second line saying the same.
 */
describe("Dropdown draws an archived value with the tag", () => {
  const values: Array<{ _id: string; name: string; isArchived: boolean }> = [
    { _id: "1", name: "Critical", isArchived: false },
    { _id: "2", name: "[DONOTUSE] Very critical", isArchived: true },
  ];

  const options: Array<DropdownOption> = ArchivedValuePicker.getPickerOptions({
    values: values,
    options: values.map((value: { _id: string; name: string }) => {
      return { value: value._id, label: value.name };
    }),
    keptIds: ["2"],
  });

  test("the option is marked archived and can't be picked, with no description repeating it", () => {
    const archived: DropdownOption = options.find(
      (option: DropdownOption): boolean => {
        return option.value === "2";
      },
    )!;

    expect(archived.isArchived).toBe(true);
    expect(archived.isDisabled).toBe(true);
    expect(archived.description).toBeUndefined();
  });

  test("a kept value shows the tag beside its name", () => {
    render(
      <Dropdown
        options={options}
        value={options[1]}
        onChange={() => {
          // not changed here
        }}
      />,
    );

    const tag: HTMLElement = screen.getByTestId("dropdown-archived-tag");

    expect(tag).toHaveTextContent("Archiviert");
    expect(tag.className).toBe(ARCHIVED_TAG_CLASS_NAME);
    expect(screen.getByText("[DONOTUSE] Very critical")).toBeInTheDocument();
  });

  test("the menu shows the archived option marked, and the live one without", async () => {
    render(
      <Dropdown
        options={options}
        onChange={() => {
          // not changed here
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    await screen.findByText("[DONOTUSE] Very critical");

    const tags: Array<HTMLElement> = screen.getAllByTestId(
      "dropdown-archived-tag",
    );

    expect(tags).toHaveLength(1);

    const archivedOption: HTMLElement = screen
      .getByText("[DONOTUSE] Very critical")
      .closest(".ou-select__option") as HTMLElement;

    expect(archivedOption).toContainElement(tags[0]!);
    expect(archivedOption).toHaveAttribute("aria-disabled", "true");

    const liveOption: HTMLElement = screen
      .getByText("Critical")
      .closest(".ou-select__option") as HTMLElement;

    expect(
      liveOption.querySelector('[data-testid="dropdown-archived-tag"]'),
    ).toBeNull();
  });

  test("a multi-select's chip takes the smaller tag", () => {
    render(
      <Dropdown
        options={options}
        isMultiSelect={true}
        value={[options[0]!, options[1]!]}
        onChange={() => {
          // not changed here
        }}
      />,
    );

    const tag: HTMLElement = screen.getByTestId("dropdown-archived-tag");

    expect(tag.className).toBe(ARCHIVED_TAG_COMPACT_CLASS_NAME);
  });
});
