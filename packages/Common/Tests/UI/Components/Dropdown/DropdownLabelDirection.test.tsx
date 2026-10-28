import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * WHICH WAY A DROPDOWN'S OPTION READS, picked in its box and listed in its
 * menu (DropdownLabelDirection).
 *
 * "Dropdowns whose translated label starts with a Latin word lay out left
 * to right in Persian" (#5252): a picked label read its own direction from
 * its first letter (dir="auto"), so "CSS سفارشی" (Custom CSS) and two
 * thousand more of the Persian Dashboard's words came out left to right on
 * a right-to-left page, their words out of order. Only the Runner picker
 * had opted out (isInPageDirection). Now the Dropdown knows its own words:
 *
 *   - a label it translated reads the page's way - no `dir` of its own;
 *   - a label made of translated parts says so (isInPageDirection);
 *   - anything else - a name someone gave, an English label no language
 *     has words for - reads the way most of its letters do, the rule every
 *     value shown on a page follows (#5312): an English name keeps its start
 *     in view on a Persian page, and a Persian name that starts with an
 *     English word reads right to left;
 *   - a label with no letter follows the page.
 *
 * react-i18next answers from a Persian dictionary, as the Dashboard's would.
 */

let dictionary: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return dictionary[key] ?? options?.defaultValue ?? key;
        },
        i18n: { language: "fa", resolvedLanguage: "fa" },
      };
    },
  };
});

import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import { getDropdownLabelDirection } from "../../../../UI/Components/Dropdown/DropdownLabelDirection";

// "CSS سفارشی" - Custom CSS, as the Persian Dashboard draws it.
const CUSTOM_CSS_FA: string = "CSS \u{633}\u{641}\u{627}\u{631}\u{634}\u{6CC}";

/*
 * "Kubernetes کلاستر" - a translation whose Latin word has more letters than
 * its Persian one: by its letters it would read left to right, but it is the
 * product's own words in the reader's language, so it reads the page's way.
 */
const KUBERNETES_CLUSTER_FA: string =
  "Kubernetes \u{6A9}\u{644}\u{627}\u{633}\u{62A}\u{631}";

// "API پرداخت از کار افتاده" - a Persian monitor name that starts in English.
const PERSIAN_NAME_STARTING_IN_ENGLISH: string =
  "API \u{67E}\u{631}\u{62F}\u{627}\u{62E}\u{62A} \u{627}\u{632} \u{6A9}\u{627}\u{631} \u{627}\u{641}\u{62A}\u{627}\u{62F}\u{647}";

const ENGLISH_NAME: string = "Checkout API (EU).";

afterEach(() => {
  cleanup();
  dictionary = {};
});

describe("getDropdownLabelDirection", () => {
  test("a label the Dashboard translated reads the page's way, whatever letter it starts with", () => {
    for (const shownText of [CUSTOM_CSS_FA, KUBERNETES_CLUSTER_FA]) {
      expect(
        getDropdownLabelDirection({
          label: "Custom CSS",
          shownText: shownText,
        }),
      ).toBeUndefined();
    }
  });

  test("words put together from translated parts read the page's way when they say so", () => {
    expect(
      getDropdownLabelDirection({
        label: "Runner \u{633}\u{631}\u{627}\u{633}\u{631}\u{6CC}",
        shownText: "Runner \u{633}\u{631}\u{627}\u{633}\u{631}\u{6CC}",
        isUserContent: true,
        isInPageDirection: true,
      }),
    ).toBeUndefined();
  });

  test("a name reads the way most of its letters do", () => {
    expect(
      getDropdownLabelDirection({
        label: ENGLISH_NAME,
        shownText: ENGLISH_NAME,
        isUserContent: true,
      }),
    ).toBe("ltr");
    expect(
      getDropdownLabelDirection({
        label: PERSIAN_NAME_STARTING_IN_ENGLISH,
        shownText: PERSIAN_NAME_STARTING_IN_ENGLISH,
        isUserContent: true,
      }),
    ).toBe("rtl");
  });

  test("a name is never taken for translated words, even one spelled like a label", () => {
    // A person named their record as a label reads; it is drawn as written.
    expect(
      getDropdownLabelDirection({
        label: "Kubernetes Cluster",
        shownText: "Kubernetes Cluster",
        isUserContent: true,
      }),
    ).toBe("ltr");
  });

  test("an English label no language has words for yet reads left to right", () => {
    expect(
      getDropdownLabelDirection({
        label: "Export JSON",
        shownText: "Export JSON",
      }),
    ).toBe("ltr");
  });

  test("a label with no letter at all follows the page", () => {
    for (const text of ["8080", "", "· — 42 %"]) {
      expect(
        getDropdownLabelDirection({
          label: text,
          shownText: text,
          isUserContent: true,
        }),
      ).toBeUndefined();
    }
  });
});

describe("a Dropdown on a Persian page", () => {
  function box(): HTMLElement {
    return screen.getByRole("combobox");
  }

  async function openMenu(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.keyDown(box(), { key: "ArrowDown", code: "ArrowDown" });
    });

    return document.querySelector<HTMLElement>(".ou-select__menu")!;
  }

  function optionLabel(menu: HTMLElement, text: string): HTMLElement {
    const label: HTMLElement | undefined = within(menu)
      .getAllByTestId("dropdown-option-label")
      .find((element: HTMLElement): boolean => {
        return element.textContent === text;
      });

    expect(label).toBeDefined();

    return label!;
  }

  test("a translated label, picked, has no direction of its own: it reads the page's way", () => {
    dictionary = { "Custom CSS": CUSTOM_CSS_FA };
    const option: DropdownOption = { value: "css", label: "Custom CSS" };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    const label: HTMLElement = screen.getByTestId("dropdown-value-label");

    expect(label).toHaveTextContent(CUSTOM_CSS_FA);
    expect(label).not.toHaveAttribute("dir");
    // Still cut short with an ellipsis when it does not fit.
    expect(label).toHaveClass("truncate");
  });

  test("a translated label whose Latin word is longer still reads the page's way", () => {
    dictionary = { "Kubernetes Cluster": KUBERNETES_CLUSTER_FA };
    const option: DropdownOption = {
      value: "k8s",
      label: "Kubernetes Cluster",
    };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    expect(screen.getByTestId("dropdown-value-label")).not.toHaveAttribute(
      "dir",
    );
  });

  test("in the open menu, each option reads the same way it does picked", async () => {
    dictionary = { "Custom CSS": CUSTOM_CSS_FA };
    const options: Array<DropdownOption> = [
      { value: "css", label: "Custom CSS" },
      { value: "english", label: ENGLISH_NAME, isUserContent: true },
      {
        value: "persian",
        label: PERSIAN_NAME_STARTING_IN_ENGLISH,
        isUserContent: true,
      },
      { value: "port", label: "8080", isUserContent: true },
    ];

    render(<Dropdown onChange={() => {}} options={options} />);

    const menu: HTMLElement = await openMenu();

    expect(optionLabel(menu, CUSTOM_CSS_FA)).not.toHaveAttribute("dir");
    expect(optionLabel(menu, ENGLISH_NAME)).toHaveAttribute("dir", "ltr");
    expect(optionLabel(menu, PERSIAN_NAME_STARTING_IN_ENGLISH)).toHaveAttribute(
      "dir",
      "rtl",
    );
    expect(optionLabel(menu, "8080")).not.toHaveAttribute("dir");
  });

  test("a picked English name reads left to right, so its start stays in view and its full stop at its end", () => {
    const option: DropdownOption = {
      value: "checkout",
      label: ENGLISH_NAME,
      isUserContent: true,
    };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    expect(screen.getByTestId("dropdown-value-label")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a picked Persian name that starts in English reads right to left", () => {
    const option: DropdownOption = {
      value: "payments",
      label: PERSIAN_NAME_STARTING_IN_ENGLISH,
      isUserContent: true,
    };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    expect(screen.getByTestId("dropdown-value-label")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  test("a record's name nobody translated reads by its letters, not the page", () => {
    // Not marked as a name, not in the dictionary: shown as given.
    const option: DropdownOption = { value: "m1", label: ENGLISH_NAME };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    expect(screen.getByTestId("dropdown-value-label")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("each chip of a multi-select follows the same rule", () => {
    dictionary = { "Custom CSS": CUSTOM_CSS_FA };
    const picked: Array<DropdownOption> = [
      { value: "css", label: "Custom CSS" },
      {
        value: "persian",
        label: PERSIAN_NAME_STARTING_IN_ENGLISH,
        isUserContent: true,
      },
      { value: "english", label: ENGLISH_NAME, isUserContent: true },
    ];

    render(
      <Dropdown
        onChange={() => {}}
        options={picked}
        value={picked}
        isMultiSelect={true}
      />,
    );

    const chips: Array<HTMLElement> = screen.getAllByTestId(
      "dropdown-value-label",
    );

    expect(
      chips.map((chip: HTMLElement): string | null => {
        return chip.getAttribute("dir");
      }),
    ).toEqual([null, "rtl", "ltr"]);
  });

  test("a label the caller put together from translated parts reads the page's way", () => {
    const words: string =
      "Runner \u{633}\u{631}\u{627}\u{633}\u{631}\u{6CC} · \u{645}\u{62A}\u{635}\u{644}";
    const option: DropdownOption = {
      value: "",
      label: words,
      isUserContent: true,
      isInPageDirection: true,
    };

    render(<Dropdown onChange={() => {}} options={[option]} value={option} />);

    expect(screen.getByTestId("dropdown-value-label")).not.toHaveAttribute(
      "dir",
    );
  });
});
