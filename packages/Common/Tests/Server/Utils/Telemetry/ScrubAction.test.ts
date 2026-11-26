import { describe, expect, test } from "@jest/globals";
import ScrubAction, {
  SCRUB_REDACTED_TEXT,
} from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "../../../../Types/Trace/TraceScrubPatternType";

/*
 * WHAT A SCRUB RULE LEAVES IN PLACE OF A MATCH: ONE ANSWER FOR THE LOG,
 * TRACE AND SESSION REPLAY SCRUBBERS.
 *
 * The three engines each kept a copy of Redact, Mask and Hash; they all ask
 * ScrubAction now, so these tests pin what every engine writes. The Hash
 * token is the project's (#10394), an IP address's in one spelling for
 * every way it is written, and an IP address masks to a shape of its own
 * kind (#10393).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000c10394",
);

function apply(
  match: string,
  action: string,
  patternType: string,
  projectId: ObjectID | string | null | undefined = PROJECT_ID,
): string {
  return ScrubAction.apply({
    match: match,
    action: action,
    patternType: patternType,
    projectId: projectId,
  });
}

describe("Redact", () => {
  test("is [REDACTED] for every pattern type", () => {
    for (const patternType of Object.values(LogScrubPatternType)) {
      expect(apply("anything", LogScrubAction.Redact, patternType)).toBe(
        "[REDACTED]",
      );
    }

    expect(SCRUB_REDACTED_TEXT).toBe("[REDACTED]");
  });

  test("is what an action no one knows does too", () => {
    expect(apply("ada@example.com", "shred", LogScrubPatternType.Email)).toBe(
      "[REDACTED]",
    );
    expect(apply("ada@example.com", "", LogScrubPatternType.Email)).toBe(
      "[REDACTED]",
    );
  });
});

describe("Mask", () => {
  test.each([
    [LogScrubPatternType.Email, "ada@example.com", "a***@***.com"],
    [LogScrubPatternType.Email, "no-at-sign", "***@***.***"],
    [
      LogScrubPatternType.CreditCard,
      "4111 1111 1111 1234",
      "****-****-****-1234",
    ],
    [LogScrubPatternType.SSN, "123-45-6789", "***-**-6789"],
    [LogScrubPatternType.PhoneNumber, "555-123-4567", "***-***-4567"],
    [LogScrubPatternType.IPAddress, "8.8.8.8", "***.***.***.***"],
    [LogScrubPatternType.IPAddress, "::ffff:8.8.8.8", "***.***.***.***"],
    [
      LogScrubPatternType.IPAddress,
      "2001:4860:4860::8888",
      "****:****:****:****:****:****:****:****",
    ],
    [LogScrubPatternType.Custom, "secret-value", "s**********e"],
    [LogScrubPatternType.SensitiveKeys, "hunter2", "h*****2"],
  ])(
    "a %s match %s becomes %s",
    (patternType: string, match: string, masked: string) => {
      expect(apply(match, LogScrubAction.Mask, patternType)).toBe(masked);
    },
  );
});

describe("Hash", () => {
  test("is the project's token, made by the one function every engine hashes through", () => {
    expect(
      apply("ada@example.com", LogScrubAction.Hash, LogScrubPatternType.Email),
    ).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "ada@example.com",
      }),
    );
    expect(
      apply("hunter2", LogScrubAction.Hash, LogScrubPatternType.SensitiveKeys),
    ).toBe(ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "hunter2" }));
  });

  test("of an IP address is the address's token, in one spelling for every way it is written", () => {
    const token: string = apply(
      "::ffff:203.0.113.7",
      LogScrubAction.Hash,
      LogScrubPatternType.IPAddress,
    );

    expect(token).toBe(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "203.0.113.7",
      }),
    );
    expect(
      apply("203.0.113.7", LogScrubAction.Hash, LogScrubPatternType.IPAddress),
    ).toBe(token);
  });

  test("of the same text by a custom pattern is the text's own token", () => {
    // Only the IP Address pattern reads an address in one spelling.
    expect(
      apply(
        "::ffff:203.0.113.7",
        LogScrubAction.Hash,
        LogScrubPatternType.Custom,
      ),
    ).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "::ffff:203.0.113.7",
      }),
    );
  });

  test.each([
    ["no project", undefined],
    ["a null project", null],
    ["an empty project", ""],
    ["a blank project", "   "],
  ])(
    "with %s, cannot make the project's token, and redacts: the value is never stored",
    (_label: string, projectId: string | null | undefined) => {
      expect(
        ScrubAction.apply({
          match: "203.0.113.7",
          action: LogScrubAction.Hash,
          patternType: LogScrubPatternType.IPAddress,
          projectId: projectId,
        }),
      ).toBe("[REDACTED]");
    },
  );

  test("differs between two projects", () => {
    expect(
      apply("123-45-6789", LogScrubAction.Hash, LogScrubPatternType.SSN),
    ).not.toBe(
      apply(
        "123-45-6789",
        LogScrubAction.Hash,
        LogScrubPatternType.SSN,
        new ObjectID("0193b0a1-0000-7000-8000-000000c20394"),
      ),
    );
  });
});

/*
 * #10935 and #10960: an email address written in a percent-encoded URL,
 * and a card written in another script's digits, are masked and hashed as
 * the value they read as - so each has the token of the value written
 * plainly, and a value written plainly keeps the token it always had.
 */
describe("a match as the value it reads as", () => {
  test.each([
    ["jane.doe%40acmecorp.io", "jane.doe@acmecorp.io"],
    ["Jane.Doe%2Bnews%40AcmeCorp.io", "Jane.Doe+news@AcmeCorp.io"],
    ["jane%2540acmecorp.io", "jane@acmecorp.io"],
    ["jane.doe@acmecorp.io", "jane.doe@acmecorp.io"],
  ])(
    "an Email Address match %s reads as %s, and has its token",
    (match: string, address: string) => {
      expect(ScrubAction.asItReads(match, LogScrubPatternType.Email)).toBe(
        address,
      );
      expect(apply(match, LogScrubAction.Hash, LogScrubPatternType.Email)).toBe(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: address }),
      );
    },
  );

  test.each([
    ["４１１１ １１１１ １１１１ １２３４", "4111 1111 1111 1234"],
    ["٤١١١-١١١١-١١١١-١٢٣٤", "4111-1111-1111-1234"],
    ["۴۱۱۱۱۱۱۱۱۱۱۱۱۲۳۴", "4111111111111234"],
    ["４１１１ 1111 1111 1234", "4111 1111 1111 1234"],
    ["4111 1111 1111 1234", "4111 1111 1111 1234"],
  ])(
    "a Credit Card match %s reads as %s, and has its token",
    (match: string, card: string) => {
      expect(ScrubAction.asItReads(match, LogScrubPatternType.CreditCard)).toBe(
        card,
      );
      expect(
        apply(match, LogScrubAction.Hash, LogScrubPatternType.CreditCard),
      ).toBe(ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: card }));
    },
  );

  test("any other pattern's match reads as it is written, escapes and digits and all", () => {
    for (const patternType of [
      LogScrubPatternType.Custom,
      LogScrubPatternType.SensitiveKeys,
    ]) {
      expect(ScrubAction.asItReads("a%40b ４", patternType)).toBe("a%40b ４");
    }
  });

  test.each([
    // A phone number reads with its escapes read and its digits in ASCII (#11030).
    [
      LogScrubPatternType.PhoneNumber,
      "%2B44%2020%207946%200958",
      "+44 20 7946 0958",
    ],
    [LogScrubPatternType.PhoneNumber, "+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨", "+44 20 7946 0958"],
    [LogScrubPatternType.PhoneNumber, "+۴۹ ۳۰ ۱۲۳۴۵۶", "+49 30 123456"],
    [LogScrubPatternType.PhoneNumber, "％2B44", "％2B44"],
    // A Social Security number with its digits in ASCII; escapes are no part of one.
    [LogScrubPatternType.SSN, "١٢٣-٤٥-٦٧٨٩", "123-45-6789"],
    [LogScrubPatternType.SSN, "１２３ ４５ ６７８９", "123 45 6789"],
    [LogScrubPatternType.SSN, "123%2D45%2D6789", "123%2D45%2D6789"],
  ])(
    "a %s match %s reads as %s",
    (patternType: string, match: string, reads: string) => {
      expect(ScrubAction.asItReads(match, patternType)).toBe(reads);
    },
  );

  test("a phone number or a Social Security number written plainly reads as it is, so its token is what it was before #11030", () => {
    for (const [patternType, match] of [
      [LogScrubPatternType.PhoneNumber, "555-123-4567"],
      [LogScrubPatternType.PhoneNumber, "+1 (415) 555-2671"],
      [LogScrubPatternType.PhoneNumber, "+44 20 7946 0958"],
      [LogScrubPatternType.SSN, "123-45-6789"],
    ] as Array<[string, string]>) {
      expect(ScrubAction.asItReads(match, patternType)).toBe(match);
      expect(apply(match, LogScrubAction.Hash, patternType)).toBe(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: match }),
      );
    }
  });

  test.each([
    ["%2B44%2020%207946%200958", "+44 20 7946 0958"],
    ["+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨", "+44 20 7946 0958"],
    ["+４４ ２０ ７９４６ ０９５８", "+44 20 7946 0958"],
  ])(
    "a phone number %s hashes as %s written plainly does",
    (match: string, plain: string) => {
      expect(
        apply(match, LogScrubAction.Hash, LogScrubPatternType.PhoneNumber),
      ).toBe(ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: plain }));
    },
  );

  test("a Social Security number in another script's digits hashes as the one in ASCII does", () => {
    expect(
      apply("١٢٣-٤٥-٦٧٨٩", LogScrubAction.Hash, LogScrubPatternType.SSN),
    ).toBe(
      ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "123-45-6789" }),
    );
  });

  test.each([
    [LogScrubPatternType.Email, "jane.doe%40acmecorp.io", "j***@***.io"],
    [LogScrubPatternType.Email, "张伟@acmecorp.io", "张***@***.io"],
    [LogScrubPatternType.Email, "почта@пример.рф", "п***@***.рф"],
    [LogScrubPatternType.Email, "𠀀伟@acmecorp.io", "𠀀***@***.io"],
    [
      LogScrubPatternType.CreditCard,
      "４１１１ １１１１ １１１１ １２３４",
      "****-****-****-1234",
    ],
    [
      LogScrubPatternType.CreditCard,
      "٤١١١-١١١١-١١١١-١٢٣٤",
      "****-****-****-1234",
    ],
    [
      LogScrubPatternType.CreditCard,
      "３７８２ ８２２４６３ １０００５",
      "****-****-****-0005",
    ],
  ])(
    "a %s match %s masks as %s",
    (patternType: string, match: string, masked: string) => {
      expect(apply(match, LogScrubAction.Mask, patternType)).toBe(masked);
    },
  );

  // #11030: the last four digits of the number as it reads, in ASCII.
  test.each([
    [LogScrubPatternType.PhoneNumber, "555-123-4567", "***-***-4567"],
    [LogScrubPatternType.PhoneNumber, "+44 20 7946 0958", "***-***-0958"],
    [LogScrubPatternType.PhoneNumber, "+44 (0)20 7946 0123", "***-***-0123"],
    [
      LogScrubPatternType.PhoneNumber,
      "%2B44%2020%207946%200958",
      "***-***-0958",
    ],
    [LogScrubPatternType.PhoneNumber, "%2B49%2030%20123456", "***-***-3456"],
    [LogScrubPatternType.PhoneNumber, "+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨", "***-***-0958"],
    [LogScrubPatternType.PhoneNumber, "+۴۹ ۳۰ ۱۲۳۴۵۶", "***-***-3456"],
    [
      LogScrubPatternType.PhoneNumber,
      "+４４ ２０ ７９４６ ０９５８",
      "***-***-0958",
    ],
    [LogScrubPatternType.PhoneNumber, "12", "***-***-****"],
    [LogScrubPatternType.SSN, "123-45-6789", "***-**-6789"],
    [LogScrubPatternType.SSN, "123.45.6789", "***-**-6789"],
    [LogScrubPatternType.SSN, "123 45 6789", "***-**-6789"],
    [LogScrubPatternType.SSN, "١٢٣-٤٥-٦٧٨٩", "***-**-6789"],
    [LogScrubPatternType.SSN, "１２３ ４５ ６７８９", "***-**-6789"],
    [LogScrubPatternType.SSN, "12", "***-**-****"],
  ])(
    "a %s match %s masks as %s, whatever its writing",
    (patternType: string, match: string, masked: string) => {
      expect(apply(match, LogScrubAction.Mask, patternType)).toBe(masked);
    },
  );
});

describe("a trace rule's words", () => {
  test("are a log rule's, so one comparison serves both", () => {
    expect({ ...TraceScrubAction }).toEqual({ ...LogScrubAction });
    expect({ ...TraceScrubPatternType }).toEqual({ ...LogScrubPatternType });
  });
});
