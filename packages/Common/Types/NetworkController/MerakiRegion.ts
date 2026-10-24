/*
 * Where a Meraki organization's dashboard - and its API - is hosted.
 *
 * Meraki runs a dashboard for most of the world and separate ones for
 * Canada, China, India and the United States' FedRAMP environment, each
 * with its own API host (developer.cisco.com/meraki/api-v1/getting-started:
 * "For organizations hosted in the following country dashboard, please
 * specify the respective base URI instead"). A key made in one of them
 * reads only that dashboard's organizations, so a connection names its
 * region, and the person picks it by the address they sign in at.
 *
 * These are the ONLY hosts a Meraki connection ever calls. The API may
 * answer a request with a redirect to another host of its own (an
 * organization's shard, n123.meraki.com); a redirect is followed only to a
 * host under the region's own domain, so the API key is never sent
 * anywhere else - and no host is ever taken from what a person typed.
 */

export enum MerakiRegion {
  Global = "global",
  Canada = "canada",
  China = "china",
  India = "india",
  UnitedStatesFedRamp = "us-fedramp",
}

export interface MerakiRegionDefinition {
  region: MerakiRegion;
  // The region's name, as an English key (translated where it is drawn).
  name: string;
  // The address people sign in at: how they recognise their region.
  dashboardHost: string;
  // The API's host.
  apiHost: string;
  /*
   * The domain every host of this region's API is under: a redirect is
   * followed to the API host or a host under this domain only.
   */
  domain: string;
}

export const MERAKI_API_BASE_PATH: string = "/api/v1";

export const DEFAULT_MERAKI_REGION: MerakiRegion = MerakiRegion.Global;

export const MERAKI_REGIONS: ReadonlyArray<MerakiRegionDefinition> = [
  {
    region: MerakiRegion.Global,
    name: "Global",
    dashboardHost: "dashboard.meraki.com",
    apiHost: "api.meraki.com",
    domain: "meraki.com",
  },
  {
    region: MerakiRegion.Canada,
    name: "Canada",
    dashboardHost: "dashboard.meraki.ca",
    apiHost: "api.meraki.ca",
    domain: "meraki.ca",
  },
  {
    region: MerakiRegion.China,
    name: "China",
    dashboardHost: "dashboard.meraki.cn",
    apiHost: "api.meraki.cn",
    domain: "meraki.cn",
  },
  {
    region: MerakiRegion.India,
    name: "India",
    dashboardHost: "dashboard.meraki.in",
    apiHost: "api.meraki.in",
    domain: "meraki.in",
  },
  {
    region: MerakiRegion.UnitedStatesFedRamp,
    name: "United States FedRAMP",
    dashboardHost: "dashboard.gov-meraki.com",
    apiHost: "api.gov-meraki.com",
    domain: "gov-meraki.com",
  },
];

export function isMerakiRegion(value: unknown): value is MerakiRegion {
  return MERAKI_REGIONS.some((definition: MerakiRegionDefinition): boolean => {
    return definition.region === value;
  });
}

// The region a value names; undefined for anything else.
export function getMerakiRegion(
  value: unknown,
): MerakiRegionDefinition | undefined {
  return MERAKI_REGIONS.find((definition: MerakiRegionDefinition): boolean => {
    return definition.region === value;
  });
}

// The region a value names, or the global dashboard's for none.
export function getMerakiRegionOrDefault(
  value: unknown,
): MerakiRegionDefinition {
  return (
    getMerakiRegion(value) ||
    (getMerakiRegion(DEFAULT_MERAKI_REGION) as MerakiRegionDefinition)
  );
}

// "https://api.meraki.com/api/v1": where every request of the region starts.
export function getMerakiApiBaseUrl(region: MerakiRegionDefinition): string {
  return `https://${region.apiHost}${MERAKI_API_BASE_PATH}`;
}

/*
 * Whether a host is one of the region's API hosts: the API host itself, or
 * a host under the region's domain (the shards the API redirects an
 * organization's requests to). Compared label by label on the parsed host,
 * never as a substring of a URL: "api.meraki.com.example.net" and
 * "evilmeraki.com" are not Meraki's.
 */
export function isMerakiApiHost(
  region: MerakiRegionDefinition,
  hostname: string,
): boolean {
  const host: string = (hostname || "").trim().toLowerCase();

  if (!host || host.endsWith(".")) {
    return false;
  }

  if (host === region.apiHost) {
    return true;
  }

  const suffix: string = `.${region.domain}`;

  return host.length > suffix.length && host.endsWith(suffix);
}
