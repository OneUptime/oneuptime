import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";

/** VMware recovery requires positive evidence, including at monitor-status level. */
export default class VMwareRecoveryPolicy {
  public static isRecoveryCriteria(criteria: MonitorCriteriaInstance): boolean {
    return Boolean(
      criteria.data &&
        criteria.data.isEnabled !== false &&
        criteria.data.createIncidents !== true &&
        criteria.data.createAlerts !== true,
    );
  }

  public static shouldChangeStatus(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
    unavailableSeriesFingerprints?: Array<string> | undefined;
  }): boolean {
    if (input.monitorType !== MonitorType.VMware) {
      return true;
    }
    // No match is the hysteresis dead band, not evidence for the default status.
    if (
      !input.criteriaInstance ||
      input.criteriaInstance.data?.isEnabled === false
    ) {
      return false;
    }
    // A known failure can still worsen status while another resource is unknown.
    return (
      !this.isRecoveryCriteria(input.criteriaInstance) ||
      !input.unavailableSeriesFingerprints?.length
    );
  }
}
