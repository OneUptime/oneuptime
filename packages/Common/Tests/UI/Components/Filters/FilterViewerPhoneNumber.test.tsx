import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import FilterViewer from "../../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Search from "../../../../Types/BaseDatabase/Search";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import GenericObject from "../../../../Types/GenericObject";

/*
 * ISSUE #6605: A LIST FILTERED BY A PHONE NUMBER SAID "From Number contains
 * 4477+" ON A PERSIAN OR ARABIC PAGE.
 *
 * The SMS, call and WhatsApp logs filter by a number (FieldType.Phone),
 * and the chip over the filtered list printed the number in the page's
 * sentence, where on a page read right to left its "+" went to the end.
 * The chip now draws the number as an isolate that reads left to right
 * (PhoneNumberText); a text filter's value is drawn as before.
 */

type Row = GenericObject & {
  fromNumber?: string;
  name?: string;
};

const FILTERS: Array<Filter<Row>> = [
  { key: "fromNumber", title: "From Number", type: FieldType.Phone },
  { key: "name", title: "Name", type: FieldType.Text },
] as unknown as Array<Filter<Row>>;

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "fa", "ar"]) {
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

function renderFilters(code: string, filterData: FilterData<Row>): void {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={languages[code] as i18n}>
      <FilterViewer<Row>
        id="sms-logs"
        filters={FILTERS}
        filterData={filterData}
        showFilterModal={false}
        pluralLabel="SMS Logs"
      />
    </I18nextProvider>,
  );
}

// The chip a filter's title is in.
function chipOf(title: string): HTMLElement {
  const chip: HTMLElement | null = screen
    .getByText(title)
    .closest(".rounded-full");

  if (!chip) {
    throw new Error(`No chip for ${title}`);
  }

  return chip as HTMLElement;
}

// The isolates that read left to right in an element: the numbers.
function leftToRightIsolatesOf(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll('bdi[dir="ltr"]')).map(
    (isolate: Element): string => {
      return isolate.textContent || "";
    },
  );
}

describe.each(["fa", "ar"])(
  "a phone number filter's chip on a %s page",
  (code: string) => {
    test.each([
      ["contains", new Search("+4477"), "+4477"],
      ["equals", new EqualTo("+447700900123"), "+447700900123"],
      ["starts with", new StartsWith("+44"), "+44"],
      ["does not equal", new NotEqual("+14155550100"), "+14155550100"],
      ["is (a number on its own)", "+447700900123", "+447700900123"],
    ])(
      "%s: the number is an isolate that reads left to right",
      (_operator: string, value: unknown, number: string) => {
        renderFilters(code, { fromNumber: value } as FilterData<Row>);

        const chip: HTMLElement = chipOf("From Number");

        expect(leftToRightIsolatesOf(chip)).toEqual([number]);
        expect(chip).toHaveTextContent(number);
      },
    );

    test("is empty: no number, so nothing set apart", () => {
      renderFilters(code, { fromNumber: new IsNull() } as FilterData<Row>);

      expect(leftToRightIsolatesOf(chipOf("From Number"))).toEqual([]);
    });

    test("a text filter's value is drawn as it always was", () => {
      renderFilters(code, {
        fromNumber: new Search("+4477"),
        name: new Search("+4477"),
      } as FilterData<Row>);

      expect(leftToRightIsolatesOf(chipOf("From Number"))).toEqual(["+4477"]);
      expect(leftToRightIsolatesOf(chipOf("Name"))).toEqual([]);
      expect(chipOf("Name")).toHaveTextContent("+4477");
    });
  },
);

describe("a phone number filter's chip on an English page", () => {
  test("says what it always said, the number in its isolate", () => {
    renderFilters("en", {
      fromNumber: new Search("+4477"),
    } as FilterData<Row>);

    const chip: HTMLElement = chipOf("From Number");

    expect(chip.textContent).toBe("From Number contains +4477");
    expect(leftToRightIsolatesOf(chip)).toEqual(["+4477"]);
  });
});
