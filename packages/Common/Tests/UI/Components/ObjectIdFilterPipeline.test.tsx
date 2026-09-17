import FiltersForm from "../../../UI/Components/Filters/FiltersForm";
import ClassicFilter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import ModelFilter from "../../../UI/Components/ModelFilter/Filter";
import buildQueryFromFilterData, {
  getFilterKeys,
  sanitizeFilterData,
} from "../../../UI/Components/ModelTable/FilterDataToQuery";
import FieldType from "../../../UI/Components/Types/FieldType";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import User from "../../../Models/DatabaseModels/User";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A master admin pastes a user id into the Users table's "User ID" filter and
 * presses Apply. Between that keystroke and the rows coming back, the value
 * crosses four separate pieces of machinery, each of which can drop it without
 * anything visibly breaking:
 *
 *   1. FiltersForm picks a filter component by FieldType. ObjectID has to land
 *      on the text input; a type it does not recognise renders no control at
 *      all, and the modal shows a label with empty space beside it.
 *   2. That component encodes the operator into a typed query value.
 *   3. sanitizeFilterData drops every key the table did not declare - the
 *      trust boundary for URL-supplied filters - so `_id` has to be declared.
 *   4. buildQueryFromFilterData copies recognised values into the query.
 *
 * These tests walk the whole path with the exact filter declaration the admin
 * Users and Projects tables ship, rather than asserting on any one stage in
 * isolation.
 */

const USER_ID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";

// Exactly what App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx declares.
const ID_FILTER: ModelFilter<User> = {
  field: { _id: true },
  title: "User ID",
  type: FieldType.ObjectID,
};

const NAME_FILTER: ModelFilter<User> = {
  field: { name: true },
  title: "Full Name",
  type: FieldType.Text,
};

const MODEL_FILTERS: Array<ModelFilter<User>> = [ID_FILTER, NAME_FILTER];

/*
 * BaseModelTable converts its `field`-shaped filters into the `key`-shaped
 * ones the filter form consumes. Mirror that conversion here so the form is
 * driven by the page's real declaration.
 */
type ToClassicFunction = (filter: ModelFilter<User>) => ClassicFilter<User>;

const toClassic: ToClassicFunction = (
  filter: ModelFilter<User>,
): ClassicFilter<User> => {
  return {
    title: filter.title,
    key: Object.keys(filter.field)[0] as keyof User,
    type: filter.type,
  } as ClassicFilter<User>;
};

/**
 * The filter form is controlled by its parent - the real one being the filter
 * modal, which holds the selections until Apply. This stands in for that
 * parent, and publishes the current selections so assertions can read them.
 */
let filterData: FilterData<User> = {};

const FilterModalStandIn: React.FunctionComponent<{
  initial: FilterData<User>;
  onChange: (data: FilterData<User>) => void;
}> = (props: {
  initial: FilterData<User>;
  onChange: (data: FilterData<User>) => void;
}): React.ReactElement => {
  const [data, setData] = React.useState<FilterData<User>>(props.initial);

  return (
    <FiltersForm<User>
      id="users-table-filter-form"
      showFilter={true}
      filters={MODEL_FILTERS.map(toClassic)}
      filterData={data}
      onFilterChanged={(next: FilterData<User>) => {
        setData(next);
        props.onChange(next);
      }}
    />
  );
};

type RenderFormFunction = (initial?: FilterData<User>) => void;

const renderForm: RenderFormFunction = (initial?: FilterData<User>): void => {
  filterData = initial || {};

  render(
    <FilterModalStandIn
      initial={filterData}
      onChange={(next: FilterData<User>) => {
        filterData = next;
      }}
    />,
  );
};

/**
 * The text input belonging to the User ID row, found by the placeholder the
 * filter builds from its own title.
 */
type IdInputFunction = () => HTMLInputElement;

const idInput: IdInputFunction = (): HTMLInputElement => {
  return screen.getByPlaceholderText("Filter by User ID") as HTMLInputElement;
};

/**
 * The operator trigger on the User ID row. Rows are `grid` wrappers, so scope
 * the lookup to the one whose label is "User ID" - otherwise the Full Name
 * row's trigger is just as good a match.
 */
type IdOperatorTriggerFunction = () => HTMLButtonElement;

const idOperatorTrigger: IdOperatorTriggerFunction = (): HTMLButtonElement => {
  const label: HTMLElement = screen.getByText("User ID");
  const row: HTMLElement = label.closest("div.grid") as HTMLElement;

  return within(row).getByRole("button", {
    name: /contains|equals|starts with|ends with|does not/i,
  }) as HTMLButtonElement;
};

type ChooseOperatorFunction = (label: string) => void;

const chooseOperator: ChooseOperatorFunction = (label: string): void => {
  const trigger: HTMLButtonElement = idOperatorTrigger();

  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);

  const menuId: string = trigger.getAttribute("aria-controls") as string;
  const menu: HTMLElement = document.getElementById(menuId) as HTMLElement;

  fireEvent.click(within(menu).getByText(label));
};

type QueryFromFilterDataFunction = () => Query<User>;

/**
 * The two stages that sit between the filter modal and the request: strip
 * anything undeclared, then translate what is left into a query.
 */
const queryFromFilterData: QueryFromFilterDataFunction = (): Query<User> => {
  return buildQueryFromFilterData<User>({
    filterData: sanitizeFilterData<User>({
      filterData: filterData,
      filters: MODEL_FILTERS,
    }),
    filters: MODEL_FILTERS,
  });
};

describe("filtering a model by its ObjectID", () => {
  beforeEach(() => {
    filterData = {};
  });

  afterEach(() => {
    cleanup();
  });

  describe("the control the admin actually gets", () => {
    /*
     * FiltersForm renders every filter component and each one returns an
     * empty fragment for types it does not own. If ObjectID were missing from
     * the text filter's list, the row would render its label and nothing
     * else - a filter that looks present and cannot be used.
     */
    test("renders a text input to paste an id into", () => {
      renderForm();

      expect(idInput()).toBeTruthy();
      expect(idInput().tagName).toBe("INPUT");
    });

    test("defaults to matching on part of an id", () => {
      renderForm();

      expect(idOperatorTrigger().textContent).toContain("contains");
    });

    /*
     * An id is usually copied whole, so exact match has to be reachable -
     * and it is the one operator where a wrong encoding is invisible, since
     * "contains <whole id>" and "equals <whole id>" return the same row.
     */
    test("offers exact match as well as partial", () => {
      renderForm();

      const trigger: HTMLButtonElement = idOperatorTrigger();

      fireEvent.mouseDown(trigger);
      fireEvent.click(trigger);

      const menu: HTMLElement = document.getElementById(
        trigger.getAttribute("aria-controls") as string,
      ) as HTMLElement;

      expect(
        Array.from(menu.querySelectorAll("[role='option']")).map(
          (option: Element) => {
            return (option.textContent || "").trim();
          },
        ),
      ).toEqual([
        "contains",
        "does not contain",
        "equals",
        "does not equal",
        "starts with",
        "ends with",
        "is empty",
        "is not empty",
      ]);
    });
  });

  describe("what a typed id becomes", () => {
    test("a partial id becomes a Search on _id", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: "5f0e8e3a" } });

      const query: Query<User> = queryFromFilterData();

      expect(query._id).toBeInstanceOf(Search);
      expect((query._id as Search<string>).toString()).toBe("5f0e8e3a");
    });

    test("a whole id under 'equals' becomes an EqualTo on _id", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: USER_ID } });
      chooseOperator("equals");

      const query: Query<User> = queryFromFilterData();

      expect(query._id).toBeInstanceOf(EqualTo);
      expect((query._id as EqualTo<string>).toString()).toBe(USER_ID);
    });

    test("'does not equal' becomes a NotEqual on _id", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: USER_ID } });
      chooseOperator("does not equal");

      expect(queryFromFilterData()._id).toBeInstanceOf(NotEqual);
    });

    test("'starts with' becomes a StartsWith on _id", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: "5f0e8e3a" } });
      chooseOperator("starts with");

      expect(queryFromFilterData()._id).toBeInstanceOf(StartsWith);
    });

    /*
     * Clearing the box has to clear the filter, not send an empty match that
     * every row satisfies - or, worse, an `_id = ''` the database rejects.
     */
    test("clearing the box removes the filter entirely", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: USER_ID } });
      expect(queryFromFilterData()._id).toBeDefined();

      fireEvent.change(idInput(), { target: { value: "" } });
      expect(queryFromFilterData()._id).toBeUndefined();
    });

    test("filtering by id leaves the other filters alone", () => {
      renderForm();

      fireEvent.change(idInput(), { target: { value: USER_ID } });

      expect(Object.keys(queryFromFilterData())).toEqual(["_id"]);
    });
  });

  describe("the sanitizer that stands between the modal and the request", () => {
    /*
     * `sanitizeFilterData` keeps only keys the table declared a filter for.
     * Before the page declared one, an `_id` in the filter data - restored
     * from a URL, say - was dropped here and the table came back unfiltered.
     */
    test("keeps _id now that the page declares a filter for it", () => {
      expect(getFilterKeys<User>(MODEL_FILTERS)).toContain("_id");

      expect(
        sanitizeFilterData<User>({
          filterData: { _id: new Search(USER_ID) } as FilterData<User>,
          filters: MODEL_FILTERS,
        })._id,
      ).toBeInstanceOf(Search);
    });

    test("still drops a column the page does not offer a filter for", () => {
      expect(
        sanitizeFilterData<User>({
          filterData: {
            _id: new Search(USER_ID),
            isMasterAdmin: true,
          } as unknown as FilterData<User>,
          filters: MODEL_FILTERS,
        }),
      ).toEqual({ _id: new Search(USER_ID) });
    });
  });

  /*
   * Table filters are mirrored into the query string so a filtered view can be
   * bookmarked and shared - which for an ID filter is the whole point, since
   * "here is the user I mean" is exactly the link an admin wants to send.
   * The values are class instances, so they only survive the round trip
   * through JSONFunctions' typed (de)serialization.
   */
  describe("sharing a filtered view by URL", () => {
    type RoundTripFunction = (value: unknown) => unknown;

    const roundTrip: RoundTripFunction = (value: unknown): unknown => {
      const serialized: string = JSON.stringify(
        JSONFunctions.serialize({ _id: value } as JSONObject),
      );

      return (
        JSONFunctions.deserialize(JSON.parse(serialized) as JSONObject) as {
          _id: unknown;
        }
      )._id;
    };

    test("a 'contains' id filter survives the round trip", () => {
      const restored: unknown = roundTrip(new Search(USER_ID));

      expect(restored).toBeInstanceOf(Search);
      expect((restored as Search<string>).toString()).toBe(USER_ID);
    });

    test("an 'equals' id filter survives the round trip", () => {
      const restored: unknown = roundTrip(new EqualTo(USER_ID));

      expect(restored).toBeInstanceOf(EqualTo);
      expect((restored as EqualTo<string>).toString()).toBe(USER_ID);
    });

    /*
     * A restored filter also has to read back as the operator that produced
     * it, or the modal reopens showing "contains" over an equality filter.
     */
    test("a restored 'equals' filter reopens as 'equals'", () => {
      renderForm({ _id: new EqualTo(USER_ID) } as FilterData<User>);

      expect(idOperatorTrigger().textContent).toContain("equals");
      expect(idInput().value).toBe(USER_ID);
    });

    test("a restored 'contains' filter reopens as 'contains'", () => {
      renderForm({ _id: new Search("5f0e8e3a") } as FilterData<User>);

      expect(idOperatorTrigger().textContent).toContain("contains");
      expect(idInput().value).toBe("5f0e8e3a");
    });
  });
});
