import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import {
  GSM_7_LOOK_ALIKES,
  toGsm7Message,
  toGsm7Text,
  toOneLine,
} from "../../../Utils/Sms/Gsm7Text";
import {
  GSM_7_BASIC_CHARACTERS,
  GSM_7_EXTENSION_CHARACTERS,
  isGsm7Text,
} from "../../../Utils/Sms/SmsSegments";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * TEXT WRITTEN IN THE CHARACTERS AN SMS CARRIES CHEAPLY (Utils/Sms/Gsm7Text).
 *
 * One character outside GSM-7 makes a whole SMS UCS-2, at 70 characters a
 * part instead of 160. The text OneUptime writes to a team member uses a
 * plain look-alike wherever a character has one, leaves out emoji,
 * invisible formatting and symbols with none, and keeps the letters of
 * other scripts exactly as written. Characters are written as \u{...}
 * escapes so the test reads the same in every editor.
 */

describe("the look-alikes", () => {
  test("are each written in GSM-7's characters", () => {
    for (const [character, lookAlike] of GSM_7_LOOK_ALIKES) {
      expect({ character, isGsm7: isGsm7Text(lookAlike) }).toEqual({
        character,
        isGsm7: true,
      });
    }
  });

  test("never replace a character GSM-7 has", () => {
    for (const character of GSM_7_LOOK_ALIKES.keys()) {
      expect({ character, isGsm7: isGsm7Text(character) }).toEqual({
        character,
        isGsm7: false,
      });
    }
  });
});

describe("toGsm7Text: punctuation and spaces", () => {
  test.each([
    [
      "curly double quotes",
      "\u{201C}Checkout\u{201D} is down",
      '"Checkout" is down',
    ],
    ["curly single quotes", "\u{2018}api\u{2019}s queue", "'api's queue"],
    [
      "low quotes",
      "\u{201E}Zahlung\u{201C} fehlgeschlagen",
      '"Zahlung" fehlgeschlagen',
    ],
    [
      "guillemets",
      "\u{00AB}Paiements\u{00BB} en panne",
      '"Paiements" en panne',
    ],
    ["a backtick", "`checkout` crashed", "'checkout' crashed"],
    ["an acute accent as an apostrophe", "it\u{00B4}s down", "it's down"],
    ["primes", "5\u{2032} 6\u{2033}", "5' 6\""],
    ["an en dash", "API \u{2013} down", "API - down"],
    ["an em dash", "API\u{2014}down", "API-down"],
    ["a figure dash", "555\u{2012}0100", "555-0100"],
    ["a minus sign", "\u{2212}5 dB", "-5 dB"],
    ["a non-breaking hyphen", "e\u{2011}mail", "e-mail"],
    ["an ellipsis", "Waiting\u{2026}", "Waiting..."],
    ["a bullet", "db-1 \u{2022} db-2", "db-1 - db-2"],
    ["a middle dot", "eu \u{00B7} us", "eu - us"],
    ["a non-breaking space", "10\u{00A0}GB", "10 GB"],
    ["a thin space", "10\u{2009}ms", "10 ms"],
    ["a narrow no-break space", "10\u{202F}%", "10 %"],
    ["an ideographic space", "a\u{3000}b", "a b"],
    ["a tab", "a\tb", "a b"],
    ["a fraction slash", "1\u{2044}2", "1/2"],
  ])("%s", (_name: string, text: string, written: string) => {
    expect(toGsm7Text(text)).toBe(written);
    expect(isGsm7Text(toGsm7Text(text))).toBe(true);
  });

  test("keeps line breaks, which GSM-7 has", () => {
    expect(toGsm7Text("one\ntwo\r\nthree")).toBe("one\ntwo\r\nthree");
  });
});

describe("toGsm7Text: arithmetic, arrows and signs", () => {
  test.each([
    ["3 \u{00D7} 4", "3 x 4"],
    ["10 \u{00F7} 2", "10 / 2"],
    ["\u{00B1}5%", "+/-5%"],
    ["p99 \u{2264} 200 ms", "p99 <= 200 ms"],
    ["CPU \u{2265} 90%", "CPU >= 90%"],
    ["a \u{2260} b", "a != b"],
    ["\u{2248} 3 s", "~ 3 s"],
    ["eu \u{2192} us", "eu -> us"],
    ["eu \u{2190} us", "eu <- us"],
    ["eu \u{2194} us", "eu <-> us"],
    ["a \u{21D2} b", "a => b"],
    ["Acme\u{00A9}", "Acme(c)"],
    ["Acme\u{00AE}", "Acme(R)"],
    ["Acme\u{2122} Cloud", "AcmeTM Cloud"],
    ["Down\u{203C}", "Down!!"],
    ["Down\u{2049}", "Down!?"],
  ])("%j is written %j", (text: string, written: string) => {
    expect(toGsm7Text(text)).toBe(written);
  });
});

describe("toGsm7Text: letters", () => {
  test("keeps every character GSM-7 has, exactly", () => {
    const gsm7: string = `${GSM_7_BASIC_CHARACTERS}${GSM_7_EXTENSION_CHARACTERS}`;

    expect(toGsm7Text(gsm7)).toBe(gsm7);
  });

  test.each([
    ["Portuguese", "Falha na integra\u{00E7}\u{00E3}o", "Falha na integracao"],
    [
      "Spanish",
      "Ca\u{00ED}da del servicio de facturaci\u{00F3}n",
      "Caida del servicio de facturacion",
    ],
    [
      "French, keeping the accents GSM-7 has",
      "Cr\u{00E8}me br\u{00FB}l\u{00E9}e \u{00E0} l\u{2019}h\u{00F4}tel",
      "Cr\u{00E8}me brul\u{00E9}e \u{00E0} l'hotel",
    ],
    [
      "German, all GSM-7 already",
      "St\u{00F6}rung: \u{00DC}berlast im Gro\u{00DF}handel",
      "St\u{00F6}rung: \u{00DC}berlast im Gro\u{00DF}handel",
    ],
    [
      "Polish",
      "\u{0141}\u{00F3}d\u{017A}: awaria p\u{0142}atno\u{015B}ci",
      "Lodz: awaria platnosci",
    ],
    ["Czech", "V\u{00FD}padek \u{0159}\u{00ED}zen\u{00ED}", "Vypadek rizeni"],
    [
      "Romanian",
      "Eroare la pl\u{0103}\u{021B}i \u{0219}i facturi",
      "Eroare la plati si facturi",
    ],
    [
      "Turkish",
      "\u{0130}stanbul \u{00F6}deme hatas\u{0131} \u{011F}\u{015F}",
      "Istanbul \u{00F6}deme hatasi gs",
    ],
    ["Hungarian", "Hossz\u{00FA} v\u{00E1}laszid\u{0151}", "Hosszu valaszido"],
    [
      "Vietnamese",
      "\u{0110}\u{00E0} N\u{1EB5}ng: l\u{1ED7}i thanh to\u{00E1}n",
      "D\u{00E0} Nang: loi thanh toan",
    ],
    [
      "Icelandic",
      "\u{00DE}j\u{00F3}nusta \u{00ED} ve\u{00F0}ri",
      "Thjonusta i vedri",
    ],
    [
      "Danish and Norwegian, all GSM-7 already",
      "\u{00C6}r\u{00F8}sk\u{00F8}bing \u{00E5}bner",
      "\u{00C6}r\u{00F8}sk\u{00F8}bing \u{00E5}bner",
    ],
    ["a ligature", "\u{0153}uvre \u{FB01}le", "oeuvre file"],
    ["a capital sharp s", "STRA\u{1E9E}E", "STRASSE"],
  ])("%s", (_name: string, text: string, written: string) => {
    expect(toGsm7Text(text)).toBe(written);
    expect(isGsm7Text(toGsm7Text(text))).toBe(true);
  });

  test("an accent typed as its own character is joined to its letter first", () => {
    // e and a combining acute make the é GSM-7 has; a and one make a.
    expect(toGsm7Text("Cafe\u{0301} pagamentos\u{0301}")).toBe(
      "Caf\u{00E9} pagamentos",
    );
    // q with a tilde has no precomposed form: the mark goes, as on any letter.
    expect(toGsm7Text("q\u{0303}")).toBe("q");
  });

  test.each([
    ["full-width letters", "\u{FF21}\u{FF30}\u{FF29}", "API"],
    ["a superscript", "10 m\u{00B2}", "10 m2"],
    ["a vulgar fraction", "\u{00BD} full", "1/2 full"],
    ["a numero sign", "\u{2116}5", "No5"],
    ["a roman numeral", "Phase \u{2163}", "Phase IV"],
    ["a circled digit", "Step \u{2460}", "Step 1"],
    ["bold maths letters", "\u{1D401}\u{1D41E}\u{1D41A}\u{1D420}", "Beag"],
    ["a unit", "5 \u{338F}", "5 kg"],
  ])(
    "%s are written as what they stand for",
    (_name: string, text: string, written: string) => {
      expect(toGsm7Text(text)).toBe(written);
    },
  );

  test.each([
    ["a fraction", "Disk at 1\u{00BD} TB", "Disk at 1 1/2 TB"],
    ["a fraction of several digits", "12\u{00BE} hours", "12 3/4 hours"],
    ["a power", "10\u{00B2} requests", "10^2 requests"],
    [
      "a negative power",
      "Error rate above 10\u{207B}\u{00B3}",
      "Error rate above 10^-3",
    ],
    ["a power of several digits", "2\u{00B9}\u{2070} bytes", "2^10 bytes"],
  ])(
    "%s after a digit stays apart from the number, never read as more of it",
    (_name: string, text: string, written: string) => {
      expect(toGsm7Text(text)).toBe(written);
      expect(isGsm7Text(toGsm7Text(text))).toBe(true);
    },
  );

  test("a fraction or a superscript after a space or a letter is written as before", () => {
    expect(toGsm7Text("1 \u{00BD} full")).toBe("1 1/2 full");
    expect(toGsm7Text("m\u{00B2} and x\u{00B3}")).toBe("m2 and x3");
    expect(toGsm7Text("\u{00BC} done")).toBe("1/4 done");
  });
});

describe("toGsm7Text: what is left out", () => {
  test.each([
    ["an emoji", "\u{1F525} Checkout down \u{1F525}", " Checkout down "],
    ["an emoji with a skin tone", "Approved \u{1F44D}\u{1F3FD}", "Approved "],
    [
      "a family joined by joiners",
      "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} team",
      " team",
    ],
    ["a flag", "\u{1F1E9}\u{1F1EA} region", " region"],
    [
      "a warning sign with its selector",
      "\u{26A0}\u{FE0F} Disk 90%",
      " Disk 90%",
    ],
    ["a check mark", "\u{2705} done", " done"],
    ["a degree sign", "40\u{00B0}C", "40C"],
    ["a currency GSM-7 lacks", "Over \u{20B9}5000", "Over 5000"],
    ["a zero-width space", "data\u{200B}base", "database"],
    ["a soft hyphen", "data\u{00AD}base", "database"],
    ["a byte order mark", "\u{FEFF}Checkout", "Checkout"],
    [
      "direction marks and isolates",
      "\u{200E}a\u{200F}b\u{2066}c\u{2069}",
      "abc",
    ],
    ["control characters", "a\u{0000}b\u{0007}c\u{000B}d", "abcd"],
    ["a joiner between Latin letters", "a\u{200C}b\u{200D}c", "abc"],
    [
      "an icon font's private-use glyph",
      "\u{E001} Checkout down",
      " Checkout down",
    ],
    [
      "a private-use glyph of the planes above",
      "Disk \u{F0001}full",
      "Disk full",
    ],
    ["half of a surrogate pair standing alone", "data\u{D800}base", "database"],
    ["a mark with nothing written before it", "\u{0301}Checkout", "Checkout"],
    ["a mark after a left-out emoji", "\u{1F525}\u{0301} down", " down"],
  ])("%s", (_name: string, text: string, written: string) => {
    expect(toGsm7Text(text)).toBe(written);
    expect(isGsm7Text(toGsm7Text(text))).toBe(true);
  });

  test("a keycap keeps its digit", () => {
    expect(toGsm7Text("Press 1\u{FE0F}\u{20E3}")).toBe("Press 1");
    expect(toGsm7Text("#\u{FE0F}\u{20E3}")).toBe("#");
  });

  test("a sign GSM-7 has as an emoji keeps its look-alike, not dropped", () => {
    expect(toGsm7Text("\u{00A9}\u{FE0F}")).toBe("(c)");
  });
});

describe("toGsm7Text: letters of other scripts are kept as written", () => {
  test.each([
    [
      "Japanese",
      "\u{6C7A}\u{6E08}API\u{304C}\u{5FDC}\u{7B54}\u{3057}\u{307E}\u{305B}\u{3093}\u{3002}",
    ],
    ["Chinese", "\u{652F}\u{4ED8}\u{670D}\u{52A1}\u{4E0D}\u{53EF}\u{7528}"],
    ["Korean", "\u{acb0}\u{c81c} \u{c11c}\u{bc84} \u{c7a5}\u{c560}"],
    [
      "Russian, with its \u{0439}",
      "\u{0421}\u{0435}\u{0440}\u{0432}\u{0438}\u{0441} \u{043D}\u{0435}\u{0434}\u{043E}\u{0441}\u{0442}\u{0443}\u{043F}\u{0435}\u{043D}, \u{0439}",
    ],
    [
      "Greek, with its accents",
      "\u{0394}\u{03BF}\u{03BA}\u{03B9}\u{03BC}\u{03AE}",
    ],
    [
      "Hindi, with its marks",
      "\u{0928}\u{092E}\u{0938}\u{094D}\u{0924}\u{0947}",
    ],
    ["Arabic", "\u{0627}\u{0644}\u{062E}\u{062F}\u{0645}\u{0629}"],
    ["Hebrew", "\u{05E9}\u{05D9}\u{05E8}\u{05D5}\u{05EA}"],
    [
      "Persian, with the non-joiner between its letters",
      "\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}",
    ],
    [
      "Devanagari, with a joiner between its letters",
      "\u{0915}\u{094D}\u{200D}\u{0937}",
    ],
  ])("%s", (_name: string, text: string) => {
    expect(toGsm7Text(text)).toBe(text);
    expect(isGsm7Text(toGsm7Text(text))).toBe(false);
  });

  test("and the Latin around them is still written plainly", () => {
    expect(
      toGsm7Text("\u{201C}API\u{201D} \u{2013} \u{6C7A}\u{6E08}\u{2026}"),
    ).toBe('"API" - \u{6C7A}\u{6E08}...');
  });
});

describe("toGsm7Text on texts drawn at random", () => {
  const LATIN_PIECES: ReadonlyArray<string> = [
    "a",
    "Z",
    " ",
    "9",
    "\u{00E9}",
    "\u{00E7}",
    "\u{00E3}",
    "\u{0142}",
    "\u{0151}",
    "\u{201C}",
    "\u{2019}",
    "\u{2013}",
    "\u{2026}",
    "\u{00A0}",
    "\u{1F525}",
    "\u{1F44D}\u{1F3FD}",
    "\u{200B}",
    "\u{00B0}",
    "\u{2192}",
    "\u{FB01}",
    "e\u{0301}",
    "{",
    "\u{20AC}",
    "`",
    "\t",
  ];

  const texts: Array<string> = generatedTexts(3000, 5114, LATIN_PIECES, 40);

  test("a text in Latin letters, whatever it holds, comes out in GSM-7", () => {
    for (const text of texts) {
      expect({ text, isGsm7: isGsm7Text(toGsm7Text(text)) }).toEqual({
        text,
        isGsm7: true,
      });
    }
  });

  test("writing a text a second time changes nothing", () => {
    for (const text of texts) {
      const once: string = toGsm7Text(text);

      expect(toGsm7Text(once)).toBe(once);
    }
  });

  test("a GSM-7 text is written exactly as it is", () => {
    const gsm7Pieces: Array<string> = Array.from(
      `${GSM_7_BASIC_CHARACTERS}${GSM_7_EXTENSION_CHARACTERS}`,
    );

    for (const text of generatedTexts(3000, 160, gsm7Pieces, 60)) {
      expect(toGsm7Text(text)).toBe(text);
    }
  });

  test("400,000 characters of its slowest kinds take well under two seconds", () => {
    const worst: string = "\u{00E3}\u{1F525}\u{200D}\u{6C7A}e\u{0301}".repeat(
      80000,
    );
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const written: FastestRun<string> = fastestRun({
      run: (): string => {
        return toGsm7Text(worst);
      },
      limitInMs: 2000,
    });

    expect(written.result.length).toBeGreaterThan(0);
    expect(written.inMs).toBeLessThan(2000);
  });
});

describe("toOneLine", () => {
  test.each([
    ["  Checkout \n API\t is\r\ndown  ", "Checkout API is down"],
    ["", ""],
    [" \n\t ", ""],
    ["a\u{00A0}\u{00A0}b", "a b"],
    ["a\u{2028}b", "a b"],
    ["one", "one"],
  ])("%j is %j", (text: string, line: string) => {
    expect(toOneLine(text)).toBe(line);
  });
});

describe("toGsm7Message", () => {
  test("writes the words plainly and the links exactly as they are", () => {
    expect(
      toGsm7Message(
        "\u{201C}Checkout\u{201D} is down: https://status.example.com/l/\u{00E9}\u{0151}?q=\u{2019}x",
      ),
    ).toBe(
      '"Checkout" is down: https://status.example.com/l/\u{00E9}\u{0151}?q=\u{2019}x',
    );
  });

  test("knows a link in brackets or quotes, and one written in capitals", () => {
    const link: string = "https://\u{00E9}xample.com/\u{0151}";

    expect(toGsm7Message(`See (${link}).`)).toBe(`See (${link}).`);
    expect(toGsm7Message(`See "${link}"`)).toBe(`See "${link}"`);
    expect(toGsm7Message("HTTP://EXAMPLE.COM/\u{0151}")).toBe(
      "HTTP://EXAMPLE.COM/\u{0151}",
    );
  });

  test("keeps line breaks and writes other spaces as spaces", () => {
    expect(toGsm7Message("a\nb\u{00A0}c\td")).toBe("a\nb c d");
  });

  test("is toGsm7Text for a message without links, with no space left where a character went", () => {
    const text: string =
      "\u{201C}Caf\u{00E9}\u{201D} \u{2013} 40\u{00B0}C \u{1F525}";

    expect(toGsm7Text(text)).toBe('"Caf\u{00E9}" - 40C ');
    expect(toGsm7Message(text)).toBe('"Caf\u{00E9}" - 40C');
  });

  test.each([
    [
      "an emoji between words",
      "Monitor \u{1F525} API is down",
      "Monitor API is down",
    ],
    ["an emoji first", "\u{1F525} API is down", "API is down"],
    [
      "an emoji last on a line",
      "API is down \u{1F525}\nNext line",
      "API is down\nNext line",
    ],
    ["a run of spaces", "API  is   down", "API is down"],
    ["spaces at the ends", "  API is down  ", "API is down"],
    ["spaces around a line break", "one \n two", "one\ntwo"],
    ["a word written as words", "5 \u{2030} errors", "5 per mille errors"],
  ])(
    "leaves single spaces: %s",
    (_name: string, text: string, written: string) => {
      expect(toGsm7Message(text)).toBe(written);
    },
  );

  test("400,000 characters of spaces, line breaks and emoji take well under two seconds", () => {
    const worst: string = " \n \u{1F525} a".repeat(65000);
    /*
     * The fastest of up to three attempts, as every test of time that grows
     * with the text: one timing on a busy runner overran by 39 ms on master
     * (2026-10-24) for code that had not changed.
     */
    const written: FastestRun<string> = fastestRun({
      run: (): string => {
        return toGsm7Message(worst);
      },
      limitInMs: 2000,
    });

    expect(written.result.length).toBeGreaterThan(0);
    expect(written.result).not.toContain("  ");
    expect(written.inMs).toBeLessThan(2000);
  });
});

describe("toGsm7Text: units", () => {
  test.each([
    ["a micro sign", "p99 above 500\u{00B5}s", "p99 above 500us"],
    ["a Greek mu after a number", "p99 above 500\u{03BC}s", "p99 above 500us"],
    [
      "a Greek mu after a number and a space",
      "a 5 \u{03BC}m gap",
      "a 5 um gap",
    ],
    [
      "degrees Celsius as one character",
      "40\u{2103} on rack 3",
      "40C on rack 3",
    ],
    ["degrees Fahrenheit as one character", "104\u{2109}", "104F"],
    ["a cent sign", "5\u{00A2} a call", "5c a call"],
    ["a per mille sign", "5\u{2030}", "5 per mille"],
  ])("%s", (_name: string, text: string, written: string) => {
    expect(toGsm7Text(text)).toBe(written);
    expect(isGsm7Text(toGsm7Text(text))).toBe(true);
  });

  test("a Greek mu in a Greek word stays a letter", () => {
    const word: string = "\u{03BC}\u{03AE}\u{03BD}\u{03C5}\u{03BC}\u{03B1}";

    expect(toGsm7Text(word)).toBe(word);
    expect(toGsm7Text(`\u{03BC}s`)).toBe("\u{03BC}s");
    expect(toGsm7Text(`500\u{03BC}`)).toBe("500\u{03BC}");
  });
});
