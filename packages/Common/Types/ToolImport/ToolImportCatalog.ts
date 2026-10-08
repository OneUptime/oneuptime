import ToolImportResourceKind from "./ToolImportResourceKind";
import ToolImportSource from "./ToolImportSource";

/*
 * What OneUptime knows about each tool it imports from that is not code and
 * not copy: its name (a brand, never translated), where its API lives, which
 * regions it runs in, and what an import brings over from it. Shared by the
 * server (the hosts a read may call, the regions a person may pick) and the
 * page (the tool picker, the region choice). The words a person reads about
 * a tool - how to create its key - are the page's, in the reader's language
 * (Dashboard Components/ToolImport/ToolImportText).
 *
 * Every host is fixed here. A person picks a region, never types a URL, so
 * an import can only ever call these hosts.
 */

export interface ToolImportRegion {
  // Stored on the run and sent by the page.
  value: string;
  // How the page names it, with its host: "US (api.opsgenie.com)".
  title: string;
  host: string;
}

export interface ToolImportSourceDefinition {
  source: ToolImportSource;
  title: string;
  // Hosts a read of this tool may call (each region's host included).
  hosts: Array<string>;
  // Regions to pick from. The first is the default. Empty: one API for all.
  regions: Array<ToolImportRegion>;
  // The tool's page on creating an API key.
  apiKeyDocsUrl: string;
  // OneUptime's page on moving from the tool.
  docsPath: string;
  // What an import of this tool brings over, in the order the page lists it.
  kinds: Array<ToolImportResourceKind>;
  // The HTTP header the key goes in, and how its value is written.
  authorizationScheme: "GenieKey" | "Bearer";
}

export const OPSGENIE_US_HOST: string = "api.opsgenie.com";
export const OPSGENIE_EU_HOST: string = "api.eu.opsgenie.com";
export const INCIDENT_IO_HOST: string = "api.incident.io";

export const OPSGENIE_REGION_US: string = "US";
export const OPSGENIE_REGION_EU: string = "EU";

export const ToolImportCatalog: Record<
  ToolImportSource,
  ToolImportSourceDefinition
> = {
  [ToolImportSource.OpsGenie]: {
    source: ToolImportSource.OpsGenie,
    title: "Opsgenie",
    hosts: [OPSGENIE_US_HOST, OPSGENIE_EU_HOST],
    regions: [
      {
        value: OPSGENIE_REGION_US,
        title: `US (${OPSGENIE_US_HOST})`,
        host: OPSGENIE_US_HOST,
      },
      {
        value: OPSGENIE_REGION_EU,
        title: `EU (${OPSGENIE_EU_HOST})`,
        host: OPSGENIE_EU_HOST,
      },
    ],
    apiKeyDocsUrl:
      "https://support.atlassian.com/opsgenie/docs/api-key-management/",
    docsPath: "/docs/moving-to-oneuptime/opsgenie",
    kinds: [
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ],
    authorizationScheme: "GenieKey",
  },
  [ToolImportSource.IncidentIo]: {
    source: ToolImportSource.IncidentIo,
    title: "incident.io",
    hosts: [INCIDENT_IO_HOST],
    regions: [],
    apiKeyDocsUrl: "https://docs.incident.io/admin/api-keys",
    docsPath: "/docs/moving-to-oneuptime/incident-io",
    kinds: [
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
      ToolImportResourceKind.IncidentSeverity,
      ToolImportResourceKind.IncidentState,
      ToolImportResourceKind.IncidentRole,
      ToolImportResourceKind.IncidentCustomField,
    ],
    authorizationScheme: "Bearer",
  },
};

export function getToolImportSourceDefinition(
  source: ToolImportSource,
): ToolImportSourceDefinition {
  return ToolImportCatalog[source];
}

/*
 * The region a person picked, or the tool's default for none. Null for a
 * value that is not one of the tool's regions: the request is refused
 * rather than sent to another region's host.
 */
export function resolveToolImportRegion(
  source: ToolImportSource,
  region: unknown,
): ToolImportRegion | null {
  const definition: ToolImportSourceDefinition = ToolImportCatalog[source];

  if (definition.regions.length === 0) {
    return region === undefined || region === null || region === ""
      ? { value: "", title: definition.title, host: definition.hosts[0]! }
      : null;
  }

  if (region === undefined || region === null || region === "") {
    return definition.regions[0] || null;
  }

  return (
    definition.regions.find((candidate: ToolImportRegion): boolean => {
      return candidate.value === region;
    }) || null
  );
}
