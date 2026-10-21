/*
 * The command that runs a custom probe, as the Network area's "Add a probe"
 * dialog prints it: the same lines as the docs (probe/custom-probe, "Run the
 * probe") and the same options as the probe's own page
 * (CustomProbeDocumentation), with the probe's ID and key filled in.
 *
 * Host networking on purpose: the probe pings and walks devices on the
 * machine's own network, and takes the SNMP traps, syslog and flow records
 * those devices send to the machine's address - which a container on
 * Docker's bridge network would not receive.
 *
 * Plain logic, free of React and of the browser, so App/Tests can read it.
 */

export const PROBE_DOCKER_IMAGE: string = "oneuptime/probe:release";

export interface ProbeRunCommandData {
  probeId: string;
  probeKey: string;
  // Where the probe reaches OneUptime, such as https://oneuptime.com.
  oneUptimeUrl: string;
}

/**
 * `docker run` for the probe, one option per line so it reads, copies and
 * edits cleanly.
 */
export function getProbeDockerRunCommand(data: ProbeRunCommandData): string {
  return [
    "docker run --name oneuptime-probe --network host \\",
    `  -e PROBE_KEY=${data.probeKey} \\`,
    `  -e PROBE_ID=${data.probeId} \\`,
    `  -e ONEUPTIME_URL=${data.oneUptimeUrl} \\`,
    `  -d ${PROBE_DOCKER_IMAGE}`,
  ].join("\n");
}
