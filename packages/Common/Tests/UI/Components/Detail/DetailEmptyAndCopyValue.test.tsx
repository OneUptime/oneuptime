import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EmptyValue, {
  EMPTY_VALUE_CLASS_NAME,
  EMPTY_VALUE_MARK,
  EMPTY_VALUE_TEST_ID,
} from "../../../../UI/Components/Detail/EmptyValue";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../../../../UI/Components/Detail/PlaceholderText";
import {
  getDetailCopyText,
  hasDetailValue,
} from "../../../../UI/Components/Detail/DetailValue";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A detail field with nothing in it, and what a copyable field copies
 * (EmptyValue, DetailValue).
 *
 * An empty field used to show its name over a blank line - unless the page
 * had written words for it, in a dashed chip that read as a button. It
 * shows those words as quiet text now, or a dash read out as "Not set".
 */

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
          "Not set": GERMAN_FILE["Not set"] as string,
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

describe("an empty value", () => {
  test("with the field's words, is those words as placeholder text", () => {
    render(<EmptyValue placeholder="No logo uploaded." />);

    const placeholder: HTMLElement = screen.getByTestId("placeholder-text");

    expect(placeholder).toHaveTextContent("No logo uploaded.");
    expect(placeholder.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(screen.queryByTestId(EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test("without them, is a quiet dash that a screen reader reads as 'Not set'", () => {
    render(<EmptyValue />);

    const empty: HTMLElement = screen.getByTestId(EMPTY_VALUE_TEST_ID);

    expect(empty.className).toBe(EMPTY_VALUE_CLASS_NAME);
    expect(EMPTY_VALUE_MARK).toBe("\u2014");
    expect(within(empty).getByText(EMPTY_VALUE_MARK)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
  });

  test("the words a screen reader hears are in the reader's language", () => {
    render(
      <I18nextProvider i18n={german}>
        <EmptyValue />
      </I18nextProvider>,
    );

    const translated: string = GERMAN_FILE["Not set"] as string;

    expect(translated).toBeTruthy();
    expect(translated).not.toBe("Not set");
    expect(
      within(screen.getByTestId(EMPTY_VALUE_TEST_ID)).getByText(translated),
    ).toHaveClass("sr-only");
  });

  test("an empty placeholder is no placeholder: the dash", () => {
    render(<EmptyValue placeholder="" />);

    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("placeholder-text")).toBeNull();
  });
});

describe("whether there is a value", () => {
  test.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["an empty string", "", false],
    ["false", false, false],
    ["zero", 0, true],
    ["a word", "eu-west-1", true],
    ["a space", " ", true],
    ["true", true, true],
    ["an empty list", [], true],
    ["an element", <span key="value">x</span>, true],
  ])("%s: %s", (_name: string, value: unknown, expected: boolean) => {
    expect(hasDetailValue(value)).toBe(expected);
  });
});

describe("what the copy button copies", () => {
  test("the text drawn", () => {
    expect(getDetailCopyText("ouk_abc", undefined)).toBe("ouk_abc");
  });

  test("a number drawn", () => {
    expect(getDetailCopyText(0, undefined)).toBe("0");
    expect(getDetailCopyText(42, undefined)).toBe("42");
  });

  test("the record's own value under an element - never '[object Object]'", () => {
    const element: React.ReactElement = <a href="/runbook">Runbook</a>;

    expect(getDetailCopyText(element, "https://runbook.example")).toBe(
      "https://runbook.example",
    );
    expect(getDetailCopyText(element, 7)).toBe("7");
    expect(
      getDetailCopyText(element, new Email("test@oneuptime.com")),
    ).toBe("test@oneuptime.com");
    expect(getDetailCopyText(element, new Name("Test User"))).toBe(
      "Test User",
    );
    expect(
      getDetailCopyText(
        element,
        new ObjectID("10000000-0000-4000-8000-000000000001"),
      ),
    ).toBe("10000000-0000-4000-8000-000000000001");
  });

  test("nothing to copy means no button", () => {
    const element: React.ReactElement = <span>Nothing</span>;

    expect(getDetailCopyText(element, undefined)).toBeUndefined();
    expect(getDetailCopyText(element, null)).toBeUndefined();
    expect(getDetailCopyText(element, "")).toBeUndefined();
    expect(getDetailCopyText(element, { name: "an object" })).toBeUndefined();
    expect(getDetailCopyText("", undefined)).toBeUndefined();
    expect(getDetailCopyText(Number.NaN, undefined)).toBeUndefined();
  });
});
