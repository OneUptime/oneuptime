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
 * The dashed chip a detail card shows for a value that is not set ("No logo
 * uploaded."). It used to be one line whatever its length
 * (whitespace-nowrap), so a long one ran past its card on a phone - the
 * status page cards' "No Header HTML found. Please edit this Status Page to
 * add some." and the subscriber settings' two-sentence timezone note among
 * them. It wraps now, inside whatever it sits in, and still looks the same.
 *
 * jsdom lays nothing out, so what is checked is what the browser is told:
 * the classes, and where the chip sits in a detail card.
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

describe("the placeholder chip", () => {
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

  test("keeps the chip's look: dashed grey border, rounded, light fill, small grey text", () => {
    render(<PlaceholderText text="No logo uploaded." />);

    const classes: Array<string> = classesOf(
      screen.getByText("No logo uploaded."),
    );

    for (const look of [
      "rounded-md",
      "border",
      "border-dashed",
      "border-gray-300",
      "bg-gray-50",
      "px-2",
      "py-0.5",
      "align-middle",
      "text-sm",
      "font-normal",
      "text-gray-500",
      "select-none",
    ]) {
      expect([look, classes.includes(look)]).toEqual([look, true]);
    }
  });

  test("draws exactly the exported classes, so a test can hold any chip to them", () => {
    render(<PlaceholderText text="No logo uploaded." />);

    const chip: HTMLElement = screen.getByTestId("placeholder-text");

    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(chip).toHaveTextContent("No logo uploaded.");
  });

  test("shows a short placeholder as it always did, as one chip with its text", () => {
    render(<PlaceholderText text="No favicon uploaded." />);

    const chips: Array<HTMLElement> = screen.getAllByTestId("placeholder-text");

    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe("No favicon uploaded.");
    // Text only: nothing inside the chip but its words.
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

  test("an unset value shows the wrapping chip in its place, inside the value's row", () => {
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
      // A detail value is a flex row: the chip is its item, and can shrink.
      expect(chip.parentElement!.className.split(/\s+/)).toContain("flex");
    }

    expect(container.innerHTML).not.toContain("whitespace-nowrap");
  });

  test("a set value shows the value, and no chip", () => {
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
