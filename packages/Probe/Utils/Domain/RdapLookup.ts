import logger from "Common/Server/Utils/Logger";
import DomainNameUtil from "./DomainName";
import {
  DomainLookupError,
  DomainLookupErrorUtil,
  DomainLookupUnsupportedError,
  DomainNotFoundError,
} from "./DomainLookupError";
import { DomainRecord, DomainRecordUtil } from "./DomainRecord";
import RdapBootstrap, {
  IANA_RDAP_BOOTSTRAP_URL,
  RdapBootstrapResult,
} from "./RdapBootstrap";
import RdapDomainParser from "./RdapDomainParser";
import RdapHttp, { RdapHttpResponse } from "./RdapHttp";

export interface RdapLookupResult {
  record: DomainRecord;
  rdapServerUrl: string;
}

export default class RdapLookup {
  /*
   * Reads a domain's registration record over RDAP (RFC 9083), using the
   * IANA bootstrap registry (RFC 9224) to find the authoritative server.
   *
   * Throws DomainLookupUnsupportedError when the TLD publishes no RDAP
   * service - that is the normal state for .io, .co, .de and most other
   * ccTLDs, and the caller is expected to fall back to WHOIS rather than
   * treat it as an outage.
   */
  public static async lookup(
    domainName: string,
    options: { timeoutInMs: number },
  ): Promise<RdapLookupResult> {
    const bootstrap: RdapBootstrapResult =
      await RdapBootstrap.getServiceUrlsForDomain(domainName, {
        timeoutInMs: options.timeoutInMs,
      });

    /*
     * Not reaching IANA says nothing about the TLD. Reporting it as "this TLD
     * has no RDAP service" would be both untrue and permanent, which would
     * skip the retries and the probe-connectivity gate and open an incident
     * on every domain monitor on the probe during a data.iana.org outage.
     */
    if (!bootstrap.isRegistryAvailable) {
      throw new DomainLookupError(
        `Could not read the IANA RDAP bootstrap registry at ${IANA_RDAP_BOOTSTRAP_URL}, so the RDAP service for .${DomainNameUtil.getTld(
          domainName,
        )} is unknown.`,
      );
    }

    const baseUrls: Array<string> = bootstrap.serviceUrls;

    if (baseUrls.length === 0) {
      throw new DomainLookupUnsupportedError(
        `No RDAP service is published for .${DomainNameUtil.getTld(
          domainName,
        )} in the IANA RDAP bootstrap registry. Use the WHOIS or Auto lookup method for this domain.`,
      );
    }

    let lastError: unknown = null;

    /*
     * A TLD can list more than one RDAP endpoint. Try each in turn so one
     * mirror being down does not fail the check.
     */
    for (const baseUrl of baseUrls) {
      const url: string = `${baseUrl}domain/${encodeURIComponent(domainName)}`;

      try {
        return {
          record: await RdapLookup.queryServer(url, options),
          rdapServerUrl: baseUrl,
        };
      } catch (err: unknown) {
        // "Not registered" is an answer, not a reason to try the next mirror.
        if (err instanceof DomainNotFoundError) {
          throw err;
        }

        logger.debug(
          `RDAP query failed against ${url}: ${DomainLookupErrorUtil.getMessage(
            err,
          )}`,
        );

        lastError = err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new DomainLookupError(
          `RDAP lookup for ${domainName} failed against every server published for its TLD.`,
        );
  }

  private static async queryServer(
    url: string,
    options: { timeoutInMs: number },
  ): Promise<DomainRecord> {
    const response: RdapHttpResponse = await RdapHttp.getJson(url, {
      timeoutInMs: options.timeoutInMs,
    });

    if (response.statusCode === 404) {
      throw new DomainNotFoundError(
        `The registry's RDAP service reports that this domain is not registered (HTTP 404 from ${url}).`,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new DomainLookupError(
        `RDAP server returned HTTP ${response.statusCode} for ${url}.`,
      );
    }

    const record: DomainRecord = RdapDomainParser.parse(response.body);

    if (!DomainRecordUtil.hasRegistrationData(record)) {
      throw new DomainLookupError(
        `RDAP server at ${url} answered without any registration data.`,
      );
    }

    return record;
  }
}
