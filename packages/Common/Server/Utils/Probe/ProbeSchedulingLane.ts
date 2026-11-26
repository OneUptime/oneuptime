/*
 * The two lanes of the probes' scheduling requests (issue #10819,
 * Probe/ProbeSchedulingLimiter): each has slots and a queue of its own, so
 * one never waits behind the other.
 */
enum ProbeSchedulingLane {
  /*
   * The work the probes ask for on their own timers - monitors, network
   * devices, discovery scans, diagnostics, captures, collections, Data
   * Security and Data Observability - and the pending counts their
   * autoscalers read.
   */
  Work = "work",
  /*
   * "Test monitor" runs (/monitor-test/list): someone is waiting for the
   * answer on the Dashboard, and a probe asks for them every ten seconds.
   */
  MonitorTests = "monitor-tests",
}

export const PROBE_SCHEDULING_LANES: ReadonlyArray<ProbeSchedulingLane> = [
  ProbeSchedulingLane.Work,
  ProbeSchedulingLane.MonitorTests,
];

export default ProbeSchedulingLane;
