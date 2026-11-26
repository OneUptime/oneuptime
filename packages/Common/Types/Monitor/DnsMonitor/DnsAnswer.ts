import DnsMonitorResponse, { DnsRecordResponse } from "./DnsMonitorResponse";
import DnsRecordType from "./DnsRecordType";

/*
 * A DNS ANSWER, COMPARED WITH THE PREVIOUS CHECK'S (#10905).
 *
 * "Alert me when the DNS answer changes": DNS Record Value, evaluated over
 * time with Previous Check, Not Equal To. An answer is a set of records, so
 * it is compared as one: each check that got an answer writes its
 * fingerprint - a hash of its records, sorted - to the monitor's series,
 * named for its probe and its step like every row a check writes, and the
 * next check of that probe and step compares its own with it
 * (PreviousCheckComparison).
 *
 * What is the same answer:
 *   - the same records in another order: resolvers rotate them;
 *   - a record's TTL counting down, which a caching resolver does between
 *     any two checks: it is not part of the answer;
 *   - a name in another case: DNS names are not case-sensitive (RFC 4343).
 *     Text (TXT) and a CAA record's value keep their case.
 *   - a record twice: an answer is a set.
 *
 * A check that got no answer - the name did not resolve, the lookup timed
 * out, no record of the type - writes none and is compared with nothing:
 * whether the name answers is DNS Is Online's to say. The next check that
 * gets an answer is compared with the last answer before it, while that is
 * inside the filter's window.
 *
 * The row's value is the fingerprint, a whole number below 2^48 that a
 * Float64 holds exactly; the answer itself, cut to a length a row can carry,
 * rides beside it so the finding can say what it was.
 */

// The series each check's answer is written to: the evaluator's, never charted.
export const DNS_ANSWER_METRIC_NAME: string =
  "oneuptime.monitor.dns.answer.fingerprint";

// The attribute that carries the answer itself, for the finding's words.
export const DNS_ANSWER_TEXT_ATTRIBUTE: string = "dnsAnswer";

// How much of an answer a row carries: a fingerprint covers all of it.
export const DNS_ANSWER_TEXT_MAX_LENGTH: number = 1000;

// The record types whose values are names and numbers alone: case is not theirs.
const CASE_INSENSITIVE_RECORD_TYPES: ReadonlyArray<string> = [
  DnsRecordType.A,
  DnsRecordType.AAAA,
  DnsRecordType.CNAME,
  DnsRecordType.MX,
  DnsRecordType.NS,
  DnsRecordType.PTR,
  DnsRecordType.SOA,
  DnsRecordType.SRV,
];

export default class DnsAnswer {
  /*
   * An answer's records as one set: each "TYPE value", its value trimmed and,
   * for a name, in lower case, without the TTL; each once, in code-point
   * order. Empty for a check that got no answer.
   */
  public static getRecords(
    dnsResponse: DnsMonitorResponse | undefined | null,
  ): Array<string> {
    if (!dnsResponse || dnsResponse.isOnline === false) {
      return [];
    }

    const records: Set<string> = new Set<string>();

    for (const record of dnsResponse.records || []) {
      const written: string | null = DnsAnswer.getRecord(record);

      if (written !== null) {
        records.add(written);
      }
    }

    // Code-point order: the same on every server, whatever its locale.
    return Array.from(records).sort((a: string, b: string): number => {
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  // One record as the answer holds it, or null for one with no value.
  public static getRecord(record: DnsRecordResponse): string | null {
    const type: string = String(record?.type || "").trim();
    const value: string = String(record?.value ?? "").trim();

    if (!value) {
      return null;
    }

    return `${type} ${
      CASE_INSENSITIVE_RECORD_TYPES.includes(type) ? value.toLowerCase() : value
    }`;
  }

  /*
   * The answer in words, for a finding and the row that carries it: "A
   * 93.184.216.34, A 93.184.216.35", cut at DNS_ANSWER_TEXT_MAX_LENGTH.
   */
  public static describe(records: Array<string>): string {
    const text: string = records.join(", ");

    return text.length > DNS_ANSWER_TEXT_MAX_LENGTH
      ? `${text.slice(0, DNS_ANSWER_TEXT_MAX_LENGTH - 1)}…`
      : text;
  }
}
