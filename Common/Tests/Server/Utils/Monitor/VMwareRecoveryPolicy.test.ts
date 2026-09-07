import VMwareRecoveryPolicy from "../../../../Server/Utils/Monitor/VMwareRecoveryPolicy";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import MonitorType from "../../../../Types/Monitor/MonitorType";

const OPERATIONAL_ID: ObjectID = ObjectID.generate();
const OPERATIONAL_IDS: Array<string> = [OPERATIONAL_ID.toString()];

function criteria(creating: boolean): MonitorCriteriaInstance {
  const result: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  result.data!.monitorStatusId = creating
    ? ObjectID.generate()
    : OPERATIONAL_ID;
  result.data!.createIncidents = creating;
  result.data!.createAlerts = creating;
  return result;
}

describe("VMware monitor-status recovery", () => {
  test("does not reset to default status in the no-match dead band", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
      }),
    ).toBe(false);
  });
  test("a healthy series cannot restore monitor status while another series is unknown", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(false),
        unavailableSeriesFingerprints: ["unknown-resource"],
        evaluatedSeriesFingerprints: ["healthy-resource"],
        recoveredSeriesFingerprints: ["healthy-resource"],
      }),
    ).toBe(false);
  });
  test("known unhealthy criteria can still worsen status alongside an unknown resource", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(true),
        unavailableSeriesFingerprints: ["unknown-resource"],
      }),
    ).toBe(true);
  });
  test("an affirmative healthy match with complete data can restore status", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(false),
        unavailableSeriesFingerprints: [],
        evaluatedSeriesFingerprints: ["resource-a", "resource-b"],
        recoveredSeriesFingerprints: ["resource-a", "resource-b"],
      }),
    ).toBe(true);
  });
  test("a healthy resource cannot restore status while another is in the recovery dead band", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(false),
        unavailableSeriesFingerprints: [],
        evaluatedSeriesFingerprints: ["healthy-resource", "dead-band-resource"],
        recoveredSeriesFingerprints: ["healthy-resource"],
      }),
    ).toBe(false);
  });
  test("an empty evaluation cannot affirm monitor recovery", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(false),
        evaluatedSeriesFingerprints: [],
        recoveredSeriesFingerprints: [],
      }),
    ).toBe(false);
  });
  test("a fresh healthy source supplies its own affirmative recovery", () => {
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: criteria(false),
        evaluatedSeriesFingerprints: ["source"],
        recoveredSeriesFingerprints: ["source"],
      }),
    ).toBe(true);
  });
  test("disabled healthy criteria cannot supply recovery evidence", () => {
    const disabled: MonitorCriteriaInstance = criteria(false);
    disabled.data!.isEnabled = false;
    expect(
      VMwareRecoveryPolicy.isRecoveryCriteria(disabled, OPERATIONAL_IDS),
    ).toBe(false);
    expect(
      VMwareRecoveryPolicy.shouldChangeStatus({
        monitorType: MonitorType.VMware,
        operationalMonitorStatusIds: OPERATIONAL_IDS,
        criteriaInstance: disabled,
      }),
    ).toBe(false);
  });
  test.each([MonitorType.Metrics, MonitorType.Proxmox, MonitorType.Ceph])(
    "preserves default and healthy status behavior for %s",
    (monitorType: MonitorType) => {
      expect(VMwareRecoveryPolicy.shouldChangeStatus({ monitorType })).toBe(
        true,
      );
      expect(
        VMwareRecoveryPolicy.shouldChangeStatus({
          monitorType,
          criteriaInstance: criteria(false),
          unavailableSeriesFingerprints: ["unknown-resource"],
        }),
      ).toBe(true);
    },
  );
});

it("quiet Offline criteria still worsen status and never supply recovery evidence", () => {
  const quietOffline: MonitorCriteriaInstance = criteria(false);
  quietOffline.data!.monitorStatusId = ObjectID.generate();
  expect(
    VMwareRecoveryPolicy.isRecoveryCriteria(quietOffline, OPERATIONAL_IDS),
  ).toBe(false);
  expect(
    VMwareRecoveryPolicy.shouldChangeStatus({
      monitorType: MonitorType.VMware,
      criteriaInstance: quietOffline,
      operationalMonitorStatusIds: OPERATIONAL_IDS,
      unavailableSeriesFingerprints: ["unknown-resource"],
    }),
  ).toBe(true);
});
