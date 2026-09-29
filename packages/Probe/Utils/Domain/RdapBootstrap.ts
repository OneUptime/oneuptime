import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import DomainNameUtil from "./DomainName";
import RdapHttp, { RdapHttpResponse } from "./RdapHttp";

/*
 * RFC 9224. IANA publishes which RDAP service is authoritative for which
 * TLD; it is the only way to find a registry's RDAP base URL that does not
 * go stale the way a hardcoded WHOIS server map does.
 */
export const IANA_RDAP_BOOTSTRAP_URL: string =
  "https://data.iana.org/rdap/dns.json";

// The document changes a handful of times a year.
export const BOOTSTRAP_CACHE_TTL_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * A probe that cannot reach data.iana.org should degrade to WHOIS quickly
 * rather than pay the fetch timeout on every single check, but it should
 * also start using RDAP again on its own once the network recovers.
 */
export const BOOTSTRAP_FAILURE_CACHE_TTL_IN_MS: number = 5 * 60 * 1000;

export const BOOTSTRAP_FETCH_TIMEOUT_IN_MS: number = 15000;

export interface RdapBootstrapResult {
  // False only when the IANA registry could not be read at all.
  isRegistryAvailable: boolean;
  serviceUrls: Array<string>;
}

export default class RdapBootstrap {
  private static serviceUrlsBySuffix: Map<string, Array<string>> | null = null;
  private static cachedAtInMs: number = 0;
  private static lastFailedAtInMs: number = 0;
  private static inFlightLoad: Promise<Map<
    string,
    Array<string>
  > | null> | null = null;

  public static clearCache(): void {
    RdapBootstrap.serviceUrlsBySuffix = null;
    RdapBootstrap.cachedAtInMs = 0;
    RdapBootstrap.lastFailedAtInMs = 0;
    RdapBootstrap.inFlightLoad = null;
  }

  /*
   * Every RDAP base URL that claims the longest matching suffix of this
   * domain, most-preferred first.
   *
   * isRegistryAvailable is the load-bearing part of the result. An empty
   * serviceUrls with the registry AVAILABLE means "this TLD publishes no
   * RDAP service", which is the normal state of affairs for .io, .co, .de
   * and most other ccTLDs and is permanent. An empty serviceUrls with the
   * registry UNAVAILABLE means we could not reach IANA, which is transient
   * and must not be reported as a fact about the TLD.
   */
  public static async getServiceUrlsForDomain(
    domainName: string,
    options?: { timeoutInMs?: number | undefined },
  ): Promise<RdapBootstrapResult> {
    const registry: Map<string, Array<string>> | null =
      await RdapBootstrap.getRegistry(options);

    if (!registry) {
      return { isRegistryAvailable: false, serviceUrls: [] };
    }

    for (const candidate of DomainNameUtil.getSuffixCandidates(
      domainName.toLowerCase(),
    )) {
      const urls: Array<string> | undefined = registry.get(candidate);

      if (urls && urls.length > 0) {
        return { isRegistryAvailable: true, serviceUrls: urls };
      }
    }

    return { isRegistryAvailable: true, serviceUrls: [] };
  }

  public static parseBootstrapDocument(
    json: JSONObject | null,
  ): Map<string, Array<string>> {
    const registry: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    const services: unknown = json ? json["services"] : null;

    if (!Array.isArray(services)) {
      return registry;
    }

    for (const service of services) {
      if (!Array.isArray(service) || service.length < 2) {
        continue;
      }

      const suffixes: unknown = service[0];
      const urls: unknown = service[1];

      if (!Array.isArray(suffixes) || !Array.isArray(urls)) {
        continue;
      }

      const baseUrls: Array<string> = RdapBootstrap.normalizeServiceUrls(urls);

      if (baseUrls.length === 0) {
        continue;
      }

      for (const suffix of suffixes) {
        if (typeof suffix !== "string") {
          continue;
        }

        const key: string = suffix
          .trim()
          .toLowerCase()
          .replace(/^\.+|\.+$/g, "");

        if (!key) {
          continue;
        }

        const existing: Array<string> = registry.get(key) || [];

        registry.set(key, [...existing, ...baseUrls]);
      }
    }

    return registry;
  }

  /*
   * Base URLs are documented to end in "/" but not every entry does, and a
   * few entries are plain HTTP. HTTPS is preferred and the trailing slash is
   * made uniform so callers can just append "domain/<name>".
   */
  private static normalizeServiceUrls(urls: Array<unknown>): Array<string> {
    const httpsUrls: Array<string> = [];
    const otherUrls: Array<string> = [];

    for (const url of urls) {
      if (typeof url !== "string") {
        continue;
      }

      const trimmed: string = url.trim();

      if (!trimmed) {
        continue;
      }

      const withSlash: string = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;

      if (withSlash.toLowerCase().startsWith("https://")) {
        httpsUrls.push(withSlash);
      } else if (withSlash.toLowerCase().startsWith("http://")) {
        otherUrls.push(withSlash);
      }
    }

    return [...httpsUrls, ...otherUrls];
  }

  private static async getRegistry(options?: {
    timeoutInMs?: number | undefined;
  }): Promise<Map<string, Array<string>> | null> {
    const now: number = Date.now();

    if (
      RdapBootstrap.serviceUrlsBySuffix &&
      now - RdapBootstrap.cachedAtInMs < BOOTSTRAP_CACHE_TTL_IN_MS
    ) {
      return RdapBootstrap.serviceUrlsBySuffix;
    }

    if (
      RdapBootstrap.lastFailedAtInMs &&
      now - RdapBootstrap.lastFailedAtInMs < BOOTSTRAP_FAILURE_CACHE_TTL_IN_MS
    ) {
      // Serve a stale copy if there is one; otherwise let the caller use WHOIS.
      return RdapBootstrap.serviceUrlsBySuffix;
    }

    // Many monitors run at once - one fetch serves all of them.
    if (!RdapBootstrap.inFlightLoad) {
      RdapBootstrap.inFlightLoad = RdapBootstrap.load(options).finally(() => {
        RdapBootstrap.inFlightLoad = null;
      });
    }

    return RdapBootstrap.inFlightLoad;
  }

  private static async load(options?: {
    timeoutInMs?: number | undefined;
  }): Promise<Map<string, Array<string>> | null> {
    try {
      const response: RdapHttpResponse = await RdapHttp.getJson(
        IANA_RDAP_BOOTSTRAP_URL,
        {
          /*
           * This fetch is shared by every domain monitor on the probe, so it
           * must not inherit whichever monitor happened to trigger it. A
           * monitor with a 2s timeout would otherwise abort the ~200KB
           * document for everybody and poison the failure cache.
           */
          timeoutInMs: Math.max(
            options?.timeoutInMs || 0,
            BOOTSTRAP_FETCH_TIMEOUT_IN_MS,
          ),
        },
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          `IANA RDAP bootstrap returned HTTP ${response.statusCode}`,
        );
      }

      const registry: Map<
        string,
        Array<string>
      > = RdapBootstrap.parseBootstrapDocument(response.body);

      if (registry.size === 0) {
        throw new Error("IANA RDAP bootstrap document listed no services");
      }

      RdapBootstrap.serviceUrlsBySuffix = registry;
      RdapBootstrap.cachedAtInMs = Date.now();
      RdapBootstrap.lastFailedAtInMs = 0;

      logger.debug(
        `RDAP bootstrap loaded: ${registry.size} suffixes from ${IANA_RDAP_BOOTSTRAP_URL}`,
      );

      return registry;
    } catch (err: unknown) {
      RdapBootstrap.lastFailedAtInMs = Date.now();

      logger.debug(
        `RDAP bootstrap fetch failed, domain lookups will fall back to WHOIS: ${
          (err as Error)?.message || String(err)
        }`,
      );

      // A stale registry still beats no registry.
      return RdapBootstrap.serviceUrlsBySuffix;
    }
  }
}
