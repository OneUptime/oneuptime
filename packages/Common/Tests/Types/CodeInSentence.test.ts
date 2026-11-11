import {
  CodeInSentence,
  getCodeInSentence,
  LEFT_TO_RIGHT_ISOLATE,
  setCodeApartInSentence,
} from "../../Types/CodeInSentence";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../Types/ReadingDirection";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";
import { withoutIsolateMarks } from "../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * CODE IN A SENTENCE READ FROM THE RIGHT, DRAWN AS IT IS WRITTEN.
 *
 * An Arabic or Persian sentence that names a function, a path or a flag
 * drew the code's brackets, slash or dashes at its other end: the bidi
 * algorithm gives a sign at the edge of a left-to-right run the
 * sentence's direction. Each such piece of code is set apart in a
 * left-to-right isolate (LRI ... PDI); what reads right as it is, and
 * what belongs to the sentence round the code, is left as it is.
 *
 * Each test writes the marks out - <LRI>, <FSI>, <PDI> - so it reads
 * where each one goes.
 */

const LRI: string = String.fromCharCode(0x2066);
const RLM: string = String.fromCharCode(0x200f);

const shown: (sentence: string, language?: string) => string = (
  sentence: string,
  language: string = "ar",
): string => {
  return setCodeApartInSentence(sentence, language)
    .split(LEFT_TO_RIGHT_ISOLATE)
    .join("<LRI>")
    .split(FIRST_STRONG_ISOLATE)
    .join("<FSI>")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("<PDI>");
};

describe("the left-to-right isolate's mark", () => {
  test("is LEFT-TO-RIGHT ISOLATE (U+2066), closed by POP DIRECTIONAL ISOLATE", () => {
    expect(LEFT_TO_RIGHT_ISOLATE).toBe(LRI);
    expect(POP_DIRECTIONAL_ISOLATE.codePointAt(0)).toBe(0x2069);
  });
});

describe("code an Arabic or Persian sentence names is set apart", () => {
  test.each([
    // A function's brackets, and the full stop after it the sentence's.
    [
      "تُلتقط المقاييس المخصصة باستخدام oneuptime.captureMetric().",
      "تُلتقط المقاييس المخصصة باستخدام <LRI>oneuptime.captureMetric()<PDI>.",
    ],
    [
      "نُفّذ استدعاء revokeConsent() أو stop() قبل start()، لذا لم يُنشأ مسجّل.",
      "نُفّذ استدعاء <LRI>revokeConsent()<PDI> أو <LRI>stop()<PDI> قبل <LRI>start()<PDI>، لذا لم يُنشأ مسجّل.",
    ],
    // A path, inside the sentence's brackets.
    [
      "قيمة المطابقة (مثل /api/v1/users)",
      "قيمة المطابقة (مثل <LRI>/api/v1/users<PDI>)",
    ],
    [
      "C:\\ أو /mnt/data أو /dev/sda1",
      "<LRI>C:\\<PDI> أو <LRI>/mnt/data<PDI> أو <LRI>/dev/sda1<PDI>",
    ],
    [
      "نشانی سند کشف OIDC — معمولاً به /.well-known/openid-configuration ختم می‌شود.",
      "نشانی سند کشف OIDC — معمولاً به <LRI>/.well-known/openid-configuration<PDI> ختم می‌شود.",
    ],
    // A flag, a file, a glob, an address's scheme.
    [
      "برای دیدن پرچم‌های هر دستور، --help را به آن اضافه کنید.",
      "برای دیدن پرچم‌های هر دستور، <LRI>--help<PDI> را به آن اضافه کنید.",
    ],
    [
      "--all، یا --skip و --limit",
      "<LRI>--all<PDI>، یا <LRI>--skip<PDI> و <LRI>--limit<PDI>",
    ],
    ["اكتبها في ملف .env بجانبه.", "اكتبها في ملف <LRI>.env<PDI> بجانبه."],
    [
      "تحمل سمات المورد cloud.*، أو مورد آخر.",
      "تحمل سمات المورد <LRI>cloud.*<PDI>، أو مورد آخر.",
    ],
    ["عنوان URL يبدأ بـ https://.", "عنوان URL يبدأ بـ <LRI>https://<PDI>."],
    // A sign before or after a number keeps its place.
    [
      "يطابق أرقام الهواتف (مثلًا +1 555-123-4567)",
      "يطابق أرقام الهواتف (مثلًا <LRI>+1 555-123-4567<PDI>)",
    ],
    [
      "إذا وُجدت قناة بهذا الاسم، يضيف OneUptime في النهاية -2.",
      "إذا وُجدت قناة بهذا الاسم، يضيف OneUptime في النهاية <LRI>-2<PDI>.",
    ],
    ["درجة الحرارة (°C)", "درجة الحرارة (<LRI>°C<PDI>)"],
    ["بحسب Use% في df", "بحسب <LRI>Use%<PDI> في df"],
    ["الوحدات SFP وSFP+ وQSFP", "الوحدات SFP و<LRI>SFP+<PDI> وQSFP"],
    // A name with the code's own end: a placeholder in angle brackets.
    [
      "جزء من اسم المقياس، oneuptime.alert.measurement.<key>، لذا لا يتغير.",
      "جزء من اسم المقياس، <LRI>oneuptime.alert.measurement.<key><PDI>، لذا لا يتغير.",
    ],
    [
      'وأضف crossorigin="anonymous" إلى وسم <link> الخاص بها.',
      'وأضف <LRI>crossorigin="anonymous"<PDI> إلى وسم <LRI><link><PDI> الخاص بها.',
    ],
    // Brackets round a number only take the sentence's direction: set apart.
    ["القيمة getItem(2) هنا", "القيمة <LRI>getItem(2)<PDI> هنا"],
    // A regular expression's backslash keeps the full stop after it.
    [
      "پس ^orders\\. با هر صفی مطابق است",
      "پس <LRI>^orders\\.<PDI> با هر صفی مطابق است",
    ],
  ])("%s", (sentence: string, expected: string) => {
    expect(shown(sentence)).toBe(expected);
    // Only marks are added: the words are the locale file's.
    expect(withoutIsolateMarks(setCodeApartInSentence(sentence, "ar"))).toBe(
      sentence,
    );
  });
});

describe("what reads right as it is stays as it is", () => {
  test.each([
    // Letters or digits at both ends: one left-to-right run.
    "استخدم Node.js هنا",
    "شغّل helm upgrade --reuse-values الآن",
    "يرسل إلى Pub/Sub كل دقيقة",
    // A bracket round letters takes their direction.
    "استدعِ track('signup') عند التسجيل",
    // Signs that join the number beside them.
    "الحادثة #12 مفتوحة",
    "اكتمل 90% منها",
    "التكلفة $5 شهريًا",
    "التكلفة ${{amount}}/شهر",
    // A word written onto the sentence's own, with a slash between.
    "استخدام CPU/الذاكرة",
    "وكلفة cpu/ram/gpu/pv/الشبكة",
    // A separator of the sentence's, set off by spaces.
    "CPU / الذاكرة",
    "APM > الخدمات",
    // A Latin word with a Persian ending joined by a zero-width non-joiner.
    "حافظه swap\u{200C}شده",
    // An issue number written as it is: "INC-42" reads from the left.
    "مثل INC-42.",
    // A sign after a Latin word joins its run: "OneUptime -2" reads from the left.
    "يضيف OneUptime -2 إلى نهاية الاسم.",
  ])("%s", (sentence: string) => {
    expect(setCodeApartInSentence(sentence, "ar")).toBe(sentence);
    expect(setCodeApartInSentence(sentence, "fa")).toBe(sentence);
  });
});

describe("what belongs to the sentence stays outside the code", () => {
  test("its full stop, comma, colon and ellipsis", () => {
    expect(shown("استدعِ grantConsent().")).toBe(
      "استدعِ <LRI>grantConsent()<PDI>.",
    );
    expect(shown("يبدأ بـ webcal://، ويُخزَّن مشفرًا.")).toBe(
      "يبدأ بـ <LRI>webcal://<PDI>، ويُخزَّن مشفرًا.",
    );
    expect(shown("مثل /orders/1: صفحة واحدة")).toBe(
      "مثل <LRI>/orders/1<PDI>: صفحة واحدة",
    );
    // An ellipsis after a value or a word is the sentence's too.
    expect(shown("جارٍ تحميل {{itemsName}}…")).toBe(
      "جارٍ تحميل {{itemsName}}…",
    );
    expect(shown("جارٍ الاتصال بـ Meraki…")).toBe("جارٍ الاتصال بـ Meraki…");
  });

  test("but several stops after a sign are the code's own", () => {
    expect(shown("يحمل السر الترويسة x-oneuptime-token=... كاملة")).toBe(
      "يحمل السر الترويسة <LRI>x-oneuptime-token=...<PDI> كاملة",
    );
  });

  test("the quotation marks and brackets the sentence puts round the code", () => {
    expect(shown("السلسلة `@Microsoft.KeyVault(...)` كما هي")).toBe(
      "السلسلة `<LRI>@Microsoft.KeyVault(...)<PDI>` كما هي",
    );
    expect(shown("بين علامتي %: '%vip_users%'.")).toBe(
      "بين علامتي %: '<LRI>%vip_users%<PDI>'.",
    );
    // A quotation's last full stop is what it quotes.
    expect(shown("بدون «client.» در ابتدا")).toBe(
      "بدون «<LRI>client.<PDI>» در ابتدا",
    );
  });

  test("a bracket whose partner is past the sentence's words", () => {
    expect(
      shown(
        "--reset-then-reuse-values (Helm 3.14 أو أحدث) يحتفظ بالقيم الأخرى.",
      ),
    ).toBe(
      "<LRI>--reset-then-reuse-values<PDI> (Helm 3.14 أو أحدث) يحتفظ بالقيم الأخرى.",
    );
  });

  test("a letter written onto the code is the sentence's, the sign after it the code's", () => {
    // "و" is "and", written onto the next word: "and /orders/2".
    expect(shown("تصبح /orders/1 و/orders/2 صفحة واحدة")).toBe(
      "تصبح <LRI>/orders/1<PDI> و<LRI>/orders/2<PDI> صفحة واحدة",
    );
    expect(shown("Go وNode.js و.NET وPython")).toBe(
      "Go وNode.js و<LRI>.NET<PDI> وPython",
    );
  });

  test("an apostrophe inside a word is no quotation mark", () => {
    expect(shown("رسالة kiss-o'-death من الخادم")).toBe(
      "رسالة kiss-o'-death من الخادم",
    );
  });
});

describe("a value in the code", () => {
  test("a sign beside it stays with it, and the value reads its own way", () => {
    expect(shown("+{{count}} أخرى")).toBe(
      "<LRI>+<FSI>{{count}}<PDI><PDI> أخرى",
    );
    expect(shown("النتائج: {{count}}+")).toBe(
      "النتائج: <LRI><FSI>{{count}}<PDI>+<PDI>",
    );
    expect(shown("النطاق دائمًا @{{domain}}.")).toBe(
      "النطاق دائمًا <LRI>@<FSI>{{domain}}<PDI><PDI>.",
    );
  });

  test("a value on its own is never set apart: the sentence's translator does that", () => {
    expect(shown("تم إنشاء {{incidentTitle}}.")).toBe(
      "تم إنشاء {{incidentTitle}}.",
    );
    expect(shown("الحوادث ({{count}})")).toBe("الحوادث ({{count}})");
  });

  test("two values keep the sentence's order: only the sign joins its value", () => {
    expect(shown("~{{time}} {{count}} من الأخطاء")).toBe(
      "<LRI>~<FSI>{{time}}<PDI><PDI> {{count}} من الأخطاء",
    );
  });

  test("brackets round a value only are the code's", () => {
    expect(shown("مقروء من لوحة معلومات Meraki ({{name}})، {{time}}.")).toBe(
      "مقروء من لوحة معلومات <LRI>Meraki (<FSI>{{name}}<PDI>)<PDI>، {{time}}.",
    );
  });

  /*
   * A value can come in an isolate of its own (the Translator's
   * setsValuesApart), which the bidi algorithm reads as a sign: written
   * onto a word of the code, it was drawn at the word's other end.
   */
  test.each([
    [
      "أرسل باستخدام المُصدِّر otlp_http إلى {{url}}/otlp، مع الترويسة",
      "أرسل باستخدام المُصدِّر otlp_http إلى <LRI><FSI>{{url}}<PDI>/otlp<PDI>، مع الترويسة",
    ],
    [
      "الإصدار v{{version}} من OneUptime متاح",
      "الإصدار <LRI>v<FSI>{{version}}<PDI><PDI> من OneUptime متاح",
    ],
    [
      "لا يغيّر شيئًا إلا إذا بدأ مع {{allowWrites}}=true، وحتى عندئذ",
      "لا يغيّر شيئًا إلا إذا بدأ مع <LRI><FSI>{{allowWrites}}<PDI>=true<PDI>، وحتى عندئذ",
    ],
    [
      "تحمل `cloud.platform={{platform}}` — فبدون ذلك",
      "تحمل `<LRI>cloud.platform=<FSI>{{platform}}<PDI><PDI>` — فبدون ذلك",
    ],
  ])(
    "a value written onto a word of the code: %s",
    (sentence: string, expected: string) => {
      expect(shown(sentence)).toBe(expected);
    },
  );

  test.each([
    // Values and the signs between them are numbers: the sentence's to draw.
    "العقد المتصلة: {{online}}/{{count}}",
    "اكتمل {{percent}}%",
    "الحادثة #{{number}}: {{title}}",
    "الأحدث: الوسيط {{median}} ms عبر {{count}} مسبار ({{min}}–{{max}} ms)",
    "عرض {{first}}–{{last}} من أصل {{total}}",
    // A value set off by a space is a word of its own.
    "OneUptime {{version}} متاح",
  ])(
    "a value beside numbers' signs only, or set off by a space: %s",
    (sentence: string) => {
      expect(setCodeApartInSentence(sentence, "ar")).toBe(sentence);
      expect(setCodeApartInSentence(sentence, "fa")).toBe(sentence);
    },
  );
});

describe("an expression that starts with a number", () => {
  /*
   * Its digits read as a number of the sentence's, and a sign after them
   * that joins no two digits takes the sentence's direction: "0 9 * * 1-5"
   * was drawn "1-5 * * 9 0".
   */
  test.each([
    ["مثلًا: 0 */18 * * *", "مثلًا: <LRI>0 */18 * * *<PDI>"],
    [
      "أدخل تعبير cron، مثل «0 9 * * 1-5» (الساعة 09:00 في أيام العمل).",
      "أدخل تعبير cron، مثل «<LRI>0 9 * * 1-5<PDI>» (الساعة 09:00 في أيام العمل).",
    ],
    [
      "لأن الشبكة IPv6 /64 تضم 2^64 عنوانًا.",
      "لأن الشبكة IPv6 /64 تضم <LRI>2^64<PDI> عنوانًا.",
    ],
    [
      "تسميات القيم (اختياري، مثلًا: 0=inactive, 1=active)",
      "تسميات القيم (اختياري، مثلًا: <LRI>0=inactive, 1=active<PDI>)",
    ],
    [
      "مانند 203.0.113.7، 2001:db8::1 یا 10.0.0.0/8.",
      "مانند 203.0.113.7، <LRI>2001:db8::1<PDI> یا 10.0.0.0/8.",
    ],
    [
      "1.3.6.1.4.1.9.* (Cisco) أو 1.3.6.1.4.1.2636.* (Juniper)",
      "<LRI>1.3.6.1.4.1.9.* (Cisco)<PDI> أو <LRI>1.3.6.1.4.1.2636.* (Juniper)<PDI>",
    ],
  ])("is set apart whole: %s", (sentence: string, expected: string) => {
    expect(shown(sentence)).toBe(expected);
    expect(withoutIsolateMarks(setCodeApartInSentence(sentence, "ar"))).toBe(
      sentence,
    );
  });

  test.each([
    // A number with the signs it is written with.
    "الشبكة 192.168.1.0/24 أو النطاق 10.16-22.0-255.51-66",
    "مثل 1.1.1.1, 8.8.8.8, 9.9.9.9 هنا",
    "السعة 3.8 TB والتوفر 99.9%",
    // A number the sentence sets off: by a space, a bracket, a dash, a dot.
    "(مثلًا 10 = الاحتفاظ بـ 10% وتجاهل 90%)",
    "المنفذ 1433 (SQL Server) أو 5432 (PostgreSQL)",
    "بين 70–85% من الذاكرة",
    "مديرون: 3 · عاملون: 2 · Docker 27.3.1",
  ])("but a number is the sentence's: %s", (sentence: string) => {
    expect(setCodeApartInSentence(sentence, "ar")).toBe(sentence);
    expect(setCodeApartInSentence(sentence, "fa")).toBe(sentence);
  });
});

describe("markup and Markdown in a sentence", () => {
  test("an HTML tag is never entered, and no code runs across one", () => {
    const template: string = "<p>مرحبًا،</p><p>تم إنشاء {{incidentTitle}}.</p>";

    expect(shown(template)).toBe(template);
    expect(shown("<b>استخدم foo()</b> الآن")).toBe(
      "<b>استخدم <LRI>foo()<PDI></b> الآن",
    );
  });

  test("a Markdown link's target is never entered: a mark would be part of its address", () => {
    for (const sentence of [
      "راجع [الوثائق](/docs/monitor/api) للمزيد",
      "يتناول [استكشاف أخطاء السحابة وإصلاحها]({{url}}) بقية الأسباب",
    ]) {
      expect(setCodeApartInSentence(sentence, "ar")).toBe(sentence);
    }

    // The words it is drawn with are read as any others.
    expect(shown("راجع [/docs/api](/docs/api) للمزيد")).toBe(
      "راجع [<LRI>/docs/api<PDI>](/docs/api) للمزيد",
    );
  });

  test("an HTML entity is one sign", () => {
    expect(shown("أدلة التشغيل &rsaquo; المشغّلات")).toBe(
      "أدلة التشغيل &rsaquo; المشغّلات",
    );
  });

  test("bold round the code is the sentence's; bold that closes inside it is the code's", () => {
    expect(shown("أضف كل متغير باستخدام **+ Add**.")).toBe(
      "أضف كل متغير باستخدام **+ Add**.",
    );
    expect(
      shown(
        "**Essential: No**، **Docker configuration → Command** `--config=env:OTEL_COLLECTOR_CONFIG`.",
      ),
    ).toBe(
      "**Essential: No**، <LRI>**Docker configuration → Command** `--config=env:OTEL_COLLECTOR_CONFIG`<PDI>.",
    );
    expect(shown("ثم **Apply** — Beanstalk يعيد التشغيل")).toBe(
      "ثم **Apply** — Beanstalk يعيد التشغيل",
    );
  });
});

describe("which sentences are read", () => {
  const sentence: string = "استدعِ grantConsent().";

  test("a sentence of a language read from the right", () => {
    for (const language of ["ar", "fa", "he", "ur", "ar-EG", "fa-IR"]) {
      expect(shown(sentence, language)).toBe(
        "استدعِ <LRI>grantConsent()<PDI>.",
      );
    }
  });

  test("never one of a language read from the left, or of none", () => {
    for (const language of ["en", "de", "fr", "ja", "zh-CN", "az-Latn"]) {
      expect(setCodeApartInSentence(sentence, language)).toBe(sentence);
    }

    expect(setCodeApartInSentence(sentence, undefined)).toBe(sentence);
    expect(setCodeApartInSentence(sentence, null)).toBe(sentence);
    expect(setCodeApartInSentence("", "ar")).toBe("");
  });

  test("never English left on an Arabic page: it reads from the left already", () => {
    for (const english of [
      "Custom metrics captured using oneuptime.captureMetric().",
      "Match value (e.g. /api/v1/users)",
      "--help",
    ]) {
      expect(setCodeApartInSentence(english, "ar")).toBe(english);
      expect(getCodeInSentence(english)).toEqual([]);
    }
  });

  test("a mark a translator placed by hand still steadies the code", () => {
    const steadied: string = `به ${String.fromCharCode(0x200e)}--help اضافه کنید`;

    expect(setCodeApartInSentence(steadied, "fa")).toBe(steadied);

    // A right-to-left mark ends the sentence's words: the code after it is read.
    expect(shown(`Merge Request ${RLM}!{{number}}`, "fa")).toBe(
      `Merge Request ${RLM}<LRI>!<FSI>{{number}}<PDI><PDI>`,
    );
  });
});

describe("what is already set apart", () => {
  test("a value's isolate is never entered", () => {
    const filled: string = `الحادثة ${FIRST_STRONG_ISOLATE}api/v1()${POP_DIRECTIONAL_ISOLATE} مفتوحة`;

    expect(setCodeApartInSentence(filled, "ar")).toBe(filled);
  });

  test("setting code apart twice sets it apart once", () => {
    for (const sentence of [
      "تُلتقط المقاييس باستخدام oneuptime.captureMetric().",
      "+{{count}} أخرى",
      "تصبح /orders/1 و/orders/2 صفحة واحدة",
      "--reset-then-reuse-values (Helm 3.14 أو أحدث)",
    ]) {
      const once: string = setCodeApartInSentence(sentence, "ar");

      expect(setCodeApartInSentence(once, "ar")).toBe(once);
    }
  });
});

describe("where the code is", () => {
  test("each piece by its place in the sentence", () => {
    const sentence: string = "استدعِ start() ثم stop().";
    const found: Array<CodeInSentence> = getCodeInSentence(sentence);

    expect(found).toEqual([
      { start: 7, end: 14, text: "start()" },
      { start: 18, end: 24, text: "stop()" },
    ]);

    for (const piece of found) {
      expect(sentence.slice(piece.start, piece.end)).toBe(piece.text);
    }
  });
});

describe("its time", () => {
  /*
   * A sentence i18next fills with a value is read with the value in it,
   * and a value can be anything someone sent. Reading takes time in line
   * with the text, whatever it holds.
   */
  test.each([
    ["brackets opened and never closed", "س (((((".repeat(60000)],
    ["brackets nested deep", `س ${"(".repeat(200000)}a${")".repeat(200000)}`],
    ["signs with no letter", `س ${"/.-*".repeat(100000)}`],
    ["bold run after bold run", `س ${"**a".repeat(130000)}`],
    ["code after code", "س a.b() /c/d --e ".repeat(25000)],
    ["placeholders never closed", `س ${"{{a".repeat(130000)}`],
    ["tags never closed", `س ${"<p ".repeat(130000)}`],
    ["a number with signs set off by spaces", `س ${"1.1 / ".repeat(66000)}`],
    ["digits and spaces, then a star", `س ${"1 ".repeat(200000)}*`],
    ["values written onto values", `س ${"{{a}}/".repeat(66000)}b`],
  ])("%s, 400,000 characters", (_name: string, text: string) => {
    const run: FastestRun<string> = fastestRun({
      run: (): string => {
        return setCodeApartInSentence(text, "ar");
      },
      limitInMs: 2000,
    });

    expect(withoutIsolateMarks(run.result)).toBe(withoutIsolateMarks(text));
    expect(run.inMs).toBeLessThan(2000);
  });
});
