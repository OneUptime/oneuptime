import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "../../../Types/StatusPage/CustomDomainCertificates";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * What the certificates route answers for a status page's custom domains -
 * each one's certificate expiry and last failed order - and how the Custom
 * Domains page reads it back for its Status column. Both ends share this.
 */

const EXPIRES_AT: Date = new Date("2026-12-30T00:00:00.000Z");
const FAILED_AT: Date = new Date("2026-10-03T11:00:00.000Z");

describe("CustomDomainCertificates", () => {
  test("survives the trip through JSON, by domain id", () => {
    const certificates: Array<CustomDomainCertificate> = [
      { domainId: "a", expiresAt: EXPIRES_AT },
      {
        domainId: "b",
        lastOrderError: "Unable to order certificate for b.acme.com.",
        lastOrderFailedAt: FAILED_AT,
      },
      { domainId: "c" },
      {
        domainId: "d",
        expiresAt: EXPIRES_AT,
        lastOrderError: "Renewal failed.",
        lastOrderFailedAt: FAILED_AT,
      },
    ];

    const read: Map<string, CustomDomainCertificate> =
      CustomDomainCertificates.fromJSON(
        JSON.parse(
          JSON.stringify(CustomDomainCertificates.toJSON(certificates)),
        ) as JSONObject,
      );

    expect([...read.keys()]).toEqual(["a", "b", "c", "d"]);

    for (const certificate of certificates) {
      expect(read.get(certificate.domainId)).toEqual(certificate);
    }
  });

  test("leaves out what a domain does not have", () => {
    expect(CustomDomainCertificates.toJSON([{ domainId: "c" }])).toEqual({
      domains: [{ domainId: "c" }],
    });
  });

  test("an answer it cannot read is no certificates at all, never a guess", () => {
    for (const json of [
      null,
      undefined,
      {},
      { domains: "nope" },
      { domains: [null, 42, "x", [], { expiresAt: "2026-12-30" }] },
    ]) {
      expect(
        CustomDomainCertificates.fromJSON(json as JSONObject).size,
      ).toBe(0);
    }
  });

  test("a date it cannot read, or an empty error, is left out", () => {
    const read: Map<string, CustomDomainCertificate> =
      CustomDomainCertificates.fromJSON({
        domains: [
          {
            domainId: "a",
            expiresAt: "not a date",
            lastOrderError: "  ",
            lastOrderFailedAt: "2026-10-03T11:00:00.000Z",
          },
          {
            domainId: "b",
            lastOrderError: " Unable. ",
            lastOrderFailedAt: "never",
          },
        ],
      });

    expect(read.get("a")).toEqual({ domainId: "a" });
    expect(read.get("b")).toEqual({ domainId: "b", lastOrderError: "Unable." });
  });

  test("reads a date the client's JSON reader already made a Date", () => {
    const read: Map<string, CustomDomainCertificate> =
      CustomDomainCertificates.fromJSON({
        domains: [
          { domainId: "a", expiresAt: EXPIRES_AT as unknown as string },
          {
            domainId: "b",
            expiresAt: new Date("nope") as unknown as string,
          },
        ],
      });

    expect(read.get("a")?.expiresAt).toEqual(EXPIRES_AT);
    expect(read.get("b")).toEqual({ domainId: "b" });
  });
});
