/*
 * The command that runs a custom probe, as the Network area's "Add a probe"
 * dialog and the probe's own page (CustomProbeDocumentation) print it: the
 * same lines as the docs (probe/custom-probe, "Run the probe"), with the
 * probe's ID and key filled in.
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

/*
 * The variables a probe behind a proxy adds (the docs' "Connecting through
 * a proxy"), with and without the proxy's own sign-in.
 */
export const PROBE_PROXY_ENVIRONMENT: Array<string> = [
  "HTTP_PROXY_URL=http://proxy.example.com:8080",
  "HTTPS_PROXY_URL=http://proxy.example.com:8080",
  "NO_PROXY=localhost,.internal.example.com",
];

export const PROBE_PROXY_WITH_SIGN_IN_ENVIRONMENT: Array<string> = [
  "HTTP_PROXY_URL=http://username:password@proxy.example.com:8080",
  "HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080",
  "NO_PROXY=localhost,.internal.example.com",
];

// The lines of `docker run`, with more variables after the probe's own.
function getDockerRunLines(
  data: ProbeRunCommandData,
  moreEnvironment: Array<string>,
): Array<string> {
  return [
    "docker run --name oneuptime-probe --network host \\",
    `  -e PROBE_KEY=${data.probeKey} \\`,
    `  -e PROBE_ID=${data.probeId} \\`,
    `  -e ONEUPTIME_URL=${data.oneUptimeUrl} \\`,
    ...moreEnvironment.map((variable: string): string => {
      return `  -e ${variable} \\`;
    }),
    `  -d ${PROBE_DOCKER_IMAGE}`,
  ];
}

/**
 * `docker run` for the probe, one option per line so it reads, copies and
 * edits cleanly.
 */
export function getProbeDockerRunCommand(data: ProbeRunCommandData): string {
  return getDockerRunLines(data, []).join("\n");
}

/**
 * The same command through an HTTP/HTTPS proxy, then through one that asks
 * for a username and password: every line but the last ends with a
 * backslash, so each pastes as one command.
 */
export function getProbeDockerRunCommandsThroughProxy(
  data: ProbeRunCommandData,
): string {
  return [
    "# With HTTP/HTTPS proxy",
    ...getDockerRunLines(data, PROBE_PROXY_ENVIRONMENT),
    "",
    "# With proxy authentication",
    ...getDockerRunLines(data, PROBE_PROXY_WITH_SIGN_IN_ENVIRONMENT),
  ].join("\n");
}
