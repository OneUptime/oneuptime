import StoredDashboardViewConfig from "./StoredDashboardViewConfig";

/*
 * A LINK THAT OPENS A DASHBOARD AT ONE OF ITS WIDGETS (#10084).
 *
 * A warning that names a widget - what Drop This Metric empties, what a
 * cloud metric's Remove leaves without data (MetricReadersList) - links to
 * it: ?widget=<its id>, beside the dashboard's own range, refresh and
 * var-<name>. The board opens as it always does, then scrolls to that
 * widget once it is drawn and outlines it for a moment (DashboardWidget
 * Landing), on the dashboard inside OneUptime and on its public link alike.
 * A widget the board no longer has opens the board at its top, and says so.
 *
 * A widget is named by the id the board draws it under
 * (StoredDashboardViewConfig.getComponentIds): its own, or the one every
 * reader derives for a widget stored without one. Ids are compared in any
 * case and with spaces around them, as people paste links.
 */

// The query parameter a link names its widget in: ?widget=<id>.
export const DASHBOARD_WIDGET_LINK_PARAMETER: string = "widget";

/*
 * Longer than any id a widget is drawn under (a UUID is 36 characters):
 * such a value is read as none without being looked at.
 */
const MAX_LINK_VALUE_LENGTH: number = 128;

// What an id can be made of: a UUID's letters, digits and dashes, or a plain name's.
const WIDGET_ID_PATTERN: RegExp = /^[a-z0-9_-]+$/;

/*
 * The widget id a link names, as it is compared (lower case, trimmed), or ""
 * when it names none an id could be.
 */
export function parseDashboardLinkWidgetId(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_LINK_VALUE_LENGTH) {
    return "";
  }

  const id: string = value.trim().toLowerCase();

  return WIDGET_ID_PATTERN.test(id) ? id : "";
}

// The widget a page's address names in its query string (location.search).
export function getDashboardLinkWidgetIdFromSearch(search: string): string {
  try {
    return parseDashboardLinkWidgetId(
      new URLSearchParams(search || "").get(DASHBOARD_WIDGET_LINK_PARAMETER),
    );
  } catch {
    return "";
  }
}

// The query a link opens a dashboard at a widget with; none for no widget.
export function getDashboardWidgetLinkQuery(
  widgetId: string | null | undefined,
): Record<string, string> {
  const id: string = parseDashboardLinkWidgetId(widgetId || "");

  return id
    ? { [DASHBOARD_WIDGET_LINK_PARAMETER]: encodeURIComponent(id) }
    : {};
}

// Whether a widget, by the componentId it is drawn under, is the one a link names.
export function isDashboardLinkWidget(
  componentId: unknown,
  linkedWidgetId: string,
): boolean {
  const id: string | null =
    StoredDashboardViewConfig.getComponentIdString(componentId);

  return Boolean(
    linkedWidgetId &&
      id &&
      id.toLowerCase() === parseDashboardLinkWidgetId(linkedWidgetId),
  );
}

// The widget of a board's that a link names, or null when the board has none such.
export function findDashboardLinkWidget<T extends { componentId: unknown }>(
  components: ReadonlyArray<T>,
  linkedWidgetId: string,
): T | null {
  if (!linkedWidgetId) {
    return null;
  }

  return (
    components.find((component: T): boolean => {
      return isDashboardLinkWidget(component.componentId, linkedWidgetId);
    }) || null
  );
}
