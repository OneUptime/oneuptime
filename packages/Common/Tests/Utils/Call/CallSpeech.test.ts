import {
  CALL_SPEECH_CUT_MARK,
  CALL_TITLE_MAX_LENGTH,
  ONEUPTIME_SPOKEN_NAME,
  SpeechPart,
  cutForSpeech,
  getRecordNumberSpeech,
  getSpeechCharacters,
  getSpeechParts,
  isSsmlVoice,
  renderSpeechAsText,
  spellOut,
  toSpokenText,
  toTwimlText,
} from "../../../Utils/Call/CallSpeech";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A CALL SAYS ITS WORDS (#10762).
 *
 * A call's words are text people read too - the call's log, a gateway - and
 * the voice that speaks them reads some wrong: "INC-42" is "Incorporated 42".
 * And TwiML has no room for some characters: Twilio's own builder throws on
 * a control character, and the call is never placed. These hold the helpers
 * that turn the written words into what the voice is given to their word:
 * text TwiML can carry, a title cut for speech at a word boundary, a
 * record's number spelled, the product's name said as two words, and SSML
 * only for a voice that reads it.
 */

// What a Twilio TwiML document makes of a text, or the error its builder throws.
function twimlOf(text: string): string {
  const response: VoiceResponse = new VoiceResponse();
  response.say(text);
  return response.toString();
}

describe("text a call's TwiML can carry", () => {
  test("text as it is: words, punctuation, spacing, line breaks", () => {
    expect(toTwimlText("Checkout API is down.")).toBe("Checkout API is down.");
    // A verification code is read slower for its spacing.
    expect(toTwimlText("1  2  3  4")).toBe("1  2  3  4");
    expect(toTwimlText("tab\there\nand\r\nthere")).toBe(
      "tab\there\nand\r\nthere",
    );
  });

  test("XML's own characters are left for the builder to escape, never dropped", () => {
    const text: string = `<Say> & "quotes" 'apos' </Say><Dial>+19005550100</Dial>`;

    expect(toTwimlText(text)).toBe(text);
  });

  test("a control character becomes a space, where Twilio's builder threw", () => {
    for (const control of ["\u0000", "\u0001", "\u0008", "\u000b", "\u000c"]) {
      const text: string = `Disk${control}full`;

      expect(() => {
        return twimlOf(text);
      }).toThrow("Invalid character in string");
      expect(toTwimlText(text)).toBe("Disk full");
      expect(() => {
        return twimlOf(toTwimlText(text));
      }).not.toThrow();
    }
  });

  test("DEL and the C1 controls, which no voice says, become spaces", () => {
    expect(toTwimlText("a\u007fb\u0085c\u009bd")).toBe("a b c d");
  });

  test("a terminal colour code from a log line goes whole", () => {
    const title: string = "\u001b[1;31mERROR\u001b[0m disk /var is full";

    expect(() => {
      return twimlOf(title);
    }).toThrow("Invalid character in string");
    expect(toTwimlText(title)).toBe("ERROR disk /var is full");
  });

  test("a lone surrogate - half of an emoji a cut split - becomes a space", () => {
    expect(toTwimlText("cut \ud83d here")).toBe("cut   here");
    expect(toTwimlText("cut \ude00 here")).toBe("cut   here");
    expect(() => {
      return twimlOf("cut \ud83d here");
    }).toThrow("Invalid character in string");
  });

  test("an emoji, whole, is kept", () => {
    expect(toTwimlText("🔥 Checkout down 👩‍👩‍👧 🇯🇵")).toBe(
      "🔥 Checkout down 👩‍👩‍👧 🇯🇵",
    );
  });

  test("U+FFFE and U+FFFF, which XML has no place for, become spaces; other astral characters stay", () => {
    expect(toTwimlText("a￾b￿c")).toBe("a b c");
    expect(toTwimlText("a\u{1fffe}b")).toBe("a\u{1fffe}b");
  });

  test("right-to-left marks and isolates, which XML allows, are kept", () => {
    const title: string = "‫الخدمة متوقفة‬ ⁧עברית⁩";

    expect(toTwimlText(title)).toBe(title);
  });

  test("anything that is not text is no words", () => {
    expect(toTwimlText(undefined)).toBe("");
    expect(toTwimlText(null)).toBe("");
    expect(toTwimlText(42)).toBe("");
    expect(toTwimlText({ sayMessage: "x" })).toBe("");
  });

  test("whatever the text, Twilio's builder takes what is left of it", () => {
    const codePoints: Array<number> = [];

    for (let codePoint: number = 0; codePoint <= 0x2fff; codePoint++) {
      codePoints.push(codePoint);
    }

    for (let codePoint: number = 0xd700; codePoint <= 0xe0ff; codePoint++) {
      codePoints.push(codePoint);
    }

    for (let codePoint: number = 0xfff0; codePoint <= 0xffff; codePoint++) {
      codePoints.push(codePoint);
    }

    codePoints.push(0x1f600, 0x1fffe, 0x1ffff, 0x10fffd, 0x10ffff);

    for (const codePoint of codePoints) {
      const text: string = `a${String.fromCodePoint(codePoint)}b`;

      expect(() => {
        return twimlOf(toTwimlText(text));
      }).not.toThrow();
    }
  });
});

describe("the product's name, as the voice says it", () => {
  test("OneUptime is said as two words", () => {
    expect(toSpokenText("This is a call from OneUptime.")).toBe(
      `This is a call from ${ONEUPTIME_SPOKEN_NAME}.`,
    );
    expect(ONEUPTIME_SPOKEN_NAME).toBe("One Uptime");
    expect(toSpokenText("OneUptime's page. Open OneUptime")).toBe(
      "One Uptime's page. Open One Uptime",
    );
  });

  test("only as a word: an identifier, an address or another name is left alone", () => {
    expect(toSpokenText("OneUptimeReplay")).toBe("OneUptimeReplay");
    expect(toSpokenText("https://oneuptime.example")).toBe(
      "https://oneuptime.example",
    );
    expect(toSpokenText("This is a call from Acme.")).toBe(
      "This is a call from Acme.",
    );
  });

  test("in characters TwiML can carry too", () => {
    expect(toSpokenText("OneUptime\u0001down")).toBe("One Uptime down");
  });
});

describe("which voices read SSML", () => {
  test("Amazon Polly's and Google's, standard or neural", () => {
    for (const voice of [
      "Polly.Joanna",
      "Polly.Joanna-Neural",
      "Google.en-US-Standard-C",
      "Google.en-US-Neural2-F",
      " polly.matthew ",
    ]) {
      expect(isSsmlVoice(voice)).toBe(true);
    }
  });

  test("not the account's default - no voice named - nor Twilio's Basic voices, nor one that reads no say-as", () => {
    for (const voice of [
      undefined,
      null,
      "",
      "man",
      "woman",
      "alice",
      "Polly",
      "ElevenLabs.UgBBYS2sOqTuMpoF3BR0",
    ]) {
      expect(isSsmlVoice(voice)).toBe(false);
    }
  });
});

describe("a title cut for speech, at about 100 characters", () => {
  test("a title that fits is said whole, on one line", () => {
    expect(cutForSpeech("Checkout API is down")).toBe("Checkout API is down");
    expect(cutForSpeech("  Checkout\n  API\t\tis   down  ")).toBe(
      "Checkout API is down",
    );
    expect(CALL_TITLE_MAX_LENGTH).toBe(100);
  });

  test("exactly at the limit: said whole", () => {
    const title: string = `${"word ".repeat(19)}abcd`;

    expect(title.length).toBe(CALL_TITLE_MAX_LENGTH - 1);
    expect(cutForSpeech(`${title}e`)).toBe(`${title}e`);
    expect(cutForSpeech(`${title}e`).length).toBe(CALL_TITLE_MAX_LENGTH);
  });

  test("one character over: cut at the last whole word, the mark included in the limit", () => {
    const title: string = `${"word ".repeat(20)}x`;
    const cut: string = cutForSpeech(title);

    expect(title.length).toBe(101);
    expect(cut).toBe(`${"word ".repeat(19)}word${CALL_SPEECH_CUT_MARK}`);
    expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
      CALL_TITLE_MAX_LENGTH,
    );
  });

  test("a 500-character title is cut after a whole word, never inside one", () => {
    const title: string =
      "Checkout API p95 latency above 2 seconds for customers in Europe after the payments deploy; retries are failing and the queue is backing up. ".repeat(
        4,
      );
    const cut: string = cutForSpeech(title);

    expect(title.length).toBeGreaterThan(500);
    expect(cut.endsWith(CALL_SPEECH_CUT_MARK)).toBe(true);
    expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
      CALL_TITLE_MAX_LENGTH,
    );

    const said: string = cut.slice(0, -CALL_SPEECH_CUT_MARK.length);
    const words: Array<string> = said.split(" ");

    expect(title.startsWith(said)).toBe(true);
    // The last word said is a whole word of the title.
    expect(title).toContain(`${words[words.length - 1]} `);
    expect(said).toBe(
      "Checkout API p95 latency above 2 seconds for customers in Europe after the payments deploy; retries",
    );
  });

  test("no spaces at all: cut between two characters, so its first part is still said", () => {
    const title: string = "a".repeat(250);

    expect(cutForSpeech(title)).toBe(`${"a".repeat(99)}${CALL_SPEECH_CUT_MARK}`);
  });

  test("a word boundary only near the start is not used: it would leave almost nothing", () => {
    const title: string = `Hi ${"y".repeat(200)}`;

    expect(cutForSpeech(title)).toBe(
      `Hi ${"y".repeat(96)}${CALL_SPEECH_CUT_MARK}`,
    );
  });

  test("no punctuation or space dangles before the mark", () => {
    // After the words that fit: the comma and dash after them are not said.
    expect(cutForSpeech(`${"x".repeat(60)}, - ( ${"y".repeat(80)}`, 70)).toBe(
      `${"x".repeat(60)}${CALL_SPEECH_CUT_MARK}`,
    );
    // Cut between two characters, in a run of dashes: none is left before the mark.
    expect(cutForSpeech(`${"x".repeat(30)} ${"-".repeat(100)}`)).toBe(
      `${"x".repeat(30)}${CALL_SPEECH_CUT_MARK}`,
    );
  });

  test("an emoji is never split: a family, a flag, a skin tone stay whole", () => {
    for (const emoji of ["👩‍👩‍👧", "🇯🇵", "👍🏽", "🏳️‍🌈"]) {
      const title: string = `${emoji}`.repeat(120);
      const cut: string = cutForSpeech(title);
      const said: string = cut.slice(0, -CALL_SPEECH_CUT_MARK.length);

      expect(getSpeechCharacters(said)).toEqual(
        Array.from({ length: getSpeechCharacters(said).length }, () => {
          return emoji;
        }),
      );
      expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
        CALL_TITLE_MAX_LENGTH,
      );
    }
  });

  test("a letter with its accents is never split from them", () => {
    const title: string = "é".repeat(150);
    const said: string = cutForSpeech(title).slice(
      0,
      -CALL_SPEECH_CUT_MARK.length,
    );

    expect(said).toBe("é".repeat(99));
  });

  test("Chinese and Japanese, written without spaces, are cut between words", () => {
    const chinese: string = "数据库连接失败，服务不可用，正在切换到备用节点。".repeat(6);
    const cut: string = cutForSpeech(chinese);
    const said: string = cut.slice(0, -CALL_SPEECH_CUT_MARK.length);

    expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
      CALL_TITLE_MAX_LENGTH,
    );
    expect(chinese.startsWith(said)).toBe(true);
    // Between words: what comes next starts a word Intl.Segmenter finds.
    const words: Array<string> = Array.from(
      new (Intl as unknown as {
        Segmenter: new (
          locale: string,
          options: { granularity: string },
        ) => { segment: (text: string) => Iterable<{ index: number }> };
      }).Segmenter("zh", { granularity: "word" }).segment(chinese),
      (segment: { index: number }): number => {
        return segment.index;
      },
    ).map((index: number): string => {
      return chinese.slice(0, index);
    });

    expect(words).toContain(said);
    // No comma or full stop dangles before the mark.
    expect(said.endsWith("，")).toBe(false);
    expect(said.endsWith("。")).toBe(false);

    const japanese: string = "データベースの接続に失敗しました。".repeat(10);
    const japaneseSaid: string = cutForSpeech(japanese).slice(
      0,
      -CALL_SPEECH_CUT_MARK.length,
    );

    expect(japanese.startsWith(japaneseSaid)).toBe(true);
    expect(japaneseSaid.length).toBeLessThan(CALL_TITLE_MAX_LENGTH);
  });

  test("right-to-left titles are cut at a word boundary, the mark at their logical end", () => {
    const arabic: string = "الخدمة متوقفة للعملاء في أوروبا بعد التحديث الأخير ".repeat(
      4,
    );
    const cut: string = cutForSpeech(arabic);
    const said: string = cut.slice(0, -CALL_SPEECH_CUT_MARK.length);

    expect(cut.endsWith(CALL_SPEECH_CUT_MARK)).toBe(true);
    expect(arabic.startsWith(said)).toBe(true);
    expect(arabic.charAt(said.length)).toBe(" ");
    expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
      CALL_TITLE_MAX_LENGTH,
    );

    const hebrew: string = "השירות אינו זמין ללקוחות באירופה ".repeat(5);
    const hebrewSaid: string = cutForSpeech(hebrew).slice(
      0,
      -CALL_SPEECH_CUT_MARK.length,
    );

    expect(hebrew.startsWith(hebrewSaid)).toBe(true);
    expect(hebrew.charAt(hebrewSaid.length)).toBe(" ");
  });

  test("whatever the text, a cut one is a whole-character start of it, within the limit", () => {
    const alphabet: ReadonlyArray<string> = [
      "word ",
      "x",
      " ",
      "\n",
      "👩‍👩‍👧",
      "🇯🇵",
      "é",
      "数据库",
      "，",
      "الخدمة ",
      "עברית ",
      "-",
      ",",
      "INC-42",
      "<b>",
      "&amp;",
    ];

    for (const text of generatedTexts(3000, 10762, alphabet, 60)) {
      const oneLine: string = text.replace(/\s+/g, " ").trim();
      const cut: string = cutForSpeech(text);
      const characters: Array<string> = getSpeechCharacters(oneLine);

      expect(getSpeechCharacters(cut).length).toBeLessThanOrEqual(
        CALL_TITLE_MAX_LENGTH,
      );

      if (characters.length <= CALL_TITLE_MAX_LENGTH) {
        expect(cut).toBe(oneLine);
        continue;
      }

      expect(cut.endsWith(CALL_SPEECH_CUT_MARK)).toBe(true);

      const said: Array<string> = getSpeechCharacters(
        cut.slice(0, -CALL_SPEECH_CUT_MARK.length),
      );

      expect(said).toEqual(characters.slice(0, said.length));
    }
  });

  test("anything that is not text is no title", () => {
    expect(cutForSpeech(undefined)).toBe("");
    expect(cutForSpeech(null)).toBe("");
    expect(cutForSpeech(42)).toBe("");
  });
});

describe("a record's number, as the voice says it", () => {
  test("its prefix letter by letter, its number as a number: INC-42 is never Incorporated", () => {
    expect(getRecordNumberSpeech("INC-42")).toEqual([
      { characters: "INC" },
      { text: " 42" },
    ]);
    expect(renderSpeechAsText(getRecordNumberSpeech("INC-42"))).toBe("I N C 42");
  });

  test("every default prefix", () => {
    expect(renderSpeechAsText(getRecordNumberSpeech("ALT-7"))).toBe("A L T 7");
    expect(renderSpeechAsText(getRecordNumberSpeech("IE-2"))).toBe("I E 2");
    expect(renderSpeechAsText(getRecordNumberSpeech("AE-4"))).toBe("A E 4");
    expect(renderSpeechAsText(getRecordNumberSpeech("SM-3"))).toBe("S M 3");
    expect(renderSpeechAsText(getRecordNumberSpeech("CASE-12"))).toBe(
      "C A S E 12",
    );
  });

  test("a number without a prefix is a number: #42 is number 42", () => {
    expect(getRecordNumberSpeech("#42")).toEqual([{ text: "number 42" }]);
    expect(getRecordNumberSpeech("42")).toEqual([{ text: "42" }]);
  });

  test("lower case letters are spelled as letters", () => {
    expect(getRecordNumberSpeech("inc-42")).toEqual([
      { characters: "INC" },
      { text: " 42" },
    ]);
  });

  test("a prefix's separators are not said, and its words are spelled apart", () => {
    expect(getRecordNumberSpeech("OPS/INC-7")).toEqual([
      { characters: "OPS" },
      { text: " " },
      { characters: "INC" },
      { text: " 7" },
    ]);
    expect(renderSpeechAsText(getRecordNumberSpeech("SEV.1:42"))).toBe(
      "S E V 1, 42",
    );
  });

  test("a prefix whose letters end in a digit is kept apart from the number", () => {
    expect(getRecordNumberSpeech("P1-42")).toEqual([
      { characters: "P1" },
      { text: ", 42" },
    ]);
    expect(renderSpeechAsText(getRecordNumberSpeech("P1-42"))).toBe("P 1, 42");
  });

  test("a prefix in another script is spelled too", () => {
    expect(getRecordNumberSpeech("ИНЦ-42")).toEqual([
      { characters: "ИНЦ" },
      { text: " 42" },
    ]);
    expect(renderSpeechAsText(getRecordNumberSpeech("事件-42"))).toBe("事 件 42");
  });

  test("anything that does not end in a number is said as written", () => {
    expect(getRecordNumberSpeech("INC-")).toEqual([{ text: "INC-" }]);
    expect(getRecordNumberSpeech("  INC-42  ")).toEqual([
      { characters: "INC" },
      { text: " 42" },
    ]);
    expect(getRecordNumberSpeech("")).toEqual([]);
  });
});

describe("a sentence, as the voice is given it", () => {
  test("a sentence with no record number: its text as written", () => {
    expect(
      getSpeechParts({ sayMessage: "This is a call from Acme Production." }),
    ).toEqual([{ text: "This is a call from Acme Production." }]);
  });

  test("its record number spelled, the rest as written", () => {
    const parts: Array<SpeechPart> = getSpeechParts({
      sayMessage: "A new Critical Incident has been created: INC-42.",
      recordNumber: "INC-42",
    });

    expect(parts).toEqual([
      { text: "A new Critical Incident has been created: " },
      { characters: "INC" },
      { text: " 42" },
      { text: "." },
    ]);
    expect(renderSpeechAsText(parts)).toBe(
      "A new Critical Incident has been created: I N C 42.",
    );
  });

  test("the last place it names the number: a policy named after one keeps its name", () => {
    expect(
      renderSpeechAsText(
        getSpeechParts({
          sayMessage:
            "Alice Kim started the on-call policy INC-42 drill for an incident: Critical Incident INC-42.",
          recordNumber: "INC-42",
        }),
      ),
    ).toBe(
      "Alice Kim started the on-call policy INC-42 drill for an incident: Critical Incident I N C 42.",
    );
  });

  test("a sentence that no longer names its number - one a fit cut short - is said as written", () => {
    expect(
      getSpeechParts({
        sayMessage: "A new Critical Incident has been crea",
        recordNumber: "INC-42",
      }),
    ).toEqual([{ text: "A new Critical Incident has been crea" }]);
  });

  test("characters are spelled with spaces for a voice that reads no SSML", () => {
    expect(spellOut("INC")).toBe("I N C");
    expect(spellOut("事件")).toBe("事 件");
    expect(spellOut("A👩‍👩‍👧")).toBe("A 👩‍👩‍👧");
  });
});
