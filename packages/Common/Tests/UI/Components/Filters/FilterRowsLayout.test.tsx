import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import FiltersForm, {
  FILTER_LABEL_CELL_CLASS_NAME,
  FILTER_LABEL_CLASS_NAME,
  FILTER_ROW_CLASS_NAME,
} from "../../../../UI/Components/Filters/FiltersForm";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";
import SessionReplayFilterModal from "../../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterModal";
import { EMPTY_ADVANCED_FILTERS } from "../../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import { SESSION_REPLAY_FILTER_FIELDS } from "../../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterFields";

/*
 * The rows of a table's Filter dialog - every model table's (FiltersForm)
 * and the session list's (SessionReplayFilterModal, drawn the same way) -
 * which a table's ⋯ opens as Filter.
 *
 * A label ended in "..." at its 140px column: the session list's "Page URL
 * starts w..." and "Page URL visited (..." hid what the field was. It runs
 * onto a second line now. And on a phone the 140px column beside the field
 * left the field and its hint a third of the dialog, a hint running past
 * the dialog's edge: there the label sits over its field.
 */

type Row = GenericObject & { name?: string; description?: string };

const FILTERS: Array<Filter<Row>> = [
  { key: "name", title: "Name", type: FieldType.Text },
  {
    key: "description",
    title: "Description of the affected resources",
    type: FieldType.Text,
  },
];

function classesOf(className: string): Array<string> {
  return className.split(" ").filter((name: string): boolean => {
    return name.length > 0;
  });
}

afterEach(() => {
  cleanup();
});

describe("a Filter dialog's row", () => {
  test("is a 140px label column, the field and its clear x from sm up", () => {
    expect(classesOf(FILTER_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["grid", "grid-cols-[140px_1fr_auto]", "gap-3"]),
    );
  });

  test("puts the label over its field on a phone", () => {
    expect(classesOf(FILTER_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "max-sm:grid-cols-[minmax(0,1fr)_auto]",
        "max-sm:gap-y-1.5",
      ]),
    );
    expect(classesOf(FILTER_LABEL_CELL_CLASS_NAME)).toContain(
      "max-sm:col-span-2",
    );
  });

  test("keeps a label whole: it runs onto a second line, never ending in an ellipsis", () => {
    expect(classesOf(FILTER_LABEL_CLASS_NAME)).toEqual(
      expect.arrayContaining(["min-w-0", "break-words", "leading-5"]),
    );
    expect(classesOf(FILTER_LABEL_CLASS_NAME)).not.toContain("truncate");
  });
});

describe("FiltersForm", () => {
  test("draws every row with the shared row, label cell and label", () => {
    render(
      <FiltersForm<Row>
        id="rows-filter-form"
        showFilter={true}
        filters={FILTERS}
        filterData={{}}
        onFilterChanged={(): void => {}}
      />,
    );

    for (const filter of FILTERS) {
      const label: HTMLElement = screen.getByText(filter.title);

      expect(label.tagName).toBe("LABEL");
      expect(label).toHaveClass(...classesOf(FILTER_LABEL_CLASS_NAME));
      expect(label).not.toHaveClass("truncate");
      expect(label.parentElement).toHaveClass(
        ...classesOf(FILTER_LABEL_CELL_CLASS_NAME),
      );
      expect(label.parentElement?.parentElement).toHaveClass(
        ...classesOf(FILTER_ROW_CLASS_NAME),
        "items-center",
      );
    }
  });
});

describe("the session list's Filter dialog", () => {
  test("draws its rows as every Filter dialog does, the long labels whole", () => {
    render(
      <SessionReplayFilterModal
        filters={EMPTY_ADVANCED_FILTERS}
        onApply={(): void => {}}
        onClose={(): void => {}}
      />,
    );

    expect(SESSION_REPLAY_FILTER_FIELDS.length).toBeGreaterThan(0);

    for (const field of SESSION_REPLAY_FILTER_FIELDS) {
      const row: HTMLElement = screen.getByTestId(
        `session-filter-row-${field.field}`,
      );
      const label: HTMLElement = screen.getByTestId(
        `session-filter-label-${field.field}`,
      );

      expect(row).toHaveClass(
        ...classesOf(FILTER_ROW_CLASS_NAME),
        "items-start",
      );
      expect(label).toHaveTextContent(field.title);
      expect(label).toHaveClass(...classesOf(FILTER_LABEL_CLASS_NAME));
      expect(label).not.toHaveClass("truncate");
      /* Level with its field from sm up; over it, with no gap, on a phone. */
      expect(label.parentElement).toHaveClass(
        ...classesOf(FILTER_LABEL_CELL_CLASS_NAME),
        "pt-2",
        "max-sm:pt-0",
      );
    }

    /* The two labels that used to end in "...". */
    expect(
      screen.getByTestId("session-filter-label-urlPrefix"),
    ).toHaveTextContent("Page URL starts with");
    expect(screen.getByTestId("session-filter-label-route")).toHaveTextContent(
      "Page URL visited (exact)",
    );
  });
});
