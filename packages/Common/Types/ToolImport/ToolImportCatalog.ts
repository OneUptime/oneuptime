import Dictionary from "../Dictionary";
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
 * an import can only ever call these hosts. The one exception is a tool
 * people also run themselves (Grafana OnCall): its address is the one the
 * person gives, and every request to it goes through OneUptime's egress
 * guard (Server/Utils/ToolImport/ToolImportHttpClient
 * createToolImportAddressTransport), the policy OneUptime holds every
 * other address a project member chooses to. A tool with no API to read
 * (Uptime Kuma) is read from a file the person uploads, and OneUptime
 * calls nothing at all.
 */

export interface ToolImportRegion {
  // Stored on the run and sent by the page.
  value: string;
  // How the page names it, with its host: "US (api.opsgenie.com)".
  title: string;
  host: string;
}

/*
 * How the key travels, in the tool's own header:
 *  - GenieKey: Authorization: GenieKey <key> (Opsgenie)
 *  - Bearer: Authorization: Bearer <key> (incident.io, UptimeRobot,
 *    Pingdom, Better Stack, StatusCake)
 *  - TokenToken: Authorization: Token token=<key> (PagerDuty)
 *  - Plain: Authorization: <key> (Grafana OnCall's API tokens)
 *  - ApiIdAndKey: X-VO-Api-Id: <API ID> and X-VO-Api-Key: <key>
 *    (Splunk On-Call)
 *  - OAuth: Authorization: OAuth <key> (Atlassian Statuspage)
 *  - None: the tool is read from a file the person uploads, not over an
 *    API (Uptime Kuma), so there is no key.
 */
export type ToolImportAuthorizationScheme =
  | "GenieKey"
  | "Bearer"
  | "TokenToken"
  | "Plain"
  | "ApiIdAndKey"
  | "OAuth"
  | "None";

/*
 * Which group the page lists a tool in: the on-call and incident tools a
 * team is paged from, or the uptime monitoring and status page tools.
 */
export enum ToolImportCategory {
  OnCall = "OnCall",
  Monitoring = "Monitoring",
}

/*
 * A tool that is read from a file the person uploads rather than over an
 * API - Uptime Kuma, which people run themselves and which has no API to
 * read monitors from. The file goes to the server once, is read there, and
 * is never stored (Server/Utils/ToolImport/Adapters/UptimeKuma).
 */
export interface ToolImportFileUpload {
  // What the browser's file picker offers ("Accept" attribute).
  accept: string;
}

/*
 * What a person gives the page to connect a tool, besides the region:
 * always the key, and for some tools the key's ID (Splunk On-Call) or the
 * address of the tool's API (Grafana OnCall). The value is the field's name
 * in the read request and in ToolImportCredentials.
 */
export enum ToolImportCredentialField {
  ApiKey = "apiKey",
  ApiKeyId = "apiKeyId",
  ApiUrl = "apiUrl",
}

export interface ToolImportSourceDefinition {
  source: ToolImportSource;
  title: string;
  category: ToolImportCategory;
  /*
   * Hosts a read of this tool may call (each region's host included).
   * Empty for a tool whose address the person gives (apiUrlExample).
   */
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
  authorizationScheme: ToolImportAuthorizationScheme;
  // What the page asks for, in the order it asks. The key is always one.
  credentialFields: Array<ToolImportCredentialField>;
  // Headers every request to the tool carries besides the key's.
  headers?: Dictionary<string> | undefined;
  /*
   * The least time between two requests, for a tool whose documented rate
   * limit is per second or per few minutes: the read keeps under it rather
   * than learning it from refusals.
   */
  minRequestIntervalMs?: number | undefined;
  /*
   * For a tool whose address the person gives: what the address looks
   * like, shown as the field's example and in the docs.
   */
  apiUrlExample?: string | undefined;
  // For a tool read from a file the person uploads: what the file may be.
  fileUpload?: ToolImportFileUpload | undefined;
}

export const OPSGENIE_US_HOST: string = "api.opsgenie.com";
export const OPSGENIE_EU_HOST: string = "api.eu.opsgenie.com";
export const INCIDENT_IO_HOST: string = "api.incident.io";
export const PAGERDUTY_US_HOST: string = "api.pagerduty.com";
export const PAGERDUTY_EU_HOST: string = "api.eu.pagerduty.com";
export const SPLUNK_ON_CALL_HOST: string = "api.victorops.com";
export const UPTIMEROBOT_HOST: string = "api.uptimerobot.com";
export const PINGDOM_HOST: string = "api.pingdom.com";
export const BETTER_STACK_HOST: string = "incidents.betterstack.com";
export const STATUSCAKE_HOST: string = "api.statuscake.com";
export const ATLASSIAN_STATUSPAGE_HOST: string = "api.statuspage.io";

export const OPSGENIE_REGION_US: string = "US";
export const OPSGENIE_REGION_EU: string = "EU";
export const PAGERDUTY_REGION_US: string = "US";
export const PAGERDUTY_REGION_EU: string = "EU";

// Grafana Cloud's OnCall API address, as Grafana's own docs write it.
export const GRAFANA_ONCALL_API_URL_EXAMPLE: string =
  "https://oncall-prod-us-central-0.grafana.net/oncall";

export const ToolImportCatalog: Record<
  ToolImportSource,
  ToolImportSourceDefinition
> = {
  [ToolImportSource.OpsGenie]: {
    source: ToolImportSource.OpsGenie,
    title: "Opsgenie",
    category: ToolImportCategory.OnCall,
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
    credentialFields: [ToolImportCredentialField.ApiKey],
  },
  [ToolImportSource.PagerDuty]: {
    source: ToolImportSource.PagerDuty,
    title: "PagerDuty",
    category: ToolImportCategory.OnCall,
    hosts: [PAGERDUTY_US_HOST, PAGERDUTY_EU_HOST],
    regions: [
      {
        value: PAGERDUTY_REGION_US,
        title: `US (${PAGERDUTY_US_HOST})`,
        host: PAGERDUTY_US_HOST,
      },
      {
        value: PAGERDUTY_REGION_EU,
        title: `EU (${PAGERDUTY_EU_HOST})`,
        host: PAGERDUTY_EU_HOST,
      },
    ],
    apiKeyDocsUrl:
      "https://support.pagerduty.com/main/docs/api-access-keys#generate-a-general-access-rest-api-key",
    docsPath: "/docs/moving-to-oneuptime/pagerduty",
    kinds: [
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ],
    authorizationScheme: "TokenToken",
    credentialFields: [ToolImportCredentialField.ApiKey],
    // PagerDuty's REST API is versioned by this header.
    headers: { Accept: "application/vnd.pagerduty+json;version=2" },
  },
  [ToolImportSource.IncidentIo]: {
    source: ToolImportSource.IncidentIo,
    title: "incident.io",
    category: ToolImportCategory.OnCall,
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
    credentialFields: [ToolImportCredentialField.ApiKey],
  },
  [ToolImportSource.SplunkOnCall]: {
    source: ToolImportSource.SplunkOnCall,
    title: "Splunk On-Call",
    category: ToolImportCategory.OnCall,
    hosts: [SPLUNK_ON_CALL_HOST],
    regions: [],
    apiKeyDocsUrl:
      "https://help.splunk.com/en/splunk-enterprise/alert-and-respond/splunk-on-call/introduction-to-splunk-on-call/splunk-on-call-api",
    docsPath: "/docs/moving-to-oneuptime/splunk-on-call",
    kinds: [
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
    ],
    authorizationScheme: "ApiIdAndKey",
    credentialFields: [
      ToolImportCredentialField.ApiKeyId,
      ToolImportCredentialField.ApiKey,
    ],
    // Splunk On-Call answers each endpoint at most twice a second.
    minRequestIntervalMs: 600,
  },
  [ToolImportSource.GrafanaOnCall]: {
    source: ToolImportSource.GrafanaOnCall,
    title: "Grafana OnCall",
    category: ToolImportCategory.OnCall,
    hosts: [],
    regions: [],
    apiKeyDocsUrl:
      "https://grafana.com/docs/oncall/latest/oncall-api-reference/",
    docsPath: "/docs/moving-to-oneuptime/grafana-oncall",
    kinds: [
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
    ],
    authorizationScheme: "Plain",
    credentialFields: [
      ToolImportCredentialField.ApiUrl,
      ToolImportCredentialField.ApiKey,
    ],
    /*
     * Grafana OnCall allows 300 API requests per key in five minutes on a
     * self-hosted install (Grafana Cloud allows more): one a second keeps
     * under both.
     */
    minRequestIntervalMs: 1000,
    apiUrlExample: GRAFANA_ONCALL_API_URL_EXAMPLE,
  },
  [ToolImportSource.UptimeRobot]: {
    source: ToolImportSource.UptimeRobot,
    title: "UptimeRobot",
    category: ToolImportCategory.Monitoring,
    hosts: [UPTIMEROBOT_HOST],
    regions: [],
    apiKeyDocsUrl: "https://uptimerobot.com/api/v3/",
    docsPath: "/docs/moving-to-oneuptime/uptimerobot",
    kinds: [ToolImportResourceKind.Monitor, ToolImportResourceKind.StatusPage],
    authorizationScheme: "Bearer",
    credentialFields: [ToolImportCredentialField.ApiKey],
    /*
     * UptimeRobot answers a Free account ten times a minute: one request
     * every six seconds keeps under it on every plan.
     */
    minRequestIntervalMs: 6000,
  },
  [ToolImportSource.AtlassianStatuspage]: {
    source: ToolImportSource.AtlassianStatuspage,
    title: "Atlassian Statuspage",
    category: ToolImportCategory.Monitoring,
    hosts: [ATLASSIAN_STATUSPAGE_HOST],
    regions: [],
    apiKeyDocsUrl:
      "https://support.atlassian.com/statuspage/docs/create-and-manage-api-keys/",
    docsPath: "/docs/moving-to-oneuptime/atlassian-statuspage",
    // Components become manual monitors, which the pages show.
    kinds: [
      ToolImportResourceKind.Monitor,
      ToolImportResourceKind.StatusPage,
      ToolImportResourceKind.StatusPageSubscriber,
    ],
    authorizationScheme: "OAuth",
    credentialFields: [ToolImportCredentialField.ApiKey],
    // Statuspage answers each key once a second.
    minRequestIntervalMs: 1000,
  },
  [ToolImportSource.BetterStack]: {
    source: ToolImportSource.BetterStack,
    title: "Better Stack",
    category: ToolImportCategory.Monitoring,
    hosts: [BETTER_STACK_HOST],
    regions: [],
    apiKeyDocsUrl:
      "https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/",
    docsPath: "/docs/moving-to-oneuptime/better-stack",
    kinds: [
      ToolImportResourceKind.Monitor,
      ToolImportResourceKind.StatusPage,
      ToolImportResourceKind.StatusPageSubscriber,
    ],
    authorizationScheme: "Bearer",
    credentialFields: [ToolImportCredentialField.ApiKey],
    minRequestIntervalMs: 300,
  },
  [ToolImportSource.Pingdom]: {
    source: ToolImportSource.Pingdom,
    title: "Pingdom",
    category: ToolImportCategory.Monitoring,
    hosts: [PINGDOM_HOST],
    regions: [],
    apiKeyDocsUrl: "https://docs.pingdom.com/api/",
    docsPath: "/docs/moving-to-oneuptime/pingdom",
    kinds: [ToolImportResourceKind.Monitor],
    authorizationScheme: "Bearer",
    credentialFields: [ToolImportCredentialField.ApiKey],
    // Pingdom counts requests per token; a check's details are one each.
    minRequestIntervalMs: 500,
  },
  [ToolImportSource.StatusCake]: {
    source: ToolImportSource.StatusCake,
    title: "StatusCake",
    category: ToolImportCategory.Monitoring,
    hosts: [STATUSCAKE_HOST],
    regions: [],
    apiKeyDocsUrl:
      "https://developers.statuscake.com/guides/api/authentication/",
    docsPath: "/docs/moving-to-oneuptime/statuscake",
    kinds: [ToolImportResourceKind.Monitor],
    authorizationScheme: "Bearer",
    credentialFields: [ToolImportCredentialField.ApiKey],
    // StatusCake answers a Free account 60 times a minute.
    minRequestIntervalMs: 1000,
  },
  [ToolImportSource.UptimeKuma]: {
    source: ToolImportSource.UptimeKuma,
    title: "Uptime Kuma",
    category: ToolImportCategory.Monitoring,
    // Read from a file the person uploads: OneUptime calls nothing.
    hosts: [],
    regions: [],
    apiKeyDocsUrl:
      "https://github.com/louislam/uptime-kuma/wiki/Prometheus-Integration",
    docsPath: "/docs/moving-to-oneuptime/uptime-kuma",
    kinds: [ToolImportResourceKind.Monitor],
    authorizationScheme: "None",
    credentialFields: [],
    fileUpload: {
      accept: ".json,.txt,application/json,text/plain",
    },
  },
};

export function getToolImportSourceDefinition(
  source: ToolImportSource,
): ToolImportSourceDefinition {
  return ToolImportCatalog[source];
}

// Whether the person gives the tool's address (it is not fixed here).
export function isToolImportAddressGiven(
  definition: ToolImportSourceDefinition,
): boolean {
  return definition.credentialFields.includes(ToolImportCredentialField.ApiUrl);
}

/*
 * Whether the tool is read from a file the person uploads (Uptime Kuma)
 * rather than over its API: it has no key, no host and no read worker.
 */
export function isToolImportFileUpload(
  definition: ToolImportSourceDefinition,
): boolean {
  return Boolean(definition.fileUpload);
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
      ? {
          value: "",
          title: definition.title,
          host: definition.hosts[0] || "",
        }
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
