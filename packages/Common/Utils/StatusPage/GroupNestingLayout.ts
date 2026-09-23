import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroupViewMode from "../../Types/StatusPage/StatusPageGroupViewMode";

/*
 * Status page groups nest (Corporate Unit -> Region -> Market -> Site) and the
 * overview page draws that nesting.
 *
 * Drawing each level as a card inside a card inside a card is what it used to
 * do, and it does not survive contact with a real hierarchy: four borders end
 * up wrapped around one uptime bar, every level eats horizontal room the bars
 * need, and a leaf resource ends up rendered larger than the group that
 * contains it. Below the top level a group is therefore drawn as a row hanging
 * off a tree rail - one hairline down the left, one indent step, no extra card.
 *
 * The numbers live here rather than inline in the page because they are the
 * part that has to hold at depth 1 and still hold at depth 12, and that is
 * worth pinning down in tests.
 */

/* What a group header shows on its right hand side, if anything. */
export enum StatusPageGroupRollupKind {
  UptimePercent = "UptimePercent",
  CurrentStatus = "CurrentStatus",
  None = "None",
}

export default class StatusPageGroupNestingLayoutUtil {
  /*
   * Beyond this depth the indent step shrinks instead of growing. Nesting is
   * capped on write at StatusPageGroupTreeUtil.MaxNestingDepth, but rows
   * written straight to the database are not, so the layout is not allowed to
   * assume any particular ceiling.
   */
  public static readonly MaxIndentedDepth: number = 4;

  /*
   * A depth that is not a whole number >= 0 is treated as the top level. The
   * page derives depth from a recursive render, but nothing stops a caller (or
   * a future refactor) from handing over -1 or NaN, and a broken indent is not
   * worth a broken page.
   */
  public static getVisualDepth(data: { depth: number }): number {
    if (!Number.isFinite(data.depth)) {
      return 0;
    }

    const depth: number = Math.floor(data.depth);

    if (depth <= 0) {
      return 0;
    }

    return Math.min(depth, this.MaxIndentedDepth);
  }

  public static isRootLevel(data: { depth: number }): boolean {
    return this.getVisualDepth({ depth: data.depth }) === 0;
  }

  /*
   * Nesting is expressed with the rail, so the title only ever steps down once
   * - and never below the size a resource name renders at. That inversion, a
   * text-sm group heading over a text-lg resource, is what made the old nesting
   * read upside down.
   */
  /*
   * Truncates at every width, including on a phone. Wrapping was tried and is
   * worse: the title is the only shrinkable item in the header row, so next to a
   * sub group badge and a rollup it collapses to a ~30px column and breaks a
   * name one character per line. An ellipsis with the full name in `title` is the
   * lesser evil.
   */
  public static getTitleClassName(data: { depth: number }): string {
    const base: string = "min-w-0 truncate font-semibold text-gray-900";

    if (this.isRootLevel(data)) {
      return `${base} text-base sm:text-lg tracking-tight`;
    }

    return `${base} text-base tracking-tight`;
  }

  /*
   * A resource name, as rendered by MonitorOverview. It lives here so the floor
   * a group title has to clear is the same string the resource actually renders
   * with, rather than a number written down next to it.
   */
  public static getResourceTitleClassName(): string {
    return "text-base font-medium";
  }

  /*
   * The chevron box and the gap after it are what set where a title starts, and
   * a sub group's contents and a group description are both aligned to that. All
   * three are derived from these two, so moving the chevron moves them with it.
   */
  public static getChevronBoxClassName(): string {
    return "flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition-colors";
  }

  public static getHeaderRowClassName(): string {
    return "flex min-w-0 flex-1 items-center gap-2.5";
  }

  /*
   * A nested group is not a card. It is a block in the parent's body, so all it
   * gets is the vertical rhythm that separates it from its siblings.
   */
  public static getContainerClassName(data: { depth: number }): string {
    if (this.isRootLevel(data)) {
      return "bg-white rounded-xl shadow px-4 py-3 sm:px-6 sm:py-4";
    }

    return "";
  }

  /*
   * Resources that belong to no group at all get their own card at the top of
   * the page. It is the same surface as a top level group, minus the header.
   */
  public static getUngroupedResourcesCardClassName(): string {
    return "bg-white rounded-xl shadow px-4 py-4 sm:px-6 sm:py-5";
  }

  /* Vertical rhythm between the resources of one group. */
  public static getResourceListClassName(): string {
    return "space-y-4 sm:space-y-5";
  }

  /*
   * Quieter than the per-resource labels it replaces. It is a scale, not a
   * reading, and it is what made a nested block look shouty when it appeared
   * three times in one screen.
   */
  public static getTimeAxisClassName(): string {
    return "flex justify-between text-[11px] text-gray-400";
  }

  /*
   * The rolled up reading on the right of a group header. Sized to match the
   * per-resource readings below it: a rollup and a resource reading are the same
   * kind of number, and the status dot is what tells them apart.
   */
  public static getRollupClassName(): string {
    return "flex-shrink-0 text-sm sm:text-base font-medium";
  }

  public static getHeaderClassName(data: { depth: number }): string {
    /*
     * The whole row is the disclosure control, so it carries the hover state.
     * Negative horizontal margin with matching padding lets that hover reach the
     * edge of the content column while the row's contents stay aligned with the
     * resources below it.
     *
     * The width has to pay for both margins explicitly. A button shrink wraps
     * even as a flex container, so it needs a width; but `w-full` with both
     * negative margins over-constrains the box, and the browser resolves that by
     * dropping margin-right (CSS 2.1 10.3.3) - which leaves every rollup 16px
     * short of the card edge the resource readings below it sit on. 100% + 1rem
     * satisfies the equation exactly, so nothing is dropped.
     */
    const base: string =
      "flex w-[calc(100%+1rem)] items-center justify-between gap-3 text-left rounded-lg -mx-2 px-2 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300";

    return this.isRootLevel(data) ? `${base} py-2` : `${base} py-1.5`;
  }

  /*
   * The rail and the indent that carry one nesting step.
   *
   * `ml` moves the rail under its parent's chevron and `pl` pushes the contents
   * clear of it, so the two together land a sub group's contents at the parent's
   * title. Past MaxIndentedDepth the step tightens rather than stops: the rails
   * have to stay distinguishable, but a deep tree still has to leave room for
   * the uptime bars on a phone.
   */
  private static getIndentClassName(data: { depth: number }): string {
    const visualDepth: number = this.getVisualDepth(data);

    if (visualDepth === 0) {
      return "";
    }

    if (visualDepth < this.MaxIndentedDepth) {
      return "ml-2.5 sm:ml-3 pl-4 sm:pl-5";
    }

    return "ml-1.5 pl-3";
  }

  /*
   * Everything a group contains - its own resources and then its sub groups -
   * lives in one body so a single rail covers all of it.
   */
  public static getBodyClassName(data: { depth: number }): string {
    if (this.isRootLevel(data)) {
      // The card's own padding is the boundary at the top level; no rail.
      return "mt-3 space-y-4";
    }

    return `mt-2.5 space-y-3.5 border-l border-gray-200 ${this.getIndentClassName(
      data,
    )}`;
  }

  public static showRail(data: { depth: number }): boolean {
    return !this.isRootLevel(data);
  }

  public static getSubGroupListClassName(data: { depth: number }): string {
    return this.isRootLevel(data) ? "space-y-3" : "space-y-2.5";
  }

  /*
   * A group with resources of its own *and* sub groups needs a line between the
   * two, otherwise its last resource reads as belonging to the first sub group.
   */
  public static shouldShowSubGroupDivider(data: {
    hasOwnResources: boolean;
    subGroupCount: number;
  }): boolean {
    return data.hasOwnResources && data.subGroupCount > 0;
  }

  public static getSubGroupDividerClassName(): string {
    return "border-t border-gray-100 pt-3.5";
  }

  /*
   * The group description hangs under the title, indented past the chevron so
   * it lines up with the name rather than with the disclosure control. It sits
   * outside the header button on purpose: a description is markdown and may
   * contain links, which cannot live inside a button.
   *
   * The indent is 34px: the 24px chevron box (w-6, see getChevronBoxClassName)
   * plus the 10px gap after it (gap-2.5, see getHeaderRowClassName).
   *
   * Alignment only. Type and vertical rhythm are MarkdownViewer's - it sets
   * them on the paragraph it renders, which beats anything inherited from here,
   * so declaring a size or a colour on this wrapper would just be a comment that
   * looks like code.
   */
  public static getDescriptionClassName(): string {
    return "pl-[34px] pr-2";
  }

  public static getSubGroupCountBadgeClassName(): string {
    return "flex-shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 tabular-nums";
  }

  /* The status dot that marks a reading as a rollup rather than a resource's own. */
  public static getRollupDotClassName(): string {
    return "h-1.5 w-1.5 flex-shrink-0 rounded-full";
  }

  public static getRollupLabelClassName(): string {
    return "font-semibold tabular-nums";
  }

  /*
   * A group that only exists to hold sub groups has no resources of its own,
   * and telling the visitor it is empty would be wrong - the sub groups below
   * it are its content. A group with neither still renders its (empty) resource
   * list, because that is where the "no resources" message belongs.
   */
  public static shouldRenderOwnResources(data: {
    ownResourceCount: number;
    subGroupCount: number;
  }): boolean {
    return data.ownResourceCount > 0 || data.subGroupCount === 0;
  }

  /*
   * Whether the overview page draws its resources-and-groups block at all.
   *
   * This was `statusPageResources.length > 0` written inline on the page, and
   * it meant a status page carrying a fully built group hierarchy but no
   * monitors yet rendered nothing at all: an operator who had just created
   * their whole hierarchy saw an empty overview until the first monitor was
   * attached to one of the groups. A group is content in its own right - the
   * hierarchy is what a large status page is organised around, and it has to
   * be visible while it is being filled in - so either resources or groups are
   * enough to draw the block.
   */
  public static shouldRenderResourcesSection(data: {
    statusPageResourceCount: number;
    statusPageGroupCount: number;
  }): boolean {
    return data.statusPageResourceCount > 0 || data.statusPageGroupCount > 0;
  }

  /*
   * The "all clear" empty state is the page's fallback for when there is
   * nothing whatsoever to draw, so it has to agree with
   * shouldRenderResourcesSection: a page with groups and no monitors renders
   * its hierarchy, and an empty state stacked above that hierarchy would be
   * telling the visitor the opposite of what is on the screen underneath it.
   */
  public static shouldRenderOverviewEmptyState(data: {
    statusPageResourceCount: number;
    statusPageGroupCount: number;
    activeIncidentCount: number;
    activeEpisodeCount: number;
    activeScheduledMaintenanceCount: number;
    activeAnnouncementCount: number;
  }): boolean {
    if (
      this.shouldRenderResourcesSection({
        statusPageResourceCount: data.statusPageResourceCount,
        statusPageGroupCount: data.statusPageGroupCount,
      })
    ) {
      return false;
    }

    return (
      data.activeIncidentCount === 0 &&
      data.activeEpisodeCount === 0 &&
      data.activeScheduledMaintenanceCount === 0 &&
      data.activeAnnouncementCount === 0
    );
  }

  /*
   * Whether a group draws the time axis under its own resource list.
   *
   * Once per resource list rather than once per resource: every bar in one list
   * is drawn over the same window and sits in the same column, so one axis
   * describes all of them. It deliberately does not cover sub groups - their
   * bars are indented past this one, and they may be collapsed, so an axis up
   * here would be labelling a column that is not there.
   *
   * A group in grid view draws a matrix of cells instead of bars, so its
   * resources are not something a time axis describes.
   */
  public static shouldRenderTimeAxis(data: {
    statusPageGroup: StatusPageGroup | null;
    statusPageResources: Array<StatusPageResource>;
  }): boolean {
    if (data.statusPageGroup?.viewMode === StatusPageGroupViewMode.Grid) {
      return false;
    }

    const groupId: string | null =
      data.statusPageGroup?._id?.toString() || null;

    return (
      data.statusPageResources.find((resource: StatusPageResource) => {
        if (!resource.showStatusHistoryChart) {
          return false;
        }

        /*
         * Skipped for the same reason the page skips them - a resource that
         * resolves to neither a monitor nor a monitor group draws nothing.
         */
        if (!resource.monitor && !resource.monitorGroupId) {
          return false;
        }

        const resourceGroupId: string | null =
          resource.statusPageGroupId?.toString() || null;

        return resourceGroupId === groupId;
      }) !== undefined
    );
  }

  /*
   * Which rolled up reading a group header shows.
   *
   * A group that is currently down shows its status rather than an uptime
   * percent - "99.9% uptime" next to a red group is not the thing a visitor came
   * to read - and a group whose uptime cannot be worked out (no resources under
   * it at all) shows nothing rather than a zero.
   */
  public static getRollupKind(data: {
    showUptimePercent: boolean;
    showCurrentStatus: boolean;
    isCurrentlyDown: boolean;
    uptimePercent: number | null;
    /*
     * How many resources the group's whole subtree contains. Zero means there
     * is nothing under this group to report on.
     */
    resourceCountInSubtree: number;
  }): StatusPageGroupRollupKind {
    /*
     * A group with nothing under it has no reading to give - not an uptime
     * percent and not a status. This did not use to come up, because a page
     * with no resources rendered no groups at all; now that a hierarchy is
     * drawn while it is still being filled in, it does. The rolled up status
     * defaults to Operational when it finds nothing to look at, and a green
     * "Operational" against a group that contains no monitors is a claim about
     * availability the page has no basis for.
     */
    if (data.resourceCountInSubtree <= 0) {
      return StatusPageGroupRollupKind.None;
    }

    if (data.showUptimePercent && !data.isCurrentlyDown) {
      return data.uptimePercent === null
        ? StatusPageGroupRollupKind.None
        : StatusPageGroupRollupKind.UptimePercent;
    }

    return data.showCurrentStatus
      ? StatusPageGroupRollupKind.CurrentStatus
      : StatusPageGroupRollupKind.None;
  }
}
