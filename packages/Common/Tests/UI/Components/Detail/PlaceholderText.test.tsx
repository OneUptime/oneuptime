import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Detail from "../../../../UI/Components/Detail/Detail";
import PlaceholderText, {
  PLACEHOLDER_TEXT_CLASS_NAME,
} from "../../../../UI/Components/Detail/PlaceholderText";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * What a detail card shows for a value that is not set, in the field's own
 * words ("No logo uploaded."): quiet grey text where the value would be.
 *
 * It was a dashed, grey-filled chip - read as a button or a drop zone
 * rather than as "nothing here yet" - and before that it was one line
 * whatever its length (whitespace-nowrap), so a long one ran past its card
 * on a phone: the status page cards' "No Header HTML found. Please edit
 * this Status Page to add some." and the subscriber settings' two-sentence
 * timezone note among them. It wraps, inside whatever it sits in.
 *
 * jsdom lays nothing out, so what is checked is what the browser is told:
 * the classes, and where the text sits in a detail card.
 */

const LONG_PLACEHOLDER: string =
  "No subscriber timezones selected so far. Subscribers will receive notifications with times shown in GMT, EST, PST, IST, ACT timezones by default.";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
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

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: {
      de: {
        translation: {
          [LONG_PLACEHOLDER]: GERMAN_FILE[LONG_PLACEHOLDER] as string,
          "No logo uploaded.": GERMAN_FILE["No logo uploaded."] as string,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(/\s+/).filter((name: string): boolean => {
    return name.length > 0;
  });
}

describe("the placeholder text", () => {
  test("wraps, and breaks a word too long for its line", () => {
    render(<PlaceholderText text={LONG_PLACEHOLDER} />);

    const chip: HTMLElement = screen.getByText(LONG_PLACEHOLDER);
    const classes: Array<string> = classesOf(chip);

    expect(classes).toContain("whitespace-normal");
    expect(classes).toContain("break-words");
    expect(classes).not.toContain("whitespace-nowrap");
    expect(chip.outerHTML).not.toContain("nowrap");
  });

  test("is never wider than what it sits in, and may shrink as a flex item", () => {
    render(<PlaceholderText text={LONG_PLACEHOLDER} />);

    const classes: Array<string> = classesOf(
      screen.getByText(LONG_PLACEHOLDER),
    );

    // Bounded by its container, and allowed below its longest word in a flex row.
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("min-w-0");
    /*
     * An inline block, not an inline flex box: the text of a flex box is an
     * anonymous flex item that cannot shrink below its longest word.
     */
    expect(classes).toContain("inline-block");
    expect(classes).not.toContain("inline-flex");
  });

  test("is quiet grey text in the value's size - not a chip with a dashed border and a fill", () => {
    render(<PlaceholderText text="No logo uploaded." />);

    const classes: Array<string> = classesOf(
      screen.getByText("No logo uploaded."),
    );

    /*
     * On a detail value's own 24px line (leading-6; text-sm alone sets 20px),
     * top to top with it (align-top): the words sit level with a set value
     * beside them in the row. Centred on a line (align-middle) they hung a
     * pixel lower than the values beside them.
     */
    for (const look of ["align-top", "text-sm", "leading-6", "font-normal"]) {
      expect([look, classes.includes(look)]).toEqual([look, true]);
    }

    expect(classes).not.toContain("align-middle");

    // Grey enough to read as "not a value", dark enough to read (WCAG AA).
    expect(classes).toContain("text-gray-500");

    for (const chip of [
      "border",
      "border-dashed",
      "border-gray-300",
      "bg-gray-50",
      "rounded-md",
      "px-2",
      "py-0.5",
    ]) {
      expect([chip, classes.includes(chip)]).toEqual([chip, false]);
    }

    expect(
      classes.some((name: string): boolean => {
        return name.startsWith("bg-") || name.startsWith("border");
      }),
    ).toBe(false);
  });

  test("draws exactly the exported classes, so a test can hold any placeholder to them", () => {
    render(<PlaceholderText text="No logo uploaded." />);

    const chip: HTMLElement = screen.getByTestId("placeholder-text");

    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(chip).toHaveTextContent("No logo uploaded.");
  });

  test("shows a short placeholder as one piece of text", () => {
    render(<PlaceholderText text="No favicon uploaded." />);

    const chips: Array<HTMLElement> = screen.getAllByTestId("placeholder-text");

    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe("No favicon uploaded.");
    // Text only: nothing inside it but its words.
    expect(chips[0]!.children).toHaveLength(0);
  });

  test("reads in the reader's language, the whole sentence", () => {
    render(
      <I18nextProvider i18n={german}>
        <PlaceholderText text={LONG_PLACEHOLDER} />
      </I18nextProvider>,
    );

    const translated: string = GERMAN_FILE[LONG_PLACEHOLDER] as string;

    expect(translated).toBeTruthy();
    expect(translated).not.toBe(LONG_PLACEHOLDER);
    expect(screen.getByTestId("placeholder-text")).toHaveTextContent(
      translated,
    );
  });

  test("falls back to the English it was given where the reader's language has none", () => {
    render(
      <I18nextProvider i18n={german}>
        <PlaceholderText text="Nothing here is translated, on purpose." />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("placeholder-text")).toHaveTextContent(
      "Nothing here is translated, on purpose.",
    );
  });
});

describe("in a detail card", () => {
  interface Item {
    logo?: string | undefined;
    timezones?: string | undefined;
  }

  test("an unset value shows the wrapping text in its place, inside the value's row", () => {
    const { container } = render(
      <Detail<Item>
        id="placeholder-detail"
        item={{}}
        showDetailsInNumberOfColumns={1}
        fields={[
          {
            key: "logo",
            title: "Logo",
            fieldType: FieldType.Text,
            placeholder: "No logo uploaded.",
          },
          {
            key: "timezones",
            title: "Subscriber Timezones",
            fieldType: FieldType.Text,
            placeholder: LONG_PLACEHOLDER,
          },
        ]}
      />,
    );

    const chips: Array<HTMLElement> = screen.getAllByTestId("placeholder-text");

    expect(
      chips.map((chip: HTMLElement): string | null => {
        return chip.textContent;
      }),
    ).toEqual(["No logo uploaded.", LONG_PLACEHOLDER]);

    for (const chip of chips) {
      expect(chip.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
      // A detail value is a flex row: the text is its item, and can shrink.
      expect(chip.parentElement!.className.split(/\s+/)).toContain("flex");
    }

    expect(container.innerHTML).not.toContain("whitespace-nowrap");
  });

  test("a set value shows the value, and no placeholder", () => {
    render(
      <Detail<Item>
        id="placeholder-detail"
        item={{ logo: "logo.png" }}
        showDetailsInNumberOfColumns={1}
        fields={[
          {
            key: "logo",
            title: "Logo",
            fieldType: FieldType.Text,
            placeholder: "No logo uploaded.",
          },
        ]}
      />,
    );

    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.queryByTestId("placeholder-text")).toBeNull();
  });
});
