import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import AppliedFilters from "../../../UI/Components/Filters/AppliedFilters";
import FilterViewer from "../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../UI/Components/Types/FieldType";
import { getGlyphOfIcon, getGlyphOfSvg } from "./MenuItemIcons";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * The box over a filtered list - "Showing monitors that match", a chip per
 * filter, Edit Filters and Clear Filters. Every table and list shows it
 * through FilterViewer, and a filtered feed through FeedFilterSummary, so it
 * is one component and the two cannot drift apart.
 */

type VoidMock = ReturnType<typeof jest.fn<() => void>>;

type Row = {
  enabled: boolean;
};

afterEach(() => {
  cleanup();
});

describe("AppliedFilters", () => {
  test("shows the title, a chip per filter, and Edit Filters and Clear Filters", () => {
    const onEditFilters: VoidMock = jest.fn<() => void>();
    const onClearFilters: VoidMock = jest.fn<() => void>();

    render(
      <AppliedFilters
        dataTestId="applied"
        title="Showing monitors that match"
        chips={[
          <span key="a">Name is API</span>,
          <span key="b">Enabled is Yes</span>,
        ]}
        onEditFilters={onEditFilters}
        onClearFilters={onClearFilters}
      />,
    );

    const box: HTMLElement = screen.getByTestId("applied");

    expect(within(box).getByText("Showing monitors that match")).toBeVisible();
    expect(
      Array.from(box.querySelectorAll(".rounded-full")).map(
        (chip: Element): string => {
          return chip.textContent || "";
        },
      ),
    ).toEqual(["Name is API", "Enabled is Yes"]);

    fireEvent.click(within(box).getByRole("button", { name: "Edit Filters" }));
    expect(onEditFilters).toHaveBeenCalledTimes(1);
    expect(onClearFilters).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByRole("button", { name: "Clear Filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  /*
   * Icon applies a size prop only alongside a className, so the heading's
   * funnel - given a size alone - drew at 0 x 0 in every table's box.
   */
  test("draws the heading's funnel at a real size", () => {
    render(
      <AppliedFilters
        dataTestId="applied"
        title="Showing results that match"
        chips={[<span key="a">Name is API</span>]}
        onClearFilters={jest.fn<() => void>()}
      />,
    );

    const svg: SVGElement | null = screen
      .getByTestId("applied")
      .querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class")).toContain("h-4");
    expect(svg!.getAttribute("class")).toContain("w-4");
    expect(svg!.getAttribute("class")).not.toContain("undefined");
    expect(getGlyphOfSvg(svg)).toBe(getGlyphOfIcon(IconProp.Filter));
  });

  test("leaves the box without a test id when it is given none, as the tables draw it", () => {
    const { container } = render(
      <AppliedFilters
        title="Showing results that match"
        chips={[<span key="a">Name is API</span>]}
        onClearFilters={jest.fn<() => void>()}
      />,
    );

    expect(container.firstElementChild).not.toHaveAttribute("data-testid");
  });
});

describe("FilterViewer draws its box with AppliedFilters", () => {
  const FILTERS: Array<Filter<Row>> = [
    {
      title: "Enabled",
      key: "enabled",
      type: FieldType.Boolean,
    },
  ];

  test("titles the box by the list's items, chips the filter, and edits or clears it", () => {
    const onFilterChanged: ReturnType<
      typeof jest.fn<(filterData: FilterData<Row>) => void>
    > = jest.fn<(filterData: FilterData<Row>) => void>();
    const onFilterModalOpen: VoidMock = jest.fn<() => void>();
    const onFilterModalClose: VoidMock = jest.fn<() => void>();

    const { container } = render(
      <FilterViewer<Row>
        id="monitors"
        filters={FILTERS}
        filterData={{ enabled: true }}
        showFilterModal={false}
        pluralLabel="Monitors"
        onFilterChanged={onFilterChanged}
        onFilterModalOpen={onFilterModalOpen}
        onFilterModalClose={onFilterModalClose}
      />,
    );

    expect(screen.getByText("Showing Monitors that match")).toBeVisible();
    expect(screen.getByText("Enabled")).toBeVisible();
    expect(screen.getByText("Yes")).toBeVisible();

    // The table's box carries the same frame as AppliedFilters'.
    const frame: Element | null = container.querySelector(
      ".bg-gray-50.rounded-xl.p-4.border.border-gray-200",
    );

    expect(frame).not.toBeNull();
    expect(getGlyphOfSvg(frame!.querySelector("svg"))).toBe(
      getGlyphOfIcon(IconProp.Filter),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Filters" }));
    expect(onFilterModalOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(onFilterChanged).toHaveBeenCalledWith({});
    expect(onFilterModalClose).toHaveBeenCalledTimes(1);
  });

  test("shows no box while nothing is filtered", () => {
    const { container } = render(
      <FilterViewer<Row>
        id="monitors"
        filters={FILTERS}
        filterData={{}}
        showFilterModal={false}
      />,
    );

    expect(container.querySelector(".bg-gray-50.rounded-xl.p-4")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear Filters" })).toBeNull();
  });
});
