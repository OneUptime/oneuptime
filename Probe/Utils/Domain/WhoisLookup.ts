import whoisJson from "whois-json";
import { DomainLookupError, DomainNotFoundError } from "./DomainLookupError";
import { DomainRecord, DomainRecordUtil } from "./DomainRecord";

type WhoisData = Record<string, unknown>;

/*
 * whois-json camel-cases every "Key: value" line it can find and throws the
 * rest away, so the same fact arrives under a different key per registry.
 * These are the aliases seen in practice, most specific first.
 */
const DOMAIN_NAME_KEYS: Array<string> = ["domainName", "domain"];

const REGISTRAR_KEYS: Array<string> = [
  "registrar",
  "registrarName",
  "sponsoringRegistrar",
];

const REGISTRAR_URL_KEYS: Array<string> = [
  "registrarUrl",
  "registrarURL",
  "referralUrl",
];

const CREATED_DATE_KEYS: Array<string> = [
  "creationDate",
  "createdDate",
  "created",
  "registered",
  "registrationTime",
  "domainRegistrationDate",
];

const UPDATED_DATE_KEYS: Array<string> = [
  "updatedDate",
  "lastUpdated",
  "lastModified",
  "changed",
];

const EXPIRES_DATE_KEYS: Array<string> = [
  "registrarRegistrationExpirationDate",
  "registryExpiryDate",
  "expirationDate",
  "expiresDate",
  "expires",
  "expiryDate",
  "expirationTime",
  "paidTill",
  "renewalDate",
  "validUntil",
];

const NAME_SERVER_KEYS: Array<string> = [
  "nameServer",
  "nameServers",
  "nameservers",
  "nserver",
];

const DNSSEC_KEYS: Array<string> = ["dnssec", "DNSSEC"];

const DOMAIN_STATUS_KEYS: Array<string> = ["domainStatus", "status", "state"];

export default class WhoisLookup {
  public static async lookup(
    domainName: string,
    options: { timeoutInMs: number },
  ): Promise<DomainRecord> {
    /*
     * The timeout used to be dropped on the floor here, which left the
     * monitor's Timeout setting doing nothing at all and a hung WHOIS socket
     * with no deadline. `follow` walks the registry -> registrar referral so
     * the detailed record is the one that gets parsed.
     */
    const result: unknown = await whoisJson(domainName, {
      timeout: options.timeoutInMs,
      follow: 2,
    });

    const record: DomainRecord = WhoisLookup.toDomainRecord(result);

    /*
     * An explicit "there is nothing registered here" - DENIC's "Status: free"
     * and friends. That is a settled answer about the domain, so it is
     * permanent and worth saying plainly.
     */
    if (DomainRecordUtil.isNotRegisteredStatus(record.domainStatus)) {
      throw new DomainNotFoundError(
        `The WHOIS server for ${domainName} reports that this domain is not registered (status: ${record.domainStatus?.join(
          ", ",
        )}).`,
      );
    }

    /*
     * The bug this guards against: retired WHOIS hosts that are still
     * listening. whois.donuts.co - still the mapped server for .digital and
     * every other Identity Digital TLD - answers "TLD is not supported."
     * plus a terms-of-use blob. None of that parses into a registration
     * field, so the lookup "succeeded" with an empty record and the monitor
     * was reported healthy with a blank expiry date.
     *
     * This stays RETRYABLE. The same content-less shape is what a registrar
     * returns when it rate-limits ("Query rate exceeded") or is briefly
     * broken, and treating those as permanent would open an incident on the
     * first blip without so much as a retry. A genuinely dead TLD simply
     * fails all its attempts and is reported then.
     */
    if (!DomainRecordUtil.hasRegistrationData(record)) {
      throw new DomainLookupError(
        `The WHOIS server for ${domainName} answered without any registration data. The TLD's WHOIS service may be unavailable, rate limiting, or no longer supported - try the RDAP or Auto lookup method.`,
      );
    }

    return record;
  }

  public static toDomainRecord(result: unknown): DomainRecord {
    const merged: WhoisData = WhoisLookup.mergeResponses(result);

    const record: DomainRecord = {};

    const domainName: string | undefined = WhoisLookup.firstString(
      merged,
      DOMAIN_NAME_KEYS,
    );

    if (domainName) {
      record.domainName = domainName.toLowerCase().replace(/\.$/, "");
    }

    const registrar: string | undefined = WhoisLookup.firstString(
      merged,
      REGISTRAR_KEYS,
    );

    if (registrar) {
      record.registrar = registrar;
    }

    const registrarUrl: string | undefined = WhoisLookup.firstString(
      merged,
      REGISTRAR_URL_KEYS,
    );

    if (registrarUrl) {
      record.registrarUrl = registrarUrl;
    }

    const createdDate: string | undefined = DomainRecordUtil.normalizeDate(
      WhoisLookup.firstString(merged, CREATED_DATE_KEYS),
    );

    if (createdDate) {
      record.createdDate = createdDate;
    }

    const updatedDate: string | undefined = DomainRecordUtil.normalizeDate(
      WhoisLookup.firstString(merged, UPDATED_DATE_KEYS),
    );

    if (updatedDate) {
      record.updatedDate = updatedDate;
    }

    const expiresDate: string | undefined = DomainRecordUtil.normalizeDate(
      WhoisLookup.firstString(merged, EXPIRES_DATE_KEYS),
    );

    if (expiresDate) {
      record.expiresDate = expiresDate;
    }

    const nameServers: Array<string> = DomainRecordUtil.parseWhoisNameServers(
      WhoisLookup.firstValue(merged, NAME_SERVER_KEYS),
    );

    if (nameServers.length > 0) {
      record.nameServers = nameServers;
    }

    const dnssec: string | undefined = WhoisLookup.firstString(
      merged,
      DNSSEC_KEYS,
    );

    if (dnssec) {
      record.dnssec = dnssec;
    }

    const domainStatus: Array<string> = DomainRecordUtil.parseWhoisDomainStatus(
      WhoisLookup.firstValue(merged, DOMAIN_STATUS_KEYS),
    );

    if (domainStatus.length > 0) {
      record.domainStatus = domainStatus;
    }

    return record;
  }

  /*
   * A followed referral chain comes back as an array. Earlier entries are
   * the registry's answer and later ones the registrar's; earlier wins on
   * conflict, later fills the gaps.
   */
  private static mergeResponses(result: unknown): WhoisData {
    if (!result) {
      return {};
    }

    if (!Array.isArray(result)) {
      return WhoisLookup.unwrap(result);
    }

    const merged: WhoisData = {};

    for (const entry of result) {
      const data: WhoisData = WhoisLookup.unwrap(entry);

      for (const key of Object.keys(data)) {
        const existing: unknown = merged[key];

        if (existing === undefined || existing === null || existing === "") {
          merged[key] = data[key];
        }
      }
    }

    return merged;
  }

  // whois-json's verbose shape is { server, data: { ...fields } }.
  private static unwrap(entry: unknown): WhoisData {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {};
    }

    const record: WhoisData = entry as WhoisData;
    const data: unknown = record["data"];

    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as WhoisData;
    }

    return record;
  }

  private static firstValue(
    data: WhoisData,
    keys: Array<string>,
  ): string | Array<string> | undefined {
    for (const key of keys) {
      const value: unknown = data[key];

      if (typeof value === "string" && value.trim()) {
        return value;
      }

      if (Array.isArray(value)) {
        const strings: Array<string> = value.filter(
          (item: unknown): item is string => {
            return typeof item === "string" && item.trim().length > 0;
          },
        );

        if (strings.length > 0) {
          return strings;
        }
      }
    }

    return undefined;
  }

  private static firstString(
    data: WhoisData,
    keys: Array<string>,
  ): string | undefined {
    const value: string | Array<string> | undefined = WhoisLookup.firstValue(
      data,
      keys,
    );

    if (Array.isArray(value)) {
      return value[0]?.trim();
    }

    return value?.trim();
  }
}
