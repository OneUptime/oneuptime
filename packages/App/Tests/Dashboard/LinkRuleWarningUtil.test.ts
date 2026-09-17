import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  TopologyLinkRuleWarning,
  TopologyLinkRuleWarningSite,
  UNNAMED_SITE_LABEL,
  describeSiteListToggle,
  describeWarningSite,
  hiddenSiteCount,
  parseLinkRuleWarnings,
} from "../../FeatureSet/Dashboard/src/Components/Topology/LinkRuleWarningUtil";

/*
 * The banner is drawn from whatever the topology endpoint sent, so every row
 * here is untrusted input. A malformed one has to disappear rather than
 * render as an empty bullet on an amber panel — the panel's whole job is to
 * be believed.
 *
 * The site rows are issue #3321: a rule failing in 697 sites can only say
 * "and 694 more sites" in one line of prose, and an operator cannot walk into
 * a number. These are the rows that line expands into.
 */

function warningRow(overrides?: JSONObject): JSONObject {
  return {
    ruleId: "rule-1",
    ruleName: "Router link with Switch",
    message: "Drawing in 252 of 949 sites.",
    ...(overrides || {}),
  };
}

function siteRow(overrides?: JSONObject): JSONObject {
  return {
    siteId: "site-1",
    siteName: "WB Franchise Unit 0005",
    reason: "noParentMatched",
    strandedDeviceCount: 3,
    matchedParentCount: 0,
    ...(overrides || {}),
  };
}

function firstSite(
  warning: TopologyLinkRuleWarning,
): TopologyLinkRuleWarningSite {
  const sites: Array<TopologyLinkRuleWarningSite> = warning.sites || [];
  expect(sites.length).toBeGreaterThan(0);
  return sites[0]!;
}

describe("parseLinkRuleWarnings", () => {
  test("keeps a well-formed warning intact", () => {
    const warnings: Array<TopologyLinkRuleWarning> = parseLinkRuleWarnings([
      warningRow({ sites: [siteRow()], siteCount: 1 }),
    ]);

    expect(warnings).toEqual([
      {
        ruleId: "rule-1",
        ruleName: "Router link with Switch",
        message: "Drawing in 252 of 949 sites.",
        sites: [
          {
            siteId: "site-1",
            siteName: "WB Franchise Unit 0005",
            reason: "noParentMatched",
            strandedDeviceCount: 3,
            matchedParentCount: 0,
          },
        ],
        siteCount: 1,
      },
    ]);
  });

  test("returns nothing at all for a payload that is not a list", () => {
    expect(parseLinkRuleWarnings(undefined)).toEqual([]);
    expect(parseLinkRuleWarnings(null)).toEqual([]);
    expect(parseLinkRuleWarnings("linkRuleWarnings")).toEqual([]);
    expect(parseLinkRuleWarnings({ ruleId: "rule-1" })).toEqual([]);
  });

  test("drops a warning with nothing to say or nothing to say it about", () => {
    /*
     * A row with no message renders as a rule name and a colon; a row with no
     * ruleId cannot be keyed. Both are silence dressed up as a warning.
     */
    expect(
      parseLinkRuleWarnings([
        warningRow({ message: "" }),
        warningRow({ ruleId: "" }),
        warningRow({ ruleId: 7 }),
        warningRow({ message: { text: "nested" } }),
        null,
        "a string",
      ]),
    ).toEqual([]);
  });

  test("a rule with no name is left unnamed rather than named the empty string", () => {
    // The component falls back to "Link rule", which a "" would defeat.
    expect(
      parseLinkRuleWarnings([warningRow({ ruleName: "   " })])[0]!.ruleName,
    ).toBeUndefined();
    expect(
      parseLinkRuleWarnings([warningRow({ ruleName: 42 })])[0]!.ruleName,
    ).toBeUndefined();
  });

  test("keeps every well-formed row and drops only the broken ones", () => {
    const warnings: Array<TopologyLinkRuleWarning> = parseLinkRuleWarnings([
      warningRow({ ruleId: "rule-1" }),
      warningRow({ ruleId: "" }),
      warningRow({ ruleId: "rule-2" }),
    ]);

    expect(
      warnings.map((warning: TopologyLinkRuleWarning) => {
        return warning.ruleId;
      }),
    ).toEqual(["rule-1", "rule-2"]);
  });

  test("omits the site list rather than sending an empty one", () => {
    /*
     * The component keys the expander off `sites` being present, so an empty
     * array would put a "Show the 0 sites that need attention" control under
     * a project-scoped warning that has no sites at all.
     */
    const noSites: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow(),
    ])[0]!;
    expect(noSites.sites).toBeUndefined();
    expect(noSites.siteCount).toBeUndefined();

    const emptySites: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({ sites: [], siteCount: 0 }),
    ])[0]!;
    expect(emptySites.sites).toBeUndefined();
    expect(emptySites.siteCount).toBeUndefined();
  });

  test("drops a site row that cannot be identified or explained", () => {
    const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({
        sites: [
          siteRow({ siteId: "" }),
          siteRow({ siteId: 12 }),
          // Not one of the two reasons the resolver produces.
          siteRow({ siteId: "site-x", reason: "ambiguous" }),
          siteRow({ siteId: "site-x", reason: undefined }),
          null,
          siteRow({ siteId: "site-good" }),
        ],
      }),
    ])[0]!;

    expect(
      (warning.sites || []).map((site: TopologyLinkRuleWarningSite) => {
        return site.siteId;
      }),
    ).toEqual(["site-good"]);
  });

  test("clamps a count that would render as nonsense", () => {
    /*
     * "-1 devices have no uplink" reads as a bug in the map rather than as
     * the malformed payload it is.
     */
    const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({
        sites: [
          siteRow({
            strandedDeviceCount: -4,
            matchedParentCount: Number.NaN,
          }),
        ],
      }),
    ])[0]!;

    expect(firstSite(warning).strandedDeviceCount).toBe(0);
    expect(firstSite(warning).matchedParentCount).toBe(0);
  });

  test("a site with no name keeps its id, which is what it is found by", () => {
    const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({ sites: [siteRow({ siteName: "  " })] }),
    ])[0]!;

    expect(firstSite(warning).siteId).toBe("site-1");
    expect(firstSite(warning).siteName).toBeUndefined();
  });

  test("believes the endpoint's total over the rows it actually sent", () => {
    /*
     * The rows are capped and the total is not — that is the whole reason
     * both are sent. Reading the total off the rows would tell an operator
     * with 697 broken sites that they have 100.
     */
    const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({
        sites: [siteRow(), siteRow({ siteId: "site-2" })],
        siteCount: 697,
      }),
    ])[0]!;

    expect(warning.sites).toHaveLength(2);
    expect(warning.siteCount).toBe(697);
  });

  test("believes the rows when the total contradicts them", () => {
    // A payload disagreeing with itself must not hide rows it did send.
    const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
      warningRow({
        sites: [siteRow(), siteRow({ siteId: "site-2" })],
        siteCount: 1,
      }),
    ])[0]!;

    expect(warning.siteCount).toBe(2);
  });

  test("falls back to the row count when the total is missing or unusable", () => {
    for (const bogus of [
      undefined,
      "many",
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const warning: TopologyLinkRuleWarning = parseLinkRuleWarnings([
        warningRow({ sites: [siteRow()], siteCount: bogus as never }),
      ])[0]!;
      expect(warning.siteCount).toBe(1);
    }
  });
});

describe("describeWarningSite", () => {
  function describe_(overrides?: Partial<TopologyLinkRuleWarningSite>): string {
    return describeWarningSite({
      siteId: "site-1",
      siteName: "WB Franchise Unit 0005",
      reason: "noParentMatched",
      strandedDeviceCount: 3,
      matchedParentCount: 0,
      ...(overrides || {}),
    });
  }

  test("names the site, the fault and the damage", () => {
    expect(describe_()).toBe(
      "WB Franchise Unit 0005 — no device carries the parent labels, so 3 devices have no uplink",
    );
  });

  test("an ambiguous site is told how many parents it has, not that it has none", () => {
    /*
     * The two faults need opposite fixes — remove a label, or add one — so a
     * row that got them backwards would be worse than no row.
     */
    expect(
      describe_({ reason: "ambiguousParent", matchedParentCount: 2 }),
    ).toBe(
      "WB Franchise Unit 0005 — 2 devices carry the parent labels, so 3 devices have no uplink",
    );
  });

  test("reads as English for a single device", () => {
    expect(describe_({ strandedDeviceCount: 1 })).toBe(
      "WB Franchise Unit 0005 — no device carries the parent labels, so 1 device has no uplink",
    );
  });

  test("calls an unnamed site what it is", () => {
    expect(describe_({ siteName: undefined })).toBe(
      `${UNNAMED_SITE_LABEL} — no device carries the parent labels, so 3 devices have no uplink`,
    );
  });

  test("prints a long site name in full, because this is the list not the sentence", () => {
    /*
     * The one-line summary truncates names at 40 characters to stay readable.
     * The list is where the operator goes to find the actual building, so a
     * clipped name here would defeat the point of expanding it.
     */
    const longName: string = "WB Franchise Unit 0005 Distribution Annexe East";
    expect(describe_({ siteName: longName })).toContain(longName);
  });
});

describe("describeSiteListToggle", () => {
  function warning(
    listed: number,
    siteCount: number | undefined,
  ): TopologyLinkRuleWarning {
    const sites: Array<TopologyLinkRuleWarningSite> = [];
    for (let index: number = 0; index < listed; index++) {
      sites.push({
        siteId: `site-${index}`,
        reason: "noParentMatched",
        strandedDeviceCount: 1,
        matchedParentCount: 0,
      });
    }
    return {
      ruleId: "rule-1",
      message: "…",
      sites: sites,
      siteCount: siteCount,
    };
  }

  test("counts the sites the rule failed in, not the rows that fit", () => {
    /*
     * The operator decides whether to open the list from this number. "Show
     * the 100 sites" on a rule that failed in 697 would understate the
     * problem at the exact moment they are deciding how seriously to take it.
     */
    expect(describeSiteListToggle(warning(100, 697))).toBe(
      "Show the 697 sites that need attention",
    );
  });

  test("reads as English for a single site", () => {
    expect(describeSiteListToggle(warning(1, 1))).toBe(
      "Show the 1 site that needs attention",
    );
  });

  test("falls back to the rows when the total is missing or too small", () => {
    expect(describeSiteListToggle(warning(4, undefined))).toBe(
      "Show the 4 sites that need attention",
    );
    expect(describeSiteListToggle(warning(4, 1))).toBe(
      "Show the 4 sites that need attention",
    );
  });
});

describe("hiddenSiteCount", () => {
  function warning(
    listed: number,
    siteCount: number | undefined,
  ): TopologyLinkRuleWarning {
    const sites: Array<TopologyLinkRuleWarningSite> = [];
    for (let index: number = 0; index < listed; index++) {
      sites.push({
        siteId: `site-${index}`,
        reason: "noParentMatched",
        strandedDeviceCount: 1,
        matchedParentCount: 0,
      });
    }
    return {
      ruleId: "rule-1",
      message: "…",
      sites: sites,
      siteCount: siteCount,
    };
  }

  test("counts the sites the endpoint capped away", () => {
    /*
     * A list that silently stops at its cap reads as the complete set of
     * broken sites, which at this scale is exactly the wrong thing to
     * believe.
     */
    expect(hiddenSiteCount(warning(100, 697))).toBe(597);
  });

  test("hides nothing when every failing site was sent", () => {
    expect(hiddenSiteCount(warning(4, 4))).toBe(0);
  });

  test("never goes negative on a payload that disagrees with itself", () => {
    expect(hiddenSiteCount(warning(4, 1))).toBe(0);
    expect(hiddenSiteCount(warning(4, undefined))).toBe(0);
  });

  test("hides nothing for a warning with no site list at all", () => {
    expect(
      hiddenSiteCount({
        ruleId: "rule-1",
        message: "Disabled — draws no links.",
      }),
    ).toBe(0);
  });
});
