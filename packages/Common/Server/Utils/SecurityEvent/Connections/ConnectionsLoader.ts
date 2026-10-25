import type IncidentSecurityType from "./IncidentSecurity";
import type SecurityConnectedRecordsType from "./SecurityConnectedRecords";
import type * as SecurityConnectionsModule from "./SecurityConnections";

/*
 * THE CONNECTIONS, LOADED AT THEIR FIRST READ.
 *
 * The connections read the project's hosts, container hosts, clusters,
 * devices, services and members, and those services' own imports reach
 * back to IncidentService - whose investigation runner reads a security
 * case's context (SecurityCaseIncidentContext, SecurityCaseAIContextBuilder),
 * which reads the connections. Imported at the top of that context, they
 * loaded HostService part way through IncidentService, and a module that
 * keeps a reference taken while it loads kept undefined:
 * ResourceAiAccessService's model specs did, and every host's AI access
 * test failed with a TypeError. So the code that IncidentService's own
 * imports reach - the AI contexts and the playbook's Declare Incident -
 * takes the connections from here, when it first reads them. The API reads
 * them directly: nothing it loads waits on it.
 */

export function loadSecurityConnections(): typeof SecurityConnectionsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("./SecurityConnections");
}

export function loadSecurityConnectedRecords(): typeof SecurityConnectedRecordsType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("./SecurityConnectedRecords").default;
}

export function loadIncidentSecurity(): typeof IncidentSecurityType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("./IncidentSecurity").default;
}
