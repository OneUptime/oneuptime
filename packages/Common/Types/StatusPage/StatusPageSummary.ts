import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * A STATUS PAGE IN BRIEF: WHAT A MONITORING TOOL ASKS OF IT.
 *
 * GET /status-page-api/summary/<status page id or custom domain> answers it
 * (StatusPageAPI): the page's overall status, each resource it shows with
 * its current status and whether a scheduled maintenance event in progress
 * affects it, the active incidents, and the maintenance in progress and to
 * come. It is the overview the page itself draws, cut down
 * (Utils/StatusPage/StatusPageSummaryBuilder): it holds only what a visitor
 * of the page is shown, and only for a reader the page lets in.
 *
 * Another OneUptime's External Status Page monitor reads it to watch this
 * page (ExternalStatusPageProviderType.OneUptime), so it is plain JSON - no
 * `_type` wrappers - and every reader takes it through fromJSON, which reads
 * what a server it does not control sent defensively.
 *
 *   - A resource is a monitor or a monitor group on the page, by the name the
 *     page gives it - never the monitor's own name, which is the team's.
 *   - Its group is the page's group it sits in, with the groups above it:
 *     "Core / Databases" for a group nested in another.
 *   - Its current status is null when the page does not show it (the
 *     resource's Show current status is off), as the uptime endpoint answers.
 *   - It is under maintenance while a scheduled maintenance event in
 *     progress names one of its monitors (a monitor group's, for a group) -
 *     whatever status those monitors are left in: a monitor is not checked
 *     while an event holds it, so its status says nothing then.
 *   - Incidents and maintenance name what they affect by resource id. A list
 *     the page does not show (incidents, scheduled maintenance) is empty.
 */

// A status as the page shows it.
export interface StatusPageSummaryStatus {
  name: string;
  // The status's color, as hex (#2ab57d), or null when it has none.
  color: string | null;
  // Whether the status is the project's operational one.
  isOperational: boolean;
}

// A monitor or monitor group the page shows.
export interface StatusPageSummaryResource {
  // The status page resource's id.
  id: string;
  // Its name on the page.
  name: string;
  // The page's group it sits in, with the groups above it; null for none.
  groupName: string | null;
  // Null when the page does not show the resource's current status.
  currentStatus: StatusPageSummaryStatus | null;
  // Whether a scheduled maintenance event in progress affects it.
  isUnderMaintenance: boolean;
}

// An incident the page shows as active.
export interface StatusPageSummaryIncident {
  id: string;
  title: string;
  // When it was declared, as the page dates it (ISO 8601).
  declaredAt: string | null;
  state: string | null;
  severity: string | null;
  affectedResourceIds: Array<string>;
}

// A scheduled maintenance event the page shows as in progress or to come.
export interface StatusPageSummaryMaintenance {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  state: string | null;
  affectedResourceIds: Array<string>;
}

export interface StatusPageSummary {
  // The page's overall status, as its banner shows it; null for an empty page.
  overallStatus: StatusPageSummaryStatus | null;
  resources: Array<StatusPageSummaryResource>;
  activeIncidents: Array<StatusPageSummaryIncident>;
  ongoingScheduledMaintenance: Array<StatusPageSummaryMaintenance>;
  upcomingScheduledMaintenance: Array<StatusPageSummaryMaintenance>;
}

// What a group path is joined with: "Core / Databases".
export const STATUS_PAGE_SUMMARY_GROUP_SEPARATOR: string = " / ";

/*
 * The name a resource with no status of its own is shown under: the page
 * draws such a resource as Operational, in green.
 */
export const STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME: string = "Operational";

type JsonRecord = { [key: string]: unknown };

const isRecord: (value: unknown) => value is JsonRecord = (
  value: unknown,
): value is JsonRecord => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

// A text field, trimmed; null when it is missing or not text.
const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed : null;
};

// The ids in a list, as text, each once, in order.
const readIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Set<string> = new Set<string>();

  for (const item of value) {
    const id: string | null = readText(item);

    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
};

export default class StatusPageSummaryUtil {
  /*
   * The route, under the status page API (/status-page-api on a status
   * page's host, /api/status-page inside OneUptime).
   */
  public static getRoute(statusPageIdOrDomain: string): string {
    return `/summary/${encodeURIComponent(statusPageIdOrDomain)}`;
  }

  /*
   * Where the summary of the status page at `statusPageUrl` is read, or
   * null when the address is not one a status page can have. A page is at
   * one of two addresses, and any page under it names it too (/incidents,
   * /rss):
   *
   *   https://status.example.com            its own domain: asked by domain
   *   https://oneuptime.com/status-page/<id> under OneUptime: asked by id
   *
   * Either way the status page API is on the same host, under
   * /status-page-api. An address without a scheme is read as https.
   */
  public static getSummaryUrl(statusPageUrl: string): string | null {
    const trimmed: string = (statusPageUrl || "").trim();

    if (!trimmed) {
      return null;
    }

    // An address that names its scheme keeps it, and only http(s) is read.
    const withScheme: string = trimmed.includes("://")
      ? trimmed
      : `https://${trimmed}`;

    let url: URL;

    try {
      url = new URL(withScheme);
    } catch {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const hostname: string = url.hostname.toLowerCase();

    if (!hostname) {
      return null;
    }

    const segments: Array<string> = url.pathname
      .split("/")
      .filter((segment: string): boolean => {
        return Boolean(segment);
      });

    const statusPageId: string | undefined =
      segments[0]?.toLowerCase() === "status-page" &&
      segments[1] &&
      ObjectID.isValidUUID(segments[1])
        ? segments[1].toLowerCase()
        : undefined;

    return `${url.protocol}//${url.host}/status-page-api${StatusPageSummaryUtil.getRoute(
      statusPageId || hostname,
    )}`;
  }

  public static toJSON(summary: StatusPageSummary): JSONObject {
    return {
      overallStatus: StatusPageSummaryUtil.statusToJSON(summary.overallStatus),
      resources: summary.resources.map(
        (resource: StatusPageSummaryResource): JSONObject => {
          return {
            id: resource.id,
            name: resource.name,
            groupName: resource.groupName,
            currentStatus: StatusPageSummaryUtil.statusToJSON(
              resource.currentStatus,
            ),
            isUnderMaintenance: resource.isUnderMaintenance,
          };
        },
      ),
      activeIncidents: summary.activeIncidents.map(
        (incident: StatusPageSummaryIncident): JSONObject => {
          return {
            id: incident.id,
            title: incident.title,
            declaredAt: incident.declaredAt,
            state: incident.state,
            severity: incident.severity,
            affectedResourceIds: [...incident.affectedResourceIds],
          };
        },
      ),
      ongoingScheduledMaintenance: summary.ongoingScheduledMaintenance.map(
        (event: StatusPageSummaryMaintenance): JSONObject => {
          return StatusPageSummaryUtil.maintenanceToJSON(event);
        },
      ),
      upcomingScheduledMaintenance: summary.upcomingScheduledMaintenance.map(
        (event: StatusPageSummaryMaintenance): JSONObject => {
          return StatusPageSummaryUtil.maintenanceToJSON(event);
        },
      ),
    };
  }

  /*
   * A summary as another server sent it, or null when what it sent is not
   * one: a summary has its three lists. Read defensively - a resource,
   * incident or event without an id, or a resource without a name, is left
   * out; a field of the wrong type reads as missing.
   */
  public static fromJSON(json: unknown): StatusPageSummary | null {
    if (!isRecord(json)) {
      return null;
    }

    if (
      !Array.isArray(json["resources"]) ||
      !Array.isArray(json["activeIncidents"]) ||
      !Array.isArray(json["ongoingScheduledMaintenance"])
    ) {
      return null;
    }

    const resources: Array<StatusPageSummaryResource> = [];
    const resourceIds: Set<string> = new Set<string>();

    for (const item of json["resources"] as Array<unknown>) {
      if (!isRecord(item)) {
        continue;
      }

      const id: string | null = readText(item["id"]);
      const name: string | null = readText(item["name"]);

      if (!id || !name || resourceIds.has(id)) {
        continue;
      }

      resourceIds.add(id);

      resources.push({
        id: id,
        name: name,
        groupName: readText(item["groupName"]),
        currentStatus: StatusPageSummaryUtil.statusFromJSON(
          item["currentStatus"],
        ),
        isUnderMaintenance: item["isUnderMaintenance"] === true,
      });
    }

    const activeIncidents: Array<StatusPageSummaryIncident> = [];

    for (const item of json["activeIncidents"] as Array<unknown>) {
      if (!isRecord(item)) {
        continue;
      }

      const id: string | null = readText(item["id"]);

      if (!id) {
        continue;
      }

      activeIncidents.push({
        id: id,
        title: readText(item["title"]) || "",
        declaredAt: readText(item["declaredAt"]),
        state: readText(item["state"]),
        severity: readText(item["severity"]),
        affectedResourceIds: readIds(item["affectedResourceIds"]),
      });
    }

    return {
      overallStatus: StatusPageSummaryUtil.statusFromJSON(
        json["overallStatus"],
      ),
      resources: resources,
      activeIncidents: activeIncidents,
      ongoingScheduledMaintenance:
        StatusPageSummaryUtil.maintenanceListFromJSON(
          json["ongoingScheduledMaintenance"],
        ),
      upcomingScheduledMaintenance:
        StatusPageSummaryUtil.maintenanceListFromJSON(
          json["upcomingScheduledMaintenance"],
        ),
    };
  }

  private static statusToJSON(
    status: StatusPageSummaryStatus | null,
  ): JSONObject | null {
    if (!status) {
      return null;
    }

    return {
      name: status.name,
      color: status.color,
      isOperational: status.isOperational,
    };
  }

  private static statusFromJSON(
    value: unknown,
  ): StatusPageSummaryStatus | null {
    if (!isRecord(value)) {
      return null;
    }

    const name: string | null = readText(value["name"]);

    if (!name) {
      return null;
    }

    return {
      name: name,
      color: readText(value["color"]),
      isOperational: value["isOperational"] === true,
    };
  }

  private static maintenanceToJSON(
    event: StatusPageSummaryMaintenance,
  ): JSONObject {
    return {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      state: event.state,
      affectedResourceIds: [...event.affectedResourceIds],
    };
  }

  private static maintenanceListFromJSON(
    value: unknown,
  ): Array<StatusPageSummaryMaintenance> {
    if (!Array.isArray(value)) {
      return [];
    }

    const events: Array<StatusPageSummaryMaintenance> = [];

    for (const item of value) {
      if (!isRecord(item)) {
        continue;
      }

      const id: string | null = readText(item["id"]);

      if (!id) {
        continue;
      }

      events.push({
        id: id,
        title: readText(item["title"]) || "",
        startsAt: readText(item["startsAt"]),
        endsAt: readText(item["endsAt"]),
        state: readText(item["state"]),
        affectedResourceIds: readIds(item["affectedResourceIds"]),
      });
    }

    return events;
  }
}
