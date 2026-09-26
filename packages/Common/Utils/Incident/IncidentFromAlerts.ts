import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { MAX_ALERTS_PER_INCIDENT_LINK_ACTION } from "../../Types/Incident/IncidentAlertLink";

/*
 * Builds the "declare incident" form prefill from the alerts an incident is
 * being declared from. Kept free of React and of the database models so the
 * rules - which alert wins the title, how an alert severity maps onto an
 * incident severity, what gets unioned - can be pinned by plain unit tests.
 * The create-incident page converts its fetched models into these shapes.
 */

/* A severity (alert or incident) as far as the mapping cares. */
export interface SeverityForMapping {
  id: string;
  name?: string | undefined;
  order?: number | undefined;
}

/*
 * An affected resource in the shape the incident form's resource picker
 * takes: `{ _id, name }`, so it renders real names on first paint.
 */
export interface NamedResource {
  _id: string;
  name: string;
}

export interface AlertForIncidentPrefill {
  id: string;
  title?: string | undefined;
  description?: string | undefined;
  alertNumber?: number | undefined;
  alertNumberWithPrefix?: string | undefined;
  alertSeverityId?: string | undefined;
  monitor?: NamedResource | undefined;
  hosts?: Array<NamedResource> | undefined;
  kubernetesClusters?: Array<NamedResource> | undefined;
  dockerHosts?: Array<NamedResource> | undefined;
  podmanHosts?: Array<NamedResource> | undefined;
  services?: Array<NamedResource> | undefined;
  labelIds?: Array<string> | undefined;
  isPrivate?: boolean | undefined;
}

export interface IncidentPrefillFromAlerts {
  title: string;
  description: string;
  incidentSeverityId?: string | undefined;
  monitors: Array<NamedResource>;
  hosts: Array<NamedResource>;
  kubernetesClusters: Array<NamedResource>;
  dockerHosts: Array<NamedResource>;
  podmanHosts: Array<NamedResource>;
  services: Array<NamedResource>;
  labelIds: Array<string>;
  /*
   * True when any of the alerts is private. A private incident is visible
   * only to its owners (and project admins), so when it is declared the
   * server adds the alerts' owners as its owners, and the create page says
   * so before the user declares it.
   */
  isPrivate: boolean;
}

export interface BuildIncidentPrefillInput {
  alerts: Array<AlertForIncidentPrefill>;
  alertSeverities: Array<SeverityForMapping>;
  incidentSeverities: Array<SeverityForMapping>;
}

/*
 * What the create page needs to offer acknowledging the alerts as the
 * incident is declared: each alert's current state, and the project's alert
 * states (to find Acknowledged and compare by order).
 */
export interface AlertForAcknowledgement {
  id: string;
  currentAlertStateId?: string | undefined;
}

export interface AlertStateForAcknowledgement {
  id: string;
  order?: number | undefined;
  isAcknowledgedState?: boolean | undefined;
}

export interface AlertsToAcknowledge {
  // Alerts not acknowledged yet, in the order given.
  alertIds: Array<string>;
  // Alerts already acknowledged, resolved or in a later state.
  alreadyAcknowledgedCount: number;
}

export interface ParsedAlertIds {
  alertIds: Array<string>;
  /* More ids were asked for than one declaration may link. */
  wasTruncated: boolean;
}

/*
 * The resource lists the incident form supports besides monitors (which come
 * from each alert's single `monitor`). Exported so the create page and the
 * tests walk the same list.
 */
export const INCIDENT_PREFILL_RESOURCE_KEYS: Array<
  "hosts" | "kubernetesClusters" | "dockerHosts" | "podmanHosts" | "services"
> = ["hosts", "kubernetesClusters", "dockerHosts", "podmanHosts", "services"];

type IncidentPrefillListKey =
  | "monitors"
  | "hosts"
  | "kubernetesClusters"
  | "dockerHosts"
  | "podmanHosts"
  | "services";

const INCIDENT_PREFILL_LIST_KEYS: Array<IncidentPrefillListKey> = [
  "monitors",
  ...INCIDENT_PREFILL_RESOURCE_KEYS,
];

export default class IncidentFromAlerts {
  /*
   * Reads the create page's `alertIds` query parameter: comma separated,
   * whitespace tolerant, invalid ids dropped, duplicates removed (first one
   * wins), capped at MAX_ALERTS_PER_INCIDENT_LINK_ACTION.
   */
  public static parseAlertIdsQueryParam(
    value: string | null | undefined,
  ): ParsedAlertIds {
    if (!value) {
      return { alertIds: [], wasTruncated: false };
    }

    const alertIds: Array<string> = [];

    for (const rawId of value.split(",")) {
      const id: string = rawId.trim();

      if (!id || !ObjectID.isValidUUID(id) || alertIds.includes(id)) {
        continue;
      }

      alertIds.push(id);
    }

    return {
      alertIds: alertIds.slice(0, MAX_ALERTS_PER_INCIDENT_LINK_ACTION),
      wasTruncated: alertIds.length > MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
    };
  }

  /*
   * Severities ordered most severe first: ascending `order`, the way the
   * project's severity settings list them. A severity without an order sorts
   * after every ordered one; ties keep their input order.
   */
  public static sortSeveritiesByOrder<T extends SeverityForMapping>(
    severities: Array<T>,
  ): Array<T> {
    return severities
      .map((severity: T, index: number) => {
        return { severity, index };
      })
      .sort(
        (
          a: { severity: T; index: number },
          b: { severity: T; index: number },
        ): number => {
          const aHasOrder: boolean = typeof a.severity.order === "number";
          const bHasOrder: boolean = typeof b.severity.order === "number";

          if (aHasOrder && bHasOrder) {
            const difference: number =
              (a.severity.order as number) - (b.severity.order as number);

            if (difference !== 0) {
              return difference;
            }

            return a.index - b.index;
          }

          if (aHasOrder !== bHasOrder) {
            return aHasOrder ? -1 : 1;
          }

          return a.index - b.index;
        },
      )
      .map((entry: { severity: T; index: number }): T => {
        return entry.severity;
      });
  }

  /*
   * 0 for the most severe severity, 1 for the next and so on; null when the
   * id is not one of the given severities.
   */
  public static getSeverityRank(
    severityId: string | undefined | null,
    severities: Array<SeverityForMapping>,
  ): number | null {
    if (!severityId) {
      return null;
    }

    const rank: number = this.sortSeveritiesByOrder(severities).findIndex(
      (severity: SeverityForMapping) => {
        return severity.id === severityId;
      },
    );

    return rank < 0 ? null : rank;
  }

  /*
   * The alert whose severity ranks highest. Alerts without a known severity
   * never win over one with a severity; ties go to the alert listed first.
   * With no known severity anywhere, the first alert.
   */
  public static getMostSevereAlert(
    alerts: Array<AlertForIncidentPrefill>,
    alertSeverities: Array<SeverityForMapping>,
  ): AlertForIncidentPrefill | null {
    let mostSevere: AlertForIncidentPrefill | null = null;
    let mostSevereRank: number | null = null;

    for (const alert of alerts) {
      const rank: number | null = this.getSeverityRank(
        alert.alertSeverityId,
        alertSeverities,
      );

      if (!mostSevere) {
        mostSevere = alert;
        mostSevereRank = rank;
        continue;
      }

      if (rank === null) {
        continue;
      }

      if (mostSevereRank === null || rank < mostSevereRank) {
        mostSevere = alert;
        mostSevereRank = rank;
      }
    }

    return mostSevere;
  }

  /*
   * The incident severity an alert severity corresponds to. An incident
   * severity with the same name (ignoring case and surrounding spaces) wins;
   * otherwise the alert severity's rank among the alert severities picks the
   * incident severity at the same rank, clamped to the least severe one when
   * the project has fewer incident severities than alert severities.
   */
  public static mapAlertSeverityToIncidentSeverity(data: {
    alertSeverityId: string | undefined | null;
    alertSeverities: Array<SeverityForMapping>;
    incidentSeverities: Array<SeverityForMapping>;
  }): string | null {
    if (!data.alertSeverityId || data.incidentSeverities.length === 0) {
      return null;
    }

    const alertSeverity: SeverityForMapping | undefined =
      data.alertSeverities.find((severity: SeverityForMapping) => {
        return severity.id === data.alertSeverityId;
      });

    if (!alertSeverity) {
      return null;
    }

    const alertSeverityName: string = (alertSeverity.name || "")
      .trim()
      .toLowerCase();

    if (alertSeverityName) {
      const sameName: SeverityForMapping | undefined =
        data.incidentSeverities.find((severity: SeverityForMapping) => {
          return (
            (severity.name || "").trim().toLowerCase() === alertSeverityName
          );
        });

      if (sameName) {
        return sameName.id;
      }
    }

    const rank: number | null = this.getSeverityRank(
      alertSeverity.id,
      data.alertSeverities,
    );

    if (rank === null) {
      return null;
    }

    const sortedIncidentSeverities: Array<SeverityForMapping> =
      this.sortSeveritiesByOrder(data.incidentSeverities);

    const target: SeverityForMapping | undefined =
      sortedIncidentSeverities[
        Math.min(rank, sortedIncidentSeverities.length - 1)
      ];

    return target ? target.id : null;
  }

  /*
   * Which of the alerts acknowledging would change. States are compared by
   * order, like the server does: an alert in a custom state after
   * Acknowledged, or resolved, has been acknowledged already. An alert whose
   * state is not among the given states is counted as not acknowledged - the
   * server skips it if it turns out to be. Null when the project has no
   * Acknowledged state with an order (nothing could be acknowledged), so the
   * page does not offer it at all.
   */
  public static getAlertsToAcknowledge(data: {
    alerts: Array<AlertForAcknowledgement>;
    alertStates: Array<AlertStateForAcknowledgement>;
  }): AlertsToAcknowledge | null {
    const acknowledgedState: AlertStateForAcknowledgement | undefined =
      data.alertStates.find((state: AlertStateForAcknowledgement) => {
        return state.isAcknowledgedState === true;
      });

    if (!acknowledgedState || typeof acknowledgedState.order !== "number") {
      return null;
    }

    const acknowledgedOrder: number = acknowledgedState.order;

    const result: AlertsToAcknowledge = {
      alertIds: [],
      alreadyAcknowledgedCount: 0,
    };

    for (const alert of data.alerts) {
      const currentState: AlertStateForAcknowledgement | undefined =
        alert.currentAlertStateId
          ? data.alertStates.find((state: AlertStateForAcknowledgement) => {
              return (
                state.id.trim().toLowerCase() ===
                alert.currentAlertStateId!.trim().toLowerCase()
              );
            })
          : undefined;

      if (
        currentState &&
        typeof currentState.order === "number" &&
        currentState.order >= acknowledgedOrder
      ) {
        result.alreadyAcknowledgedCount++;
        continue;
      }

      result.alertIds.push(alert.id);
    }

    return result;
  }

  /* "Alert #42" / "Alert ALT-42", or "Alert" when the number is unknown. */
  public static getAlertReference(alert: AlertForIncidentPrefill): string {
    if (alert.alertNumberWithPrefix) {
      return `Alert ${alert.alertNumberWithPrefix}`;
    }

    if (typeof alert.alertNumber === "number") {
      return `Alert #${alert.alertNumber}`;
    }

    return "Alert";
  }

  public static buildIncidentPrefill(
    input: BuildIncidentPrefillInput,
  ): IncidentPrefillFromAlerts {
    const alerts: Array<AlertForIncidentPrefill> = input.alerts;

    const prefill: IncidentPrefillFromAlerts = {
      title: "",
      description: "",
      incidentSeverityId: undefined,
      monitors: [],
      hosts: [],
      kubernetesClusters: [],
      dockerHosts: [],
      podmanHosts: [],
      services: [],
      labelIds: [],
      isPrivate: false,
    };

    if (alerts.length === 0) {
      return prefill;
    }

    const mostSevere: AlertForIncidentPrefill | null = this.getMostSevereAlert(
      alerts,
      input.alertSeverities,
    );

    if (alerts.length === 1) {
      prefill.title = alerts[0]!.title || "";
      prefill.description = alerts[0]!.description || "";
    } else {
      prefill.title = mostSevere?.title || "";
      prefill.description = alerts
        .map((alert: AlertForIncidentPrefill): string => {
          return `- ${this.getAlertReference(alert)}: ${alert.title || ""}`.trimEnd();
        })
        .join("\n");
    }

    prefill.incidentSeverityId =
      this.mapAlertSeverityToIncidentSeverity({
        alertSeverityId: mostSevere?.alertSeverityId,
        alertSeverities: input.alertSeverities,
        incidentSeverities: input.incidentSeverities,
      }) || undefined;

    for (const alert of alerts) {
      if (alert.monitor) {
        this.addResource(prefill.monitors, alert.monitor);
      }

      for (const key of INCIDENT_PREFILL_RESOURCE_KEYS) {
        for (const resource of alert[key] || []) {
          this.addResource(prefill[key], resource);
        }
      }

      for (const labelId of alert.labelIds || []) {
        if (labelId && !prefill.labelIds.includes(labelId)) {
          prefill.labelIds.push(labelId);
        }
      }

      if (alert.isPrivate) {
        prefill.isPrivate = true;
      }
    }

    return prefill;
  }

  /*
   * Folds the prefill into the form's initial values without undoing what is
   * already there (an incident template, say): title, description and
   * severity only fill blanks, resource and label lists are unioned, and a
   * private incident stays private. On-call policies are never touched -
   * declaring an incident from alerts must not page anyone the alerts did
   * not already page.
   */
  public static applyPrefillToInitialValues(
    initialValues: JSONObject,
    prefill: IncidentPrefillFromAlerts,
  ): JSONObject {
    const merged: JSONObject = { ...initialValues };

    if (!this.hasText(merged["title"]) && prefill.title) {
      merged["title"] = prefill.title;
    }

    if (!this.hasText(merged["description"]) && prefill.description) {
      merged["description"] = prefill.description;
    }

    if (
      !this.hasText(merged["incidentSeverity"]) &&
      prefill.incidentSeverityId
    ) {
      merged["incidentSeverity"] = prefill.incidentSeverityId;
    }

    for (const key of INCIDENT_PREFILL_LIST_KEYS) {
      const resources: Array<NamedResource> = [];

      for (const existing of this.asArray(merged[key])) {
        const resource: NamedResource | null = this.toNamedResource(existing);

        if (resource) {
          this.addResource(resources, resource);
        }
      }

      for (const resource of prefill[key]) {
        this.addResource(resources, resource);
      }

      if (resources.length > 0) {
        merged[key] = resources as unknown as JSONValue;
      }
    }

    const labelIds: Array<string> = [];

    for (const existing of this.asArray(merged["labels"])) {
      const id: string | null = this.toId(existing);

      if (id && !labelIds.includes(id)) {
        labelIds.push(id);
      }
    }

    for (const labelId of prefill.labelIds) {
      if (!labelIds.includes(labelId)) {
        labelIds.push(labelId);
      }
    }

    if (labelIds.length > 0) {
      merged["labels"] = labelIds;
    }

    if (prefill.isPrivate) {
      merged["isPrivate"] = true;
    }

    return merged;
  }

  private static addResource(
    resources: Array<NamedResource>,
    resource: NamedResource,
  ): void {
    if (!resource._id) {
      return;
    }

    const alreadyAdded: boolean = resources.some((existing: NamedResource) => {
      return existing._id === resource._id;
    });

    if (!alreadyAdded) {
      resources.push({ _id: resource._id, name: resource.name || "" });
    }
  }

  private static hasText(value: JSONValue | undefined): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    return value.toString().trim().length > 0;
  }

  private static asArray(value: JSONValue | undefined): Array<JSONValue> {
    return Array.isArray(value) ? (value as Array<JSONValue>) : [];
  }

  private static toId(value: JSONValue): string | null {
    if (typeof value === "string") {
      return value || null;
    }

    if (value && typeof value === "object") {
      const id: JSONValue | undefined =
        (value as JSONObject)["_id"] ?? (value as JSONObject)["id"];

      if (id !== null && id !== undefined) {
        const idString: string = id.toString();
        return idString || null;
      }
    }

    return null;
  }

  private static toNamedResource(value: JSONValue): NamedResource | null {
    const id: string | null = this.toId(value);

    if (!id) {
      return null;
    }

    const name: JSONValue | undefined =
      value && typeof value === "object"
        ? (value as JSONObject)["name"]
        : undefined;

    return { _id: id, name: typeof name === "string" ? name : "" };
  }
}
