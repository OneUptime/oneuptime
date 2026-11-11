import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import {
  createTranslator,
  getTemplatePlaceholders,
  Translator,
} from "../../Types/Translator";
import { drawLine, isDrawnAsWritten } from "../Helpers/BidiLayout";
import { isolated } from "../Helpers/IsolateMarks";

/*
 * EVERY COUNT BESIDE A SLASH, AND EVERY NUMBER AFTER A NUMBER SIGN, IN
 * EVERY ARABIC AND PERSIAN SENTENCE, IS DRAWN AS THE SENTENCE WRITES IT.
 *
 * A sentence drawn on a page sets its values apart in Unicode isolates
 * (the Translator's setsValuesApart: TranslatedSentence,
 * translateTemplateAround). Each count set apart on its own, "{{online}}/
 * {{count}}" was drawn "5/3" in Arabic and Persian, and Persian's
 * "#{{number}}", whose right-to-left mark keeps the sign in front of the
 * number, "۴۲#". This guard fills every such sentence of every frontend's
 * locale files for a language read from the right - each value a number
 * written the language's way - as a page draws it, and lays it out with a
 * copy of the bidi algorithm (Helpers/BidiLayout): each pair of counts is
 * drawn as written, and each number after a number sign as the sentence
 * draws it with nothing set apart. Each count set apart on its own, the
 * pairs were drawn back to front - the guard's negative control.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const FRONTEND_LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
};

const RLM: string = String.fromCharCode(0x200f);

// Two values with one slash or colon between them: "{{online}}/{{count}}".
const PAIR_OF_VALUES: RegExp =
  /\{\{\s*([\w.]+)\s*\}\}([/:])\{\{\s*([\w.]+)\s*\}\}/g;

// A value after a number sign: "#{{number}}".
const VALUE_AFTER_NUMBER_SIGN: RegExp = /(.?)#\{\{\s*([\w.]+)\s*\}\}/gu;

interface Sentence {
  app: string;
  language: string;
  key: string;
  text: string;
  translator: Translator;
}

// Every sentence with a value of every frontend's locale file for a language read from the right.
const SENTENCES: Array<Sentence> = Object.entries(FRONTEND_LOCALE_DIRS).flatMap(
  ([app, directory]: [string, string]): Array<Sentence> => {
    const folder: string = path.join(PACKAGES, directory);

    return fs
      .readdirSync(folder)
      .filter((file: string): boolean => {
        return (
          file.endsWith(".json") &&
          isRightToLeftLanguage(file.slice(0, -".json".length))
        );
      })
      .flatMap((file: string): Array<Sentence> => {
        const language: string = file.slice(0, -".json".length);
        const words: Record<string, unknown> = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ) as Record<string, unknown>;
        // The frontend's lookup: a key's text, read as the Translator reads it.
        const translator: Translator = createTranslator(
          (text: string): string | undefined => {
            const value: unknown = words[text];

            return typeof value === "string" ? value : undefined;
          },
          language,
        );

        return Object.entries(words)
          .filter(([, text]: [string, unknown]): boolean => {
            return typeof text === "string" && text.includes("{{");
          })
          .map(([key, text]: [string, unknown]): Sentence => {
            return { app, language, key, text: text as string, translator };
          });
      });
  },
);

// Each value a number of its own, written the language's way: 3, 5, 7...
const numbersFor: (sentence: Sentence) => Record<string, string> = (
  sentence: Sentence,
): Record<string, string> => {
  const values: Record<string, string> = {};

  getTemplatePlaceholders(sentence.text).forEach(
    (name: string, index: number): void => {
      values[name] = sentence.translator.formatNumber(3 + index * 2);
    },
  );

  return values;
};

/*
 * Where each unit of `written` is in `shown`, the same text with isolates'
 * marks added: shown holds every unit of written, in order.
 */
const placesIn: (written: string, shown: string) => Array<number> = (
  written: string,
  shown: string,
): Array<number> => {
  const places: Array<number> = [];
  let at: number = 0;

  for (let index: number = 0; index < shown.length; index++) {
    if (at < written.length && shown[index] === written[at]) {
      places.push(index);
      at++;
    }
  }

  return places;
};

/*
 * Whether `piece` of `written` is drawn as written where `shown` - the same
 * sentence, with isolates' marks added - is laid out in a page read from
 * the right. Null when the sentence does not hold the piece.
 */
const isPieceDrawnAsWritten: (
  written: string,
  shown: string,
  piece: string,
) => boolean | null = (
  written: string,
  shown: string,
  piece: string,
): boolean | null => {
  const from: number = written.indexOf(piece);

  if (from < 0) {
    return null;
  }

  const places: Array<number> = placesIn(written, shown);

  return isDrawnAsWritten(
    drawLine(shown, "rtl"),
    places[from] as number,
    (places[from + piece.length - 1] as number) + 1,
  );
};

interface Drawing {
  sentence: Sentence;
  // The numbers and their sign, as the sentence writes them: "3/5", "#۴۲".
  piece: string;
  // After a right-to-left mark, which keeps the sign in front of the number.
  isAfterMark: boolean;
  // Whether the page's sentence holds the piece whole, with no isolate's mark in it.
  isWhole: boolean;
  // As a page draws the sentence: its values set apart where they need to be.
  onThePage: boolean | null;
  // With nothing set apart.
  asWritten: boolean | null;
  // With each value set apart on its own, as every number was before.
  eachSetApart: boolean | null;
}

const draw: (
  sentence: Sentence,
  values: Record<string, string>,
  piece: string,
  isAfterMark: boolean,
) => Drawing = (
  sentence: Sentence,
  values: Record<string, string>,
  piece: string,
  isAfterMark: boolean,
): Drawing => {
  const eachApart: Record<string, string> = {};

  for (const [name, value] of Object.entries(values)) {
    eachApart[name] = isolated(value);
  }

  const plain: string = sentence.translator.translateTemplate(
    sentence.key,
    values,
  );
  const onThePage: string = sentence.translator.translateTemplate(
    sentence.key,
    values,
    { setsValuesApart: true },
  );
  const setApart: string = sentence.translator.translateTemplate(
    sentence.key,
    eachApart,
  );

  return {
    sentence,
    piece,
    isAfterMark,
    isWhole: onThePage.includes(piece),
    onThePage: isPieceDrawnAsWritten(plain, onThePage, piece),
    asWritten: isPieceDrawnAsWritten(plain, plain, piece),
    eachSetApart: isPieceDrawnAsWritten(plain, setApart, piece),
  };
};

const PAIRS: Array<Drawing> = [];
const NUMBER_SIGNS: Array<Drawing> = [];

for (const sentence of SENTENCES) {
  const values: Record<string, string> = numbersFor(sentence);

  for (const match of sentence.text.matchAll(PAIR_OF_VALUES)) {
    const piece: string = `${values[match[1] as string]}${match[2]}${
      values[match[3] as string]
    }`;

    PAIRS.push(draw(sentence, values, piece, false));
  }

  for (const match of sentence.text.matchAll(VALUE_AFTER_NUMBER_SIGN)) {
    const piece: string = `#${values[match[2] as string]}`;

    NUMBER_SIGNS.push(draw(sentence, values, piece, match[1] === RLM));
  }
}

const describeDrawing: (drawing: Drawing) => string = (
  drawing: Drawing,
): string => {
  return `${drawing.sentence.app} ${drawing.sentence.language} "${drawing.sentence.key}": ${drawing.piece}`;
};

describe("counts beside a slash in a sentence read from the right", () => {
  test("there are such sentences, in Arabic and in Persian", () => {
    const languages: Set<string> = new Set<string>(
      PAIRS.map((drawing: Drawing): string => {
        return drawing.sentence.language;
      }),
    );

    expect([...languages].sort()).toEqual(expect.arrayContaining(["ar", "fa"]));
    expect(PAIRS.length).toBeGreaterThan(40);
  });

  test("every pair is drawn as written on the page: 3/5, never 5/3", () => {
    const wrong: Array<string> = PAIRS.filter((drawing: Drawing): boolean => {
      return !drawing.isWhole || drawing.onThePage !== true;
    }).map(describeDrawing);

    expect(wrong).toEqual([]);
  });

  test("as it is drawn with nothing set apart", () => {
    const different: Array<string> = PAIRS.filter(
      (drawing: Drawing): boolean => {
        return drawing.onThePage !== drawing.asWritten;
      },
    ).map(describeDrawing);

    expect(different).toEqual([]);
  });

  /*
   * The negative control: each count set apart on its own, as the
   * Translator set every number apart in a translated sentence before,
   * the pairs were drawn back to front.
   */
  test("each count set apart on its own, dozens were drawn back to front", () => {
    const backToFront: Array<Drawing> = PAIRS.filter(
      (drawing: Drawing): boolean => {
        return (
          drawing.sentence.text !== drawing.sentence.key &&
          drawing.eachSetApart === false
        );
      },
    );

    expect(backToFront.length).toBeGreaterThan(40);

    for (const language of ["ar", "fa"]) {
      expect({
        language,
        backToFront: backToFront.some((drawing: Drawing): boolean => {
          return drawing.sentence.language === language;
        }),
      }).toEqual({ language, backToFront: true });
    }
  });
});

describe("a number after a number sign in a sentence read from the right", () => {
  test("there are such sentences, Persian's behind a right-to-left mark", () => {
    expect(NUMBER_SIGNS.length).toBeGreaterThan(10);
    expect(
      NUMBER_SIGNS.filter((drawing: Drawing): boolean => {
        return drawing.isAfterMark;
      }).length,
    ).toBeGreaterThan(5);
  });

  test("each is drawn on the page as the sentence draws it with nothing set apart", () => {
    const different: Array<string> = NUMBER_SIGNS.filter(
      (drawing: Drawing): boolean => {
        return (
          !drawing.isWhole ||
          drawing.onThePage === null ||
          drawing.onThePage !== drawing.asWritten
        );
      },
    ).map(describeDrawing);

    expect(different).toEqual([]);
  });

  test("behind a right-to-left mark, with the sign in front of the number: #۴۲", () => {
    const wrong: Array<string> = NUMBER_SIGNS.filter(
      (drawing: Drawing): boolean => {
        return drawing.isAfterMark && drawing.onThePage !== true;
      },
    ).map(describeDrawing);

    expect(wrong).toEqual([]);
  });

  /*
   * Persian draws the sign in front of the number, "#۴۲" (ARABIC.md,
   * Numbers in a sentence): only the mark keeps it there. After a Persian
   * word and a space, the number is read as an Arabic number and the sign as
   * the sentence's, drawn "۴۲#" - the AI log's "کار #{{taskNumber}}" link
   * was, beside every other Persian task, incident and alert number.
   */
  test("every Persian one stands behind a right-to-left mark", () => {
    const persian: Array<Drawing> = NUMBER_SIGNS.filter(
      (drawing: Drawing): boolean => {
        return drawing.sentence.language === "fa";
      },
    );

    expect(persian.length).toBeGreaterThan(5);
    expect(
      persian
        .filter((drawing: Drawing): boolean => {
          return !drawing.isAfterMark || drawing.onThePage !== true;
        })
        .map(describeDrawing),
    ).toEqual([]);
  });

  // The negative control: the number set apart lost its sign, "۴۲#".
  test("the number set apart on its own was drawn after its sign", () => {
    const wrong: Array<Drawing> = NUMBER_SIGNS.filter(
      (drawing: Drawing): boolean => {
        return drawing.isAfterMark && drawing.eachSetApart === false;
      },
    );

    expect(wrong.length).toBeGreaterThan(5);
  });
});
