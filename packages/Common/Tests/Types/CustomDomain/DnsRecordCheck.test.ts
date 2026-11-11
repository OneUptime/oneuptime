import DnsRecordCheckJSON, {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
  isDnsRecordFound,
  normalizeDnsName,
} from "../../../Types/CustomDomain/DnsRecordCheck";
import {
  DNS_RECORD_STATUS,
  DnsRecordCheckDescription,
  DnsRecordCheckWords,
  describeDnsRecordCheck,
  describeDnsRecordCheckInEnglish,
} from "../../../Types/CustomDomain/DnsRecordCheckWords";
import CustomDomainDnsCheckResultJSON, {
  CustomDomainDnsCheckResult,
} from "../../../Types/CustomDomain/CustomDomainDnsCheckResult";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * What one DNS record check looked up and what came back (DnsRecordCheck),
 * and the words it is said in (DnsRecordCheckWords). #1664 asked "I don't
 * understand how OneUptime reads CNAME records": the answer is to show it,
 * so every outcome must name the record, the name looked up, what was
 * expected and what was found, and what to change.
 */

const checkedAt: Date = new Date("2026-11-11T10:00:00.000Z");

function cname(extra: Partial<DnsRecordCheck>): DnsRecordCheck {
  return {
    type: DnsRecordType.CNAME,
    name: "status.example.com",
    expectedValue: "statuspage.oneuptime.com",
    foundValues: [],
    outcome: DnsRecordCheckOutcome.NotFound,
    checkedAt: checkedAt,
    ...extra,
  };
}

function txt(extra: Partial<DnsRecordCheck>): DnsRecordCheck {
  return {
    type: DnsRecordType.TXT,
    name: "example.com",
    expectedValue: "oneuptime-verification-abc",
    foundValues: [],
    outcome: DnsRecordCheckOutcome.NotFound,
    checkedAt: checkedAt,
    ...extra,
  };
}

describe("normalizeDnsName", () => {
  test("ignores case, spaces and the root's trailing dot", () => {
    expect(normalizeDnsName(" StatusPage.OneUptime.com. ")).toBe(
      "statuspage.oneuptime.com",
    );
    expect(normalizeDnsName("a.example.com..")).toBe("a.example.com");
    expect(normalizeDnsName(undefined)).toBe("");
    expect(normalizeDnsName(null)).toBe("");
  });
});

describe("DnsRecordCheck JSON", () => {
  test("every field survives the trip, for every outcome and type", () => {
    for (const outcome of Object.values(DnsRecordCheckOutcome)) {
      for (const type of Object.values(DnsRecordType)) {
        const check: DnsRecordCheck = {
          type,
          name: "status.example.com",
          expectedValue: "target.example.net",
          foundValues: ["alias.example.com", "target.example.net"],
          outcome,
          addresses: ["203.0.113.10"],
          reachedOneUptime: false,
          httpStatus: 404,
          lookupError: "ETIMEOUT",
          checkedAt,
        };

        expect(
          DnsRecordCheckJSON.fromJSON(DnsRecordCheckJSON.toJSON(check)),
        ).toEqual(check);
      }
    }
  });

  test("leaves out what was not there", () => {
    const json: Record<string, unknown> = DnsRecordCheckJSON.toJSON(
      cname({ checkedAt: undefined }),
    );

    expect(Object.keys(json).sort()).toEqual(
      ["expectedValue", "foundValues", "name", "outcome", "type"].sort(),
    );
  });

  test("reads a date the client's JSON reader already made", () => {
    expect(
      DnsRecordCheckJSON.fromJSON({
        ...DnsRecordCheckJSON.toJSON(cname({})),
        checkedAt: checkedAt,
      })?.checkedAt,
    ).toEqual(checkedAt);
  });

  test("anything that is not a check reads as nothing, not a guess", () => {
    for (const junk of [
      null,
      undefined,
      "Found",
      42,
      [],
      {},
      { type: "MX", name: "a.example.com", outcome: "Found" },
      { type: "CNAME", name: "a.example.com", outcome: "Maybe" },
      { type: "CNAME", name: "", outcome: "Found" },
    ]) {
      expect(DnsRecordCheckJSON.fromJSON(junk)).toBeUndefined();
    }
  });

  test("a list keeps its checks and leaves out the rest", () => {
    const checks: Array<DnsRecordCheck> = DnsRecordCheckJSON.fromJSONArray([
      DnsRecordCheckJSON.toJSON(txt({})),
      { type: "nope" },
      DnsRecordCheckJSON.toJSON(cname({})),
    ]);

    expect(
      checks.map((check: DnsRecordCheck) => {
        return check.type;
      }),
    ).toEqual([DnsRecordType.TXT, DnsRecordType.CNAME]);
    expect(DnsRecordCheckJSON.fromJSONArray("nope")).toEqual([]);
  });

  test("found means found, nothing else", () => {
    for (const outcome of Object.values(DnsRecordCheckOutcome)) {
      expect(isDnsRecordFound(cname({ outcome }))).toBe(
        outcome === DnsRecordCheckOutcome.Found,
      );
    }
  });
});

describe("CustomDomainDnsCheckResult JSON", () => {
  test("a verified answer carries its records and the certificate's next step", () => {
    const result: CustomDomainDnsCheckResult = {
      isVerified: true,
      records: [cname({ outcome: DnsRecordCheckOutcome.Found })],
      certificate: {
        certificateStatus: CustomDomainCertificateStatus.Failed,
        certificateError: "CAA record forbids letsencrypt.org",
      },
    };

    expect(
      CustomDomainDnsCheckResultJSON.fromJSON(
        CustomDomainDnsCheckResultJSON.toJSON(result),
      ),
    ).toEqual(result);
  });

  test("not verified unless the server said so, and then no certificate", () => {
    expect(
      CustomDomainDnsCheckResultJSON.fromJSON({
        isVerified: "true",
        records: [],
        certificate: { certificateStatus: "Issued" },
      }),
    ).toEqual({ isVerified: false, records: [] });

    // An older server's empty answer, or a proxy's page.
    expect(CustomDomainDnsCheckResultJSON.fromJSON(undefined)).toEqual({
      isVerified: false,
      records: [],
    });
  });

  test("all found only when there is something, and all of it is found", () => {
    expect(CustomDomainDnsCheckResultJSON.allFound([])).toBe(false);
    expect(
      CustomDomainDnsCheckResultJSON.allFound([
        txt({ outcome: DnsRecordCheckOutcome.Found }),
        cname({ outcome: DnsRecordCheckOutcome.NotFound }),
      ]),
    ).toBe(false);
    expect(
      CustomDomainDnsCheckResultJSON.allFound([
        txt({ outcome: DnsRecordCheckOutcome.Found }),
        cname({ outcome: DnsRecordCheckOutcome.Found }),
      ]),
    ).toBe(true);
  });
});

describe("DnsRecordCheckWords: what was looked up, and what came back", () => {
  test("a CNAME not found says what was looked up, that nothing came back, and the whole record to add", () => {
    const english: string = describeDnsRecordCheckInEnglish(cname({}));

    expect(english).toContain(
      "We looked up the CNAME record of status.example.com and got nothing.",
    );
    expect(english).toContain(
      "Add a CNAME record with the name status.example.com and the value statuspage.oneuptime.com",
    );
  });

  test("a CNAME pointing elsewhere names what it got and what was expected (#1664)", () => {
    const english: string = describeDnsRecordCheckInEnglish(
      cname({
        outcome: DnsRecordCheckOutcome.WrongValue,
        foundValues: ["other.example.net"],
      }),
    );

    expect(english).toContain(
      "got other.example.net, but expected statuspage.oneuptime.com.",
    );
    expect(english).toContain(
      "Change the record's value to statuspage.oneuptime.com.",
    );
  });

  test("a chain is shown hop by hop", () => {
    expect(
      describeDnsRecordCheckInEnglish(
        cname({
          outcome: DnsRecordCheckOutcome.Found,
          foundValues: ["alias.example.com", "statuspage.oneuptime.com"],
        }),
      ),
    ).toBe(
      "We looked up the CNAME record of status.example.com and found alias.example.com → statuspage.oneuptime.com.",
    );
  });

  test("a CNAME hidden behind an address says the name is proxied or has an A record (#1664)", () => {
    const english: string = describeDnsRecordCheckInEnglish(
      cname({ addresses: ["104.21.3.4", "172.67.1.2"] }),
    );

    expect(english).toContain(
      "got nothing, but the name answers with the address 104.21.3.4, 172.67.1.2.",
    );
    expect(english).toContain("Cloudflare's orange cloud");
    expect(english).toContain("DNS only");
  });

  test("a name that does not exist, and a lookup with no answer, each say so", () => {
    expect(
      describeDnsRecordCheckInEnglish(
        cname({ outcome: DnsRecordCheckOutcome.NameNotFound }),
      ),
    ).toContain("We looked up status.example.com, and it does not exist");

    expect(
      describeDnsRecordCheckInEnglish(
        cname({
          outcome: DnsRecordCheckOutcome.LookupFailed,
          lookupError: "ETIMEOUT",
        }),
      ),
    ).toBe(
      "We could not look up the CNAME record of status.example.com: the DNS server did not answer. Try again in a few minutes.",
    );
  });

  test("a CNAME that is right but does not reach OneUptime warns, with the status it got (#1521)", () => {
    const withStatus: DnsRecordCheckDescription = describeDnsRecordCheck(
      cname({
        outcome: DnsRecordCheckOutcome.Found,
        foundValues: ["statuspage.oneuptime.com"],
        reachedOneUptime: false,
        httpStatus: 404,
      }),
    );

    expect(withStatus.warning?.template).toBe(
      DnsRecordCheckWords.notReachedWithStatus,
    );
    expect(withStatus.warning?.values["status"]).toBe("404");

    const noAnswer: DnsRecordCheckDescription = describeDnsRecordCheck(
      cname({
        outcome: DnsRecordCheckOutcome.Found,
        foundValues: ["statuspage.oneuptime.com"],
        reachedOneUptime: false,
      }),
    );

    expect(noAnswer.warning?.template).toBe(
      DnsRecordCheckWords.notReachedNoAnswer,
    );

    // A request that reached OneUptime warns of nothing.
    expect(
      describeDnsRecordCheck(
        cname({
          outcome: DnsRecordCheckOutcome.Found,
          foundValues: ["statuspage.oneuptime.com"],
          reachedOneUptime: true,
        }),
      ).warning,
    ).toBeUndefined();
  });

  test("a name that reaches OneUptime with its CNAME hidden is found, and says so", () => {
    expect(
      describeDnsRecordCheckInEnglish(
        cname({
          outcome: DnsRecordCheckOutcome.Found,
          reachedOneUptime: true,
        }),
      ),
    ).toBe("Requests to status.example.com reach OneUptime.");
  });

  test("TXT: found, nothing, others but not ours", () => {
    expect(
      describeDnsRecordCheckInEnglish(
        txt({
          outcome: DnsRecordCheckOutcome.Found,
          foundValues: ["oneuptime-verification-abc"],
        }),
      ),
    ).toBe(
      "We looked up the TXT records of example.com and found oneuptime-verification-abc.",
    );

    expect(describeDnsRecordCheckInEnglish(txt({}))).toContain(
      "Add a TXT record with the name example.com and the value oneuptime-verification-abc",
    );

    const others: string = describeDnsRecordCheckInEnglish(
      txt({
        outcome: DnsRecordCheckOutcome.WrongValue,
        foundValues: ["v=spf1 -all", "google-site-verification=x"],
      }),
    );

    expect(others).toContain(
      'got "v=spf1 -all", "google-site-verification=x", but none of them is oneuptime-verification-abc.',
    );
    expect(others).toContain("The TXT records already there can stay.");

    expect(
      describeDnsRecordCheckInEnglish(
        txt({ outcome: DnsRecordCheckOutcome.NameNotFound }),
      ),
    ).toContain("Check that example.com is your domain");
  });

  test("a CNAME waiting for its TXT says it is checked later", () => {
    expect(
      describeDnsRecordCheckInEnglish(
        cname({ outcome: DnsRecordCheckOutcome.NotCheckedYet }),
      ),
    ).toBe("Not checked yet: we check it once the TXT record is found.");
  });

  test("every outcome has a status beside its record", () => {
    for (const outcome of Object.values(DnsRecordCheckOutcome)) {
      expect(DNS_RECORD_STATUS[outcome]).toBeTruthy();
    }
  });

  test("no sentence leaves a placeholder unfilled, for any outcome and type", () => {
    for (const outcome of Object.values(DnsRecordCheckOutcome)) {
      for (const make of [cname, txt]) {
        for (const extra of [
          {},
          { foundValues: ["x.example.net"] },
          { addresses: ["203.0.113.1"] },
          { reachedOneUptime: false, httpStatus: 502 },
          { reachedOneUptime: false },
        ]) {
          const english: string = describeDnsRecordCheckInEnglish(
            make({ outcome, ...extra }),
          );

          expect([outcome, english]).toEqual([
            outcome,
            expect.not.stringContaining("{{"),
          ]);
        }
      }
    }
  });

  test("every template's placeholders are ones the description fills", () => {
    const filled: Array<string> = [
      "name",
      "expectedValue",
      "found",
      "type",
      "addresses",
      "status",
    ];

    for (const template of Object.values(DnsRecordCheckWords)) {
      for (const placeholder of getTemplatePlaceholders(template)) {
        expect([template, filled.includes(placeholder)]).toEqual([
          template,
          true,
        ]);
      }
    }
  });
});
