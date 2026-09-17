import { JSONObject } from "Common/Types/JSON";
import { DomainRecord, DomainRecordUtil } from "./DomainRecord";

/*
 * RDAP event actions this parser cares about (RFC 9083 section 10.2.3).
 * "last update of RDAP database" is deliberately not mapped to updatedDate -
 * it describes the registry's database, not the registration.
 */
const EVENT_REGISTRATION: string = "registration";
const EVENT_EXPIRATION: string = "expiration";
const EVENT_LAST_CHANGED: string = "last changed";

/*
 * Turns an RFC 9083 domain object into the flat record a domain monitor
 * evaluates. Pure - no I/O - so every registry response shape encountered in
 * the wild can be covered by a test.
 */
export default class RdapDomainParser {
  public static parse(json: JSONObject | null): DomainRecord {
    if (!json) {
      return {};
    }

    const record: DomainRecord = {};

    const domainName: string | undefined =
      RdapDomainParser.asString(json["ldhName"]) ||
      RdapDomainParser.asString(json["unicodeName"]);

    if (domainName) {
      record.domainName = domainName.toLowerCase().replace(/\.$/, "");
    }

    const eventDates: Map<string, string> = RdapDomainParser.parseEvents(
      json["events"],
    );

    const createdDate: string | undefined = eventDates.get(EVENT_REGISTRATION);
    const expiresDate: string | undefined = eventDates.get(EVENT_EXPIRATION);
    const updatedDate: string | undefined = eventDates.get(EVENT_LAST_CHANGED);

    if (createdDate) {
      record.createdDate = createdDate;
    }

    if (expiresDate) {
      record.expiresDate = expiresDate;
    }

    if (updatedDate) {
      record.updatedDate = updatedDate;
    }

    const domainStatus: Array<string> =
      DomainRecordUtil.normalizeDomainStatuses(
        RdapDomainParser.asStringArray(json["status"]),
      );

    if (domainStatus.length > 0) {
      record.domainStatus = domainStatus;
    }

    const nameServers: Array<string> = RdapDomainParser.parseNameServers(
      json["nameservers"],
    );

    if (nameServers.length > 0) {
      record.nameServers = nameServers;
    }

    const dnssec: string | undefined = RdapDomainParser.parseSecureDNS(
      json["secureDNS"],
    );

    if (dnssec) {
      record.dnssec = dnssec;
    }

    const registrar: { name?: string; url?: string } =
      RdapDomainParser.parseRegistrar(json["entities"]);

    if (registrar.name) {
      record.registrar = registrar.name;
    }

    if (registrar.url) {
      record.registrarUrl = registrar.url;
    }

    return record;
  }

  private static parseEvents(events: unknown): Map<string, string> {
    const dates: Map<string, string> = new Map<string, string>();

    if (!Array.isArray(events)) {
      return dates;
    }

    for (const event of events) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        continue;
      }

      const action: string | undefined = RdapDomainParser.asString(
        (event as JSONObject)["eventAction"],
      );
      const date: string | undefined = DomainRecordUtil.normalizeDate(
        (event as JSONObject)["eventDate"],
      );

      if (!action || !date) {
        continue;
      }

      const key: string = action.trim().toLowerCase();

      // First occurrence wins; registries do not repeat these actions.
      if (!dates.has(key)) {
        dates.set(key, date);
      }
    }

    return dates;
  }

  private static parseNameServers(nameservers: unknown): Array<string> {
    if (!Array.isArray(nameservers)) {
      return [];
    }

    const hosts: Array<string | undefined> = nameservers.map(
      (nameserver: unknown): string | undefined => {
        if (typeof nameserver === "string") {
          return nameserver;
        }

        if (
          !nameserver ||
          typeof nameserver !== "object" ||
          Array.isArray(nameserver)
        ) {
          return undefined;
        }

        return (
          RdapDomainParser.asString((nameserver as JSONObject)["ldhName"]) ||
          RdapDomainParser.asString((nameserver as JSONObject)["unicodeName"])
        );
      },
    );

    return DomainRecordUtil.normalizeNameServers(hosts);
  }

  /*
   * Reported with the same vocabulary WHOIS uses ("signedDelegation" /
   * "unsigned") so a criterion written against one lookup method keeps
   * matching under the other.
   */
  private static parseSecureDNS(secureDNS: unknown): string | undefined {
    if (
      !secureDNS ||
      typeof secureDNS !== "object" ||
      Array.isArray(secureDNS)
    ) {
      return undefined;
    }

    const delegationSigned: unknown = (secureDNS as JSONObject)[
      "delegationSigned"
    ];

    if (delegationSigned === true) {
      return "signedDelegation";
    }

    if (delegationSigned === false) {
      return "unsigned";
    }

    return undefined;
  }

  /*
   * The registrar is the entity carrying the "registrar" role. Registries
   * nest it inconsistently - sometimes at the top level, sometimes inside
   * another entity - so the whole tree is searched.
   */
  private static parseRegistrar(entities: unknown): {
    name?: string;
    url?: string;
  } {
    const entity: JSONObject | null = RdapDomainParser.findEntityWithRole(
      entities,
      "registrar",
      0,
    );

    if (!entity) {
      return {};
    }

    const result: { name?: string; url?: string } = {};

    const name: string | undefined = RdapDomainParser.parseVCardName(
      entity["vcardArray"],
    );

    if (name) {
      result.name = name;
    }

    const url: string | undefined = RdapDomainParser.parseAboutLink(
      entity["links"],
    );

    if (url) {
      result.url = url;
    }

    return result;
  }

  private static findEntityWithRole(
    entities: unknown,
    role: string,
    depth: number,
  ): JSONObject | null {
    // Guards against a registry echoing a cyclic-looking entity tree back.
    if (!Array.isArray(entities) || depth > 4) {
      return null;
    }

    for (const entity of entities) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        continue;
      }

      const roles: Array<string> = RdapDomainParser.asStringArray(
        (entity as JSONObject)["roles"],
      ).map((value: string) => {
        return value.trim().toLowerCase();
      });

      if (roles.includes(role)) {
        return entity as JSONObject;
      }
    }

    for (const entity of entities) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        continue;
      }

      const nested: JSONObject | null = RdapDomainParser.findEntityWithRole(
        (entity as JSONObject)["entities"],
        role,
        depth + 1,
      );

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  /*
   * jCard (RFC 7095): ["vcard", [["version", {}, "text", "4.0"],
   * ["fn", {}, "text", "Example Registrar, Inc."], ...]].
   */
  private static parseVCardName(vcardArray: unknown): string | undefined {
    if (!Array.isArray(vcardArray) || vcardArray.length < 2) {
      return undefined;
    }

    const properties: unknown = vcardArray[1];

    if (!Array.isArray(properties)) {
      return undefined;
    }

    let organization: string | undefined = undefined;

    for (const property of properties) {
      if (!Array.isArray(property) || property.length < 4) {
        continue;
      }

      const name: string | undefined = RdapDomainParser.asString(property[0]);
      const value: string | undefined = RdapDomainParser.asString(property[3]);

      if (!name || !value) {
        continue;
      }

      if (name.toLowerCase() === "fn") {
        return value.trim();
      }

      if (name.toLowerCase() === "org" && !organization) {
        organization = value.trim();
      }
    }

    return organization;
  }

  private static parseAboutLink(links: unknown): string | undefined {
    if (!Array.isArray(links)) {
      return undefined;
    }

    let firstHref: string | undefined = undefined;

    for (const link of links) {
      if (!link || typeof link !== "object" || Array.isArray(link)) {
        continue;
      }

      const rel: string | undefined = RdapDomainParser.asString(
        (link as JSONObject)["rel"],
      );
      const href: string | undefined = RdapDomainParser.asString(
        (link as JSONObject)["href"],
      );

      if (!href) {
        continue;
      }

      if (rel && rel.trim().toLowerCase() === "about") {
        return href.trim();
      }

      if (!firstHref) {
        firstHref = href.trim();
      }
    }

    return firstHref;
  }

  private static asString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed: string = value.trim();

    return trimmed || undefined;
  }

  private static asStringArray(value: unknown): Array<string> {
    if (typeof value === "string") {
      return [value];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item: unknown): item is string => {
      return typeof item === "string";
    });
  }
}
