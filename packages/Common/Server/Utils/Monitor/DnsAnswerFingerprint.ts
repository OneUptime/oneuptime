import DnsAnswer from "../../../Types/Monitor/DnsMonitor/DnsAnswer";
import DnsMonitorResponse from "../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import crypto from "crypto";

// A check's DNS answer, as the series keeps it and the comparison reads it.
export interface DnsAnswerReading {
  // A whole number below 2^48: what the series holds, exactly, as a Float64.
  fingerprint: number;
  // The answer's records, as one set (DnsAnswer.getRecords).
  records: Array<string>;
  // The answer in words, as the row carries it (DnsAnswer.describe).
  text: string;
}

// 48 bits: twelve hexadecimal digits of the hash.
const FINGERPRINT_HEX_DIGITS: number = 12;

/*
 * The fingerprint of a DNS answer (#10905): the first 48 bits of a SHA-256 of
 * its records, sorted - so the same answer in another order, with its TTLs
 * counted down, is the same fingerprint, and any other answer is another one
 * but once in 2^48. See DnsAnswer for what makes two answers the same.
 */
export default class DnsAnswerFingerprint {
  // This check's answer, or null when it got none to compare.
  public static read(
    dnsResponse: DnsMonitorResponse | undefined | null,
  ): DnsAnswerReading | null {
    const records: Array<string> = DnsAnswer.getRecords(dnsResponse);

    if (records.length === 0) {
      return null;
    }

    return {
      fingerprint: DnsAnswerFingerprint.of(records),
      records: records,
      text: DnsAnswer.describe(records),
    };
  }

  /*
   * Of the records as a JSON list: no record's value, whatever it holds, can
   * make one answer read as another.
   */
  public static of(records: Array<string>): number {
    return parseInt(
      crypto
        .createHash("sha256")
        .update(JSON.stringify(records), "utf8")
        .digest("hex")
        .slice(0, FINGERPRINT_HEX_DIGITS),
      16,
    );
  }
}
