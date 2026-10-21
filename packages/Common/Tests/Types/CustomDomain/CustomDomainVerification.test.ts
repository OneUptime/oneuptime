import CustomDomainVerification, {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../Types/CustomDomain/CustomDomainVerification";
import { describe, expect, test } from "@jest/globals";

/*
 * What a custom domain's verify-cname route - a status page's or a
 * dashboard's - answers once it has found the record, and how the Dashboard
 * reads that answer back. Both ends share this, so the dialog after Check
 * now can never misread the server.
 */

describe("CustomDomainVerification", () => {
  test("every status survives the trip through JSON", () => {
    for (const status of Object.values(CustomDomainCertificateStatus)) {
      const result: CustomDomainVerificationResult = {
        certificateStatus: status,
      };

      expect(
        CustomDomainVerification.fromJSON(
          CustomDomainVerification.toJSON(result),
        ),
      ).toEqual(result);
    }
  });

  test("a failed order carries its reason, and only a failed order does", () => {
    expect(
      CustomDomainVerification.fromJSON(
        CustomDomainVerification.toJSON({
          certificateStatus: CustomDomainCertificateStatus.Failed,
          certificateError: "CAA record forbids letsencrypt.org",
        }),
      ),
    ).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "CAA record forbids letsencrypt.org",
    });

    expect(
      CustomDomainVerification.fromJSON({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
        certificateError: "stray",
      }),
    ).toEqual({ certificateStatus: CustomDomainCertificateStatus.Issuing });
  });

  test("toJSON leaves an absent reason out", () => {
    expect(
      CustomDomainVerification.toJSON({
        certificateStatus: CustomDomainCertificateStatus.Issued,
      }),
    ).toEqual({ certificateStatus: "Issued" });
  });

  /*
   * An older server answered verify-cname with an empty body; the
   * certificate of a domain verified then was issued all the same, by the
   * sweeps.
   */
  test("an empty or unknown answer reads as Issuing", () => {
    for (const json of [
      undefined,
      null,
      {},
      { certificateStatus: "SomethingNew" },
      { certificateStatus: 42 },
    ]) {
      expect(CustomDomainVerification.fromJSON(json as never)).toEqual({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
      });
    }
  });

  test("a blank reason is dropped", () => {
    expect(
      CustomDomainVerification.fromJSON({
        certificateStatus: CustomDomainCertificateStatus.Failed,
        certificateError: "   ",
      }),
    ).toEqual({ certificateStatus: CustomDomainCertificateStatus.Failed });
  });

  test("Check now waits a short while for the order, well inside a proxy's timeout", () => {
    expect(CustomDomainVerification.ORDER_WAIT_IN_MS).toBeGreaterThanOrEqual(
      5000,
    );
    expect(CustomDomainVerification.ORDER_WAIT_IN_MS).toBeLessThanOrEqual(
      30000,
    );
  });
});
