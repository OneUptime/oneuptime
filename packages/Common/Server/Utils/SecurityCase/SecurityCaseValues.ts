import SecurityCasePriorityService from "../../Services/SecurityCasePriorityService";
import SecurityCaseStatusService from "../../Services/SecurityCaseStatusService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseDefaultValues from "./SecurityCaseDefaultValues";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import ObjectID from "../../../Types/ObjectID";

/*
 * A project's case priorities and statuses, as the server reads them: both
 * lists, top first, with their places and built-in flags, for the rules in
 * Common/Utils/SecurityCase (SecurityCasePriorities, SecurityCaseStatuses)
 * to answer from. Read afresh each time - two small reads by an index - so a
 * rename, a new colour or a new order counts at once, everywhere.
 *
 * A project with none of a kind (one made while the migration that gave
 * every project its lists was still running, say) is given the defaults
 * first: a detection never fails to open its case for want of a status.
 */
export interface ProjectSecurityCaseValues {
  priorities: Array<SecurityCasePriority>;
  statuses: Array<SecurityCaseStatus>;
}

export default class SecurityCaseValues {
  @CaptureSpan()
  public static async getForProject(
    projectId: ObjectID,
  ): Promise<ProjectSecurityCaseValues> {
    const [priorities, statuses]: [
      Array<SecurityCasePriority>,
      Array<SecurityCaseStatus>,
    ] = await Promise.all([
      this.getPriorities(projectId),
      this.getStatuses(projectId),
    ]);

    return { priorities, statuses };
  }

  @CaptureSpan()
  public static async getPriorities(
    projectId: ObjectID,
  ): Promise<Array<SecurityCasePriority>> {
    const priorities: Array<SecurityCasePriority> =
      await SecurityCasePriorityService.getProjectPriorities(projectId);

    if (priorities.length > 0) {
      return priorities;
    }

    await SecurityCaseDefaultValues.addDefaultPriorities(projectId);

    return await SecurityCasePriorityService.getProjectPriorities(projectId);
  }

  @CaptureSpan()
  public static async getStatuses(
    projectId: ObjectID,
  ): Promise<Array<SecurityCaseStatus>> {
    const statuses: Array<SecurityCaseStatus> =
      await SecurityCaseStatusService.getProjectStatuses(projectId);

    if (statuses.length > 0) {
      return statuses;
    }

    await SecurityCaseDefaultValues.addDefaultStatuses(projectId);

    return await SecurityCaseStatusService.getProjectStatuses(projectId);
  }
}
