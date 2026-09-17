/*
 * How wide a link rule's "exactly one parent" question is asked.
 *
 * A rule says every device carrying ALL the child labels gets one uplink to
 * the SINGLE device carrying ALL the parent labels. "Single" needs a universe,
 * and until now that universe was whatever device set the topology query
 * happened to hand the resolver. The same rule therefore resolved fine on a
 * site-filtered map and collapsed to `ambiguousParent` on the global one —
 * issue #3260, where fourteen units each have a router carrying
 * `SubCategory:Router` and the global map drew NO rule uplinks at all, not
 * even the thirteen unambiguous ones.
 *
 * Site asks the same question once per site instead. Opt-in, never inferred:
 * inferring it would silently change what an already-saved rule draws, and a
 * rule that quietly re-points cables is worse than one that refuses to draw.
 *
 * Stored as free text on the column (the NetworkDeviceMonitoringMethod
 * precedent), so read it through `parse` rather than comparing the raw column:
 * rows written before this existed hold NULL and must read as Project, which
 * is what they are.
 */
export enum NetworkDeviceLinkRuleScope {
  // One parent for the whole project. What every rule written so far means.
  Project = "Project",
  // One parent per site. Devices with no site are skipped, and said so.
  Site = "Site",
}

export class NetworkDeviceLinkRuleScopeUtil {
  /*
   * NULL, empty, whitespace and anything unrecognised read as Project.
   * Defaulting the other way would silently redraw somebody's map.
   */
  public static parse(
    value: string | undefined | null,
  ): NetworkDeviceLinkRuleScope {
    if ((value || "").trim().toLowerCase() === "site") {
      return NetworkDeviceLinkRuleScope.Site;
    }
    return NetworkDeviceLinkRuleScope.Project;
  }

  public static isSiteScoped(value: string | undefined | null): boolean {
    return (
      NetworkDeviceLinkRuleScopeUtil.parse(value) ===
      NetworkDeviceLinkRuleScope.Site
    );
  }
}

export default NetworkDeviceLinkRuleScope;
