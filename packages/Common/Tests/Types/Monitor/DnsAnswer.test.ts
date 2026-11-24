import DnsAnswer, {
  DNS_ANSWER_TEXT_MAX_LENGTH,
} from "../../../Types/Monitor/DnsMonitor/DnsAnswer";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "../../../Types/Monitor/DnsMonitor/DnsRecordType";
import DnsAnswerFingerprint, {
  DnsAnswerReading,
} from "../../../Server/Utils/Monitor/DnsAnswerFingerprint";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * A DNS answer as one set of records (#10905): what makes two answers the
 * same, and the fingerprint the series keeps of one.
 */

function answer(
  records: Array<DnsRecordResponse>,
  isOnline: boolean = true,
): DnsMonitorResponse {
  return {
    isOnline: isOnline,
    responseTimeInMs: 12,
    failureCause: isOnline ? "" : "queryA ENOTFOUND example.com",
    records: records,
  };
}

function a(value: string, ttl?: number): DnsRecordResponse {
  return {
    type: DnsRecordType.A,
    value: value,
    ...(ttl !== undefined ? { ttl } : {}),
  };
}

function fingerprintOf(response: DnsMonitorResponse): number | undefined {
  return DnsAnswerFingerprint.read(response)?.fingerprint;
}

describe("DnsAnswer.getRecords", () => {
  test("an answer's records, each as its type and value, in one order", () => {
    expect(
      DnsAnswer.getRecords(
        answer([a("93.184.216.35"), a("93.184.216.34", 300)]),
      ),
    ).toEqual(["A 93.184.216.34", "A 93.184.216.35"]);
  });

  test("the same records in another order are the same answer", () => {
    expect(
      DnsAnswer.getRecords(
        answer([a("10.0.0.3"), a("10.0.0.1"), a("10.0.0.2")]),
      ),
    ).toEqual(
      DnsAnswer.getRecords(
        answer([a("10.0.0.2"), a("10.0.0.3"), a("10.0.0.1")]),
      ),
    );
  });

  test("a TTL counting down is not part of the answer", () => {
    expect(DnsAnswer.getRecords(answer([a("10.0.0.1", 300)]))).toEqual(
      DnsAnswer.getRecords(answer([a("10.0.0.1", 17)])),
    );
  });

  test("a record twice is one record: an answer is a set", () => {
    expect(
      DnsAnswer.getRecords(answer([a("10.0.0.1"), a("10.0.0.1")])),
    ).toEqual(["A 10.0.0.1"]);
  });

  test("names are read in any case, and text and CAA values keep theirs", () => {
    expect(
      DnsAnswer.getRecords(
        answer([
          { type: DnsRecordType.CNAME, value: "Shop.Example.COM" },
          { type: DnsRecordType.MX, value: "10 MAIL.example.com" },
          { type: DnsRecordType.NS, value: "NS1.Example.com" },
          { type: DnsRecordType.TXT, value: "v=spf1 Include:_spf.Example.com" },
          { type: DnsRecordType.CAA, value: "0 LetsEncrypt.org" },
          {
            type: DnsRecordType.AAAA,
            value: "2606:2800:220:1:248:1893:25C8:1946",
          },
        ]),
      ),
    ).toEqual([
      "AAAA 2606:2800:220:1:248:1893:25c8:1946",
      "CAA 0 LetsEncrypt.org",
      "CNAME shop.example.com",
      "MX 10 mail.example.com",
      "NS ns1.example.com",
      "TXT v=spf1 Include:_spf.Example.com",
    ]);
  });

  test("spaces around a value are not part of it, and a record with no value is none", () => {
    expect(
      DnsAnswer.getRecords(answer([a("  10.0.0.1  "), a(""), a("   ")])),
    ).toEqual(["A 10.0.0.1"]);
  });

  test("a check that got no answer has no records: it failed, or the name had none", () => {
    expect(DnsAnswer.getRecords(answer([], false))).toEqual([]);
    expect(DnsAnswer.getRecords(answer([a("10.0.0.1")], false))).toEqual([]);
    expect(DnsAnswer.getRecords(answer([]))).toEqual([]);
    expect(DnsAnswer.getRecords(undefined)).toEqual([]);
    expect(DnsAnswer.getRecords(null)).toEqual([]);
  });

  test("the order does not depend on the server's locale: code points", () => {
    expect(
      DnsAnswer.getRecords(
        answer([
          { type: DnsRecordType.TXT, value: "b" },
          { type: DnsRecordType.TXT, value: "B" },
          { type: DnsRecordType.TXT, value: "a" },
        ]),
      ),
    ).toEqual(["TXT B", "TXT a", "TXT b"]);
  });
});

describe("DnsAnswer.describe", () => {
  test("an answer in words, record by record", () => {
    expect(DnsAnswer.describe(["A 10.0.0.1", "A 10.0.0.2"])).toBe(
      "A 10.0.0.1, A 10.0.0.2",
    );
  });

  test("a long answer is cut to what a row carries", () => {
    const records: Array<string> = new Array(200)
      .fill(0)
      .map((_: number, index: number): string => {
        return `TXT verification-token-${index}`;
      });
    const text: string = DnsAnswer.describe(records);

    expect(text.length).toBe(DNS_ANSWER_TEXT_MAX_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("DnsAnswerFingerprint", () => {
  test("is a whole number below 2^48, which a Float64 holds exactly", () => {
    const reading: DnsAnswerReading | null = DnsAnswerFingerprint.read(
      answer([a("93.184.216.34")]),
    );

    expect(reading).not.toBeNull();
    expect(Number.isInteger(reading!.fingerprint)).toBe(true);
    expect(reading!.fingerprint).toBeGreaterThanOrEqual(0);
    expect(reading!.fingerprint).toBeLessThan(2 ** 48);
    expect(Number.isSafeInteger(reading!.fingerprint)).toBe(true);
    // As ClickHouse's Float64 and its JSON give it back.
    expect(Number(String(reading!.fingerprint))).toBe(reading!.fingerprint);
    expect(new Float64Array([reading!.fingerprint])[0]).toBe(
      reading!.fingerprint,
    );
  });

  test("the same answer in another order, its TTLs counted down, is the same fingerprint", () => {
    expect(
      fingerprintOf(answer([a("10.0.0.1", 300), a("10.0.0.2", 300)])),
    ).toBe(fingerprintOf(answer([a("10.0.0.2", 12), a("10.0.0.1", 12)])));
  });

  test("another answer is another fingerprint: a record changed, added or gone", () => {
    const before: number | undefined = fingerprintOf(
      answer([a("10.0.0.1"), a("10.0.0.2")]),
    );

    for (const after of [
      answer([a("10.0.0.1"), a("10.0.0.3")]),
      answer([a("10.0.0.1"), a("10.0.0.2"), a("10.0.0.3")]),
      answer([a("10.0.0.1")]),
      answer([{ type: DnsRecordType.AAAA, value: "10.0.0.1" }, a("10.0.0.2")]),
    ]) {
      expect(fingerprintOf(after)).not.toBe(before);
    }
  });

  test("it is the same on every check and every server: stable for the same records", () => {
    expect(DnsAnswerFingerprint.of(["A 93.184.216.34"])).toBe(
      DnsAnswerFingerprint.of(["A 93.184.216.34"]),
    );
    // Fixed, so a change to how answers are hashed shows here first.
    expect(DnsAnswerFingerprint.of(["A 93.184.216.34"])).toBe(
      parseInt(
        crypto
          .createHash("sha256")
          .update('["A 93.184.216.34"]', "utf8")
          .digest("hex")
          .slice(0, 12),
        16,
      ),
    );
  });

  test("records are listed so that no two answers can read alike, whatever a value holds", () => {
    // Two records are not the one record their values make together.
    expect(DnsAnswerFingerprint.of(["TXT a", "TXT b"])).not.toBe(
      DnsAnswerFingerprint.of(["TXT a TXT b"]),
    );
    expect(DnsAnswerFingerprint.of(["TXT a", "TXT b"])).not.toBe(
      DnsAnswerFingerprint.of(["TXT a\nTXT b"]),
    );
    expect(DnsAnswerFingerprint.of(["TXT a", "TXT b"])).not.toBe(
      DnsAnswerFingerprint.of(['TXT a","TXT b']),
    );
  });

  test("a check that got no answer has no fingerprint", () => {
    expect(DnsAnswerFingerprint.read(answer([], false))).toBeNull();
    expect(DnsAnswerFingerprint.read(answer([]))).toBeNull();
    expect(DnsAnswerFingerprint.read(undefined)).toBeNull();
  });

  test("the reading carries the answer's records and its words", () => {
    expect(
      DnsAnswerFingerprint.read(answer([a("10.0.0.2"), a("10.0.0.1")])),
    ).toMatchObject({
      records: ["A 10.0.0.1", "A 10.0.0.2"],
      text: "A 10.0.0.1, A 10.0.0.2",
    });
  });
});
