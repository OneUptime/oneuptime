import { JSONObject } from "../JSON";

/*
 * What a custom domain's verify-cname route - a status page's or a
 * dashboard's: the domain's Check now - answers once it has found the
 * domain's CNAME record: what happens to the domain's certificate next. The
 * record being found is the success; an order that fails is not an error of
 * the route, it is reported here and the sweeps order again.
 */
export enum CustomDomainCertificateStatus {
  // The free certificate is being ordered, or was ordered just now.
  Issuing = "Issuing",
  // The domain has its free certificate already.
  Issued = "Issued",
  // The domain is served with a certificate its owner uploaded.
  Uploaded = "Uploaded",
  // The order failed; certificateError says why.
  Failed = "Failed",
}

export interface CustomDomainVerificationResult {
  certificateStatus: CustomDomainCertificateStatus;
  certificateError?: string | undefined;
}

export default class CustomDomainVerification {
  /*
   * How long verify-cname waits for the certificate order before it answers.
   * An order usually takes a few seconds; one that takes longer carries on
   * after the answer.
   */
  public static readonly ORDER_WAIT_IN_MS: number = 25000;

  public static toJSON(result: CustomDomainVerificationResult): JSONObject {
    const json: JSONObject = {
      certificateStatus: result.certificateStatus,
    };

    if (result.certificateError) {
      json["certificateError"] = result.certificateError;
    }

    return json;
  }

  /*
   * Reads the route's answer. One without a status the reader knows - an
   * older server answered with an empty body - reads as Issuing, which is
   * what the domain's certificate then does.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): CustomDomainVerificationResult {
    const status: unknown = json?.["certificateStatus"];

    const certificateStatus: CustomDomainCertificateStatus = (
      Object.values(CustomDomainCertificateStatus) as Array<string>
    ).includes(status as string)
      ? (status as CustomDomainCertificateStatus)
      : CustomDomainCertificateStatus.Issuing;

    const result: CustomDomainVerificationResult = {
      certificateStatus: certificateStatus,
    };

    const error: unknown = json?.["certificateError"];

    if (
      certificateStatus === CustomDomainCertificateStatus.Failed &&
      typeof error === "string" &&
      error.trim().length > 0
    ) {
      result.certificateError = error.trim();
    }

    return result;
  }
}
