import {
  DEFAULT_RESELLER_INQUIRY_INBOX,
  INVALID_EMAIL_MESSAGE,
  INVALID_WEBSITE_MESSAGE,
  REPLY_SUBJECT,
  RESELLER_INQUIRY_HONEYPOT_FIELD,
  RESELLER_INQUIRY_INBOX_VARIABLE,
  RESELLER_INQUIRY_PATH,
  RESELLER_INQUIRY_SUBJECT_PREFIX,
  ResellerInquiry,
  ResellerInquiryField,
  ResellerInquiryFieldOrder,
  ResellerInquiryFieldRule,
  ResellerInquiryFieldRules,
  ResellerInquiryFormContent,
  ResellerInquiryInbox,
  ResellerInquiryParseResult,
  SUBJECT_COMPANY_LIMIT,
  UNREADABLE_INQUIRY_MESSAGE,
  buildResellerInquiryEmail,
  cleanMultiline,
  cleanSingleLine,
  getConfiguredResellerInquiryInbox,
  getMessageHtml,
  getReplyMailtoUrl,
  getResellerInquiryEmailVariables,
  getResellerInquiryFormContent,
  getResellerInquiryPreheader,
  getResellerInquirySubject,
  getTooLongMessage,
  isAcceptableEmailAddress,
  isAcceptableWebsite,
  parseResellerInquiry,
  readResellerInquiryInbox,
  truncateText,
} from "../Utils/ResellerInquiry";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE RESELLER FORM, AS THE SERVER READS IT.
 *
 * Whatever reaches POST /resellers/contact came from outside: the page's own
 * checks only help the person typing. These pin what the server accepts,
 * what it cleans out of every value, what it refuses and with which words,
 * and the one email an inquiry becomes - to the configured inbox and nobody
 * else, every value in it as text.
 */

// Characters a test needs to write without writing them into this file.
const NUL: string = String.fromCodePoint(0x00);
const BELL: string = String.fromCodePoint(0x07);
const ESCAPE: string = String.fromCodePoint(0x1b);
const DELETE: string = String.fromCodePoint(0x7f);
const NEXT_LINE: string = String.fromCodePoint(0x85);
const NO_BREAK_SPACE: string = String.fromCodePoint(0xa0);
const LINE_SEPARATOR: string = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCodePoint(0x2029);
const RIGHT_TO_LEFT_OVERRIDE: string = String.fromCodePoint(0x202e);
const LEFT_TO_RIGHT_EMBEDDING: string = String.fromCodePoint(0x202a);
const FIRST_STRONG_ISOLATE: string = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE: string = String.fromCodePoint(0x2069);
const RIGHT_TO_LEFT_MARK: string = String.fromCodePoint(0x200f);
const BYTE_ORDER_MARK: string = String.fromCodePoint(0xfeff);
const CAT_FACE: string = String.fromCodePoint(0x1f431);

const isControlCode: (code: number) => boolean = (code: number): boolean => {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

const isBidiControlCode: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  );
};

const codesOf: (text: string) => Array<number> = (
  text: string,
): Array<number> => {
  return Array.from(text).map((character: string): number => {
    return character.codePointAt(0) || 0;
  });
};

function answers(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Jane Kim",
    email: "jane@acme.co.kr",
    company: "Acme Korea",
    website: "acme.co.kr",
    regions: "South Korea, Japan",
    message: "We resell DevOps tools.\nWe would like to add OneUptime.",
    [RESELLER_INQUIRY_HONEYPOT_FIELD]: "",
    ...overrides,
  };
}

function validInquiry(body: Record<string, unknown>): ResellerInquiry {
  const parsed: ResellerInquiryParseResult = parseResellerInquiry(body);

  if (parsed.kind !== "valid") {
    throw new Error(`Expected a valid inquiry, got ${JSON.stringify(parsed)}`);
  }

  return parsed.inquiry;
}

describe("the form's fields", () => {
  test("are asked in one order, each once, each with its rule", () => {
    expect(ResellerInquiryFieldOrder).toEqual([
      "name",
      "email",
      "company",
      "website",
      "regions",
      "message",
    ]);
    expect(Object.keys(ResellerInquiryFieldRules).sort()).toEqual(
      [...ResellerInquiryFieldOrder].sort(),
    );

    for (const field of ResellerInquiryFieldOrder) {
      expect(ResellerInquiryFieldRules[field].field).toBe(field);
    }
  });

  test("ask for a name, an email, a company and where it sells; the website and a message are optional", () => {
    const required: Array<ResellerInquiryField> =
      ResellerInquiryFieldOrder.filter((field: ResellerInquiryField) => {
        return ResellerInquiryFieldRules[field].required;
      });

    expect(required).toEqual(["name", "email", "company", "regions"]);
  });

  test("say what to fix when a required one is left empty", () => {
    for (const field of ResellerInquiryFieldOrder) {
      const rule: ResellerInquiryFieldRule = ResellerInquiryFieldRules[field];

      if (rule.required) {
        expect(rule.missingMessage.startsWith("Please ")).toBe(true);
        expect(rule.missingMessage.endsWith(".")).toBe(true);
      } else {
        expect(rule.missingMessage).toBe("");
      }
    }
  });

  test("are one line each, but for the message", () => {
    expect(
      ResellerInquiryFieldOrder.filter((field: ResellerInquiryField) => {
        return ResellerInquiryFieldRules[field].multiline;
      }),
    ).toEqual(["message"]);
  });

  test("take as much as a person needs, and no more", () => {
    expect(
      ResellerInquiryFieldOrder.map((field: ResellerInquiryField) => {
        return [field, ResellerInquiryFieldRules[field].maxLength];
      }),
    ).toEqual([
      ["name", 100],
      ["email", 254],
      ["company", 150],
      ["website", 200],
      ["regions", 200],
      ["message", 3000],
    ]);
  });

  test("have the labels the page shows", () => {
    expect(
      ResellerInquiryFieldOrder.map((field: ResellerInquiryField) => {
        return ResellerInquiryFieldRules[field].label;
      }),
    ).toEqual([
      "Your name",
      "Work email",
      "Company",
      "Company website",
      "Countries or regions you sell in",
      "Message",
    ]);
  });

  test("name the field in the too-long message", () => {
    expect(getTooLongMessage(ResellerInquiryFieldRules.company)).toBe(
      '"Company" is too long. Please keep it to 150 characters or fewer.',
    );
  });
});

describe("a one-line value", () => {
  test.each([
    ["  Acme  Korea  ", "Acme Korea"],
    ["Acme\r\nKorea", "Acme Korea"],
    ["Acme\nBcc: someone@example.com", "Acme Bcc: someone@example.com"],
    ["Acme\tKorea", "Acme Korea"],
    [`Acme${NO_BREAK_SPACE}Korea`, "Acme Korea"],
    [`Acme${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}Korea`, "Acme Korea"],
    [`${BYTE_ORDER_MARK}Acme`, "Acme"],
    [`Ac${NUL}me${BELL} Ko${ESCAPE}rea${DELETE}`, "Acme Korea"],
    [`Acme${NEXT_LINE}Korea`, "AcmeKorea"],
    [`${RIGHT_TO_LEFT_OVERRIDE}Acme${POP_DIRECTIONAL_ISOLATE}`, "Acme"],
    [`${LEFT_TO_RIGHT_EMBEDDING}a${FIRST_STRONG_ISOLATE}b`, "ab"],
    ["", ""],
    ["   \r\n\t  ", ""],
  ])("%j cleans to %j", (raw: string, cleaned: string) => {
    expect(cleanSingleLine(raw)).toBe(cleaned);
  });

  test("keeps every script and symbol a person writes", () => {
    for (const text of [
      "슬렉슨",
      "株式会社パートナー",
      "شركة الشريك",
      "Ålesund & Søn",
      `Café ${CAT_FACE} Co.`,
      `${RIGHT_TO_LEFT_MARK}שותף`,
    ]) {
      expect(cleanSingleLine(text)).toBe(text);
    }
  });

  test("never keeps a control character, a bidirectional control or a line break, whatever it is made of", () => {
    const alphabet: Array<string> = [
      "a",
      "Z",
      "7",
      " ",
      "  ",
      "\t",
      "\r",
      "\n",
      "\r\n",
      NUL,
      BELL,
      ESCAPE,
      DELETE,
      NEXT_LINE,
      NO_BREAK_SPACE,
      LINE_SEPARATOR,
      PARAGRAPH_SEPARATOR,
      RIGHT_TO_LEFT_OVERRIDE,
      LEFT_TO_RIGHT_EMBEDDING,
      FIRST_STRONG_ISOLATE,
      POP_DIRECTIONAL_ISOLATE,
      RIGHT_TO_LEFT_MARK,
      BYTE_ORDER_MARK,
      "슬",
      CAT_FACE,
      "<",
      "&",
    ];

    for (const text of generatedTexts(4000, 4917, alphabet)) {
      const cleaned: string = cleanSingleLine(text);

      expect(
        codesOf(cleaned).filter((code: number) => {
          return isControlCode(code) || isBidiControlCode(code);
        }),
      ).toEqual([]);
      expect(cleaned.includes("\n") || cleaned.includes("\r")).toBe(false);
      expect(cleaned).toBe(cleaned.trim());
      expect(cleaned.includes("  ")).toBe(false);
      // Cleaning again changes nothing.
      expect(cleanSingleLine(cleaned)).toBe(cleaned);
    }
  });
});

describe("a message", () => {
  test("keeps its lines, with every way a line ends read as one", () => {
    expect(
      cleanMultiline(
        `one\r\ntwo\rthree${LINE_SEPARATOR}four${PARAGRAPH_SEPARATOR}five\nsix`,
      ),
    ).toBe("one\ntwo\nthree\nfour\nfive\nsix");
  });

  test("keeps one blank line between paragraphs, and none at either end", () => {
    expect(cleanMultiline("\n\n  \nHello\n\n\n\n  \nWorld\n \n\n")).toBe(
      "Hello\n\nWorld",
    );
  });

  test("cleans each line as a one-line value", () => {
    expect(
      cleanMultiline(
        `  Hello${NUL}   there \t\n${RIGHT_TO_LEFT_OVERRIDE}World  `,
      ),
    ).toBe("Hello there\nWorld");
  });

  test("is empty when it holds nothing but space", () => {
    expect(cleanMultiline(" \r\n\t\n ")).toBe("");
  });

  test("never keeps a control character, a stray line end or more than one blank line, whatever it is made of", () => {
    const alphabet: Array<string> = [
      "word",
      " ",
      "\t",
      "\r",
      "\n",
      "\r\n",
      "\n\n\n",
      NUL,
      ESCAPE,
      NEXT_LINE,
      LINE_SEPARATOR,
      PARAGRAPH_SEPARATOR,
      RIGHT_TO_LEFT_OVERRIDE,
      "슬렉슨",
    ];

    for (const text of generatedTexts(4000, 7331, alphabet)) {
      const cleaned: string = cleanMultiline(text);

      expect(
        codesOf(cleaned).filter((code: number) => {
          return (
            (isControlCode(code) && code !== 0x0a) || isBidiControlCode(code)
          );
        }),
      ).toEqual([]);
      expect(cleaned.includes("\r")).toBe(false);
      expect(cleaned.includes("\n\n\n")).toBe(false);
      expect(cleaned.startsWith("\n") || cleaned.endsWith("\n")).toBe(false);

      for (const line of cleaned.split("\n")) {
        expect(line).toBe(cleanSingleLine(line));
      }

      expect(cleanMultiline(cleaned)).toBe(cleaned);
    }
  });
});

describe("an email address", () => {
  test.each([
    "jane@acme.co.kr",
    "Jane.Kim@Acme.com",
    "jane+resellers@acme.com",
    "j@a.io",
    "o'brien@partner.ie",
    "first_last-1@sub.domain.example.org",
    "jane@xn--9n2bp8q.com",
    "jane@슬렉슨.com",
    "user%team@acme.com",
  ])("%s is accepted", (address: string) => {
    expect(isAcceptableEmailAddress(address)).toBe(true);
  });

  test("of exactly 254 characters, with a 64-character local part, is accepted", () => {
    const longest: string = `${"j".repeat(64)}@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(57)}.com`;

    expect(longest.length).toBe(254);
    expect(isAcceptableEmailAddress(longest)).toBe(true);
  });

  test.each([
    ["no at sign", "jane.acme.com"],
    ["two at signs", "jane@kim@acme.com"],
    ["nothing before the at sign", "@acme.com"],
    ["nothing after it", "jane@"],
    ["a host with no dot", "jane@localhost"],
    ["a space", "jane kim@acme.com"],
    ["a line break", "jane@acme.com\nBcc: someone@example.com"],
    ["a carriage return", "jane@acme.com\r"],
    ["a tab", "jane@acme.com\t"],
    ["an angle bracket", "Jane <jane@acme.com>"],
    ["a comma", "jane@acme.com,someone@example.com"],
    ["a semicolon", "jane@acme.com;someone@example.com"],
    ["a colon", "mailto:jane@acme.com"],
    ["a quote", '"jane"@acme.com'],
    ["a backslash", "ja\\ne@acme.com"],
    ["brackets", "jane@[127.0.0.1]"],
    ["parentheses", "jane(comment)@acme.com"],
    ["a control character", `jane${NUL}@acme.com`],
    ["a bidirectional override", `jane${RIGHT_TO_LEFT_OVERRIDE}@acme.com`],
    ["a dot first", ".jane@acme.com"],
    ["a dot last in the local part", "jane.@acme.com"],
    ["two dots in a row", "jane..kim@acme.com"],
    ["an empty host label", "jane@acme..com"],
    ["a host that ends in a dot", "jane@acme.com."],
    ["a label starting with a hyphen", "jane@-acme.com"],
    ["a label ending with a hyphen", "jane@acme-.com"],
    ["a one-letter top-level domain", "jane@acme.c"],
    ["a numeric top-level domain", "jane@10.0.0.1"],
    ["an underscore in the host", "jane@ac_me.com"],
    ["a local part over 64 characters", `${"a".repeat(65)}@acme.com`],
    [
      "an address over 254 characters",
      `jane@${"a".repeat(62)}.${"b".repeat(62)}.${"c".repeat(62)}.${"d".repeat(62)}.com`,
    ],
    ["nothing", ""],
  ])("with %s is refused", (_reason: string, address: string) => {
    expect(isAcceptableEmailAddress(address)).toBe(false);
  });
});

describe("a website", () => {
  test.each([
    "acme.com",
    "www.acme.co.kr",
    "https://www.acme.com",
    "http://acme.com",
    "HTTPS://ACME.COM/en/partners?x=1",
    "acme.com/about",
    "슬렉슨.com",
    "acme.com:8443",
  ])("%s is accepted", (website: string) => {
    expect(isAcceptableWebsite(website)).toBe(true);
  });

  test.each([
    ["a script address", "javascript:alert(1)"],
    ["another scheme", "ftp://acme.com"],
    ["a data address", "data:text/html,hello"],
    ["a host with no dot", "localhost"],
    ["one word", "acme"],
    ["a user name and password", "https://user:secret@acme.com"],
    ["a user name", "https://user@acme.com"],
    ["spaces in the host", "acme corp.com"],
    ["an empty host label", "https://acme..com"],
    ["nothing", ""],
  ])("with %s is refused", (_reason: string, website: string) => {
    expect(isAcceptableWebsite(website)).toBe(false);
  });
});

describe("reading the form", () => {
  test("gives the inquiry, every value cleaned", () => {
    expect(
      parseResellerInquiry(
        answers({
          name: "  Jane   Kim ",
          email: " jane@acme.co.kr ",
          company: "Acme\r\nKorea",
          website: " acme.co.kr ",
          regions: "South Korea,\tJapan",
          message:
            "\n\nWe resell DevOps tools.\r\n\r\n\r\nWe would like to add OneUptime.\n\n",
        }),
      ),
    ).toEqual({
      kind: "valid",
      inquiry: {
        name: "Jane Kim",
        email: "jane@acme.co.kr",
        company: "Acme Korea",
        website: "acme.co.kr",
        regions: "South Korea, Japan",
        message: "We resell DevOps tools.\n\nWe would like to add OneUptime.",
      },
    });
  });

  test("takes an inquiry without a website or a message", () => {
    expect(
      parseResellerInquiry({
        name: "Jane Kim",
        email: "jane@acme.co.kr",
        company: "Acme Korea",
        regions: "South Korea",
      }),
    ).toEqual({
      kind: "valid",
      inquiry: {
        name: "Jane Kim",
        email: "jane@acme.co.kr",
        company: "Acme Korea",
        website: "",
        regions: "South Korea",
        message: "",
      },
    });
  });

  test("reads null as an empty value", () => {
    expect(
      parseResellerInquiry(answers({ website: null, message: null })),
    ).toMatchObject({ kind: "valid", inquiry: { website: "", message: "" } });
  });

  test.each([
    "name",
    "email",
    "company",
    "regions",
  ] as Array<ResellerInquiryField>)(
    "asks for the %s when it is missing, empty or only space",
    (field: ResellerInquiryField) => {
      for (const value of [undefined, "", "   ", "\r\n\t", NUL]) {
        const body: Record<string, unknown> = answers({ [field]: value });

        if (value === undefined) {
          delete body[field];
        }

        expect(parseResellerInquiry(body)).toEqual({
          kind: "invalid",
          field: field,
          message: ResellerInquiryFieldRules[field].missingMessage,
        });
      }
    },
  );

  test("asks for the first field to fix, in the form's order", () => {
    expect(parseResellerInquiry({ email: "nope", regions: "" })).toMatchObject({
      kind: "invalid",
      field: "name",
    });
    expect(
      parseResellerInquiry({ name: "Jane", email: "", company: "" }),
    ).toMatchObject({ kind: "invalid", field: "email" });
  });

  test("refuses an address no reply could reach", () => {
    expect(parseResellerInquiry(answers({ email: "jane@localhost" }))).toEqual({
      kind: "invalid",
      field: "email",
      message: INVALID_EMAIL_MESSAGE,
    });
  });

  test("refuses a website that is not one", () => {
    expect(
      parseResellerInquiry(answers({ website: "javascript:alert(1)" })),
    ).toEqual({
      kind: "invalid",
      field: "website",
      message: INVALID_WEBSITE_MESSAGE,
    });
  });

  test.each(
    ResellerInquiryFieldOrder.map((field: ResellerInquiryField) => {
      return [field];
    }),
  )(
    "refuses a %s longer than the field takes",
    (field: ResellerInquiryField) => {
      const rule: ResellerInquiryFieldRule = ResellerInquiryFieldRules[field];

      for (const length of [
        rule.maxLength + 1,
        rule.maxLength * 2 + 1,
        400000,
      ]) {
        expect(
          parseResellerInquiry(answers({ [field]: "x".repeat(length) })),
        ).toEqual({
          kind: "invalid",
          field: field,
          message: getTooLongMessage(rule),
        });
      }
    },
  );

  test("measures a value after cleaning it: spaces that go do not count", () => {
    const rule: ResellerInquiryFieldRule = ResellerInquiryFieldRules.company;
    const company: string = `  ${"x".repeat(rule.maxLength)}    `;

    expect(parseResellerInquiry(answers({ company: company }))).toMatchObject({
      kind: "valid",
      inquiry: { company: "x".repeat(rule.maxLength) },
    });
  });

  test.each([
    ["a number", 42],
    ["a list", ["Jane", "Kim"]],
    ["an object", { first: "Jane" }],
    ["true", true],
  ])(
    "refuses a field that is %s, not text",
    (_kind: string, value: unknown) => {
      expect(parseResellerInquiry(answers({ company: value }))).toEqual({
        kind: "invalid",
        field: "company",
        message: UNREADABLE_INQUIRY_MESSAGE,
      });
    },
  );

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "name=Jane"],
    ["a list", [answers()]],
    ["a number", 7],
  ])("refuses a body that is %s", (_kind: string, body: unknown) => {
    expect(parseResellerInquiry(body)).toEqual({
      kind: "invalid",
      field: null,
      message: UNREADABLE_INQUIRY_MESSAGE,
    });
  });

  test("reads only the form's own fields: anything else in the body is left behind", () => {
    const parsed: ResellerInquiryParseResult = parseResellerInquiry(
      answers({
        toEmail: "someone@example.com",
        to: "someone@example.com",
        cc: "someone@example.com",
        subject: "Something else",
        templateType: "BlankTemplate.hbs",
      }),
    );

    expect(parsed.kind).toBe("valid");
    expect(
      Object.keys((parsed as { inquiry: ResellerInquiry }).inquiry).sort(),
    ).toEqual(["company", "email", "message", "name", "regions", "website"]);
  });

  test("reads a field only from the body itself, never from what it inherits", () => {
    const body: Record<string, unknown> = Object.create({
      name: "Inherited",
      email: "inherited@example.com",
      company: "Inherited",
      regions: "Inherited",
    });

    expect(parseResellerInquiry(body)).toMatchObject({
      kind: "invalid",
      field: "name",
    });

    // JSON can name __proto__; it is a key like any other, and not a field.
    expect(
      parseResellerInquiry(
        JSON.parse(
          '{"__proto__": {"name": "Jane"}, "email": "jane@acme.com", "company": "Acme", "regions": "Korea"}',
        ),
      ),
    ).toMatchObject({ kind: "invalid", field: "name" });
  });

  test("marks a form whose hidden field is filled in as a program's", () => {
    expect(
      parseResellerInquiry(
        answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: "Call me at noon" }),
      ),
    ).toEqual({ kind: "trap" });
  });

  test("marks it so even when everything else is wrong", () => {
    expect(
      parseResellerInquiry({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: "x" }),
    ).toEqual({ kind: "trap" });
  });

  test("marks a hidden field that is not text as a program's too", () => {
    expect(
      parseResellerInquiry(answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: 1 })),
    ).toEqual({ kind: "trap" });
  });

  test("does not mark a hidden field left empty, or holding only space", () => {
    for (const value of ["", "   ", undefined, null]) {
      expect(
        parseResellerInquiry(
          answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: value }),
        ).kind,
      ).toBe("valid");
    }
  });
});

describe("the email an inquiry sends", () => {
  const inbox: Email = new Email("partners@oneuptime.com");

  test("goes to the inbox, never to the person who wrote", () => {
    const mail: EmailMessage = buildResellerInquiryEmail(
      validInquiry(answers()),
      inbox,
    );

    expect(mail.toEmail.toString()).toBe("partners@oneuptime.com");
    expect(mail.templateType).toBe(EmailTemplateType.ResellerInquiry);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.subject).toBe("Reseller inquiry: Acme Korea");
  });

  test("hands the template the inquiry, and only it", () => {
    expect(getResellerInquiryEmailVariables(validInquiry(answers()))).toEqual({
      preheader: "Jane Kim at Acme Korea · South Korea, Japan",
      companyName: "Acme Korea",
      companyWebsite: "acme.co.kr",
      regions: "South Korea, Japan",
      contactName: "Jane Kim",
      contactEmail: "jane@acme.co.kr",
      messageHtml:
        "We resell DevOps tools.<br/>We would like to add OneUptime.",
      replyUrl: "mailto:jane@acme.co.kr?subject=Your%20reseller%20inquiry",
    });
  });

  test("gives the inbox a preview line: who wrote, their company and where they sell", () => {
    const inquiry: ResellerInquiry = validInquiry(
      answers({ name: "김민지", company: "슬렉슨", regions: "대한민국" }),
    );

    expect(getResellerInquiryPreheader(inquiry)).toBe(
      "김민지 at 슬렉슨 · 대한민국",
    );
    expect(getResellerInquiryEmailVariables(inquiry)["preheader"]).toBe(
      getResellerInquiryPreheader(inquiry),
    );
  });

  test("keeps the preview line to one line, and never names the address or the message", () => {
    const preheader: string = getResellerInquiryPreheader(
      validInquiry(
        answers({
          name: "Jane\r\nKim",
          company: "Acme\nBcc: someone@example.com",
          regions: "South Korea,\tJapan",
          message: "A private note.",
        }),
      ),
    );

    expect(preheader).toBe(
      "Jane Kim at Acme Bcc: someone@example.com · South Korea, Japan",
    );
    expect(preheader.includes("\n") || preheader.includes("\r")).toBe(false);
    expect(preheader).not.toContain("jane@acme.co.kr");
    expect(preheader).not.toContain("A private note.");
  });

  test("leaves the website and the message empty when they were, so the template leaves their rows out", () => {
    expect(
      getResellerInquiryEmailVariables(
        validInquiry(answers({ website: "", message: "" })),
      ),
    ).toMatchObject({ companyWebsite: "", messageHtml: "" });
  });

  test("puts a company's name in the subject on one line, whatever it was sent with", () => {
    const subject: string = getResellerInquirySubject(
      validInquiry(
        answers({ company: "Acme\r\nBcc: someone@example.com\r\n\r\nHello" }),
      ),
    );

    expect(subject).toBe(
      `${RESELLER_INQUIRY_SUBJECT_PREFIX}Acme Bcc: someone@example.com Hello`,
    );
    expect(subject.includes("\n") || subject.includes("\r")).toBe(false);
  });

  test("shortens a long company name in the subject, and keeps it whole in the email", () => {
    const company: string = `${"Acme Global Partners ".repeat(7)}Ltd`;
    const inquiry: ResellerInquiry = validInquiry(
      answers({ company: company }),
    );
    const subject: string = getResellerInquirySubject(inquiry);

    expect(
      Array.from(subject.slice(RESELLER_INQUIRY_SUBJECT_PREFIX.length)).length,
    ).toBeLessThanOrEqual(SUBJECT_COMPANY_LIMIT);
    expect(subject.endsWith("…")).toBe(true);
    expect(getResellerInquiryEmailVariables(inquiry)["companyName"]).toBe(
      company,
    );
  });

  test("never splits a character in two when it shortens", () => {
    const company: string = CAT_FACE.repeat(SUBJECT_COMPANY_LIMIT + 5);
    const shortened: string = truncateText(company, SUBJECT_COMPANY_LIMIT);

    expect(Array.from(shortened).length).toBe(SUBJECT_COMPANY_LIMIT);
    expect(shortened).toBe(`${CAT_FACE.repeat(SUBJECT_COMPANY_LIMIT - 1)}…`);
    expect(truncateText("Acme", SUBJECT_COMPANY_LIMIT)).toBe("Acme");
  });
});

describe("the message, as the email shows it", () => {
  test("escapes everything in it", () => {
    expect(
      getMessageHtml(`<script>alert("x")</script> & <img src=x onerror='y'>`),
    ).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=&#39;y&#39;&gt;",
    );
  });

  test("keeps its line breaks, and its blank lines, as <br/>", () => {
    expect(getMessageHtml("one\ntwo\n\nthree")).toBe(
      "one<br/>two<br/><br/>three",
    );
  });

  test("adds no markup but the <br/> between lines", () => {
    const html: string = getMessageHtml(
      'a <b>bold</b> "move"\n<a href="https://example.com">link</a>',
    );

    expect(html.split("<").length - 1).toBe(1);
    expect(html).toContain("<br/>");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<a ");
  });

  test("is empty for no message", () => {
    expect(getMessageHtml("")).toBe("");
  });

  test("escapes an already escaped entity again, so it shows as written", () => {
    expect(getMessageHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });
});

describe("the reply link", () => {
  test("starts a reply to the person who wrote, with a subject", () => {
    const url: URL = new URL(getReplyMailtoUrl("jane@acme.co.kr"));

    expect(url.protocol).toBe("mailto:");
    expect(decodeURIComponent(url.pathname)).toBe("jane@acme.co.kr");
    expect([...url.searchParams.keys()]).toEqual(["subject"]);
    expect(url.searchParams.get("subject")).toBe(REPLY_SUBJECT);
  });

  test("can never add a header or a recipient, whatever the address holds", () => {
    const address: string =
      "jane?cc=someone%40example.com&body=hi#x=y@acme.com";

    expect(isAcceptableEmailAddress(address)).toBe(true);

    const link: string = getReplyMailtoUrl(address);
    const url: URL = new URL(link);

    expect([...url.searchParams.keys()]).toEqual(["subject"]);
    expect(url.hash).toBe("");
    expect(decodeURIComponent(url.pathname)).toBe(address);
    expect(link.split("?").length - 1).toBe(1);
    expect(link.split("&").length - 1).toBe(0);
  });

  test("keeps a non-ASCII address readable to a mail client", () => {
    const url: URL = new URL(getReplyMailtoUrl("jane@슬렉슨.com"));

    expect(decodeURIComponent(url.pathname)).toBe("jane@슬렉슨.com");
  });
});

describe("the inbox inquiries go to", () => {
  const savedInbox: string | undefined =
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE];

  afterEach(() => {
    if (savedInbox === undefined) {
      delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];
    } else {
      process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = savedInbox;
    }
  });

  test("is sales@oneuptime.com unless another is configured", () => {
    expect(DEFAULT_RESELLER_INQUIRY_INBOX).toBe("sales@oneuptime.com");
    expect(RESELLER_INQUIRY_INBOX_VARIABLE).toBe("RESELLER_INQUIRY_EMAIL");

    for (const configured of [undefined, "", "   "]) {
      const inbox: ResellerInquiryInbox = readResellerInquiryInbox(configured);

      expect(inbox.inbox.toString()).toBe("sales@oneuptime.com");
      expect(inbox.ignoredValue).toBeNull();
    }
  });

  test("is the configured address, trimmed and in lower case", () => {
    expect(
      readResellerInquiryInbox("  Partners@OneUptime.com ").inbox.toString(),
    ).toBe("partners@oneuptime.com");
  });

  test.each([
    "not an address",
    "partners@localhost",
    "partners@oneuptime.com\nBcc: someone@example.com",
    "partners@oneuptime.com, someone@example.com",
    "Partners <partners@oneuptime.com>",
  ])(
    "is the default when the configured value %j is no address",
    (value: string) => {
      const inbox: ResellerInquiryInbox = readResellerInquiryInbox(value);

      expect(inbox.inbox.toString()).toBe("sales@oneuptime.com");
      expect(inbox.ignoredValue).toBe(value.trim());
    },
  );

  test("is read from RESELLER_INQUIRY_EMAIL", () => {
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = "resellers@example.com";
    expect(getConfiguredResellerInquiryInbox().inbox.toString()).toBe(
      "resellers@example.com",
    );

    delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];
    expect(getConfiguredResellerInquiryInbox().inbox.toString()).toBe(
      "sales@oneuptime.com",
    );
  });
});

describe("what the page needs to draw the form", () => {
  test("is where to send it, who reads it, the hidden field and the rules", () => {
    const content: ResellerInquiryFormContent = getResellerInquiryFormContent(
      "partners@example.com",
    );

    expect(content).toEqual({
      endpoint: "/resellers/contact",
      fallbackEmail: "partners@example.com",
      honeypotField: "contactPreference",
      fields: ResellerInquiryFieldRules,
    });
    expect(RESELLER_INQUIRY_PATH).toBe("/resellers/contact");
  });

  test("names the configured inbox when none is given", () => {
    const saved: string | undefined =
      process.env[RESELLER_INQUIRY_INBOX_VARIABLE];

    process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = "resellers@example.com";

    try {
      expect(getResellerInquiryFormContent().fallbackEmail).toBe(
        "resellers@example.com",
      );
    } finally {
      if (saved === undefined) {
        delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];
      } else {
        process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = saved;
      }
    }
  });
});

describe("reading takes time in line with the text, whatever its shape", () => {
  const TWO_SECONDS: number = 2000;
  const LENGTH: number = 400000;

  /*
   * How long the work takes: the fastest of up to three attempts, counted as
   * it would have run on a usual runner when every attempt overran on a slow
   * one (Tests/Helpers/FastestRun).
   */
  function timeOf(work: () => unknown): number {
    return fastestRun({ run: work, limitInMs: TWO_SECONDS }).inMs;
  }

  test.each([
    ["spaces between letters", "a ".repeat(LENGTH / 2)],
    ["nothing but spaces", " ".repeat(LENGTH)],
    ["line breaks", "\r\n".repeat(LENGTH / 2)],
    ["control characters", `${NUL}${ESCAPE}`.repeat(LENGTH / 2)],
    ["bidirectional controls", `${RIGHT_TO_LEFT_OVERRIDE}a`.repeat(LENGTH / 2)],
    ["characters of two halves", CAT_FACE.repeat(LENGTH / 2)],
  ])("%s, one line or many", (_shape: string, text: string) => {
    expect(
      timeOf(() => {
        return cleanSingleLine(text);
      }),
    ).toBeLessThan(TWO_SECONDS);
    expect(
      timeOf(() => {
        return cleanMultiline(text);
      }),
    ).toBeLessThan(TWO_SECONDS);
    expect(
      timeOf(() => {
        return getMessageHtml(text);
      }),
    ).toBeLessThan(TWO_SECONDS);
  });

  test.each([
    ["at signs", "@".repeat(LENGTH)],
    ["dots", `a@${".".repeat(LENGTH)}`],
    ["labels", `a@${"a.".repeat(LENGTH / 2)}com`],
  ])("an address of %s", (_shape: string, address: string) => {
    expect(
      timeOf(() => {
        return isAcceptableEmailAddress(address);
      }),
    ).toBeLessThan(TWO_SECONDS);
  });

  test("a website of many dots", () => {
    expect(
      timeOf(() => {
        return isAcceptableWebsite(`${"a.".repeat(LENGTH / 2)}com`);
      }),
    ).toBeLessThan(TWO_SECONDS);
  });

  test("a whole form of it", () => {
    const huge: string = `${"a \r\n".repeat(LENGTH / 4)}`;

    expect(
      timeOf(() => {
        return parseResellerInquiry({
          name: huge,
          email: huge,
          company: huge,
          website: huge,
          regions: huge,
          message: huge,
        });
      }),
    ).toBeLessThan(TWO_SECONDS);
  });
});
