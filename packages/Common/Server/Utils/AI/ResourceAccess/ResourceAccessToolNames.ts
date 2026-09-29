/*
 * Names of the AI tools that reach an infrastructure resource (a Docker or
 * Podman host, a Docker Swarm, Proxmox, VMware or Ceph cluster, a database
 * server or a host) through its resource AI agent, shared with the
 * dashboard so the investigation panel can count "infrastructure commands"
 * from the run's events without importing server code.
 *
 * Deliberately dependency-free: the investigation engine, the toolkit, the
 * report parser and the dashboard bundle all import it.
 */
export const RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME: string =
  "run_infrastructure_command";
export const LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME: string =
  "list_infrastructure_access";

// Every tool that reaches a resource rather than the project's telemetry.
export const INFRASTRUCTURE_TOOL_NAMES: ReadonlyArray<string> = [
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
];

export function isInfrastructureToolName(
  toolName: string | null | undefined,
): boolean {
  return INFRASTRUCTURE_TOOL_NAMES.includes(toolName || "");
}

/*
 * How the run's persisted event starts for an infrastructure command an
 * agent took whose result never came back — whether it ran is unknown, so
 * it is never counted as "did not run". The server writes it
 * (InfrastructureInvestigationToolkit) and the investigation panel reads it
 * (Components/AI/ClusterToolFormat); this is the one definition both use.
 */
export const INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX: string =
  "infrastructure command result unknown:";

export function isInfrastructureResultUnknownMessage(
  errorMessage: string | null | undefined,
): boolean {
  return (
    typeof errorMessage === "string" &&
    errorMessage.startsWith(INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX)
  );
}
