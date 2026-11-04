import { OpenStackEndpointInterface } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * Which URL answers for which service, per region, from the catalog in the token.
 *
 * One Keystone serves any number of regions, and the catalog is how a region's
 * services are found, so a region is read by asking the catalog for it. A service
 * that is not in the catalog is simply not deployed there. A current catalog calls
 * Cinder block-storage and an older one volumev3. Each service also has its own idea
 * of what its URL ends in: Nova's says /v2.1, Cinder's /v3 and maybe a project id,
 * Neutron's and Glance's usually say nothing.
 */

export interface OpenStackCatalogEndpoint {
  url: string;
  interfaceName: string;
  regionName: string;
}

export interface OpenStackCatalogService {
  type: string;
  name: string;
  endpoints: Array<OpenStackCatalogEndpoint>;
}

// The types each service can go by, the one to prefer first.
export const OPENSTACK_CATALOG_TYPES: Readonly<
  Record<OpenStackServiceType, ReadonlyArray<string>>
> = {
  [OpenStackServiceType.Identity]: ["identity"],
  [OpenStackServiceType.Compute]: ["compute"],
  [OpenStackServiceType.Placement]: ["placement"],
  [OpenStackServiceType.Network]: ["network"],
  [OpenStackServiceType.Volume]: ["block-storage", "volumev3"],
  [OpenStackServiceType.Image]: ["image"],
};

function text(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

// The catalog in a token's answer, whatever else it may hold. Exported for tests.
export function parseOpenStackCatalog(
  value: unknown,
): Array<OpenStackCatalogService> {
  if (!Array.isArray(value)) {
    return [];
  }

  const services: Array<OpenStackCatalogService> = [];

  for (const entry of value as Array<JSONObject>) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const endpoints: Array<OpenStackCatalogEndpoint> = [];

    if (Array.isArray(entry["endpoints"])) {
      for (const endpoint of entry["endpoints"] as Array<JSONObject>) {
        if (!endpoint || typeof endpoint !== "object") {
          continue;
        }

        const url: string = text(endpoint["url"]);

        if (!url) {
          continue;
        }

        endpoints.push({
          url: url,
          interfaceName: text(endpoint["interface"]),
          regionName: text(endpoint["region_id"]) || text(endpoint["region"]),
        });
      }
    }

    services.push({
      type: text(entry["type"]),
      name: text(entry["name"]),
      endpoints: endpoints,
    });
  }

  return services;
}

// Every region the catalog names, for the services OneUptime reads.
export function getOpenStackCatalogRegions(
  catalog: ReadonlyArray<OpenStackCatalogService>,
): Array<string> {
  const known: Set<string> = new Set(
    Object.values(OPENSTACK_CATALOG_TYPES).flat(),
  );
  const regions: Set<string> = new Set();

  for (const service of catalog) {
    if (!known.has(service.type)) {
      continue;
    }

    for (const endpoint of service.endpoints) {
      if (endpoint.regionName) {
        regions.add(endpoint.regionName);
      }
    }
  }

  return Array.from(regions).sort();
}

/*
 * The URL of a service in a region, on one interface, as the catalog wrote it, or
 * null when it has none there. The interface a person picked is what they get: a
 * probe told to use `internal` is not quietly sent anywhere else.
 */
export function findOpenStackEndpoint(data: {
  catalog: ReadonlyArray<OpenStackCatalogService>;
  service: OpenStackServiceType;
  regionName: string;
  endpointInterface: OpenStackEndpointInterface;
}): string | null {
  for (const type of OPENSTACK_CATALOG_TYPES[data.service]) {
    for (const service of data.catalog) {
      if (service.type !== type) {
        continue;
      }

      for (const endpoint of service.endpoints) {
        if (
          endpoint.regionName === data.regionName &&
          endpoint.interfaceName === data.endpointInterface
        ) {
          return endpoint.url;
        }
      }
    }
  }

  return null;
}

function withoutTrailingSlash(url: string): string {
  let end: number = url.length;

  while (end > 0 && url[end - 1] === "/") {
    end--;
  }

  return url.substring(0, end);
}

function lastSegment(url: string): string {
  const path: string = new globalThis.URL(url).pathname;
  const segments: Array<string> = path.split("/").filter(Boolean);
  return segments[segments.length - 1] || "";
}

/*
 * The URL under which a service's own paths live, given what the catalog says. A URL
 * the catalog wrote badly comes back as it is, for the transport to refuse.
 */
export function toOpenStackServiceBaseUrl(
  service: OpenStackServiceType,
  catalogUrl: string,
): string {
  const url: string = withoutTrailingSlash(catalogUrl);

  try {
    new globalThis.URL(url);
  } catch {
    return url;
  }

  switch (service) {
    case OpenStackServiceType.Compute: {
      if (url.includes("/v2.1")) {
        return url;
      }

      // A legacy /v2 or /v2/<project> URL: the same API answers at /v2.1.
      const legacy: number = url.lastIndexOf("/v2");

      return legacy >= 0 ? `${url.substring(0, legacy)}/v2.1` : `${url}/v2.1`;
    }
    case OpenStackServiceType.Network:
      return lastSegment(url) === "v2.0" ? url : `${url}/v2.0`;
    case OpenStackServiceType.Image:
      return lastSegment(url) === "v2" ? url : `${url}/v2`;
    case OpenStackServiceType.Volume:
      return url.includes("/v3") ? url : `${url}/v3`;
    default:
      return url;
  }
}

/*
 * Where Nova says which microversions it speaks: its root, above /v2.1. It answers
 * without a token, so none is sent.
 */
export function getOpenStackComputeRootUrl(computeBaseUrl: string): string {
  const at: number = computeBaseUrl.lastIndexOf("/v2.1");
  const root: string =
    at >= 0 ? computeBaseUrl.substring(0, at) : computeBaseUrl;
  return `${withoutTrailingSlash(root)}/`;
}
