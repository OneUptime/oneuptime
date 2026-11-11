import { JSONObject } from "../JSON";
import DnsRecordCheckJSON, {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
} from "./DnsRecordCheck";
import CustomDomainVerification, {
  CustomDomainVerificationResult,
} from "./CustomDomainVerification";

/*
 * What a custom domain's check-dns route - DNS Setup's Check now - answers,
 * found or not: every record it looked up (DnsRecordCheck), and once the
 * domain is verified, what happens to its certificate next.
 *
 * verify-cname, the route API callers use, still refuses a domain whose
 * record is not found (now in words that say what it found). This one
 * answers either way, so DNS Setup can draw each record with its own
 * status.
 */
export interface CustomDomainDnsCheckResult {
  isVerified: boolean;
  records: Array<DnsRecordCheck>;
  // Once verified: what happens to the certificate next.
  certificate?: CustomDomainVerificationResult | undefined;
}

export default class CustomDomainDnsCheckResultJSON {
  public static toJSON(result: CustomDomainDnsCheckResult): JSONObject {
    const json: JSONObject = {
      isVerified: result.isVerified,
      records: DnsRecordCheckJSON.toJSONArray(result.records),
    };

    if (result.certificate) {
      json["certificate"] = CustomDomainVerification.toJSON(
        result.certificate,
      );
    }

    return json;
  }

  /*
   * Reads the answer. Verified is what the server said, and nothing else:
   * an answer without it (an older server, a proxy's page) reads as not
   * verified, with no records, so nothing is drawn as found that was not.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): CustomDomainDnsCheckResult {
    const isVerified: boolean = json?.["isVerified"] === true;

    const result: CustomDomainDnsCheckResult = {
      isVerified: isVerified,
      records: DnsRecordCheckJSON.fromJSONArray(json?.["records"]),
    };

    const certificate: unknown = json?.["certificate"];

    if (
      isVerified &&
      certificate &&
      typeof certificate === "object" &&
      !Array.isArray(certificate)
    ) {
      result.certificate = CustomDomainVerification.fromJSON(
        certificate as JSONObject,
      );
    }

    return result;
  }

  // Whether every record the check looked up was found.
  public static allFound(records: Array<DnsRecordCheck>): boolean {
    return (
      records.length > 0 &&
      records.every((record: DnsRecordCheck): boolean => {
        return record.outcome === DnsRecordCheckOutcome.Found;
      })
    );
  }
}
