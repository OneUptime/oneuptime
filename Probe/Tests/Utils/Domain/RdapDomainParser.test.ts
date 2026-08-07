import { JSONObject } from "Common/Types/JSON";
import { DomainRecord } from "../../../Utils/Domain/DomainRecord";
import RdapDomainParser from "../../../Utils/Domain/RdapDomainParser";
import { describe, expect, it } from "@jest/globals";

/*
 * Captured from https://rdap.identitydigital.services/rdap/domain/identity.digital
 * - the exact TLD from issue #3046, whose WHOIS server answers
 * "TLD is not supported." and whose RDAP service answers properly.
 */
const IDENTITY_DIGITAL_RESPONSE: JSONObject = {
  rdapConformance: ["rdap_level_0"],
  objectClassName: "domain",
  handle: "DOMAIN-ID",
  ldhName: "identity.digital",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "transfer", eventDate: "2022-05-12T08:30:49.664Z" },
    { eventAction: "expiration", eventDate: "2026-09-10T16:00:01.587Z" },
    { eventAction: "registration", eventDate: "2014-09-10T16:00:01.587Z" },
    { eventAction: "last changed", eventDate: "2026-07-23T00:05:29.72Z" },
    {
      eventAction: "last update of RDAP database",
      eventDate: "2026-08-07T07:42:57.036Z",
    },
  ],
  secureDNS: { delegationSigned: false, maxSigLife: 1 },
  nameservers: [
    { objectClassName: "nameserver", ldhName: "ns-525.awsdns-01.net" },
    { objectClassName: "nameserver", ldhName: "ns-1272.awsdns-31.org" },
    { objectClassName: "nameserver", ldhName: "ns-1583.awsdns-05.co.uk" },
    { objectClassName: "nameserver", ldhName: "ns-341.awsdns-42.com" },
  ],
  entities: [
    {
      objectClassName: "entity",
      handle: "625",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Name.com, Inc."],
        ],
      ],
      links: [
        {
          rel: "self",
          href: "https://rdap.identitydigital.services/rdap/entity/625",
        },
        { rel: "about", href: "https://namerdap.systems/" },
      ],
    },
  ],
};

// Captured from Verisign's RDAP service, which returns the name in uppercase.
const VERISIGN_RESPONSE: JSONObject = {
  objectClassName: "domain",
  ldhName: "ONEUPTIME.COM",
  status: ["client transfer prohibited", "server delete prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2021-11-10T20:55:40Z" },
    { eventAction: "expiration", eventDate: "2031-11-10T20:55:40Z" },
    { eventAction: "last changed", eventDate: "2022-03-28T07:35:06Z" },
  ],
  secureDNS: {
    delegationSigned: true,
    dsData: [{ keyTag: 2371, algorithm: 13, digestType: 2, digest: "9203BC" }],
  },
  nameservers: [
    { ldhName: "ALLA.NS.CLOUDFLARE.COM" },
    { ldhName: "BILL.NS.CLOUDFLARE.COM" },
  ],
  entities: [
    {
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Cloudflare, Inc."],
        ],
      ],
      links: [{ rel: "about", href: "http://www.cloudflare.com" }],
    },
  ],
};

describe("RdapDomainParser", () => {
  describe("a real Identity Digital (.digital) response", () => {
    const record: DomainRecord = RdapDomainParser.parse(
      IDENTITY_DIGITAL_RESPONSE,
    );

    it("reads the domain name", () => {
      expect(record.domainName).toBe("identity.digital");
    });

    it("reads the expiration event as the expiry date", () => {
      expect(record.expiresDate).toBe("2026-09-10T16:00:01.587Z");
    });

    it("reads the registration event as the created date", () => {
      expect(record.createdDate).toBe("2014-09-10T16:00:01.587Z");
    });

    it("reads 'last changed' as the updated date, not the RDAP database timestamp", () => {
      expect(record.updatedDate).toBe("2026-07-23T00:05:29.720Z");
    });

    it("folds the spelled-out RDAP status to its EPP name", () => {
      expect(record.domainStatus).toEqual(["clientTransferProhibited"]);
    });

    it("lowercases the name servers", () => {
      expect(record.nameServers).toEqual([
        "ns-525.awsdns-01.net",
        "ns-1272.awsdns-31.org",
        "ns-1583.awsdns-05.co.uk",
        "ns-341.awsdns-42.com",
      ]);
    });

    it("reports an unsigned delegation using WHOIS vocabulary", () => {
      expect(record.dnssec).toBe("unsigned");
    });

    it("reads the registrar name from the entity's jCard", () => {
      expect(record.registrar).toBe("Name.com, Inc.");
    });

    it("reads the registrar URL from the 'about' link, not 'self'", () => {
      expect(record.registrarUrl).toBe("https://namerdap.systems/");
    });
  });

  describe("a real Verisign (.com) response", () => {
    const record: DomainRecord = RdapDomainParser.parse(VERISIGN_RESPONSE);

    it("lowercases an uppercase ldhName", () => {
      expect(record.domainName).toBe("oneuptime.com");
    });

    it("reports a signed delegation using WHOIS vocabulary", () => {
      expect(record.dnssec).toBe("signedDelegation");
    });

    it("folds every status", () => {
      expect(record.domainStatus).toEqual([
        "clientTransferProhibited",
        "serverDeleteProhibited",
      ]);
    });

    it("normalizes dates without milliseconds", () => {
      expect(record.expiresDate).toBe("2031-11-10T20:55:40.000Z");
    });
  });

  describe("registrar extraction", () => {
    it("finds a registrar nested inside another entity", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        entities: [
          {
            roles: ["registrant"],
            entities: [
              {
                roles: ["registrar"],
                vcardArray: [
                  "vcard",
                  [["fn", {}, "text", "Nested Registrar Ltd"]],
                ],
              },
            ],
          },
        ],
      });

      expect(record.registrar).toBe("Nested Registrar Ltd");
    });

    it("falls back to the org property when there is no fn", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        entities: [
          {
            roles: ["Registrar"],
            vcardArray: ["vcard", [["org", {}, "text", "Org Only Registrar"]]],
          },
        ],
      });

      expect(record.registrar).toBe("Org Only Registrar");
    });

    it("falls back to the first link when none is rel=about", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        entities: [
          {
            roles: ["registrar"],
            links: [{ rel: "self", href: "https://registry.example/entity/1" }],
          },
        ],
      });

      expect(record.registrarUrl).toBe("https://registry.example/entity/1");
    });

    it("ignores entities that carry no registrar role", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        entities: [
          {
            roles: ["technical"],
            vcardArray: ["vcard", [["fn", {}, "text", "Tech Contact"]]],
          },
        ],
      });

      expect(record.registrar).toBeUndefined();
    });
  });

  describe("tolerance for shapes registries actually send", () => {
    it("accepts a status given as a bare string", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        status: "active",
      });

      expect(record.domainStatus).toEqual(["active"]);
    });

    it("accepts name servers given as bare strings", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        nameservers: ["NS1.EXAMPLE.COM"],
      });

      expect(record.nameServers).toEqual(["ns1.example.com"]);
    });

    it("falls back to unicodeName when there is no ldhName", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        unicodeName: "münchen.de",
      });

      expect(record.domainName).toBe("münchen.de");
    });

    it("skips events with a missing action or an unusable date", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        events: [
          { eventDate: "2030-01-01T00:00:00Z" },
          { eventAction: "expiration" },
          { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
          "not-an-event",
        ],
      });

      expect(record.expiresDate).toBeUndefined();
      expect(record.createdDate).toBe("2020-01-01T00:00:00.000Z");
    });

    it("keeps the first occurrence when an action repeats", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        events: [
          { eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" },
          { eventAction: "expiration", eventDate: "2040-01-01T00:00:00Z" },
        ],
      });

      expect(record.expiresDate).toBe("2030-01-01T00:00:00.000Z");
    });

    it("omits secureDNS when delegationSigned is absent", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: "example.com",
        secureDNS: { maxSigLife: 1 },
      });

      expect(record.dnssec).toBeUndefined();
    });
  });

  describe("degenerate input", () => {
    it("returns an empty record for null", () => {
      expect(RdapDomainParser.parse(null)).toEqual({});
    });

    it("returns an empty record for an empty object", () => {
      expect(RdapDomainParser.parse({})).toEqual({});
    });

    it("does not throw on wrongly typed members", () => {
      const record: DomainRecord = RdapDomainParser.parse({
        ldhName: 42,
        status: 7,
        events: "nope",
        nameservers: { not: "an array" },
        entities: "nope",
        secureDNS: "nope",
      } as unknown as JSONObject);

      expect(record).toEqual({});
    });
  });
});
