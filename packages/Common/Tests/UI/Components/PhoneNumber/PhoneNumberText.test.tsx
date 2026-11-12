import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import PhoneNumberText from "../../../../UI/Components/PhoneNumber/PhoneNumberText";
import PhoneNumberTextList from "../../../../UI/Components/PhoneNumber/PhoneNumberTextList";
import Phone from "../../../../Types/Phone";
import { ObjectType } from "../../../../Types/JSON";

/*
 * ISSUE #6605: THE TWILIO CONFIG TABLE'S NUMBERS READ 447700900123+ ON A
 * PERSIAN OR ARABIC PAGE.
 *
 * A run of digits after a "+" has no letter to say which way it reads, so
 * on a page laid out right to left it took the page's way and its "+" was
 * drawn after it. PhoneNumberText draws a number as an isolate that reads
 * left to right (bdi dir="ltr"); PhoneNumberTextList draws a list of them,
 * each so, separated the reader's way. A real browser draws a bdi
 * dir="ltr" holding "+447700900123" as +447700900123 on an rtl page, where
 * a plain span draws 447700900123+ (checked in headless Chrome while
 * fixing this; jsdom lays nothing out, so these tests read the markup that
 * decides it).
 */

const UK: string = "+447700900123";
const SG: string = "+6581234567";
const US: string = "+14155550100";

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "fa", "ar", "ja", "zh", "de"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      resources: { [code]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["fa", "ar"];

function renderIn(code: string, element: ReactElement): HTMLElement {
  if (RIGHT_TO_LEFT_LANGUAGES.includes(code)) {
    document.documentElement.setAttribute("dir", "rtl");
  }

  const { container } = render(
    <I18nextProvider i18n={languages[code] as i18n}>{element}</I18nextProvider>,
  );

  return container;
}

// Each isolate a container draws: "<its dir> <its text>".
function isolatesOf(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("bdi")).map(
    (isolate: HTMLElement): string => {
      return `${isolate.getAttribute("dir")} ${isolate.textContent}`;
    },
  );
}

describe("PhoneNumberText", () => {
  test.each(["en", "fa", "ar", "ja", "de"])(
    "on a %s page a number is one isolate that reads left to right, its + in front",
    (code: string) => {
      const container: HTMLElement = renderIn(
        code,
        <PhoneNumberText phoneNumber={UK} />,
      );

      expect(isolatesOf(container)).toEqual([`ltr ${UK}`]);
      // Nothing around it: it sits in the line where the page puts it.
      expect(container.childNodes).toHaveLength(1);
      expect(container.textContent).toBe(UK);
    },
  );

  test.each([
    ["written with spaces", "+44 7700 900123"],
    ["a national number with brackets", "(415) 555-0100"],
    ["masked", "+1 ••• ••• 4821"],
    ["with no plus", "07911123456"],
    ["in Persian digits", "+۹۸۹۱۲۳۴۵۶۷۸۹"],
  ])(
    "a number %s reads left to right on an Arabic page too",
    (_name: string, number: string) => {
      const container: HTMLElement = renderIn(
        "ar",
        <PhoneNumberText phoneNumber={number} />,
      );

      expect(isolatesOf(container)).toEqual([`ltr ${number}`]);
    },
  );

  test("a Phone is drawn as its number, and so is the JSON of one not read into its model", () => {
    const fromPhone: HTMLElement = renderIn(
      "fa",
      <PhoneNumberText phoneNumber={new Phone(US)} />,
    );

    expect(isolatesOf(fromPhone)).toEqual([`ltr ${US}`]);
    cleanup();

    const fromJson: HTMLElement = renderIn(
      "fa",
      <PhoneNumberText
        phoneNumber={{ _type: ObjectType.Phone, value: SG } as unknown as Phone}
      />,
    );

    expect(isolatesOf(fromJson)).toEqual([`ltr ${SG}`]);
    expect(fromJson.textContent).not.toContain("[object Object]");
  });

  test("the space a number was typed with around it is not drawn", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <PhoneNumberText phoneNumber={`  ${UK} `} />,
    );

    expect(isolatesOf(container)).toEqual([`ltr ${UK}`]);
  });

  test("it keeps the look, the tooltip and the test id it is given", () => {
    renderIn(
      "ar",
      <PhoneNumberText
        phoneNumber={UK}
        className="font-mono truncate"
        title="Primary number"
        dataTestId="the-number"
      />,
    );

    const number: HTMLElement = screen.getByTestId("the-number");

    expect(number.tagName).toBe("BDI");
    expect(number).toHaveAttribute("dir", "ltr");
    expect(number).toHaveClass("font-mono", "truncate");
    expect(number).toHaveAttribute("title", "Primary number");
    expect(number).toHaveTextContent(UK);
  });

  test("a name in a number's place reads the way its letters do", () => {
    // A Twilio number's friendly name, renamed by its owner.
    const persian: HTMLElement = renderIn(
      "en",
      <PhoneNumberText phoneNumber="خط پشتیبانی" />,
    );

    expect(isolatesOf(persian)).toEqual(["rtl خط پشتیبانی"]);
    cleanup();

    const english: HTMLElement = renderIn(
      "fa",
      <PhoneNumberText phoneNumber="Support line" />,
    );

    expect(isolatesOf(english)).toEqual(["ltr Support line"]);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty text", ""],
    ["spaces", "   "],
  ])(
    "no number (%s) draws nothing - no empty isolate",
    (_name: string, value: string | null | undefined) => {
      const container: HTMLElement = renderIn(
        "fa",
        <PhoneNumberText phoneNumber={value} dataTestId="the-number" />,
      );

      expect(container.innerHTML).toBe("");
      expect(screen.queryByTestId("the-number")).toBeNull();
    },
  );
});

describe("PhoneNumberTextList", () => {
  test("on an English page: the numbers separated by commas, as the list was typed", () => {
    const container: HTMLElement = renderIn(
      "en",
      <PhoneNumberTextList phoneNumbers={[SG, UK]} dataTestId="numbers" />,
    );

    expect(screen.getByTestId("numbers").textContent).toBe(`${SG}, ${UK}`);
    expect(isolatesOf(container)).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
  });

  test.each(["fa", "ar"])(
    "on a %s page: each number its own isolate, separated by the Arabic comma",
    (code: string) => {
      const container: HTMLElement = renderIn(
        code,
        <PhoneNumberTextList phoneNumbers={[SG, UK, US]} />,
      );

      expect(isolatesOf(container)).toEqual([
        `ltr ${SG}`,
        `ltr ${UK}`,
        `ltr ${US}`,
      ]);
      expect(container.textContent).toBe(`${SG}، ${UK}، ${US}`);

      /*
       * The separators are the page's line, outside every isolate: the
       * list reads from the right as its page does, no number turned
       * round inside it.
       */
      const list: HTMLElement = container.firstElementChild as HTMLElement;

      expect(list.tagName).toBe("SPAN");
      expect(list).not.toHaveAttribute("dir");
      expect(
        Array.from(list.childNodes)
          .filter((node: ChildNode): boolean => {
            return node.nodeType === Node.TEXT_NODE;
          })
          .map((node: ChildNode): string => {
            return node.textContent || "";
          }),
      ).toEqual(["، ", "، "]);
    },
  );

  test.each([
    ["ja", "、"],
    ["zh", "、"],
    ["de", ", "],
  ])(
    "in %s: the numbers separated as that language lists",
    (code: string, separator: string) => {
      const container: HTMLElement = renderIn(
        code,
        <PhoneNumberTextList phoneNumbers={[SG, UK]} />,
      );

      expect(container.textContent).toBe(`${SG}${separator}${UK}`);
      expect(isolatesOf(container)).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
    },
  );

  test("one number is that number, with no separator", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <PhoneNumberTextList phoneNumbers={[UK]} />,
    );

    expect(container.textContent).toBe(UK);
    expect(isolatesOf(container)).toEqual([`ltr ${UK}`]);
  });

  test("an empty entry is left out, and no separator is drawn for it", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <PhoneNumberTextList phoneNumbers={["", ` ${SG} `, "  ", UK, ""]} />,
    );

    expect(container.textContent).toBe(`${SG}، ${UK}`);
    expect(isolatesOf(container)).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
  });

  test("no numbers draws an empty list, with its look and test id", () => {
    renderIn(
      "fa",
      <PhoneNumberTextList
        phoneNumbers={[]}
        className="text-gray-900"
        dataTestId="numbers"
      />,
    );

    const list: HTMLElement = screen.getByTestId("numbers");

    expect(list).toBeEmptyDOMElement();
    expect(list).toHaveClass("text-gray-900");
  });
});
