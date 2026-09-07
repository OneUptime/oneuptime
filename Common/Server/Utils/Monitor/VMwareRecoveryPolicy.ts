import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "../../Services/MonitorStatusService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";

/** VMware recovery requires positive evidence, including at monitor-status level. */
export default class VMwareRecoveryPolicy {
  public static async getOperationalStatusIds(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    if (!projectId) {
      throw new BadDataException("VMware monitoring requires a project.");
    }
    const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
      query: { projectId, isOperationalState: true },
      select: { _id: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
    return statuses.map((status: MonitorStatus): string => {
      return status.id!.toString();
    });
  }

  public static isRecoveryCriteria(
    criteria: MonitorCriteriaInstance,
    operationalStatusIds: Array<string>,
  ): boolean {
    return Boolean(
      criteria.data &&
        criteria.data.isEnabled !== false &&
        criteria.data.createIncidents !== true &&
        criteria.data.createAlerts !== true &&
        criteria.data.monitorStatusId &&
        operationalStatusIds.includes(criteria.data.monitorStatusId.toString()),
    );
  }

  public static shouldChangeStatus(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
    unavailableSeriesFingerprints?: Array<string> | undefined;
    operationalMonitorStatusIds?: Array<string> | undefined;
  }): boolean {
    if (input.monitorType !== MonitorType.VMware) {
      return true;
    }
    // No match is the hysteresis dead band, not evidence for the default status.
    if (
      !input.criteriaInstance ||
      input.operationalMonitorStatusIds === undefined ||
      input.criteriaInstance.data?.isEnabled === false
    ) {
      return false;
    }
    // A known failure can still worsen status while another resource is unknown.
    return (
      !this.isRecoveryCriteria(
        input.criteriaInstance,
        input.operationalMonitorStatusIds,
      ) || !input.unavailableSeriesFingerprints?.length
    );
  }
}
