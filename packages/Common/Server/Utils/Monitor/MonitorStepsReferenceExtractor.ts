import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import Typeof from "../../../Types/Typeof";

/*
 * `monitorSteps` is a free-form JSON column, so none of the ids it embeds have
 * a foreign key behind them. They are still real references: the monitor status
 * a criteria switches to, the severity it opens incidents and alerts with, the
 * on-call policies it pages, the labels/owners it stamps on what it creates.
 *
 * Until issue #3039 the only guard over this blob scraped every uuid out of the
 * serialized JSON with a regex and asked whether it happened to be another
 * project's record. That can never reject an id that exists nowhere, because
 * monitorSteps is FULL of uuids that are not references at all — step ids,
 * criteria ids, incident/alert template ids — and they match nothing either.
 *
 * This walker exists to tell those apart. It reads the structure rather than the
 * text, so every id it yields is known to be a reference to a specific model and
 * can be checked for existence without any risk of a false rejection.
 */

export enum MonitorStepsReferenceModel {
  MonitorStatus = "Monitor Status",
  IncidentSeverity = "Incident Severity",
  AlertSeverity = "Alert Severity",
  OnCallDutyPolicy = "On-Call Duty Policy",
  Label = "Label",
  Team = "Team",
  User = "User",
  IncidentRole = "Incident Role",
  TelemetryService = "Telemetry Service",
  NetworkDevice = "Network Device",
}

/*
 * Step-level sub-configs that scope a monitor to specific telemetry services.
 * All five carry the field under the same name.
 */
const TELEMETRY_SERVICE_STEP_FIELDS: Array<string> = [
  "logMonitor",
  "securityEventsMonitor",
  "traceMonitor",
  "exceptionMonitor",
  "profileMonitor",
  "metricMonitor",
];

export interface MonitorStepsReference {
  model: MonitorStepsReferenceModel;
  id: string;
  /*
   * Human readable location inside monitorSteps, used verbatim in the error
   * message so a caller can find the offending field without diffing JSON.
   * e.g. `criteria "Monitor is offline" incident severity`.
   */
  path: string;
  /*
   * Whether the monitor actually uses this id when it runs.
   *
   * A criteria carries `monitorStatusId` even when `changeMonitorStatus` is
   * off, and carries whole incident/alert templates even when `createIncidents`
   * / `createAlerts` are off — the UI keeps them so toggling the switch back on
   * restores what you had. Only the operative ones can produce the foreign key
   * violation in issue #3039, and only those are required to exist; requiring
   * the rest would refuse a save over a field that does nothing, and would lock
   * a user out of a monitor whose disabled criteria points at something they
   * have since deleted.
   *
   * Cross-project checking does not use this flag — every reference is checked
   * for that, operative or not, exactly as before.
   */
  isOperative: boolean;
}

/*
 * Every level of monitorSteps is persisted inside a `{ _type, value }` envelope
 * (MonitorSteps.toJSON -> MonitorStep.toJSON -> MonitorCriteria.toJSON ->
 * MonitorCriteriaInstance.toJSON). API callers - Terraform among them - post
 * the same envelope. Unwrap it when it is there and accept the bare object when
 * it is not, so a hand-written payload is walked just as thoroughly.
 */
function unwrap(value: JSONValue | undefined): JSONObject | null {
  if (!value || typeof value !== Typeof.Object || Array.isArray(value)) {
    return null;
  }

  const object: JSONObject = value as JSONObject;

  if (object["value"] && typeof object["value"] === Typeof.Object) {
    return object["value"] as JSONObject;
  }

  return object;
}

function asArray(value: JSONValue | undefined): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

/*
 * An id reaches here in every shape the codebase produces: a plain uuid string
 * (MonitorSteps.toJSON stringifies defaultMonitorStatusId and monitorStatusId),
 * a serialized `{ _type: "ObjectID", value }` envelope (what JSONFunctions.serialize
 * does to the ObjectIDs nested inside the incidents/alerts arrays), a live
 * ObjectID instance (validating a MonitorSteps object that was never
 * serialized), or `{ value }` without the marker.
 *
 * Blank is treated as absent on purpose: a stored `{"_type":"ObjectID","value":""}`
 * rehydrates to `new ObjectID("")`, which is truthy. Reporting that as a missing
 * *reference* would be misleading - it is an unset field, and the required-field
 * checks own that case.
 */
export function toReferenceId(value: JSONValue | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value.toString().trim() || null;
  }

  if (typeof value === Typeof.String) {
    return (value as string).trim() || null;
  }

  if (typeof value === Typeof.Object && !Array.isArray(value)) {
    const inner: JSONValue | undefined = (value as JSONObject)["value"];

    if (typeof inner === Typeof.String) {
      return (inner as string).trim() || null;
    }
  }

  return null;
}

export default class MonitorStepsReferenceExtractor {
  /*
   * Walks monitorSteps and returns every id it holds that points at another
   * record. Ids that are NOT references (step ids, criteria ids, the id on each
   * incident/alert template) are deliberately not returned - they are local
   * identity, not a pointer to a row.
   */
  public static extract(
    monitorSteps: MonitorSteps | JSONObject | undefined | null,
  ): Array<MonitorStepsReference> {
    const root: JSONObject | null = this.toJSONObject(monitorSteps);

    if (!root) {
      return [];
    }

    const references: Array<MonitorStepsReference> = [];

    this.push(references, {
      model: MonitorStepsReferenceModel.MonitorStatus,
      value: root["defaultMonitorStatusId"],
      path: "default monitor status",
      /*
       * Always operative: MonitorResource stamps it onto the monitor's first
       * MonitorStatusTimeline row, which is the very insert issue #3039 reports
       * failing.
       */
      isOperative: true,
    });

    const steps: JSONArray = asArray(root["monitorStepsInstanceArray"]);

    for (const step of steps) {
      const stepValue: JSONObject | null = unwrap(step as JSONValue);

      if (!stepValue) {
        continue;
      }

      this.extractFromStepConfig(references, stepValue);

      const criteria: JSONObject | null = unwrap(stepValue["monitorCriteria"]);

      if (!criteria) {
        continue;
      }

      const instances: JSONArray = asArray(
        criteria["monitorCriteriaInstanceArray"],
      );

      for (let index: number = 0; index < instances.length; index++) {
        this.extractFromCriteriaInstance({
          references: references,
          criteriaInstance: unwrap(instances[index] as JSONValue),
          index: index,
        });
      }
    }

    return references;
  }

  /*
   * The step's own targets: the telemetry services a log/trace/exception/
   * profile/metric monitor is scoped to, and the device a network monitor
   * walks.
   *
   * These are reported as references — so a *cross-project* id in them is
   * refused like any other — but never as `isOperative`, so they are not
   * required to exist. Both already degrade on their own when the target is
   * gone (the query simply matches nothing; NetworkDeviceHydrationUtil logs a
   * warning and carries on), neither can produce the foreign key violation this
   * guard exists for, and deleting a telemetry service is ordinary enough that
   * refusing every later edit of a monitor that once watched it would be a
   * worse failure than the one being fixed.
   */
  private static extractFromStepConfig(
    references: Array<MonitorStepsReference>,
    step: JSONObject,
  ): void {
    for (const field of TELEMETRY_SERVICE_STEP_FIELDS) {
      const config: JSONObject | null = unwrap(step[field]);

      if (!config) {
        continue;
      }

      for (const id of asArray(config["telemetryServiceIds"])) {
        this.push(references, {
          model: MonitorStepsReferenceModel.TelemetryService,
          value: id as JSONValue,
          path: "monitored telemetry service",
          isOperative: false,
        });
      }
    }

    const networkDeviceMonitor: JSONObject | null = unwrap(
      step["networkDeviceMonitor"],
    );

    if (networkDeviceMonitor) {
      this.push(references, {
        model: MonitorStepsReferenceModel.NetworkDevice,
        value: networkDeviceMonitor["networkDeviceId"],
        path: "monitored network device",
        isOperative: false,
      });
    }
  }

  private static extractFromCriteriaInstance(data: {
    references: Array<MonitorStepsReference>;
    criteriaInstance: JSONObject | null;
    index: number;
  }): void {
    const criteriaInstance: JSONObject | null = data.criteriaInstance;

    if (!criteriaInstance) {
      return;
    }

    const name: string =
      (criteriaInstance["name"] as string) || `#${data.index + 1}`;
    const label: string = `criteria "${name}"`;

    this.push(data.references, {
      model: MonitorStepsReferenceModel.MonitorStatus,
      value: criteriaInstance["monitorStatusId"],
      path: `${label} monitor status`,
      isOperative: criteriaInstance["changeMonitorStatus"] === true,
    });

    const createsIncidents: boolean =
      criteriaInstance["createIncidents"] === true;

    for (const incident of asArray(criteriaInstance["incidents"])) {
      const incidentValue: JSONObject | null = unwrap(incident as JSONValue);

      if (!incidentValue) {
        continue;
      }

      this.push(data.references, {
        model: MonitorStepsReferenceModel.IncidentSeverity,
        value: incidentValue["incidentSeverityId"],
        path: `${label} incident severity`,
        isOperative: createsIncidents,
      });

      this.pushSharedNotificationReferences({
        references: data.references,
        source: incidentValue,
        label: `${label} incident`,
        isOperative: createsIncidents,
      });

      for (const roleAssignment of asArray(
        incidentValue["incidentMemberRoles"],
      )) {
        const assignment: JSONObject | null = unwrap(
          roleAssignment as JSONValue,
        );

        if (!assignment) {
          continue;
        }

        this.push(data.references, {
          model: MonitorStepsReferenceModel.IncidentRole,
          value: assignment["roleId"],
          path: `${label} incident member role`,
          isOperative: createsIncidents,
        });

        this.push(data.references, {
          model: MonitorStepsReferenceModel.User,
          value: assignment["userId"],
          path: `${label} incident member`,
          isOperative: createsIncidents,
        });
      }
    }

    const createsAlerts: boolean = criteriaInstance["createAlerts"] === true;

    for (const alert of asArray(criteriaInstance["alerts"])) {
      const alertValue: JSONObject | null = unwrap(alert as JSONValue);

      if (!alertValue) {
        continue;
      }

      this.push(data.references, {
        model: MonitorStepsReferenceModel.AlertSeverity,
        value: alertValue["alertSeverityId"],
        path: `${label} alert severity`,
        isOperative: createsAlerts,
      });

      this.pushSharedNotificationReferences({
        references: data.references,
        source: alertValue,
        label: `${label} alert`,
        isOperative: createsAlerts,
      });
    }
  }

  // The four id arrays CriteriaIncident and CriteriaAlert have in common.
  private static pushSharedNotificationReferences(data: {
    references: Array<MonitorStepsReference>;
    source: JSONObject;
    label: string;
    isOperative: boolean;
  }): void {
    const arrays: Array<{
      field: string;
      model: MonitorStepsReferenceModel;
      path: string;
    }> = [
      {
        field: "onCallPolicyIds",
        model: MonitorStepsReferenceModel.OnCallDutyPolicy,
        path: "on-call policy",
      },
      {
        field: "labelIds",
        model: MonitorStepsReferenceModel.Label,
        path: "label",
      },
      {
        field: "ownerTeamIds",
        model: MonitorStepsReferenceModel.Team,
        path: "owner team",
      },
      {
        field: "ownerUserIds",
        model: MonitorStepsReferenceModel.User,
        path: "owner user",
      },
    ];

    for (const array of arrays) {
      for (const id of asArray(data.source[array.field])) {
        this.push(data.references, {
          model: array.model,
          value: id as JSONValue,
          path: `${data.label} ${array.path}`,
          isOperative: data.isOperative,
        });
      }
    }
  }

  private static push(
    references: Array<MonitorStepsReference>,
    data: {
      model: MonitorStepsReferenceModel;
      value: JSONValue | undefined;
      path: string;
      isOperative: boolean;
    },
  ): void {
    const id: string | null = toReferenceId(data.value);

    if (!id) {
      return;
    }

    references.push({
      model: data.model,
      id: id,
      path: data.path,
      isOperative: data.isOperative,
    });
  }

  private static toJSONObject(
    monitorSteps: MonitorSteps | JSONObject | undefined | null,
  ): JSONObject | null {
    if (!monitorSteps) {
      return null;
    }

    if (monitorSteps instanceof MonitorSteps) {
      /*
       * toJSON() on a MonitorSteps whose `data` is undefined returns the
       * "new monitor steps" skeleton, which holds no references. Walking it is
       * harmless.
       */
      return unwrap(monitorSteps.toJSON());
    }

    return unwrap(monitorSteps);
  }
}
