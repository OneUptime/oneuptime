import { NetworkDeviceLinkRuleScopeUtil } from "../../Types/NetworkDevice/NetworkDeviceLinkRuleScope";

/*
 * Turning label rules into uplinks.
 *
 * Pure data-in/data-out so the whole decision matrix — which is mostly about
 * REFUSING to draw things — is unit-testable without a database.
 *
 * The shape is a star, not a clique. A rule names a set of child labels and a
 * set of parent labels; every device carrying all the child labels gets one
 * edge to the single device carrying all the parent labels. Matching "devices
 * that share a label" symmetrically, which is what was originally asked for,
 * would turn one forty-device site label into 780 edges.
 *
 * "The single device" needs a universe to be single IN, and the rule's scope
 * is what names it. Project scope asks across everything the caller passed;
 * Site scope asks once per site, which is what lets one rule draw the same
 * router-to-switch star in fourteen buildings instead of reporting fourteen
 * candidate routers and drawing nothing anywhere.
 */

export interface LinkRuleDeviceInput {
  id: string;
  // Normalised label ids the device carries.
  labelIds: Array<string>;
  /*
   * Which site the device belongs to. ALWAYS a string, never an ObjectID —
   * grouping keys a Map on it, and an ObjectID instance would compare by
   * identity and put every device in a group of its own. null, undefined, ""
   * and whitespace all normalise to the same "no site" key.
   *
   * Read only when the rule is site-scoped, so a caller that never populates
   * it leaves project-scoped rules resolving exactly as before.
   */
  siteId?: string | null | undefined;
  /*
   * Display name of that site, for the warning text. Carried on the device
   * rather than looked up by the caller so the name comes from the same
   * permission-filtered rows the map itself is drawn from — a viewer can
   * never be told the name of a site none of whose devices they can read.
   */
  siteName?: string | undefined;
}

export interface LinkRuleInput {
  id: string;
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  childLabelIds: Array<string>;
  parentLabelIds: Array<string>;
  /*
   * Raw column value. Always read through NetworkDeviceLinkRuleScopeUtil.parse
   * so undefined and NULL read as Project — every rule written before the
   * column existed means "one parent for the whole project", and defaulting
   * the other way would silently redraw somebody's map.
   */
  scope?: string | undefined;
}

// Structurally identical to the inline type it replaces.
export interface LinkRuleLink {
  fromDeviceId: string;
  toDeviceId: string;
}

/*
 * Why a rule drew nothing. Reported rather than swallowed: a rule that
 * silently produces no edges is indistinguishable from a rule that is
 * working, and the operator has no way to tell which they are looking at.
 */
export type LinkRuleSkipReason =
  | "disabled"
  | "noChildLabels"
  | "noParentLabels"
  | "noParentMatched"
  | "ambiguousParent"
  | "noChildrenMatched"
  /*
   * Site scope only: sites were in play and not one of them resolved. Its own
   * reason because the per-site failures can be MIXED — one site with no
   * parent, another with two — which none of the reasons above states.
   */
  | "noSiteResolved";

/*
 * The only two ways ONE site can fail in a way worth reporting. Deliberately
 * narrower than LinkRuleSkipReason: `noChildrenMatched` is unreachable here
 * (a site with nothing to place is never considered at all), and the three
 * rule-level reasons are settled before any device is looked at.
 */
export type LinkRuleGroupSkipReason = "noParentMatched" | "ambiguousParent";

/*
 * Warnings have a slightly wider vocabulary than skips: "some matching devices
 * have no site" is not a reason the RULE drew nothing, so it has no business
 * in LinkRuleSkipReason, which describeOutcome switches over.
 */
export type LinkRuleWarningReason = LinkRuleSkipReason | "devicesWithoutSite";

/*
 * One site this rule was clearly meant to cover and could not. Independent of
 * outcome.links.length — thirteen sites can draw while the fourteenth is
 * listed here.
 */
export interface LinkRuleGroupFailure {
  siteId: string;
  siteName?: string | undefined;
  reason: LinkRuleGroupSkipReason;
  // Devices in THIS site carrying all the parent labels. 0 or >= 2.
  matchedParentCount: number;
  /*
   * Devices in THIS site carrying all the child labels — the damage count,
   * "how many nodes are floating on the map right now". No parent exclusion
   * is applied because there is no resolved parent to exclude.
   */
  matchedChildCount: number;
}

export interface LinkRuleOutcome {
  ruleId: string;
  ruleName?: string | undefined;
  // Device pairs this rule contributes, parent second.
  links: Array<LinkRuleLink>;
  /*
   * Set when links is empty and the rule had something to say about why.
   * INVARIANT, both scopes: links.length === 0 <=> skipReason !== undefined.
   * A site-scoped rule that drew in thirteen of fourteen sites has NOT been
   * skipped; the fourteenth lives in groupFailures.
   */
  skipReason?: LinkRuleSkipReason | undefined;
  /*
   * How many devices the parent labels matched — the ambiguity evidence.
   * Project scope: unchanged. Site scope: summed over the sites the rule
   * actually applies to.
   */
  matchedParentCount: number;
  // INVARIANT, both scopes: matchedChildCount === links.length.
  matchedChildCount: number;

  /*
   * The three fields below are SITE SCOPE ONLY. On the project path the keys
   * are not written at all, so a project-scoped outcome is the exact object
   * it has always been, key for key.
   */

  // Sites the rule was meant to cover and could not. Omitted when empty.
  groupFailures?: Array<LinkRuleGroupFailure> | undefined;
  /*
   * Sites this rule applies to: the ones holding at least one device it wanted
   * to place. The coverage denominator, and deliberately not "every site in
   * the project" — a healthy rule reading "drawing in 12 of 74 sites" would
   * make the coverage sentence itself the noise.
   */
  applicableSiteCount?: number | undefined;
  // Devices carrying ALL the child labels that have no site. Omitted when 0.
  unsitedChildDeviceCount?: number | undefined;
}

/** One bullet in the topology map's warning banner. At most one per rule. */
export interface LinkRuleWarning {
  ruleId: string;
  ruleName?: string | undefined;
  reason: LinkRuleWarningReason;
  message: string;
}

/*
 * Devices are normalised once per resolveRule call: the label Set is built
 * here rather than allocated afresh inside every match, and the group key is
 * stringified and trimmed here so null, undefined, "" and "  " cannot become
 * four different sites. Nothing here mutates the caller's array, which matters
 * because resolveRules hands the same array to every rule in turn.
 */
interface NormalizedDevice {
  device: LinkRuleDeviceInput;
  labelSet: Set<string>;
  // "" means the device has no site.
  siteKey: string;
}

/*
 * One site's verdict — the same decision matrix as always, asked inside a
 * narrower device set. Used by both scopes, so the parent/child matching
 * exists exactly once.
 */
interface LinkRuleGroupResult {
  // Empty on every failure path.
  links: Array<LinkRuleLink>;
  // 0, 1, or >= 2.
  parentMatchCount: number;
  // Devices carrying all the child labels, BEFORE the unique-parent exclusion.
  childMatchCount: number;
  // null when links is non-empty.
  failure: "noParentMatched" | "ambiguousParent" | "noChildrenMatched" | null;
}

export default class NetworkDeviceLinkRuleUtil {
  /*
   * Appended by the caller when the device list hit its row cap. Lives here so
   * every operator-facing string this feature produces stays in one file.
   */
  public static readonly TRUNCATED_DEVICE_LIST_NOTE: string =
    "The device list was truncated, so some of these may be false alarms.";

  // Three names is enough to recognise a pattern; fourteen is a wall of text.
  private static readonly MAX_NAMED_SITES: number = 3;
  // Site names are ShortText and can run to 100 characters.
  private static readonly MAX_SITE_NAME_LENGTH: number = 40;
  private static readonly UNNAMED_SITE: string = "an unnamed site";

  /*
   * ALL of the rule's labels must be present on the device, not any. "Devices
   * that are both an access point AND on floor 1" is the question an operator
   * is asking; any-of would sweep in every access point in the building.
   */
  private static matches(
    labelSet: Set<string>,
    requiredLabelIds: Array<string>,
  ): boolean {
    return requiredLabelIds.every((labelId: string) => {
      return labelSet.has(labelId);
    });
  }

  private static resolveGroup(
    rule: LinkRuleInput,
    group: Array<NormalizedDevice>,
  ): LinkRuleGroupResult {
    const parents: Array<NormalizedDevice> = group.filter(
      (entry: NormalizedDevice) => {
        return NetworkDeviceLinkRuleUtil.matches(
          entry.labelSet,
          rule.parentLabelIds,
        );
      },
    );

    /*
     * Counted before the parent branch, not after: a site that failed to
     * resolve still has to report how many devices are floating there, and
     * that number is the operator's damage assessment.
     */
    const childCandidates: Array<NormalizedDevice> = group.filter(
      (entry: NormalizedDevice) => {
        return NetworkDeviceLinkRuleUtil.matches(
          entry.labelSet,
          rule.childLabelIds,
        );
      },
    );
    const childMatchCount: number = childCandidates.length;

    if (parents.length === 0) {
      return {
        links: [],
        parentMatchCount: 0,
        childMatchCount: childMatchCount,
        failure: "noParentMatched",
      };
    }

    /*
     * Two candidate parents is not a tie to break — it is a question the
     * labels do not answer. Drawing to either one would assert a cabling
     * fact nobody stated.
     */
    if (parents.length > 1) {
      return {
        links: [],
        parentMatchCount: parents.length,
        childMatchCount: childMatchCount,
        failure: "ambiguousParent",
      };
    }

    const parent: NormalizedDevice = parents[0]!;

    // The parent is excluded even when it matches both sets: no self-links.
    const children: Array<NormalizedDevice> = childCandidates.filter(
      (entry: NormalizedDevice) => {
        return entry.device.id !== parent.device.id;
      },
    );

    if (children.length === 0) {
      return {
        links: [],
        parentMatchCount: 1,
        childMatchCount: childMatchCount,
        failure: "noChildrenMatched",
      };
    }

    return {
      links: children.map((child: NormalizedDevice) => {
        return { fromDeviceId: child.device.id, toDeviceId: parent.device.id };
      }),
      parentMatchCount: 1,
      childMatchCount: childMatchCount,
      failure: null,
    };
  }

  public static resolveRule(
    rule: LinkRuleInput,
    devices: Array<LinkRuleDeviceInput>,
  ): LinkRuleOutcome {
    const empty: (
      reason: LinkRuleSkipReason,
      parents?: number,
      children?: number,
    ) => LinkRuleOutcome = (
      reason: LinkRuleSkipReason,
      parents: number = 0,
      children: number = 0,
    ): LinkRuleOutcome => {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        links: [],
        skipReason: reason,
        matchedParentCount: parents,
        matchedChildCount: children,
      };
    };

    /*
     * The three checks below are properties of the rule's TEXT, true in every
     * site, so they are settled before scope is even read. A disabled rule is
     * not "disabled in Unit 7", and partitioning a rule with an empty parent
     * label set would make every site in the project ambiguous at once — the
     * worst noise outcome available.
     */
    if (rule.isEnabled === false) {
      return empty("disabled");
    }

    /*
     * An empty label set matches EVERY device, so a rule with one would link
     * the whole project to one box (or, on the parent side, be ambiguous
     * across the whole project). Refused outright rather than resolved.
     */
    if (rule.childLabelIds.length === 0) {
      return empty("noChildLabels");
    }
    if (rule.parentLabelIds.length === 0) {
      return empty("noParentLabels");
    }

    const normalized: Array<NormalizedDevice> = devices.map(
      (device: LinkRuleDeviceInput) => {
        return {
          device: device,
          labelSet: new Set<string>(device.labelIds),
          siteKey: (device.siteId || "").toString().trim(),
        };
      },
    );

    if (NetworkDeviceLinkRuleScopeUtil.isSiteScoped(rule.scope)) {
      return NetworkDeviceLinkRuleUtil.resolvePerSite(rule, normalized);
    }

    return NetworkDeviceLinkRuleUtil.resolveProject(rule, normalized, empty);
  }

  private static resolveProject(
    rule: LinkRuleInput,
    normalized: Array<NormalizedDevice>,
    empty: (
      reason: LinkRuleSkipReason,
      parents?: number,
      children?: number,
    ) => LinkRuleOutcome,
  ): LinkRuleOutcome {
    const result: LinkRuleGroupResult = NetworkDeviceLinkRuleUtil.resolveGroup(
      rule,
      normalized,
    );

    if (result.failure === "noParentMatched") {
      return empty("noParentMatched", 0);
    }
    if (result.failure === "ambiguousParent") {
      return empty("ambiguousParent", result.parentMatchCount);
    }
    if (result.failure === "noChildrenMatched") {
      return empty("noChildrenMatched", 1);
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      links: result.links,
      matchedParentCount: 1,
      matchedChildCount: result.links.length,
    };
  }

  private static resolvePerSite(
    rule: LinkRuleInput,
    normalized: Array<NormalizedDevice>,
  ): LinkRuleOutcome {
    /*
     * Bucketed in ONE pass in first-appearance order. Never
     * `devices.filter(...)` inside a loop over sites: that is O(devices x
     * sites) per rule, and this endpoint runs at ten thousand devices.
     */
    const buckets: Map<string, Array<NormalizedDevice>> = new Map<
      string,
      Array<NormalizedDevice>
    >();
    let unsitedChildDeviceCount: number = 0;

    for (const entry of normalized) {
      /*
       * A device with no site is EXCLUDED, not pooled with the other unsited
       * ones and not given a group of its own. Pooling would ask "exactly one
       * parent among all the unsited devices", a question nobody posed, and
       * would draw an edge between two boxes whose only relationship is that
       * neither has been assigned a site yet. Counted instead, so the map can
       * say how many the rule walked past.
       */
      if (entry.siteKey === "") {
        if (
          NetworkDeviceLinkRuleUtil.matches(entry.labelSet, rule.childLabelIds)
        ) {
          unsitedChildDeviceCount++;
        }
        continue;
      }

      const bucket: Array<NormalizedDevice> | undefined = buckets.get(
        entry.siteKey,
      );
      if (bucket) {
        bucket.push(entry);
      } else {
        buckets.set(entry.siteKey, [entry]);
      }
    }

    const links: Array<LinkRuleLink> = [];
    const groupFailures: Array<LinkRuleGroupFailure> = [];
    let applicableSiteCount: number = 0;
    let matchedParentCount: number = 0;

    for (const [siteId, group] of buckets) {
      const result: LinkRuleGroupResult =
        NetworkDeviceLinkRuleUtil.resolveGroup(rule, group);

      if (result.links.length > 0) {
        applicableSiteCount++;
        matchedParentCount += result.parentMatchCount;
        links.push(...result.links);
        continue;
      }

      /*
       * A site speaks only when it holds devices this rule wanted to place.
       * Sites with nothing to place are not misconfigured — the rule simply
       * does not apply there, and a parent label like `SubCategory:Router` is
       * present in nearly every site by construction. Without this gate, site
       * scoping would trade one loud failure for two hundred quiet ones and
       * the banner would be ignored inside a week.
       *
       * `noChildrenMatched` lands here too: the only child candidate was the
       * parent itself, so after the self-link exclusion there is nothing to
       * place and nothing to report.
       */
      if (
        result.childMatchCount === 0 ||
        result.failure === null ||
        result.failure === "noChildrenMatched"
      ) {
        continue;
      }

      applicableSiteCount++;
      matchedParentCount += result.parentMatchCount;
      groupFailures.push({
        siteId: siteId,
        siteName: NetworkDeviceLinkRuleUtil.siteNameOf(group),
        reason: result.failure,
        matchedParentCount: result.parentMatchCount,
        matchedChildCount: result.childMatchCount,
      });
    }

    const outcome: LinkRuleOutcome = {
      ruleId: rule.id,
      ruleName: rule.name,
      links: links,
      matchedParentCount: matchedParentCount,
      matchedChildCount: links.length,
      applicableSiteCount: applicableSiteCount,
    };

    /*
     * Keeps `links.length === 0 <=> skipReason defined` true with no gaps, so
     * describeOutcome can never fall through to "Draws 0 uplinks" on an empty
     * outcome. The second arm covers both an empty device list and a rule
     * whose labels match nothing anywhere.
     */
    if (links.length === 0) {
      outcome.skipReason =
        groupFailures.length > 0 ? "noSiteResolved" : "noChildrenMatched";
    }

    if (groupFailures.length > 0) {
      outcome.groupFailures = groupFailures;
    }
    if (unsitedChildDeviceCount > 0) {
      outcome.unsitedChildDeviceCount = unsitedChildDeviceCount;
    }

    return outcome;
  }

  /** First non-empty site name among a site's devices, if any of them carry one. */
  private static siteNameOf(
    group: Array<NormalizedDevice>,
  ): string | undefined {
    for (const entry of group) {
      if (entry.device.siteName) {
        return entry.device.siteName;
      }
    }
    return undefined;
  }

  /*
   * "Unit 4, Unit 9 and 2 more sites".
   *
   * Sorted before naming, and that is load-bearing rather than cosmetic: the
   * live view refetches every sixty seconds and the device query has no ORDER
   * BY, so an unsorted list would reshuffle the banner on every poll and read
   * as a change that did not happen. The count stays exact even when the names
   * are elided, so the operator always knows the true blast radius.
   */
  private static describeSiteList(
    failures: Array<LinkRuleGroupFailure>,
  ): string {
    const sorted: Array<LinkRuleGroupFailure> = [...failures].sort(
      (a: LinkRuleGroupFailure, b: LinkRuleGroupFailure) => {
        return (
          (a.siteName || "").localeCompare(b.siteName || "") ||
          a.siteId.localeCompare(b.siteId)
        );
      },
    );

    const names: Array<string> = sorted
      .slice(0, NetworkDeviceLinkRuleUtil.MAX_NAMED_SITES)
      .map((failure: LinkRuleGroupFailure) => {
        const name: string =
          failure.siteName || NetworkDeviceLinkRuleUtil.UNNAMED_SITE;
        return name.length > NetworkDeviceLinkRuleUtil.MAX_SITE_NAME_LENGTH
          ? `${name.slice(
              0,
              NetworkDeviceLinkRuleUtil.MAX_SITE_NAME_LENGTH - 1,
            )}…`
          : name;
      });

    const remaining: number = sorted.length - names.length;

    if (remaining > 0) {
      return `${names.join(", ")} and ${remaining} more site${
        remaining === 1 ? "" : "s"
      }`;
    }
    if (names.length === 1) {
      return names[0]!;
    }
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  public static resolveRules(
    rules: Array<LinkRuleInput>,
    devices: Array<LinkRuleDeviceInput>,
  ): Array<LinkRuleOutcome> {
    return rules.map((rule: LinkRuleInput) => {
      return NetworkDeviceLinkRuleUtil.resolveRule(rule, devices);
    });
  }

  /** One line an operator can act on, for the rule list. */
  public static describeOutcome(outcome: LinkRuleOutcome): string {
    switch (outcome.skipReason) {
      case "disabled":
        return "Disabled — draws no links.";
      case "noChildLabels":
        return "No child labels set, so this rule matches nothing.";
      case "noParentLabels":
        return "No parent labels set, so this rule matches nothing.";
      case "noParentMatched":
        return "No device carries the parent labels, so there is nothing to uplink to.";
      case "ambiguousParent":
        return `${outcome.matchedParentCount} devices carry the parent labels. Exactly one must, or there is no way to tell which is the uplink.`;
      case "noChildrenMatched":
        return "No device carries the child labels yet.";
      case "noSiteResolved":
        return "No site resolved this rule.";
      default:
        return `Draws ${outcome.matchedChildCount} uplink${
          outcome.matchedChildCount === 1 ? "" : "s"
        }.`;
    }
  }

  /**
   * The operator-facing warning, or null when the rule needs no explanation.
   *
   * Singular on purpose: ONE bullet per rule, never one per site. The banner's
   * length is then bounded by the number of rules the operator wrote — a small
   * number they control — rather than by the number of sites in their project.
   *
   * This is also the only sanctioned "did this rule fail" predicate. A caller
   * must not go back to testing `outcome.links.length === 0`, which a rule
   * drawing thirteen of fourteen sites passes while genuinely failing.
   */
  public static getWarning(outcome: LinkRuleOutcome): LinkRuleWarning | null {
    const failures: Array<LinkRuleGroupFailure> = outcome.groupFailures || [];
    const unsited: number = outcome.unsitedChildDeviceCount || 0;

    /*
     * Project scope always lands here, and this branch is what the topology
     * API used to compute inline: warn iff the rule drew nothing, using
     * describeOutcome's own words. The `!skipReason` guard makes the old
     * code's implicit assumption explicit rather than emitting a warning with
     * an undefined reason.
     */
    if (failures.length === 0 && unsited === 0) {
      if (outcome.links.length > 0 || !outcome.skipReason) {
        return null;
      }
      return {
        ruleId: outcome.ruleId,
        ruleName: outcome.ruleName,
        reason: outcome.skipReason,
        message: NetworkDeviceLinkRuleUtil.describeOutcome(outcome),
      };
    }

    const parts: Array<string> = [];
    const applicableSiteCount: number = outcome.applicableSiteCount || 0;

    if (outcome.links.length === 0) {
      parts.push("No site resolved this rule.");
    } else if (applicableSiteCount > 1) {
      // A single applicable site needs no coverage fraction.
      parts.push(
        `Drawing in ${
          applicableSiteCount - failures.length
        } of ${applicableSiteCount} sites.`,
      );
    }

    const ambiguous: Array<LinkRuleGroupFailure> = failures.filter(
      (failure: LinkRuleGroupFailure) => {
        return failure.reason === "ambiguousParent";
      },
    );
    const parentless: Array<LinkRuleGroupFailure> = failures.filter(
      (failure: LinkRuleGroupFailure) => {
        return failure.reason === "noParentMatched";
      },
    );

    if (ambiguous.length === 1) {
      /*
       * The trailing sentence deliberately echoes the project-scope wording so
       * an operator's vocabulary does not fork between the two scopes.
       */
      parts.push(
        `${
          ambiguous[0]!.matchedParentCount
        } devices carry the parent labels in ${NetworkDeviceLinkRuleUtil.describeSiteList(
          ambiguous,
        )}. Exactly one must, or there is no way to tell which is the uplink.`,
      );
    } else if (ambiguous.length > 1) {
      parts.push(
        `Several devices carry the parent labels in ${NetworkDeviceLinkRuleUtil.describeSiteList(
          ambiguous,
        )}. Exactly one per site must, or there is no way to tell which is the uplink.`,
      );
    }

    if (parentless.length > 0) {
      const stranded: number = parentless.reduce(
        (sum: number, failure: LinkRuleGroupFailure) => {
          return sum + failure.matchedChildCount;
        },
        0,
      );
      parts.push(
        `No device carries the parent labels in ${NetworkDeviceLinkRuleUtil.describeSiteList(
          parentless,
        )}, so ${stranded} ${stranded === 1 ? "device" : "devices"} there ${
          stranded === 1 ? "has" : "have"
        } no uplink.`,
      );
    }

    /*
     * Always last and always its own sentence: the fix here is "assign these
     * devices to a site", not "fix your labels", so they are never folded into
     * a site-name list.
     */
    if (unsited > 0) {
      parts.push(
        `${unsited} ${
          unsited === 1 ? "device" : "devices"
        } carrying the child labels ${
          unsited === 1 ? "is" : "are"
        } not assigned to a site, so this site-scoped rule skips ${
          unsited === 1 ? "it" : "them"
        }.`,
      );
    }

    return {
      ruleId: outcome.ruleId,
      ruleName: outcome.ruleName,
      // Highest-ranked condition present. Ambiguity outranks a missing parent.
      reason:
        ambiguous.length > 0
          ? "ambiguousParent"
          : parentless.length > 0
            ? "noParentMatched"
            : "devicesWithoutSite",
      message: parts.join(" "),
    };
  }
}
