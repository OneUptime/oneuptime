/*
 * The shape of the scheduled "Uptime Report" email for a status page.
 *
 * A status page organises its resources into a tree of groups (Corporate Unit ->
 * Region -> Market -> Unit), and every level of that tree shows a rolled up
 * availability on the live page. Recipients of this email frequently have no
 * login, so the report has to carry the same hierarchy - a flat list of monitor
 * names says nothing about which region or unit a monitor belongs to.
 *
 * Three views of the same numbers are exposed, because the built-in email
 * template and customer authored templates need different things:
 *
 *   - `resources`  - every resource, flat. The original shape, kept so templates
 *                    written before groups existed keep rendering. Each row now
 *                    also carries the group it belongs to.
 *   - `groups`     - the nested tree, for templates that can recurse.
 *   - `rows`       - the tree flattened into render order with a `depth` on each
 *                    row. Email HTML cannot recurse comfortably, so the built-in
 *                    template walks this.
 */

export interface StatusPageReportItem {
  resourceName: string;
  totalIncidentCount: number;
  uptimePercent: number;
  uptimePercentAsString: string;
  downtimeInHoursAndMinutes: string;
  /*
   * The group this resource is attached to directly. Empty string when the
   * resource is not in any group (it renders above the groups on the live page).
   */
  groupName: string;
  /*
   * Every group from the top of the tree down to this resource's own group,
   * joined with " / " - e.g. "Region 001 / Market 001 / Unit 0660". Empty string
   * when the resource is not in any group.
   */
  groupPath: string;
}

/*
 * Numbers rolled up over a group and everything nested under it - the same set
 * of resources the live status page rolls a group's uptime over.
 */
export interface StatusPageReportGroupMetrics {
  uptimePercent: number;
  uptimePercentAsString: string;
  downtimeInHoursAndMinutes: string;
  totalIncidentCount: number;
}

export interface StatusPageReportGroup extends StatusPageReportGroupMetrics {
  groupName: string;
  // Ancestors and this group joined with " / ".
  groupPath: string;
  // 0 for a top level group, 1 for its children, and so on.
  depth: number;
  // Resources in this group AND in every group nested under it.
  totalResources: number;
  // Resources attached to this group directly, in status page order.
  resources: Array<StatusPageReportItem>;
  subGroups: Array<StatusPageReportGroup>;
}

/*
 * One line of the report, in the order the live status page renders it:
 * ungrouped resources first, then each group followed by its own resources and
 * then its sub groups.
 */
export interface StatusPageReportRow {
  isGroup: boolean;
  name: string;
  depth: number;
  // Precomputed so an email template does not have to do arithmetic in Handlebars.
  indentInPixels: number;
  uptimePercentAsString: string;
  downtimeInHoursAndMinutes: string;
  totalIncidentCount: number;
  /*
   * Only meaningful on a group row: how many resources the group rolls up.
   * Always 0 on a resource row.
   */
  totalResources: number;
}

export interface StatusPageReport {
  reportDates: string; // start date and end date in string. e.g. "01 July 2021 - 14 July 2021"
  totalResources: number;
  totalIncidents: number;
  averageUptimePercent: string;
  totalDowntimeInHoursAndMinutes: string;
  resources: Array<StatusPageReportItem>;
  groups: Array<StatusPageReportGroup>;
  // Resources that are not in any group, in status page order.
  ungroupedResources: Array<StatusPageReportItem>;
  rows: Array<StatusPageReportRow>;
  // Whether this status page organises its resources into groups at all.
  hasGroups: boolean;
}
