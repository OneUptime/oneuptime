import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { createFilter } from "react-select";

/*
 * TYPING IN A DROPDOWN FINDS AN OPTION BY THE WORDS THE MENU SHOWS.
 *
 * An option's label is an English key that the Dropdown translates as it
 * draws it, but its search read only that key and the value. So once the
 * message queue form's "Other messaging system..." and the filter
 * operators were worded in every language (#7282, #7288), a German reader
 * who typed "Anderes" for the option the menu listed as "Anderes
 * Messaging-System..." - or "stimmt" for "stimmt überein" - was told there
 * were no options. Now the search reads the shown label too, and the
 * English still finds the option.
 *
 * react-i18next answers from a German dictionary, as the Dashboard's would.
 */

let dictionary: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return dictionary[key] ?? options?.defaultValue ?? key;
        },
        i18n: { language: "de", resolvedLanguage: "de" },
      };
    },
  };
});

import Dropdown, {
  createDropdownSearchFilter,
  DropdownOption,
  DropdownSearchFilter,
} from "../../../../UI/Components/Dropdown/Dropdown";

const GERMAN: Record<string, string> = {
  "Apache Kafka (kafka)": "Apache Kafka (kafka)",
  "Other messaging system...": "Anderes Messaging-System...",
  matches: "stimmt überein",
  "does not match": "stimmt nicht überein",
  "is any of": "ist eines von",
};

const QUEUE_SYSTEMS: Array<DropdownOption> = [
  { value: "kafka", label: "Apache Kafka (kafka)" },
  { value: "__other__", label: "Other messaging system..." },
];

const OPERATORS: Array<DropdownOption> = [
  { value: "wildcard", label: "matches" },
  { value: "notWildcard", label: "does not match" },
  { value: "anyOf", label: "is any of" },
  { value: "greaterThan", label: ">" },
];

afterEach(() => {
  cleanup();
  dictionary = {};
});

function typeSearch(text: string): void {
  act(() => {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  });
}

function listed(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function saysNoOptions(): boolean {
  return document.querySelector(".ou-select__menu-notice--no-options") !== null;
}

describe("a Dropdown in German, searched", () => {
  test("typing the shown words finds the option", () => {
    dictionary = GERMAN;
    render(<Dropdown onChange={() => {}} options={QUEUE_SYSTEMS} />);

    typeSearch("Anderes");

    expect(listed()).toEqual(["Anderes Messaging-System..."]);
    expect(saysNoOptions()).toBe(false);
  });

  test("the English the option is stored under still finds it", () => {
    dictionary = GERMAN;
    render(<Dropdown onChange={() => {}} options={QUEUE_SYSTEMS} />);

    typeSearch("other messaging");
    expect(listed()).toEqual(["Anderes Messaging-System..."]);

    typeSearch("kafka");
    expect(listed()).toEqual(["Apache Kafka (kafka)"]);
  });

  test("the shown words are searched as react-select searches: any case, accents ignored, trimmed", () => {
    dictionary = GERMAN;
    render(<Dropdown onChange={() => {}} options={OPERATORS} />);

    typeSearch("  STIMMT UBEREIN ");
    expect(listed()).toEqual(["stimmt überein"]);

    typeSearch("stimmt");
    expect(listed()).toEqual(["stimmt überein", "stimmt nicht überein"]);

    typeSearch("nicht");
    expect(listed()).toEqual(["stimmt nicht überein"]);

    typeSearch(">");
    expect(listed()).toEqual([">"]);
  });

  test("words no option shows still find nothing (control)", () => {
    dictionary = GERMAN;
    render(<Dropdown onChange={() => {}} options={QUEUE_SYSTEMS} />);

    typeSearch("Rabbit");

    expect(listed()).toEqual([]);
    expect(saysNoOptions()).toBe(true);
  });

  test("a name someone gave is searched only as written, never as a translation of it", () => {
    dictionary = { "Production (Europe)": "Produktion (Europa)" };
    render(
      <Dropdown
        onChange={() => {}}
        options={[
          {
            value: "prod",
            label: "Production (Europe)",
            isUserContent: true,
          },
        ]}
      />,
    );

    typeSearch("Produktion");
    expect(listed()).toEqual([]);

    typeSearch("Production");
    expect(listed()).toEqual(["Production (Europe)"]);
  });
});

/*
 * Every other Dropdown in the product depends on this: an option whose
 * shown label is its own label (English, an untranslated word, a name) is
 * searched exactly as react-select's filter over "label value aliases"
 * searched it before.
 */
describe("createDropdownSearchFilter", () => {
  interface Candidate {
    readonly label: string;
    readonly value: string;
    readonly data: DropdownOption;
  }

  function candidate(option: DropdownOption): Candidate {
    return { label: option.label, value: String(option.value), data: option };
  }

  const before: DropdownSearchFilter = createFilter<DropdownOption>({
    stringify: (option: Candidate): string => {
      return [option.label, option.value, ...(option.data.aliases || [])].join(
        " ",
      );
    },
  });

  const shownAsWritten: DropdownSearchFilter = createDropdownSearchFilter(
    (option: DropdownOption): string => {
      return option.label;
    },
  );

  const options: Array<DropdownOption> = [
    { value: "prod-eu", label: "Production (Europe)" },
    { value: 42, label: "Answer" },
    { value: "cafe-monitor", label: "Café Monitor" },
    { value: "a", label: "Option A" },
    {
      value: "Asia/Kolkata",
      label: "GMT+5:30 Asia/Kolkata",
      aliases: ["Asia/Calcutta"],
    },
  ];

  const inputs: Array<string> = [
    "",
    "prod",
    "PROD",
    "(europe)",
    "prod-eu",
    "42",
    "answer 42",
    "cafe",
    "CAFÉ MONITOR",
    "  option  ",
    "option a a",
    "a option",
    "calcutta",
    "kolkata asia",
    "zzz",
  ];

  test.each(inputs)(
    "an option shown as its own label answers %j as before",
    (input: string) => {
      for (const option of options) {
        expect({
          label: option.label,
          found: shownAsWritten(candidate(option), input),
        }).toEqual({
          label: option.label,
          found: before(candidate(option), input),
        });
      }
    },
  );

  test("a shown label that differs is searched as well (control: the old filter missed it)", () => {
    const option: DropdownOption = {
      value: "__other__",
      label: "Other messaging system...",
    };
    const shownInGerman: DropdownSearchFilter = createDropdownSearchFilter(
      (): string => {
        return "Anderes Messaging-System...";
      },
    );

    expect(before(candidate(option), "anderes")).toBe(false);
    expect(shownInGerman(candidate(option), "anderes")).toBe(true);
    expect(shownInGerman(candidate(option), "other")).toBe(true);
    expect(shownInGerman(candidate(option), "rabbit")).toBe(false);
  });

  test("an empty shown label adds nothing to what is searched", () => {
    const option: DropdownOption = { value: "x", label: "Label" };
    const shownEmpty: DropdownSearchFilter = createDropdownSearchFilter(
      (): string => {
        return "";
      },
    );

    for (const input of inputs) {
      expect(shownEmpty(candidate(option), input)).toBe(
        before(candidate(option), input),
      );
    }
  });
});
