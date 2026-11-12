import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Detail/EmptyValue";
import Phone from "../../../../Types/Phone";
import { ObjectType } from "../../../../Types/JSON";

/*
 * ISSUE #6605: A DETAIL CARD'S PHONE NUMBER READ 447700900123+ ON A
 * PERSIAN OR ARABIC PAGE.
 *
 * A field of FieldType.Phone - an incoming call log's numbers, the
 * Admin Dashboard's Twilio SMS and secondary numbers - printed the number
 * as text, and on a page read right to left the "+" went after its digits.
 * The field now draws it as an isolate that reads left to right
 * (PhoneNumberText), and a list of them typed as one value is each of its
 * numbers so, separated the reader's way (PhoneNumberTextList). What a copy
 * button copies is the number as it is stored: no invisible mark goes to
 * the clipboard.
 */

const UK: string = "+447700900123";
const SG: string = "+6581234567";
const US: string = "+14155550100";

interface Item {
  phone?: Phone | string | undefined;
}

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "fa", "ar", "ja"]) {
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

const phoneField: Field<Item> = {
  key: "phone",
  title: "From Number",
  fieldType: FieldType.Phone,
  placeholder: "No number",
};

function renderDetail(
  code: string,
  item: Item,
  field: Field<Item> = phoneField,
): HTMLElement {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  return render(
    <I18nextProvider i18n={languages[code] as i18n}>
      <Detail<Item>
        item={item}
        fields={[field]}
        showDetailsInNumberOfColumns={1}
      />
    </I18nextProvider>,
  ).container;
}

function isolatesOf(root: HTMLElement): Array<string> {
  return Array.from(root.querySelectorAll("bdi")).map(
    (element: Element): string => {
      return `${element.getAttribute("dir")} ${element.textContent}`;
    },
  );
}

/*
 * Copy clicks land here: what the clipboard was given, in order.
 */
function watchClipboard(): Array<string> {
  const copied: Array<string> = [];

  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (text: string): Promise<void> => {
        copied.push(text);
        return Promise.resolve();
      },
    },
    configurable: true,
  });

  return copied;
}

describe.each(["fa", "ar"])("a phone field on a %s page", (code: string) => {
  test("its number is an isolate that reads left to right: +447700900123", () => {
    const container: HTMLElement = renderDetail(code, {
      phone: new Phone(UK),
    });

    expect(isolatesOf(container)).toEqual([`ltr ${UK}`]);
    expect(container).toHaveTextContent("From Number");
    expect(container).toHaveTextContent(UK);
  });

  test("a number stored as text, or as the JSON of a Phone, is drawn the same way", () => {
    expect(isolatesOf(renderDetail(code, { phone: US }))).toEqual([
      `ltr ${US}`,
    ]);
    cleanup();

    const fromJson: HTMLElement = renderDetail(code, {
      phone: { _type: ObjectType.Phone, value: SG } as unknown as Phone,
    });

    expect(isolatesOf(fromJson)).toEqual([`ltr ${SG}`]);
    expect(fromJson).not.toHaveTextContent("[object Object]");
  });

  test("a list typed as one value: each number its own isolate, separated by the Arabic comma", () => {
    const container: HTMLElement = renderDetail(code, {
      phone: `${SG}, ${UK}; ${US}`,
    });
    const list: HTMLElement = within(container).getByTestId(
      "detail-phone-number-list",
    );

    expect(isolatesOf(list)).toEqual([`ltr ${SG}`, `ltr ${UK}`, `ltr ${US}`]);
    expect(list.textContent).toBe(`${SG}، ${UK}، ${US}`);
  });

  test("a copyable number copies the number as stored, with no invisible mark", async () => {
    const copied: Array<string> = watchClipboard();
    const container: HTMLElement = renderDetail(
      code,
      { phone: new Phone(UK) },
      { ...phoneField, opts: { isCopyable: true } },
    );

    fireEvent.click(
      within(within(container).getByTestId("detail-value-copy")).getByRole(
        "button",
      ),
    );

    await waitFor(() => {
      expect(copied).toEqual([UK]);
    });
    // A number pasted into a phone field must still be a phone number.
    expect(() => {
      return new Phone(copied[0]!);
    }).not.toThrow();
  });

  test("a copyable list copies the list as it was typed", async () => {
    const copied: Array<string> = watchClipboard();
    const container: HTMLElement = renderDetail(
      code,
      { phone: `${SG}, ${UK}` },
      { ...phoneField, opts: { isCopyable: true } },
    );

    fireEvent.click(
      within(within(container).getByTestId("detail-value-copy")).getByRole(
        "button",
      ),
    );

    await waitFor(() => {
      expect(copied).toEqual([`${SG}, ${UK}`]);
    });
  });

  test.each([
    ["no value", undefined],
    ["an empty text", ""],
    ["a list of nothing", " , "],
  ])(
    "%s is the field's placeholder, as every empty field is",
    (_name: string, phone: string | undefined) => {
      const container: HTMLElement = renderDetail(code, { phone });

      expect(container.querySelector("bdi")).toBeNull();
      expect(
        within(container).queryByTestId("detail-phone-number-list"),
      ).toBeNull();
      expect(
        within(container).getByTestId("placeholder-text"),
      ).toHaveTextContent("No number");
    },
  );

  test("with no placeholder, no number is the dash every empty field draws", () => {
    const container: HTMLElement = renderDetail(
      code,
      { phone: "" },
      { key: "phone", title: "From Number", fieldType: FieldType.Phone },
    );

    expect(container.querySelector("bdi")).toBeNull();
    expect(within(container).getByTestId(EMPTY_VALUE_TEST_ID)).toBeVisible();
  });
});

describe("a phone field on a page read left to right", () => {
  test("an English page draws the number in its isolate too, separated by commas in a list", () => {
    expect(isolatesOf(renderDetail("en", { phone: new Phone(UK) }))).toEqual([
      `ltr ${UK}`,
    ]);
    cleanup();

    const list: HTMLElement = within(
      renderDetail("en", { phone: `${SG},${UK}` }),
    ).getByTestId("detail-phone-number-list");

    expect(list.textContent).toBe(`${SG}, ${UK}`);
    expect(isolatesOf(list)).toEqual([`ltr ${SG}`, `ltr ${UK}`]);
  });

  test("a Japanese page separates a list with the ideographic comma", () => {
    const list: HTMLElement = within(
      renderDetail("ja", { phone: `${SG}\n${UK}` }),
    ).getByTestId("detail-phone-number-list");

    expect(list.textContent).toBe(`${SG}、${UK}`);
  });

  test("a field that draws its own element is left to draw it", () => {
    const container: HTMLElement = renderDetail(
      "fa",
      { phone: new Phone(UK) },
      {
        ...phoneField,
        getElement: (): React.ReactElement => {
          return <span data-testid="own-element">Primary</span>;
        },
      },
    );

    expect(within(container).getByTestId("own-element")).toBeVisible();
    expect(container.querySelector("bdi")).toBeNull();
  });
});
