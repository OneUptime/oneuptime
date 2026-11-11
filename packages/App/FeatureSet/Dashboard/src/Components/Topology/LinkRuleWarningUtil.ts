import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  composedValue,
  createTranslator,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * The topology map's link-rule banner, computed without react.
 *
 * A warning arrives as untrusted JSON — the map is drawn from whatever the
 * endpoint sent, and a row missing its id or its message must be dropped
 * rather than rendered as an empty bullet. Parsing and phrasing live here so
 * both are assertions in the test suite instead of hopes: App/Tests cannot
 * render a component.
 *
 * The site list is the point of issue #3321. The sentence a rule produces
 * names three sites and then says "and 694 more", which is a blast radius and
 * not something anybody can act on. These rows are what turn that number back
 * into a list of buildings to go and look at.
 */

/** Why one site could not be resolved. Mirrors LinkRuleGroupSkipReason. */
export type LinkRuleWarningSiteReason = "noParentMatched" | "ambiguousParent";

export interface TopologyLinkRuleWarningSite {
  siteId: string;
  siteName?: string | undefined;
  reason: LinkRuleWarningSiteReason;
  // Devices in this site the rule wanted to place and could not.
  strandedDeviceCount: number;
  // Devices in this site carrying the parent labels: 0, or >= 2 when ambiguous.
  matchedParentCount: number;
}

export interface TopologyLinkRuleWarning {
  ruleId: string;
  ruleName?: string | undefined;
  message: string;
  /*
   * The failing sites, capped by the endpoint. Never assume this is all of
   * them — `siteCount` is the true total and can be larger.
   */
  sites?: Array<TopologyLinkRuleWarningSite> | undefined;
  siteCount?: number | undefined;
}

/*
 * What a site with no name is called. A site can be read through a device's
 * relation without its name coming back, so this is a real state rather than
 * a defensive one.
 */
export const UNNAMED_SITE_LABEL: string = translationKey("Unnamed site");

/*
 * What the sentences below are written in when the caller hands no
 * translator: English, word for word - what the tests read. The map hands
 * the reader's, and each sentence is looked up whole.
 */
const ENGLISH: Translator = createTranslator(undefined);

const isFiniteNumber: (value: unknown) => value is number = (
  value: unknown,
): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

/*
 * A site row is only worth rendering if it can be named and counted. A row
 * with no id cannot be pointed at, and a reason outside the two the resolver
 * produces would render as a sentence nobody wrote.
 */
const parseWarningSite: (row: unknown) => TopologyLinkRuleWarningSite | null = (
  row: unknown,
): TopologyLinkRuleWarningSite | null => {
  const site: JSONObject = (row || {}) as JSONObject;
  const siteId: unknown = site["siteId"];
  const reason: unknown = site["reason"];

  if (typeof siteId !== "string" || !siteId) {
    return null;
  }
  if (reason !== "noParentMatched" && reason !== "ambiguousParent") {
    return null;
  }

  const siteName: unknown = site["siteName"];
  const stranded: unknown = site["strandedDeviceCount"];
  const parents: unknown = site["matchedParentCount"];

  return {
    siteId: siteId,
    siteName:
      typeof siteName === "string" && siteName.trim() ? siteName : undefined,
    reason: reason,
    /*
     * Counts are clamped rather than trusted: a negative or missing count
     * would render as "-1 devices", which reads as a bug in the map rather
     * than as the malformed payload it is.
     */
    strandedDeviceCount:
      isFiniteNumber(stranded) && stranded > 0 ? stranded : 0,
    matchedParentCount: isFiniteNumber(parents) && parents > 0 ? parents : 0,
  };
};

/** Narrow the endpoint's `linkRuleWarnings` array, dropping malformed rows. */
export const parseLinkRuleWarnings: (
  raw: unknown,
) => Array<TopologyLinkRuleWarning> = (
  raw: unknown,
): Array<TopologyLinkRuleWarning> => {
  const rows: JSONArray = Array.isArray(raw) ? (raw as JSONArray) : [];

  return rows
    .map((row: unknown): TopologyLinkRuleWarning | null => {
      const warning: JSONObject = (row || {}) as JSONObject;
      const ruleId: unknown = warning["ruleId"];
      const message: unknown = warning["message"];

      if (typeof ruleId !== "string" || !ruleId) {
        return null;
      }
      if (typeof message !== "string" || !message) {
        return null;
      }

      const ruleName: unknown = warning["ruleName"];
      const sites: Array<TopologyLinkRuleWarningSite> = (
        Array.isArray(warning["sites"])
          ? (warning["sites"] as JSONArray)
          : ([] as JSONArray)
      )
        .map(parseWarningSite)
        .filter(
          (
            site: TopologyLinkRuleWarningSite | null,
          ): site is TopologyLinkRuleWarningSite => {
            return site !== null;
          },
        );

      const siteCountRaw: unknown = warning["siteCount"];
      /*
       * The endpoint's count wins when it is at least as large as the rows it
       * sent — that is the whole point of sending both, since the rows are
       * capped and the count is not. A count SMALLER than the rows is a
       * payload contradicting itself, so the rows are believed instead.
       */
      const siteCount: number = isFiniteNumber(siteCountRaw)
        ? Math.max(siteCountRaw, sites.length)
        : sites.length;

      return {
        ruleId: ruleId,
        ruleName:
          typeof ruleName === "string" && ruleName.trim()
            ? ruleName
            : undefined,
        message: message,
        sites: sites.length > 0 ? sites : undefined,
        siteCount: siteCount > 0 ? siteCount : undefined,
      };
    })
    .filter(
      (
        warning: TopologyLinkRuleWarning | null,
      ): warning is TopologyLinkRuleWarning => {
        return warning !== null;
      },
    );
};

/** "3 devices" / "1 device" — the count and its noun, nothing else. */
const devicePhrase: (count: number, translator: Translator) => string = (
  count: number,
  translator: Translator,
): string => {
  return translator.translatePlural(
    { one: "{{count}} device", other: "{{count}} devices" },
    count,
  );
};

/**
 * One row of the site list: the site, what is wrong there, and the damage.
 *
 * Phrased as a fix rather than as a diagnosis. "No device carries the parent
 * labels" tells an operator standing in front of 697 rows exactly which of
 * the two things to go and do, which "unresolved" would not.
 */
export const describeWarningSite: (
  site: TopologyLinkRuleWarningSite,
  translator?: Translator,
) => string = (
  site: TopologyLinkRuleWarningSite,
  translator: Translator = ENGLISH,
): string => {
  const siteName: string =
    site.siteName || translator.translateText(UNNAMED_SITE_LABEL) || "";

  if (site.reason === "ambiguousParent") {
    return translator.translatePlural(
      {
        one: "{{site}} — {{parents}} carry the parent labels, so {{count}} device has no uplink",
        other:
          "{{site}} — {{parents}} carry the parent labels, so {{count}} devices have no uplink",
      },
      site.strandedDeviceCount,
      {
        site: siteName,
        parents: composedValue((sentence: Translator): string => {
          return devicePhrase(site.matchedParentCount, sentence);
        }),
      },
    );
  }

  return translator.translatePlural(
    {
      one: "{{site}} — no device carries the parent labels, so {{count}} device has no uplink",
      other:
        "{{site}} — no device carries the parent labels, so {{count}} devices have no uplink",
    },
    site.strandedDeviceCount,
    { site: siteName },
  );
};

/**
 * The label on the control that opens the site list.
 *
 * Counts the sites the RULE failed in, not the rows that fit in the payload:
 * an operator who opens "Show the 100 sites" and finds 697 has been misled by
 * the one number they were given before deciding to look.
 */
export const describeSiteListToggle: (
  warning: TopologyLinkRuleWarning,
  translator?: Translator,
) => string = (
  warning: TopologyLinkRuleWarning,
  translator: Translator = ENGLISH,
): string => {
  const total: number = Math.max(
    warning.siteCount || 0,
    (warning.sites || []).length,
  );

  return translator.translatePlural(
    {
      one: "Show the {{count}} site that needs attention",
      other: "Show the {{count}} sites that need attention",
    },
    total,
  );
};

/**
 * Failing sites the endpoint counted but did not send rows for.
 *
 * Shown rather than swallowed: a list that silently stops at its cap reads as
 * the complete set of broken sites, which at this scale is exactly the wrong
 * thing to believe.
 */
export const hiddenSiteCount: (warning: TopologyLinkRuleWarning) => number = (
  warning: TopologyLinkRuleWarning,
): number => {
  const listed: number = (warning.sites || []).length;
  return Math.max((warning.siteCount || 0) - listed, 0);
};
