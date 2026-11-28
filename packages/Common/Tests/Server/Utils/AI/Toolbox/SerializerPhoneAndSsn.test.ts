import { describe, expect, test } from "@jest/globals";
import ToolResultSerializer, {
  REDACTION_PLACEHOLDERS,
  SECURITY_OBSERVABLE_RULE_NAMES,
  SerializedResult,
} from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import { DIGIT_ZEROS } from "../../../../../Utils/DataSecurity/DigitReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../../../Utils/Telemetry/ScrubBuiltInPatterns";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A TOOL RESULT HIDES THE PHONE NUMBERS AND SOCIAL SECURITY NUMBERS DATA
 * SECURITY FINDS, AND KEEPS THE TIMESTAMPS AND IDS A MODEL NEEDS (#11384).
 *
 * Everything a tool result puts in a prompt - and so sends to the model's
 * provider and keeps in AI Logs - goes through ToolResultSerializer. It hid
 * secrets, email addresses, IP addresses and grouped cards, and no phone
 * number nor Social Security number: "SSN 536221234" and "call +44 20 7946
 * 0958" reached the model as they were. Now what Data Security's own phone
 * and SSN detectors find is "[redacted-phone]" and "[redacted-ssn]" - a
 * national number and nine bare digits only beside the words that name
 * them, or in a row's field whose name does - and what they do not find is
 * kept: Unix times, span and trace ids, order numbers, durations, ports.
 * Not the Phone Number rule's own pattern, which takes any ten digits.
 * ---------------------------------------------------------------------------
 */

function redacted(text: string): string {
  return ToolResultSerializer.redact(text).text;
}

// What Data Security finds of a type in a text.
function foundOf(text: string, dataTypeId: string): Array<string> {
  return findSensitiveValues(text)
    .filter((match: TextMatch): boolean => {
      return match.dataTypeId === dataTypeId;
    })
    .map((match: TextMatch): string => {
      return text.slice(match.start, match.end);
    });
}

describe("a phone number Data Security finds is hidden", () => {
  test.each([
    ["an international number in groups", "call +44 20 7946 0958 now", "call [redacted-phone] now"],
    ["with its calling code in parentheses", "dial (+44) 20 7946 0958", "dial ([redacted-phone]"],
    ["with a trunk prefix in parentheses", "tel +44 (0)20 7946 0958", "tel [redacted-phone]"],
    ["typeset with no-break spaces", "mobile +49 30 123456", "mobile [redacted-phone]"],
    ["a North American one as people write it", "ring (415) 555-2671 today", "ring [redacted-phone] today"],
    ["one with dots", "office 415.555.2671", "office [redacted-phone]"],
    ["a UK mobile", "sms 07700 900123 sent", "sms [redacted-phone] sent"],
    ["a national number beside tel", "tel 02012345678 ok", "tel [redacted-phone] ok"],
    ["a national number beside phone in JSON", '{"phone": "0612345678"}', '{"phone": "[redacted-phone]"}'],
    ["in a URL, escaped", "GET /notify?phone=%2B44%2020%207946%200958", "GET /notify?phone=[redacted-phone]"],
    ["typed into a form", "GET /c?tel=%2B44+20+7946+0958&x=1", "GET /c?tel=[redacted-phone]&x=1"],
    ["typed wholly in fullwidth", "電話 ＋８１ ３－１２３４－５６７８", "電話 [redacted-phone]"],
    ["set apart by the prolonged sound mark", "電話 ＋８１ ３ー１２３４ー５６７８", "電話 [redacted-phone]"],
    ["in Arabic-Indic digits", "هاتف +٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨", "هاتف [redacted-phone]"],
  ])("%s: %s", (_label: string, text: string, expected: string) => {
    expect(redacted(text)).toBe(expected);
    // Data Security calls it one.
    expect(foundOf(text, "phone-number").length).toBeGreaterThan(0);
  });
});

describe("a Social Security number Data Security finds is hidden", () => {
  test.each([
    ["in its groups", "applicant 536-22-8731 ok", "applicant [redacted-ssn] ok"],
    ["set apart by dots", "ssn 536.22.8731", "ssn [redacted-ssn]"],
    ["set apart by spaces", "SSN 536 22 8731", "SSN [redacted-ssn]"],
    ["nine digits beside SSN", "SSN 536221234 verified", "SSN [redacted-ssn] verified"],
    ["nine digits beside the words", "social security number: 536221234", "social security number: [redacted-ssn]"],
    ["in a URL", "GET /apply?social+security+number=536221234", "GET /apply?social+security+number=[redacted-ssn]"],
    ["typed wholly in fullwidth", "SSN：５３６－２２－８７３１", "SSN：[redacted-ssn]"],
    ["set apart by en dashes", "ssn 536–22–8731", "ssn [redacted-ssn]"],
    ["in Persian digits beside ssn", "ssn ۵۳۶۲۲۱۲۳۴", "ssn [redacted-ssn]"],
  ])("%s: %s", (_label: string, text: string, expected: string) => {
    expect(redacted(text)).toBe(expected);
    expect(foundOf(text, "us-ssn").length).toBeGreaterThan(0);
  });

  test("each is counted as one redaction", () => {
    expect(
      ToolResultSerializer.redact(
        "SSN 536221234, then 536-22-8731, then call +44 20 7946 0958",
      ).count,
    ).toBe(3);
  });
});

/*
 * What a tool result is full of and a model needs. None is a phone number
 * or a Social Security number to Data Security, and each reaches the model
 * as it is - though the Phone Number rule's own pattern takes any ten
 * digits, which is why it is not what the serializer hides by.
 */
const KEPT: ReadonlyArray<[string, string]> = [
  ["a Unix time in seconds", "time=1732752000 level=info"],
  ["a Unix time in milliseconds", "ts=1732752000123 level=info"],
  ["a Unix time in nanoseconds", "timeUnixNano=1732752000123456789"],
  ["a duration in nanoseconds", "durationNano=2012345678"],
  ["an ISO timestamp", "2026-11-28T10:15:02.123Z INFO started"],
  ["a W3C trace id", "traceId=4bf92f3577b34da6a3ce929d0e0e4736"],
  ["an all-numeric span id", "spanId=1234567890123456"],
  ["a hex span id", "spanId=00f067aa0ba902b7"],
  ["an order number", "order 2012345678 shipped"],
  ["an invoice number of nine digits", "invoice 536221234 paid"],
  ["a ticket of twelve digits", "ticket 020123456789 closed"],
  ["a request id", "request_id=7716203944 status=200"],
  ["a Kubernetes resource version", 'resourceVersion: "1847263956"'],
  ["a process id and a port", "pid 2012345 listening on 5432"],
  ["a build number", "build 20261128.4 deployed"],
  ["a version", "version 1.23.456"],
  ["a sum", "total 1234567890 bytes in 12 files"],
  ["a span name and its duration", "GET /api/orders took 2012345678ns"],
  ["a CVE id", "CVE-2026-12345 fixed"],
  ["a UUID", "id=550e8400-e29b-41d4-a716-446655440000"],
  ["a date range", "2026-11-01–2026-11-28"],
  ["a katakana word beside digits", "サーバー3台 データ2ー3件"],
];

describe("timestamps and ids survive", () => {
  test.each(KEPT)("%s: %s", (_label: string, text: string) => {
    expect(redacted(text)).toBe(text);
    expect(foundOf(text, "phone-number")).toEqual([]);
    expect(foundOf(text, "us-ssn")).toEqual([]);
  });

  test("the Phone Number rule's own pattern would have taken some of them: the serializer does not hide by it", () => {
    const phoneRule: ReturnType<typeof compileBuiltInScrubPattern> =
      compileBuiltInScrubPattern(LogScrubPatternType.PhoneNumber);
    const takenByThePattern: Array<string> = KEPT.map(
      (kept: [string, string]): string => {
        return kept[1];
      },
    ).filter((text: string): boolean => {
      return phoneRule!.matchRanges(text).length > 0;
    });

    // Ten-digit times, durations, ids and sums: every one kept by the serializer.
    expect(takenByThePattern.length).toBeGreaterThan(4);

    for (const text of takenByThePattern) {
      expect(redacted(text)).toBe(text);
    }
  });

  test("a row of a log search keeps its time, ids and durations, and loses its customer's numbers", () => {
    const rows: Array<JSONObject> = [
      {
        time: "2026-11-28T10:15:02.123Z",
        timeUnixNano: "1732788902123000000",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "1234567890123456",
        durationNano: 2012345678,
        body: "order 2012345678 shipped to +44 20 7946 0958, SSN 536221234 on file",
        attributes: { "http.status_code": 200, "net.peer.port": 5432 },
      },
    ];
    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);

    expect(result.text).toBe(
      '- time=2026-11-28T10:15:02.123Z | timeUnixNano=1732788902123000000 | traceId=4bf92f3577b34da6a3ce929d0e0e4736 | spanId=1234567890123456 | durationNano=2012345678 | body=order 2012345678 shipped to [redacted-phone], SSN [redacted-ssn] on file | attributes={"http.status_code":200,"net.peer.port":5432}',
    );
    expect(result.redactionCount).toBe(2);
  });
});

describe("a row's field whose name names one is the words its value needs", () => {
  test.each([
    ["phone", "02012345678"],
    ["mobile", "612345678"],
    ["customer_phone", "447700900123"],
    ["phoneNumber", "020 1234 5678"],
    ["msisdn", "447700900123"],
  ])("%s=%s is hidden", (key: string, value: string) => {
    expect(ToolResultSerializer.serializeRows([{ [key]: value }]).text).toBe(
      `- ${key}=[redacted-phone]`,
    );
  });

  test.each([
    ["ssn", "536221234"],
    ["social_security_number", "536221234"],
    ["applicant_ssn", "５３６２２１２３４"],
  ])("%s=%s is hidden", (key: string, value: string) => {
    expect(ToolResultSerializer.serializeRows([{ [key]: value }]).text).toBe(
      `- ${key}=[redacted-ssn]`,
    );
  });

  test.each([
    ["orderId", "02012345678"],
    ["requestNumber", "612345678"],
    ["invoice", "536221234"],
    ["phone_count", "12"],
    ["phone", "0000000000"],
    ["ssn", "666221234"],
  ])("%s=%s is kept", (key: string, value: string) => {
    expect(ToolResultSerializer.serializeRows([{ [key]: value }]).text).toBe(
      `- ${key}=${value}`,
    );
  });

  test("a field's name names only its own value: the next field is read as it is", () => {
    expect(
      ToolResultSerializer.serializeRows([
        { phone: "02012345678", order: "02012345678" },
      ]).text,
    ).toBe("- phone=[redacted-phone] | order=02012345678");
  });

  test("free text, which no field holds, reads its numbers by the words beside them alone", () => {
    expect(
      ToolResultSerializer.serializeText("02012345678 and 536221234", 1).text,
    ).toBe("02012345678 and 536221234");
  });
});

describe("a security result keeps a phone number and hides a Social Security number", () => {
  test("a phone number names the account a code is sent to, as an email names one; an SSN is Restricted", () => {
    expect(SECURITY_OBSERVABLE_RULE_NAMES).toContain("phone-number");
    expect(SECURITY_OBSERVABLE_RULE_NAMES).not.toContain("us-ssn");

    const text: string =
      "OTP to +44 20 7946 0958 from 203.0.113.9 for ssn 536221234";

    expect(
      ToolResultSerializer.redact(text, { keepSecurityObservables: true })
        .text,
    ).toBe("OTP to +44 20 7946 0958 from 203.0.113.9 for ssn [redacted-ssn]");
    expect(
      ToolResultSerializer.serializeRows([{ phone: "02012345678" }], 1, {
        keepSecurityObservables: true,
      }).text,
    ).toBe("- phone=02012345678");
  });
});

describe("the placeholders", () => {
  test("are listed for a code change to be held to, one per rule", () => {
    expect(REDACTION_PLACEHOLDERS).toContain("[redacted-phone]");
    expect(REDACTION_PLACEHOLDERS).toContain("[redacted-ssn]");
  });

  test("a text the serializer hid is read again as it is: no placeholder is a value", () => {
    const once: string = redacted("call +44 20 7946 0958, SSN 536221234");

    expect(redacted(once)).toBe(once);
  });
});

/*
 * IN TIME IN LINE WITH THE TEXT'S LENGTH.
 *
 * 400,000 characters of each awkward text - digits without end, words that
 * name a number without end, a "+" before digits without end, numbers
 * back to back - read under two seconds (Tests/Helpers/FastestRun).
 */
const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

const EVERY_SCRIPT_DIGITS: string = DIGIT_ZEROS.map((zero: number): string => {
  return String.fromCharCode(zero + 4);
}).join("");

const TIMED: ReadonlyArray<[string, string]> = [
  ["digits without end", repeat("4", LENGTH)],
  ["digits and spaces without end", repeat("4 ", LENGTH)],
  ["plus signs before digits without end", repeat("+4", LENGTH)],
  ["phone words without end", repeat("tel ", LENGTH)],
  ["phone words and digits in turn", repeat("tel 0201234567 ", LENGTH)],
  ["SSN words and nine digits in turn", repeat("ssn 536221234 ", LENGTH)],
  ["SSNs in groups back to back", repeat("536-22-8731 ", LENGTH)],
  ["international numbers back to back", repeat("+44 20 7946 0958 ", LENGTH)],
  ["Unix times back to back", repeat("time=1732752000 ", LENGTH)],
  ["every script's digits in turn", repeat(EVERY_SCRIPT_DIGITS, LENGTH)],
  ["fullwidth digits and prolonged sound marks", repeat("３ー", LENGTH)],
  ["a phone word, then digits without end", "tel " + repeat("4", LENGTH)],
];

describe("the phone and Social Security number rules read a tool result in time in line with its length", () => {
  test.each(TIMED)("%s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return ToolResultSerializer.redact(text).count;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
