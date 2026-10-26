import { normalizeCloudHost, readCloudEndpoints } from "./CloudInventory";

/*
 * WHICH CLOUD RESOURCE A MONITOR CHECKS, BY THE HOST IT CHECKS.
 *
 * A website, API, SSL, ping or port monitor names a host; a cloud
 * account's inventory says which host names and addresses each resource
 * answers on (CloudResource.cloudEndpoints): a load balancer's DNS name, a
 * CloudFront distribution's, an API Gateway stage's, an App Service's, a
 * Cloud Run service's, an instance's public address. The monitor's host is
 * rarely one of those itself - "shop.example.com" is a CNAME to the load
 * balancer - so the server follows the host's CNAME chain and resolves its
 * addresses (CloudEndpointSuggestions), and every name met on the way is
 * compared here.
 *
 * A match is a suggestion, never a link: the monitor's Linked Resources
 * card offers it, and a person links it.
 */

// The hosts of a monitor read, at most: a monitor has a few steps.
export const CLOUD_ENDPOINT_MAX_MONITOR_HOSTS: number = 10;

// A name a monitor's host answers under, and the host it was reached from.
export interface CloudEndpointName {
  // A host name or an address, as compared: normalizeCloudHost.
  name: string;
  // The monitor's own host this name was reached from.
  via: string;
}

// A Cloud Resource that may answer on one of those names.
export interface CloudEndpointCandidate {
  id: string;
  name: string;
  type: string;
  provider: string;
  endpoints: unknown;
}

export interface CloudEndpointSuggestion {
  cloudResourceId: string;
  name: string;
  type: string;
  provider: string;
  // The endpoint of the resource that matched.
  endpoint: string;
  // The monitor's host that leads to it.
  via: string;
}

/*
 * How AWS writes a load balancer's name in an alias or a CNAME:
 * "dualstack." before the name the load balancer itself reports.
 */
const DUALSTACK_PREFIX: string = "dualstack.";

// The spellings a name is compared under: as written, and without "dualstack.".
export function getCloudEndpointComparisonNames(name: string): Array<string> {
  const host: string = normalizeCloudHost(name);

  if (!host) {
    return [];
  }

  return host.startsWith(DUALSTACK_PREFIX) &&
    host.length > DUALSTACK_PREFIX.length
    ? [host, host.slice(DUALSTACK_PREFIX.length)]
    : [host];
}

// A destination as written: a string, or a URL, Hostname or IP (or their JSON).
function destinationText(destination: unknown): string {
  if (typeof destination === "string") {
    return destination;
  }

  if (!destination || typeof destination !== "object") {
    return "";
  }

  const record: Record<string, unknown> = destination as Record<
    string,
    unknown
  >;

  // The JSON form: { _type: "URL", value: "https://..." }.
  if (typeof record["value"] === "string") {
    return record["value"];
  }

  const text: string = String(destination);

  return text === "[object Object]" ? "" : text;
}

// The steps of a monitor's monitorSteps, in either its class or its JSON form.
function readSteps(monitorSteps: unknown): Array<unknown> {
  if (!monitorSteps || typeof monitorSteps !== "object") {
    return [];
  }

  const record: Record<string, unknown> = monitorSteps as Record<
    string,
    unknown
  >;
  const holder: unknown = record["data"] || record["value"];
  const steps: unknown =
    holder && typeof holder === "object"
      ? (holder as Record<string, unknown>)["monitorStepsInstanceArray"]
      : undefined;

  return Array.isArray(steps) ? steps : [];
}

/*
 * The hosts a monitor checks: each step's destination, normalized (a URL's
 * host, a host name, an address), without repeats, at most
 * CLOUD_ENDPOINT_MAX_MONITOR_HOSTS.
 */
export function getMonitorDestinationHosts(
  monitorSteps: unknown,
): Array<string> {
  const hosts: Array<string> = [];

  for (const step of readSteps(monitorSteps)) {
    if (hosts.length >= CLOUD_ENDPOINT_MAX_MONITOR_HOSTS) {
      break;
    }

    if (!step || typeof step !== "object") {
      continue;
    }

    const stepRecord: Record<string, unknown> = step as Record<string, unknown>;
    const data: unknown = stepRecord["data"] || stepRecord["value"];

    if (!data || typeof data !== "object") {
      continue;
    }

    const host: string = normalizeCloudHost(
      destinationText((data as Record<string, unknown>)["monitorDestination"]),
    );

    if (host && !hosts.includes(host)) {
      hosts.push(host);
    }
  }

  return hosts;
}

/*
 * The resources that answer on one of the names, each once, by the first
 * name that matches (the monitor's own host before its CNAMEs, those
 * before its addresses), sorted by name.
 */
export function matchCloudEndpoints(data: {
  names: Array<CloudEndpointName>;
  candidates: Array<CloudEndpointCandidate>;
}): Array<CloudEndpointSuggestion> {
  const suggestions: Array<CloudEndpointSuggestion> = [];
  const seen: Set<string> = new Set<string>();

  for (const candidate of data.candidates) {
    if (!candidate.id || seen.has(candidate.id)) {
      continue;
    }

    const endpoints: Set<string> = new Set<string>(
      readCloudEndpoints(candidate.endpoints).flatMap(
        (endpoint: string): Array<string> => {
          return getCloudEndpointComparisonNames(endpoint);
        },
      ),
    );

    for (const name of data.names) {
      const matched: string | undefined = getCloudEndpointComparisonNames(
        name.name,
      ).find((spelling: string): boolean => {
        return endpoints.has(spelling);
      });

      if (!matched) {
        continue;
      }

      seen.add(candidate.id);
      suggestions.push({
        cloudResourceId: candidate.id,
        name: candidate.name,
        type: candidate.type,
        provider: candidate.provider,
        endpoint: matched,
        via: name.via,
      });
      break;
    }
  }

  return suggestions.sort(
    (a: CloudEndpointSuggestion, b: CloudEndpointSuggestion): number => {
      return (
        a.name.localeCompare(b.name) ||
        a.cloudResourceId.localeCompare(b.cloudResourceId)
      );
    },
  );
}
