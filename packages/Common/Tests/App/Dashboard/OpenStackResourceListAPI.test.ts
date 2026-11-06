import { describe, expect, test } from "@jest/globals";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  getOpenStackListSeekSort,
  isOpenStackListSeek,
  toOpenStackListSeekValue,
} from "../../../Types/OpenStack/OpenStackListSeek";
import { OpenStackListPages } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceListAPI";

/*
 * What a list remembers of where each page ended, and what it asks the server for because of that.
 * What the server does with it is OpenStackScalePostgres's.
 */

const ID_A: string = "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID_B: string = "7c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("how a list moves from page to page", () => {
  const SORT: Record<string, unknown> = { name: SortOrder.Ascending };
  const SORT_WITH_TIE: Record<string, unknown> = {
    name: SortOrder.Ascending,
    _id: SortOrder.Ascending,
  };
  const QUERY: Record<string, unknown> = { kind: "Instance" };

  function afterFirstPage(): OpenStackListPages {
    const pages: OpenStackListPages = new OpenStackListPages();

    pages.remember({
      query: QUERY,
      sort: SORT_WITH_TIE,
      limit: 10,
      skip: 0,
      rows: [
        { _id: ID_A, name: "a" },
        { _id: ID_B, name: "b" },
      ],
      count: 200000,
    });

    return pages;
  }

  test("the first page goes by offset, in an order that breaks ties", () => {
    expect(
      new OpenStackListPages().plan({
        query: QUERY,
        sort: SORT,
        limit: 10,
        skip: 0,
      }),
    ).toEqual({ sort: SORT_WITH_TIE });
  });

  test("the page after one it has read goes from that page's last row, and asks for no count", () => {
    expect(
      afterFirstPage().plan({ query: QUERY, sort: SORT, limit: 10, skip: 2 }),
    ).toEqual({
      sort: SORT_WITH_TIE,
      seek: { column: "name", value: "b", id: ID_B, count: 200000 },
    });
  });

  test("a page nobody has been through goes by offset", () => {
    expect(
      afterFirstPage().plan({ query: QUERY, sort: SORT, limit: 10, skip: 500 }),
    ).toEqual({ sort: SORT_WITH_TIE });
  });

  test("another filter, another sort or another page size starts again", () => {
    const pages: OpenStackListPages = afterFirstPage();

    for (const other of [
      { query: { kind: "Volume" }, sort: SORT, limit: 10 },
      { query: QUERY, sort: { name: SortOrder.Descending }, limit: 10 },
      { query: QUERY, sort: SORT, limit: 25 },
    ]) {
      expect(pages.plan({ ...other, skip: 2 }).seek).toBeUndefined();
    }
  });

  test("a filter on the sorted column is left to the offset", () => {
    const query: Record<string, unknown> = { kind: "Instance", name: "web-" };

    expect(
      new OpenStackListPages().plan({
        query,
        sort: SORT,
        limit: 10,
        skip: 10,
      }),
    ).toEqual({ sort: SORT });
  });

  test("a list sorted by nothing, or by several things, is left as it asked", () => {
    const pages: OpenStackListPages = new OpenStackListPages();

    expect(pages.plan({ query: QUERY, sort: {}, limit: 10, skip: 10 })).toEqual(
      { sort: {} },
    );

    const several: Record<string, unknown> = {
      name: SortOrder.Ascending,
      status: SortOrder.Ascending,
    };

    expect(
      pages.plan({ query: QUERY, sort: several, limit: 10, skip: 10 }),
    ).toEqual({ sort: several });
  });

  test("a row with nothing in the column ends a page like any other", () => {
    const pages: OpenStackListPages = new OpenStackListPages();

    pages.remember({
      query: QUERY,
      sort: SORT_WITH_TIE,
      limit: 1,
      skip: 0,
      rows: [{ _id: ID_A }],
      count: 2,
    });

    expect(
      pages.plan({ query: QUERY, sort: SORT, limit: 1, skip: 1 }).seek,
    ).toEqual({ column: "name", value: null, id: ID_A, count: 2 });
  });

  test("a value it cannot say goes by offset next time, and an empty page says nothing", () => {
    const pages: OpenStackListPages = new OpenStackListPages();

    pages.remember({
      query: QUERY,
      sort: SORT_WITH_TIE,
      limit: 10,
      skip: 0,
      rows: [{ _id: ID_A, name: { something: "else" } }],
      count: 1,
    });
    pages.remember({
      query: QUERY,
      sort: SORT_WITH_TIE,
      limit: 10,
      skip: 10,
      rows: [],
      count: 1,
    });

    expect(
      pages.plan({ query: QUERY, sort: SORT, limit: 10, skip: 1 }).seek,
    ).toBeUndefined();
    expect(
      pages.plan({ query: QUERY, sort: SORT, limit: 10, skip: 10 }).seek,
    ).toBeUndefined();
  });

  test("it remembers a few lists and no more", () => {
    const pages: OpenStackListPages = new OpenStackListPages();
    const rememberList: (index: number) => void = (index: number): void => {
      pages.remember({
        query: { kind: `kind-${index}` },
        sort: SORT_WITH_TIE,
        limit: 10,
        skip: 0,
        rows: [{ _id: ID_A, name: "a" }],
        count: 1,
      });
    };

    for (let index: number = 0; index < 40; index++) {
      rememberList(index);
    }

    expect(
      pages.plan({
        query: { kind: "kind-0" },
        sort: SORT,
        limit: 10,
        skip: 1,
      }).seek,
    ).toBeUndefined();
    expect(
      pages.plan({
        query: { kind: "kind-39" },
        sort: SORT,
        limit: 10,
        skip: 1,
      }).seek,
    ).toBeDefined();
  });
});

describe("what can be sought", () => {
  test("a date goes as text, a number and text as they are, nothing as nothing", () => {
    expect(toOpenStackListSeekValue(new Date(0))).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(toOpenStackListSeekValue(5)).toBe(5);
    expect(toOpenStackListSeekValue("a")).toBe("a");
    expect(toOpenStackListSeekValue(null)).toBeNull();
    expect(toOpenStackListSeekValue(undefined)).toBeNull();
    expect(toOpenStackListSeekValue({ a: 1 })).toBeUndefined();
  });

  test("one column, however it breaks ties", () => {
    expect(getOpenStackListSeekSort({ name: SortOrder.Descending })).toEqual({
      column: "name",
      order: SortOrder.Descending,
    });
    expect(
      getOpenStackListSeekSort({
        name: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      }),
    ).toEqual({ column: "name", order: SortOrder.Ascending });
    expect(getOpenStackListSeekSort({})).toBeNull();
    expect(
      getOpenStackListSeekSort({
        name: SortOrder.Ascending,
        status: SortOrder.Ascending,
      }),
    ).toBeNull();
    expect(getOpenStackListSeekSort({ name: "sideways" })).toBeNull();
  });

  test("a server reads only a seek of the right shape", () => {
    const seek: Record<string, unknown> = {
      column: "name",
      value: "a",
      id: ID_A,
      count: 3,
    };

    expect(isOpenStackListSeek(seek)).toBe(true);
    expect(isOpenStackListSeek({ ...seek, value: null })).toBe(true);
    expect(isOpenStackListSeek({ ...seek, value: { $ne: 1 } })).toBe(false);
    expect(isOpenStackListSeek({ ...seek, count: -1 })).toBe(false);
    expect(isOpenStackListSeek({ ...seek, id: 7 })).toBe(false);
    expect(isOpenStackListSeek(undefined)).toBe(false);
    expect(isOpenStackListSeek("name")).toBe(false);
  });
});
