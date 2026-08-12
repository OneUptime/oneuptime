/** @timezone UTC */
import CustomTimeRangeModal, {
  QUICK_FILL_OPTIONS,
  getCustomTimeRangeError,
} from "../../../UI/Components/Date/CustomTimeRangeModal";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const START: Date = new Date("2024-03-01T10:00:00.000Z");
const END: Date = new Date("2024-03-01T13:00:00.000Z");

interface RenderResult {
  saved: Array<InBetween<Date>>;
  closes: number;
}

function renderModalWith(
  initialValue: InBetween<Date> | undefined,
): RenderResult {
  const result: RenderResult = { saved: [], closes: 0 };

  render(
    <CustomTimeRangeModal
      initialValue={initialValue}
      onClose={() => {
        result.closes++;
      }}
      onSave={(value: InBetween<Date>) => {
        result.saved.push(value);
      }}
    />,
  );

  return result;
}

function renderModal(
  initialValue: InBetween<Date> = new InBetween<Date>(START, END),
): RenderResult {
  return renderModalWith(initialValue);
}

function getStartInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-start") as HTMLInputElement;
}

function getEndInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-end") as HTMLInputElement;
}

/*
 * jsdom normalises a `datetime-local` value to minute precision, so the raw
 * string a field reports back is not comparable to what the component wrote
 * into it. Reading the instant it names is, and these tests use whole minutes.
 */
function getFieldDate(input: HTMLInputElement): Date {
  return OneUptimeDate.fromDateTimeLocalString(input.value);
}

function getApplyButton(): HTMLButtonElement {
  return screen.getByText("Apply").closest("button") as HTMLButtonElement;
}

function typeInto(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value: value } });
}

afterEach(() => {
  cleanup();
});

describe("getCustomTimeRangeError", () => {
  test("asks for a start when there is none", () => {
    expect(getCustomTimeRangeError(null, END)).toBe(
      "Pick a start date and time.",
    );
  });

  test("asks for an end when there is none", () => {
    expect(getCustomTimeRangeError(START, null)).toBe(
      "Pick an end date and time.",
    );
  });

  test("asks for a start first when both ends are missing", () => {
    expect(getCustomTimeRangeError(null, null)).toBe(
      "Pick a start date and time.",
    );
  });

  test("rejects an inverted range", () => {
    expect(getCustomTimeRangeError(END, START)).toBe(
      "The end must be after the start. Adjust either end of the range.",
    );
  });

  test("rejects a zero-length range", () => {
    expect(getCustomTimeRangeError(START, new Date(START))).not.toBe("");
  });

  test("accepts a range whose end is after its start", () => {
    expect(getCustomTimeRangeError(START, END)).toBe("");
  });
});

describe("CustomTimeRangeModal", () => {
  describe("rendering", () => {
    test("renders inside a modal dialog", () => {
      renderModal();

      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
    });

    test("uses the default title and description", () => {
      renderModal();

      expect(screen.getByTestId("modal-title").textContent).toBe(
        "Custom Time Range",
      );
      expect(screen.getByTestId("modal-description").textContent).toContain(
        "exact start and end date",
      );
    });

    test("lets the caller override the title and description", () => {
      render(
        <CustomTimeRangeModal
          initialValue={new InBetween<Date>(START, END)}
          title="Pick log window"
          description="Only logs in this window are shown."
          onClose={jest.fn()}
          onSave={jest.fn()}
        />,
      );

      expect(screen.getByTestId("modal-title").textContent).toBe(
        "Pick log window",
      );
      expect(screen.getByTestId("modal-description").textContent).toBe(
        "Only logs in this window are shown.",
      );
    });

    test("seeds both fields from the initial value", () => {
      renderModal();

      expect(getFieldDate(getStartInput()).getTime()).toBe(START.getTime());
      expect(getFieldDate(getEndInput()).getTime()).toBe(END.getTime());
    });

    test("renders both fields with seconds enabled", () => {
      renderModal();

      expect(getStartInput().getAttribute("step")).toBe("1");
      expect(getEndInput().getAttribute("step")).toBe("1");
    });

    test("uses datetime-local fields so the browser supplies date and time", () => {
      renderModal();

      expect(getStartInput().getAttribute("type")).toBe("datetime-local");
      expect(getEndInput().getAttribute("type")).toBe("datetime-local");
    });

    test("labels both fields", () => {
      renderModal();

      expect(getStartInput()).toBe(screen.getByLabelText("From"));
      expect(getEndInput()).toBe(screen.getByLabelText("To"));
    });

    test("starts empty when no initial value is given", () => {
      renderModalWith(undefined);

      expect(getStartInput().value).toBe("");
      expect(getEndInput().value).toBe("");
    });

    test("names the timezone the times are shown in", () => {
      renderModal();

      expect(
        screen.getByText(
          `Times are shown in ${OneUptimeDate.getCurrentTimezoneString()}.`,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("summary", () => {
    test("summarises a valid window", () => {
      renderModal();

      const summary: HTMLElement = screen.getByTestId(
        "custom-time-range-summary",
      );

      expect(summary.textContent).toContain(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          START,
          false,
          true,
        ),
      );
      expect(summary.textContent).toContain(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          END,
          false,
          true,
        ),
      );
    });

    test("shows the duration of the selected window", () => {
      renderModal();

      expect(
        screen.getByTestId("custom-time-range-summary").textContent,
      ).toContain("3 hours");
    });

    test("replaces the summary with an error when the window is invalid", () => {
      renderModal(new InBetween<Date>(END, START));

      expect(screen.queryByTestId("custom-time-range-summary")).toBeNull();
      expect(screen.getByTestId("custom-time-range-error")).toBeInTheDocument();
    });

    test("announces the error to assistive technology", () => {
      renderModal(new InBetween<Date>(END, START));

      expect(
        screen.getByTestId("custom-time-range-error").getAttribute("role"),
      ).toBe("alert");
    });

    test("recomputes the summary as the user edits a field", () => {
      renderModal();

      typeInto(getEndInput(), "2024-03-01T11:00:00");

      expect(
        screen.getByTestId("custom-time-range-summary").textContent,
      ).toContain("1 hour");
    });
  });

  describe("quick fill", () => {
    test("renders every quick fill option", () => {
      renderModal();

      for (const option of QUICK_FILL_OPTIONS) {
        expect(screen.getByText(option.label)).toBeInTheDocument();
      }
    });

    test("fills both ends of the range from a quick fill", () => {
      renderModal();

      fireEvent.click(screen.getByText("Last 24 hours"));

      const start: Date = OneUptimeDate.fromDateTimeLocalString(
        getStartInput().value,
      );
      const end: Date = OneUptimeDate.fromDateTimeLocalString(
        getEndInput().value,
      );

      expect(OneUptimeDate.getDifferenceInMinutes(start, end)).toBe(60 * 24);
    });

    test("does not apply the range on its own", () => {
      const result: RenderResult = renderModal();

      fireEvent.click(screen.getByText("Last 7 days"));

      expect(result.saved).toHaveLength(0);
      expect(result.closes).toBe(0);
    });

    test("marks the matching quick fill as pressed", () => {
      renderModal();

      fireEvent.click(screen.getByText("Last 6 hours"));

      expect(
        screen.getByText("Last 6 hours").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getByText("Last 1 hour").getAttribute("aria-pressed")).toBe(
        "false",
      );
    });

    test("leaves every quick fill unpressed for a window none of them match", () => {
      // The seeded window is three hours, which is not an offered shortcut.
      renderModal();

      for (const option of QUICK_FILL_OPTIONS) {
        expect(
          screen.getByText(option.label).getAttribute("aria-pressed"),
        ).toBe("false");
      }
    });

    test("recovers from an invalid window", () => {
      renderModal(new InBetween<Date>(END, START));

      expect(getApplyButton().hasAttribute("disabled")).toBe(true);

      fireEvent.click(screen.getByText("Last 1 hour"));

      expect(getApplyButton().hasAttribute("disabled")).toBe(false);
    });
  });

  describe("editing", () => {
    test("keeps edits local until Apply is pressed", () => {
      const result: RenderResult = renderModal();

      typeInto(getStartInput(), "2024-03-01T09:00:00");
      typeInto(getEndInput(), "2024-03-01T12:00:00");

      /*
       * The old inline editor pushed every keystroke straight at the parent,
       * which re-queried the backend for half-typed dates.
       */
      expect(result.saved).toHaveLength(0);
    });

    test("applies the edited window", () => {
      const result: RenderResult = renderModal();

      typeInto(getStartInput(), "2024-03-01T09:30:00");
      fireEvent.click(getApplyButton());

      expect(result.saved).toHaveLength(1);
      expect(
        OneUptimeDate.toDateTimeLocalString(result.saved[0]!.startValue),
      ).toBe("2024-03-01T09:30:00");
      expect(
        OneUptimeDate.toDateTimeLocalString(result.saved[0]!.endValue),
      ).toBe(OneUptimeDate.toDateTimeLocalString(END));
    });

    test("hands back an InBetween of dates", () => {
      const result: RenderResult = renderModal();

      fireEvent.click(getApplyButton());

      expect(result.saved[0]).toBeInstanceOf(InBetween);
      expect(result.saved[0]!.startValue).toBeInstanceOf(Date);
      expect(result.saved[0]!.endValue).toBeInstanceOf(Date);
    });

    test("treats a cleared field as missing", () => {
      renderModal();

      typeInto(getStartInput(), "");

      expect(screen.getByTestId("custom-time-range-error").textContent).toBe(
        "Pick a start date and time.",
      );
    });

    test("re-enables Apply once a cleared field is filled back in", () => {
      renderModal();

      typeInto(getEndInput(), "");
      expect(getApplyButton().hasAttribute("disabled")).toBe(true);

      typeInto(getEndInput(), "2024-03-01T18:00:00");
      expect(getApplyButton().hasAttribute("disabled")).toBe(false);
    });

    test("resolves typed wall-clock times in the configured timezone", () => {
      const result: RenderResult = renderModal();

      typeInto(getStartInput(), "2024-03-01T09:15:00");
      typeInto(getEndInput(), "2024-03-01T09:45:00");
      fireEvent.click(getApplyButton());

      expect(result.saved[0]!.startValue.getTime()).toBe(
        OneUptimeDate.fromDateTimeLocalString("2024-03-01T09:15:00").getTime(),
      );
      expect(result.saved[0]!.endValue.getTime()).toBe(
        OneUptimeDate.fromDateTimeLocalString("2024-03-01T09:45:00").getTime(),
      );
    });
  });

  describe("apply and cancel", () => {
    test("disables Apply while the range is inverted", () => {
      renderModal();

      typeInto(getEndInput(), "2024-03-01T08:00:00");

      expect(getApplyButton().hasAttribute("disabled")).toBe(true);
    });

    test("does not save an invalid range even if Apply is invoked", () => {
      const result: RenderResult = renderModal(new InBetween<Date>(END, START));

      fireEvent.click(getApplyButton());

      expect(result.saved).toHaveLength(0);
    });

    test("enables Apply for a valid seeded range", () => {
      renderModal();

      expect(getApplyButton().hasAttribute("disabled")).toBe(false);
    });

    test("closes without saving when Cancel is pressed", () => {
      const result: RenderResult = renderModal();

      fireEvent.click(screen.getByText("Cancel"));

      expect(result.closes).toBe(1);
      expect(result.saved).toHaveLength(0);
    });

    test("closes without saving when the close button is pressed", () => {
      const result: RenderResult = renderModal();

      fireEvent.click(screen.getByTestId("close-button"));

      expect(result.closes).toBe(1);
      expect(result.saved).toHaveLength(0);
    });

    test("closes without saving on Escape", () => {
      const result: RenderResult = renderModal();

      fireEvent.keyDown(document, { key: "Escape" });

      expect(result.closes).toBe(1);
      expect(result.saved).toHaveLength(0);
    });

    test("does not close itself when the range is applied", () => {
      /*
       * Teardown is the caller's job — it owns the mount, and closing here as
       * well would fire onClose alongside onSave.
       */
      const result: RenderResult = renderModal();

      fireEvent.click(getApplyButton());

      expect(result.saved).toHaveLength(1);
      expect(result.closes).toBe(0);
    });
  });
});
