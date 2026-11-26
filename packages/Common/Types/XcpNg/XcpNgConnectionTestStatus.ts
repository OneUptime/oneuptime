/*
 * Where an XCP-ng connection test is, as XcpNgConnectionTest.status stores
 * it.
 *
 *   Pending ── the probe picks it up ──> Running ── the probe reports ──> Succeeded
 *      │                                    │                         └─> Failed
 *      └──── no probe picks it up in time ──┴──────────────────────────> Failed
 */
enum XcpNgConnectionTestStatus {
  // Started from the dashboard; waiting for its probe's next work request.
  Pending = "Pending",
  // The probe took it and is connecting.
  Running = "Running",
  Succeeded = "Succeeded",
  // errorCode and errorMessage say why.
  Failed = "Failed",
}

export default XcpNgConnectionTestStatus;

// Nothing more is written to a test in one of these.
export const SETTLED_XCP_NG_CONNECTION_TEST_STATUSES: ReadonlyArray<XcpNgConnectionTestStatus> =
  [XcpNgConnectionTestStatus.Succeeded, XcpNgConnectionTestStatus.Failed];

/*
 * How long a test may wait for its probe, and then run, before it is
 * answered as failed: the probe asks for work every ten seconds, and a test
 * is a scrape and a few small reads - of every host of a pool, for XAPI.
 */
export const XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS: number = 90;
export const XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS: number = 150;

// The most tests of one project waiting or running at once.
export const MAX_ACTIVE_XCP_NG_CONNECTION_TESTS_PER_PROJECT: number = 5;
