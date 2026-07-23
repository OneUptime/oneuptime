import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Navigation from "../../../UI/Utils/Navigation";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TableFilterUrlState is what makes a filtered table survive "click a row,
 * press Back" and what makes the resulting URL shareable. The behaviours
 * pinned here are the ones a user would notice breaking:
 *
 *  - typed query values (Search / Includes / InBetween / the comparison
 *    operators) have to come back as real class instances, or the restored
 *    query silently means something different from the one the user built;
 *  - each table's state is namespaced, so several tables on one page keep
 *    their own filters;
 *  - a hand-edited or truncated param degrades to "no filters", never to a
 *    crash;
 *  - and the URL can't grow without bound.
 */

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

type ReadParamFunction = (name: string) => string | null;

const readParam: ReadParamFunction = (name: string): string | null => {
  return Navigation.getQueryStringByName(name);
};

type BuildIdsFunction = (count: number) => Array<string>;

const buildIds: BuildIdsFunction = (count: number): Array<string> => {
  const ids: Array<string> = [];
  for (let i: number = 0; i < count; i++) {
    ids.push(ObjectID.generate().toString());
  }
  return ids;
};

describe("TableFilterUrlState", () => {
  beforeEach(() => {
    setUrl("/dashboard/monitors");
    TableFilterUrlState.resetClaimedKeys();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("param naming", () => {
    test("namespaces each slice under the table id", () => {
      expect(TableFilterUrlState.getParamName("monitors-table", "filter")).toBe(
        "monitors-table-filter",
      );
      expect(TableFilterUrlState.getParamName("monitors-table", "facets")).toBe(
        "monitors-table-facets",
      );
      expect(TableFilterUrlState.getParamName("monitors-table", "view")).toBe(
        "monitors-table-view",
      );
    });

    test("lists every param a table can own", () => {
      expect(TableFilterUrlState.getAllParamNames("monitors-table")).toEqual([
        "monitors-table-filter",
        "monitors-table-facets",
        "monitors-table-view",
      ]);
    });
  });

  describe("read", () => {
    test("returns null when the table id is missing", () => {
      expect(TableFilterUrlState.read(undefined, "filter")).toBeNull();
      expect(TableFilterUrlState.read("", "filter")).toBeNull();
    });

    test("returns null when the param is absent", () => {
      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
    });

    test("returns null for an empty snapshot", () => {
      Navigation.setQueryString({ "monitors-table-filter": "{}" });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
    });

    test("returns null for an unparseable param instead of throwing", () => {
      Navigation.setQueryString({ "monitors-table-filter": "not json {{{" });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
    });

    test("does not read another table's param", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      expect(TableFilterUrlState.read("incidents-table", "filter")).toBeNull();
    });

    test("does not read another slice's param", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      expect(TableFilterUrlState.read("monitors-table", "view")).toBeNull();
      expect(TableFilterUrlState.read("monitors-table", "facets")).toBeNull();
    });
  });

  describe("write", () => {
    test("round-trips plain values", () => {
      TableFilterUrlState.write("monitors-table", "filter", {
        name: "api",
        disableActiveMonitoring: false,
        count: 12,
      });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toEqual({
        name: "api",
        disableActiveMonitoring: false,
        count: 12,
      });
    });

    test("removes the param when the state is null", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });
      expect(readParam("monitors-table-filter")).not.toBeNull();

      TableFilterUrlState.write("monitors-table", "filter", null);

      expect(readParam("monitors-table-filter")).toBeNull();
    });

    test("removes the param when the state has no keys", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      TableFilterUrlState.write("monitors-table", "filter", {});

      expect(readParam("monitors-table-filter")).toBeNull();
    });

    test("no-ops without a table id", () => {
      TableFilterUrlState.write(undefined, "filter", { name: "api" });

      expect(window.location.search).toBe("");
    });

    test("leaves params owned by anything else on the route alone", () => {
      Navigation.setQueryString({ tab: "overview", "var-region": "eu" });

      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      expect(readParam("tab")).toBe("overview");
      expect(readParam("var-region")).toBe("eu");
    });
  });

  describe("typed query values survive the round trip", () => {
    type RoundTripFunction = (state: JSONObject) => JSONObject | null;

    const roundTrip: RoundTripFunction = (
      state: JSONObject,
    ): JSONObject | null => {
      TableFilterUrlState.write("monitors-table", "filter", state);
      return TableFilterUrlState.read("monitors-table", "filter");
    };

    test("Search comes back as a Search", () => {
      const restored: JSONObject | null = roundTrip({
        name: new Search("api gateway"),
      });

      expect(restored?.["name"]).toBeInstanceOf(Search);
      expect((restored?.["name"] as Search<string>).toString()).toBe(
        "api gateway",
      );
    });

    test("Includes comes back as an Includes with its ids", () => {
      const ids: Array<string> = [
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ];

      const restored: JSONObject | null = roundTrip({
        labels: new Includes(ids),
      });

      expect(restored?.["labels"]).toBeInstanceOf(Includes);
      expect(
        (restored?.["labels"] as Includes).values.map((v: unknown) => {
          return v!.toString();
        }),
      ).toEqual(ids);
    });

    test("IncludesNone (the entity 'is not' encoding) comes back intact", () => {
      const restored: JSONObject | null = roundTrip({
        projectId: new IncludesNone(["abc"]),
      });

      expect(restored?.["projectId"]).toBeInstanceOf(IncludesNone);
    });

    test("InBetween keeps both bounds at full precision", () => {
      const start: string = "2026-04-22T00:30:00.000Z";
      const end: string = "2026-07-21T14:35:12.345Z";

      const restored: JSONObject | null = roundTrip({
        createdAt: new InBetween(new Date(start), new Date(end)),
      });

      expect(restored?.["createdAt"]).toBeInstanceOf(InBetween);
      expect(
        (restored?.["createdAt"] as InBetween<Date>).toStartValueString(),
      ).toBe(start);
      expect(
        (restored?.["createdAt"] as InBetween<Date>).toEndValueString(),
      ).toBe(end);
    });

    test("EqualTo keeps a number a number", () => {
      const restored: JSONObject | null = roundTrip({
        priority: new EqualTo(42),
      });

      expect(restored?.["priority"]).toBeInstanceOf(EqualTo);
      expect((restored?.["priority"] as EqualTo<number>).value).toBe(42);
    });

    test("NotEqual keeps a Date at full ISO precision, not a locale string", () => {
      const iso: string = "2026-07-01T12:34:56.789Z";

      const restored: JSONObject | null = roundTrip({
        createdAt: new NotEqual(new Date(iso)),
      });

      expect(restored?.["createdAt"]).toBeInstanceOf(NotEqual);
      expect((restored?.["createdAt"] as NotEqual<Date>).toString()).toBe(iso);
    });

    test("IsNull / NotNull come back as operators, not empty objects", () => {
      const restored: JSONObject | null = roundTrip({
        deletedAt: new IsNull(),
        createdAt: new NotNull(),
      });

      expect(restored?.["deletedAt"]).toBeInstanceOf(IsNull);
      expect(restored?.["createdAt"]).toBeInstanceOf(NotNull);
    });

    test("a Date value comes back as a Date", () => {
      const iso: string = "2026-07-01T12:34:56.789Z";

      const restored: JSONObject | null = roundTrip({
        createdAt: new Date(iso),
      });

      expect(restored?.["createdAt"]).toBeInstanceOf(Date);
      expect((restored?.["createdAt"] as Date).toISOString()).toBe(iso);
    });

    test("a mixed snapshot round-trips every value at once", () => {
      const restored: JSONObject | null = roundTrip({
        name: new Search("api"),
        labels: new Includes(["a", "b"]),
        disableActiveMonitoring: false,
        createdAt: new InBetween(
          new Date("2026-01-01T00:00:00.000Z"),
          new Date("2026-02-01T00:00:00.000Z"),
        ),
      });

      expect(restored?.["name"]).toBeInstanceOf(Search);
      expect(restored?.["labels"]).toBeInstanceOf(Includes);
      expect(restored?.["disableActiveMonitoring"]).toBe(false);
      expect(restored?.["createdAt"]).toBeInstanceOf(InBetween);
    });
  });

  describe("several tables on one page", () => {
    test("each table keeps its own filters", () => {
      TableFilterUrlState.write("monitors-table", "filter", {
        name: new Search("api"),
      });
      TableFilterUrlState.write("incidents-table", "filter", {
        title: new Search("outage"),
      });

      expect(
        (
          TableFilterUrlState.read("monitors-table", "filter")?.[
            "name"
          ] as Search<string>
        ).toString(),
      ).toBe("api");
      expect(
        (
          TableFilterUrlState.read("incidents-table", "filter")?.[
            "title"
          ] as Search<string>
        ).toString(),
      ).toBe("outage");
    });

    test("clearing one table leaves the others untouched", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });
      TableFilterUrlState.write("incidents-table", "filter", {
        title: "outage",
      });

      TableFilterUrlState.clear("monitors-table");

      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
      expect(TableFilterUrlState.read("incidents-table", "filter")).toEqual({
        title: "outage",
      });
    });

    test("all three slices of one table can coexist with another table's", () => {
      TableFilterUrlState.writeMany("monitors-table", {
        filter: { name: "api" },
        view: { page: 3 },
        facets: { selectedLabelIds: ["a"] },
      });
      TableFilterUrlState.write("incidents-table", "view", { page: 7 });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toEqual({
        name: "api",
      });
      expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
        page: 3,
      });
      expect(TableFilterUrlState.read("monitors-table", "facets")).toEqual({
        selectedLabelIds: ["a"],
      });
      expect(TableFilterUrlState.read("incidents-table", "view")).toEqual({
        page: 7,
      });
    });
  });

  describe("writeMany", () => {
    test("applies every slice in a single history write", () => {
      const replaceState: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window.history,
        "replaceState",
      );

      TableFilterUrlState.writeMany("monitors-table", {
        filter: { name: "api" },
        view: { page: 2 },
      });

      expect(replaceState).toHaveBeenCalledTimes(1);
    });

    test("leaves a slice that wasn't passed alone", () => {
      TableFilterUrlState.write("monitors-table", "facets", {
        selectedLabelIds: ["a"],
      });

      TableFilterUrlState.writeMany("monitors-table", {
        filter: { name: "api" },
      });

      expect(TableFilterUrlState.read("monitors-table", "facets")).toEqual({
        selectedLabelIds: ["a"],
      });
    });

    test("removes only the slices explicitly cleared", () => {
      TableFilterUrlState.writeMany("monitors-table", {
        filter: { name: "api" },
        view: { page: 2 },
      });

      TableFilterUrlState.writeMany("monitors-table", {
        filter: null,
      });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
      expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
        page: 2,
      });
    });
  });

  describe("URL size guard", () => {
    type OversizedFilterFunction = () => JSONObject;

    const oversizedFilter: OversizedFilterFunction = (): JSONObject => {
      return { labels: new Includes(buildIds(400)) };
    };

    test("skips a slice that would blow past the length cap", () => {
      TableFilterUrlState.write("monitors-table", "filter", oversizedFilter());

      expect(readParam("monitors-table-filter")).toBeNull();
    });

    test("drops the stale param rather than leaving it describing an older view", () => {
      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      TableFilterUrlState.write("monitors-table", "filter", oversizedFilter());

      /*
       * The table keeps working from React state; only the link stops
       * describing it. Leaving the previous param behind would be worse than
       * removing it — a refresh would silently restore a *different*, older
       * filter set than the one on screen.
       */
      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
    });

    test("an oversized slice does not take its siblings down with it", () => {
      TableFilterUrlState.writeMany("monitors-table", {
        filter: oversizedFilter(),
        view: { page: 4 },
      });

      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
      expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
        page: 4,
      });
    });

    test("counts the other slices in the same batch toward the cap", () => {
      /*
       * Two slices that each fit on their own but not together: the second one
       * has to be dropped, otherwise the batch commits a query string over the
       * limit.
       */
      const half: JSONObject = { labels: new Includes(buildIds(60)) };

      TableFilterUrlState.writeMany("monitors-table", {
        filter: half,
        facets: { selectedLabelIds: buildIds(60) },
      });

      const query: string = new URLSearchParams(
        window.location.search,
      ).toString();

      expect(query.length).toBeLessThanOrEqual(
        TableFilterUrlState.MaxQueryStringLength,
      );
    });

    test("never writes a query string longer than the cap", () => {
      TableFilterUrlState.writeMany("monitors-table", {
        filter: oversizedFilter(),
        view: { page: 2 },
        facets: { selectedLabelIds: buildIds(300) },
      });

      expect(window.location.search.length).toBeLessThanOrEqual(
        TableFilterUrlState.MaxQueryStringLength + 1,
      );
    });
  });

  describe("claimKey", () => {
    test("stays quiet for a single table", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      TableFilterUrlState.claimKey("monitors-table");

      expect(warn).not.toHaveBeenCalled();
    });

    test("warns when two mounted tables share one namespace", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      TableFilterUrlState.claimKey("monitors-table");
      TableFilterUrlState.claimKey("monitors-table");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("monitors-table");
    });

    test("releasing frees the namespace for the next mount", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const release: () => void = TableFilterUrlState.claimKey(
        "monitors-table",
      ) as () => void;
      release();
      TableFilterUrlState.claimKey("monitors-table");

      expect(warn).not.toHaveBeenCalled();
    });

    test("different keys never collide", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      TableFilterUrlState.claimKey("monitors-table");
      TableFilterUrlState.claimKey("incidents-table");

      expect(warn).not.toHaveBeenCalled();
    });

    test("an undefined key is not claimed at all", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      TableFilterUrlState.claimKey(undefined);
      TableFilterUrlState.claimKey(undefined);

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
