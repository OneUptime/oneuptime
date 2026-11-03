import { beforeAll, describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";

/*
 * A SAVED VIEW APPLIED ON THE PAGE IT WAS SAVED ON COMES BACK WHOLE.
 *
 * Applying a view put the page's own scope over the view's query with a
 * shallow spread. That is right key by key - the view cannot widen what the
 * page is about - but wrong for `attributes`, the one object both write
 * into: a page that pins attributes (a Kubernetes cluster's Logs tab pins
 * `resource.k8s.cluster.name`, a host's `resource.host.name`) replaced the
 * view's whole object with its own. A view saved there with a namespace chip
 * came back with no namespace chip and no namespace filter.
 *
 * Nobody noticed while those tabs only listed the project's views, made on
 * the Logs page, which pins nothing. Now a view is listed only on the page it
 * was saved on (issue #5549), so these are exactly the pages views are saved
 * on, and the merge keeps the view's attributes under the page's.
 *
 * Driven through the real compile (applyLogsFacetFiltersToQuery) and the real
 * read-back (buildLogsFacetFiltersFromQuery): what a view saved on a page
 * holds, applied on that page, reads back as the chips it was saved with.
 */

type MergeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge");
type FacetFiltersModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters");
type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");

let Merge: MergeModule;
let FacetFilters: FacetFiltersModule;
let Pivot: PivotModule;

const CLUSTER_ATTRIBUTE: string = "resource.k8s.cluster.name";
const NAMESPACE_ATTRIBUTE: string = "resource.k8s.namespace.name";
const HOST_ATTRIBUTE: string = "resource.host.name";
const SERVICE_ID: string = "0195d6c1-0000-7000-8000-0000000000e1";
const OTHER_SERVICE_ID: string = "0195d6c1-0000-7000-8000-0000000000e2";

// Common/UI/Config reads `window` as it loads (via LogsCrossSignalPivot).
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Merge = await import(
    "../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge"
  );
  FacetFilters = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters"
  );
  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
});

function chips(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map(
    entries.map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set(values)];
      },
    ),
  );
}

function chipEntries(
  filters: Map<string, Set<string>>,
): Array<[string, Array<string>]> {
  return [...filters.entries()]
    .map(([key, values]: [string, Set<string>]): [string, Array<string>] => {
      return [key, [...values].sort()];
    })
    .sort((left: [string, Array<string>], right: [string, Array<string>]) => {
      return left[0].localeCompare(right[0]);
    });
}

// A cluster's Logs tab: what Pages/Kubernetes/View/Logs.tsx pins.
function clusterPage(cluster: string): JSONObject {
  return {
    attributes: { [CLUSTER_ATTRIBUTE]: cluster },
    entityScope: {
      entityKeys: [`k8s-cluster-key-${cluster}`],
      attributeKey: CLUSTER_ATTRIBUTE,
      attributeValue: cluster,
    },
  } as unknown as JSONObject;
}

/*
 * What a view saved on a page stores: the page's scope with the chips the
 * reader had on, compiled as the viewer compiles them (its `filterOptions`).
 */
function savedOnPage(
  page: JSONObject,
  chipSet: Map<string, Set<string>>,
): JSONObject {
  const base: JSONObject = {
    ...page,
    ...(page["attributes"]
      ? {
          attributes: {
            ...(page["attributes"] as Record<string, unknown>),
          } as unknown as JSONObject[string],
        }
      : {}),
  };

  return Pivot.applyLogsFacetFiltersToQuery(
    base as unknown as Query<Log>,
    chipSet,
  ) as unknown as JSONObject;
}

function readBack(
  merged: JSONObject,
  page: JSONObject,
): Map<string, Set<string>> {
  return FacetFilters.buildLogsFacetFiltersFromQuery(
    merged as unknown as Query<Log>,
    page as unknown as Query<Log>,
  );
}

describe("buildSavedViewQueryOverBase", () => {
  test("a view saved on a cluster's tab with a namespace chip comes back with it", () => {
    const page: JSONObject = clusterPage("prod-eks-01");
    const savedChips: Map<string, Set<string>> = chips([
      [`attributes.${NAMESPACE_ATTRIBUTE}`, ["payments"]],
      ["severityText", ["ERROR"]],
    ]);
    const saved: JSONObject = savedOnPage(page, savedChips);

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: saved,
      baseQuery: page,
    });

    expect(chipEntries(readBack(merged, page))).toEqual(
      chipEntries(savedChips),
    );
    // The page's own attribute is kept, and is no chip of the view's.
    expect(
      (merged["attributes"] as Record<string, unknown>)[CLUSTER_ATTRIBUTE],
    ).toBe("prod-eks-01");
    expect(readBack(merged, page).has(`attributes.${CLUSTER_ATTRIBUTE}`)).toBe(
      false,
    );
  });

  test("regression: the spread it replaces lost that namespace chip and its filter", () => {
    const page: JSONObject = clusterPage("prod-eks-01");
    const saved: JSONObject = savedOnPage(
      page,
      chips([[`attributes.${NAMESPACE_ATTRIBUTE}`, ["payments"]]]),
    );

    const spread: JSONObject = { ...saved, ...page };

    expect(
      (spread["attributes"] as Record<string, unknown>)[NAMESPACE_ATTRIBUTE],
    ).toBeUndefined();
    expect(readBack(spread, page).size).toBe(0);
  });

  test("chips and query describe the same slice: compiling the read-back chips onto the page gives the merged attributes", () => {
    const page: JSONObject = clusterPage("prod-eks-01");
    const saved: JSONObject = savedOnPage(
      page,
      chips([
        [`attributes.${NAMESPACE_ATTRIBUTE}`, ["payments"]],
        ["attributes.http.route", ["/checkout"]],
      ]),
    );

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: saved,
      baseQuery: page,
    });
    const recompiled: JSONObject = savedOnPage(page, readBack(merged, page));

    expect(recompiled["attributes"]).toEqual(merged["attributes"]);
  });

  test("a host's tab keeps the host it pins and the view's own attribute chips", () => {
    const page: JSONObject = {
      attributes: { [HOST_ATTRIBUTE]: "web-01" },
    } as unknown as JSONObject;
    const savedChips: Map<string, Set<string>> = chips([
      ["attributes.process.executable.name", ["sshd"]],
    ]);

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: savedOnPage(page, savedChips),
      baseQuery: page,
    });

    expect(merged["attributes"]).toEqual({
      [HOST_ATTRIBUTE]: "web-01",
      "process.executable.name": (
        savedOnPage(page, savedChips)["attributes"] as Record<string, unknown>
      )["process.executable.name"],
    });
    expect(chipEntries(readBack(merged, page))).toEqual(
      chipEntries(savedChips),
    );
  });

  test("the page wins over the view on an attribute both name", () => {
    // A view whose stored cluster is another one's never widens or moves this tab.
    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: {
        attributes: {
          [CLUSTER_ATTRIBUTE]: "staging",
          [NAMESPACE_ATTRIBUTE]: "payments",
        },
      } as unknown as JSONObject,
      baseQuery: clusterPage("prod-eks-01"),
    });

    expect(merged["attributes"]).toEqual({
      [CLUSTER_ATTRIBUTE]: "prod-eks-01",
      [NAMESPACE_ATTRIBUTE]: "payments",
    });
  });

  test("the page wins key by key everywhere else", () => {
    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: {
        primaryEntityId: new Includes([OTHER_SERVICE_ID]),
        severityText: new Includes(["ERROR"]),
        entityScope: {
          entityKeys: ["old"],
          attributeKey: "a",
          attributeValue: "b",
        },
      } as unknown as JSONObject,
      baseQuery: {
        primaryEntityId: new Includes([SERVICE_ID]),
        entityScope: {
          entityKeys: ["page"],
          attributeKey: "c",
          attributeValue: "d",
        },
      } as unknown as JSONObject,
    });

    expect((merged["primaryEntityId"] as unknown as Includes).values).toEqual([
      SERVICE_ID,
    ]);
    expect(merged["entityScope"]).toEqual({
      entityKeys: ["page"],
      attributeKey: "c",
      attributeValue: "d",
    });
    // What the page does not pin is the view's.
    expect((merged["severityText"] as unknown as Includes).values).toEqual([
      "ERROR",
    ]);
  });

  test("on the Logs page, which pins nothing, a view applies exactly as stored", () => {
    const saved: JSONObject = {
      attributes: { [NAMESPACE_ATTRIBUTE]: "payments" },
      severityText: new Includes(["ERROR"]),
    } as unknown as JSONObject;

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: saved,
      baseQuery: {},
    });

    expect(merged).toEqual(saved);
  });

  test("a view with no attributes takes the page's", () => {
    const page: JSONObject = clusterPage("prod-eks-01");

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: {
        severityText: new Includes(["WARN"]),
      } as unknown as JSONObject,
      baseQuery: page,
    });

    expect(merged["attributes"]).toEqual({
      [CLUSTER_ATTRIBUTE]: "prod-eks-01",
    });
  });

  test("neither holding attributes leaves none", () => {
    expect(
      Merge.buildSavedViewQueryOverBase({
        savedQuery: {
          severityText: new Includes(["WARN"]),
        } as unknown as JSONObject,
        baseQuery: {
          primaryEntityId: new Includes([SERVICE_ID]),
        } as unknown as JSONObject,
      }),
    ).not.toHaveProperty("attributes");
  });

  test.each([
    ["null", null],
    ["a string", "resource.k8s.namespace.name=payments"],
    ["an array", ["payments"]],
  ])(
    "stored attributes that are %s give way to the page's, without a merge",
    (_label: string, stored: unknown) => {
      const page: JSONObject = clusterPage("prod-eks-01");

      const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
        savedQuery: { attributes: stored } as unknown as JSONObject,
        baseQuery: page,
      });

      expect(merged["attributes"]).toEqual({
        [CLUSTER_ATTRIBUTE]: "prod-eks-01",
      });
    },
  );

  test("changes neither the cached view nor the page, and hands back an attributes object of its own", () => {
    const page: JSONObject = clusterPage("prod-eks-01");
    const saved: JSONObject = {
      attributes: { [NAMESPACE_ATTRIBUTE]: "payments" },
    } as unknown as JSONObject;
    const savedBefore: string = JSON.stringify(saved);
    const pageBefore: string = JSON.stringify(page);

    const merged: JSONObject = Merge.buildSavedViewQueryOverBase({
      savedQuery: saved,
      baseQuery: page,
    });

    expect(JSON.stringify(saved)).toBe(savedBefore);
    expect(JSON.stringify(page)).toBe(pageBefore);
    expect(merged["attributes"]).not.toBe(saved["attributes"]);
    expect(merged["attributes"]).not.toBe(page["attributes"]);

    // A chip written into the result reaches neither of them.
    (merged["attributes"] as Record<string, unknown>)["added"] = "x";
    expect(JSON.stringify(saved)).toBe(savedBefore);
    expect(JSON.stringify(page)).toBe(pageBefore);
  });

  test("survives missing inputs", () => {
    expect(
      Merge.buildSavedViewQueryOverBase({
        savedQuery: undefined as unknown as JSONObject,
        baseQuery: undefined as unknown as JSONObject,
      }),
    ).toEqual({});
  });
});
