import { describe, expect, test } from "@jest/globals";
import * as SecurityCaseResponseCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import * as RefusedTelemetryCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryCopy";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";
import {
  DAYS_READ_WITH_A_VOWEL,
  MOMENT_PHRASE_FORMS,
  MOMENT_PHRASES,
  MOMENT_ROLES,
  MomentPhraseWords,
  MomentRole,
  WrittenMoment,
  getMomentRole,
  momentPhrase,
} from "../../../Utils/MomentPhrases";
import { STEP_CHECK_SENTENCES_BEFORE_MOMENT_PHRASES } from "../../../Utils/SecurityCase/ResponsePlan/StepCheckSentences";
import * as StepCheckWords from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A MOMENT READS RIGHT IN EVERY LANGUAGE (#10622).
 *
 * The step checks' sentences, a block's line and the refused telemetry's
 * lines once wrote their own preposition before a moment - "got through
 * again at {{time}}" - and a moment holds its day whenever it is not
 * today, so Spanish read "a las 27 nov, 14:25", Italian "alle 27 nov,
 * 14:25", French "à 27 nov., 14:25". A moment now brings its own words
 * (Utils/MomentPhrases): "a las 14:25" today, "el 27 nov a las 14:25" on
 * another day. So, in every language the Dashboard speaks:
 *
 *   - a sentence writes none of the words a moment's phrase brings beside
 *     the moment, and never starts with one where letters have a case: the
 *     phrase is worded for the middle of a sentence;
 *   - each phrase's time alone and its day with a time end alike after the
 *     clock, so the sentence reads on the same way after either;
 *   - French, Spanish and Italian read the day as they should.
 */

// A moment's placeholders: {{since}} since when, {{until}} until when, every other when.
const MOMENT_PLACEHOLDER_NAMES: ReadonlyArray<string> = [
  "time",
  "since",
  "until",
  "ended",
  "latest",
  "confirmed",
  "askedAt",
];

function momentPlaceholders(): RegExp {
  return new RegExp(`\\{\\{(${MOMENT_PLACEHOLDER_NAMES.join("|")})\\}\\}`, "g");
}

// The languages whose letters have no case: a sentence may start with a moment there.
const CASELESS: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

// The words English put before a moment before #10622.
const ENGLISH_MOMENT_WORDS: ReadonlyArray<string> = [
  "at",
  "on",
  "since",
  "until",
  "till",
  "from",
  "by",
];

interface MomentSentence {
  key: string;
  english: string;
  // The plural it is a form of, when it is one.
  plural: PluralTemplate | null;
  count: number;
}

function isPluralTemplate(value: unknown): value is PluralTemplate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
}

function hasMoment(text: string): boolean {
  return momentPlaceholders().test(text);
}

/*
 * Every sentence of a module of words that names a moment, each locale key
 * once - of the words whose name `isMoments` takes, where the module holds
 * others whose {{time}} is no moment's phrase ("Done {{time}}" is "5
 * minutes ago").
 */
function momentSentencesOf(
  words: Record<string, unknown>,
  isMoments: (name: string) => boolean = (): boolean => {
    return true;
  },
): Array<MomentSentence> {
  const sentences: Array<MomentSentence> = [];

  for (const [name, value] of Object.entries(words)) {
    if (!isMoments(name)) {
      continue;
    }

    if (typeof value === "string") {
      sentences.push({ key: value, english: value, plural: null, count: 0 });
    } else if (isPluralTemplate(value)) {
      sentences.push({
        key: value.other,
        english: value.other,
        plural: value,
        count: 3,
      });
      sentences.push({
        key: `${value.other}_one`,
        english: value.one,
        plural: value,
        count: 1,
      });
    }
  }

  return sentences.filter((sentence: MomentSentence): boolean => {
    return hasMoment(sentence.english);
  });
}

const MOMENT_SENTENCES: Array<MomentSentence> = Array.from(
  new Map<string, MomentSentence>(
    [
      // The checks' sentences; "OneUptime checked this {{time}}." is how long ago.
      ...momentSentencesOf(
        StepCheckWords as Record<string, unknown>,
        (name: string): boolean => {
          return name.startsWith("CHECK_");
        },
      ),
      // A block's line; the rest of the card's words fill {{time}} with how long ago.
      ...momentSentencesOf(
        SecurityCaseResponseCopy as Record<string, unknown>,
        (name: string): boolean => {
          return name.startsWith("BLOCK_LINE_");
        },
      ),
      ...momentSentencesOf(RefusedTelemetryCopy as Record<string, unknown>),
    ].map((sentence: MomentSentence): [string, MomentSentence] => {
      return [sentence.key, sentence];
    }),
  ).values(),
);

/*
 * Every locale key of a part a moment plays (#10902): each phrase - a time
 * alone, a day, a day read with a vowel first - and its one o'clock form.
 */
interface PhraseKey {
  // The phrase's form, as MOMENT_PHRASES names it.
  form: keyof MomentPhraseWords;
  key: string;
  // The placeholder its day is named by: none for a time alone.
  day: string | null;
}

function phraseKeysOf(role: MomentRole): Array<PhraseKey> {
  return MOMENT_PHRASE_FORMS.flatMap(
    (form: keyof MomentPhraseWords): Array<PhraseKey> => {
      const general: string = MOMENT_PHRASES[role][form].other;
      const day: string | null =
        form === "time" ? null : form === "day" ? "{{day}}" : "{{vowelDay}}";

      return [
        { form, key: general, day },
        { form, key: `${general}_one`, day },
      ];
    },
  );
}

interface LanguagePhrases {
  role: MomentRole;
  // Each form as the language words it, by its key.
  phrases: Array<PhraseKey & { words: string }>;
  // The general time and day phrases, as most of these checks read them.
  time: string;
  day: string;
}

function phrasesIn(language: string): Array<LanguagePhrases> {
  const words: Record<string, string> = readDashboardLocale(language);
  const english: Record<string, string> = readDashboardLocale("en");

  return MOMENT_ROLES.map((role: MomentRole): LanguagePhrases => {
    const phrases: Array<PhraseKey & { words: string }> = phraseKeysOf(
      role,
    ).map((phrase: PhraseKey): PhraseKey & { words: string } => {
      return {
        ...phrase,
        words: words[phrase.key] || english[phrase.key] || phrase.key,
      };
    });

    return {
      role,
      phrases,
      time: phrases[0]!.words,
      day: phrases[2]!.words,
    };
  });
}

function wordsOf(text: string): Array<string> {
  return text
    .split(/\s+/u)
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });
}

/*
 * What a language's phrases put before their first placeholder ("el",
 * "a las", "desde") and after their clock (Korean 에, Japanese まで, Hindi
 * तक): each whole, and each of its words.
 */
function phraseEdgesIn(language: string): {
  leads: Array<string>;
  tails: Array<string>;
} {
  const leads: Set<string> = new Set<string>();
  const tails: Set<string> = new Set<string>();

  for (const phrases of phrasesIn(language)) {
    for (const { words: phrase } of phrases.phrases) {
      const lead: string = phrase.slice(0, phrase.indexOf("{{")).trim();
      const tail: string = phrase
        .slice(phrase.lastIndexOf("}}") + 2)
        .trim()
        .replace(/[.,،]$/u, "");

      for (const edge of [lead, ...wordsOf(lead)]) {
        if (edge) {
          leads.add(edge.toLowerCase());
        }
      }

      for (const edge of [tail, ...wordsOf(tail)]) {
        if (edge) {
          tails.add(edge.toLowerCase());
        }
      }
    }
  }

  return { leads: Array.from(leads), tails: Array.from(tails) };
}

const LETTER: RegExp = /\p{L}/u;
// Scripts whose words are not set apart by spaces, or whose particles join the word before.
const JOINED_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function endsWithWord(text: string, word: string): boolean {
  const before: string = text.trimEnd().toLowerCase();

  if (!before.endsWith(word)) {
    return false;
  }

  if (JOINED_SCRIPT.test(word)) {
    return true;
  }

  const previous: string = before.charAt(before.length - word.length - 1);

  return !previous || !LETTER.test(previous);
}

function startsWithWord(text: string, word: string): boolean {
  const after: string = text.trimStart().toLowerCase();

  if (!after.startsWith(word)) {
    return false;
  }

  if (JOINED_SCRIPT.test(word)) {
    return true;
  }

  const next: string = after.charAt(word.length);

  return !next || !LETTER.test(next);
}

// A text with the no-break spaces a page sets read as plain spaces.
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/gu, " ");
}

// A moment on another day, and one today, as the card writes them.
const ANOTHER_DAY: WrittenMoment = {
  date: "27 nov",
  time: "14:25",
  whole: "27 nov, 14:25",
};
const TODAY: WrittenMoment = { date: null, time: "14:25", whole: "14:25" };

// A sentence in `language`, its moments as `moment`, every other value a name.
function render(data: {
  sentence: MomentSentence;
  translator: Translator;
  moment: WrittenMoment;
}): string {
  const values: TemplateValues = {};

  for (const match of data.sentence.english.matchAll(/\{\{(\w+)\}\}/g)) {
    const name: string = match[1]!;

    values[name] = MOMENT_PLACEHOLDER_NAMES.includes(name)
      ? momentPhrase(getMomentRole(name), data.moment)
      : "search-api";
  }

  return plain(
    data.sentence.plural
      ? data.translator.translatePlural(
          data.sentence.plural,
          data.sentence.count,
          values,
        )
      : data.translator.translateTemplate(data.sentence.key, values),
  );
}

describe("the sentences that name a moment", () => {
  test("are the step checks', a block's line and the refused telemetry's, each in en.json as written", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(MOMENT_SENTENCES.length).toBeGreaterThan(60);

    expect(
      MOMENT_SENTENCES.filter((sentence: MomentSentence): boolean => {
        return english[sentence.key] !== sentence.english;
      }).map((sentence: MomentSentence): string => {
        return sentence.key;
      }),
    ).toEqual([]);
  });

  test("write no preposition before a moment in English, and none is a sentence written before the moments brought their own", () => {
    const offenders: Array<string> = [];

    for (const sentence of MOMENT_SENTENCES) {
      if (STEP_CHECK_SENTENCES_BEFORE_MOMENT_PHRASES.has(sentence.key)) {
        offenders.push(`${sentence.key} (written before #10622)`);
      }

      for (const match of sentence.english.matchAll(momentPlaceholders())) {
        const before: string = sentence.english.slice(0, match.index);

        for (const word of ENGLISH_MOMENT_WORDS) {
          if (endsWithWord(before, word)) {
            offenders.push(`${sentence.key} ("${word} ${match[0]}")`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("are worded in every language the Dashboard speaks", () => {
    const untranslated: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const sentence of MOMENT_SENTENCES) {
        if (!isWordedInDashboardLocale(sentence.key, language)) {
          untranslated.push(`${language}: ${sentence.key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });
});

describe("a moment's phrases, in every language", () => {
  test("are worded, every form of each: a time alone, a day, a day read with a vowel first, and each at one o'clock", () => {
    const offenders: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const role of MOMENT_ROLES) {
        for (const { key } of phraseKeysOf(role)) {
          if (!isWordedInDashboardLocale(key, language)) {
            offenders.push(`${language}: "${key}" is not worded`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("hold each form to the placeholders of its phrase, and every form of a part to the same ending after the clock (#10902)", () => {
    const offenders: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const phrases of phrasesIn(language)) {
        const tails: Set<string> = new Set<string>();

        for (const phrase of phrases.phrases) {
          const words: string = phrase.words;
          const days: Array<string> = ["{{day}}", "{{vowelDay}}"].filter(
            (placeholder: string): boolean => {
              return words.includes(placeholder);
            },
          );

          if (
            !words.includes("{{clock}}") ||
            days.length !== (phrase.day ? 1 : 0) ||
            (phrase.day !== null && days[0] !== phrase.day)
          ) {
            offenders.push(`${language} ${phrase.key}: placeholders`);
          }

          tails.add(
            words.slice(words.indexOf("{{clock}}") + "{{clock}}".length),
          );
        }

        if (tails.size !== 1) {
          offenders.push(
            `${language} ${phrases.role}: its forms end differently (${Array.from(
              tails,
            )
              .map((tail: string): string => {
                return `"${tail}"`;
              })
              .join(", ")})`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("word a day read with a vowel first as the day itself, but in a language that reads one (#10902)", () => {
    const offenders: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      // A language that reads such days words its own (DAYS_READ_WITH_A_VOWEL).
      if (DAYS_READ_WITH_A_VOWEL[language]) {
        continue;
      }

      for (const phrases of phrasesIn(language)) {
        const byKey: Map<string, string> = new Map(
          phrases.phrases.map(
            (phrase: PhraseKey & { words: string }): [string, string] => {
              return [phrase.key, phrase.words];
            },
          ),
        );

        for (const suffix of ["", "_one"]) {
          const day: string =
            byKey.get(`${MOMENT_PHRASES[phrases.role].day.other}${suffix}`) ||
            "";
          const vowelDay: string =
            byKey.get(
              `${MOMENT_PHRASES[phrases.role].vowelDay.other}${suffix}`,
            ) || "";

          if (vowelDay !== day.replace("{{day}}", "{{vowelDay}}")) {
            offenders.push(`${language} ${phrases.role}${suffix}: ${vowelDay}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("a sentence leaves a moment's words to the moment", () => {
  test("no sentence starts with a moment where letters have a case", () => {
    const starts: RegExp = new RegExp(
      `(^|[.:?!]\\s+)\\{\\{(${MOMENT_PLACEHOLDER_NAMES.join("|")})\\}\\}`,
      "u",
    );
    const offenders: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      if (CASELESS.includes(language)) {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of MOMENT_SENTENCES) {
        const value: string | undefined = words[sentence.key];

        if (value && starts.test(value)) {
          offenders.push(`${language}: ${value}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no sentence writes the words a moment's phrase brings beside the moment", () => {
    const offenders: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const { leads, tails } = phraseEdgesIn(language);

      for (const sentence of MOMENT_SENTENCES) {
        const value: string | undefined = words[sentence.key];

        if (!value || value === sentence.english) {
          continue;
        }

        for (const match of value.matchAll(momentPlaceholders())) {
          const before: string = value.slice(0, match.index);
          const after: string = value.slice(match.index! + match[0].length);

          for (const lead of leads) {
            if (endsWithWord(before, lead)) {
              offenders.push(`${language}: "${lead} ${match[0]}" in ${value}`);
            }
          }

          for (const tail of tails) {
            if (startsWithWord(after, tail)) {
              offenders.push(`${language}: "${match[0]}${tail}" in ${value}`);
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("French, Spanish and Italian read a moment on another day as they should (#10622)", () => {
  const DAY_PHRASES: Record<string, Record<MomentRole, string>> = {
    es: {
      [MomentRole.At]: "el 27 nov a las 14:25",
      [MomentRole.Since]: "desde el 27 nov a las 14:25",
      [MomentRole.Until]: "hasta el 27 nov a las 14:25",
    },
    fr: {
      [MomentRole.At]: "le 27 nov à 14:25",
      [MomentRole.Since]: "depuis le 27 nov à 14:25",
      [MomentRole.Until]: "jusqu'au 27 nov à 14:25",
    },
    it: {
      [MomentRole.At]: "il 27 nov alle 14:25",
      [MomentRole.Since]: "dal 27 nov alle 14:25",
      [MomentRole.Until]: "fino al 27 nov alle 14:25",
    },
  };

  test.each(["es", "fr", "it"])(
    "%s: each phrase takes the day with its article, and every sentence reads it so, never a clock's preposition before a date",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const offenders: Array<string> = [];

      for (const role of MOMENT_ROLES) {
        expect(
          plain(
            translator.translateTemplate(MOMENT_PHRASES[role].day.other, {
              day: "27 nov",
              clock: "14:25",
            }),
          ),
        ).toBe(DAY_PHRASES[language]![role]);
      }

      // What a clock time alone takes before it: "a las", "à", "alle".
      const clockLeads: Array<string> = MOMENT_ROLES.map(
        (role: MomentRole): string => {
          const phrase: string = translator.translateTemplate(
            MOMENT_PHRASES[role].time.other,
            { clock: "" },
          );

          return plain(phrase).trim();
        },
      );

      for (const sentence of MOMENT_SENTENCES) {
        const onAnotherDay: string = render({
          sentence,
          translator,
          moment: ANOTHER_DAY,
        });
        const today: string = render({ sentence, translator, moment: TODAY });

        for (const lead of clockLeads) {
          if (onAnotherDay.includes(`${lead} 27 nov`)) {
            offenders.push(`"${lead} 27 nov" in ${onAnotherDay}`);
          }
        }

        const roles: Array<MomentRole> = Array.from(
          sentence.english.matchAll(momentPlaceholders()),
        ).map((match: RegExpMatchArray): MomentRole => {
          return getMomentRole(match[1]!);
        });

        for (const role of roles) {
          if (!onAnotherDay.includes(DAY_PHRASES[language]![role])) {
            offenders.push(
              `"${DAY_PHRASES[language]![role]}" missing from ${onAnotherDay}`,
            );
          }
        }

        if (onAnotherDay.includes("{{") || today.includes("{{")) {
          offenders.push(`unfilled: ${onAnotherDay}`);
        }
      }

      expect(offenders).toEqual([]);
    },
  );
});

describe("Spanish, Portuguese and Italian read a moment at one o'clock, and Italian on the 8th and the 11th, as they should (#10902)", () => {
  // A moment's phrases as each language reads them in every sentence.
  const CASES: Record<
    string,
    Array<{ moment: WrittenMoment; phrases: Record<MomentRole, string> }>
  > = {
    es: [
      {
        moment: { date: null, time: "1:25", whole: "1:25" },
        phrases: {
          [MomentRole.At]: "a la 1:25",
          [MomentRole.Since]: "desde la 1:25",
          [MomentRole.Until]: "hasta la 1:25",
        },
      },
      {
        moment: { date: "8 dic", time: "1:25", whole: "8 dic, 1:25" },
        phrases: {
          [MomentRole.At]: "el 8 dic a la 1:25",
          [MomentRole.Since]: "desde el 8 dic a la 1:25",
          [MomentRole.Until]: "hasta el 8 dic a la 1:25",
        },
      },
    ],
    pt: [
      {
        moment: { date: null, time: "1:25", whole: "1:25" },
        phrases: {
          [MomentRole.At]: "à 1:25",
          [MomentRole.Since]: "desde a 1:25",
          [MomentRole.Until]: "até a 1:25",
        },
      },
      {
        moment: { date: "8 de dez.", time: "0:25", whole: "8 de dez., 0:25" },
        phrases: {
          [MomentRole.At]: "em 8 de dez. à 0:25",
          [MomentRole.Since]: "desde 8 de dez. à 0:25",
          [MomentRole.Until]: "até 8 de dez. à 0:25",
        },
      },
    ],
    it: [
      {
        moment: { date: null, time: "1:25", whole: "1:25" },
        phrases: {
          [MomentRole.At]: "all'1:25",
          [MomentRole.Since]: "dall'1:25",
          [MomentRole.Until]: "fino all'1:25",
        },
      },
      {
        moment: { date: "8 dic", time: "14:25", whole: "8 dic, 14:25" },
        phrases: {
          [MomentRole.At]: "l'8 dic alle 14:25",
          [MomentRole.Since]: "dall'8 dic alle 14:25",
          [MomentRole.Until]: "fino all'8 dic alle 14:25",
        },
      },
      {
        moment: { date: "11 dic", time: "1:25", whole: "11 dic, 1:25" },
        phrases: {
          [MomentRole.At]: "l'11 dic all'1:25",
          [MomentRole.Since]: "dall'11 dic all'1:25",
          [MomentRole.Until]: "fino all'11 dic all'1:25",
        },
      },
      {
        moment: { date: "1 dic", time: "14:25", whole: "1 dic, 14:25" },
        phrases: {
          [MomentRole.At]: "il 1 dic alle 14:25",
          [MomentRole.Since]: "dal 1 dic alle 14:25",
          [MomentRole.Until]: "fino al 1 dic alle 14:25",
        },
      },
    ],
  };

  test.each(Object.keys(CASES))(
    "%s: every sentence that names a moment holds its form",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const offenders: Array<string> = [];

      for (const { moment, phrases } of CASES[language]!) {
        for (const sentence of MOMENT_SENTENCES) {
          const read: string = render({ sentence, translator, moment });
          const roles: Array<MomentRole> = Array.from(
            sentence.english.matchAll(momentPlaceholders()),
          ).map((match: RegExpMatchArray): MomentRole => {
            return getMomentRole(match[1]!);
          });

          for (const role of roles) {
            if (!read.includes(phrases[role])) {
              offenders.push(`"${phrases[role]}" missing from ${read}`);
            }
          }
        }
      }

      expect(offenders).toEqual([]);
    },
  );
});
