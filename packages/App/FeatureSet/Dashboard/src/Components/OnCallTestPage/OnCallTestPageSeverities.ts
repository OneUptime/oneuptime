import { OnCallTestPageSeverityChoice } from "./OnCallTestPageApi";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * THE SEVERITIES A TEST CAN STAND IN FOR: the project's incident severities,
 * then its alert severities, most severe first - as a person's On-Call
 * Rules are laid out. The first incident severity is picked to start with:
 * the page that most needs to reach somebody.
 */

export interface OnCallTestPageSeverityOption {
  // "Incident:<id>": what the picker holds.
  value: string;
  recordKind: OnCallTestPageRecordKind;
  severityId: string;
  severityName: string;
}

const VALUE_SEPARATOR: string = ":";

export function toSeverityOptionValue(
  choice: OnCallTestPageSeverityChoice,
): string {
  return `${choice.recordKind}${VALUE_SEPARATOR}${choice.severityId}`;
}

// The choice a picker's value names, or null for one it does not.
export function fromSeverityOptionValue(
  value: unknown,
): OnCallTestPageSeverityChoice | null {
  if (typeof value !== "string") {
    return null;
  }

  const index: number = value.indexOf(VALUE_SEPARATOR);

  if (index <= 0) {
    return null;
  }

  const recordKind: string = value.substring(0, index);
  const severityId: string = value.substring(index + 1);

  if (
    (recordKind !== OnCallTestPageRecordKind.Incident &&
      recordKind !== OnCallTestPageRecordKind.Alert) ||
    !severityId
  ) {
    return null;
  }

  return {
    recordKind: recordKind as OnCallTestPageRecordKind,
    severityId: severityId,
  };
}

// The options, incident severities first, each kind in its own order.
export function buildSeverityOptions(data: {
  incidentSeverities: Array<{ id: string; name: string }>;
  alertSeverities: Array<{ id: string; name: string }>;
}): Array<OnCallTestPageSeverityOption> {
  const options: Array<OnCallTestPageSeverityOption> = [];

  for (const severity of data.incidentSeverities) {
    options.push({
      value: toSeverityOptionValue({
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: severity.id,
      }),
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: severity.id,
      severityName: severity.name,
    });
  }

  for (const severity of data.alertSeverities) {
    options.push({
      value: toSeverityOptionValue({
        recordKind: OnCallTestPageRecordKind.Alert,
        severityId: severity.id,
      }),
      recordKind: OnCallTestPageRecordKind.Alert,
      severityId: severity.id,
      severityName: severity.name,
    });
  }

  return options;
}

// The project's severities, read once a dialog opens.
export async function loadSeverityOptions(): Promise<
  Array<OnCallTestPageSeverityOption>
> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const [incidentSeverities, alertSeverities]: [
    ListResult<IncidentSeverity>,
    ListResult<AlertSeverity>,
  ] = await Promise.all([
    ModelAPI.getList<IncidentSeverity>({
      modelType: IncidentSeverity,
      query: { projectId: projectId, isArchived: false },
      select: { _id: true, name: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
    ModelAPI.getList<AlertSeverity>({
      modelType: AlertSeverity,
      query: { projectId: projectId, isArchived: false },
      select: { _id: true, name: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
  ]);

  const toNamed: (severity: IncidentSeverity | AlertSeverity) => {
    id: string;
    name: string;
  } = (severity: IncidentSeverity | AlertSeverity): {
    id: string;
    name: string;
  } => {
    return {
      id: severity.id?.toString() || "",
      name: severity.name?.toString() || "",
    };
  };

  return buildSeverityOptions({
    incidentSeverities: incidentSeverities.data
      .map(toNamed)
      .filter((severity: { id: string }): boolean => {
        return Boolean(severity.id);
      }),
    alertSeverities: alertSeverities.data
      .map(toNamed)
      .filter((severity: { id: string }): boolean => {
        return Boolean(severity.id);
      }),
  });
}
