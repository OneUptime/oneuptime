import buildQueryFromFilterData, {
  getFilterKeys,
  renameFilterDataKeys,
  sanitizeFilterData,
} from "../../../../UI/Components/ModelTable/FilterDataToQuery";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import Query from "../../../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../../../Types/Date";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import { describe, expect, test } from "@jest/globals";

/*
 * `buildQueryFromFilterData` is what turns the filter popup's selections into
 * the query the table fetches with. It lives outside the component so the
 * table can derive its query *synchronously during the first render* when
 * filters come back from the URL — without that, the first request would go
 * out unfiltered and be immediately superseded, flashing the wrong rows.
 *
 * `sanitizeFilterData` is the trust boundary for that same path: the snapshot
 * arrives from a query string anyone can edit.
 */

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
  {
    title: "Description",
    type: FieldType.Text,
    field: { description: true },
  },
  {
    title: "Monitoring disabled",
    type: FieldType.Boolean,
    field: { disableActiveMonitoring: true },
  },
  { title: "Created", type: FieldType.Date, field: { createdAt: true } },
  { title: "Labels", type: FieldType.EntityArray, field: { labels: true } },
  {
    title: "Custom fields",
    type: FieldType.JSON,
    field: { customFields: true },
  },
] as unknown as Array<Filter<Monitor>>;

type BuildFunction = (filterData: FilterData<Monitor>) => Query<Monitor>;

const build: BuildFunction = (
  filterData: FilterData<Monitor>,
): Query<Monitor> => {
  return buildQueryFromFilterData<Monitor>({
    filterData: filterData,
    filters: FILTERS,
  });
};

describe("getFilterKeys", () => {
  test("returns the model field behind each declared filter", () => {
    expect(getFilterKeys<Monitor>(FILTERS)).toEqual([
      "name",
      "description",
      "disableActiveMonitoring",
      "createdAt",
      "labels",
      "customFields",
    ]);
  });

  test("tolerates an empty or missing filter list", () => {
    expect(getFilterKeys<Monitor>([])).toEqual([]);
    expect(
      getFilterKeys<Monitor>(undefined as unknown as Array<Filter<Monitor>>),
    ).toEqual([]);
  });
});

describe("buildQueryFromFilterData", () => {
  test("returns an empty query for no filters", () => {
    expect(build({})).toEqual({});
  });

  test("passes a text value through", () => {
    expect(build({ name: "api" } as FilterData<Monitor>)).toEqual({
      name: "api",
    });
  });

  test("keeps a false boolean — it is a real constraint, not an absent one", () => {
    expect(
      build({
        disableActiveMonitoring: false,
      } as unknown as FilterData<Monitor>),
    ).toEqual({ disableActiveMonitoring: false });
  });

  test("keeps a zero number", () => {
    const query: Query<Monitor> = build({
      name: 0,
    } as unknown as FilterData<Monitor>);

    expect(query).toEqual({ name: 0 });
  });

  test("passes a Date through unchanged", () => {
    const date: Date = new Date("2026-07-01T12:34:56.789Z");

    expect(
      build({ createdAt: date } as unknown as FilterData<Monitor>)["createdAt"],
    ).toBe(date);
  });

  test("passes a Search through unchanged", () => {
    const search: Search<string> = new Search("api");

    expect(
      build({ name: search } as unknown as FilterData<Monitor>)["name"],
    ).toBe(search);
  });

  /*
   * A date filter's range is sent as the whole days it names (#7719): one
   * already on its days' bounds, as the filter builds it, goes through as
   * it is.
   */
  test("passes an InBetween of whole days through unchanged", () => {
    const range: InBetween<Date> = new InBetween(
      OneUptimeDate.getStartOfDay(new Date("2026-01-01T12:00:00.000Z")),
      OneUptimeDate.getEndOfDay(new Date("2026-02-01T12:00:00.000Z")),
    );

    expect(
      build({ createdAt: range } as unknown as FilterData<Monitor>)[
        "createdAt"
      ],
    ).toBe(range);
  });

  test("sends a date filter's InBetween that ends at its last day's start as the whole of that day", () => {
    const range: InBetween<Date> = new InBetween(
      OneUptimeDate.getStartOfDay(new Date("2026-01-01T12:00:00.000Z")),
      OneUptimeDate.getStartOfDay(new Date("2026-02-01T12:00:00.000Z")),
    );

    const sent: InBetween<Date> = build({
      createdAt: range,
    } as unknown as FilterData<Monitor>)["createdAt"] as InBetween<Date>;

    expect(sent).toBeInstanceOf(InBetween);
    expect(new Date(sent.endValue).getTime()).toBe(
      OneUptimeDate.getEndOfDay(new Date("2026-02-01T12:00:00.000Z")).getTime(),
    );
  });

  describe("a date and time filter (#7719)", () => {
    const DATE_TIME_FILTERS: Array<Filter<Monitor>> = [
      {
        title: "Updated",
        type: FieldType.DateTime,
        field: { updatedAt: true },
      },
      { title: "Name", type: FieldType.Text, field: { name: true } },
    ] as unknown as Array<Filter<Monitor>>;

    function buildDateTime(filterData: FilterData<Monitor>): Query<Monitor> {
      return buildQueryFromFilterData<Monitor>({
        filterData: filterData,
        filters: DATE_TIME_FILTERS,
      });
    }

    test("an old saved view's Is, an EqualTo on the instant, is sent as its whole minute", () => {
      const sent: InBetween<Date> = buildDateTime({
        updatedAt: new EqualTo(new Date("2026-11-13T11:15:00.000Z")),
      } as unknown as FilterData<Monitor>)["updatedAt"] as InBetween<Date>;

      expect(sent).toBeInstanceOf(InBetween);
      expect(new Date(sent.startValue).toISOString()).toBe(
        "2026-11-13T11:15:00.000Z",
      );
      expect(new Date(sent.endValue).toISOString()).toBe(
        "2026-11-13T11:15:59.999Z",
      );
    });

    test("an old After on a minute's first second is sent as after the whole minute", () => {
      const sent: GreaterThan<Date> = buildDateTime({
        updatedAt: new GreaterThan(new Date("2026-11-13T11:15:00.000Z")),
      } as unknown as FilterData<Monitor>)["updatedAt"] as GreaterThan<Date>;

      expect(new Date(sent.value).toISOString()).toBe(
        "2026-11-13T11:15:59.999Z",
      );
    });

    test("a value the filter built goes through as it is", () => {
      const range: InBetween<Date> = new InBetween(
        new Date("2026-11-13T09:00:00.000Z"),
        new Date("2026-11-13T17:30:59.999Z"),
      );

      expect(
        buildDateTime({ updatedAt: range } as unknown as FilterData<Monitor>)[
          "updatedAt"
        ],
      ).toBe(range);
    });

    test("an EqualTo on a filter that is not a date's is left alone", () => {
      const value: EqualTo<string> = new EqualTo("api");

      expect(
        buildDateTime({ name: value } as unknown as FilterData<Monitor>)[
          "name"
        ],
      ).toBe(value);
    });
  });

  test("wraps a bare array into an Includes", () => {
    const query: Query<Monitor> = build({
      labels: ["a", "b"],
    } as unknown as FilterData<Monitor>);

    expect(query["labels"]).toBeInstanceOf(Includes);
    expect((query["labels"] as Includes).values).toEqual(["a", "b"]);
  });

  test("passes any QueryOperator through as-is", () => {
    const operators: Record<string, unknown> = {
      includesNone: new IncludesNone(["a"]),
      isNull: new IsNull(),
      notEqual: new NotEqual("api"),
    };

    for (const operator of Object.values(operators)) {
      expect(
        build({ name: operator } as unknown as FilterData<Monitor>)["name"],
      ).toBe(operator);
    }
  });

  test("passes a plain object through only for a JSON-typed filter", () => {
    const value: Record<string, string> = { team: "platform" };

    expect(
      build({ customFields: value } as unknown as FilterData<Monitor>)[
        "customFields"
      ],
    ).toBe(value);
  });

  test("drops a plain object on a non-JSON filter", () => {
    expect(
      build({ name: { nope: true } } as unknown as FilterData<Monitor>),
    ).toEqual({});
  });

  test("drops an empty string — an empty text box is not a filter", () => {
    expect(build({ name: "" } as unknown as FilterData<Monitor>)).toEqual({});
  });

  test("builds every kind of value in one pass", () => {
    const query: Query<Monitor> = build({
      name: new Search("api"),
      disableActiveMonitoring: false,
      labels: ["a"],
    } as unknown as FilterData<Monitor>);

    expect(query["name"]).toBeInstanceOf(Search);
    expect(query["disableActiveMonitoring"]).toBe(false);
    expect(query["labels"]).toBeInstanceOf(Includes);
  });
});

describe("sanitizeFilterData", () => {
  type SanitizeFunction = (
    filterData: FilterData<Monitor>,
  ) => FilterData<Monitor>;

  const sanitize: SanitizeFunction = (
    filterData: FilterData<Monitor>,
  ): FilterData<Monitor> => {
    return sanitizeFilterData<Monitor>({
      filterData: filterData,
      filters: FILTERS,
    });
  };

  test("keeps every field the table declares a filter for", () => {
    expect(
      sanitize({ name: "api", description: "prod" } as FilterData<Monitor>),
    ).toEqual({ name: "api", description: "prod" });
  });

  test("drops a field the table does not expose a filter for", () => {
    /*
     * The restored filter is spread into the outgoing list query, so an
     * undeclared key in a hand-edited link would otherwise become a real
     * constraint the filter UI could never have produced.
     */
    expect(
      sanitize({
        name: "api",
        projectId: "somebody-elses-project",
      } as unknown as FilterData<Monitor>),
    ).toEqual({ name: "api" });
  });

  test("drops a key that tries to re-scope the page's own query", () => {
    expect(
      sanitize({
        monitorId: "another-monitor",
        _id: "specific-row",
      } as unknown as FilterData<Monitor>),
    ).toEqual({});
  });

  test("drops null and undefined values", () => {
    expect(
      sanitize({
        name: "api",
        description: undefined,
        createdAt: null,
      } as unknown as FilterData<Monitor>),
    ).toEqual({ name: "api" });
  });

  test("keeps a false boolean", () => {
    expect(
      sanitize({
        disableActiveMonitoring: false,
      } as unknown as FilterData<Monitor>),
    ).toEqual({ disableActiveMonitoring: false });
  });

  test("keeps typed operator instances intact", () => {
    const search: Search<string> = new Search("api");

    expect(
      sanitize({ name: search } as unknown as FilterData<Monitor>)["name"],
    ).toBe(search);
  });

  test("returns an empty object when the table declares no filters at all", () => {
    expect(
      sanitizeFilterData<Monitor>({
        filterData: { name: "api" } as FilterData<Monitor>,
        filters: [],
      }),
    ).toEqual({});
  });

  test("tolerates an empty snapshot", () => {
    expect(sanitize({})).toEqual({});
    expect(sanitize(undefined as unknown as FilterData<Monitor>)).toEqual({});
  });
});

/*
 * `renameFilterDataKeys`: a snapshot made when a table keyed a filter by
 * another field - a link someone shared, a bookmark - still filters by what
 * it said, read under the key the table uses now (#9363: the Devices list's
 * Vendor filter moved from `vendor` to `manufacturer`).
 */
describe("renameFilterDataKeys", () => {
  type RenameFunction = (
    filterData: FilterData<Monitor>,
    renamedKeys?: Record<string, string>,
  ) => FilterData<Monitor>;

  const rename: RenameFunction = (
    filterData: FilterData<Monitor>,
    renamedKeys?: Record<string, string>,
  ): FilterData<Monitor> => {
    return renameFilterDataKeys<Monitor>({
      filterData: filterData,
      renamedKeys: renamedKeys,
    });
  };

  test("reads an old key under its new name, with its value as it was", () => {
    const search: Search<string> = new Search("api");

    const renamed: FilterData<Monitor> = rename(
      { title: search } as unknown as FilterData<Monitor>,
      { title: "name" },
    );

    expect(renamed).toEqual({ name: search });
    expect(renamed["name" as keyof FilterData<Monitor>]).toBe(search);
  });

  test("so the table's own sanitizing keeps it, and the query filters by it", () => {
    const search: Search<string> = new Search("api");

    expect(
      build(
        sanitizeFilterData<Monitor>({
          filterData: rename(
            { title: search } as unknown as FilterData<Monitor>,
            { title: "name" },
          ),
          filters: FILTERS,
        }),
      ),
    ).toEqual({ name: search });
  });

  test("a snapshot that already names the new key keeps the new key's value", () => {
    const old: Search<string> = new Search("old");
    const current: Search<string> = new Search("current");

    expect(
      rename({ title: old, name: current } as unknown as FilterData<Monitor>, {
        title: "name",
      }),
    ).toEqual({ name: current });
    expect(
      rename({ name: current, title: old } as unknown as FilterData<Monitor>, {
        title: "name",
      }),
    ).toEqual({ name: current });
  });

  test("keys it does not rename are left as they are", () => {
    expect(
      rename(
        {
          name: "api",
          disableActiveMonitoring: false,
        } as unknown as FilterData<Monitor>,
        { title: "name" },
      ),
    ).toEqual({ name: "api", disableActiveMonitoring: false });
  });

  test("no renames, or an empty snapshot, change nothing", () => {
    expect(rename({ name: "api" } as unknown as FilterData<Monitor>)).toEqual({
      name: "api",
    });
    expect(rename({}, { title: "name" })).toEqual({});
    expect(
      rename(undefined as unknown as FilterData<Monitor>, { title: "name" }),
    ).toEqual({});
  });

  test("a key that only shares a name with an object's own property is not renamed", () => {
    expect(
      rename({ toString: "x" } as unknown as FilterData<Monitor>, {
        title: "name",
      }),
    ).toEqual({ toString: "x" });
  });
});
