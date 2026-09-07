import VMwareRecoveryPolicy from "../../../../Server/Utils/Monitor/VMwareRecoveryPolicy";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";

function criteria(creating: boolean): MonitorCriteriaInstance {
  const result: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  result.data!.createIncidents = creating; result.data!.createAlerts = creating;
  return result;
}

describe("VMware monitor-status recovery", () => {
  test("does not reset to default status in the no-match dead band", () => {
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType: MonitorType.VMware })).toBe(false);
  });
  test("a healthy series cannot restore monitor status while another series is unknown", () => {
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType: MonitorType.VMware, criteriaInstance: criteria(false), unavailableSeriesFingerprints: ["unknown-resource"] })).toBe(false);
  });
  test("known unhealthy criteria can still worsen status alongside an unknown resource", () => {
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType: MonitorType.VMware, criteriaInstance: criteria(true), unavailableSeriesFingerprints: ["unknown-resource"] })).toBe(true);
  });
  test("an affirmative healthy match with complete data can restore status", () => {
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType: MonitorType.VMware, criteriaInstance: criteria(false), unavailableSeriesFingerprints: [] })).toBe(true);
  });
  test("disabled healthy criteria cannot supply recovery evidence", () => {
    const disabled: MonitorCriteriaInstance = criteria(false); disabled.data!.isEnabled = false;
    expect(VMwareRecoveryPolicy.isRecoveryCriteria(disabled)).toBe(false);
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType: MonitorType.VMware, criteriaInstance: disabled })).toBe(false);
  });
  test.each([MonitorType.Metrics, MonitorType.Proxmox, MonitorType.Ceph])("preserves default and healthy status behavior for %s", (monitorType: MonitorType) => {
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType })).toBe(true);
    expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType, criteriaInstance: criteria(false), unavailableSeriesFingerprints: ["unknown-resource"] })).toBe(true);
  });
});
