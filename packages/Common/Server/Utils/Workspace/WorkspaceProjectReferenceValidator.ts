import ObjectID from "../../../Types/ObjectID";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../Database/ProjectScopedReferenceValidator";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Slack and Microsoft Teams create incidents and scheduled maintenance events
 * as root, from ids the chat client submits. The form only offers the linked
 * project's monitors, labels and on-call policies, but the submitted payload is
 * not bound to that form — a user linked to one project can send ids that
 * belong to another.
 *
 * IncidentService / ScheduledMaintenanceService check the severity, state and
 * change-to monitor status on create, but not the many-to-many relations. So
 * without this check, another project's monitors get attached to the new
 * record (and have their status changed by it), its labels are shown in this
 * project, and its on-call policies are paged for this project's incident.
 */
export default class WorkspaceProjectReferenceValidator {
  // Adaptive Card multi-selects submit their values as one comma-separated string.
  public static parseCommaSeparatedIds(
    value: string | undefined | null,
  ): Array<ObjectID> {
    if (!value) {
      return [];
    }

    return value
      .split(",")
      .map((id: string) => {
        return id.trim();
      })
      .filter((id: string) => {
        return id;
      })
      .map((id: string) => {
        return new ObjectID(id);
      });
  }

  @CaptureSpan()
  public static async validateReferencesBelongToProject(data: {
    projectId: ObjectID;
    // Used in the error message, e.g. "incident".
    subject: string;
    monitorIds?: Array<ObjectID> | undefined;
    labelIds?: Array<ObjectID> | undefined;
    onCallDutyPolicyIds?: Array<ObjectID> | undefined;
    monitorStatusId?: ObjectID | undefined;
  }): Promise<void> {
    const references: Array<ProjectScopedReference> = [];

    for (const monitorId of data.monitorIds || []) {
      references.push({
        modelName: "Monitor",
        id: monitorId,
        service: MonitorService,
      });
    }

    for (const labelId of data.labelIds || []) {
      references.push({
        modelName: "Label",
        id: labelId,
        service: LabelService,
      });
    }

    for (const onCallDutyPolicyId of data.onCallDutyPolicyIds || []) {
      references.push({
        modelName: "On-Call Policy",
        id: onCallDutyPolicyId,
        service: OnCallDutyPolicyService,
      });
    }

    if (data.monitorStatusId) {
      references.push({
        modelName: "Monitor Status",
        id: data.monitorStatusId,
        service: MonitorStatusService,
      });
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: data.projectId,
      subject: data.subject,
      references: references,
    });
  }
}
