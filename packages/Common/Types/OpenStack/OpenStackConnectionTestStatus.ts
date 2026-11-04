/*
 * Where a connection test is, as OpenStackCloudConnectionTest.status stores it.
 *
 *   Pending -- the probe picks it up --> Running -- the probe reports --> Succeeded
 *      |                                    |                         +-> Failed
 *      +---- no probe picks it up in time --+--------------------------> Failed
 */
enum OpenStackConnectionTestStatus {
  // Started from the dashboard, and waiting for its probe's next work request.
  Pending = "Pending",
  // The probe took it and is connecting to the cloud.
  Running = "Running",
  Succeeded = "Succeeded",
  // errorCode and errorMessage say why.
  Failed = "Failed",
}

export default OpenStackConnectionTestStatus;

// Nothing more is written to a test in one of these.
export const SETTLED_OPENSTACK_CONNECTION_TEST_STATUSES: ReadonlyArray<OpenStackConnectionTestStatus> =
  [
    OpenStackConnectionTestStatus.Succeeded,
    OpenStackConnectionTestStatus.Failed,
  ];

/*
 * How long a test may wait for its probe, and then run, before it is answered as
 * failed. The probe asks for work every ten seconds, and a test reads each service
 * of each region once, so it takes longer than a vCenter's.
 */
export const OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS: number = 90;
export const OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS: number = 180;

// The most tests of one project waiting or running at once.
export const MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT: number = 5;
