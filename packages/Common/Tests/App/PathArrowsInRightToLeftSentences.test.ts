// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { setCodeApartInSentence } from "../../Types/CodeInSentence";
import { replaceHtmlMarkup } from "../../Types/HtmlMarkup";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import { isolated } from "../Helpers/IsolateMarks";
import {
  PathArrow,
  getPathArrows,
  withArrowsDecoded,
} from "../Helpers/PathArrows";

/*
 * A PATH'S ARROWS POINT THE WAY ARABIC AND PERSIAN READ IT, IN EVERY APP.
 *
 * A browser draws "→" as it is written in a line read from the right: it
 * is not mirrored, as ">" and "›" are. The API Reference's Persian master
 * API key step said "داشبورد مدیریت → تنظیمات → کلید API", and each arrow
 * pointed back at the step before it: Settings led back to the Admin
 * Dashboard (#7585). Arabic and Persian write a path with "←"
 * (Locales/ARABIC.md); a path whose steps stay in Latin letters is drawn
 * from the left, as English draws it, and keeps "→".
 *
 * This guard reads every text of every app's locale files for a language
 * read from the right - the frontends', the server's, the API Reference's
 * and the docs' - lays each line out as a page draws it, with a copy of the
 * bidi algorithm (Helpers/BidiLayout, through Helpers/PathArrows), and
 * checks each arrow between two steps: "←" where the line is drawn from the
 * right, "→" where it is drawn from the left. An arrow at either end of a
 * text leads a link on or back ("مشاهده ←", "→ رجوع") and is no path's.
 *
 * A value ({{name}}) is filled both ways a page fills it: as it is, and set
 * apart in an isolate of its own. An arrow that points back either way is
 * the locale file's to fix; one whose way turns with the value
 * ("{{original}} → {{substitute}}") is decided by the page that fills it.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

// Every app's locale files.
const LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
  Server: "Common/Server/Locales",
  APIReference: "App/FeatureSet/APIReference/Locales",
  Docs: "App/FeatureSet/Docs/Locales",
};

/*
 * The apps whose i18next sets the code in a sentence read from the right
 * apart, as it hands the sentence to the page
 * (Common/UI/Utils/CodeReadsAsWritten). The server's texts go into emails
 * and chat messages as they are written; the API Reference and the docs
 * draw theirs into their pages' HTML.
 */
const FRONTENDS: ReadonlyArray<string> = [
  "Dashboard",
  "StatusPage",
  "Accounts",
  "AdminDashboard",
  "PublicDashboard",
];

type LocaleTree = { [key: string]: unknown };

interface LocaleText {
  app: string;
  language: string;
  key: string;
  text: string;
}

// Every text of a locale file, by its path of keys.
const textsOf: (
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
    } else if (value && typeof value === "object") {
      found.push(...textsOf(value as LocaleTree, at));
    }
  }

  return found;
};

// Every text of every app's locale file for a language read from the right.
const RIGHT_TO_LEFT_TEXTS: Array<LocaleText> = Object.entries(
  LOCALE_DIRS,
).flatMap(([app, directory]: [string, string]): Array<LocaleText> => {
  const folder: string = path.join(PACKAGES, directory);

  return fs
    .readdirSync(folder)
    .filter((file: string): boolean => {
      return (
        file.endsWith(".json") &&
        isRightToLeftLanguage(file.slice(0, -".json".length))
      );
    })
    .flatMap((file: string): Array<LocaleText> => {
      const language: string = file.slice(0, -".json".length);
      const tree: LocaleTree = JSON.parse(
        fs.readFileSync(path.join(folder, file), "utf8"),
      ) as LocaleTree;

      return textsOf(tree).map(([key, text]: [string, string]): LocaleText => {
        return { app, language, key, text };
      });
    });
});

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

// An element a page draws from the left, set apart from the words round it.
const CODE_ELEMENT: RegExp = /^<(\/?)(?:code|kbd|pre|samp)\b/i;

/*
 * A text's line as a page draws it: its tags taken out, what a code
 * element holds set apart from the left, and each arrow a reference names
 * written as the arrow.
 */
const asDrawn: (text: string) => string = (text: string): string => {
  return withArrowsDecoded(
    replaceHtmlMarkup(
      text,
      (markup: string): string => {
        const code: RegExpExecArray | null = CODE_ELEMENT.exec(markup);

        if (!code) {
          return "";
        }

        return code[1] ? PDI : LRI;
      },
      { lessThanAsText: true },
    ),
  );
};

// A value as a page fills it: as it is, or set apart in an isolate of its own.
type Fill = "as it is" | "set apart";

const FILLS: ReadonlyArray<Fill> = ["as it is", "set apart"];

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

const filled: (text: string, fill: Fill) => string = (
  text: string,
  fill: Fill,
): string => {
  return text.replace(PLACEHOLDER, (): string => {
    return fill === "set apart" ? isolated("x1") : "x1";
  });
};

interface ArrowInText {
  entry: LocaleText;
  arrow: string;
  // It points back however the page fills the text's values.
  pointsBack: boolean;
}

// The text as an app hands it to its page.
const handedToThePage: (entry: LocaleText) => string = (
  entry: LocaleText,
): string => {
  return FRONTENDS.includes(entry.app)
    ? setCodeApartInSentence(entry.text, entry.language)
    : entry.text;
};

// The arrows between the steps of a path in a text, each line laid out from the right.
const arrowsIn: (entry: LocaleText) => Array<ArrowInText> = (
  entry: LocaleText,
): Array<ArrowInText> => {
  const byFill: Array<Array<PathArrow>> = FILLS.map(
    (fill: Fill): Array<PathArrow> => {
      return asDrawn(filled(handedToThePage(entry), fill))
        .split("\n")
        .flatMap((line: string): Array<PathArrow> => {
          return getPathArrows(line, "rtl");
        });
    },
  );
  const asItIs: Array<PathArrow> = byFill[0] as Array<PathArrow>;

  return asItIs.map((arrow: PathArrow, nth: number): ArrowInText => {
    return {
      entry,
      arrow: arrow.arrow,
      pointsBack: byFill.every((arrows: Array<PathArrow>): boolean => {
        return Boolean(arrows[nth]?.pointsBack);
      }),
    };
  });
};

const ARROWS: Array<ArrowInText> = RIGHT_TO_LEFT_TEXTS.flatMap(arrowsIn);

const describeArrow: (found: ArrowInText) => string = (
  found: ArrowInText,
): string => {
  return `${found.entry.app} ${found.entry.language} "${found.entry.key}": ${found.arrow} points back | ${found.entry.text}`;
};

describe("a path's arrows in a language read from the right", () => {
  test("every app's locale files are read, and the paths in them", () => {
    const read: Set<string> = new Set<string>(
      RIGHT_TO_LEFT_TEXTS.map((entry: LocaleText): string => {
        return `${entry.app} ${entry.language}`;
      }),
    );

    expect(Array.from(read)).toEqual(
      expect.arrayContaining([
        "APIReference fa",
        "Accounts ar",
        "Accounts fa",
        "AdminDashboard ar",
        "AdminDashboard fa",
        "Dashboard ar",
        "Dashboard fa",
        "Docs fa",
        "PublicDashboard ar",
        "PublicDashboard fa",
        "Server ar",
        "Server fa",
        "StatusPage ar",
        "StatusPage fa",
      ]),
    );
    // Over five hundred: the Dashboard's guides, Accounts' passkey help, the API Reference's key step.
    expect(ARROWS.length).toBeGreaterThan(400);
  });

  test("every arrow between two steps points the way its line is drawn", () => {
    expect(
      ARROWS.filter((found: ArrowInText): boolean => {
        return found.pointsBack;
      }).map(describeArrow),
    ).toEqual([]);
  });
});

describe("the check", () => {
  // A Persian text of `app`'s locale file: the API Reference's unless named.
  const arrowsOf: (
    text: string,
    app?: string,
  ) => Array<{ arrow: string; pointsBack: boolean }> = (
    text: string,
    app: string = "APIReference",
  ): Array<{ arrow: string; pointsBack: boolean }> => {
    return arrowsIn({ app, language: "fa", key: "a sample", text }).map(
      (found: ArrowInText): { arrow: string; pointsBack: boolean } => {
        return { arrow: found.arrow, pointsBack: found.pointsBack };
      },
    );
  };

  test("catches the Persian master API key step as it was, and passes it with ←", () => {
    expect(
      arrowsOf(
        "به‌عنوان مدیر ارشد وارد نمونه خود شوید و به <strong>داشبورد مدیریت &rarr; تنظیمات &rarr; کلید API</strong> بروید.",
      ),
    ).toEqual([
      { arrow: "→", pointsBack: true },
      { arrow: "→", pointsBack: true },
    ]);
    expect(
      arrowsOf(
        "به‌عنوان مدیر ارشد وارد نمونه خود شوید و به <strong>داشبورد مدیریت &larr; تنظیمات &larr; کلید API</strong> بروید.",
      ),
    ).toEqual([
      { arrow: "←", pointsBack: false },
      { arrow: "←", pointsBack: false },
    ]);
  });

  test("reads the character and every reference a template writes it with", () => {
    for (const written of ["→", "&rarr;", "&#8594;", "&#x2192;"]) {
      expect(arrowsOf(`حوادث ${written} تنظیمات`)).toEqual([
        { arrow: "→", pointsBack: true },
      ]);
    }

    for (const written of ["←", "&larr;", "&#8592;", "&#X2190;"]) {
      expect(arrowsOf(`حوادث ${written} تنظیمات`)).toEqual([
        { arrow: "←", pointsBack: false },
      ]);
    }
  });

  test("keeps → in a path of Latin steps, and catches ← there", () => {
    // Drawn from the left inside the sentence, as English draws it.
    expect(
      arrowsOf(
        "**AWS Console → App Runner → Services ← خدمتك ← Configuration → Configure service**",
        "Dashboard",
      ),
    ).toEqual([
      { arrow: "→", pointsBack: false },
      { arrow: "→", pointsBack: false },
      { arrow: "←", pointsBack: false },
      { arrow: "←", pointsBack: false },
      { arrow: "→", pointsBack: false },
    ]);
    expect(
      arrowsOf("در رابط وب Proxmox به Datacenter ← Metric Server بروید"),
    ).toEqual([{ arrow: "←", pointsBack: true }]);
    // Between a Latin step and a Persian one, the line is drawn from the right.
    expect(arrowsOf("زبانهٔ **Security** → تأیید کنید")).toEqual([
      { arrow: "→", pointsBack: true },
    ]);
  });

  test("sets code apart as the page does", () => {
    /*
     * A frontend sets an arrow between two pieces of code apart with them,
     * as one piece drawn from the left: "→" points on there. The server's
     * texts go out as they are written, and between two numbers the same
     * arrow is drawn from the right.
     */
    expect(arrowsOf("مقدار `5` → `10` است", "Dashboard")).toEqual([
      { arrow: "→", pointsBack: false },
    ]);
    expect(arrowsOf("مقدار `5` → `10` است", "Server")).toEqual([
      { arrow: "→", pointsBack: true },
    ]);
    /*
     * The API Reference's stylesheet sets each code element apart: an arrow
     * between two of them is the Persian sentence's, drawn from the right.
     * Read as Latin steps, "logs" and "200" would have drawn it from the left.
     */
    expect(
      arrowsOf("به <code>GET /logs</code> &rarr; <code>200</code> نگاه کنید"),
    ).toEqual([{ arrow: "→", pointsBack: true }]);
    expect(
      arrowsOf("به <code>GET /logs</code> &larr; <code>200</code> نگاه کنید"),
    ).toEqual([{ arrow: "←", pointsBack: false }]);
  });

  test("leaves a link's arrow at either end alone", () => {
    expect(arrowsOf("مشاهده ←")).toEqual([]);
    expect(arrowsOf("→ رجوع")).toEqual([]);
    expect(arrowsOf("همهٔ متریک‌ها →")).toEqual([]);
  });

  test("leaves an arrow whose way turns with its values to the page, and catches one that points back either way", () => {
    // Latin names as they are draw it from the left; set apart, from the right.
    expect(arrowsOf("جایگزینی: {{original}} → {{substitute}}")).toEqual([
      { arrow: "→", pointsBack: false },
    ]);
    expect(arrowsOf("در پورتال: {{portal}} → کلید `oneuptime-token`")).toEqual([
      { arrow: "→", pointsBack: true },
    ]);
  });

  test("reads each line of a text on its own", () => {
    expect(arrowsOf("حوادث\n← تنظیمات")).toEqual([]);
    expect(arrowsOf("حوادث → تنظیمات\nSettings → AI")).toEqual([
      { arrow: "→", pointsBack: true },
      { arrow: "→", pointsBack: false },
    ]);
  });
});
