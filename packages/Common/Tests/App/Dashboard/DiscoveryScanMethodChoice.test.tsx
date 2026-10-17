import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import DiscoveryScanMethodChoice from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanMethodChoice";

/*
 * The Start Scan form's "Scan method": ICMP (ping) or SNMP, two cards.
 *
 * The component's whole job is the translation between CardSelect's option
 * values and the boolean column the form writes - true for SNMP, false for
 * ICMP - and these tests hold it to that from both ends: which card is drawn
 * as chosen for each value the form can hold, and what a pick reports.
 */

type OnChange = (isSnmpEnabled: boolean) => void;

function renderChoice(
  isSnmpEnabled: boolean | null | undefined,
  onChange: OnChange,
  error?: string,
): void {
  render(
    <div>
      <span id="method-label">Scan method</span>
      <DiscoveryScanMethodChoice
        isSnmpEnabled={isSnmpEnabled}
        onChange={onChange}
        ariaLabelledby="method-label"
        tabIndex={0}
        {...(error ? { error } : {})}
      />
    </div>,
  );
}

function card(method: "icmp" | "snmp"): HTMLElement {
  return screen.getByTestId(`card-select-option-${method}`);
}

afterEach(() => {
  cleanup();
});

describe("which card is chosen", () => {
  test("false is ICMP", () => {
    renderChoice(false, () => {});

    expect(card("icmp")).toHaveAttribute("aria-checked", "true");
    expect(card("snmp")).toHaveAttribute("aria-checked", "false");
  });

  test("true is SNMP", () => {
    renderChoice(true, () => {});

    expect(card("snmp")).toHaveAttribute("aria-checked", "true");
    expect(card("icmp")).toHaveAttribute("aria-checked", "false");
  });

  /*
   * Absent is SNMP, as ScanModeUtil reads it everywhere: a scan stored
   * before the column existed was an SNMP scan, and the step list and the
   * probe read an absent value the same way. A new scan never gets here - it
   * starts on false.
   */
  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("%s is SNMP, the method every scan had before the choice", (_label: string, value: null | undefined) => {
    renderChoice(value, () => {});

    expect(card("snmp")).toHaveAttribute("aria-checked", "true");
    expect(card("icmp")).toHaveAttribute("aria-checked", "false");
  });
});

describe("what a pick reports", () => {
  test("ICMP reports false", () => {
    const onChange: jest.Mock<OnChange> = jest.fn<OnChange>();
    renderChoice(true, onChange);

    fireEvent.click(card("icmp"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("SNMP reports true", () => {
    const onChange: jest.Mock<OnChange> = jest.fn<OnChange>();
    renderChoice(false, onChange);

    fireEvent.click(card("snmp"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  /*
   * Picking the card already chosen is no change: reporting it would run the
   * field's onChange, which clears credentials on the way to ICMP, for
   * nothing.
   */
  test.each([
    ["ICMP", false, "icmp"],
    ["SNMP", true, "snmp"],
  ] as Array<[string, boolean, "icmp" | "snmp"]>)(
    "picking %s again reports nothing",
    (_label: string, value: boolean, method: "icmp" | "snmp") => {
      const onChange: jest.Mock<OnChange> = jest.fn<OnChange>();
      renderChoice(value, onChange);

      fireEvent.click(card(method));

      expect(onChange).not.toHaveBeenCalled();
    },
  );

  test("the keyboard picks too: Enter and Space on a card", () => {
    const onChange: jest.Mock<OnChange> = jest.fn<OnChange>();
    renderChoice(false, onChange);

    fireEvent.keyDown(card("snmp"), { key: "Enter" });
    fireEvent.keyDown(card("snmp"), { key: " " });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
  });

  // It never writes on its own: the form's value is its starting point.
  test("drawing it reports nothing", () => {
    const onChange: jest.Mock<OnChange> = jest.fn<OnChange>();

    renderChoice(false, onChange);
    renderChoice(true, onChange);
    renderChoice(undefined, onChange);

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * Driven the way the form drives it: the value it is handed follows each
   * pick, and the cards follow the value.
   */
  test("follows the value the form hands back", () => {
    function Host(): ReactElement {
      const [value, setValue] = useState<boolean>(false);

      return (
        <DiscoveryScanMethodChoice isSnmpEnabled={value} onChange={setValue} />
      );
    }

    render(<Host />);

    expect(card("icmp")).toHaveAttribute("aria-checked", "true");

    act(() => {
      fireEvent.click(card("snmp"));
    });

    expect(card("snmp")).toHaveAttribute("aria-checked", "true");

    act(() => {
      fireEvent.click(card("icmp"));
    });

    expect(card("icmp")).toHaveAttribute("aria-checked", "true");
  });
});

describe("what it says", () => {
  test("two cards, ICMP (ping) first, each with its one line", () => {
    renderChoice(false, () => {});

    const radios: Array<HTMLElement> = screen.getAllByRole("radio");

    expect(radios).toHaveLength(2);
    expect(radios[0]).toBe(card("icmp"));
    expect(radios[1]).toBe(card("snmp"));
    expect(card("icmp")).toHaveTextContent("ICMP (ping)");
    expect(card("icmp")).toHaveTextContent(
      "Finds the devices that answer ping. No credentials needed.",
    );
    expect(card("snmp")).toHaveTextContent("SNMP");
    expect(card("snmp")).toHaveTextContent(
      "Also reads each device's name and vendor. Needs SNMP credentials.",
    );
  });

  test("the group is named by the field's label", () => {
    renderChoice(false, () => {});

    expect(
      screen.getByRole("radiogroup", { name: "Scan method" }),
    ).toBeInTheDocument();
  });

  /*
   * Stacked, one card per row, at every width: in the dialog's stepped layout
   * (once SNMP brings the step list) two cards side by side squeezed each
   * line onto five.
   */
  test("the cards stack, one per row", () => {
    renderChoice(false, () => {});

    const grid: HTMLElement = card("icmp").parentElement as HTMLElement;

    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).not.toContain("sm:grid-cols-2");
  });

  test("shows the field's error under the cards", () => {
    renderChoice(false, () => {}, "Pick a scan method.");

    expect(screen.getByRole("alert")).toHaveTextContent("Pick a scan method.");
  });
});
