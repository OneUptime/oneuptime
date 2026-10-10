/*
 * Where a vCenter connection test is, as VMwareVCenterConnectionTest.status
 * stores it.
 *
 *   Pending ── the probe picks it up ──> Running ── the probe reports ──> Succeeded
 *      │                                    │                         └─> Failed
 *      └──── no probe picks it up in time ──┴──────────────────────────> Failed
 */
enum VMwareConnectionTestStatus {
  // Started from the dashboard; waiting for its probe's next work request.
  Pending = "Pending",
  // The probe took it and is connecting to vCenter.
  Running = "Running",
  Succeeded = "Succeeded",
  // errorCode and errorMessage say why.
  Failed = "Failed",
}

export default VMwareConnectionTestStatus;

// Nothing more is written to a test in one of these.
export const SETTLED_VMWARE_CONNECTION_TEST_STATUSES: ReadonlyArray<VMwareConnectionTestStatus> =
  [VMwareConnectionTestStatus.Succeeded, VMwareConnectionTestStatus.Failed];

/*
 * How long a test may wait for its probe, and then run, before it is
 * answered as failed: the probe asks for work every fifteen seconds, and a
 * test is a login and a few small reads.
 */
export const VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS: number = 90;
export const VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS: number = 120;

// The most tests of one project waiting or running at once.
export const MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT: number = 5;
