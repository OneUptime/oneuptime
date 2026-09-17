import {
  DomainRecord,
  DomainRecordUtil,
} from "../../../Utils/Domain/DomainRecord";
import { describe, expect, it } from "@jest/globals";

describe("DomainRecordUtil", () => {
  describe("hasRegistrationData", () => {
    it("rejects an empty record", () => {
      expect(DomainRecordUtil.hasRegistrationData({})).toBe(false);
    });

    it("rejects empty collections", () => {
      expect(
        DomainRecordUtil.hasRegistrationData({
          nameServers: [],
          domainStatus: [],
        }),
      ).toBe(false);
    });

    const singleFieldRecords: Array<[string, DomainRecord]> = [
      ["domainName", { domainName: "example.com" }],
      ["registrar", { registrar: "Example Registrar" }],
      ["createdDate", { createdDate: "2014-09-10T16:00:01.000Z" }],
      ["updatedDate", { updatedDate: "2026-01-01T00:00:00.000Z" }],
      ["expiresDate", { expiresDate: "2030-01-01T00:00:00.000Z" }],
      ["nameServers", { nameServers: ["ns1.example.com"] }],
      ["domainStatus", { domainStatus: ["ok"] }],
    ];

    for (const [fieldName, record] of singleFieldRecords) {
      it(`accepts a record carrying only ${fieldName}`, () => {
        expect(DomainRecordUtil.hasRegistrationData(record)).toBe(true);
      });
    }

    /*
     * DENIC answers an unregistered name with the name echoed back plus
     * "Status: free". Those are fields, but they are the opposite of a
     * registration - accepting them would report a domain that has actually
     * been lost as healthy, which is the same failure mode as issue #3046.
     */
    it("rejects a DENIC-style 'this domain is free' answer", () => {
      expect(
        DomainRecordUtil.hasRegistrationData({
          domainName: "nichtregistriert.de",
          domainStatus: ["free"],
        }),
      ).toBe(false);
    });

    it("rejects other registries' not-registered statuses", () => {
      for (const status of [
        "available",
        "AVAILABLE",
        "notFound",
        "no match",
        "nonexistent",
      ]) {
        expect(
          DomainRecordUtil.hasRegistrationData({
            domainName: "example.test",
            domainStatus: DomainRecordUtil.parseWhoisDomainStatus(status),
          }),
        ).toBe(false);
      }
    });

    it("does not mistake a registered domain's status for availability", () => {
      expect(
        DomainRecordUtil.hasRegistrationData({
          domainName: "example.de",
          domainStatus: ["connect"],
        }),
      ).toBe(true);
    });
  });

  describe("isNotRegisteredStatus", () => {
    it("recognises statuses split into separate tokens", () => {
      expect(
        DomainRecordUtil.isNotRegisteredStatus(["No", "Object", "Found"]),
      ).toBe(true);
    });

    it("is false for a missing or ordinary status", () => {
      expect(DomainRecordUtil.isNotRegisteredStatus(undefined)).toBe(false);
      expect(DomainRecordUtil.isNotRegisteredStatus([])).toBe(false);
      expect(
        DomainRecordUtil.isNotRegisteredStatus(["clientTransferProhibited"]),
      ).toBe(false);
    });
  });

  describe("normalizeDate", () => {
    it("normalizes RFC 3339 to ISO 8601", () => {
      expect(DomainRecordUtil.normalizeDate("2026-09-10T16:00:01.587Z")).toBe(
        "2026-09-10T16:00:01.587Z",
      );
    });

    it("normalizes a WHOIS timestamp without milliseconds", () => {
      expect(DomainRecordUtil.normalizeDate("2031-11-10T20:55:40Z")).toBe(
        "2031-11-10T20:55:40.000Z",
      );
    });

    it("accepts a Date instance", () => {
      expect(
        DomainRecordUtil.normalizeDate(new Date("2030-01-02T03:04:05Z")),
      ).toBe("2030-01-02T03:04:05.000Z");
    });

    it("returns undefined for an invalid Date instance", () => {
      expect(DomainRecordUtil.normalizeDate(new Date("nope"))).toBeUndefined();
    });

    /*
     * Dropping beats passing through: the expiry criteria call
     * `new Date(...)` on this, and an Invalid Date makes every comparison
     * false - "expires in under 30 days" would never fire and "is expired"
     * would answer "no" forever on a domain that had already lapsed.
     */
    it("drops an unparseable value rather than handing it to the criteria", () => {
      expect(
        DomainRecordUtil.normalizeDate("REDACTED FOR PRIVACY"),
      ).toBeUndefined();
    });

    it("parses registro.br's compact YYYYMMDD form", () => {
      expect(DomainRecordUtil.normalizeDate("20260313")).toBe(
        "2026-03-13T00:00:00.000Z",
      );
    });

    it("strips registro.br's trailing record id", () => {
      expect(DomainRecordUtil.normalizeDate("19960424 #7137")).toBe(
        "1996-04-24T00:00:00.000Z",
      );
    });

    it("parses day-first dates with a four digit year", () => {
      expect(DomainRecordUtil.normalizeDate("16-11-2035")).toBe(
        "2035-11-16T00:00:00.000Z",
      );
      expect(DomainRecordUtil.normalizeDate("31.8.2027 00:00:00")).toBe(
        "2027-08-31T00:00:00.000Z",
      );
    });

    it("rejects an impossible day rather than rolling it over", () => {
      expect(DomainRecordUtil.normalizeDate("20260231")).toBeUndefined();
      expect(DomainRecordUtil.normalizeDate("31-02-2026")).toBeUndefined();
    });

    it("returns undefined for empty or non-string input", () => {
      expect(DomainRecordUtil.normalizeDate("")).toBeUndefined();
      expect(DomainRecordUtil.normalizeDate("   ")).toBeUndefined();
      expect(DomainRecordUtil.normalizeDate(undefined)).toBeUndefined();
      expect(DomainRecordUtil.normalizeDate(null)).toBeUndefined();
      expect(DomainRecordUtil.normalizeDate(12345)).toBeUndefined();
    });
  });

  describe("normalizeNameServers", () => {
    it("lowercases, trims and de-duplicates", () => {
      expect(
        DomainRecordUtil.normalizeNameServers([
          " NS1.Example.COM ",
          "ns1.example.com",
          "NS2.EXAMPLE.COM.",
        ]),
      ).toEqual(["ns1.example.com", "ns2.example.com"]);
    });

    it("drops glue addresses", () => {
      expect(
        DomainRecordUtil.normalizeNameServers([
          "ns1.example.com",
          "192.0.2.1",
          "2a01:8840:16::36",
        ]),
      ).toEqual(["ns1.example.com"]);
    });

    it("ignores empty entries", () => {
      expect(
        DomainRecordUtil.normalizeNameServers(["", undefined, "  "]),
      ).toEqual([]);
    });
  });

  describe("normalizeDomainStatus", () => {
    it("folds an RDAP spelled-out status to its EPP name", () => {
      expect(
        DomainRecordUtil.normalizeDomainStatus("client transfer prohibited"),
      ).toBe("clientTransferProhibited");
    });

    it("leaves an EPP name untouched", () => {
      expect(
        DomainRecordUtil.normalizeDomainStatus("clientTransferProhibited"),
      ).toBe("clientTransferProhibited");
    });

    it("strips a trailing EPP status URL", () => {
      expect(
        DomainRecordUtil.normalizeDomainStatus(
          "clientTransferProhibited https://icann.org/epp#clientTransferProhibited",
        ),
      ).toBe("clientTransferProhibited");
    });

    it("returns an empty string when nothing is left", () => {
      expect(
        DomainRecordUtil.normalizeDomainStatus("https://icann.org/epp#ok"),
      ).toBe("");
      expect(DomainRecordUtil.normalizeDomainStatus("   ")).toBe("");
    });
  });

  describe("parseWhoisDomainStatus", () => {
    /*
     * whois-json joins every repeated "Domain Status:" line with a space, so
     * a normal gTLD answer arrives as one long string. Before this was
     * handled the whole blob became a single bogus status value.
     */
    it("splits the space-joined blob whois-json produces", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus(
          "clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited clientTransferProhibited https://icann.org/epp#clientTransferProhibited",
        ),
      ).toEqual(["clientDeleteProhibited", "clientTransferProhibited"]);
    });

    it("keeps a lowercase spelled-out status as one phrase", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus("client transfer prohibited"),
      ).toEqual(["clientTransferProhibited"]);
    });

    it("handles single-word ccTLD statuses", () => {
      expect(DomainRecordUtil.parseWhoisDomainStatus("connect")).toEqual([
        "connect",
      ]);
      expect(DomainRecordUtil.parseWhoisDomainStatus("ok")).toEqual(["ok"]);
    });

    it("splits on newlines, commas and semicolons", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus("ok\nserverHold, clientHold"),
      ).toEqual(["ok", "serverHold", "clientHold"]);
    });

    it("de-duplicates", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus(
          "clientHold clientHold clientHold",
        ),
      ).toEqual(["clientHold"]);
    });

    it("accepts an array", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus([
          "client transfer prohibited",
          "client delete prohibited",
        ]),
      ).toEqual(["clientTransferProhibited", "clientDeleteProhibited"]);
    });

    it("returns an empty array for missing input", () => {
      expect(DomainRecordUtil.parseWhoisDomainStatus(undefined)).toEqual([]);
      expect(DomainRecordUtil.parseWhoisDomainStatus("")).toEqual([]);
    });

    /*
     * whois-json joins repeated status lines with a space, so a segment can
     * hold several spelled-out statuses. Splitting on whitespace would
     * shred them and treating the segment as one phrase would fuse them -
     * hence the phrase table. CZ.NIC emits exactly this pair.
     */
    it("separates two spelled-out statuses joined into one segment", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus(
          "paid and in zone server delete prohibited",
        ),
      ).toEqual(["paidAndInZone", "serverDeleteProhibited"]);
    });

    it("does not fuse two single-word statuses", () => {
      expect(DomainRecordUtil.parseWhoisDomainStatus("ok active")).toEqual([
        "ok",
        "active",
      ]);
    });

    it("treats a parenthesised status as its own value", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus("ok (paid and in zone)"),
      ).toEqual(["ok", "paidAndInZone"]);
    });

    it("folds a mixed-case spelled-out status", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus(
          "Sponsoring registrar change forbidden",
        ),
      ).toEqual(["sponsoringRegistrarChangeForbidden"]);
    });

    it("still splits the gTLD blob at its EPP status URLs", () => {
      expect(
        DomainRecordUtil.parseWhoisDomainStatus(
          "clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited clientTransferProhibited https://icann.org/epp#clientTransferProhibited",
        ),
      ).toEqual(["clientDeleteProhibited", "clientTransferProhibited"]);
    });
  });

  describe("parseWhoisNameServers", () => {
    it("splits the space-joined blob whois-json produces", () => {
      expect(
        DomainRecordUtil.parseWhoisNameServers(
          "NS1.EXAMPLE.COM NS2.EXAMPLE.COM",
        ),
      ).toEqual(["ns1.example.com", "ns2.example.com"]);
    });

    it("drops inline glue addresses", () => {
      expect(
        DomainRecordUtil.parseWhoisNameServers("ns1.example.com 192.0.2.1"),
      ).toEqual(["ns1.example.com"]);
    });

    it("splits on commas", () => {
      expect(
        DomainRecordUtil.parseWhoisNameServers(
          "ns1.example.com,ns2.example.com",
        ),
      ).toEqual(["ns1.example.com", "ns2.example.com"]);
    });

    it("accepts an array and de-duplicates", () => {
      expect(
        DomainRecordUtil.parseWhoisNameServers([
          "NS1.EXAMPLE.COM.",
          "ns1.example.com",
        ]),
      ).toEqual(["ns1.example.com"]);
    });

    it("returns an empty array for missing input", () => {
      expect(DomainRecordUtil.parseWhoisNameServers(undefined)).toEqual([]);
    });
  });
});
