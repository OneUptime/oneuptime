/*
 * How one ESXi host's logs reach OneUptime, as the host's Logs tab shows
 * it. Free of React so the tab, its tests and the App suite read the same
 * commands.
 *
 * ESXi runs no agent of its own, but it forwards its syslog (vmkernel,
 * hostd, vpxa and the rest) to any listener. The VMware agent has one -
 * off until you turn it on (the `syslog/*` receivers in its
 * otel-collector-config.yaml, port 5514) - and stamps what it receives with
 * the vCenter's `vmware.vcenter.name`, so the logs land on this vCenter.
 * The agent's syslog receiver parses each message (RFC 3164, ESXi's own
 * format) and puts the sender's host name in the log's `hostname`
 * attribute: that is how a host's page finds its own lines among the
 * vCenter's.
 *
 * A probe that collects a vCenter reads the vSphere API only; it does not
 * receive syslog (the agent and probe docs say so), so a probe-collected
 * vCenter's hosts have no logs.
 */

// The log attribute the agent's syslog receiver writes the sender's name to.
export const VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE: string = "hostname";

// The vCenter identity the agent stamps on every metric and log.
export const VMWARE_VCENTER_NAME_ATTRIBUTE: string =
  "resource.vmware.vcenter.name";

export const VMWARE_SYSLOG_PORT: number = 5514;

/*
 * Where the host sends its syslog. The agent's address is the one thing
 * OneUptime cannot know (it reports no address), so the commands carry it
 * as a placeholder - the same one the setup guide and the docs use.
 */
export const VMWARE_SYSLOG_TARGET: string = `udp://<agent-host>:${VMWARE_SYSLOG_PORT}`;

// The docs section that turns the agent's listener on, step by step.
export const VMWARE_SYSLOG_DOCS_PATH: string =
  "/docs/telemetry/vmware#optional-ship-esxi-syslog";

// What a probe collects and what it leaves to the agent (syslog among it).
export const VMWARE_PROBE_OR_AGENT_DOCS_PATH: string =
  "/docs/telemetry/vmware-agentless#probe-or-agent";

/*
 * The scope of a host's logs: the vCenter's logs whose sender is this host.
 * ESXi names itself in syslog as `esxcli system hostname get` reports it,
 * which is normally the name the host was added to vCenter under.
 */
export function getVMwareHostLogAttributes(data: {
  vcenterName: string;
  hostName: string;
}): Record<string, string> {
  return {
    [VMWARE_VCENTER_NAME_ATTRIBUTE]: data.vcenterName,
    [VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE]: data.hostName,
  };
}

// Run on the host itself (ESXi Shell or SSH): the same three lines as the docs.
export function getVMwareHostEsxcliSyslogCommands(): string {
  return [
    `esxcli system syslog config set --loghost='${VMWARE_SYSLOG_TARGET}'`,
    "esxcli system syslog reload",
    "esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true",
  ].join("\n");
}

/*
 * A PowerShell string literal for any text: single quotes take everything
 * as written, and a single quote inside is doubled. A vCenter object's name
 * can hold quotes and spaces (a cluster called "Prod 'A'"), and a command
 * with the name pasted in raw would break, or run something else.
 */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

/*
 * From a machine with PowerCLI, signed in to vCenter (Connect-VIServer):
 * the same setting for this one host, by the name vCenter knows it by.
 */
export function getVMwareHostPowerCliSyslogCommand(hostName: string): string {
  return `Get-VMHost -Name ${quotePowerShellLiteral(
    hostName,
  )} | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value ${quotePowerShellLiteral(
    VMWARE_SYSLOG_TARGET,
  )} -Confirm:$false`;
}

// The same for every host in the host's cluster, in one line.
export function getVMwareClusterPowerCliSyslogCommand(
  clusterName: string,
): string {
  return `Get-Cluster -Name ${quotePowerShellLiteral(
    clusterName,
  )} | Get-VMHost | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value ${quotePowerShellLiteral(
    VMWARE_SYSLOG_TARGET,
  )} -Confirm:$false`;
}

// What the host calls itself in syslog, to check against the name above.
export const VMWARE_HOST_HOSTNAME_COMMAND: string =
  "esxcli system hostname get";
