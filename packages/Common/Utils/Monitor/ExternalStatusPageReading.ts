import {
  StatusPageSummary,
  StatusPageSummaryIncident,
  StatusPageSummaryResource,
} from "../../Types/StatusPage/StatusPageSummary";
import ExternalStatusPageComponentStatusUtil from "./ExternalStatusPageComponentStatusUtil";
import { withoutTrailingSlashes } from "../TrailingRuns";
import { fillTemplate, translationKey } from "../../Types/Translator";

/*
 * WHAT A STATUS PAGE SAYS, READ FROM ITS ANSWERS.
 *
 * The probe's External Status Page monitor and the Dashboard's component
 * picker read a page the same way, so a component a person picks in the
 * form is the component the probe watches, by the same name and in the
 * same group:
 *
 *   - Atlassian Statuspage: /api/v2/status.json (the page's own status),
 *     /api/v2/components.json (its components; a component that is a group
 *     header names a group) and /api/v2/incidents/unresolved.json (its
 *     active incidents, each naming the components it affects);
 *   - incident.io: the proxy the page's own front end reads, keyed by its
 *     host, with the components, their groups (its structure), the
 *     components affected now and the ongoing incidents;
 *   - a OneUptime status page: its summary (Types/StatusPage/
 *     StatusPageSummary), each resource a component and each active
 *     incident naming the resources it affects.
 *
 * Every answer is outside text: anything that is not the shape documented
 * is skipped, never trusted, and a page lists at most
 * EXTERNAL_STATUS_PAGE_MAX_COMPONENTS components and
 * EXTERNAL_STATUS_PAGE_MAX_INCIDENTS incidents.
 */

export const EXTERNAL_STATUS_PAGE_MAX_COMPONENTS: number = 5000;
export const EXTERNAL_STATUS_PAGE_MAX_INCIDENTS: number = 1000;

// The name an incident goes by when the page gives it none.
export const EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT: string = "Unknown incident";

/*
 * ONEUPTIME'S OWN NOTES ON A ONEUPTIME PAGE'S COMPONENT.
 *
 * A OneUptime page's resource is described by its status's name, which is
 * the page's own word - unless the page gives it no status, when the probe
 * writes a note of its own as the component's description. Each is a
 * translation key (the Dashboard's npm run i18n:extract reads this
 * directory), so the monitor's summary draws it in the reader's language
 * (readOneUptimeNote) while the probe stores the English, as every check's
 * description is stored.
 */

// A OneUptime page's component's description when the page does not show its status.
export const EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN: string =
  translationKey("The status page does not show this resource's status.");

/*
 * A OneUptime page's component's description when nothing checks it: its
 * monitoring is off, so the page shows it as not monitored and gives it no
 * status (StatusPageSummaryResource.isMonitored).
 */
export const EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED: string =
  translationKey("The status page shows this resource as not monitored.");

/*
 * A OneUptime page's component's description while a scheduled maintenance
 * event in progress affects it: the events' titles - the page's own words -
 * after the note, or the note alone when they have none. The note alone
 * only repeats the component's status (Under Maintenance), which the
 * summary says once, so it is no translation key.
 */
export const EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE: string =
  "Under maintenance";

export const EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF: string =
  translationKey("Under maintenance: {{events}}");

// What comes before the events' titles in a note of maintenance.
const UNDER_MAINTENANCE_OF_PREFIX: string =
  EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF.slice(
    0,
    EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF.indexOf("{{events}}"),
  );

// The notes that are whole sentences, with nothing of the page's in them.
const ONEUPTIME_SENTENCE_NOTES: ReadonlyArray<string> = [
  EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
];

/*
 * WHY A ONEUPTIME PAGE COULD NOT BE READ.
 *
 * With the OneUptime Status Page provider chosen, a page that answers but
 * will not let the probe in fails the check, and the probe writes why as
 * the check's failure cause (ExternalStatusPageMonitor's
 * tryOneUptimeStatusPage): a private page (sign-in or password), or one
 * whose IP allowlist leaves the probe out. Each is a translation key, as
 * the notes above are, so the monitor's summary draws its Error in the
 * reader's language (readOneUptimeFailureCause) while the probe stores the
 * English: monitor criteria and logs compare that English, so it never
 * changes.
 */
export const EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE: string =
  translationKey(
    "This status page is private: only people who sign in to it, or who know its password, can read it. Only a public status page can be watched.",
  );

export const EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE: string =
  translationKey(
    "This status page lets in only the IP addresses on its allowlist, and this probe's address is not one of them. Add the probe's address to the allowlist, or watch the page from a probe inside that network.",
  );

// The failure causes the probe writes in OneUptime's words, each a whole sentence.
const ONEUPTIME_FAILURE_CAUSES: ReadonlyArray<string> = [
  EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
];

/*
 * One of OneUptime's notes, read back from a component's description: the
 * note's English (a translation key) and the page's words that fill it.
 */
export interface ExternalStatusPageOneUptimeNote {
  template: string;
  values: Record<string, string>;
}

// A page's component, before the monitor's scope is applied.
export interface ExternalStatusPageComponent {
  name: string;
  status: string;
  description?: string | undefined;
  groupName?: string | undefined;
  /*
   * What identifies the component when its name may not: the page's id for
   * it. Two components of one name in two groups are told apart by it.
   */
  key?: string | undefined;
  /*
   * False when the page says nothing checks the component - a OneUptime
   * page's resource whose monitoring is off. Its status is unknown, and it
   * decides no overall status (ExternalStatusPageScope.deriveOverallStatus),
   * as it decides nothing on the page's own banner. Unset otherwise.
   */
  isMonitored?: boolean | undefined;
}

// A page's active incident, before the monitor's scope is applied.
export interface ExternalStatusPageIncident {
  name: string;
  affectedComponentNames: Array<string>;
  /*
   * The keys of the components it affects. When both the incident and the
   * page's components have keys, the incident is in scope by these, not by
   * the names.
   */
  affectedComponentKeys?: Array<string> | undefined;
}

export interface ExternalStatusPageContents {
  components: Array<ExternalStatusPageComponent>;
  incidents: Array<ExternalStatusPageIncident>;
}

export interface AtlassianStatuspageUrls {
  status: string;
  components: string;
  unresolvedIncidents: string;
}

type JsonRecord = Record<string, unknown>;

const isRecord: (value: unknown) => value is JsonRecord = (
  value: unknown,
): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value.trim() ? value : undefined;
};

const readArray: (value: unknown) => Array<unknown> = (
  value: unknown,
): Array<unknown> => {
  return Array.isArray(value) ? value : [];
};

export default class ExternalStatusPageReading {
  // Atlassian Statuspage's API, under the page's own address.
  public static getAtlassianUrls(
    statusPageUrl: string,
  ): AtlassianStatuspageUrls {
    const baseUrl: string = withoutTrailingSlashes(statusPageUrl);

    return {
      status: `${baseUrl}/api/v2/status.json`,
      components: `${baseUrl}/api/v2/components.json`,
      unresolvedIncidents: `${baseUrl}/api/v2/incidents/unresolved.json`,
    };
  }

  /*
   * incident.io's proxy for a page: on the page's own origin, keyed by its
   * host. Null for an address that is not a URL.
   */
  public static getIncidentIoUrl(statusPageUrl: string): string | null {
    const rawUrl: string = statusPageUrl.startsWith("http")
      ? statusPageUrl
      : `https://${statusPageUrl}`;

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return null;
    }

    const host: string = parsedUrl.hostname;
    const origin: string = `${parsedUrl.protocol}//${parsedUrl.host}`;

    // incident.io status pages expose their data via a proxy endpoint keyed by host.
    const apiUrl: string = `${origin}/proxy/${host}`;

    return apiUrl;
  }

  /*
   * An Atlassian Statuspage's own status, from /api/v2/status.json: its
   * description ("All Systems Operational"), else its indicator. Null when
   * the answer has no indicator: then it is not a Statuspage.
   */
  public static readAtlassianPageStatus(json: unknown): string | null {
    const status: unknown = isRecord(json) ? json["status"] : undefined;

    if (!isRecord(status) || !readText(status["indicator"])) {
      return null;
    }

    return (
      readText(status["description"]) || readText(status["indicator"]) || ""
    );
  }

  /*
   * An Atlassian Statuspage's components, from /api/v2/components.json: a
   * component marked as a group names the group its members name by
   * group_id, and is not a component itself. Null when the answer has no
   * list of components.
   */
  public static readAtlassianComponents(
    json: unknown,
  ): Array<ExternalStatusPageComponent> | null {
    const list: unknown = isRecord(json) ? json["components"] : undefined;

    if (!Array.isArray(list)) {
      return null;
    }

    // First pass: map group id -> group name (a "group" is a component with group === true).
    const groupIdToName: Map<string, string> = new Map();

    for (const item of list) {
      if (!isRecord(item) || item["group"] !== true) {
        continue;
      }

      const id: string | undefined = readText(item["id"]);
      const name: string | undefined = readText(item["name"]);

      if (id && name) {
        groupIdToName.set(id, name);
      }
    }

    // Second pass: collect leaf components (skip group headers).
    const components: Array<ExternalStatusPageComponent> = [];

    for (const item of list) {
      if (!isRecord(item) || item["group"] === true) {
        continue;
      }

      const name: string | undefined = readText(item["name"]);
      const status: string | undefined = readText(item["status"]);

      if (!name || !status) {
        continue;
      }

      const groupId: string | undefined = readText(item["group_id"]);

      components.push({
        name: name,
        status: status,
        description: readText(item["description"]),
        groupName: groupId ? groupIdToName.get(groupId) : undefined,
        key: readText(item["id"]),
      });

      if (components.length >= EXTERNAL_STATUS_PAGE_MAX_COMPONENTS) {
        break;
      }
    }

    return components;
  }

  /*
   * An Atlassian Statuspage's active incidents, from
   * /api/v2/incidents/unresolved.json: each with the components it names.
   */
  public static readAtlassianIncidents(
    json: unknown,
  ): Array<ExternalStatusPageIncident> {
    const incidents: Array<ExternalStatusPageIncident> = [];

    for (const item of readArray(
      isRecord(json) ? json["incidents"] : undefined,
    )) {
      if (!isRecord(item)) {
        continue;
      }

      const names: Array<string> = [];
      const keys: Array<string> = [];

      for (const component of readArray(item["components"])) {
        if (!isRecord(component)) {
          continue;
        }

        const name: string | undefined = readText(component["name"]);
        const key: string | undefined = readText(component["id"]);

        if (name) {
          names.push(name);
        }

        if (key) {
          keys.push(key);
        }
      }

      incidents.push({
        name: readText(item["name"]) || EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
        affectedComponentNames: names,
        affectedComponentKeys: keys.length > 0 ? keys : undefined,
      });

      if (incidents.length >= EXTERNAL_STATUS_PAGE_MAX_INCIDENTS) {
        break;
      }
    }

    return incidents;
  }

  /*
   * An incident.io status page, from its proxy's answer: the components of
   * its summary and its structure (a group's components name the group),
   * each with the status the page gives it now (operational unless it is
   * among the affected components), and its ongoing incidents. The proxy
   * nests everything under `summary`, and a flattened shape is read too.
   * Null when the answer does not look like an incident.io page.
   */
  public static readIncidentIo(
    json: unknown,
  ): ExternalStatusPageContents | null {
    if (!isRecord(json)) {
      return null;
    }

    const summary: JsonRecord = isRecord(json["summary"])
      ? (json["summary"] as JsonRecord)
      : {};

    const structure: unknown = isRecord(json["structure"])
      ? json["structure"]
      : summary["structure"];
    const structureItems: Array<unknown> = readArray(
      isRecord(structure) ? structure["items"] : undefined,
    );

    // Verify this actually looks like an incident.io status page.
    const looksLikeIncidentIo: boolean =
      structureItems.length > 0 ||
      Array.isArray(summary["components"]) ||
      Array.isArray(json["ongoing_incidents"]) ||
      Array.isArray(summary["ongoing_incidents"]);

    if (!looksLikeIncidentIo) {
      return null;
    }

    // Build a component_id -> { name, groupName, status } map.
    const componentMap: Map<string, ExternalStatusPageComponent> = new Map();

    const ensureComponent: (
      id: unknown,
      name?: unknown,
    ) => ExternalStatusPageComponent | null = (
      id: unknown,
      name?: unknown,
    ): ExternalStatusPageComponent | null => {
      const componentId: string | undefined = readText(id);

      if (!componentId) {
        return null;
      }

      const componentName: string | undefined = readText(name);
      let entry: ExternalStatusPageComponent | undefined =
        componentMap.get(componentId);

      if (!entry) {
        if (componentMap.size >= EXTERNAL_STATUS_PAGE_MAX_COMPONENTS) {
          return null;
        }

        entry = {
          name: componentName || componentId,
          status: "operational",
          groupName: undefined,
          key: componentId,
        };
        componentMap.set(componentId, entry);
      } else if (componentName && entry.name === componentId) {
        entry.name = componentName;
      }

      return entry;
    };

    // Flat component list from the summary.
    for (const component of readArray(summary["components"])) {
      if (isRecord(component)) {
        ensureComponent(component["id"], component["name"]);
      }
    }

    // Group membership + any components only present in the structure.
    for (const item of structureItems) {
      if (!isRecord(item)) {
        continue;
      }

      const group: unknown = item["group"];

      if (isRecord(group) && Array.isArray(group["components"])) {
        const groupName: string | undefined = readText(group["name"]);

        for (const ref of group["components"] as Array<unknown>) {
          if (!isRecord(ref)) {
            continue;
          }

          const entry: ExternalStatusPageComponent | null = ensureComponent(
            ref["component_id"],
            ref["name"],
          );

          if (entry) {
            entry.groupName = groupName;
          }
        }
      } else if (isRecord(item["component"])) {
        const component: JsonRecord = item["component"] as JsonRecord;
        ensureComponent(component["component_id"], component["name"]);
      }
    }

    // Apply current non-operational statuses.
    const affectedComponents: Array<unknown> = Array.isArray(
      json["affected_components"],
    )
      ? (json["affected_components"] as Array<unknown>)
      : readArray(summary["affected_components"]);

    for (const affected of affectedComponents) {
      if (!isRecord(affected)) {
        continue;
      }

      const entry: ExternalStatusPageComponent | null = ensureComponent(
        affected["component_id"],
      );
      const status: string | undefined = readText(affected["status"]);

      if (entry && status) {
        entry.status = status;
      }
    }

    // Active incidents.
    const ongoingIncidents: Array<unknown> = Array.isArray(
      json["ongoing_incidents"],
    )
      ? (json["ongoing_incidents"] as Array<unknown>)
      : readArray(summary["ongoing_incidents"]);

    const incidents: Array<ExternalStatusPageIncident> = [];

    for (const incident of ongoingIncidents) {
      if (!isRecord(incident)) {
        continue;
      }

      const names: Array<string> = [];
      const keys: Array<string> = [];

      for (const affected of readArray(incident["affected_components"])) {
        const componentId: string | undefined = isRecord(affected)
          ? readText(affected["component_id"])
          : undefined;

        if (!componentId) {
          continue;
        }

        keys.push(componentId);

        const name: string | undefined = componentMap.get(componentId)?.name;

        if (name) {
          names.push(name);
        }
      }

      incidents.push({
        name:
          readText(incident["name"]) || EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
        affectedComponentNames: names,
        affectedComponentKeys: keys.length > 0 ? keys : undefined,
      });

      if (incidents.length >= EXTERNAL_STATUS_PAGE_MAX_INCIDENTS) {
        break;
      }
    }

    return {
      components: Array.from(componentMap.values()),
      incidents: incidents,
    };
  }

  /*
   * A OneUptime status page's summary: each resource the page shows is a
   * component, by the name the page gives it, in the page's group; its
   * status is the value the page's status stands for
   * (ExternalStatusPageComponentStatusUtil) - under maintenance while a
   * scheduled maintenance event in progress affects it, whatever its
   * monitors' status, and unknown while the page shows it as not monitored.
   * Each active incident affects the resources it names, by their ids.
   */
  public static readOneUptimeSummary(
    summary: StatusPageSummary,
  ): ExternalStatusPageContents {
    const maintenanceTitles: Map<string, Array<string>> = new Map();

    for (const event of summary.ongoingScheduledMaintenance) {
      for (const resourceId of event.affectedResourceIds) {
        const titles: Array<string> = maintenanceTitles.get(resourceId) || [];

        if (event.title && !titles.includes(event.title)) {
          titles.push(event.title);
        }

        maintenanceTitles.set(resourceId, titles);
      }
    }

    const components: Array<ExternalStatusPageComponent> = summary.resources
      .slice(0, EXTERNAL_STATUS_PAGE_MAX_COMPONENTS)
      .map(
        (resource: StatusPageSummaryResource): ExternalStatusPageComponent => {
          const titles: Array<string> =
            maintenanceTitles.get(resource.id) || [];

          let description: string;

          if (resource.isUnderMaintenance) {
            description =
              titles.length > 0
                ? fillTemplate(
                    EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
                    { events: titles.join(", ") },
                  )
                : EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE;
          } else if (!resource.isMonitored) {
            description = EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED;
          } else if (!resource.currentStatus) {
            description = EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN;
          } else {
            description = resource.currentStatus.name;
          }

          const component: ExternalStatusPageComponent = {
            key: resource.id,
            name: resource.name,
            groupName: resource.groupName || undefined,
            status: ExternalStatusPageComponentStatusUtil.fromStatusPageStatus({
              // A status nothing checks says nothing now, whatever was sent.
              status: resource.isMonitored ? resource.currentStatus : null,
              isUnderMaintenance: resource.isUnderMaintenance,
            }),
            description: description,
          };

          if (!resource.isMonitored) {
            component.isMonitored = false;
          }

          return component;
        },
      );

    const namesById: Map<string, string> = new Map();

    for (const resource of summary.resources) {
      namesById.set(resource.id, resource.name);
    }

    const incidents: Array<ExternalStatusPageIncident> = summary.activeIncidents
      .slice(0, EXTERNAL_STATUS_PAGE_MAX_INCIDENTS)
      .map(
        (incident: StatusPageSummaryIncident): ExternalStatusPageIncident => {
          return {
            name: incident.title || EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
            affectedComponentNames: incident.affectedResourceIds
              .map((resourceId: string): string => {
                return namesById.get(resourceId) || "";
              })
              .filter((name: string): boolean => {
                return Boolean(name);
              }),
            affectedComponentKeys: [...incident.affectedResourceIds],
          };
        },
      );

    return { components: components, incidents: incidents };
  }

  /*
   * One of OneUptime's own notes on a OneUptime page's component, read
   * back from the description readOneUptimeSummary wrote, so it can be
   * drawn in the reader's language: the note's English, and the page's
   * words in it - the maintenance events' titles, as written. Null for any
   * other description, which is the page's own words and stays as written.
   *
   * Only a OneUptime page's description is read this way (the caller asks
   * for that provider): an Atlassian Statuspage's component can be
   * described "Under maintenance: ..." by the people who run it.
   */
  public static readOneUptimeNote(
    description: string | undefined,
  ): ExternalStatusPageOneUptimeNote | null {
    const text: string = (description || "").trim();

    if (ONEUPTIME_SENTENCE_NOTES.includes(text)) {
      return { template: text, values: {} };
    }

    if (text.startsWith(UNDER_MAINTENANCE_OF_PREFIX)) {
      const events: string = text.slice(UNDER_MAINTENANCE_OF_PREFIX.length);

      if (events.trim()) {
        return {
          template: EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
          values: { events: events },
        };
      }
    }

    return null;
  }

  /*
   * One of OneUptime's failure causes, read back from a check's failure
   * cause: its English, a translation key, when the cause is exactly one of
   * them (a private page, a page whose IP allowlist leaves the probe out);
   * null for any other cause - the network's, a provider's, an older
   * probe's - which stays as written.
   *
   * Only a check of a OneUptime page is read this way (the caller asks for
   * that provider).
   */
  public static readOneUptimeFailureCause(
    failureCause: string | undefined,
  ): string | null {
    const text: string = (failureCause || "").trim();

    return ONEUPTIME_FAILURE_CAUSES.includes(text) ? text : null;
  }
}
