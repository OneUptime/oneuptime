import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaFiltersElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilters";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One filter reads as a sentence - "Response Time (in ms)", "Greater
 * Than", "5000" - and used to be rendered as three full-width stacked
 * dropdowns plus a full-width Delete button, roughly 250px of page for
 * three words of configuration. A criteria with three filters was taller
 * than the viewport.
 *
 * This file pins the compact row: that the fields sit in one grid, that
 * the delete control is still reachable (now as a labelled icon), and
 * that none of the behaviour the old layout carried was lost on the way.
 */

function renderFilter(
  criteriaFilter: CriteriaFilter,
  monitorType?: MonitorType,
): {
  onChange: MockFunction;
  onDelete: MockFunction;
  container: HTMLElement;
} {
  const onChange: MockFunction = getJestMockFunction();
  const onDelete: MockFunction = getJestMockFunction();

  const rendered: { container: HTMLElement } = render(
    <CriteriaFilterElement
      monitorType={monitorType || MonitorType.API}
      monitorStep={new MonitorStep()}
      value={criteriaFilter}
      onChange={onChange as unknown as (value: CriteriaFilter) => void}
      onDelete={onDelete as unknown as () => void}
    />,
  );

  return {
    onChange: onChange,
    onDelete: onDelete,
    container: rendered.container,
  };
}

function responseTimeFilter(): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: "5000",
  };
}

/** The grid the filter's fields are laid out in. */
function gridOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector("div.grid");
}

describe("Criteria filter row", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the compact layout", () => {
    test("the filter's fields share one grid instead of stacking full width", () => {
      const rendered: { container: HTMLElement } =
        renderFilter(responseTimeFilter());

      const grid: HTMLElement | null = gridOf(rendered.container);

      expect(grid).not.toBeNull();
      expect(grid?.className).toContain("grid-cols-1");
      // Two columns from the small breakpoint, three from large.
      expect(grid?.className).toContain("sm:grid-cols-2");
      expect(grid?.className).toContain("lg:grid-cols-3");
    });

    test("check, condition and value are all cells of that one grid", () => {
      const rendered: { container: HTMLElement } =
        renderFilter(responseTimeFilter());

      const grid: HTMLElement | null = gridOf(rendered.container);

      for (const label of ["Filter Type", "Filter Condition", "Value"]) {
        const cell: Element | null = screen
          .getByText(label)
          .closest("div.min-w-0");

        expect(cell).not.toBeNull();
        expect(cell?.parentElement).toBe(grid);
      }
    });

    test("the delete control no longer takes a row of its own", () => {
      const rendered: { container: HTMLElement } =
        renderFilter(responseTimeFilter());

      const deleteButton: HTMLElement = screen.getByLabelText("Delete Filter");

      expect(deleteButton.className).toContain("absolute");
      expect(gridOf(rendered.container)?.contains(deleteButton)).toBe(false);
    });

    test("the delete control still deletes", () => {
      const harness: { onDelete: MockFunction } =
        renderFilter(responseTimeFilter());

      fireEvent.click(screen.getByLabelText("Delete Filter"));

      expect(harness.onDelete).toHaveBeenCalledTimes(1);
    });

    test("a metric monitor's rules call the control Delete Rule", () => {
      renderFilter(
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: "80",
        },
        MonitorType.Metrics,
      );

      expect(screen.getByLabelText("Delete Rule")).toBeInTheDocument();
      expect(screen.queryByLabelText("Delete Filter")).not.toBeInTheDocument();
    });

    test("an evaluate-over-time switch spans the full width of the grid", () => {
      /*
       * It is a checkbox with a sentence next to it, not a field - side
       * by side with a dropdown it reads as a caption for it.
       */
      renderFilter(responseTimeFilter());

      const cell: Element | null = screen
        .getByText("Evaluate this criteria over a period of time")
        .closest("div.min-w-0");

      expect(cell?.className).toContain("lg:col-span-3");
    });
  });

  describe("behaviour the old layout carried, unchanged", () => {
    test("all three fields of a filled-in filter are on screen", () => {
      renderFilter(responseTimeFilter());

      expect(screen.getByText("Filter Type")).toBeInTheDocument();
      expect(screen.getByText("Filter Condition")).toBeInTheDocument();
      expect(screen.getByText("Value")).toBeInTheDocument();
      expect(screen.getByText(CheckOn.ResponseTime)).toBeInTheDocument();
      expect(screen.getByText(FilterType.GreaterThan)).toBeInTheDocument();
      expect(screen.getByDisplayValue("5000")).toBeInTheDocument();
    });

    test("typing a new threshold reports it upwards", () => {
      const harness: { onChange: MockFunction } =
        renderFilter(responseTimeFilter());

      fireEvent.change(screen.getByDisplayValue("5000"), {
        target: { value: "9000" },
      });

      expect(harness.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ value: "9000" }),
      );
    });

    test("a metric-only monitor hides the Filter Type dropdown", () => {
      // MetricValue is the only check it offers, so the dropdown is noise.
      renderFilter(
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: "80",
        },
        MonitorType.Metrics,
      );

      expect(screen.queryByText("Filter Type")).not.toBeInTheDocument();
      expect(screen.getByText("Condition")).toBeInTheDocument();
      expect(screen.getByText("Threshold")).toBeInTheDocument();
    });

    test("a JavaScript expression filter still links to its documentation", () => {
      renderFilter({
        checkOn: CheckOn.JavaScriptExpression,
        filterType: FilterType.EvaluatesToTrue,
        value: "response.statusCode === 200",
      });

      expect(
        screen.getByText(
          /Read documentation for using JavaScript expressions here/,
        ),
      ).toBeInTheDocument();
    });
  });
});

/*
 * The list wrapper around those rows. Its job is the AND/OR connector and
 * the guard on the last filter, and both survive the row's new shape.
 */
describe("Criteria filter list", () => {
  afterEach(() => {
    cleanup();
  });

  function renderFilters(data: {
    filters: Array<CriteriaFilter>;
    filterCondition?: FilterCondition | undefined;
    monitorType?: MonitorType | undefined;
  }): { onChange: MockFunction } {
    const onChange: MockFunction = getJestMockFunction();

    const Wrapper: FunctionComponent = (): ReactElement => {
      return (
        <CriteriaFiltersElement
          monitorType={data.monitorType || MonitorType.API}
          monitorStep={new MonitorStep()}
          value={data.filters}
          filterCondition={data.filterCondition || FilterCondition.All}
          onChange={
            onChange as unknown as (value: Array<CriteriaFilter>) => void
          }
        />
      );
    };

    render(<Wrapper />);

    return { onChange: onChange };
  }

  test("two filters matched with ALL are joined by AND", () => {
    renderFilters({
      filters: [responseTimeFilter(), responseTimeFilter()],
      filterCondition: FilterCondition.All,
    });

    expect(screen.getByText("AND")).toBeInTheDocument();
  });

  test("two filters matched with ANY are joined by OR", () => {
    renderFilters({
      filters: [responseTimeFilter(), responseTimeFilter()],
      filterCondition: FilterCondition.Any,
    });

    expect(screen.getByText("OR")).toBeInTheDocument();
  });

  test("a single filter has nothing to be joined to", () => {
    renderFilters({ filters: [responseTimeFilter()] });

    expect(screen.queryByText("AND")).not.toBeInTheDocument();
    expect(screen.queryByText("OR")).not.toBeInTheDocument();
  });

  test("Add Filter seeds a filter the monitor type can actually render", () => {
    const harness: { onChange: MockFunction } = renderFilters({
      filters: [responseTimeFilter()],
      monitorType: MonitorType.Ping,
    });

    fireEvent.click(screen.getByText("Add Filter"));

    const added: Array<CriteriaFilter> = harness.onChange.mock
      .calls[0]?.[0] as Array<CriteriaFilter>;

    expect(added).toHaveLength(2);
    expect(added[1]?.checkOn).toBeTruthy();
    expect(added[1]?.filterType).toBeTruthy();
  });

  test("deleting one of several filters removes just that one", () => {
    const harness: { onChange: MockFunction } = renderFilters({
      filters: [responseTimeFilter(), responseTimeFilter()],
    });

    fireEvent.click(
      screen.getAllByLabelText("Delete Filter")[0] as HTMLElement,
    );

    const remaining: Array<CriteriaFilter> = harness.onChange.mock
      .calls[0]?.[0] as Array<CriteriaFilter>;

    expect(remaining).toHaveLength(1);
  });

  test("the last remaining filter cannot be deleted", () => {
    const harness: { onChange: MockFunction } = renderFilters({
      filters: [responseTimeFilter()],
    });

    fireEvent.click(screen.getByLabelText("Delete Filter"));

    expect(
      screen.getByText("Cannot delete last remaining filter."),
    ).toBeInTheDocument();
    expect(harness.onChange).not.toHaveBeenCalled();
  });
});
