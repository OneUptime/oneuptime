/*
 * Which of OneUptime's own probes an address is (#10338, #10429): one of
 * the project's, one of OneUptime's (which belong to no project), or one of
 * OneUptime Cloud's probe addresses as the instance's IP_WHITELIST setting
 * lists them (Server/Utils/Probe/OneUptimeProbeAddresses).
 */
enum OneUptimeProbeKind {
  // One of the project's own probes.
  Project = "project",
  // One of OneUptime's probes, which belong to no project.
  Global = "global",
  // OneUptime Cloud's probe addresses, as the instance's setting lists them.
  OneUptimeCloud = "oneuptime-cloud",
}

export default OneUptimeProbeKind;
