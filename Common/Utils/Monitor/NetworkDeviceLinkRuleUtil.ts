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
 */

export interface LinkRuleDeviceInput {
  id: string;
  // Normalised label ids the device carries.
  labelIds: Array<string>;
}

export interface LinkRuleInput {
  id: string;
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  childLabelIds: Array<string>;
  parentLabelIds: Array<string>;
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
  | "noChildrenMatched";

export interface LinkRuleOutcome {
  ruleId: string;
  ruleName?: string | undefined;
  // Device pairs this rule contributes, parent second.
  links: Array<{ fromDeviceId: string; toDeviceId: string }>;
  // Set when links is empty and the rule had something to say about why.
  skipReason?: LinkRuleSkipReason | undefined;
  // How many devices the parent labels matched — the ambiguity evidence.
  matchedParentCount: number;
  matchedChildCount: number;
}

export default class NetworkDeviceLinkRuleUtil {
  /*
   * ALL of the rule's labels must be present on the device, not any. "Devices
   * that are both an access point AND on floor 1" is the question an operator
   * is asking; any-of would sweep in every access point in the building.
   */
  private static deviceMatches(
    device: LinkRuleDeviceInput,
    requiredLabelIds: Array<string>,
  ): boolean {
    const owned: Set<string> = new Set<string>(device.labelIds);
    return requiredLabelIds.every((labelId: string) => {
      return owned.has(labelId);
    });
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

    const parents: Array<LinkRuleDeviceInput> = devices.filter(
      (device: LinkRuleDeviceInput) => {
        return NetworkDeviceLinkRuleUtil.deviceMatches(
          device,
          rule.parentLabelIds,
        );
      },
    );

    if (parents.length === 0) {
      return empty("noParentMatched", 0);
    }

    /*
     * Two candidate parents is not a tie to break — it is a question the
     * labels do not answer. Drawing to either one would assert a cabling
     * fact nobody stated.
     */
    if (parents.length > 1) {
      return empty("ambiguousParent", parents.length);
    }

    const parent: LinkRuleDeviceInput = parents[0]!;

    const children: Array<LinkRuleDeviceInput> = devices.filter(
      (device: LinkRuleDeviceInput) => {
        // The parent is excluded even when it matches both sets: no self-links.
        return (
          device.id !== parent.id &&
          NetworkDeviceLinkRuleUtil.deviceMatches(device, rule.childLabelIds)
        );
      },
    );

    if (children.length === 0) {
      return empty("noChildrenMatched", 1);
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      links: children.map((child: LinkRuleDeviceInput) => {
        return { fromDeviceId: child.id, toDeviceId: parent.id };
      }),
      matchedParentCount: 1,
      matchedChildCount: children.length,
    };
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
      default:
        return `Draws ${outcome.matchedChildCount} uplink${
          outcome.matchedChildCount === 1 ? "" : "s"
        }.`;
    }
  }
}
