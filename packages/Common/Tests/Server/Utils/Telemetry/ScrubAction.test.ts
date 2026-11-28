import { describe, expect, test } from "@jest/globals";
import ScrubAction, {
  SCRUB_REDACTED_TEXT,
} from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
} from "../../../../Types/Telemetry/ScrubRule";
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

  test("a key-targeted rule's value reads as it is written, escapes and digits and all", () => {
    for (const patternType of [
      LogScrubPatternType.SensitiveKeys,
      LogScrubPatternType.NamedKeys,
    ]) {
      expect(ScrubAction.asItReads("a%40b ４", patternType)).toBe("a%40b ４");
    }
  });

  // A Custom Regex rule reads a value's escapes and every script's digits (#11031, #11033).
  test("a custom pattern's match reads with its escapes read and its digits in ASCII", () => {
    expect(ScrubAction.asItReads("a%40b ４", LogScrubPatternType.Custom)).toBe(
      "a@b 4",
    );
    // A token, put together where it is used: never written whole here.
    const token: string = ["ghp", "Zx8Kq2Lm9Pw4Rt6Hy3Nc8Vb5Jm1Df7Gs0AeQ"].join(
      "_",
    );

    expect(
      ScrubAction.asItReads(
        token.replace(/_/g, "%5F"),
        LogScrubPatternType.Custom,
      ),
    ).toBe(token);
    expect(
      ScrubAction.asItReads(
        "DE٨٩٣٧٠٤٠٠٤٤٠٥٣٢٠١٣٠٠٠",
        LogScrubPatternType.Custom,
      ),
    ).toBe("DE89370400440532013000");
    // Written plainly, as it always read.
    expect(
      ScrubAction.asItReads("EMP-004211", LogScrubPatternType.Custom),
    ).toBe("EMP-004211");
  });

  test("a custom pattern's match has the token, and the mask, of the value written plainly", () => {
    const projectId: ObjectID = ObjectID.generate();
    const token: string = ["ghp", "Zx8Kq2Lm9Pw4Rt6Hy3Nc8Vb5Jm1Df7Gs0AeQ"].join(
      "_",
    );
    const plain: { hash: string; mask: string } = {
      hash: ScrubAction.apply({
        match: token,
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.Custom,
        projectId,
      }),
      mask: ScrubAction.mask(token, LogScrubPatternType.Custom),
    };

    for (const written of [
      token.replace(/_/g, "%5F"),
      token.replace("_", "%255F"),
    ]) {
      expect(
        ScrubAction.apply({
          match: written,
          action: LogScrubAction.Hash,
          patternType: LogScrubPatternType.Custom,
          projectId,
        }),
      ).toBe(plain.hash);
      expect(ScrubAction.mask(written, LogScrubPatternType.Custom)).toBe(
        plain.mask,
      );
    }

    expect(ScrubAction.mask("٣٤٥٦٧٨", LogScrubPatternType.Custom)).toBe(
      ScrubAction.mask("345678", LogScrubPatternType.Custom),
    );
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
    // A Social Security number with its digits in ASCII.
    [LogScrubPatternType.SSN, "١٢٣-٤٥-٦٧٨٩", "123-45-6789"],
    [LogScrubPatternType.SSN, "１２３ ４５ ６７８９", "123 45 6789"],
    // In a URL too, since an SSN rule reads one there (#11199): its escapes read.
    [LogScrubPatternType.SSN, "123%2D45%2D6789", "123-45-6789"],
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

/*
 * #11199: a value in a URL, its groups apart by %20, by the "+" a query
 * string writes a space as, or by that "+" escaped again in a URL inside a
 * query string - and a phone number's own "+" escaped - masks and hashes
 * as the value written plainly does, in every engine (they all apply a
 * rule's action here).
 */
describe("a value in a URL as the value it reads as (#11199)", () => {
  const CARD: string = "4539 1488 0343 6467";

  test.each([
    ["4539%201488%200343%206467"],
    ["4539+1488+0343+6467"],
    ["4539%2B1488%2B0343%2B6467"],
    ["4539+1488%200343+6467"],
    ["٤٥٣٩+١٤٨٨+٠٣٤٣+٦٤٦٧"],
    ["%EF%BC%94539+1488+0343+6467"],
  ])(
    "a Credit Card match %s reads, masks and hashes as the card written plainly",
    (match: string) => {
      expect(ScrubAction.asItReads(match, LogScrubPatternType.CreditCard)).toBe(
        CARD,
      );
      expect(
        apply(match, LogScrubAction.Hash, LogScrubPatternType.CreditCard),
      ).toBe(apply(CARD, LogScrubAction.Hash, LogScrubPatternType.CreditCard));
      expect(
        apply(match, LogScrubAction.Mask, LogScrubPatternType.CreditCard),
      ).toBe("****-****-****-6467");
    },
  );

  test("a card's mask keeps no digit of an escape", () => {
    // Its last group escaped whole: an escape's digits are no card's.
    expect(
      apply(
        "4539%201488%200343%20%36%34%36%37",
        LogScrubAction.Mask,
        LogScrubPatternType.CreditCard,
      ),
    ).toBe("****-****-****-6467");
  });

  test.each([
    ["078%2005%201120", "078 05 1120"],
    ["078+05+1120", "078 05 1120"],
    ["٠٧٨+٠٥+١١٢٠", "078 05 1120"],
  ])(
    "an SSN match %s reads, masks and hashes as %s written plainly",
    (match: string, plain: string) => {
      expect(ScrubAction.asItReads(match, LogScrubPatternType.SSN)).toBe(plain);
      expect(apply(match, LogScrubAction.Hash, LogScrubPatternType.SSN)).toBe(
        apply(plain, LogScrubAction.Hash, LogScrubPatternType.SSN),
      );
      expect(apply(match, LogScrubAction.Mask, LogScrubPatternType.SSN)).toBe(
        "***-**-1120",
      );
    },
  );

  test.each([
    ["%2B44+20+7946+0958"],
    ["+44+20+7946+0958"],
    ["%2B44%2B20%2B7946%2B0958"],
    ["+٤٤+٢٠+٧٩٤٦+٠٩٥٨"],
  ])(
    "a Phone Number match %s keeps its own '+', and reads, masks and hashes as +44 20 7946 0958",
    (match: string) => {
      const plain: string = "+44 20 7946 0958";

      expect(
        ScrubAction.asItReads(match, LogScrubPatternType.PhoneNumber),
      ).toBe(plain);
      expect(
        apply(match, LogScrubAction.Hash, LogScrubPatternType.PhoneNumber),
      ).toBe(
        apply(plain, LogScrubAction.Hash, LogScrubPatternType.PhoneNumber),
      );
      expect(
        apply(match, LogScrubAction.Mask, LogScrubPatternType.PhoneNumber),
      ).toBe("***-***-0958");
    },
  );

  test("a card, an SSN or a phone number written plainly reads as it is, so its token is what it was", () => {
    for (const [patternType, match] of [
      [LogScrubPatternType.CreditCard, "4539 1488 0343 6467"],
      [LogScrubPatternType.CreditCard, "4539-1488-0343-6467"],
      [LogScrubPatternType.SSN, "078-05-1120"],
      [LogScrubPatternType.PhoneNumber, "+44 20 7946 0958"],
      [LogScrubPatternType.PhoneNumber, "(+44) 20 7946 0958"],
    ] as Array<[string, string]>) {
      expect(ScrubAction.asItReads(match, patternType)).toBe(match);
      expect(apply(match, LogScrubAction.Hash, patternType)).toBe(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: match }),
      );
    }
  });

  /*
   * A Custom Regex rule's match: read as the reading that found it reads
   * it (ScrubRule's readMatch, handed in as `pattern`), so an IBAN typed
   * into a form has the token and the mask of the IBAN written plainly -
   * and a "+" the pattern takes as written is the value's own, kept.
   */
  describe("a custom pattern's match, read by its pattern", () => {
    const IBAN_PATTERN: ScrubRegExp = compileScrubRuleCustomRegex(
      "\\b[A-Z]{2}[0-9]{2}(?: ?[0-9]{4}){4} ?[0-9]{2}\\b",
    )!;
    const PLAIN_IBAN: string = "DE89 3704 0044 0532 0130 00";

    function applyWith(
      pattern: ScrubRegExp,
      match: string,
      action: string,
    ): string {
      return ScrubAction.apply({
        match,
        action,
        patternType: LogScrubPatternType.Custom,
        projectId: PROJECT_ID,
        pattern,
      });
    }

    test.each([
      ["DE89+3704+0044+0532+0130+00"],
      ["DE89%203704%200044%200532%200130%2000"],
      ["DE89%2B3704%2B0044%2B0532%2B0130%2B00"],
      ["DE89+3704%200044+0532%200130+00"],
      ["DE٨٩+٣٧٠٤+٠٠٤٤+٠٥٣٢+٠١٣٠+٠٠"],
    ])(
      "an IBAN %s hashes and masks as the IBAN written plainly",
      (match: string) => {
        for (const action of [LogScrubAction.Hash, LogScrubAction.Mask]) {
          expect(applyWith(IBAN_PATTERN, match, action)).toBe(
            applyWith(IBAN_PATTERN, PLAIN_IBAN, action),
          );
        }
      },
    );

    test("a '+' the pattern takes as written is the value's own: its token is its own", () => {
      const email: ScrubRegExp = compileScrubRuleCustomRegex(
        "[a-z+]{1,20}@[a-z]{1,20}\\.com",
      )!;

      expect(
        applyWith(email, "jane+news@example.com", LogScrubAction.Hash),
      ).toBe(
        ScrubHashToken.ofValue({
          projectId: PROJECT_ID,
          value: "jane+news@example.com",
        }),
      );
      expect(
        applyWith(email, "jane+news@example.com", LogScrubAction.Mask),
      ).toBe(ScrubAction.mask("jane+news@example.com", "Custom"));
    });

    test("with no pattern handed in, a custom match reads as it always did", () => {
      expect(
        apply(
          "DE89+3704+0044+0532+0130+00",
          LogScrubAction.Hash,
          LogScrubPatternType.Custom,
        ),
      ).toBe(
        ScrubHashToken.ofValue({
          projectId: PROJECT_ID,
          value: "DE89+3704+0044+0532+0130+00",
        }),
      );
    });

    test("Redact leaves [REDACTED] whatever the match reads as", () => {
      expect(
        applyWith(IBAN_PATTERN, "DE89+3704+0044+0532+0130+00", "Redact"),
      ).toBe("[REDACTED]");
    });
  });
});

/*
 * #11115: a number typed wholly in fullwidth - its digits, its plus sign,
 * hyphens, parentheses, full stops and ideographic spaces - reads as the
 * number written in ASCII, for its mask and its token, so a value hashed
 * however it was typed has the one token.
 */
describe("a number typed wholly in fullwidth, as the number it reads as (#11115)", () => {
  const IDEOGRAPHIC_SPACE: string = "　";

  test.each([
    [
      LogScrubPatternType.PhoneNumber,
      "＋８１ ３－１２３４－５６７８",
      "+81 3-1234-5678",
    ],
    [
      LogScrubPatternType.PhoneNumber,
      `＋８１${IDEOGRAPHIC_SPACE}３－１２３４－５６７８`,
      "+81 3-1234-5678",
    ],
    [
      LogScrubPatternType.PhoneNumber,
      "（４１５）３２１－８７３１",
      "(415)321-8731",
    ],
    [LogScrubPatternType.PhoneNumber, "＋81 3－1234－5678", "+81 3-1234-5678"],
    [LogScrubPatternType.SSN, "５３６－２２－８７３１", "536-22-8731"],
    [LogScrubPatternType.SSN, "５３６．２２．８７３１", "536.22.8731"],
    [
      LogScrubPatternType.CreditCard,
      `４５３２${IDEOGRAPHIC_SPACE}０１５１${IDEOGRAPHIC_SPACE}１２８３${IDEOGRAPHIC_SPACE}０３６６`,
      "4532 0151 1283 0366",
    ],
    [
      LogScrubPatternType.CreditCard,
      "４５３２－０１５１－１２８３－０３６６",
      "4532-0151-1283-0366",
    ],
    // A CPF a Custom Regex rule found typed in fullwidth.
    [
      LogScrubPatternType.Custom,
      "４７１．３９２．８６５－８２",
      "471.392.865-82",
    ],
    // Its UTF-8 bytes escaped in a URL, then folded.
    [
      LogScrubPatternType.PhoneNumber,
      encodeURIComponent("＋８１ ３－１２３４－５６７８"),
      "+81 3-1234-5678",
    ],
    [
      LogScrubPatternType.PhoneNumber,
      "%EF%BC%8B81+3%EF%BC%8D1234%EF%BC%8D5678",
      "+81 3-1234-5678",
    ],
  ])(
    "a %s match %s reads as %s, and hashes and masks as it does",
    (patternType: string, written: string, reads: string) => {
      expect(ScrubAction.asItReads(written, patternType)).toBe(reads);
      expect(apply(written, LogScrubAction.Hash, patternType)).toBe(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: reads }),
      );
      expect(apply(written, LogScrubAction.Hash, patternType)).toBe(
        apply(reads, LogScrubAction.Hash, patternType),
      );
      expect(apply(written, LogScrubAction.Mask, patternType)).toBe(
        apply(reads, LogScrubAction.Mask, patternType),
      );
    },
  );

  test("Mask keeps a fullwidth number's last four digits, in ASCII", () => {
    expect(
      apply(
        "＋８１ ３－１２３４－５６７８",
        LogScrubAction.Mask,
        LogScrubPatternType.PhoneNumber,
      ),
    ).toBe("***-***-5678");
    expect(
      apply(
        "５３６－２２－８７３１",
        LogScrubAction.Mask,
        LogScrubPatternType.SSN,
      ),
    ).toBe("***-**-8731");
    expect(
      apply(
        "４５３２－０１５１－１２８３－０３６６",
        LogScrubAction.Mask,
        LogScrubPatternType.CreditCard,
      ),
    ).toBe("****-****-****-0366");
  });

  test("an IP address and a key's whole value read as they are written", () => {
    expect(
      ScrubAction.asItReads("（８１）", LogScrubPatternType.SensitiveKeys),
    ).toBe("（８１）");
    expect(
      ScrubAction.asItReads("２００１：ｄｂ８：：１", LogScrubPatternType.IPAddress),
    ).toBe("２００１：ｄｂ８：：１");
  });

  /*
   * #11385: an email address typed in fullwidth reads as the address it
   * is, its fullwidth "+" too - ＋ is NFKC's +, so jane＋news@example.com is
   * jane+news@example.com - and the token is the plain address's.
   */
  test("an email address typed in fullwidth reads as ASCII, a fullwidth plus sign too (#11385)", () => {
    expect(
      ScrubAction.asItReads(
        "jane＋news@example.com",
        LogScrubPatternType.Email,
      ),
    ).toBe("jane+news@example.com");
    expect(
      ScrubAction.asItReads(
        "ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ",
        LogScrubPatternType.Email,
      ),
    ).toBe("jane@example.com");
  });

  test("a number written plainly reads as it is, so its token is what it always was", () => {
    for (const [patternType, value] of [
      [LogScrubPatternType.PhoneNumber, "+81 3-1234-5678"],
      [LogScrubPatternType.SSN, "536-22-8731"],
      [LogScrubPatternType.CreditCard, "4532 0151 1283 0366"],
    ] as Array<[string, string]>) {
      expect(ScrubAction.asItReads(value, patternType)).toBe(value);
    }
  });
});

describe("a trace rule's words", () => {
  test("are a log rule's, so one comparison serves both", () => {
    expect({ ...TraceScrubAction }).toEqual({ ...LogScrubAction });
    expect({ ...TraceScrubPatternType }).toEqual({ ...LogScrubPatternType });
  });
});
