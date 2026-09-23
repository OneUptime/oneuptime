/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import React, { ReactElement, useState } from "react";
import TimezoneSelectButton from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/TimezoneSelectButton";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";

/*
 * The on-call schedule's timezone bubble and its picker modal, rendered for
 * real: the modal, the searchable dropdown and the module-level option list.
 *
 * The picker no longer offers legacy tz names ("Singapore", "US/Pacific",
 * "Asia/Calcutta"), but the value handed to it can still be one — a schedule
 * saved years ago, or a "View as" zone seeded from the browser's guess, which
 * Chromium spells "Asia/Calcutta". Matched as given, that value selects no
 * option and the modal opens on its placeholder. It must open on the same
 * clock under its current name.
 *
 * Stored values are never rewritten, though. Saving without choosing another
 * zone hands the value back exactly as it came — legacy spelling, case and
 * padding included — so the schedule page's `timezone === previous` guard
 * sees no change and skips the write. Only choosing a different zone emits a
 * new value, and that value is always the chosen zone's current name.
 */

type OnChange = (value: string | undefined) => void;

interface RenderedButton {
  rerender: (value: string | undefined) => void;
}

const BUTTON_TEST_ID: string = "timezone-button";

function renderButton(options: {
  value?: string | undefined;
  placeholder?: string | undefined;
  onChange?: OnChange | undefined;
}): RenderedButton {
  const onChange: OnChange =
    options.onChange ||
    ((): void => {
      return undefined;
    });

  const element: (value: string | undefined) => ReactElement = (
    value: string | undefined,
  ): ReactElement => {
    return (
      <TimezoneSelectButton
        value={value}
        placeholder={options.placeholder}
        modalTitle="Set schedule timezone"
        submitButtonText="Save timezone"
        dataTestId={BUTTON_TEST_ID}
        onChange={onChange}
      />
    );
  };

  const result: ReturnType<typeof render> = render(element(options.value));

  return {
    rerender: (value: string | undefined): void => {
      result.rerender(element(value));
    },
  };
}

function bubbleText(): string {
  return screen.getByTestId(BUTTON_TEST_ID).textContent || "";
}

function openModal(): HTMLElement {
  fireEvent.click(screen.getByTestId(BUTTON_TEST_ID));

  return screen.getByTestId("modal");
}

function closeModal(): void {
  fireEvent.click(screen.getByTestId("modal-footer-close-button"));
}

function selectedOptionText(): string | null {
  const selected: Element | null = screen
    .getByTestId("modal")
    .querySelector(".ou-select__single-value");

  return selected ? selected.textContent : null;
}

function save(): void {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
}

function pickerInput(): HTMLElement {
  return within(screen.getByTestId("modal")).getByRole("combobox");
}

function search(text: string): void {
  fireEvent.change(pickerInput(), {
    target: { value: text },
  });
}

// Enter picks the option react-select focused: the first one the search left.
function pressEnter(): void {
  fireEvent.keyDown(pickerInput(), { key: "Enter", code: "Enter" });
}

/*
 * Searches, checks the search left exactly the one option expected, and
 * picks it — so a test can never pass by picking whatever happened to be
 * first in a longer list.
 */
function chooseBySearch(text: string, expectedTimezone: string): void {
  search(text);
  expect(visibleOptionTexts()).toEqual([labelFor(expectedTimezone)]);
  pressEnter();
  expect(selectedOptionText()).toBe(labelFor(expectedTimezone));
}

function clearSelection(): void {
  const clearIndicator: HTMLElement | null = screen
    .getByTestId("modal")
    .querySelector<HTMLElement>(".ou-select__clear-indicator");

  expect(clearIndicator).not.toBeNull();
  // react-select clears on a primary-button mousedown, not on click.
  fireEvent.mouseDown(clearIndicator as HTMLElement, { button: 0 });
}

function visibleOptionTexts(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function labelFor(timezone: string): string {
  return OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
    timezone as Timezone,
  );
}

afterEach(() => {
  cleanup();
});

describe("TimezoneSelectButton with a legacy tz name", () => {
  test("shows the current name on the bubble, not the legacy one", () => {
    renderButton({ value: "Asia/Calcutta" });

    expect(bubbleText()).toBe("Asia/Kolkata");
    expect(bubbleText()).not.toContain("Calcutta");
  });

  test("opens the picker with the current name's option selected", () => {
    renderButton({ value: "Asia/Calcutta" });

    openModal();

    expect(selectedOptionText()).toBe("GMT+5:30 Asia/Kolkata");
    expect(
      screen.queryByText("Search and select a timezone"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Asia\/Calcutta/)).not.toBeInTheDocument();
  });

  test("an unchanged Save hands the value back exactly as given", () => {
    /*
     * The caller compares what comes back against what it holds; handing
     * back "Asia/Kolkata" for a stored "Asia/Calcutta" would look like an
     * edit and rewrite a value nobody touched.
     */
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Calcutta", onChange: onChange });

    openModal();
    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Asia/Calcutta");
    expect(onChange).not.toHaveBeenCalledWith("Asia/Kolkata");
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test.each([
    ["Singapore", "Asia/Singapore"],
    ["US/Pacific", "America/Los_Angeles"],
    ["US/Eastern", "America/New_York"],
    ["Europe/Kiev", "Europe/Kyiv"],
    ["America/Godthab", "America/Nuuk"],
    ["Pacific/Enderbury", "Pacific/Kanton"],
    ["Asia/Saigon", "Asia/Ho_Chi_Minh"],
    ["Etc/UTC", "UTC"],
    ["Zulu", "UTC"],
    ["Etc/Greenwich", "GMT"],
    ["EST5EDT", "America/New_York"],
    ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"],
    // Removed from the tzdb entirely, so it has no option of its own.
    ["US/Pacific-New", "America/Los_Angeles"],
    // Names are matched regardless of case and stray whitespace.
    ["asia/calcutta", "Asia/Kolkata"],
    [" Singapore ", "Asia/Singapore"],
  ])(
    "%j opens on %s, selected, and an unchanged Save hands it back as given",
    (legacyValue: string, currentName: string) => {
      const onChange: Mock<OnChange> = jest.fn<OnChange>();
      renderButton({ value: legacyValue, onChange: onChange });

      expect(bubbleText()).toBe(currentName);

      openModal();
      expect(selectedOptionText()).toBe(labelFor(currentName));

      save();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(legacyValue);
    },
  );

  test.each([
    ["US/Pacific", "tokyo", "Asia/Tokyo"],
    ["Asia/Calcutta", "US/Eastern", "America/New_York"],
    [" Singapore ", "Kiev", "Europe/Kyiv"],
    ["Zulu", "Montreal", "America/Toronto"],
    ["US/Pacific-New", "Japan", "Asia/Tokyo"],
    ["asia/calcutta", "Zulu", "UTC"],
  ])(
    "%j, changed by searching %j, saves the chosen zone's current name %s",
    (legacyValue: string, searchText: string, chosenZone: string) => {
      const onChange: Mock<OnChange> = jest.fn<OnChange>();
      renderButton({ value: legacyValue, onChange: onChange });

      openModal();
      chooseBySearch(searchText, chosenZone);
      save();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(chosenZone);
      expect(onChange).not.toHaveBeenCalledWith(legacyValue);
      expect(onChange).not.toHaveBeenCalledWith(searchText);
    },
  );

  test("re-choosing the option already selected still hands back the value as given", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "US/Pacific", onChange: onChange });

    openModal();
    chooseBySearch("los_angeles", "America/Los_Angeles");
    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("US/Pacific");
  });

  test("wandering to another zone and back before saving hands back the value as given", () => {
    /*
     * What counts is the zone the draft ends on, not whether the picker was
     * touched: ending on the same clock is no change.
     */
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Calcutta", onChange: onChange });

    openModal();
    chooseBySearch("tokyo", "Asia/Tokyo");
    chooseBySearch("Calcutta", "Asia/Kolkata");
    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Asia/Calcutta");
  });

  test("clearing the selection and saving hands back undefined, not the legacy value", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "US/Pacific", onChange: onChange });

    openModal();
    clearSelection();
    expect(selectedOptionText()).toBeNull();

    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("closing without saving emits nothing and keeps the bubble on the current name", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "US/Pacific", onChange: onChange });

    openModal();
    closeModal();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(bubbleText()).toBe("America/Los_Angeles");
  });

  test("re-reads a new legacy value each time the picker opens", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    const button: RenderedButton = renderButton({
      value: "Asia/Calcutta",
      onChange: onChange,
    });

    openModal();
    expect(selectedOptionText()).toBe("GMT+5:30 Asia/Kolkata");
    closeModal();

    button.rerender("Singapore");
    expect(bubbleText()).toBe("Asia/Singapore");

    openModal();
    expect(selectedOptionText()).toBe("GMT+8 Asia/Singapore");

    save();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Singapore");
  });

  test("a stored legacy value survives an untouched Save, and is replaced only by a real change", () => {
    /*
     * Stands in for the schedule page (Layers.saveScheduleTimezone): it
     * writes only when the value handed back differs from the one it holds.
     * An untouched Save must therefore cost no write at all, and the stored
     * "US/Pacific" must still be "US/Pacific" afterwards.
     */
    const onWrite: Mock<OnChange> = jest.fn<OnChange>();

    const Harness: React.FunctionComponent = (): ReactElement => {
      const [value, setValue] = useState<string | undefined>("US/Pacific");

      return (
        <>
          <span data-testid="stored-value">{value}</span>
          <TimezoneSelectButton
            value={value}
            modalTitle="Set schedule timezone"
            dataTestId={BUTTON_TEST_ID}
            onChange={(timezone: string | undefined) => {
              if (timezone === value) {
                return;
              }

              setValue(timezone);
              onWrite(timezone);
            }}
          />
        </>
      );
    };

    render(<Harness />);
    expect(screen.getByTestId("stored-value")).toHaveTextContent("US/Pacific");
    expect(bubbleText()).toBe("America/Los_Angeles");

    // Untouched: no write, and the stored spelling stays.
    openModal();
    save();

    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByTestId("stored-value")).toHaveTextContent("US/Pacific");
    expect(bubbleText()).toBe("America/Los_Angeles");

    // A real change writes the chosen zone's current name.
    openModal();
    expect(selectedOptionText()).toBe(labelFor("America/Los_Angeles"));
    chooseBySearch("tokyo", "Asia/Tokyo");
    save();

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenLastCalledWith("Asia/Tokyo");
    expect(screen.getByTestId("stored-value")).toHaveTextContent("Asia/Tokyo");

    // Found again by its old spelling, the zone is written in its current name.
    openModal();
    chooseBySearch("US/Pacific", "America/Los_Angeles");
    save();

    expect(onWrite).toHaveBeenCalledTimes(2);
    expect(onWrite).toHaveBeenLastCalledWith("America/Los_Angeles");
    expect(screen.getByTestId("stored-value")).toHaveTextContent(
      "America/Los_Angeles",
    );

    // And an untouched Save of a current name costs no write either.
    openModal();
    save();

    expect(onWrite).toHaveBeenCalledTimes(2);
  });
});

describe("TimezoneSelectButton with a mis-cased or padded name", () => {
  test.each([
    [" asia/kolkata ", "Asia/Kolkata"],
    ["ASIA/TOKYO", "Asia/Tokyo"],
    ["utc", "UTC"],
    ["europe/kyiv", "Europe/Kyiv"],
  ])(
    "%j shows and selects %s, and an unchanged Save hands it back as typed",
    (typedValue: string, currentName: string) => {
      const onChange: Mock<OnChange> = jest.fn<OnChange>();
      renderButton({ value: typedValue, onChange: onChange });

      expect(bubbleText()).toBe(currentName);

      openModal();
      expect(selectedOptionText()).toBe(labelFor(currentName));

      save();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(typedValue);
    },
  );

  test("choosing a different zone saves that zone's current name", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: " asia/kolkata ", onChange: onChange });

    openModal();
    chooseBySearch("singa", "Asia/Singapore");
    save();

    expect(onChange).toHaveBeenCalledWith("Asia/Singapore");
  });
});

describe("TimezoneSelectButton with a current tz name", () => {
  test("shows, selects and saves the value unchanged", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Tokyo", onChange: onChange });

    expect(bubbleText()).toBe("Asia/Tokyo");

    openModal();
    expect(selectedOptionText()).toBe("GMT+9 Asia/Tokyo");

    save();
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  test.each([
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Kuala_Lumpur",
    "Europe/Oslo",
    "Europe/Kyiv",
    "America/Toronto",
    "UTC",
    "GMT",
    "Etc/GMT-8",
  ])("%s is left exactly as it is", (timezone: string) => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: timezone, onChange: onChange });

    expect(bubbleText()).toBe(timezone);

    openModal();
    expect(selectedOptionText()).toBe(labelFor(timezone));

    save();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(timezone);
  });

  test("saves a newly picked zone", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Calcutta", onChange: onChange });

    openModal();
    search("tokyo");
    expect(visibleOptionTexts()).toEqual(["GMT+9 Asia/Tokyo"]);

    pressEnter();
    expect(selectedOptionText()).toBe("GMT+9 Asia/Tokyo");

    save();
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  test("a zone found by one of its legacy spellings saves under its current name", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Tokyo", onChange: onChange });

    openModal();
    chooseBySearch("Calcutta", "Asia/Kolkata");
    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Asia/Kolkata");
    expect(onChange).not.toHaveBeenCalledWith("Asia/Calcutta");
  });

  test("closing without saving discards the pick", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Asia/Calcutta", onChange: onChange });

    openModal();
    search("tokyo");
    pressEnter();
    closeModal();

    expect(onChange).not.toHaveBeenCalled();
    expect(bubbleText()).toBe("Asia/Kolkata");

    openModal();
    expect(selectedOptionText()).toBe("GMT+5:30 Asia/Kolkata");
  });
});

describe("TimezoneSelectButton without a value", () => {
  test("shows the placeholder on the bubble and in the picker", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({
      placeholder: "Not set — using server local time",
      onChange: onChange,
    });

    expect(bubbleText()).toBe("Not set — using server local time");

    openModal();
    expect(selectedOptionText()).toBeNull();
    expect(
      screen.getByText("Search and select a timezone"),
    ).toBeInTheDocument();

    save();
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("choosing a zone saves its current name", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ onChange: onChange });

    openModal();
    chooseBySearch("Japan", "Asia/Tokyo");
    save();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  test("falls back to a generic prompt when no placeholder is given", () => {
    renderButton({});

    expect(bubbleText()).toBe("Select timezone");
  });

  test("treats an empty string as no value", () => {
    renderButton({ value: "" });

    expect(bubbleText()).toBe("Select timezone");

    openModal();
    expect(selectedOptionText()).toBeNull();
  });
});

describe("TimezoneSelectButton with a zone the picker does not know", () => {
  test("shows it as given rather than dropping or rewriting it", () => {
    /*
     * Translating is not validating: a zone newer than the enum must still
     * be visible to the person who has it.
     */
    const onChange: Mock<OnChange> = jest.fn<OnChange>();
    renderButton({ value: "Mars/Olympus_Mons", onChange: onChange });

    expect(bubbleText()).toBe("Mars/Olympus_Mons");

    openModal();
    expect(selectedOptionText()).toBeNull();

    save();
    expect(onChange).toHaveBeenCalledWith("Mars/Olympus_Mons");
  });
});

describe("TimezoneSelectButton's picker offers each clock once", () => {
  test('searching "singa" finds only Asia/Singapore', () => {
    renderButton({ value: "Asia/Singapore" });

    openModal();
    search("singa");

    expect(visibleOptionTexts()).toEqual(["GMT+8 Asia/Singapore"]);
  });

  /*
   * A legacy spelling is not offered as an entry of its own, but typing it
   * finds the one entry it now lives under — however many spellings that
   * entry answers to (US/Pacific, US/Pacific-New and PST8PDT are all Los
   * Angeles; seven spellings are UTC).
   */
  test.each([
    ["calcutta", "Asia/Kolkata"],
    ["kolkata", "Asia/Kolkata"],
    ["zulu", "UTC"],
    ["us/pacific", "America/Los_Angeles"],
    ["US/Eastern", "America/New_York"],
    ["Kiev", "Europe/Kyiv"],
    ["Montreal", "America/Toronto"],
    ["Japan", "Asia/Tokyo"],
    ["Saigon", "Asia/Ho_Chi_Minh"],
    ["Godthab", "America/Nuuk"],
  ])('searching "%s" finds only %s', (text: string, expected: string) => {
    renderButton({});

    openModal();
    search(text);

    expect(visibleOptionTexts()).toEqual([labelFor(expected)]);
  });

  test("a search matching nothing lists nothing", () => {
    renderButton({});

    openModal();
    search("Olympus_Mons");

    expect(visibleOptionTexts()).toEqual([]);
  });
});
