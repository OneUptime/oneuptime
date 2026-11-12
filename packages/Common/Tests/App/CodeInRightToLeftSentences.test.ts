import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getCodeInSentence,
  setCodeApartInSentence,
} from "../../Types/CodeInSentence";
import {
  getTextReadingDirectionByMostLetters,
  isRightToLeftLanguage,
  LEFT_TO_RIGHT,
  RIGHT_TO_LEFT,
} from "../../Types/ReadingDirection";
import { escapeRegExp } from "../../Utils/RegExpEscape";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../Helpers/BidiLayout";
import { withoutIsolateMarks } from "../Helpers/IsolateMarks";

/*
 * CODE IN EVERY ARABIC AND PERSIAN SENTENCE IS DRAWN AS IT IS WRITTEN.
 *
 * Every frontend's i18next sets the code in a sentence of a language read
 * from the right apart in a left-to-right isolate as it hands the sentence
 * to the page (Common/UI/Utils/CodeReadsAsWritten). This guard reads every
 * sentence of every such locale file the frontends ship - Arabic and
 * Persian today, any language read from the right tomorrow - finds the
 * code each names (a function with its brackets, a path, a flag, a file
 * named from a dot, an address's scheme) and lays the sentence out with a
 * copy of the bidi algorithm (Helpers/BidiLayout), as the page shows it:
 * each piece of code must be drawn as it is written. Laid out as the
 * locale file holds it, hundreds were not - the guard's negative control.
 *
 * A value ({{name}}) is filled both ways a page fills it: as it is, and
 * set apart in an isolate of its own (the Translator's setsValuesApart).
 *
 * The server's texts (Common/Server/Locales) are not handed to a page by
 * i18next and are left out: an email or a chat message is laid out by
 * whatever shows it.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const FRONTEND_LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
};

// A letter of the Arabic script, Persian's among them.
const ARABIC_SCRIPT: RegExp = /[\u{0600}-\u{06FF}]/u;

const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{Nd}]/u;

const FSI: string = String.fromCharCode(0x2068);
const PDI: string = String.fromCharCode(0x2069);
const LRM: string = String.fromCharCode(0x200e);

/*
 * A negative number as Intl writes it for Persian: a left-to-right mark,
 * then the minus sign (U+2212), then the digits - the mark ties the minus
 * to its number in a line read from the right (issue #7102,
 * NegativeNumbersInRightToLeftSentences). No code: the mark stays.
 */
const INTL_NEGATIVE_SIGN: string = `${LRM}${String.fromCharCode(0x2212)}`;

type LocaleTree = { [key: string]: string | LocaleTree };

interface Sentence {
  app: string;
  language: string;
  key: string;
  // The sentence as en.json words it.
  english: string;
  text: string;
}

// Every leaf of a locale file, keyed by its path of keys.
const leavesOf: (
  tree: LocaleTree,
  prefix?: string,
) => Array<[string, string]> = (
  tree: LocaleTree,
  prefix: string = "",
): Array<[string, string]> => {
  const found: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix} > ${key}` : key;

    if (typeof value === "string") {
      found.push([at, value]);
    } else {
      found.push(...leavesOf(value, at));
    }
  }

  return found;
};

// Every language read from the right that a frontend has a locale file for.
const RIGHT_TO_LEFT_SENTENCES: Array<Sentence> = Object.entries(
  FRONTEND_LOCALE_DIRS,
).flatMap(([app, directory]: [string, string]): Array<Sentence> => {
  const folder: string = path.join(PACKAGES, directory);
  const readTree: (file: string) => LocaleTree = (file: string): LocaleTree => {
    return JSON.parse(
      fs.readFileSync(path.join(folder, file), "utf8"),
    ) as LocaleTree;
  };
  const english: Map<string, string> = new Map<string, string>(
    leavesOf(readTree("en.json")),
  );

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

      return leavesOf(readTree(file)).map(
        ([key, text]: [string, string]): Sentence => {
          return {
            app,
            language,
            key,
            english: english.get(key) ?? key,
            text,
          };
        },
      );
    });
});

/*
 * The code a sentence names, as a reader would copy it: the full stop or
 * comma after it is the sentence's.
 */
const CODE_PATTERNS: Record<string, RegExp> = {
  // "oneuptime.captureMetric()", "track('signup')", "getItem(2)".
  function:
    /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\s\u{0600}-\u{06FF}]{0,80}\)/gu,
  // "/api/v1/users", "/.well-known/openid-configuration", "~/.ssh".
  path: /(?<![\w/.:~<\]{}*-])(?:~|\.{1,2})?\/(?=[\w.*{])[\w.*:@{}+-]*(?:\/[\w.*:@{}+-]*)*/gu,
  // "--help", "-e", "--config=env:OTEL".
  flag: /(?<![\w\-.])--?[A-Za-z][\w-]*(?:=[^\s\u{0600}-\u{06FF}\u{060C}«»"'`)]+)?/gu,
  // ".env", ".NET", ".oneuptime.yaml".
  file: /(?<![\w./-])\.[A-Za-z][\w-]*(?:\.[\w-]+)*/gu,
  // "https://", "webcal://", "app://".
  scheme:
    /(?<![\w.])[a-z][a-z0-9+.-]*:\/\/[^\s\u{0600}-\u{06FF}\u{060C}«»"'`()<>]*/gu,
};

// Where code cannot be: an HTML tag, a Markdown link's target, a placeholder.
const NOT_DRAWN: RegExp =
  /<\/?[A-Za-z0-9][^<>]*>|\]\([^()\s]*\)|\{\{[^{}]*\}\}/gu;

const SENTENCE_STOPS: RegExp = /[.,:;!?\u{2026}]+$/u;

interface CodeAt {
  pattern: string;
  code: string;
  start: number;
  end: number;
}

// The code a line names, each piece once, where it sits in the line.
const findCode: (line: string) => Array<CodeAt> = (
  line: string,
): Array<CodeAt> => {
  const hidden: Array<[number, number]> = [];

  for (const match of line.matchAll(NOT_DRAWN)) {
    hidden.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }

  const found: Array<CodeAt> = [];

  for (const [pattern, regex] of Object.entries(CODE_PATTERNS)) {
    for (const match of line.matchAll(regex)) {
      const start: number = match.index ?? 0;
      const code: string = match[0].replace(SENTENCE_STOPS, "");
      const end: number = start + code.length;

      if (code.length < 2) {
        continue;
      }

      const isHidden: boolean = hidden.some(
        ([from, to]: [number, number]): boolean => {
          return start < to && end > from;
        },
      );

      if (!isHidden) {
        found.push({ pattern, code, start, end });
      }
    }
  }

  return found;
};

// A value as a page fills it: as it is, or set apart in an isolate of its own.
type Fill = "as it is" | "set apart";

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/gu;

const filled: (text: string, fill: Fill) => string = (
  text: string,
  fill: Fill,
): string => {
  return text.replace(PLACEHOLDER, (): string => {
    return fill === "set apart" ? `${FSI}x1${PDI}` : "x1";
  });
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

  places.push(shown.length);

  return places;
};

interface Drawing {
  sentence: Sentence;
  fill: Fill;
  code: CodeAt;
  asWritten: boolean;
  drawn: string;
}

// Every piece of code in every sentence, laid out as `shownBy` hands the sentence to the page.
const drawEveryCode: (
  shownBy: (sentence: Sentence) => string,
) => Array<Drawing> = (
  shownBy: (sentence: Sentence) => string,
): Array<Drawing> => {
  const drawings: Array<Drawing> = [];

  for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
    if (!ARABIC_SCRIPT.test(sentence.text)) {
      continue;
    }

    for (const fill of ["as it is", "set apart"] as Array<Fill>) {
      const writtenLines: Array<string> = filled(sentence.text, fill).split(
        "\n",
      );
      const shownLines: Array<string> = filled(shownBy(sentence), fill).split(
        "\n",
      );

      writtenLines.forEach((written: string, lineIndex: number): void => {
        const codes: Array<CodeAt> = findCode(written);

        if (codes.length === 0) {
          return;
        }

        const shown: string = shownLines[lineIndex] as string;
        const places: Array<number> = placesIn(written, shown);
        const line: DrawnLine = drawLine(shown, "rtl");

        for (const code of codes) {
          drawings.push({
            sentence,
            fill,
            code,
            asWritten: isDrawnAsWritten(
              line,
              places[code.start] as number,
              (places[code.end - 1] as number) + 1,
            ),
            drawn: getDrawnText(line),
          });
        }
      });
    }
  }

  return drawings;
};

const AS_THE_PAGE_SHOWS: Array<Drawing> = drawEveryCode(
  (sentence: Sentence): string => {
    return setCodeApartInSentence(sentence.text, sentence.language);
  },
);

const AS_THE_FILE_HOLDS: Array<Drawing> = drawEveryCode(
  (sentence: Sentence): string => {
    return sentence.text;
  },
);

const describeDrawing: (drawing: Drawing) => string = (
  drawing: Drawing,
): string => {
  return `${drawing.sentence.app} ${drawing.sentence.language} "${drawing.sentence.key}" (${drawing.fill}): ${drawing.code.code} | drawn: ${drawing.drawn}`;
};

describe("code in a sentence read from the right, on the page", () => {
  test("there are such sentences, and code in them", () => {
    const languages: Set<string> = new Set<string>(
      RIGHT_TO_LEFT_SENTENCES.map((sentence: Sentence): string => {
        return sentence.language;
      }),
    );

    expect([...languages].sort()).toEqual(expect.arrayContaining(["ar", "fa"]));
    expect(AS_THE_PAGE_SHOWS.length).toBeGreaterThan(1000);
  });

  test("every piece is drawn as it is written", () => {
    const wrong: Array<string> = AS_THE_PAGE_SHOWS.filter(
      (drawing: Drawing): boolean => {
        return !drawing.asWritten;
      },
    ).map(describeDrawing);

    expect(wrong).toEqual([]);
  });

  /*
   * The negative control: laid out as the locale files hold them, the
   * same sentences drew hundreds of pieces of code wrongly - of every
   * kind the guard looks for - so the guard can see what it guards.
   */
  test("as the locale files hold them, hundreds were not", () => {
    const wrong: Array<Drawing> = AS_THE_FILE_HOLDS.filter(
      (drawing: Drawing): boolean => {
        return !drawing.asWritten;
      },
    );

    expect(wrong.length).toBeGreaterThan(300);

    for (const pattern of Object.keys(CODE_PATTERNS)) {
      expect({
        pattern,
        wrong: wrong.some((drawing: Drawing): boolean => {
          return drawing.code.pattern === pattern;
        }),
      }).toEqual({ pattern, wrong: true });
    }
  });
});

/*
 * A help line under a field or a switch is laid out the way most of its
 * letters read when that is not the page's way (readAsWritten, over
 * Types/ReadingDirection's getTextReadingDirectionByMostLetters): an
 * English line left untranslated on an Arabic page reads from the left.
 * The code an Arabic sentence names is in Latin letters, and in a sentence
 * that names a path and an address they outnumber its Arabic ones: counted,
 * the whole sentence was laid out from the left, its Arabic words in the
 * wrong order. Set apart, the code is not counted, nor is an address; the
 * words round them are.
 */
describe("the words round the code", () => {
  const RIGHT_TO_LEFT_LETTER: RegExp = /\p{Script=Arabic}|\p{Script=Hebrew}/u;
  const LETTER: RegExp = /\p{L}/u;

  // How many letters each way in the sentence once its code is taken out.
  const lettersRoundTheCode: (sentence: Sentence) => {
    rightToLeft: number;
    leftToRight: number;
  } = (sentence: Sentence): { rightToLeft: number; leftToRight: number } => {
    let rest: string = "";
    let at: number = 0;

    for (const code of getCodeInSentence(sentence.text)) {
      rest += sentence.text.slice(at, code.start);
      at = code.end;
    }

    rest += sentence.text.slice(at);

    const letters: Array<string> = Array.from(rest).filter(
      (character: string): boolean => {
        return LETTER.test(character);
      },
    );
    const rightToLeft: number = letters.filter((letter: string): boolean => {
      return RIGHT_TO_LEFT_LETTER.test(letter);
    }).length;

    return { rightToLeft, leftToRight: letters.length - rightToLeft };
  };

  // Sentences with code to set apart, whose own words are mostly Arabic or Persian.
  const MOSTLY_RIGHT_TO_LEFT: Array<Sentence> = RIGHT_TO_LEFT_SENTENCES.filter(
    (sentence: Sentence): boolean => {
      if (getCodeInSentence(sentence.text).length === 0) {
        return false;
      }

      const letters: { rightToLeft: number; leftToRight: number } =
        lettersRoundTheCode(sentence);

      return letters.rightToLeft > letters.leftToRight;
    },
  );

  test("decide which way the sentence is laid out", () => {
    const turned: Array<string> = MOSTLY_RIGHT_TO_LEFT.filter(
      (sentence: Sentence): boolean => {
        return (
          getTextReadingDirectionByMostLetters(
            setCodeApartInSentence(sentence.text, sentence.language),
          ) !== RIGHT_TO_LEFT
        );
      },
    ).map((sentence: Sentence): string => {
      return `${sentence.app} ${sentence.language} "${sentence.key}": ${sentence.text}`;
    });

    expect(MOSTLY_RIGHT_TO_LEFT.length).toBeGreaterThan(500);
    expect(turned).toEqual([]);
  });

  /*
   * The negative control: counted with their code, dozens of them, in
   * both languages - the Persian help of the OIDC discovery URL among
   * them - read from the left.
   */
  test("counted with their code, dozens were laid out from the left", () => {
    const turned: Array<Sentence> = MOSTLY_RIGHT_TO_LEFT.filter(
      (sentence: Sentence): boolean => {
        return (
          getTextReadingDirectionByMostLetters(sentence.text) === LEFT_TO_RIGHT
        );
      },
    );
    const oidc: string =
      "OIDC discovery document URL — usually ends in /.well-known/openid-configuration.";

    expect(turned.length).toBeGreaterThan(40);
    expect(
      new Set(
        turned.map((sentence: Sentence): string => {
          return sentence.language;
        }),
      ),
    ).toEqual(new Set(["ar", "fa"]));
    expect(
      turned.some((sentence: Sentence): boolean => {
        return (
          sentence.app === "Dashboard" &&
          sentence.language === "fa" &&
          sentence.key === oidc
        );
      }),
    ).toBe(true);
  });
});

describe("what the page is handed", () => {
  test("is the locale file's sentence with marks added, and nothing else", () => {
    for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
      const shown: string = setCodeApartInSentence(
        sentence.text,
        sentence.language,
      );

      if (withoutIsolateMarks(shown) !== sentence.text) {
        expect(`${sentence.app} ${sentence.key}: ${shown}`).toBe(sentence.text);
      }
    }
  });

  test("handed again, it is not set apart twice", () => {
    for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
      const shown: string = setCodeApartInSentence(
        sentence.text,
        sentence.language,
      );

      if (setCodeApartInSentence(shown, sentence.language) !== shown) {
        expect(`${sentence.app} ${sentence.key}`).toBe("set apart once");
      }
    }
  });

  test("a sentence with no code is handed as it is", () => {
    for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
      if (getCodeInSentence(sentence.text).length === 0) {
        expect(setCodeApartInSentence(sentence.text, sentence.language)).toBe(
          sentence.text,
        );
      }
    }
  });
});

describe("a mark a translator placed by hand", () => {
  // The words of `text` that hold a left-to-right mark beside a letter or a digit.
  const marksBesideWords: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return text
      .split(/\s+/u)
      .map((written: string): string => {
        // Intl's own negative sign ties a minus to its number: no code.
        return written.split(INTL_NEGATIVE_SIGN).join("");
      })
      .filter((run: string): boolean => {
        return (
          run.includes(LRM) && LETTER_OR_DIGIT.test(run.split(LRM).join(""))
        );
      });
  };

  /*
   * A left-to-right mark (LRM) was how a Persian sentence kept "--help"
   * from reading "help--". The page now sets code apart itself, so a mark
   * beside code is one more character to copy: it is left only round a
   * sign that is no code - a key's "{" or "<" - which nothing sets apart,
   * and before a negative number's minus sign, as Intl writes it.
   */
  test("is never beside code", () => {
    const besideCode: Array<string> = [];

    for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
      for (const run of marksBesideWords(sentence.text)) {
        besideCode.push(
          `${sentence.app} ${sentence.language} "${sentence.key}": ${run}`,
        );
      }
    }

    expect(besideCode).toEqual([]);
  });

  test("before a negative number's minus sign is Intl's own, not a mark beside code", () => {
    const minusSign: string = String.fromCharCode(0x2212);

    expect(marksBesideWords(`زیر ${LRM}${minusSign}۱۰۰ dBm`)).toEqual([]);
    // A mark beside a flag, or a bare one before a number, is still found.
    expect(marksBesideWords(`از ${LRM}--help${LRM} استفاده کنید`)).toEqual([
      `${LRM}--help${LRM}`,
    ]);
    expect(marksBesideWords(`زیر ${LRM}-۱۰۰ dBm`)).toEqual([`${LRM}-۱۰۰`]);
  });

  /*
   * A key's sign named in brackets - the "}" and "{" that step to the
   * newer or older session, the "<" and ">" that slow a replay down or
   * speed it up - is no code, and nothing sets it apart. Read from the
   * right, a bracket or an angle is drawn mirrored: the reader saw "{"
   * where the key is "}". A mark on each side of the sign keeps it the
   * key it is; without them, every one was mirrored.
   */
  test("on each side of a key's sign keeps it unmirrored", () => {
    const KEY_SIGNS: Record<string, Array<string>> = {
      "Newer session by this user (})": ["}"],
      "Older session by this user ({)": ["{"],
      "Playback speed (< slower, > faster)": ["<", ">"],
    };
    const checked: Array<string> = [];
    const mirrored: Array<string> = [];
    const mirroredWithoutMarks: Array<string> = [];

    const isMirrored: (line: string, sign: string) => boolean = (
      line: string,
      sign: string,
    ): boolean => {
      const drawn: DrawnLine = drawLine(line, "rtl");

      return drawn.units.some((unit: string, index: number): boolean => {
        return unit === sign && (drawn.levels[index] as number) % 2 === 1;
      });
    };

    for (const sentence of RIGHT_TO_LEFT_SENTENCES) {
      const signs: Array<string> | undefined = KEY_SIGNS[sentence.key];

      if (sentence.app !== "Dashboard" || !signs) {
        continue;
      }

      const shown: string = setCodeApartInSentence(
        sentence.text,
        sentence.language,
      );

      for (const sign of signs) {
        checked.push(`${sentence.language} ${sign}`);

        if (isMirrored(shown, sign)) {
          mirrored.push(`${sentence.language} "${sentence.key}": ${sign}`);
        }

        if (isMirrored(shown.split(LRM).join(""), sign)) {
          mirroredWithoutMarks.push(`${sentence.language} ${sign}`);
        }
      }
    }

    expect(mirrored).toEqual([]);
    // Arabic and Persian, each sign: and every one mirrored without its marks.
    expect(checked.length).toBeGreaterThanOrEqual(8);
    expect(mirroredWithoutMarks).toEqual(checked);
  });
});

/*
 * Code an English sentence names with a sign in front - a path's slash, a
 * file's dot, a flag's dashes - is written so in the translation: ".env",
 * not "env"; "--disable-metric", not "disable-metric". Arabic had dropped
 * the sign wherever the browser drew it at the code's far end; the page
 * sets code apart now (Locales/ARABIC.md), so the code is written as it is
 * typed.
 */
describe("code the English names with a sign in front", () => {
  const CODE_WITH_A_SIGN_IN_FRONT: RegExp =
    /(?<![\w/.:~-])(?:\/\.?[\w.-]+(?:\/[\w.-]+)*|\.[A-Za-z][\w-]*|--?[A-Za-z][\w-]*)/g;

  // `code` where it stands on its own in `text`, not inside other code.
  const standingAlone: (code: string) => RegExp = (code: string): RegExp => {
    return new RegExp(`(?<![\\w/.:~-])${escapeRegExp(code)}(?![\\w/-])`, "g");
  };

  // The code an English sentence names with a sign in front, as it is typed.
  const codeWithASign: (english: string) => Array<string> = (
    english: string,
  ): Array<string> => {
    return (english.match(CODE_WITH_A_SIGN_IN_FRONT) || [])
      .map((code: string): string => {
        return code.replace(/\.+$/, "");
      })
      .filter((code: string): boolean => {
        return code.replace(/^[/.-]+/, "").length >= 3;
      });
  };

  // Each piece of `codes` a translation names without its sign in front.
  const withoutTheirSign: (
    codes: Array<string>,
    translation: string,
  ) => Array<string> = (
    codes: Array<string>,
    translation: string,
  ): Array<string> => {
    return codes.filter((code: string): boolean => {
      if (translation.includes(code)) {
        return false;
      }

      const bare: string = code.replace(/^[/.-]+/, "");

      return new RegExp(`(?<![\\w/.-])${escapeRegExp(bare)}(?!\\w)`).test(
        translation,
      );
    });
  };

  const translated: Array<Sentence> = RIGHT_TO_LEFT_SENTENCES.filter(
    (sentence: Sentence): boolean => {
      return (
        sentence.text !== sentence.english && ARABIC_SCRIPT.test(sentence.text)
      );
    },
  );

  test("keeps the sign in the translation", () => {
    const dropped: Array<string> = [];

    for (const sentence of translated) {
      for (const code of withoutTheirSign(
        codeWithASign(sentence.english),
        sentence.text,
      )) {
        dropped.push(
          `${sentence.app} ${sentence.language} "${sentence.key}": ${code}`,
        );
      }
    }

    expect(dropped).toEqual([]);
  });

  // The negative control: each such code with its sign taken off is seen.
  test("written without it, it is seen", () => {
    let written: number = 0;
    const missed: Array<string> = [];

    for (const sentence of translated) {
      for (const code of codeWithASign(sentence.english)) {
        const occurrences: number = sentence.text.split(code).length - 1;
        const alone: number = (sentence.text.match(standingAlone(code)) || [])
          .length;

        // Only code the translation writes on its own, every time.
        if (occurrences === 0 || alone !== occurrences) {
          continue;
        }

        written += 1;

        const bare: string = code.replace(/^[/.-]+/, "");
        const withoutSign: string = sentence.text.replace(
          standingAlone(code),
          (): string => {
            return bare;
          },
        );

        if (withoutTheirSign([code], withoutSign).length === 0) {
          missed.push(`${sentence.language} "${sentence.key}": ${code}`);
        }
      }
    }

    expect(missed).toEqual([]);
    expect(written).toBeGreaterThan(300);
  });
});
