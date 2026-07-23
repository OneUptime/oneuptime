import TableViewUrlState, {
  MaxItemsOnPage,
  TableViewUrlStateData,
} from "../../../UI/Utils/TableViewUrlState";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The `view` slice carries the parts of a table's state that aren't column
 * filters: the search box, its label chips, the active sort and where the user
 * is in the pagination.
 *
 * Two properties matter and are pinned here:
 *
 *  1. Defaults are never written. A table nobody has touched must contribute
 *     no query params at all, otherwise every page in the app grows a tail of
 *     noise the first time it renders.
 *  2. Every field is validated independently on the way back in. The param is
 *     user-editable, so `?...-view={"page":"drop table"}` has to degrade to
 *     "no page", not to a broken table or a hostile value in the API call.
 */

describe("TableViewUrlState.toJSON", () => {
  test("returns null when nothing differs from the defaults", () => {
    expect(TableViewUrlState.toJSON({})).toBeNull();
    expect(
      TableViewUrlState.toJSON({
        search: "",
        labels: [],
        page: 1,
      }),
    ).toBeNull();
  });

  test("treats a whitespace-only search as empty", () => {
    expect(TableViewUrlState.toJSON({ search: "   " })).toBeNull();
  });

  test("includes a search term", () => {
    expect(TableViewUrlState.toJSON({ search: "api" })).toEqual({
      search: "api",
    });
  });

  test("includes selected labels and drops empty ids", () => {
    expect(TableViewUrlState.toJSON({ labels: ["a", "", "b"] })).toEqual({
      labels: ["a", "b"],
    });
  });

  test("omits the page when it is the first one", () => {
    expect(TableViewUrlState.toJSON({ page: 1 })).toBeNull();
    expect(TableViewUrlState.toJSON({ page: 3 })).toEqual({ page: 3 });
  });

  test("omits a sort that matches the table's own default", () => {
    expect(
      TableViewUrlState.toJSON(
        { sortBy: "createdAt", sortOrder: SortOrder.Descending },
        { sortBy: "createdAt", sortOrder: SortOrder.Descending },
      ),
    ).toBeNull();
  });

  test("includes a sort that differs from the default field", () => {
    expect(
      TableViewUrlState.toJSON(
        { sortBy: "name", sortOrder: SortOrder.Ascending },
        { sortBy: "createdAt", sortOrder: SortOrder.Descending },
      ),
    ).toEqual({ sortBy: "name", sortOrder: SortOrder.Ascending });
  });

  test("includes a sort that only differs by direction", () => {
    expect(
      TableViewUrlState.toJSON(
        { sortBy: "createdAt", sortOrder: SortOrder.Ascending },
        { sortBy: "createdAt", sortOrder: SortOrder.Descending },
      ),
    ).toEqual({ sortBy: "createdAt", sortOrder: SortOrder.Ascending });
  });

  test("includes a sort when the table had no default", () => {
    expect(
      TableViewUrlState.toJSON({
        sortBy: "name",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ sortBy: "name", sortOrder: SortOrder.Ascending });
  });

  test("includes the page size only when one was supplied", () => {
    expect(TableViewUrlState.toJSON({ itemsOnPage: 50 })).toEqual({
      itemsOnPage: 50,
    });
    expect(TableViewUrlState.toJSON({ itemsOnPage: undefined })).toBeNull();
  });

  test("carries every field at once", () => {
    expect(
      TableViewUrlState.toJSON({
        search: "api",
        labels: ["label-1"],
        sortBy: "name",
        sortOrder: SortOrder.Descending,
        page: 4,
        itemsOnPage: 25,
      }),
    ).toEqual({
      search: "api",
      labels: ["label-1"],
      sortBy: "name",
      sortOrder: SortOrder.Descending,
      page: 4,
      itemsOnPage: 25,
    });
  });
});

describe("TableViewUrlState.fromJSON", () => {
  test("returns an empty state for null / undefined / a non-object", () => {
    expect(TableViewUrlState.fromJSON(null)).toEqual({});
    expect(TableViewUrlState.fromJSON(undefined)).toEqual({});
    expect(TableViewUrlState.fromJSON("nope" as unknown as JSONObject)).toEqual(
      {},
    );
  });

  test("reads a well-formed snapshot", () => {
    expect(
      TableViewUrlState.fromJSON({
        search: "api",
        labels: ["a", "b"],
        sortBy: "name",
        sortOrder: SortOrder.Descending,
        page: 3,
        itemsOnPage: 25,
      }),
    ).toEqual({
      search: "api",
      labels: ["a", "b"],
      sortBy: "name",
      sortOrder: SortOrder.Descending,
      page: 3,
      itemsOnPage: 25,
    });
  });

  describe("hand-edited values are rejected field by field", () => {
    test("a non-string search is dropped", () => {
      expect(
        TableViewUrlState.fromJSON({ search: 5 as unknown as string }).search,
      ).toBeUndefined();
    });

    test("an empty search is dropped", () => {
      expect(
        TableViewUrlState.fromJSON({ search: "  " }).search,
      ).toBeUndefined();
    });

    test("labels that aren't an array are dropped", () => {
      expect(
        TableViewUrlState.fromJSON({ labels: "a" as unknown as Array<string> })
          .labels,
      ).toBeUndefined();
    });

    test("non-string entries inside labels are dropped", () => {
      expect(
        TableViewUrlState.fromJSON({
          labels: ["a", 5, null, "b"] as unknown as Array<string>,
        }).labels,
      ).toEqual(["a", "b"]);
    });

    test("an unrecognised sortOrder falls back to ascending", () => {
      expect(
        TableViewUrlState.fromJSON({
          sortBy: "name",
          sortOrder: "sideways" as unknown as SortOrder,
        }),
      ).toEqual({ sortBy: "name", sortOrder: SortOrder.Ascending });
    });

    test("a sortOrder without a sortBy is ignored", () => {
      expect(
        TableViewUrlState.fromJSON({ sortOrder: SortOrder.Descending }),
      ).toEqual({});
    });

    test("a non-numeric page is dropped", () => {
      expect(
        TableViewUrlState.fromJSON({ page: "2" as unknown as number }).page,
      ).toBeUndefined();
    });

    test("a zero or negative page is dropped", () => {
      expect(TableViewUrlState.fromJSON({ page: 0 }).page).toBeUndefined();
      expect(TableViewUrlState.fromJSON({ page: -4 }).page).toBeUndefined();
    });

    test("a fractional page is floored", () => {
      expect(TableViewUrlState.fromJSON({ page: 3.9 }).page).toBe(3);
    });

    test("NaN and Infinity are dropped", () => {
      expect(TableViewUrlState.fromJSON({ page: NaN }).page).toBeUndefined();
      expect(
        TableViewUrlState.fromJSON({ page: Infinity }).page,
      ).toBeUndefined();
    });

    test("a page size above the cap is dropped rather than sent to the API", () => {
      expect(
        TableViewUrlState.fromJSON({ itemsOnPage: MaxItemsOnPage }).itemsOnPage,
      ).toBe(MaxItemsOnPage);
      expect(
        TableViewUrlState.fromJSON({ itemsOnPage: MaxItemsOnPage + 1 })
          .itemsOnPage,
      ).toBeUndefined();
      expect(
        TableViewUrlState.fromJSON({ itemsOnPage: 10_000_000 }).itemsOnPage,
      ).toBeUndefined();
    });

    test("one bad field does not discard the good ones", () => {
      expect(
        TableViewUrlState.fromJSON({
          search: "api",
          page: "not a page" as unknown as number,
          itemsOnPage: -1,
          sortBy: "name",
          sortOrder: SortOrder.Descending,
        }),
      ).toEqual({
        search: "api",
        sortBy: "name",
        sortOrder: SortOrder.Descending,
      });
    });

    test("unknown keys are ignored entirely", () => {
      expect(
        TableViewUrlState.fromJSON({
          search: "api",
          somethingElse: "ignored",
        } as unknown as JSONObject),
      ).toEqual({ search: "api" });
    });
  });
});

describe("TableViewUrlState round trip", () => {
  test("survives toJSON -> JSON -> fromJSON unchanged", () => {
    const state: TableViewUrlStateData = {
      search: "api gateway",
      labels: ["label-1", "label-2"],
      sortBy: "name",
      sortOrder: SortOrder.Descending,
      page: 7,
      itemsOnPage: 50,
    };

    const json: JSONObject | null = TableViewUrlState.toJSON(state);

    expect(
      TableViewUrlState.fromJSON(JSON.parse(JSON.stringify(json))),
    ).toEqual(state);
  });
});
