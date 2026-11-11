import {
  createTranslator,
  getSentenceParts,
  getTemplateAround,
  PluralTemplate,
  SentencePart,
  TemplateAround,
  TextLookup,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import { describe, expect, test } from "@jest/globals";

/*
 * A NUMBER IN A SENTENCE DRAWN ON A PAGE KEEPS THE SIGNS WRITTEN AGAINST IT.
 *
 * A sentence drawn on the page sets each value apart in a Unicode isolate
 * where it could move the words round it (SentenceOptions'
 * setsValuesApart). To the sentence an isolate is one sign of its own, so
 * two counts set apart around a slash were drawn back to front in Arabic
 * and Persian - "العقد المتصلة: {{online}}/{{count}}" with 3 of 5 nodes
 * online read "5/3" - and Persian's "#{{number}}", whose right-to-left mark
 * keeps the sign in front of the number, read "۴۲#". A number joined to
 * another by one separator, or written after a number sign, is left as it
 * is; everything else is set apart as before. Each sentence is laid out
 * with a copy of the bidi algorithm (Helpers/BidiLayout), as a page with
 * dir="rtl" draws it.
 */

type Dictionary = Record<string, string>;

const RLM: string = String.fromCharCode(0x200f);

const lookupFrom: (dictionary: Dictionary) => TextLookup = (
  dictionary: Dictionary,
): TextLookup => {
  return (text: string): string => {
    return dictionary[text] ?? text;
  };
};

const isolated: (value: string) => string = (value: string): string => {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
};

// Whether `piece`, where it first appears in `line`, is drawn as written in a page read from the right.
const readsAsWritten: (line: string, piece: string) => boolean = (
  line: string,
  piece: string,
): boolean => {
  const from: number = line.indexOf(piece);

  expect(from).toBeGreaterThanOrEqual(0);

  return isDrawnAsWritten(drawLine(line, "rtl"), from, from + piece.length);
};

const drawnFromTheRight: (line: string) => string = (line: string): string => {
  return getDrawnText(drawLine(line, "rtl"));
};

const NODES: PluralTemplate = {
  one: "{{online}}/{{count}} node online",
  other: "{{online}}/{{count}} nodes online",
};
const INCIDENT: string = "Incident #{{number}}";
const INCIDENT_TITLE: string = "Incident #{{number}}: {{title}}";
const STARTS: string = "Starts at {{hours}}:{{minutes}}";
const SITE_NODES: string = "{{site}}: {{online}}/{{count}} nodes online";
const NODES_OF: string = "{{count}}/{{name}} nodes";
const MATCHES: string = "{{count}} more monitors match.";
const DATABASES: string = "{{percent}}% of the databases";
const KEPT: string = "{{kept}}% kept • {{discarded}}% dropped";
const BETWEEN: string = "Between {{min}}–{{max}} ms";

const ARABIC: Dictionary = {
  [NODES.other]: "العقد المتصلة: {{online}}/{{count}}",
  [`${NODES.other}_one`]: "العقد المتصلة: {{online}}/{{count}}",
  [INCIDENT]: "الحادثة #{{number}}",
  [INCIDENT_TITLE]: "الحادثة #{{number}}: {{title}}",
  [STARTS]: "يبدأ عند {{hours}}:{{minutes}}",
  [SITE_NODES]: "{{site}}: العقد المتصلة {{online}}/{{count}}",
  [NODES_OF]: "{{count}}/{{name}} عقد",
  [MATCHES]: "يطابق {{count}} مراقب آخر.",
  [DATABASES]: "{{percent}}% من قواعد البيانات",
  [KEPT]: "{{kept}}% مُحتفَظ به • {{discarded}}% مُستبعَد",
  [BETWEEN]: "بين {{min}}–{{max}} مللي ثانية",
};

const PERSIAN: Dictionary = {
  [NODES.other]: "{{online}}/{{count}} گره آنلاین",
  [`${NODES.other}_one`]: "{{online}}/{{count}} گره آنلاین",
  [INCIDENT]: `حادثه ${RLM}#{{number}}`,
  [INCIDENT_TITLE]: `حادثه ${RLM}#{{number}}: {{title}}`,
  [STARTS]: "شروع در {{hours}}:{{minutes}}",
};

const GERMAN: Dictionary = {
  [NODES.other]: "{{online}}/{{count}} Knoten online",
  [INCIDENT]: "Vorfall #{{number}}",
};

const arabic: Translator = createTranslator(lookupFrom(ARABIC), "ar");
const persian: Translator = createTranslator(lookupFrom(PERSIAN), "fa");
const german: Translator = createTranslator(lookupFrom(GERMAN), "de");

const APART: { setsValuesApart: boolean } = { setsValuesApart: true };

describe("two counts beside a slash", () => {
  test("are drawn as written in Arabic: 3/5", () => {
    const sentence: string = arabic.translatePlural(
      NODES,
      5,
      { online: arabic.formatNumber(3) },
      APART,
    );

    // Left as they are: the sentence as the locale file writes it.
    expect(sentence).toBe("العقد المتصلة: 3/5");
    expect(readsAsWritten(sentence, "3/5")).toBe(true);
    expect(drawnFromTheRight(sentence)).toBe("3/5 :ةلصتملا دقعلا");
  });

  test("and in Persian, in its own digits: ۳/۵", () => {
    const sentence: string = persian.translatePlural(
      NODES,
      5,
      { online: persian.formatNumber(3) },
      APART,
    );

    expect(sentence).toBe("۳/۵ گره آنلاین");
    expect(readsAsWritten(sentence, "۳/۵")).toBe(true);
    expect(drawnFromTheRight(sentence)).toBe("نیالنآ هرگ ۳/۵");
  });

  // The negative control: each count in an isolate of its own, as before.
  test("each set apart on its own, they were drawn back to front: 5/3", () => {
    const arabicApart: string = `العقد المتصلة: ${isolated("3")}/${isolated("5")}`;
    const persianApart: string = `${isolated("۳")}/${isolated("۵")} گره آنلاین`;

    expect(drawnFromTheRight(arabicApart)).toBe("5/3 :ةلصتملا دقعلا");
    expect(drawnFromTheRight(persianApart)).toBe("نیالنآ هرگ ۵/۳");
  });

  test("a time's hours and minutes too: 09:30, never 30:09", () => {
    for (const [translator, hours, minutes] of [
      [arabic, "09", "30"],
      [persian, "۰۹", "۳۰"],
    ] as Array<[Translator, string, string]>) {
      const sentence: string = translator.translateTemplate(
        STARTS,
        { hours, minutes },
        APART,
      );
      const time: string = `${hours}:${minutes}`;

      expect(sentence.endsWith(` ${time}`)).toBe(true);
      expect(readsAsWritten(sentence, time)).toBe(true);
      expect(drawnFromTheRight(sentence).startsWith(time)).toBe(true);

      // The negative control: set apart, the minutes came first.
      const apart: string = sentence.replace(
        time,
        `${isolated(hours)}:${isolated(minutes)}`,
      );

      expect(drawnFromTheRight(apart).startsWith(`${minutes}:${hours}`)).toBe(
        true,
      );
    }
  });
});

describe("a number after a number sign", () => {
  test("keeps the sign in front of it in Persian, as its right-to-left mark asks: #۴۲", () => {
    const sentence: string = persian.translateTemplate(
      INCIDENT,
      { number: persian.formatNumber(42) },
      APART,
    );

    expect(sentence).toBe(`حادثه ${RLM}#۴۲`);
    expect(readsAsWritten(sentence, "#۴۲")).toBe(true);
    expect(drawnFromTheRight(sentence)).toBe("#۴۲ هثداح");

    // The negative control: the number set apart lost its sign.
    expect(drawnFromTheRight(`حادثه ${RLM}#${isolated("۴۲")}`)).toBe(
      "۴۲# هثداح",
    );
  });

  test("is drawn as Arabic draws it, as before: 42#", () => {
    const sentence: string = arabic.translateTemplate(
      INCIDENT,
      { number: arabic.formatNumber(42) },
      APART,
    );

    expect(sentence).toBe("الحادثة #42");
    expect(drawnFromTheRight(sentence)).toBe("42# ةثداحلا");
    // Set apart, the same: after Arabic letters the sign is the sentence's.
    expect(drawnFromTheRight(`الحادثة #${isolated("42")}`)).toBe("42# ةثداحلا");
  });

  test("while the title after it is still set apart", () => {
    const sentence: string = persian.translateTemplate(
      INCIDENT_TITLE,
      { number: persian.formatNumber(42), title: "Checkout API down" },
      APART,
    );

    expect(sentence).toBe(`حادثه ${RLM}#۴۲: ${isolated("Checkout API down")}`);
    expect(readsAsWritten(sentence, "#۴۲")).toBe(true);
    expect(readsAsWritten(sentence, "Checkout API down")).toBe(true);
    expect(drawnFromTheRight(sentence)).toBe("Checkout API down :#۴۲ هثداح");
  });
});

describe("what is still set apart", () => {
  test("a name beside the counts, which are left as they are", () => {
    const sentence: string = arabic.translateTemplate(
      SITE_NODES,
      { site: "Acme Retail", online: "3", count: "5" },
      APART,
    );

    expect(sentence).toBe(`${isolated("Acme Retail")}: العقد المتصلة 3/5`);
    expect(readsAsWritten(sentence, "Acme Retail")).toBe(true);
    expect(readsAsWritten(sentence, "3/5")).toBe(true);
    expect(drawnFromTheRight(sentence)).toBe("3/5 ةلصتملا دقعلا :Acme Retail");
  });

  test("a number beside a slash with a name on its other side: the sign joins nothing", () => {
    expect(
      arabic.translateTemplate(NODES_OF, { count: "3", name: "Acme" }, APART),
    ).toBe(`${isolated("3")}/${isolated("Acme")} عقد`);
  });

  test("a count written apart from any sign", () => {
    expect(arabic.translateTemplate(MATCHES, { count: "3" }, APART)).toBe(
      `يطابق ${isolated("3")} مراقب آخر.`,
    );
  });

  /*
   * After Arabic words the bidi algorithm draws "%45" whether the number
   * is set apart or not; at the start of the sentence, left as it is, it
   * drew "45%". Set apart, every percent in a sentence is drawn alike.
   */
  test("a number with a percent sign, so every percent is drawn alike", () => {
    const sentence: string = arabic.translateTemplate(
      KEPT,
      { kept: "45", discarded: "55" },
      APART,
    );

    expect(sentence).toBe(
      `${isolated("45")}% مُحتفَظ به • ${isolated("55")}% مُستبعَد`,
    );
    expect(drawnFromTheRight(sentence)).toBe("دَعبتسُم %55 • هب ظَفتحُم %45");

    // Left as they are, the two were drawn two ways.
    expect(drawnFromTheRight("45% مُحتفَظ به • 55% مُستبعَد")).toBe(
      "دَعبتسُم %55 • هب ظَفتحُم 45%",
    );

    expect(arabic.translateTemplate(DATABASES, { percent: "45" }, APART)).toBe(
      `${isolated("45")}% من قواعد البيانات`,
    );
  });

  test("a range's two ends: its dash joins nothing, drawn from the right either way", () => {
    const sentence: string = arabic.translateTemplate(
      BETWEEN,
      { min: "10", max: "20" },
      APART,
    );

    expect(sentence).toBe(`بين ${isolated("10")}–${isolated("20")} مللي ثانية`);
    expect(drawnFromTheRight(sentence)).toBe(
      drawnFromTheRight("بين 10–20 مللي ثانية"),
    );
  });
});

describe("where nothing changes", () => {
  test("a sentence filled for anything but the page carries no marks", () => {
    expect(arabic.translatePlural(NODES, 5, { online: "3" })).toBe(
      "العقد المتصلة: 3/5",
    );
    expect(
      persian.translateTemplate(INCIDENT_TITLE, { number: "۴۲", title: "API" }),
    ).toBe(`حادثه ${RLM}#۴۲: API`);
  });

  test("a sentence read left to right never sets a number apart", () => {
    expect(german.translatePlural(NODES, 5, { online: "3" }, APART)).toBe(
      "3/5 Knoten online",
    );
    expect(german.translateTemplate(INCIDENT, { number: "42" }, APART)).toBe(
      "Vorfall #42",
    );
  });

  test("an English sentence on an Arabic page neither", () => {
    expect(
      arabic.translateTemplate(
        "Attempt {{number}}/{{total}}",
        { number: "3", total: "5" },
        APART,
      ),
    ).toBe("Attempt 3/5");
  });
});

describe("a sentence drawn in pieces", () => {
  test("TranslatedSentence's: a number beside a slot stays set apart, as the slot does", () => {
    // What is drawn in the slot is not known: it may be no number at all.
    const parts: Array<SentencePart> = getSentenceParts({
      translator: arabic,
      template: NODES,
      count: 5,
      slots: ["online"],
    });

    expect(parts).toEqual([
      { kind: "text", text: "العقد المتصلة: " },
      { kind: "slot", slot: "online" },
      { kind: "text", text: `/${isolated("5")}` },
    ]);
  });

  test("TranslatedSentence's: two counts in the text are drawn as written", () => {
    const parts: Array<SentencePart> = getSentenceParts({
      translator: persian,
      template: INCIDENT_TITLE,
      slots: ["title"],
      values: { number: "۴۲" },
    });

    expect(parts).toEqual([
      { kind: "text", text: `حادثه ${RLM}#۴۲: ` },
      { kind: "slot", slot: "title" },
    ]);
  });

  test("translateTemplateAround's: the number before the slot is left as it is", () => {
    const around: TemplateAround = getTemplateAround(
      persian,
      INCIDENT_TITLE,
      "title",
      { number: "۴۲" },
    );

    expect(around).toEqual({
      before: `حادثه ${RLM}#۴۲: ${FIRST_STRONG_ISOLATE}`,
      after: POP_DIRECTIONAL_ISOLATE,
    });

    const line: DrawnLine = drawLine(
      `${around.before}Checkout API down${around.after}`,
      "rtl",
    );

    expect(getDrawnText(line)).toBe("Checkout API down :#۴۲ هثداح");
  });
});
