import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import DateFilter from "../../../../UI/Components/Filters/DateFilter";
import EntityFilter from "../../../../UI/Components/Filters/EntityFilter";
import FiltersForm from "../../../../UI/Components/Filters/FiltersForm";
import NumberFilter from "../../../../UI/Components/Filters/NumberFilter";
import TextFilter from "../../../../UI/Components/Filters/TextFilter";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";

/*
 * FiltersForm draws all of DateFilter, EntityFilter, NumberFilter, TextFilter
 * (and the rest) in every row, keyed by the row's position, and each draws
 * nothing for a filter it does not own. So one mounted filter component goes
 * from "not mine" to "mine" and back whenever the filter in its row changes:
 * the rows below an advanced filter move when the advanced filters are shown
 * or hidden, a table's filter list can change while its filter modal is open,
 * and an entity filter's options can arrive after the filter does.
 *
 * #4285 put useTranslator() at the top of these components, above their
 * "not mine" return, while their own useState and useEffect stayed below it.
 * The number of hooks one component called then changed with the filter it
 * was given, and React threw "Rendered more hooks than during the previous
 * render" (or "fewer hooks than expected") and unmounted the whole form.
 *
 * i18next is set up the way the Dashboard sets it up. Without an instance,
 * useTranslation() returns before calling any hook of its own, and React
 * cannot notice a hook count that changes from zero, so the crash only shows
 * with translations switched on.
 */

const GERMAN: Record<string, string> = {
  "Filter by {{field}}": "Nach {{field}} filtern",
  "Show Advanced Filters": "Erweiterte Filter anzeigen",
  "Hide Advanced Filters": "Erweiterte Filter ausblenden",
};

type Row = GenericObject & {
  createdAt?: Date;
  name?: string;
  retries?: number;
  ownerId?: string;
};

const DATE_FILTER: Filter<Row> = {
  key: "createdAt",
  title: "Created",
  type: FieldType.Date,
};

const TEXT_FILTER: Filter<Row> = {
  key: "name",
  title: "Name",
  type: FieldType.Text,
};

const NUMBER_FILTER: Filter<Row> = {
  key: "retries",
  title: "Retries",
  type: FieldType.Number,
};

const ENTITY_FILTER_WITHOUT_OPTIONS: Filter<Row> = {
  key: "ownerId",
  title: "Owner",
  type: FieldType.Entity,
};

const ENTITY_FILTER: Filter<Row> = {
  ...ENTITY_FILTER_WITHOUT_OPTIONS,
  filterDropdownOptions: [
    { label: "Alex", value: "user-1" },
    { label: "Sam", value: "user-2" },
  ],
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

type FilterComponent = (props: {
  filter: Filter<Row>;
  filterData: FilterData<Row>;
  onFilterChanged?: undefined | ((filterData: FilterData<Row>) => void);
}) => ReactElement;

function filterRow(
  Component: FilterComponent,
  filter: Filter<Row>,
): ReactElement {
  return (
    <Component filter={filter} filterData={{}} onFilterChanged={() => {}} />
  );
}

// What a filter row shows to type or pick a value in, by its placeholder.
function placeholderOf(title: string): string {
  return `Nach ${title} filtern`;
}

function isDrawingInputFor(title: string): boolean {
  return screen.queryByPlaceholderText(placeholderOf(title)) !== null;
}

describe("DateFilter", () => {
  test("a row whose filter becomes a date filter and back keeps drawing", () => {
    const { container, rerender } = render(
      filterRow(DateFilter as FilterComponent, TEXT_FILTER),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(DateFilter as FilterComponent, DATE_FILTER));
    expect(isDrawingInputFor("Created")).toBe(true);

    rerender(filterRow(DateFilter as FilterComponent, TEXT_FILTER));
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(DateFilter as FilterComponent, DATE_FILTER));
    expect(isDrawingInputFor("Created")).toBe(true);
  });
});

describe("NumberFilter", () => {
  test("a row whose filter becomes a number filter and back keeps drawing", () => {
    const { container, rerender } = render(
      filterRow(NumberFilter as FilterComponent, DATE_FILTER),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(NumberFilter as FilterComponent, NUMBER_FILTER));
    expect(isDrawingInputFor("Retries")).toBe(true);

    rerender(filterRow(NumberFilter as FilterComponent, DATE_FILTER));
    expect(container).toBeEmptyDOMElement();
  });

  test("a number column offered as a list of values is left to the dropdown filter", () => {
    const { container, rerender } = render(
      filterRow(NumberFilter as FilterComponent, NUMBER_FILTER),
    );
    expect(isDrawingInputFor("Retries")).toBe(true);

    rerender(
      filterRow(NumberFilter as FilterComponent, {
        ...NUMBER_FILTER,
        filterDropdownOptions: [{ label: "Three", value: 3 }],
      }),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(NumberFilter as FilterComponent, NUMBER_FILTER));
    expect(isDrawingInputFor("Retries")).toBe(true);
  });
});

describe("TextFilter", () => {
  test("a row whose filter becomes a text filter and back keeps drawing", () => {
    const { container, rerender } = render(
      filterRow(TextFilter as FilterComponent, NUMBER_FILTER),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(TextFilter as FilterComponent, TEXT_FILTER));
    expect(isDrawingInputFor("Name")).toBe(true);

    rerender(filterRow(TextFilter as FilterComponent, NUMBER_FILTER));
    expect(container).toBeEmptyDOMElement();
  });

  test("a text column offered as a list of values is left to the dropdown filter", () => {
    const { container, rerender } = render(
      filterRow(TextFilter as FilterComponent, TEXT_FILTER),
    );
    expect(isDrawingInputFor("Name")).toBe(true);

    rerender(
      filterRow(TextFilter as FilterComponent, {
        ...TEXT_FILTER,
        filterDropdownOptions: [{ label: "Checkout API", value: "checkout" }],
      }),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(TextFilter as FilterComponent, TEXT_FILTER));
    expect(isDrawingInputFor("Name")).toBe(true);
  });
});

describe("EntityFilter", () => {
  test("an entity filter whose options arrive after it does starts drawing them", () => {
    const { container, rerender } = render(
      filterRow(EntityFilter as FilterComponent, ENTITY_FILTER_WITHOUT_OPTIONS),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(EntityFilter as FilterComponent, ENTITY_FILTER));
    expect(screen.getByText(placeholderOf("Owner"))).toBeInTheDocument();

    rerender(
      filterRow(EntityFilter as FilterComponent, ENTITY_FILTER_WITHOUT_OPTIONS),
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("a row whose filter becomes an entity filter and back keeps drawing", () => {
    const { container, rerender } = render(
      filterRow(EntityFilter as FilterComponent, TEXT_FILTER),
    );
    expect(container).toBeEmptyDOMElement();

    rerender(filterRow(EntityFilter as FilterComponent, ENTITY_FILTER));
    expect(screen.getByText(placeholderOf("Owner"))).toBeInTheDocument();

    rerender(filterRow(EntityFilter as FilterComponent, TEXT_FILTER));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FiltersForm", () => {
  function form(
    filters: Array<Filter<Row>>,
    showFilter: boolean = true,
  ): ReactElement {
    return (
      <FiltersForm<Row>
        id="rows-filter-form"
        showFilter={showFilter}
        filters={filters}
        filterData={{}}
        onFilterChanged={() => {}}
      />
    );
  }

  test("a hidden form can be shown, hidden and shown again", () => {
    const { container, rerender } = render(form([TEXT_FILTER], false));
    expect(container).toBeEmptyDOMElement();

    rerender(form([TEXT_FILTER], true));
    expect(isDrawingInputFor("Name")).toBe(true);

    rerender(form([TEXT_FILTER], false));
    expect(container).toBeEmptyDOMElement();

    rerender(form([TEXT_FILTER], true));
    expect(isDrawingInputFor("Name")).toBe(true);
  });

  /*
   * The form's own button moves the rows: with an advanced filter between two
   * others, showing it puts the advanced text filter in the second row and
   * moves the number filter down to a new third row. The second row's
   * NumberFilter, which drew the number filter, is handed the text filter,
   * and its TextFilter, which drew nothing, now has to draw it. Hiding it
   * again does the reverse.
   */
  test("showing and hiding an advanced filter between two others keeps every row drawing", () => {
    render(
      form([
        DATE_FILTER,
        { ...TEXT_FILTER, isAdvancedFilter: true },
        NUMBER_FILTER,
      ]),
    );
    expect(isDrawingInputFor("Created")).toBe(true);
    expect(isDrawingInputFor("Name")).toBe(false);
    expect(isDrawingInputFor("Retries")).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Erweiterte Filter anzeigen" }),
    );
    expect(isDrawingInputFor("Created")).toBe(true);
    expect(isDrawingInputFor("Name")).toBe(true);
    expect(isDrawingInputFor("Retries")).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Erweiterte Filter ausblenden" }),
    );
    expect(isDrawingInputFor("Created")).toBe(true);
    expect(isDrawingInputFor("Name")).toBe(false);
    expect(isDrawingInputFor("Retries")).toBe(true);
  });
});
