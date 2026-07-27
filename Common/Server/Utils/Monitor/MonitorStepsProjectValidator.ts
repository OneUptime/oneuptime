import AlertSeverityService from "../../Services/AlertSeverityService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";

const UUID_REGEX: RegExp =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

interface ForeignReference {
  modelName: string;
  name: string;
}

/*
 * `monitorSteps` is a JSON blob that embeds ids of other project-scoped
 * records — the default monitor status, the status each criteria switches to,
 * and the severities used to open incidents and alerts. Nothing used to check
 * that those ids belonged to the monitor's own project, so a status id from a
 * second project could be saved and then stamped onto every
 * MonitorStatusTimeline row the monitor wrote. That silently ties two projects
 * together and leaves the referenced project undeletable.
 *
 * The check below is deliberately narrow: it only rejects an id that really is
 * another project's record. monitorSteps is full of unrelated uuids (step ids,
 * criteria ids, incident/alert template ids) and those never match a row here,
 * so they pass through untouched. Ids that match nothing at all are also left
 * alone — refusing them would block users from saving their way out of a
 * monitor that already references a deleted record.
 */
export default class MonitorStepsProjectValidator {
  public static async validateMonitorStepsBelongToProject(data: {
    monitorSteps: MonitorSteps | JSONObject | undefined;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.monitorSteps || !data.projectId) {
      return;
    }

    const referencedIds: Array<string> = this.extractUuids(data.monitorSteps);

    if (referencedIds.length === 0) {
      return;
    }

    const foreignReferences: Array<ForeignReference> = [];

    const monitorStatuses: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          _id: QueryHelper.any(referencedIds),
        },
        select: { _id: true, name: true, projectId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    for (const monitorStatus of monitorStatuses) {
      if (monitorStatus.projectId?.toString() !== data.projectId.toString()) {
        foreignReferences.push({
          modelName: "Monitor Status",
          name: monitorStatus.name || monitorStatus.id?.toString() || "",
        });
      }
    }

    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          _id: QueryHelper.any(referencedIds),
        },
        select: { _id: true, name: true, projectId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    for (const incidentSeverity of incidentSeverities) {
      if (
        incidentSeverity.projectId?.toString() !== data.projectId.toString()
      ) {
        foreignReferences.push({
          modelName: "Incident Severity",
          name: incidentSeverity.name || incidentSeverity.id?.toString() || "",
        });
      }
    }

    const alertSeverities: Array<AlertSeverity> =
      await AlertSeverityService.findBy({
        query: {
          _id: QueryHelper.any(referencedIds),
        },
        select: { _id: true, name: true, projectId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    for (const alertSeverity of alertSeverities) {
      if (alertSeverity.projectId?.toString() !== data.projectId.toString()) {
        foreignReferences.push({
          modelName: "Alert Severity",
          name: alertSeverity.name || alertSeverity.id?.toString() || "",
        });
      }
    }

    if (foreignReferences.length > 0) {
      const described: string = foreignReferences
        .map((reference: ForeignReference) => {
          return `${reference.modelName} "${reference.name}"`;
        })
        .join(", ");

      throw new BadDataException(
        `Monitor criteria reference records that belong to a different project: ${described}. Please pick values from this project and try again.`,
      );
    }
  }

  private static extractUuids(
    monitorSteps: MonitorSteps | JSONObject,
  ): Array<string> {
    let serialized: string = "";

    try {
      serialized =
        monitorSteps instanceof MonitorSteps
          ? JSON.stringify(monitorSteps.toJSON())
          : JSON.stringify(monitorSteps);
    } catch {
      /*
       * Unserializable monitorSteps is a different problem and is reported by
       * MonitorSteps' own validation. Nothing to check here.
       */
      return [];
    }

    const matches: Array<string> = serialized.match(UUID_REGEX) || [];

    return Array.from(
      new Set(
        matches.map((match: string) => {
          return match.toLowerCase();
        }),
      ),
    );
  }
}
