import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import ProbePicker, {
  PROBE_PICKER_CLASS_NAME,
  PROBE_PICKER_DROPDOWN_CLASS_NAME,
  PROBE_PICKER_LIST_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbePicker";
import Probe from "../../../Models/DatabaseModels/Probe";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Monitor Summary card's "Showing results from:" picker (#5281). On a
 * phone it squeezed beside its label to "Frankfu…", with a × that cleared
 * nothing. It never clears now, and lays its label over the list - the list
 * the header's whole width - wherever the two do not fit side by side. The
 * widths a browser draws are measured in
 * packages/E2E/MonitorOverview/MonitorSummaryProbePicker.spec.ts; here, the
 * classes that ask for them, and what a pick does.
 */

function probe(id: string, name: string): Probe {
  const item: Probe = new Probe();
  item._id = id;
  item.name = name;
  return item;
}

const FRANKFURT: Probe = probe(
  "73000000-0000-4000-8000-000000000001",
  "Frankfurt (eu-central-1)",
);
const VIRGINIA: Probe = probe(
  "73000000-0000-4000-8000-000000000002",
  "N. Virginia (us-east-1)",
);
const SINGAPORE: Probe = probe(
  "73000000-0000-4000-8000-000000000003",
  "Singapore (ap-southeast-1)",
);

function renderPicker(data: {
  onProbeSelected?: MockFunction;
  disabledProbeIds?: Array<string>;
}): void {
  render(
    <ProbePicker
      probes={[FRANKFURT, VIRGINIA, SINGAPORE]}
      selectedProbe={FRANKFURT}
      disabledProbeIds={data.disabledProbeIds}
      onProbeSelected={(selected: Probe): void => {
        data.onProbeSelected?.(selected);
      }}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("the Monitor Summary probe picker", () => {
  test("the list is named by its label and shows the picked probe whole", () => {
    renderPicker({});

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Showing results from:",
    });

    expect(combobox).toBeInTheDocument();
    expect(screen.getByTestId("dropdown-value-label")).toHaveTextContent(
      "Frankfurt (eu-central-1)",
    );
  });

  test("it never offers to clear the probe: the card always shows one", () => {
    renderPicker({});

    expect(document.querySelector(".ou-select__clear-indicator")).toBeNull();
  });

  test("the label goes over the list where the two do not fit side by side, the list the whole line", () => {
    renderPicker({});

    const picker: HTMLElement = screen.getByTestId("probe-picker");
    const list: HTMLElement = picker.lastElementChild as HTMLElement;

    expect(picker.getAttribute("class")).toBe(PROBE_PICKER_CLASS_NAME);
    expect(picker).toHaveClass("flex", "flex-wrap", "w-full");
    expect(list.getAttribute("class")).toBe(PROBE_PICKER_LIST_CLASS_NAME);
    /*
     * The whole line on a phone, with no width of its own; 15rem beside the
     * label from sm up; never wider than the picker.
     */
    expect(list).toHaveClass("w-full", "sm:w-60", "max-w-full", "grow");

    // The list's own box has no margin above or below the label's line.
    const dropdownRoot: HTMLElement = list.firstElementChild as HTMLElement;
    expect(dropdownRoot.getAttribute("class")).toBe(
      PROBE_PICKER_DROPDOWN_CLASS_NAME,
    );
    expect(dropdownRoot).not.toHaveClass("mt-2");
    expect(dropdownRoot).not.toHaveClass("mb-1");

    // The label comes first, so a wrapped list sits under it.
    expect(picker.firstElementChild?.tagName).toBe("LABEL");
    expect(picker.firstElementChild).toHaveTextContent("Showing results from:");
    // The label used to be pushed 16px down to meet the list.
    expect(picker.querySelector(".mt-4")).toBeNull();
  });

  test("picking another probe shows its results", () => {
    const onProbeSelected: MockFunction = getJestMockFunction();
    renderPicker({ onProbeSelected });

    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Showing results from:" }),
      { key: "ArrowDown", code: "ArrowDown" },
    );
    fireEvent.click(screen.getByRole("option", { name: SINGAPORE.name! }));

    expect(onProbeSelected).toHaveBeenCalledTimes(1);
    expect(onProbeSelected).toHaveBeenCalledWith(SINGAPORE);
  });

  test("a probe that is off still reads, marked as such", () => {
    renderPicker({ disabledProbeIds: [VIRGINIA._id!.toString()] });

    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Showing results from:" }),
      { key: "ArrowDown", code: "ArrowDown" },
    );

    expect(
      screen.getByRole("option", {
        name: "N. Virginia (us-east-1) (disabled)",
      }),
    ).toBeInTheDocument();
  });
});
