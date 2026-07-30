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
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
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
 *  - a link built elsewhere in the product (a summary count whose rows live on
 *    another page) lands that page in the state it names;
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

    /*
     * The link builder and the reader have to agree on the param name or a
     * "show me these rows" link silently lands on an unfiltered table. This is
     * the one place naming is pinned, so keep the writer in it.
     */
    test("the names getLinkQueryParams writes are the names read looks up", () => {
      const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
        "monitors-table",
        {
          filter: { name: "api" },
          facets: { selectedLabelIds: ["a"] },
          view: { page: 2 },
        },
      );

      expect(Object.keys(params).sort()).toEqual(
        [...TableFilterUrlState.getAllParamNames("monitors-table")].sort(),
      );
      expect(Object.keys(params)).toContain(
        TableFilterUrlState.getParamName("monitors-table", "facets"),
      );
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

  describe("serializeState", () => {
    type BuildCircularStateFunction = () => JSONObject;

    /*
     * Filter data never looks like this, but a caller passing a React object
     * with a back-reference by accident must not take the table down with it.
     */
    const buildCircularState: BuildCircularStateFunction = (): JSONObject => {
      const state: JSONObject = { name: "api" };
      state["self"] = state;
      return state;
    };

    /*
     * "Nothing to write" and "could not write" have to be indistinguishable to
     * a caller, because both mean "put no param on the URL". read() treats a
     * missing param and an object with no keys the same way, so an object with
     * no keys must never reach the URL as a param either.
     */
    test("returns null for every flavour of empty", () => {
      expect(TableFilterUrlState.serializeState(null)).toBeNull();
      expect(TableFilterUrlState.serializeState(undefined)).toBeNull();
      expect(TableFilterUrlState.serializeState({})).toBeNull();
    });

    test("returns a JSON string for a plain object", () => {
      const serialized: string | null = TableFilterUrlState.serializeState({
        name: "api",
        disableActiveMonitoring: false,
        count: 12,
      });

      expect(typeof serialized).toBe("string");
      expect(JSON.parse(serialized as string)).toEqual({
        name: "api",
        disableActiveMonitoring: false,
        count: 12,
      });
    });

    /*
     * Serialization goes through JSONFunctions rather than plain stringify for
     * exactly one reason: type fidelity. A bare JSON.stringify would flatten an
     * Includes to `{}` and the restored query would mean "no constraint"
     * instead of "one of these ids" — a table showing every row instead of
     * three.
     */
    test("keeps typed query values recoverable as class instances", () => {
      const ids: Array<string> = buildIds(2);

      const serialized: string | null = TableFilterUrlState.serializeState({
        name: new Search("api gateway"),
        labels: new Includes(ids),
        deletedAt: new IsNull(),
      });

      expect(serialized).not.toBeNull();

      const restored: JSONObject = JSONFunctions.deserialize(
        JSONFunctions.parseJSONObject(serialized as string),
      );

      expect(restored["name"]).toBeInstanceOf(Search);
      expect((restored["name"] as Search<string>).toString()).toBe(
        "api gateway",
      );
      expect(restored["labels"]).toBeInstanceOf(Includes);
      expect(
        (restored["labels"] as Includes).values.map((v: unknown) => {
          return v!.toString();
        }),
      ).toEqual(ids);
      expect(restored["deletedAt"]).toBeInstanceOf(IsNull);
    });

    test("returns null and warns instead of throwing on state it cannot serialize", () => {
      const warn: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      expect(
        TableFilterUrlState.serializeState(buildCircularState()),
      ).toBeNull();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "could not serialize state",
      );
    });

    /*
     * write/writeMany share this serializer, so a slice that will not
     * serialize has to drop its param rather than leave the previous one behind
     * describing an older view.
     */
    test("a slice that will not serialize drops its param instead of going stale", () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});

      TableFilterUrlState.write("monitors-table", "filter", { name: "api" });

      TableFilterUrlState.write(
        "monitors-table",
        "filter",
        buildCircularState(),
      );

      expect(readParam("monitors-table-filter")).toBeNull();
      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
    });
  });

  describe("getLinkQueryParams", () => {
    type NavigateWithFunction = (params: Dictionary<string>) => void;

    /*
     * What Route.addQueryParams plus a real navigation do with these params:
     * the values are concatenated into the route exactly as handed over.
     */
    const navigateWith: NavigateWithFunction = (
      params: Dictionary<string>,
    ): void => {
      const query: string = Object.keys(params)
        .map((name: string): string => {
          return `${name}=${params[name]!}`;
        })
        .join("&");

      setUrl(`/dashboard/monitors?${query}`);
    };

    test("names each param under the table id and slice", () => {
      const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
        "monitors-table",
        { facets: { selectedLabelIds: ["a"] } },
      );

      expect(Object.keys(params)).toEqual(["monitors-table-facets"]);
    });

    /*
     * Route.addQueryParams pastes values into the route verbatim while read()
     * pulls them back out of URLSearchParams, which decodes. Serialized state
     * is JSON — full of `{`, `"` and, in any search text, `&` — so an
     * unencoded value would truncate at the first `&` and arrive as a param the
     * reader cannot parse: a link that lands on an unfiltered table.
     */
    test("percent-encodes the value so the reader gets back what was written", () => {
      const state: JSONObject = { name: new Search("api & gateway") };

      const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
        "monitors-table",
        { facets: state },
      );

      const value: string = params["monitors-table-facets"]!;

      expect(value).not.toContain("{");
      expect(value).not.toContain('"');
      expect(value).not.toContain("&");
      expect(value).toContain("%7B");
      expect(decodeURIComponent(value)).toBe(
        TableFilterUrlState.serializeState(state),
      );
    });

    /*
     * An empty slice has to vanish, not become `monitors-table-facets=`. The
     * absence of the param is already how read() spells "no state", and an
     * empty one would ride along in every bookmark claiming the link carries
     * state it does not.
     */
    test("omits empty slices entirely", () => {
      const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
        "monitors-table",
        { filter: { name: "api" }, facets: null, view: {} },
      );

      expect(Object.keys(params)).toEqual(["monitors-table-filter"]);
      expect(params["monitors-table-facets"]).toBeUndefined();
      expect(params["monitors-table-view"]).toBeUndefined();
    });

    test("carries several slices in one link", () => {
      const filter: JSONObject = { name: new Search("api") };
      const facets: JSONObject = { selectedLabelIds: ["a", "b"] };
      const view: JSONObject = { page: 3 };

      const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
        "monitors-table",
        { filter, facets, view },
      );

      expect(decodeURIComponent(params["monitors-table-filter"]!)).toBe(
        TableFilterUrlState.serializeState(filter),
      );
      expect(decodeURIComponent(params["monitors-table-facets"]!)).toBe(
        TableFilterUrlState.serializeState(facets),
      );
      expect(decodeURIComponent(params["monitors-table-view"]!)).toBe(
        TableFilterUrlState.serializeState(view),
      );
    });

    test("asked for nothing, adds nothing to the link", () => {
      expect(
        TableFilterUrlState.getLinkQueryParams("monitors-table", {}),
      ).toEqual({});
    });

    /*
     * The property the whole feature rests on: a summary tile builds a link,
     * the browser follows it, and the target table mounts already in that
     * state — chip set, values typed, nothing lost to the URL round trip.
     */
    test("a link built from these params lands the table in that state", () => {
      const ids: Array<string> = buildIds(2);
      const state: JSONObject = {
        name: new Search("api & gateway"),
        labels: new Includes(ids),
        deletedAt: new IsNull(),
      };

      navigateWith(
        TableFilterUrlState.getLinkQueryParams("monitors-table", {
          facets: state,
        }),
      );

      const restored: JSONObject | null = TableFilterUrlState.read(
        "monitors-table",
        "facets",
      );

      expect(restored?.["name"]).toBeInstanceOf(Search);
      expect((restored?.["name"] as Search<string>).toString()).toBe(
        "api & gateway",
      );
      expect(restored?.["labels"]).toBeInstanceOf(Includes);
      expect(
        (restored?.["labels"] as Includes).values.map((v: unknown) => {
          return v!.toString();
        }),
      ).toEqual(ids);
      expect(restored?.["deletedAt"]).toBeInstanceOf(IsNull);
    });

    /*
     * A link only carries the slices it names; the arriving table must not be
     * told anything about the others.
     */
    test("a link's slices do not leak into another table or slice", () => {
      navigateWith(
        TableFilterUrlState.getLinkQueryParams("monitors-table", {
          facets: { selectedLabelIds: ["a"] },
        }),
      );

      expect(TableFilterUrlState.read("monitors-table", "facets")).toEqual({
        selectedLabelIds: ["a"],
      });
      expect(TableFilterUrlState.read("monitors-table", "filter")).toBeNull();
      expect(TableFilterUrlState.read("incidents-table", "facets")).toBeNull();
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
