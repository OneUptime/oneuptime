import { describe, expect, test } from "@jest/globals";
import {
  MIN_SITE_SEARCH_CHARS,
  SearchableLink,
  SearchableSite,
  filterLinksBySearch,
  filterSitesBySearch,
  isRemoteSearchable,
  normalizeSiteSearchText,
  siteIdSet,
  siteMatchesSearch,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSearchUtil";

/*
 * The local half of the Network Map's search: the predicate that narrows the
 * level in view. The map's markers, its site cards and its WAN links are all
 * filtered through these functions, so anything that is true here is true of
 * all three at once — that agreement is the point.
 *
 * The identity checks below are not micro-optimisation trivia: the geo map
 * and the container graph both key expensive memos (projection, cluster
 * bucketing, grid layout) off the array they are handed, so an empty search
 * returning a fresh array would relayout the whole level on every unrelated
 * re-render of the page.
 */

const site: (name: string, siteType: string) => SearchableSite = (
  name: string,
  siteType: string,
): SearchableSite => {
  return { name, siteType };
};

describe("normalizeSiteSearchText", () => {
  test("trims and lower-cases", () => {
    expect(normalizeSiteSearchText("  Kansas City  ")).toBe("kansas city");
  });

  test("null, undefined and blank all read as no search", () => {
    expect(normalizeSiteSearchText(null)).toBe("");
    expect(normalizeSiteSearchText(undefined)).toBe("");
    expect(normalizeSiteSearchText("   ")).toBe("");
  });
});

describe("isRemoteSearchable", () => {
  test("one character is not worth a round trip", () => {
    expect(isRemoteSearchable("")).toBe(false);
    expect(isRemoteSearchable("u")).toBe(false);
  });

  test("the threshold itself is searchable", () => {
    expect(MIN_SITE_SEARCH_CHARS).toBe(2);
    expect(isRemoteSearchable("un")).toBe(true);
    expect(isRemoteSearchable("unit 104822")).toBe(true);
  });
});

describe("siteMatchesSearch", () => {
  test("an empty search is not a filter — it matches everything", () => {
    expect(siteMatchesSearch(site("Kansas City", "Market"), "")).toBe(true);
  });

  test("matches a substring of the name, case-insensitively", () => {
    expect(siteMatchesSearch(site("Kansas City", "Market"), "sas ci")).toBe(
      true,
    );
    expect(siteMatchesSearch(site("Kansas City", "Market"), "denver")).toBe(
      false,
    );
  });

  /*
   * Site types are the customer's own words for their levels, and "market" is
   * a perfectly reasonable thing to type at a level that mixes them with
   * stores.
   */
  test("matches the site type as well as the name", () => {
    expect(siteMatchesSearch(site("Kansas City", "Market"), "market")).toBe(
      true,
    );
  });

  /*
   * The whole reason for tokenizing. Nobody recalls a name in the exact order
   * it was written, and neither of these is a substring of anything.
   */
  test("every token must appear, in any order", () => {
    const unit: SearchableSite = site("Unit 104822 — Michigan Ave", "Unit");
    expect(siteMatchesSearch(unit, "michigan 104822")).toBe(true);
    expect(siteMatchesSearch(unit, "104822 michigan")).toBe(true);
    // ALL tokens, not any: a stray word must still exclude the row.
    expect(siteMatchesSearch(unit, "michigan denver")).toBe(false);
  });

  test("a single token behaves exactly like a substring test", () => {
    expect(siteMatchesSearch(site("Unit 104822", "Unit"), "104822")).toBe(true);
    expect(siteMatchesSearch(site("Unit 104822", "Unit"), "104823")).toBe(
      false,
    );
  });

  test("runs of whitespace between tokens are not empty tokens", () => {
    expect(
      siteMatchesSearch(site("Kansas City", "Market"), "kansas    city"),
    ).toBe(true);
  });
});

describe("filterSitesBySearch", () => {
  const sites: Array<SearchableSite & { id: string }> = [
    { id: "a", ...site("Kansas City Market", "Market") },
    { id: "b", ...site("Denver Market", "Market") },
    { id: "c", ...site("Unit 104822 — Michigan Ave", "Unit") },
  ];

  test("keeps only the rows that match", () => {
    expect(
      filterSitesBySearch(sites, "market").map(
        (row: { id: string }): string => {
          return row.id;
        },
      ),
    ).toEqual(["a", "b"]);
  });

  /*
   * Identity, not just equality: the map and the graph memoize off this
   * array, and a copy on every render would relayout the level for nothing.
   */
  test("an empty search hands back the very same array", () => {
    expect(filterSitesBySearch(sites, "")).toBe(sites);
  });

  test("a search matching nothing yields an empty list, not everything", () => {
    expect(filterSitesBySearch(sites, "tokyo")).toEqual([]);
  });
});

describe("filterLinksBySearch", () => {
  const links: Array<SearchableLink & { id: string }> = [
    {
      id: "kc-den",
      name: "KC ↔ Denver backbone",
      fromSiteId: "a",
      toSiteId: "b",
    },
    {
      id: "den-sea",
      name: "Denver ↔ Seattle",
      fromSiteId: "b",
      toSiteId: "d",
    },
    {
      id: "orphan",
      name: "Spare circuit",
      fromSiteId: undefined,
      toSiteId: undefined,
    },
  ];

  test("an empty search hands back the very same array", () => {
    expect(filterLinksBySearch(links, "", new Set<string>())).toBe(links);
  });

  /*
   * ONE surviving endpoint is enough. A search for Kansas City is a question
   * about Kansas City, and its WAN links are most of the answer — dropping
   * them because the far end is in Denver answers a question nobody asked.
   */
  test("keeps a link that touches a single surviving site", () => {
    expect(
      filterLinksBySearch(links, "kansas", new Set<string>(["a"])).map(
        (link: { id: string }): string => {
          return link.id;
        },
      ),
    ).toEqual(["kc-den"]);
  });

  test("keeps a link whose own name matches even when neither end survives", () => {
    expect(
      filterLinksBySearch(links, "spare circuit", new Set<string>()).map(
        (link: { id: string }): string => {
          return link.id;
        },
      ),
    ).toEqual(["orphan"]);
  });

  test("drops a link that neither matches nor touches anything visible", () => {
    expect(
      filterLinksBySearch(links, "kansas", new Set<string>(["z"])),
    ).toEqual([]);
  });

  // A missing endpoint id must never be read as "matches the visible set".
  test("an endpoint-less link is not kept by an empty visible set", () => {
    expect(filterLinksBySearch(links, "kansas", new Set<string>([""]))).toEqual(
      [],
    );
  });
});

describe("siteIdSet", () => {
  test("collects the ids of the filtered rows", () => {
    expect(siteIdSet([{ id: "a" }, { id: "b" }])).toEqual(
      new Set<string>(["a", "b"]),
    );
  });
});
