import { describe, expect, test } from "@jest/globals";
import {
  buildOnCallPageSms,
  describeWhatHappened,
  MAX_PAGE_SMS_SEGMENTS,
  MIN_TITLE_CHARACTERS,
  ON_CALL_PAGE_SMS_ACTION,
  ON_CALL_PAGE_SMS_CUT_MARK,
  ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED,
  OnCallPageSms,
  OnCallPageSmsInput,
  OnCallPageSmsKind,
} from "../../../Utils/Sms/OnCallPageSms";
import { countSmsSegments, SmsEncoding } from "../../../Utils/Sms/SmsSegments";
import ProductBrandingUtil from "../../../Types/Branding/ProductBranding";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * THE TEXT MESSAGE A PAGE SENDS (Utils/Sms/OnCallPageSms).
 *
 * Who sends it, the severity and what happened, its number, the project,
 * the title and the one link to acknowledge or escalate it - in one part of
 * 160 characters wherever it can be. When everything does not fit, the
 * project goes first, then the title is cut and ends with "...", never
 * below MIN_TITLE_CHARACTERS; the product, the severity, the number and the
 * link are never cut. Characters are written as \u{...} escapes.
 */

// OneUptime Cloud's short link, and two self-hosted ones.
const CLOUD_LINK: string = "https://oneuptime.com/l/XJlaZRsd";
const SELF_HOSTED_LINK: string =
  "https://status-oneuptime.example.com/l/XJlaZRsd";
const LONG_SELF_HOSTED_LINK: string =
  "https://oneuptime.monitoring.internal.example-corp.com/l/XJlaZRsd";

const LINKS: ReadonlyArray<string> = [
  CLOUD_LINK,
  SELF_HOSTED_LINK,
  LONG_SELF_HOSTED_LINK,
];

const KINDS: ReadonlyArray<OnCallPageSmsKind> = [
  OnCallPageSmsKind.Incident,
  OnCallPageSmsKind.Alert,
  OnCallPageSmsKind.IncidentEpisode,
  OnCallPageSmsKind.AlertEpisode,
];

// A project's default severities and number prefixes, by kind.
const DEFAULTS: Record<
  OnCallPageSmsKind,
  { severityName: string; number: string; what: string }
> = {
  [OnCallPageSmsKind.Incident]: {
    severityName: "Critical Incident",
    number: "INC-21033",
    what: "Critical Incident",
  },
  [OnCallPageSmsKind.Alert]: {
    severityName: "High",
    number: "ALT-512",
    what: "High alert",
  },
  [OnCallPageSmsKind.IncidentEpisode]: {
    severityName: "Critical Incident",
    number: "IE-7",
    what: "Critical Incident episode",
  },
  [OnCallPageSmsKind.AlertEpisode]: {
    severityName: "High",
    number: "AE-3",
    what: "High alert episode",
  },
};

const page: (
  overrides: Partial<OnCallPageSmsInput> & { kind?: OnCallPageSmsKind },
) => OnCallPageSms = (
  overrides: Partial<OnCallPageSmsInput> & { kind?: OnCallPageSmsKind },
): OnCallPageSms => {
  const kind: OnCallPageSmsKind = overrides.kind || OnCallPageSmsKind.Incident;

  return buildOnCallPageSms({
    kind: kind,
    productName: "OneUptime",
    severityName: DEFAULTS[kind].severityName,
    number: DEFAULTS[kind].number,
    projectName: "Acme Prod",
    title: "API is down",
    link: CLOUD_LINK,
    ...overrides,
  });
};

// A space or a stray mark right before a cut title's "...".
const STRAY_BEFORE_CUT_MARK: RegExp = /[ ,;:(\-/[]\.\.\. Ack/;

const tail: (link: string) => string = (link: string): string => {
  return ` ${ON_CALL_PAGE_SMS_ACTION} ${link}`;
};

describe("the words", () => {
  test("are the ones the docs quote", () => {
    expect(ON_CALL_PAGE_SMS_ACTION).toBe("Ack or escalate:");
    expect(ON_CALL_PAGE_SMS_CUT_MARK).toBe("...");
    expect(MIN_TITLE_CHARACTERS).toBe(20);
    expect(MAX_PAGE_SMS_SEGMENTS).toBe(10);
  });

  test("name the action as every other place does: Escalate, never the old words", () => {
    expect(ON_CALL_PAGE_SMS_ACTION.toLowerCase()).toContain("escalate");
    expect(ON_CALL_PAGE_SMS_ACTION.toLowerCase()).not.toContain("pass");
    // Two characters fewer than "Ack or pass it on:": more room for the title.
    expect(ON_CALL_PAGE_SMS_ACTION).toHaveLength(16);
    expect(countSmsSegments(ON_CALL_PAGE_SMS_ACTION).encoding).toBe(
      SmsEncoding.Gsm7,
    );
  });
});

describe("Escalate in a text: still one part", () => {
  // Titles of the kind real incidents and alerts have.
  const TYPICAL_TITLES: ReadonlyArray<string> = [
    "API is down",
    "Checkout API is offline",
    "High error rate on payments-service",
    "Database replication lag above 30 seconds",
    "Disk usage above 90% on db-primary-01",
    "SSL certificate for www.acme.com expires in 7 days",
    "p99 latency of /api/orders is above 2 seconds in eu-west-1",
    "[FIRING:3] KubePodCrashLooping production/checkout-7d9f",
    'Synthetic check "Login flow" failed from 3 probes',
    "Memory usage of cache-redis-02 is at 97% and still climbing fast",
  ];

  test.each(KINDS)(
    "a %s page with a typical title takes one GSM-7 part on Cloud and on self-hosted addresses",
    (kind: OnCallPageSmsKind) => {
      for (const title of TYPICAL_TITLES) {
        for (const link of LINKS) {
          const sms: OnCallPageSms = page({ kind, title, link });

          expect({ title, link, sent: sms.sent }).toEqual({
            title,
            link,
            sent: {
              encoding: SmsEncoding.Gsm7,
              length: sms.sent.length,
              segments: 1,
            },
          });
          expect(sms.text.endsWith(`Ack or escalate: ${link}`)).toBe(true);
        }
      }
    },
  );

  test("the shorter words leave the title two more characters before it is cut", () => {
    const sms: OnCallPageSms = page({ title: "x".repeat(300) });
    const kept: number = sms.text.split("x").length - 1;

    // 65 kept with "Ack or pass it on:", 67 now.
    expect(kept).toBe(67);
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 160,
      segments: 1,
    });
  });
});

describe("what a page's text says", () => {
  test("the issue's example: one part of 115 characters instead of two of 225", () => {
    const sms: OnCallPageSms = page({});

    expect(sms.text).toBe(
      "OneUptime: Critical Incident INC-21033 in Acme Prod: API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    );
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 115,
      segments: 1,
    });
    expect(sms.isProjectLeftOut).toBe(false);
    expect(sms.isTitleCut).toBe(false);
  });

  test.each([
    [
      OnCallPageSmsKind.Incident,
      "OneUptime: Critical Incident INC-21033 in Acme Prod: Checkout API is offline. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    ],
    [
      OnCallPageSmsKind.Alert,
      "OneUptime: High alert ALT-512 in Acme Prod: Checkout API is offline. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    ],
    [
      OnCallPageSmsKind.IncidentEpisode,
      "OneUptime: Critical Incident episode IE-7 in Acme Prod: Checkout API is offline. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    ],
    [
      OnCallPageSmsKind.AlertEpisode,
      "OneUptime: High alert episode AE-3 in Acme Prod: Checkout API is offline. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    ],
  ])("a %s", (kind: OnCallPageSmsKind, text: string) => {
    const sms: OnCallPageSms = page({
      kind: kind,
      title: "Checkout API is offline",
    });

    expect(sms.text).toBe(text);
    expect(sms.sent.segments).toBe(1);
  });

  test("a title that ends a sentence gets no second full stop", () => {
    expect(page({ title: "API is down!" }).text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: API is down!${tail(CLOUD_LINK)}`,
    );
    expect(page({ title: "Is the API down?" }).text).toContain(
      "Is the API down?" + tail(CLOUD_LINK),
    );
    expect(page({ title: "API is down." }).text).toContain(
      "API is down." + tail(CLOUD_LINK),
    );
  });

  test("a record without a title, a number, a severity or a project leaves it out", () => {
    expect(page({ title: "" }).text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod.${tail(CLOUD_LINK)}`,
    );
    expect(page({ number: undefined }).text).toBe(
      `OneUptime: Critical Incident in Acme Prod: API is down.${tail(CLOUD_LINK)}`,
    );
    expect(page({ severityName: null }).text).toBe(
      `OneUptime: Incident INC-21033 in Acme Prod: API is down.${tail(CLOUD_LINK)}`,
    );
    expect(page({ projectName: "  " }).text).toBe(
      `OneUptime: Critical Incident INC-21033: API is down.${tail(CLOUD_LINK)}`,
    );
    expect(
      page({
        kind: OnCallPageSmsKind.AlertEpisode,
        severityName: undefined,
        number: undefined,
        projectName: undefined,
        title: undefined,
      }).text,
    ).toBe(`OneUptime: Alert episode.${tail(CLOUD_LINK)}`);
  });

  test("a project without a number prefix numbers it with #", () => {
    expect(page({ number: "#42" }).text).toBe(
      `OneUptime: Critical Incident #42 in Acme Prod: API is down.${tail(CLOUD_LINK)}`,
    );
  });

  test("a title on several lines is one line, and the link is trimmed", () => {
    expect(
      page({ title: "  API\n is\tdown  ", link: `  ${CLOUD_LINK}\n` }).text,
    ).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: API is down.${tail(CLOUD_LINK)}`,
    );
  });
});

describe("describeWhatHappened", () => {
  test.each([
    [OnCallPageSmsKind.Incident, "Critical Incident", "Critical Incident"],
    [OnCallPageSmsKind.Incident, "Major Incident", "Major Incident"],
    [OnCallPageSmsKind.Incident, "critical incident", "critical incident"],
    [OnCallPageSmsKind.Incident, "SEV1", "SEV1 incident"],
    [OnCallPageSmsKind.Incident, "Critical", "Critical incident"],
    [OnCallPageSmsKind.Incident, "Sev 1 (Incident)", "Sev 1 (Incident)"],
    [
      OnCallPageSmsKind.IncidentEpisode,
      "Critical Incident",
      "Critical Incident episode",
    ],
    [OnCallPageSmsKind.IncidentEpisode, "P1", "P1 incident episode"],
    [OnCallPageSmsKind.Alert, "High", "High alert"],
    [OnCallPageSmsKind.Alert, "Low", "Low alert"],
    [OnCallPageSmsKind.Alert, "P1 Alert", "P1 Alert"],
    [OnCallPageSmsKind.AlertEpisode, "High", "High alert episode"],
    [OnCallPageSmsKind.AlertEpisode, "P1 Alert", "P1 Alert episode"],
    [OnCallPageSmsKind.Incident, "", "Incident"],
    [OnCallPageSmsKind.Alert, "", "Alert"],
    [OnCallPageSmsKind.IncidentEpisode, "", "Incident episode"],
    [OnCallPageSmsKind.AlertEpisode, "", "Alert episode"],
  ])(
    "a %s of severity %j is a %j",
    (kind: OnCallPageSmsKind, severityName: string, what: string) => {
      expect(describeWhatHappened({ kind, severityName })).toBe(what);
    },
  );

  test("a severity that only ends with the letters of the kind is not taken for it", () => {
    // "Nonincident" is not "incident": its last word's letters differ.
    expect(
      describeWhatHappened({
        kind: OnCallPageSmsKind.Incident,
        severityName: "Nonincident",
      }),
    ).toBe("Nonincident incident");
  });
});

describe("the fitting rule", () => {
  test("leaves the project out first, and keeps the whole title when that is enough", () => {
    const title: string = "Production Website (www.acme.com) is offline";
    const sms: OnCallPageSms = page({ title: title, link: SELF_HOSTED_LINK });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033: ${title}.${tail(SELF_HOSTED_LINK)}`,
    );
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(false);
    expect(sms.sent.segments).toBe(1);
  });

  test("then cuts the title, at a word, ending with three full stops", () => {
    const sms: OnCallPageSms = page({
      title:
        "Database replication lag on db-primary-01 is above 30 seconds and still growing in eu-west-1",
    });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033: Database replication lag on db-primary-01 is above 30 seconds and...${tail(CLOUD_LINK)}`,
    );
    // "still" would end two characters past the part: the cut stays at a word.
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 158,
      segments: 1,
    });
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(true);
  });

  test("a word longer than the room left is cut where the room ends", () => {
    const sms: OnCallPageSms = page({ title: "x".repeat(300) });

    // 40 before the title, 3 for the mark, 50 for the words and the link.
    expect(sms.sent.length).toBe(160);
    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033: ${"x".repeat(67)}...${tail(CLOUD_LINK)}`,
    );
  });

  test("the cut title is as long as one part allows: one character more would not fit", () => {
    for (const link of LINKS) {
      const sms: OnCallPageSms = page({ title: "y".repeat(400), link: link });
      const kept: number = sms.text.split("y").length - 1;
      const oneMore: string = sms.text.replace(
        `${"y".repeat(kept)}...`,
        `${"y".repeat(kept + 1)}...`,
      );

      expect(sms.sent.segments).toBe(1);
      expect(countSmsSegments(oneMore).segments).toBe(2);
    }
  });

  test("never leaves a stray mark or space before the cut mark", () => {
    const sms: OnCallPageSms = page({
      title: `${"word ".repeat(9)}disk (sda1), / - ; : ${"z".repeat(80)}`,
    });

    expect(sms.isTitleCut).toBe(true);
    expect(sms.text).not.toMatch(STRAY_BEFORE_CUT_MARK);
    expect(sms.text).not.toContain("....");
  });

  test("reading well never costs a part: when the cut at a word would not fit as sent, the plain cut goes out", () => {
    // 67 characters of title fit; the 68th is inside a word, which starts at 63.
    const title: string = "abcdefgh ".repeat(12).trim();
    const atAWord: OnCallPageSms = page({ title: title });

    expect(atAWord.isTitleCut).toBe(true);
    expect(atAWord.text).toContain(`${"abcdefgh ".repeat(6)}abcdefgh...`);

    // A send path that would make exactly that text longer than one part.
    const inflatesTheWordCut: (text: string) => string = (
      text: string,
    ): string => {
      return text === atAWord.text ? `${text}${"!".repeat(200)}` : text;
    };
    const sms: OnCallPageSms = page({
      title: title,
      sentAs: inflatesTheWordCut,
    });

    expect(sms.text).not.toBe(atAWord.text);
    expect(sms.sent.segments).toBe(1);
    expect(sms.isTitleCut).toBe(true);
    // The plain cut keeps more of the title than the cut at a word.
    expect(sms.text.length).toBeGreaterThan(atAWord.text.length);
  });

  test("a cut that reading well would take below MIN_TITLE_CHARACTERS stays plain, without a trailing space", () => {
    const sms: OnCallPageSms = page({
      title: `${"a".repeat(18)} ${",".repeat(200)}`,
    });
    const title: string = sms.text.slice(
      sms.text.indexOf("INC-21033: ") + "INC-21033: ".length,
      sms.text.indexOf(`...${tail(CLOUD_LINK)}`),
    );

    expect(sms.isTitleCut).toBe(true);
    expect(sms.sent.segments).toBe(1);
    expect(Array.from(title).length).toBeGreaterThanOrEqual(
      MIN_TITLE_CHARACTERS,
    );
    expect(title.endsWith(" ")).toBe(false);
  });

  test("never keeps fewer than MIN_TITLE_CHARACTERS where the cut ends after a space: the text takes a second part instead", () => {
    /*
     * The first 20 characters fit one part and end with a space; the Hindi
     * after them makes the text UCS-2. Without the space the cut would keep
     * 19 - so the page goes out whole, in two parts.
     */
    const title: string = "API API API API API \u{0928}\u{0947}";
    const sms: OnCallPageSms = page({ title: title });

    expect(sms.isTitleCut).toBe(false);
    expect(sms.isProjectLeftOut).toBe(false);
    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: ${title}.${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.encoding).toBe(SmsEncoding.Ucs2);
    expect(sms.sent.segments).toBe(2);
  });

  test("never keeps fewer than MIN_TITLE_CHARACTERS where the next character is a mark of the letter before it", () => {
    // The 20th character carries a mark: a cut there would keep 19.
    const title: string = `${"a".repeat(19)}\u{0928}\u{0947}${"x".repeat(10)}`;
    const sms: OnCallPageSms = page({ title: title });

    expect(sms.sent.segments).toBe(2);

    if (sms.isTitleCut) {
      const kept: string = sms.text.slice(
        sms.text.indexOf("INC-21033: ") + "INC-21033: ".length,
        sms.text.indexOf(`...${tail(CLOUD_LINK)}`),
      );

      expect(Array.from(kept).length).toBeGreaterThanOrEqual(
        MIN_TITLE_CHARACTERS,
      );
    } else {
      expect(sms.text).toContain(`: ${title}.`);
    }
  });

  test("a cut title keeps at least MIN_TITLE_CHARACTERS whatever its words, spaces, marks and scripts", () => {
    const random: SeededRandom = seededRandom(51140);
    const pieces: ReadonlyArray<string> = [
      "API",
      "down",
      " ",
      ",",
      "-",
      "\u{0928}\u{0947}",
      "\u{6C7A}",
      "\u{201C}x\u{201D}",
      "[1]",
      "y".repeat(19),
    ];

    for (let round: number = 0; round < 2000; round++) {
      let title: string = "";

      for (let index: number = random(30); index > 0; index--) {
        title += pieces[random(pieces.length)];
      }

      const link: string = LINKS[random(LINKS.length)]!;
      const sms: OnCallPageSms = page({ title: title, link: link });

      if (!sms.isTitleCut) {
        continue;
      }

      const kept: string = sms.text.slice(
        sms.text.indexOf("INC-21033: ") + "INC-21033: ".length,
        sms.text.lastIndexOf(`...${tail(link)}`),
      );

      expect({
        title,
        kept: Array.from(kept).length >= MIN_TITLE_CHARACTERS,
      }).toEqual({
        title,
        kept: true,
      });
    }
  });

  test("keeps at least MIN_TITLE_CHARACTERS of a title: else it takes a second part and says it all", () => {
    // A long installation name and a long address leave a title 17 characters.
    const renamed: (text: string) => string = (text: string): string => {
      return ProductBrandingUtil.replaceProductName(
        text,
        "Acme Corporation Monitoring",
      );
    };
    const title: string = "Checkout payments API is failing for every customer";
    const sms: OnCallPageSms = page({
      title: title,
      link: LONG_SELF_HOSTED_LINK,
      sentAs: renamed,
    });

    expect(sms.sent.segments).toBe(2);
    expect(sms.isTitleCut).toBe(false);
    expect(sms.isProjectLeftOut).toBe(false);
    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: ${title}.${tail(LONG_SELF_HOSTED_LINK)}`,
    );
  });

  test("a title of MIN_TITLE_CHARACTERS or fewer is never cut", () => {
    const sms: OnCallPageSms = page({
      title: "z".repeat(MIN_TITLE_CHARACTERS),
      severityName: "S".repeat(100),
      link: LONG_SELF_HOSTED_LINK,
    });

    expect(sms.isTitleCut).toBe(false);
    expect(sms.text).toContain(`: ${"z".repeat(MIN_TITLE_CHARACTERS)}.`);
    expect(sms.sent.segments).toBe(2);
  });

  test("never cuts the product, the severity, the number or the link, nor cuts the title while the project stays", () => {
    const random: SeededRandom = seededRandom(5114);
    const words: ReadonlyArray<string> = [
      "API",
      "checkout",
      "db-primary-01",
      "is",
      "down",
      "[FIRING:1]",
      "latency",
      "\u{201C}payments\u{201D}",
      "\u{2013}",
      "eu-west-1",
      "x".repeat(25),
    ];

    for (let round: number = 0; round < 1500; round++) {
      const kind: OnCallPageSmsKind = KINDS[random(KINDS.length)]!;
      const link: string = LINKS[random(LINKS.length)]!;
      let title: string = "";

      for (let index: number = random(40); index > 0; index--) {
        title += `${words[random(words.length)]} `;
      }

      const sms: OnCallPageSms = page({
        kind: kind,
        title: title,
        link: link,
        projectName: random(2) ? "Acme Production Europe" : "Acme",
      });

      expect(sms.text.startsWith(`OneUptime: ${DEFAULTS[kind].what} `)).toBe(
        true,
      );
      expect(sms.text).toContain(` ${DEFAULTS[kind].number}`);
      expect(sms.text.endsWith(tail(link))).toBe(true);

      if (sms.isTitleCut) {
        expect(sms.isProjectLeftOut).toBe(true);
        expect(sms.text).toContain(`${ON_CALL_PAGE_SMS_CUT_MARK}${tail(link)}`);
      }

      // A title in Latin letters always fits in one part.
      expect({ title, segments: sms.sent.segments }).toEqual({
        title,
        segments: 1,
      });
    }
  });

  test("every GSM-7 title of up to 500 characters fits in one part, on Cloud and on a long self-hosted address", () => {
    for (const link of [CLOUD_LINK, LONG_SELF_HOSTED_LINK]) {
      for (let length: number = 0; length <= 500; length++) {
        const sms: OnCallPageSms = page({
          title: "Checkout is down ".repeat(30).slice(0, length),
          link: link,
        });

        expect({ length, link, segments: sms.sent.segments }).toEqual({
          length,
          link,
          segments: 1,
        });
      }
    }
  });
});

describe("characters outside GSM-7", () => {
  test("a curly quote, a dash and an ellipsis are written plainly, so the page stays in one part", () => {
    const sms: OnCallPageSms = page({
      title:
        "\u{201C}Checkout\u{201D} service \u{2013} payments failing\u{2026}",
    });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: "Checkout" service - payments failing...${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.encoding).toBe(SmsEncoding.Gsm7);
    expect(sms.sent.segments).toBe(1);
  });

  test("emoji are left out", () => {
    expect(page({ title: "\u{1F525} Checkout down \u{1F525}" }).text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: Checkout down.${tail(CLOUD_LINK)}`,
    );
  });

  test("accents GSM-7 lacks go from the title, the project, the severity and the number", () => {
    const sms: OnCallPageSms = page({
      title: "Falha na integra\u{00E7}\u{00E3}o de pagamentos",
      projectName: "Produ\u{00E7}\u{00E3}o",
      severityName: "Cr\u{00ED}tico",
      number: "Inc\u{0327}-4",
    });

    expect(sms.text).toBe(
      `OneUptime: Critico incident Inc-4 in Producao: Falha na integracao de pagamentos.${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.encoding).toBe(SmsEncoding.Gsm7);
  });

  test("a title in another script is sent as written, in two UCS-2 parts", () => {
    const title: string =
      "\u{6C7A}\u{6E08}API\u{304C}\u{5FDC}\u{7B54}\u{3057}\u{307E}\u{305B}\u{3093}";
    const sms: OnCallPageSms = page({ title: title });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: ${title}.${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Ucs2,
      length: 116,
      segments: 2,
    });
  });

  test("a long title in another script is cut to fit two parts, keeping at least MIN_TITLE_CHARACTERS", () => {
    const cyrillic: string =
      "\u{0421}\u{0435}\u{0440}\u{0432}\u{0438}\u{0441} \u{043F}\u{043B}\u{0430}\u{0442}\u{0435}\u{0436}\u{0435}\u{0439} ";
    const sms: OnCallPageSms = page({ title: cyrillic.repeat(10) });

    expect(sms.sent.encoding).toBe(SmsEncoding.Ucs2);
    expect(sms.sent.segments).toBe(2);
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.text.endsWith(`...${tail(CLOUD_LINK)}`)).toBe(true);
  });

  test("a project in another script is left out, so a Latin page stays one GSM-7 part", () => {
    const sms: OnCallPageSms = page({
      projectName: "\u{672C}\u{756A}\u{74B0}\u{5883}",
    });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033: API is down.${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 102,
      segments: 1,
    });
    expect(sms.isProjectLeftOut).toBe(true);
  });

  test("a cut never parts a letter from its marks", () => {
    // Devanagari: each consonant here carries a vowel sign.
    const syllable: string = "\u{0928}\u{0947}";
    const sms: OnCallPageSms = page({ title: syllable.repeat(150) });

    expect(sms.isTitleCut).toBe(true);

    const title: string = sms.text.slice(
      sms.text.indexOf(": ", 12) + 2,
      sms.text.indexOf(`...${tail(CLOUD_LINK)}`),
    );

    expect(title.length % syllable.length).toBe(0);
    expect(title).toBe(syllable.repeat(title.length / syllable.length));
  });
});

describe("measured as sent", () => {
  test("an installation that goes by another name keeps one part: the name is counted", () => {
    const renamed: (text: string) => string = (text: string): string => {
      return ProductBrandingUtil.replaceProductName(
        text,
        "Acme Monitoring Platform",
      );
    };
    const title: string =
      "Database replication lag on db-primary-01 is above 30 seconds";
    const sms: OnCallPageSms = page({ title: title, sentAs: renamed });

    // Written with OneUptime, which the send path renames once.
    expect(sms.text.startsWith("OneUptime: ")).toBe(true);
    expect(renamed(sms.text).startsWith("Acme Monitoring Platform: ")).toBe(
      true,
    );
    expect(sms.sent).toEqual(countSmsSegments(renamed(sms.text)));
    expect(sms.sent.segments).toBe(1);
    expect(sms.sent.length).toBeLessThanOrEqual(160);
    // Unrenamed, the same title would have kept more of itself.
    expect(page({ title: title }).text.length).toBeGreaterThan(sms.text.length);
  });

  test("a title that says OneUptime is counted with the name it is renamed to", () => {
    const renamed: (text: string) => string = (text: string): string => {
      return ProductBrandingUtil.replaceProductName(
        text,
        "Acme Corporation Monitoring Platform",
      );
    };
    const title: string =
      "OneUptime probe in OneUptime region eu-west-1 is offline for OneUptime";

    // As written it would fit in one part, its title cut.
    expect(page({ title: title }).sent.segments).toBe(1);

    /*
     * Renamed, its first 20 characters alone take 47 places of the 38 left,
     * so it takes a second part - and says it all.
     */
    const sms: OnCallPageSms = page({ title: title, sentAs: renamed });

    expect(sms.sent).toEqual(countSmsSegments(renamed(sms.text)));
    expect(sms.sent.segments).toBe(2);
    expect(sms.isTitleCut).toBe(false);
    expect(renamed(sms.text)).toContain(
      "Acme Corporation Monitoring Platform region",
    );
  });
});

describe("pathological values", () => {
  test("the longest a project allows of everything still goes out, in as few parts as the rule allows", () => {
    const han: string = "\u{6C7A}";
    const sms: OnCallPageSms = page({
      title: han.repeat(500),
      projectName: han.repeat(100),
      severityName: han.repeat(100),
      number: `${han.repeat(20)}123456`,
      link: `https://${"a".repeat(200)}.example.com/l/XJlaZRsd`,
    });

    expect(sms.sent.segments).toBeLessThanOrEqual(MAX_PAGE_SMS_SEGMENTS);
    expect(
      sms.text.endsWith(
        tail(`https://${"a".repeat(200)}.example.com/l/XJlaZRsd`),
      ),
    ).toBe(true);
    expect(sms.text).toContain(han.repeat(100));
    expect(sms.text).toContain(`${han.repeat(20)}123456`);
  });

  test("when nothing fits in MAX_PAGE_SMS_SEGMENTS parts, the title keeps MIN_TITLE_CHARACTERS", () => {
    const sms: OnCallPageSms = page({
      title: "t".repeat(400),
      severityName: "\u{6C7A}".repeat(700),
    });

    expect(sms.sent.segments).toBeGreaterThan(MAX_PAGE_SMS_SEGMENTS);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.text).toContain(`: ${"t".repeat(MIN_TITLE_CHARACTERS)}...`);
  });
});

describe("titles from monitoring and from other scripts", () => {
  test("a latency in microseconds keeps the page one GSM-7 part", () => {
    const sms: OnCallPageSms = page({ title: "API p99 above 500\u{00B5}s" });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod: API p99 above 500us.${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.encoding).toBe(SmsEncoding.Gsm7);
    expect(sms.sent.segments).toBe(1);
  });

  test("a full-width exclamation mark is written plainly, and ends the sentence", () => {
    const sms: OnCallPageSms = page({
      title: "\u{652F}\u{4ED8}\u{5931}\u{8D25}\u{FF01}",
    });

    expect(sms.text).toContain(
      `\u{652F}\u{4ED8}\u{5931}\u{8D25}!${tail(CLOUD_LINK)}`,
    );
  });

  test("a temperature keeps its unit", () => {
    expect(page({ title: "Rack 3 at 40\u{2103}" }).text).toContain(
      ": Rack 3 at 40C.",
    );
  });

  test.each([
    [
      "Japanese",
      "\u{6C7A}\u{6E08}\u{304C}\u{505C}\u{6B62}\u{3057}\u{307E}\u{3057}\u{305F}\u{3002}",
    ],
    ["Chinese", "\u{652F}\u{4ED8}\u{5931}\u{8D25}\u{3002}"],
    [
      "Hindi",
      "\u{092D}\u{0941}\u{0917}\u{0924}\u{093E}\u{0928} \u{0935}\u{093F}\u{092B}\u{0932}\u{0964}",
    ],
    [
      "Arabic",
      "\u{0647}\u{0644} \u{0627}\u{0644}\u{062F}\u{0641}\u{0639} \u{0645}\u{062A}\u{0648}\u{0642}\u{0641}\u{061F}",
    ],
  ])(
    "a %s title that ends its own sentence gets no extra full stop",
    (_name: string, title: string) => {
      const sms: OnCallPageSms = page({ title: title });

      expect(sms.text).toContain(`${title}${tail(CLOUD_LINK)}`);
      expect(sms.text).not.toContain(`${title}.`);
    },
  );
});

/*
 * A PAGE AGAIN (OnCallAcknowledgementTimeout) - a policy paging again
 * because a record acknowledged a while ago is still not resolved - says so
 * after the number and the project, where a first page goes straight on to
 * the title. Those words are never cut: they are why the person is paged
 * again. Worded as a first page, the text read like a second alarm about
 * something new (#5173). Every other channel says "still not resolved" too.
 */
describe("a page again", () => {
  test("says the record is still not resolved, after the number and the project", () => {
    expect(ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED).toBe("is still not resolved");
    expect(page({ isPageAgain: true }).text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod is still not resolved: API is down.${tail(CLOUD_LINK)}`,
    );
  });

  test.each(KINDS)(
    "says it of a %s too, in one part",
    (kind: OnCallPageSmsKind) => {
      const sms: OnCallPageSms = page({
        kind: kind,
        title: "Checkout API is offline",
        isPageAgain: true,
      });

      expect(sms.text).toBe(
        `OneUptime: ${DEFAULTS[kind].what} ${DEFAULTS[kind].number} in Acme Prod is still not resolved: Checkout API is offline.${tail(CLOUD_LINK)}`,
      );
      expect(sms.sent).toEqual({
        encoding: SmsEncoding.Gsm7,
        length: sms.text.length,
        segments: 1,
      });
    },
  );

  test("a first page reads exactly as before", () => {
    const first: string = page({}).text;

    expect(page({ isPageAgain: false }).text).toBe(first);
    expect(page({ isPageAgain: undefined }).text).toBe(first);
    expect(first).not.toContain("still not resolved");
  });

  test("the docs' example is one part of GSM-7", () => {
    const sms: OnCallPageSms = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: "OneUptime",
      severityName: "Critical Incident",
      number: "INC-42",
      projectName: "Acme Prod",
      title: "Checkout API is down",
      link: CLOUD_LINK,
      isPageAgain: true,
    });

    expect(sms.text).toBe(
      "OneUptime: Critical Incident INC-42 in Acme Prod is still not resolved: Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    );
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 143,
      segments: 1,
    });
  });

  test("a record without a title, a number or a project still says it", () => {
    expect(page({ isPageAgain: true, title: "" }).text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod is still not resolved.${tail(CLOUD_LINK)}`,
    );
    expect(page({ isPageAgain: true, number: undefined }).text).toBe(
      `OneUptime: Critical Incident in Acme Prod is still not resolved: API is down.${tail(CLOUD_LINK)}`,
    );
    expect(page({ isPageAgain: true, projectName: undefined }).text).toBe(
      `OneUptime: Critical Incident INC-21033 is still not resolved: API is down.${tail(CLOUD_LINK)}`,
    );
  });

  test("its words are never cut: the project goes first, then the title is cut, as on any page", () => {
    const sms: OnCallPageSms = page({
      isPageAgain: true,
      title:
        "Checkout API is down for every customer in every region since the deploy of 10:42",
    });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 is still not resolved: Checkout API is down for every customer in${ON_CALL_PAGE_SMS_CUT_MARK}${tail(CLOUD_LINK)}`,
    );
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 157,
      segments: 1,
    });
  });

  test("on a very long address a short title still fits in one part, the project left out", () => {
    const sms: OnCallPageSms = page({
      isPageAgain: true,
      link: LONG_SELF_HOSTED_LINK,
    });

    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 is still not resolved: API is down.${tail(LONG_SELF_HOSTED_LINK)}`,
    );
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.sent.segments).toBe(1);
  });

  test("on a very long address a longer title takes a second part and says it all, as any page whose title would be cut below MIN_TITLE_CHARACTERS", () => {
    const title: string = "Checkout payments API is failing for every customer";
    const sms: OnCallPageSms = page({
      isPageAgain: true,
      title: title,
      link: LONG_SELF_HOSTED_LINK,
    });

    expect(sms.sent.segments).toBe(2);
    expect(sms.isTitleCut).toBe(false);
    expect(sms.isProjectLeftOut).toBe(false);
    expect(sms.text).toBe(
      `OneUptime: Critical Incident INC-21033 in Acme Prod is still not resolved: ${title}.${tail(LONG_SELF_HOSTED_LINK)}`,
    );
  });

  test("every GSM-7 title of up to 500 characters fits in one part on Cloud and on a self-hosted address, and in two at most on a very long one, never losing its words", () => {
    for (const link of LINKS) {
      const most: number = link === LONG_SELF_HOSTED_LINK ? 2 : 1;

      for (let length: number = 0; length <= 500; length++) {
        const sms: OnCallPageSms = page({
          title: "Checkout is down ".repeat(30).slice(0, length),
          link: link,
          isPageAgain: true,
        });

        expect({
          length,
          link,
          isWithin: sms.sent.segments <= most,
          isSaid: sms.text.startsWith(
            `OneUptime: Critical Incident INC-21033 ${sms.isProjectLeftOut ? "" : "in Acme Prod "}${ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED}`,
          ),
          isLinked: sms.text.endsWith(tail(link)),
        }).toEqual({
          length,
          link,
          isWithin: true,
          isSaid: true,
          isLinked: true,
        });
      }
    }
  });

  test("a title in another script is said to be still not resolved as well, in UCS-2", () => {
    const title: string =
      "\u{6C7A}\u{6E08}\u{304C}\u{505C}\u{6B62}\u{3057}\u{307E}\u{3057}\u{305F}\u{3002}";
    const sms: OnCallPageSms = page({ isPageAgain: true, title: title });

    expect(sms.text).toContain(
      ` ${ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED}: ${title}${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.encoding).toBe(SmsEncoding.Ucs2);
  });
});

describe("a page a person asked for", () => {
  test("says who paged whom after the product, before what happened", () => {
    expect(page({ lead: "Alice Kim paged Platform" }).text).toBe(
      `OneUptime: Alice Kim paged Platform about Critical Incident INC-21033 in Acme Prod: API is down.${tail(CLOUD_LINK)}`,
    );
  });

  test.each(KINDS)(
    "says it of a %s too, in one part",
    (kind: OnCallPageSmsKind) => {
      const sms: OnCallPageSms = page({
        kind: kind,
        title: "Checkout API is offline",
        lead: "Alice Kim paged you",
      });

      expect(sms.text).toBe(
        `OneUptime: Alice Kim paged you about ${DEFAULTS[kind].what} ${DEFAULTS[kind].number} in Acme Prod: Checkout API is offline.${tail(CLOUD_LINK)}`,
      );
      expect(sms.sent.segments).toBe(1);
    },
  );

  test("the docs' example is one part of GSM-7", () => {
    const sms: OnCallPageSms = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: "OneUptime",
      severityName: "Critical Incident",
      number: "INC-42",
      projectName: "Acme Prod",
      title: "Checkout API is down",
      link: CLOUD_LINK,
      lead: "Alice Kim paged Platform",
    });

    expect(sms.text).toBe(
      "OneUptime: Alice Kim paged Platform about Critical Incident INC-42 in Acme Prod: Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd",
    );
    expect(sms.sent).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: 152,
      segments: 1,
    });
  });

  test("every other page reads exactly as before", () => {
    const first: string = page({}).text;

    expect(page({ lead: "" }).text).toBe(first);
    expect(page({ lead: undefined }).text).toBe(first);
    expect(page({ lead: null }).text).toBe(first);
    expect(page({ lead: "   " }).text).toBe(first);
    expect(first).not.toContain("paged");
  });

  test("who paged is never cut: the project goes first, then the title is cut, as on any page", () => {
    const sms: OnCallPageSms = page({
      lead: "Alice Kim paged Platform",
      title:
        "Checkout API is down for every customer in every region since the deploy of 10:42",
    });
    const head: string =
      "OneUptime: Alice Kim paged Platform about Critical Incident INC-21033: ";

    expect(sms.text.slice(0, head.length)).toBe(head);
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.text).toContain(
      `${ON_CALL_PAGE_SMS_CUT_MARK}${tail(CLOUD_LINK)}`,
    );
    expect(sms.sent.segments).toBe(1);
  });

  test("names are written in the characters an SMS carries cheaply, on one line", () => {
    const sms: OnCallPageSms = page({
      lead: "Ana \u{201C}Ops\u{201D} Mar\u{00E7}al \u{1F525}\npaged Platform",
    });
    const head: string = 'OneUptime: Ana "Ops" Marcal paged Platform about ';

    expect(sms.text.slice(0, head.length)).toBe(head);
    expect(sms.sent.encoding).toBe(SmsEncoding.Gsm7);
  });

  test("every GSM-7 title of up to 500 characters fits in one part on Cloud, and in two at most on a self-hosted address, never losing who paged", () => {
    const head: string =
      "OneUptime: Alice Kim paged Platform about Critical Incident INC-21033";

    for (const link of LINKS) {
      const most: number = link === CLOUD_LINK ? 1 : 2;

      for (let length: number = 0; length <= 500; length++) {
        const sms: OnCallPageSms = page({
          title: "Checkout is down ".repeat(30).slice(0, length),
          link: link,
          lead: "Alice Kim paged Platform",
        });

        expect({
          length,
          link,
          isWithin: sms.sent.segments <= most,
          isSaid: sms.text.slice(0, head.length) === head,
          isLinked: sms.text.endsWith(tail(link)),
        }).toEqual({
          length,
          link,
          isWithin: true,
          isSaid: true,
          isLinked: true,
        });
      }
    }
  });
});
