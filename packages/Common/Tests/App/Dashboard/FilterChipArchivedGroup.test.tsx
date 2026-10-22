import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/*
 * A list's filter chip over values that can be archived
 * (Common/Utils/ArchivableValues), as people see it: the live values first,
 * then the archived ones - still there, since old records keep them and
 * stay findable by them - under an "Archived" heading in the reader's
 * language. The grouping itself is App/Tests/Dashboard/
 * ArchivedValueFacetOptions.
 */

const mockGerman: Record<string, string> = {
  Archived: "Archiviert",
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value ? mockGerman[value] ?? value : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { getArchivableValueFacetOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivedValueFacetOptions";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";

afterEach(() => {
  cleanup();
});

const SEVERITIES: Array<{ _id: string; name: string; isArchived: boolean }> = [
  { _id: "1", name: "Critical Incident", isArchived: false },
  { _id: "2", name: "[DONOTUSE] Very critical", isArchived: true },
  { _id: "3", name: "Major Incident", isArchived: false },
];

const OPTIONS: Array<FilterChipDropdownOption> = getArchivableValueFacetOptions(
  {
    values: SEVERITIES,
    toOption: (value: {
      _id: string;
      name: string;
    }): FilterChipDropdownOption => {
      return { value: value._id, label: value.name, color: "#9ca3af" };
    },
  },
);

const openChip: () => void = (): void => {
  render(
    <FilterChipDropdown
      label="Severity"
      emptyIcon={IconProp.Alert}
      options={OPTIONS}
      isMultiSelect={true}
      value={[]}
      onChange={(): void => {}}
    />,
  );

  fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
};

describe("a filter over values that can be archived", () => {
  test("lists the live values first, the archived ones after an Archived heading", () => {
    openChip();

    const heading: HTMLElement = screen.getByTestId(
      "filter-chip-group-heading",
    );

    // In the reader's language: a heading OneUptime writes.
    expect(heading).toHaveTextContent("Archiviert");
    expect(screen.queryByText("Archived")).toBeNull();

    const critical: HTMLElement = screen.getByText("Critical Incident");
    const major: HTMLElement = screen.getByText("Major Incident");
    const archived: HTMLElement = screen.getByText("[DONOTUSE] Very critical");

    const follows: (first: Node, second: Node) => boolean = (
      first: Node,
      second: Node,
    ): boolean => {
      return Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    expect(follows(critical, heading)).toBe(true);
    expect(follows(major, heading)).toBe(true);
    expect(follows(heading, archived)).toBe(true);
  });

  test("one heading only: the live values have none above them", () => {
    openChip();

    expect(screen.getAllByTestId("filter-chip-group-heading")).toHaveLength(1);
  });

  test("an archived value can still be picked as a filter", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <FilterChipDropdown
        label="Severity"
        emptyIcon={IconProp.Alert}
        options={OPTIONS}
        isMultiSelect={true}
        value={[]}
        onChange={(value: string | Array<string> | null): void => {
          onChange(value);
        }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
    fireEvent.click(screen.getByText("[DONOTUSE] Very critical"));

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]![0]).toEqual([
      "2",
    ]);
  });
});
