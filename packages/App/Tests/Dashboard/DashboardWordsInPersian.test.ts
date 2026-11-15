// UX rule: Docs/ux/README.md#in-every-language
import {
  getEnglishEntries,
  getNestedEnglishEntries,
  NestedEnglishEntry,
  scanSourceRoots,
  SOURCE_ROOTS,
  SourceScanResult,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { setCodeApartInSentence } from "Common/Types/CodeInSentence";
import {
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { Translator } from "Common/Types/Translator";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "Common/Types/Cloud/CloudResourceCatalog";
import { getAllCephAlertTemplates } from "Common/Types/Monitor/CephAlertTemplates";
import { getAllOpenStackAlertTemplates } from "Common/Types/Monitor/OpenStackAlertTemplates";
import { getAllVMwareAlertTemplates } from "Common/Types/Monitor/VMwareAlertTemplates";
import { isEnglishCopy } from "../../FeatureSet/Docs/Utils/Translations";

/*
 * THE DASHBOARD, IN PERSIAN (#7089).
 *
 * When #7089 was filed, 9,496 of the Persian Dashboard's strings were still
 * their English: whole pages - archives, label and owner rules, setup
 * guides, billing, a user's on-call methods, monitor step summaries, AI
 * insights, the telemetry tables' columns - read in English under a menu and
 * headings in Persian. Every string the Dashboard draws - its own pages and
 * components, Common's components, the models' field names and the catalogs
 * npm run i18n:extract reads - now reads in Persian, or stays as written on
 * purpose: a name, a code or an example, on a same-as-English list. The sentences with code that
 * #6733 translates, and the authenticator apps help it names, are left to
 * it.
 *
 * The whole Persian file is held to what a translation must keep from its
 * English - every placeholder, tag and `code`, every number, the spaces at
 * either end a page joins pieces with, its last stop - and to Persian
 * writing: Persian letters, digits and punctuation, a zero-width non-joiner
 * only between two letters. Two Persian texts that had traded places (a
 * router list said "every read answers 401") are back where they belong.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const APPS: string = path.resolve(__dirname, "../../FeatureSet");

type LocaleTree = { [key: string]: string | LocaleTree };

const ch: (code: number) => string = (code: number): string => {
  return String.fromCharCode(code);
};

// A character no key has, to join a nested key's path.
const PATH_JOINER: string = ch(0);
const ZERO_WIDTH_NON_JOINER: string = ch(0x200c);
const PERSIAN_QUESTION_MARK: string = ch(0x61f);
const PERSIAN_COMMA: string = ch(0x60c);
const PERSIAN_THOUSANDS_SEPARATOR: string = ch(0x66c);
const PERSIAN_DECIMAL_SEPARATOR: string = ch(0x66b);
const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";
// The Arabic block, where every Persian letter is.
const PERSIAN_LETTERS: string = `${ch(0x600)}-${ch(0x6ff)}`;
// Arabic's yeh and kaf: Persian writes its own (ی, ک).
const ARABIC_YEH_OR_KAF: RegExp = new RegExp(`[${ch(0x64a)}${ch(0x643)}]`);
// ٠-٩: Persian counts in ۰-۹, and writes codes in Latin digits.
const ARABIC_INDIC_DIGIT: RegExp = new RegExp(`[${ch(0x660)}-${ch(0x669)}]`);
// A Persian word followed by a Latin comma, semicolon or question mark.
const LATIN_PUNCTUATION_AFTER_PERSIAN: RegExp = new RegExp(
  `[${PERSIAN_LETTERS}][,;?](?=\\s|$)`,
);
// A non-joiner at a word's edge, or two together: it only joins two letters.
const LOOSE_NON_JOINER: RegExp = new RegExp(
  `(^|\\s)${ZERO_WIDTH_NON_JOINER}|${ZERO_WIDTH_NON_JOINER}(\\s|$)|${ZERO_WIDTH_NON_JOINER}${ZERO_WIDTH_NON_JOINER}`,
);
const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;
const PLACEHOLDER_OR_TAG: RegExp = /\{\{[^}]*\}\}|<\/?[A-Za-z][^<>]*>/g;
const CODE_SPAN: RegExp = /`[^`]*`/g;
const NUMBER: RegExp = /[0-9]+/g;
// A thousands comma between Latin digits: 10,000.
const LATIN_THOUSANDS_COMMA: RegExp = /(?<=[0-9]),(?=[0-9]{3})/g;
const UNUSED_PLURAL_FORM: RegExp = /_(zero|two|few|many)$/;
const LETTER: RegExp = /\p{L}/u;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readTree(app: string, language: string): LocaleTree {
  return readJson<LocaleTree>(
    path.join(APPS, app, "src/Locales", `${language}.json`),
  );
}

// Every text of a locale file, keyed by its path of keys.
function leaves(tree: LocaleTree, prefix: string = ""): Map<string, string> {
  const found: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix}${PATH_JOINER}${key}` : key;

    if (typeof value === "string") {
      found.set(at, value);
    } else {
      for (const [inner, text] of leaves(value, at)) {
        found.set(inner, text);
      }
    }
  }

  return found;
}

function uniqueSorted(values: ReadonlyArray<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

const ENGLISH: Map<string, string> = leaves(readTree("Dashboard", "en"));
const PERSIAN: Map<string, string> = leaves(readTree("Dashboard", "fa"));
const ARABIC: Map<string, string> = leaves(readTree("Dashboard", "ar"));

const PERSIAN_KEPT: ReadonlyArray<string> =
  readJson<{
    sameAsEnglish?: Array<string>;
  }>(path.join(DASHBOARD, "i18n/Progress/fa.json")).sameAsEnglish || [];
const KEPT_EVERYWHERE: ReadonlyArray<string> = readJson<Array<string>>(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
);

// Whether Persian keeps `english` as written on purpose: a name, a code, an example.
function isKeptAsWritten(english: string): boolean {
  return (
    !LETTER.test(english.replace(PLACEHOLDER, "")) ||
    KEPT_EVERYWHERE.includes(english) ||
    PERSIAN_KEPT.includes(english)
  );
}

// The texts Persian words its own way: the ones every check below reads.
const WORDED: Array<[string, string, string]> = Array.from(ENGLISH)
  .filter(([key, english]: [string, string]): boolean => {
    return PERSIAN.get(key) !== english;
  })
  .map(([key, english]: [string, string]): [string, string, string] => {
    return [key, english, PERSIAN.get(key) as string];
  });

// What a check found wrong, by key, with the Persian it found it in.
function findWrong(
  isWrong: (english: string, persian: string, key: string) => boolean,
): Array<string> {
  return WORDED.filter(
    ([key, english, persian]: [string, string, string]): boolean => {
      return isWrong(english, persian, key);
    },
  ).map(([key, , persian]: [string, string, string]): string => {
    return `${key} => ${persian}`;
  });
}

function tokensOf(text: string, pattern: RegExp): Array<string> {
  return uniqueSorted(text.match(pattern) || []);
}

// The numbers a text says, in Latin digits, its thousands separators gone.
function numbersOf(text: string): Array<string> {
  let digits: string = text.replace(PLACEHOLDER, " ");

  for (let digit: number = 0; digit < 10; digit++) {
    digits = digits.split(PERSIAN_DIGITS[digit] as string).join(String(digit));
  }

  digits = digits
    .split(PERSIAN_THOUSANDS_SEPARATOR)
    .join("")
    .split(PERSIAN_DECIMAL_SEPARATOR)
    .join(".")
    .replace(LATIN_THOUSANDS_COMMA, "");

  return uniqueSorted(digits.match(NUMBER) || []);
}

// Whether `persian` says a number its English does not: a sign two texts traded places.
function saysANumberEnglishDoesNot(english: string, persian: string): boolean {
  const englishNumbers: Array<string> = numbersOf(english);

  return numbersOf(persian).some((number: string): boolean => {
    return !englishNumbers.includes(number);
  });
}

function leadingSpace(text: string): string {
  return text.slice(0, text.length - text.trimStart().length);
}

function trailingSpace(text: string): string {
  return text.slice(text.trimEnd().length);
}

// An abbreviation's dots at the end of a name: "U.S.".
const ABBREVIATION_AT_END: RegExp = new RegExp("(?:\\b[A-Z]\\.){2,}$");

// Whether `persian` ends as `english` does: its stop, its question, its three dots.
function endsAsEnglishDoes(english: string, persian: string): boolean {
  const englishEnd: string = english.trimEnd();
  const persianEnd: string = persian.trimEnd();

  if (englishEnd.endsWith("...") || englishEnd.endsWith(ch(0x2026))) {
    return persianEnd.endsWith("...") || persianEnd.endsWith(ch(0x2026));
  }

  if (englishEnd.endsWith("?")) {
    return persianEnd.endsWith(PERSIAN_QUESTION_MARK);
  }

  /*
   * A name that ends in an abbreviation ("Virgin Islands, U.S.") has no full
   * stop of its own: Persian writes the name out ("... ایالات متحده").
   */
  if (ABBREVIATION_AT_END.test(englishEnd)) {
    return !persianEnd.endsWith(".");
  }

  for (const stop of [".", ":", "!"]) {
    if (englishEnd.endsWith(stop)) {
      return persianEnd.endsWith(stop);
    }
  }

  // A label or a fragment: no full stop of its own (a bracketed example may close one).
  return !persianEnd.endsWith(".") || englishEnd.endsWith(")");
}

/*
 * A typed example of names the field splits at Latin commas: the Teams
 * channels a notification rule posts to. Its Persian keeps the comma the
 * field reads.
 */
const SPLIT_AT_LATIN_COMMAS: ReadonlyArray<string> = ["Incidents, General"];

/*
 * #6733 TRANSLATES THESE: every sentence with code the page sets apart (its
 * Arabic changes when the code is set apart), and the authenticator apps
 * help, by the issue's own list.
 */
const AUTHENTICATOR_HELP: string =
  "Get a one-time code from an app such as 1Password, Google Authenticator, or Microsoft Authenticator.";

function isLeftToIssue6733(key: string): boolean {
  if (key === AUTHENTICATOR_HELP) {
    return true;
  }

  const arabic: string | undefined = ARABIC.get(key);

  return (
    arabic !== undefined && setCodeApartInSentence(arabic, "ar") !== arabic
  );
}

/*
 * What the Dashboard draws, read from every source npm run i18n:extract
 * reads: its own pages and components, Common's components, the database
 * and analytics models' field names, and the catalogs and helpers whose
 * words it shows.
 */
const SCAN: SourceScanResult = scanSourceRoots(SOURCE_ROOTS);
const PAGE_KEYS: Array<string> = Object.keys(
  getEnglishEntries(SCAN.strings),
).filter((key: string): boolean => {
  return ENGLISH.has(key);
});
const NESTED_KEYS: Array<NestedEnglishEntry> = getNestedEnglishEntries(
  SCAN.strings,
);

describe("what the Dashboard draws, in Persian", () => {
  test("the scan reads every source the extractor reads: tens of thousands of strings", () => {
    expect(SOURCE_ROOTS.length).toBeGreaterThan(20);
    expect(PAGE_KEYS.length).toBeGreaterThan(30000);
    expect(NESTED_KEYS.length).toBeGreaterThan(50);

    // Pages, components and model fields #7089 met in English, each found by the scan.
    for (const key of [
      "Team Audit Logs",
      "Add notification method",
      "Storage Array Label Rules",
      "Re-sync Autopay",
      "Exception spike",
      "Health Rollup",
      "{{count}} requests per minute",
      "{{count}} requests per minute_one",
      // Common's components: the time picker and the table views.
      "Save as New View",
      // The models' field names and descriptions.
      "Capacity Before (%)",
      "Accepted Invitation At",
    ]) {
      expect({ key, drawn: PAGE_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
    }
  });

  test("every string they draw reads in Persian, or stays as written on purpose", () => {
    const english: Array<string> = PAGE_KEYS.filter((key: string): boolean => {
      return !isWordedInDashboardLocale(key, "fa") && !isLeftToIssue6733(key);
    });

    expect(english).toEqual([]);
  });

  test("every nested key they read reads in Persian", () => {
    const english: Array<string> = NESTED_KEYS.filter(
      (entry: NestedEnglishEntry): boolean => {
        const key: string = entry.path.join(PATH_JOINER);
        const value: string | undefined = ENGLISH.get(key);

        return (
          value !== undefined &&
          PERSIAN.get(key) === value &&
          !isKeptAsWritten(value)
        );
      },
    ).map((entry: NestedEnglishEntry): string => {
      return entry.path.join(".");
    });

    expect(english).toEqual([]);
  });

  test("what is left in English is only #6733's: sentences with code, and the authenticator help", () => {
    const left: Array<string> = PAGE_KEYS.filter((key: string): boolean => {
      return !isWordedInDashboardLocale(key, "fa");
    });

    for (const key of left) {
      expect({ key, issue6733: isLeftToIssue6733(key) }).toEqual({
        key,
        issue6733: true,
      });
    }

    // #6733 counts 74 sentences with code, and the authenticator help.
    expect(left.length).toBeLessThanOrEqual(75);
  });

  test("the #6733 check finds code the page sets apart, and nothing in a plain sentence (control)", () => {
    expect(isLeftToIssue6733(AUTHENTICATOR_HELP)).toBe(true);
    expect(isLeftToIssue6733("Team Audit Logs")).toBe(false);
    expect(isLeftToIssue6733("Add notification method")).toBe(false);

    const withCode: Array<string> = Array.from(ARABIC.keys()).filter(
      (key: string): boolean => {
        return isLeftToIssue6733(key) && key !== AUTHENTICATOR_HELP;
      },
    );

    // Arabic sets code apart in hundreds of sentences (#6733 counts 378).
    expect(withCode.length).toBeGreaterThan(300);
  });
});

describe("Persian's Dashboard locale file", () => {
  test("has exactly English's keys, in English's order", () => {
    expect(Array.from(PERSIAN.keys())).toEqual(Array.from(ENGLISH.keys()));
    expect(ENGLISH.size).toBeGreaterThan(40000);
  });

  test("has none of the plural keys English does not have", () => {
    expect(
      Array.from(PERSIAN.keys()).filter((key: string): boolean => {
        return UNUSED_PLURAL_FORM.test(key);
      }),
    ).toEqual([]);
  });

  test("words tens of thousands of texts its own way", () => {
    expect(WORDED.length).toBeGreaterThan(40000);
  });

  test("a Persian text keeps every placeholder and tag of its English, and adds none", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return (
          tokensOf(persian, PLACEHOLDER_OR_TAG).join("|") !==
          tokensOf(english, PLACEHOLDER_OR_TAG).join("|")
        );
      }),
    ).toEqual([]);
  });

  test("a Persian text keeps every `code` of its English, exactly as written", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return (
          tokensOf(persian, CODE_SPAN).join("|") !==
          tokensOf(english, CODE_SPAN).join("|")
        );
      }),
    ).toEqual([]);
  });

  test("a Persian text says no number its English does not", () => {
    expect(findWrong(saysANumberEnglishDoesNot)).toEqual([]);
  });

  test("the number check catches two texts that trade places (control)", () => {
    const routers: string =
      "Every router in this cloud, and the L3 agents that hold each one. On OVN no agent holds a router, so that reads Not applicable.";
    const reads: string =
      "Every read answers 401 with an access-rule credential";
    const routersInPersian: string = PERSIAN.get(routers) as string;
    const readsInPersian: string = PERSIAN.get(reads) as string;

    expect(saysANumberEnglishDoesNot(routers, readsInPersian)).toBe(true);
    expect(saysANumberEnglishDoesNot(reads, routersInPersian)).toBe(true);
    expect(saysANumberEnglishDoesNot(routers, routersInPersian)).toBe(false);
    expect(saysANumberEnglishDoesNot(reads, readsInPersian)).toBe(false);
    // Persian digits and separators read as the number they write.
    expect(numbersOf("۱۰٬۰۰۰ مورد، ۳٫۵ ثانیه")).toEqual(
      numbersOf("10,000 items, 3.5 seconds"),
    );
  });

  test("the two texts that had traded places say their own English", () => {
    expect(
      PERSIAN.get(
        "Every router in this cloud, and the L3 agents that hold each one. On OVN no agent holds a router, so that reads Not applicable.",
      ),
    ).toBe(
      "هر روتر در این ابر و عامل‌های L3 که هر کدام را نگه می‌دارند. در OVN هیچ عاملی روتر را نگه نمی‌دارد، پس «کاربرد ندارد» نشان داده می‌شود.",
    );
    expect(
      PERSIAN.get("Every read answers 401 with an access-rule credential"),
    ).toBe("هر خواندن با اعتبارنامه access-rule پاسخ 401 می‌دهد");
  });

  test("the router help quotes Not applicable as the router's agents cell draws it", () => {
    const drawn: string = PERSIAN.get("Not applicable") as string;
    const sentences: Array<string> = Array.from(ENGLISH.keys()).filter(
      (key: string): boolean => {
        return key.endsWith("reads Not applicable.");
      },
    );

    expect(drawn).toBe("کاربرد ندارد");
    expect(sentences.length).toBe(3);

    for (const sentence of sentences) {
      expect({
        sentence,
        quotes: (PERSIAN.get(sentence) as string).includes(`«${drawn}»`),
      }).toEqual({ sentence, quotes: true });
    }
  });

  test("writes Persian letters, and no Arabic-Indic digit", () => {
    expect(
      findWrong((_english: string, persian: string): boolean => {
        return (
          ARABIC_YEH_OR_KAF.test(persian) || ARABIC_INDIC_DIGIT.test(persian)
        );
      }),
    ).toEqual([]);
  });

  test("puts Persian punctuation after a Persian word, but in a typed list of names", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return (
          LATIN_PUNCTUATION_AFTER_PERSIAN.test(persian) &&
          !SPLIT_AT_LATIN_COMMAS.includes(english)
        );
      }),
    ).toEqual([]);
    expect(PERSIAN.get("Incidents, General")).toContain(",");
    expect(PERSIAN.get("Incidents, General")).not.toContain(PERSIAN_COMMA);
  });

  test("a zero-width non-joiner only ever joins two letters", () => {
    expect(
      findWrong((_english: string, persian: string): boolean => {
        return LOOSE_NON_JOINER.test(persian);
      }),
    ).toEqual([]);
  });

  test("keeps the spaces English has at either end, where a page joins it to the next piece", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return (
          leadingSpace(persian) !== leadingSpace(english) ||
          trailingSpace(persian) !== trailingSpace(english)
        );
      }),
    ).toEqual([]);

    // Pieces a page joins to a name or a time, which had lost their space.
    expect(PERSIAN.get("Host ")).toBe("میزبان ");
    expect(PERSIAN.get("Checked ")).toBe("بررسی‌شده ");
    expect(PERSIAN.get(" compared by ")).toBe(" مقایسه‌شده بر اساس ");
  });

  test("ends as its English does: a full stop, a Persian question mark, three dots", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return !endsAsEnglishDoes(english, persian);
      }),
    ).toEqual([]);
  });

  test("writes no backslash its English does not", () => {
    expect(
      findWrong((english: string, persian: string): boolean => {
        return persian.includes("\\") && !english.includes("\\");
      }),
    ).toEqual([]);
  });

  test("a one form keeps the count wherever English's does", () => {
    expect(
      findWrong((english: string, persian: string, key: string): boolean => {
        return (
          key.endsWith("_one") &&
          english.includes("{{count}}") &&
          !persian.includes("{{count}}")
        );
      }),
    ).toEqual([]);
  });
});

/*
 * The titles the Dashboard repeats for every kind of resource read the same
 * way in Persian on every one of them: #7089 worded dozens of them, beside
 * the ones that were Persian already.
 */
describe("the titles every resource repeats, worded alike", () => {
  const titled: (englishTitle: RegExp) => Array<[string, string, string]> = (
    englishTitle: RegExp,
  ): Array<[string, string, string]> => {
    return WORDED.filter(([, english]: [string, string, string]): boolean => {
      return englishTitle.test(english);
    });
  };

  const notWorded: (
    rows: Array<[string, string, string]>,
    persianTitle: RegExp,
  ) => Array<string> = (
    rows: Array<[string, string, string]>,
    persianTitle: RegExp,
  ): Array<string> => {
    return rows
      .filter(([, , persian]: [string, string, string]): boolean => {
        return !persianTitle.test(persian);
      })
      .map(([, english, persian]: [string, string, string]): string => {
        return `${english} => ${persian}`;
      });
  };

  test("a resource's audit logs are گزارش‌های ممیزی", () => {
    const rows: Array<[string, string, string]> = titled(
      /^(?!Enable |Export )[A-Z][\w ]* Audit Logs$/,
    );

    expect(rows.length).toBeGreaterThan(40);
    expect(notWorded(rows, /^گزارش‌های ممیزی /)).toEqual([]);
  });

  test("its label rules are قواعد برچسب, and its owner rules قواعد مالکیت", () => {
    const labelRules: Array<[string, string, string]> = titled(
      /^[A-Z][\w ]* Label Rules$/,
    );
    const ownerRules: Array<[string, string, string]> = titled(
      /^(?!Open )[A-Z][\w ]* Owner Rules$/,
    );

    expect(labelRules.length).toBeGreaterThan(25);
    expect(ownerRules.length).toBeGreaterThan(25);
    expect(notWorded(labelRules, /^قواعد برچسب /)).toEqual([]);
    expect(notWorded(ownerRules, /^قواعد مالکیت /)).toEqual([]);
  });

  test("how its rules work is asked the same way", () => {
    const labelRules: Array<[string, string, string]> = titled(
      /^How [\w ]+ Label Rules Work$/,
    );
    const ownerRules: Array<[string, string, string]> = titled(
      /^How [\w ]+ Owner Rules Work$/,
    );

    expect(labelRules.length).toBeGreaterThan(25);
    expect(ownerRules.length).toBeGreaterThan(25);
    expect(notWorded(labelRules, /^قواعد برچسب .+ چگونه کار می‌کنند$/)).toEqual(
      [],
    );
    expect(
      notWorded(ownerRules, /^قواعد مالکیت .+ چگونه کار می‌کنند$/),
    ).toEqual([]);
  });

  test("its feed is فید, and its archive بایگانی‌شده", () => {
    const feeds: Array<[string, string, string]> = titled(/^[A-Z][\w ]* Feed$/);
    const archives: Array<[string, string, string]> = titled(
      /^Archived (?!At$)[A-Z]/,
    );

    expect(feeds.length).toBeGreaterThan(20);
    expect(archives.length).toBeGreaterThan(30);
    expect(notWorded(feeds, /^فید /)).toEqual([]);
    expect(notWorded(archives, /بایگانی‌شده/)).toEqual([]);
  });

  /*
   * A column that says when something happened reads "زمان ..." or "تاریخ
   * ..." (the time, the date of ...), as most of the file's timestamp titles
   * do: "زمان ارسال" for Sent At, never "ارسال در", a bare "at" a reader
   * waits to see finished. A threshold says where to act, not when, and the
   * older titles worded with a bare "در" before #7089 are #7289's to reword:
   * those lists only shrink.
   */
  const THRESHOLD_TITLES: ReadonlyArray<string> = [
    "Alert At",
    "Open a Case At",
  ];
  const OLDER_TIMESTAMP_TITLES_ENDING_IN_AT: ReadonlyArray<string> = [
    "End Announcement At",
    "End Showing Announcement At",
    "Ends At",
    "Event Starts At",
    "First Event Ends At",
    "First Event Scheduled At",
    "First Event Starts At",
    "First Refused At",
    "First Seen At",
    "Last Alert Added At",
    "Last Email Received At",
    "Last Incident Added At",
    "Last Monitored At",
    "Last Ping At",
    "Last Refused At",
    "Last Request Received At",
    "Last Seen At",
    "Last Synced At",
    "Logs Last Received At",
    "Metrics Last Received At",
    "Monitor Status Check At",
    "Monitored At",
    "Next Check At",
    "Notification Sent At",
    "Postmortem Published At",
    "Scheduled At",
    "Seen At",
    "Send First Report At",
    "Starts At",
    "Traces Last Received At",
  ];
  const ENDS_IN_A_BARE_AT: RegExp = / در$/;

  test("a timestamp column says when it happened: زمان or تاریخ, never a bare در at its end", () => {
    const rows: Array<[string, string, string]> = titled(
      /^[A-Z][A-Za-z0-9 ()/-]* At$/,
    );

    expect(rows.length).toBeGreaterThan(250);
    expect(
      rows
        .filter(([, english, persian]: [string, string, string]): boolean => {
          return (
            ENDS_IN_A_BARE_AT.test(persian) &&
            !THRESHOLD_TITLES.includes(english) &&
            !OLDER_TIMESTAMP_TITLES_ENDING_IN_AT.includes(english)
          );
        })
        .map(([, english, persian]: [string, string, string]): string => {
          return `${english} => ${persian}`;
        }),
    ).toEqual([]);

    // Each title on those lists is still there, and still ends that way.
    for (const english of [
      ...THRESHOLD_TITLES,
      ...OLDER_TIMESTAMP_TITLES_ENDING_IN_AT,
    ]) {
      expect({
        english,
        bareAt: ENDS_IN_A_BARE_AT.test(PERSIAN.get(english) || ""),
      }).toEqual({ english, bareAt: true });
    }
  });

  test.each([
    ["Sent At", "زمان ارسال"],
    ["Deleted At", "زمان حذف"],
    ["Executed At", "زمان اجرا"],
    ["Last Active At", "زمان آخرین فعالیت"],
    // A license is پروانه, never مجوز (#7340).
    ["Enterprise License Expires At", "تاریخ انقضای پروانهٔ سازمانی"],
    ["Schedule First Event At", "زمان اولین رویداد زمان‌بندی‌شده"],
    // The titles that were Persian before #7089 read the same way.
    ["Created At", "تاریخ ساخت"],
    ["Archived At", "زمان بایگانی"],
  ])("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
  });
});

/*
 * A TIMEOUT IS مهلت (#7607): a time limit, and the moment one runs out is
 * پایان مهلت. Persian named the same setting two ways - Request Timeout on
 * an HTTP monitor's form read "وقفه درخواست", the same field's row on the
 * Template sync settings card "مهلت درخواست" - and وقفه is a pause, not a
 * time limit. Every text whose English says timeout now says مهلت, and وقفه
 * is left only where its English means a pause, for the reason listed.
 */
describe("a timeout is مهلت, never وقفه", () => {
  const DEADLINE: string = "مهلت";
  const PAUSE: string = "وقفه";
  // Timeout, timeouts, time out, timed out, timing out.
  const SAYS_TIMEOUT: RegExp = /\btim(?:e|ed|ing)[\s-]?outs?\b/i;
  // The noun: a setting, a label, the timeouts a probe counts.
  const SAYS_A_TIMEOUT: RegExp = /\btime-?outs?\b/i;

  // Where Persian keeps وقفه, because the English means a pause.
  const PAUSES: ReadonlyArray<{ english: RegExp; why: string }> = [
    {
      english: /\bcool-?down\b/i,
      why: "the AI re-investigation cooldown is a wait before an alert or incident on the same monitor is investigated again: a pause",
    },
  ];

  // The texts Persian words whose English, outside its placeholders, says `pattern`.
  const saying: (pattern: RegExp) => Array<[string, string, string]> = (
    pattern: RegExp,
  ): Array<[string, string, string]> => {
    return WORDED.filter(([, english]: [string, string, string]): boolean => {
      return pattern.test(english.replace(PLACEHOLDER, " "));
    });
  };

  const listed: (rows: Array<[string, string, string]>) => Array<string> = (
    rows: Array<[string, string, string]>,
  ): Array<string> => {
    return rows.map(([, english, persian]: [string, string, string]) => {
      return `${english} => ${persian}`;
    });
  };

  // The timeouts among `rows` worded as a pause.
  const wordedAsAPause: (
    rows: Array<[string, string, string]>,
  ) => Array<string> = (rows: Array<[string, string, string]>) => {
    return listed(
      rows.filter(([, , persian]: [string, string, string]): boolean => {
        return persian.includes(PAUSE);
      }),
    );
  };

  test("no text whose English says timeout calls it وقفه", () => {
    const timeouts: Array<[string, string, string]> = saying(SAYS_TIMEOUT);

    // Many: a scan that finds none would pass.
    expect(timeouts.length).toBeGreaterThan(60);
    expect(wordedAsAPause(timeouts)).toEqual([]);
  });

  test("every timeout Persian words says مهلت", () => {
    const timeouts: Array<[string, string, string]> = saying(SAYS_A_TIMEOUT);

    expect(timeouts.length).toBeGreaterThan(60);
    expect(
      listed(
        timeouts.filter(([, , persian]: [string, string, string]): boolean => {
          return !persian.includes(DEADLINE);
        }),
      ),
    ).toEqual([]);
  });

  test("وقفه is left only where the English means a pause", () => {
    const pauses: Array<[string, string, string]> = WORDED.filter(
      ([, , persian]: [string, string, string]): boolean => {
        return persian.includes(PAUSE);
      },
    );
    const unexplained: Array<[string, string, string]> = pauses.filter(
      ([, english]: [string, string, string]): boolean => {
        return !PAUSES.some((pause: { english: RegExp }): boolean => {
          return pause.english.test(english);
        });
      },
    );

    expect(pauses.length).toBeGreaterThan(10);
    expect(listed(unexplained)).toEqual([]);

    // Each pause listed is still one the file says.
    for (const pause of PAUSES) {
      expect({
        why: pause.why,
        said: pauses.some(([, english]: [string, string, string]): boolean => {
          return pause.english.test(english);
        }),
      }).toEqual({ why: pause.why, said: true });
    }
  });

  test("the check finds a timeout worded as a pause (control)", () => {
    expect(
      wordedAsAPause([
        ["Request Timeout", "Request Timeout", "وقفه درخواست"],
        ["Request timeout", "Request timeout", "مهلت درخواست"],
      ]),
    ).toEqual(["Request Timeout => وقفه درخواست"]);
  });

  test.each([
    ["Request Timeout", "Request timeout"],
    ["Connection Timeout", "Connection timeout"],
    ["Statement Timeout", "Statement timeout"],
    ["Lookup Timeout", "Lookup timeout"],
  ])(
    "a monitor form's %s and the Template sync settings card's %s name one field alike",
    (formLabel: string, syncCardLabel: string) => {
      expect(PERSIAN.get(formLabel)).toBe(PERSIAN.get(syncCardLabel));
      expect(PERSIAN.get(formLabel)?.startsWith(`${DEADLINE} `)).toBe(true);
    },
  );
});

/*
 * THE PERSIAN DOCS, AS THE CHECKS BELOW READ THEM.
 *
 * Every page under Docs/Content/fa, a line at a time, outside its fenced
 * code. A check reads a line's prose: what is left once the names the line
 * quotes as drawn in English, its code, its link targets, its addresses and
 * its identifiers are out - what a reader copies, and the names a page
 * draws in English.
 */
const DOCS_CONTENT: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Content",
);
const DOCS: string = path.join(DOCS_CONTENT, "fa");
const FENCE: RegExp = /^\s*```/;
const LINK_TARGET: RegExp = /\]\([^)]*\)/g;
const ADDRESS: RegExp = /https?:\/\/\S+/g;
// A label, a field, a path or a host: availability_zone, zone_id, Microsoft.Network/dnszones.
const DOCS_IDENTIFIER: RegExp = /[A-Za-z0-9]+(?:[_./-][A-Za-z0-9]+)+/g;

function markdownFilesIn(folder: string): Array<string> {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const at: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return markdownFilesIn(at);
      }

      return at.endsWith(".md") ? [at] : [];
    });
}

// Each line of a page outside its fenced code, with its number.
function proseLinesOf(markdown: string): Array<[number, string]> {
  const lines: Array<[number, string]> = [];
  let isFenced: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (FENCE.test(line)) {
      isFenced = !isFenced;
    } else if (!isFenced) {
      lines.push([index + 1, line]);
    }
  });

  return lines;
}

// A docs line without the names it quotes as drawn in English, its code, its link targets, its addresses and its identifiers.
function docsProseOf(line: string, names: ReadonlyArray<string>): string {
  let prose: string = line;

  for (const name of names) {
    prose = prose.split(name).join(" ");
  }

  return prose
    .replace(CODE_SPAN, " ")
    .replace(LINK_TARGET, " ")
    .replace(ADDRESS, " ")
    .replace(DOCS_IDENTIFIER, " ");
}

// Every Persian page, by its path under Content/fa, with its markdown.
const DOCS_PAGES: Array<[string, string]> = markdownFilesIn(DOCS).map(
  (file: string): [string, string] => {
    return [path.relative(DOCS, file), fs.readFileSync(file, "utf8")];
  },
);

/*
 * A CLOUD'S ZONES AND RECORDSETS, IN PERSIAN WORDS (#7629, #7679).
 *
 * Persian kept OpenStack's zones and recordsets in Latin letters - "DNS
 * zone", "DNS recordset", "Availability Zone", "این Zone" - in 69 texts,
 * though it says a DNS zone زُن on the DNS monitor ("Zone" -> "زُن") and
 * Arabic and the other languages word them. A zone is زُن now, a DNS zone
 * زُن DNS, an availability zone زُن دسترس‌پذیری and a recordset
 * مجموعه‌رکورد, in every text at once, so no page names one thing two ways.
 * Time zones are not these: a time zone is منطقه زمانی.
 *
 * Persian still said a zone two more ways (#7679): ناحیه, an area, in the
 * DNS monitor's "Zone queried." and its DNSSEC fields, in "OpenStack Hosts
 * and Zones" and "Its cloud zone"; منطقه, a region, in "Private DNS Zone".
 * Those say زُن too, and the Persian docs, which wrote "zone" and
 * "recordset" in Latin letters 74 times, say them as the Dashboard does.
 */
describe("a cloud's zones and recordsets, in Persian words", () => {
  const ZONE: string = "زُن";
  const RECORDSET: string = `مجموعه${ZERO_WIDTH_NON_JOINER}رکورد`;
  // A zone or a recordset left in Latin letters, outside a placeholder or code.
  const LATIN_ZONE_OR_RECORDSET: RegExp = /zone|recordset/i;
  /*
   * English about a time zone: its zone is another word. A placeholder named
   * for a zone ("Times are in {{zone}}.") is not read: the checks read a
   * text without its placeholders, so "In zone {{zone}} of region ..." is.
   */
  const SAYS_TIME_ZONE: RegExp = /time ?zone/i;
  const SAYS_ZONE: RegExp = /zone/i;
  // An area of a page, and a region: never a zone of these.
  const AREA: string = "ناحیه";
  const REGION: string = "منطقه";
  const SAYS_REGION: RegExp = /\bregions?\b/i;

  // Where the English says zone and means neither a DNS zone nor a cloud's.
  const OTHER_ZONES: ReadonlyArray<{ english: RegExp; why: string }> = [
    {
      english: /\bdanger zone\b/i,
      why: "a settings page's Danger Zone is an area of the page: منطقه خطر",
    },
    {
      english: /\btimes without a zone\b/i,
      why: "a time's zone is its time zone: منطقه زمانی",
    },
  ];

  // The zones among `rows` worded otherwise: without زُن, as an area, or as a region the English does not name.
  const wordedOtherwise: (
    rows: Array<[string, string, string]>,
  ) => Array<string> = (
    rows: Array<[string, string, string]>,
  ): Array<string> => {
    return rows
      .filter(([, english, persian]: [string, string, string]): boolean => {
        return (
          !persian.includes(ZONE) ||
          persian.includes(AREA) ||
          (persian.includes(REGION) && !SAYS_REGION.test(english))
        );
      })
      .map(([key, , persian]: [string, string, string]): string => {
        return `${key} => ${persian}`;
      });
  };

  // The texts among `rows` that keep a zone or a recordset in Latin letters.
  const keptInLatin: (
    rows: Array<[string, string, string]>,
  ) => Array<string> = (
    rows: Array<[string, string, string]>,
  ): Array<string> => {
    return rows
      .filter(([, english, persian]: [string, string, string]): boolean => {
        return (
          !SAYS_TIME_ZONE.test(english) &&
          LATIN_ZONE_OR_RECORDSET.test(
            persian.replace(PLACEHOLDER, " ").replace(CODE_SPAN, " "),
          )
        );
      })
      .map(([key, , persian]: [string, string, string]): string => {
        return `${key} => ${persian}`;
      });
  };

  test.each([
    ["DNS zone", `${ZONE} DNS`],
    ["DNS recordset", `${RECORDSET} DNS`],
    ["Availability zone", `${ZONE} دسترس${ZERO_WIDTH_NON_JOINER}پذیری`],
  ])("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
    expect(PERSIAN_KEPT).not.toContain(english);
  });

  test("no text Persian words keeps a zone or a recordset in Latin letters", () => {
    const zones: Array<[string, string, string]> = WORDED.filter(
      ([, english]: [string, string, string]): boolean => {
        return (
          LATIN_ZONE_OR_RECORDSET.test(english.replace(PLACEHOLDER, " ")) &&
          !SAYS_TIME_ZONE.test(english)
        );
      },
    );

    // Many: a scan that finds none would pass.
    expect(zones.length).toBeGreaterThan(60);
    expect(keptInLatin(zones)).toEqual([]);
  });

  test("the page titles say what their rows say", () => {
    expect(PERSIAN.get("DNS Zones")).toBe(
      `${ZONE}${ZERO_WIDTH_NON_JOINER}های DNS`,
    );
    expect(PERSIAN.get("DNS zones")).toBe(PERSIAN.get("DNS Zones"));
    expect(PERSIAN.get("Availability Zone")).toBe(
      PERSIAN.get("Availability zone"),
    );
    expect(PERSIAN.get("DNS Recordset")).toBe(PERSIAN.get("DNS recordset"));
    expect(PERSIAN.get("{{count}} DNS zones")).toBe(`{{count}} ${ZONE} DNS`);
  });

  test("the check finds a zone or a recordset kept in Latin letters, and leaves a time zone and a placeholder alone (control)", () => {
    expect(
      keptInLatin([
        ["DNS Zones", "DNS Zones", "DNS Zoneها"],
        ["recordsets", "recordsets", "recordsetها"],
        ["Zone ID", "Zone ID", `شناسه ${ZONE}`],
        [
          "Times are in {{zone}}.",
          "Times are in {{zone}}.",
          "زمان به وقت {{zone}} است.",
        ],
        [
          "Times in {{timezone}}.",
          "Times in {{timezone}}.",
          "زمان به وقت {{timezone}}.",
        ],
        // A zone beside a placeholder named for one is read (#7679).
        [
          "In zone {{zone}} of region {{region}}",
          "In zone {{zone}} of region {{region}}",
          "در Zone {{zone}} از منطقه {{region}}",
        ],
      ]),
    ).toEqual([
      "DNS Zones => DNS Zoneها",
      "recordsets => recordsetها",
      "In zone {{zone}} of region {{region}} => در Zone {{zone}} از منطقه {{region}}",
    ]);
  });

  test("every zone Persian words is زُن: never ناحیه, and منطقه only for a region", () => {
    const zones: Array<[string, string, string]> = WORDED.filter(
      ([, english]: [string, string, string]): boolean => {
        return (
          SAYS_ZONE.test(english.replace(PLACEHOLDER, " ")) &&
          !SAYS_TIME_ZONE.test(english) &&
          !OTHER_ZONES.some((other: { english: RegExp }): boolean => {
            return other.english.test(english);
          })
        );
      },
    );

    // Many: a scan that finds none would pass.
    expect(zones.length).toBeGreaterThan(60);
    expect(wordedOtherwise(zones)).toEqual([]);

    // Each other zone listed is still one the file says.
    for (const other of OTHER_ZONES) {
      expect({
        why: other.why,
        said: WORDED.some(([, english]: [string, string, string]): boolean => {
          return other.english.test(english);
        }),
      }).toEqual({ why: other.why, said: true });
    }
  });

  test.each([
    // The DNS monitor's zone, which said ناحیه.
    ["Zone queried.", `${ZONE}ی که پرس${ZERO_WIDTH_NON_JOINER}وجو شد.`],
    [
      "True if DS records exist at the parent zone.",
      `اگر رکوردهای DS در ${ZONE} والد وجود داشته باشند، true است.`,
    ],
    // A private DNS zone, which said منطقهٔ DNS.
    ["Private DNS Zone", `${ZONE} DNS خصوصی`],
    // The hosts and zones a maintenance event is on, which said ناحیه.
    [
      "OpenStack Hosts and Zones",
      `میزبان${ZERO_WIDTH_NON_JOINER}ها و ${ZONE}${ZERO_WIDTH_NON_JOINER}های OpenStack`,
    ],
  ])("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
  });

  test("the check finds a zone worded as an area or a region, and leaves a region's منطقه alone (control)", () => {
    const queriedAsAnArea: string = `${AREA}${ZERO_WIDTH_NON_JOINER}ای که پرس${ZERO_WIDTH_NON_JOINER}وجو شد.`;
    const privateAsARegion: string = `${REGION}${ch(0x654)} DNS خصوصی`;

    expect(
      wordedOtherwise([
        ["Zone queried.", "Zone queried.", queriedAsAnArea],
        ["Private DNS Zone", "Private DNS Zone", privateAsARegion],
        [
          "Zone of region {{region}}",
          "Zone of region {{region}}",
          `${ZONE} از منطقه {{region}}`,
        ],
        ["Its cloud zone", "Its cloud zone", `${ZONE} ابری آن`],
      ]),
    ).toEqual([
      `Zone queried. => ${queriedAsAnArea}`,
      `Private DNS Zone => ${privateAsARegion}`,
    ]);
  });

  /*
   * The Persian docs say a zone and a recordset in the same words, outside
   * code (docsProseOf): what a reader copies, and the names a page draws in
   * English.
   */
  const TIME_ZONE: RegExp = /time ?zones?/gi;

  // Names the docs quote as their page draws them, in English.
  const DRAWN_IN_ENGLISH: ReadonlyArray<{ name: string; why: string }> = [
    {
      name: "DNS Zone in Error",
      why: "an OpenStack alert template's name, which the template picker draws in English",
    },
    {
      name: "DNS Zone Stuck Pending",
      why: "an OpenStack alert template's name, which the template picker draws in English",
    },
    {
      name: "DNS Recordset in Error",
      why: "an OpenStack alert template's name, which the template picker draws in English",
    },
    {
      name: "Data Zone Standard",
      why: "an Azure OpenAI deployment type, as Azure names it",
    },
    {
      name: "Data Zone Provisioned",
      why: "an Azure OpenAI deployment type, as Azure names it",
    },
    {
      name: "`Microsoft.Network/dnszones` | DNS Zone |",
      why: "Azure's name for the resource type, in a table of Azure's names",
    },
  ];

  // What a docs line says in Latin letters about a zone or a recordset, once code, links, names and time zones are out.
  function latinZonesIn(line: string): Array<string> {
    const prose: string = docsProseOf(
      line,
      DRAWN_IN_ENGLISH.map((drawn: { name: string; why: string }): string => {
        return drawn.name;
      }),
    ).replace(TIME_ZONE, " ");

    return prose.match(/\S*(?:zone|recordset)\S*/gi) || [];
  }

  test("the Persian docs say a zone and a recordset in Persian words, outside code", () => {
    const found: Array<string> = [];

    for (const [page, markdown] of DOCS_PAGES) {
      for (const [line, text] of proseLinesOf(markdown)) {
        const latin: Array<string> = latinZonesIn(text);

        if (latin.length > 0) {
          found.push(`${page}:${line}: ${latin.join(" ")}`);
        }
      }
    }

    // Every Persian page: a scan that reads none would pass.
    expect(DOCS_PAGES.length).toBeGreaterThan(300);
    expect(found).toEqual([]);

    // The pages #7679 named say them in Persian words, many times.
    for (const page of [
      "telemetry/openstack.md",
      "monitor/openstack-monitor.md",
    ]) {
      const markdown: string = (
        DOCS_PAGES.find(([name]: [string, string]): boolean => {
          return name === page;
        }) as [string, string]
      )[1];

      expect(markdown.split(ZONE).length - 1).toBeGreaterThan(20);
      expect(markdown).toContain(RECORDSET);
    }

    // Each name kept is still one a page quotes.
    for (const drawn of DRAWN_IN_ENGLISH) {
      expect({
        why: drawn.why,
        quoted: DOCS_PAGES.some(([, markdown]: [string, string]): boolean => {
          return markdown.includes(drawn.name);
        }),
      }).toEqual({ why: drawn.why, quoted: true });
    }
  });

  test("the docs check finds a zone or a recordset in Latin letters, and leaves code, links and names drawn in English alone (control)", () => {
    expect(latinZonesIn("هر zone چند recordset دارد.")).toEqual([
      "zone",
      "recordset",
    ]);
    expect(latinZonesIn("**آیا یک zone می‌تواند**")).toEqual(["zone"]);
    expect(
      latinZonesIn(
        "| DNS Zone in Error | `openstack zone list` و `zone_id`، zone_name و [زُن](/docs/telemetry/openstack#zone) در Time zone |",
      ),
    ).toEqual([]);
  });

  /*
   * A time zone is منطقه زمانی, with no ezafe mark (U+0654) on منطقه, as
   * the glossary writes it (#7866). The Persian docs wrote it with the mark
   * 31 times on 14 pages, three of them both ways, and so did one Dashboard
   * text: the description of a product analytics event's daily chart.
   */
  const TIME_ZONE_IN_PERSIAN: string = "منطقه زمانی";
  // A time zone's ezafe written with a hamza: the spelling the glossary does not use.
  const TIME_ZONE_WITH_HAMZA: string = `منطقه${ch(0x654)} زمانی`;

  const saysTimeZoneWithHamza: (text: string) => boolean = (
    text: string,
  ): boolean => {
    return text.includes(TIME_ZONE_WITH_HAMZA);
  };

  // The numbers of a docs page's lines, outside fenced code, whose text `isSaid`.
  const linesOn: (
    markdown: string,
    isSaid: (text: string) => boolean,
  ) => Array<number> = (
    markdown: string,
    isSaid: (text: string) => boolean,
  ): Array<number> => {
    return proseLinesOf(markdown)
      .filter(([, text]: [number, string]): boolean => {
        return isSaid(text);
      })
      .map(([line]: [number, string]): number => {
        return line;
      });
  };

  // Every docs line, outside fenced code, whose text `isSaid`: page:line.
  const docsLinesWhere: (isSaid: (text: string) => boolean) => Array<string> = (
    isSaid: (text: string) => boolean,
  ): Array<string> => {
    return DOCS_PAGES.flatMap(
      ([page, markdown]: [string, string]): Array<string> => {
        return linesOn(markdown, isSaid).map((line: number): string => {
          return `${page}:${line}`;
        });
      },
    );
  };

  test("a time zone is منطقه زمانی, with no ezafe mark, in every Dashboard text and every Persian docs page", () => {
    // Many say it, in both: a scan that reads nothing would pass.
    expect(
      WORDED.filter(([, , persian]: [string, string, string]): boolean => {
        return persian.includes(TIME_ZONE_IN_PERSIAN);
      }).length,
    ).toBeGreaterThan(40);
    expect(
      docsLinesWhere((text: string): boolean => {
        return text.includes(TIME_ZONE_IN_PERSIAN);
      }).length,
    ).toBeGreaterThan(50);

    expect({
      texts: findWrong((_english: string, persian: string): boolean => {
        return saysTimeZoneWithHamza(persian);
      }),
      docs: docsLinesWhere(saysTimeZoneWithHamza),
    }).toEqual({ texts: [], docs: [] });
  });

  test("the time zone check finds the ezafe mark in a text and on a docs page, and leaves fenced code alone (control)", () => {
    expect(
      saysTimeZoneWithHamza(`روزها در ${TIME_ZONE_WITH_HAMZA} شما هستند.`),
    ).toBe(true);
    expect(
      saysTimeZoneWithHamza(`روزها در ${TIME_ZONE_IN_PERSIAN} شما هستند.`),
    ).toBe(false);
    expect(
      linesOn(
        [
          `روزها در ${TIME_ZONE_WITH_HAMZA} شما هستند.`,
          `روزها در ${TIME_ZONE_IN_PERSIAN} شما هستند.`,
          "```text",
          TIME_ZONE_WITH_HAMZA,
          "```",
          `**${TIME_ZONE_IN_PERSIAN}** و ${TIME_ZONE_WITH_HAMZA}`,
        ].join("\n"),
        saysTimeZoneWithHamza,
      ),
    ).toEqual([1, 6]);
  });
});

/*
 * OPENSTACK'S LOAD BALANCERS, FLOATING IPS, POOLS AND SHARES, IN PERSIAN
 * WORDS (#7679).
 *
 * After #7629 worded a cloud's zones, Persian still kept four of
 * OpenStack's nouns in Latin letters: the keys Load balancer, Floating IP,
 * Pool and share were their English, and about 300 texts said
 * "Load Balancerها", "floating IP", "poolی که", "shareهای". It named a pool
 * two more ways, مخزن (a repository) for a vSphere resource pool and پول
 * (money) for "pool" and InnoDB's buffer pool, and a load balancer once as
 * توزیع‌کننده بار. Each is one Persian word in every text now: a load
 * balancer is متعادل‌کننده بار (no ٔ), a floating IP IP شناور, a pool استخر
 * and a share اشتراک فایل. Amphora, Octavia's name for the machine a load
 * balancer runs in, stays as written, as Arabic keeps it.
 */
describe("OpenStack's load balancers, floating IPs, pools and shares, in Persian words", () => {
  const LOAD_BALANCER: string = `متعادل${ZERO_WIDTH_NON_JOINER}کننده بار`;
  const LOAD_BALANCERS: string = `متعادل${ZERO_WIDTH_NON_JOINER}کننده${ZERO_WIDTH_NON_JOINER}های بار`;
  const FLOATING_IP: string = "IP شناور";
  const POOL: string = "استخر";
  const SHARE: string = "اشتراک فایل";
  // A load balancer's ezafe written with a hamza: the spelling Persian does not use.
  const LOAD_BALANCER_WITH_HAMZA: string = `متعادل${ZERO_WIDTH_NON_JOINER}کننده${ch(0x654)} بار`;
  // A repository, and money: neither is a pool.
  const NOT_A_POOL: ReadonlyArray<string> = ["مخزن", "پول"];

  // English that says one of the four, outside its placeholders.
  const SAYS_ONE: RegExp =
    /\b(?:load[ -]balancers?|floating IPs?|pools?|shares?)\b/i;
  const SAYS_LOAD_BALANCER: RegExp = /\bload[ -]balancers?\b/i;
  const SAYS_POOL: RegExp = /\bpools?\b/i;
  // One left in Latin letters: not a piece of a longer word or an identifier.
  const LATIN_NOUN: RegExp =
    /(?<![A-Za-z0-9_./-])(?:load balancers?|floating IPs?|pools?|shares?)(?![A-Za-z0-9_-])/gi;
  // A command a reader types, and an identifier: kept as written.
  const COMMAND: RegExp = /\bopenstack(?: [a-z][a-z0-9_-]*)+/g;
  const IDENTIFIER: RegExp = /[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+/g;

  // Names a text quotes as their page draws them, in English.
  const DRAWN_IN_ENGLISH: ReadonlyArray<{ name: string; why: string }> = [
    {
      name: "Pool Near Full",
      why: "a Ceph alert template's name, which the template picker draws in English",
    },
    {
      name: "Storage Pool Warning",
      why: "an OpenStack alert template's name, which the template picker draws in English",
    },
    {
      name: "Storage Pool Critical",
      why: "an OpenStack alert template's name, which the template picker draws in English",
    },
    {
      name: "Share snapshot",
      why: "the RDS console's action, as the console names it",
    },
    {
      name: "Safari روی Share",
      why: "Safari's Share button, named as Safari draws it, beside its Add to Home Screen",
    },
  ];

  // The four a text keeps in Latin letters, once code, placeholders, commands, identifiers and the names above are out.
  const latinNounsIn: (persian: string) => Array<string> = (
    persian: string,
  ): Array<string> => {
    let prose: string = persian;

    for (const drawn of DRAWN_IN_ENGLISH) {
      prose = prose.split(drawn.name).join(" ");
    }

    prose = prose
      .replace(PLACEHOLDER, " ")
      .replace(CODE_SPAN, " ")
      .replace(COMMAND, " ")
      .replace(IDENTIFIER, " ");

    return prose.match(LATIN_NOUN) || [];
  };

  const keptInLatin: (
    rows: Array<[string, string, string]>,
  ) => Array<string> = (
    rows: Array<[string, string, string]>,
  ): Array<string> => {
    return rows
      .filter(([, , persian]: [string, string, string]): boolean => {
        return latinNounsIn(persian).length > 0;
      })
      .map(([key, , persian]: [string, string, string]): string => {
        return `${key} => ${persian}`;
      });
  };

  // The texts Persian words whose English, outside its placeholders, says `pattern`.
  const saying: (pattern: RegExp) => Array<[string, string, string]> = (
    pattern: RegExp,
  ): Array<[string, string, string]> => {
    return WORDED.filter(([, english]: [string, string, string]): boolean => {
      return pattern.test(english.replace(PLACEHOLDER, " "));
    });
  };

  test.each([
    ["Load balancer", LOAD_BALANCER],
    ["Load Balancers", LOAD_BALANCERS],
    ["Floating IP", FLOATING_IP],
    ["Floating IPs", "IPهای شناور"],
    ["Pool", POOL],
    ["pool", POOL],
    ["Pools", `${POOL}ها`],
    ["Resource Pool", `${POOL} منابع`],
    ["share", SHARE],
    ["Shares", `اشتراک${ZERO_WIDTH_NON_JOINER}های فایل`],
  ])("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
    expect(PERSIAN_KEPT).not.toContain(english);
  });

  test("Amphora stays as written, on Persian's same-as-English list: Octavia's name for the machine a load balancer runs in", () => {
    for (const name of ["Amphora", "amphora"]) {
      expect(PERSIAN.get(name)).toBe(name);
      expect(PERSIAN_KEPT).toContain(name);
    }
  });

  test("no text Persian words keeps a load balancer, a floating IP, a pool or a share in Latin letters", () => {
    // Many say one: a scan that finds none would pass.
    expect(saying(SAYS_ONE).length).toBeGreaterThan(400);
    expect(keptInLatin(WORDED)).toEqual([]);

    // Each name kept is still one a text quotes.
    for (const drawn of DRAWN_IN_ENGLISH) {
      expect({
        why: drawn.why,
        quoted: WORDED.some(([, , persian]: [string, string, string]) => {
          return persian.includes(drawn.name);
        }),
      }).toEqual({ why: drawn.why, quoted: true });
    }
  });

  test("a load balancer is متعادل‌کننده بار in every text, spelt one way", () => {
    const loadBalancers: Array<[string, string, string]> =
      saying(SAYS_LOAD_BALANCER);

    expect(loadBalancers.length).toBeGreaterThan(40);
    expect(
      loadBalancers
        .filter(([, , persian]: [string, string, string]): boolean => {
          return !persian.includes(`متعادل${ZERO_WIDTH_NON_JOINER}کننده`);
        })
        .map(([key]: [string, string, string]): string => {
          return key;
        }),
    ).toEqual([]);
    expect(
      WORDED.filter(([, , persian]: [string, string, string]): boolean => {
        return persian.includes(LOAD_BALANCER_WITH_HAMZA);
      }).map(([key]: [string, string, string]): string => {
        return key;
      }),
    ).toEqual([]);
  });

  test("a pool is استخر in every text: never مخزن, a repository, or پول, money", () => {
    const pools: Array<[string, string, string]> = saying(SAYS_POOL);

    expect(pools.length).toBeGreaterThan(150);
    expect(
      pools
        .filter(([, , persian]: [string, string, string]): boolean => {
          return (
            !persian.includes(POOL) ||
            NOT_A_POOL.some((word: string): boolean => {
              return persian.includes(word);
            })
          );
        })
        .map(([key, , persian]: [string, string, string]): string => {
          return `${key} => ${persian}`;
        }),
    ).toEqual([]);
  });

  test("the check finds one kept in Latin letters, and leaves code, a command, an identifier and a name drawn in English alone (control)", () => {
    expect(
      keptInLatin([
        ["Load Balancers", "Load Balancers", "Load Balancerها"],
        ["A pool that fails", "A pool that fails", "poolی که شکست می‌خورد"],
        ["Floating IP", "Floating IP", "floating IP"],
        [
          "Kept",
          "Kept",
          "`openstack share list`، openstack share message list، pool_id و هشدار Pool Near Full",
        ],
      ]),
    ).toEqual([
      "Load Balancers => Load Balancerها",
      "A pool that fails => poolی که شکست می‌خورد",
      "Floating IP => floating IP",
    ]);
  });

  /*
   * The Persian docs say the four as the Dashboard does (#7727), read as
   * they are read for zones (docsProseOf): outside code, link targets,
   * addresses and identifiers ("pool_id", `openstack share list`).
   *
   * A page the docs serve in English is not read: a copy left to be
   * translated, whose prose is the English page's ("Terminate TLS at your
   * load balancer"), and which isEnglishCopy tells apart. A name a page
   * quotes as it is drawn in English stays as written:
   *   - an alert template's name, as the template picker draws it ("Storage
   *     Pool Warning", "Load Balancer in Error");
   *   - a cloud resource type's name, in a row that names the type: the
   *     catalog's label is the cloud's product name, drawn as written in
   *     every language (CloudResourceTypeNamesGuard);
   *   - a label's name, as a Persian page names a label: "label مربوط به
   *     pool" is the English page's "the pool label", the name the series
   *     carries, which a metric row writes bare as the catalog does;
   *   - the names of other products and apps below.
   */
  const ALERT_TEMPLATE_NAMES: ReadonlyArray<string> = [
    ...getAllOpenStackAlertTemplates(),
    ...getAllCephAlertTemplates(),
    ...getAllVMwareAlertTemplates(),
  ].map((template: { name: string }): string => {
    return template.name;
  });

  const LABEL_NAME: RegExp = /label مربوط به [A-Za-z0-9_]+/g;

  const QUOTED_IN_ENGLISH: ReadonlyArray<{ name: string; why: string }> = [
    {
      name: "Application Load Balancer",
      why: "AWS's name for its application load balancer (ALB), a product's name",
    },
    {
      name: "Share link",
      why: "the mobile app's button, which the app draws in English",
    },
    {
      name: "Cast, save, and share",
      why: "Chrome's menu item, named as Chrome draws it",
    },
  ];

  // The names a docs line quotes as drawn in English, the longest first, so a name inside another goes with it.
  const namesQuotedIn: (line: string) => Array<string> = (
    line: string,
  ): Array<string> => {
    const cloudTypeNames: Array<string> = CLOUD_RESOURCE_TYPES.filter(
      (descriptor: CloudResourceTypeDescriptor): boolean => {
        return line.includes(`\`${descriptor.type}\``);
      },
    ).map((descriptor: CloudResourceTypeDescriptor): string => {
      return descriptor.label;
    });

    return [
      ...ALERT_TEMPLATE_NAMES,
      ...cloudTypeNames,
      ...QUOTED_IN_ENGLISH.map(
        (quoted: { name: string; why: string }): string => {
          return quoted.name;
        },
      ),
    ].sort((first: string, second: string): number => {
      return second.length - first.length;
    });
  };

  // The four a docs page keeps in Latin letters, each with its line's number.
  const latinNounsOnPage: (markdown: string) => Array<string> = (
    markdown: string,
  ): Array<string> => {
    return proseLinesOf(markdown).flatMap(
      ([line, text]: [number, string]): Array<string> => {
        if (!text.match(LATIN_NOUN)) {
          return [];
        }

        return (
          docsProseOf(text.replace(LABEL_NAME, " "), namesQuotedIn(text)).match(
            LATIN_NOUN,
          ) || []
        ).map((noun: string): string => {
          return `${line}: ${noun}`;
        });
      },
    );
  };

  const englishPageOf: (page: string) => string = (page: string): string => {
    return fs.readFileSync(path.join(DOCS_CONTENT, "en", page), "utf8");
  };

  // The pages the docs serve in Persian: every one but a copy still in English.
  const PERSIAN_PAGES: Array<[string, string]> = DOCS_PAGES.filter(
    ([page, markdown]: [string, string]): boolean => {
      return !isEnglishCopy(englishPageOf(page), markdown);
    },
  );

  const persianPage: (page: string) => string = (page: string): string => {
    return (
      DOCS_PAGES.find(([name]: [string, string]): boolean => {
        return name === page;
      }) as [string, string]
    )[1];
  };

  test("the Persian docs say a load balancer, a floating IP, a pool and a share in Persian words, outside code", () => {
    const found: Array<string> = PERSIAN_PAGES.flatMap(
      ([page, markdown]: [string, string]): Array<string> => {
        return latinNounsOnPage(markdown).map((at: string): string => {
          return `${page}:${at}`;
        });
      },
    );

    // Every Persian page but the few still in English: a scan that reads none would pass.
    expect(PERSIAN_PAGES.length).toBeGreaterThan(300);
    expect(found).toEqual([]);

    // The pages #7727 named say them in Persian words.
    const agentless: string = persianPage("telemetry/openstack-agentless.md");

    expect(agentless).toContain(LOAD_BALANCERS);
    expect(agentless).toContain(`${POOL}ها`);
    expect(persianPage("telemetry/openstack-very-large-clouds.md")).toContain(
      "IPهای شناور",
    );
    expect(persianPage("telemetry/databases.md")).toContain(`${POOL} بافر`);

    // Each name kept is still one a page quotes.
    for (const quoted of QUOTED_IN_ENGLISH) {
      expect({
        why: quoted.why,
        quoted: PERSIAN_PAGES.some(
          ([, markdown]: [string, string]): boolean => {
            return markdown.includes(quoted.name);
          },
        ),
      }).toEqual({ why: quoted.why, quoted: true });
    }
  });

  test("the docs check finds one kept in Latin letters, and leaves code, a template's name, a cloud's product name, a label's name and a page served in English alone (control)", () => {
    expect(
      latinNounsOnPage(
        [
          `# ${LOAD_BALANCERS}`,
          "",
          "ابری با ۳ load balancer و ۱ pool، که floating IPها و shareهایش را می‌خواند.",
          "",
          "```bash",
          "openstack loadbalancer pool list  # each pool",
          "```",
          "",
          "`openstack share list`، pool_id، [استخر](/docs/telemetry/openstack#pool) و **Storage Pool Warning**",
          "| `Microsoft.Network/loadBalancers` | Load Balancer | IaaS |",
          "| Load Balancer | IaaS |",
          "label مربوط به pool می‌گوید کدام pool آن را نگه می‌دارد.",
        ].join("\n"),
      ),
    ).toEqual([
      "3: load balancer",
      "3: pool",
      "3: floating IP",
      "3: share",
      "11: Load Balancer",
      "12: pool",
    ]);

    // A copy the docs serve in English says one, and is not read.
    const copy: string = "self-hosted/hardening.md";

    expect(isEnglishCopy(englishPageOf(copy), persianPage(copy))).toBe(true);
    expect(latinNounsOnPage(persianPage(copy)).length).toBeGreaterThan(0);
    expect(
      PERSIAN_PAGES.map(([page]: [string, string]): string => {
        return page;
      }),
    ).not.toContain(copy);
  });

  /*
   * The Persian docs spell a load balancer as the Dashboard does (#7866).
   * They wrote it with the ezafe mark (U+0654) 21 times on 14 pages, and
   * once, on the self-hosting guide, as a distributor of load: the word
   * #7679 took out of the Dashboard. Every page is read, not only
   * PERSIAN_PAGES: a page still in English has no Persian to find, and a
   * page translated later is read at once.
   */
  const DISTRIBUTOR: string = `توزیع${ZERO_WIDTH_NON_JOINER}کننده`;
  // A load balancer spelt as the glossary does not: with the ezafe mark, or as a distributor.
  const LOAD_BALANCER_SPELT_OTHERWISE: RegExp = new RegExp(
    `${LOAD_BALANCER_WITH_HAMZA}|${DISTRIBUTOR}`,
    "g",
  );

  // What a docs page says for a load balancer outside fenced code that the glossary does not, each with its line's number.
  const loadBalancersSpeltOtherwiseOn: (markdown: string) => Array<string> = (
    markdown: string,
  ): Array<string> => {
    return proseLinesOf(markdown).flatMap(
      ([line, text]: [number, string]): Array<string> => {
        return (text.match(LOAD_BALANCER_SPELT_OTHERWISE) || []).map(
          (spelling: string): string => {
            return `${line}: ${spelling}`;
          },
        );
      },
    );
  };

  test("the Persian docs spell a load balancer as the Dashboard does: never with the ezafe mark, never as a distributor", () => {
    const found: Array<string> = DOCS_PAGES.flatMap(
      ([page, markdown]: [string, string]): Array<string> => {
        return loadBalancersSpeltOtherwiseOn(markdown).map(
          (at: string): string => {
            return `${page}:${at}`;
          },
        );
      },
    );
    const lines: Array<[number, string]> = DOCS_PAGES.flatMap(
      ([, markdown]: [string, string]): Array<[number, string]> => {
        return proseLinesOf(markdown);
      },
    );

    // Every page, and many lines that say one: a scan that reads none would pass.
    expect(DOCS_PAGES.length).toBeGreaterThan(300);
    expect(
      lines.filter(([, text]: [number, string]): boolean => {
        return text.includes(LOAD_BALANCER);
      }).length,
    ).toBeGreaterThan(30);
    expect(found).toEqual([]);

    // The pages #7866 named say it as the Dashboard does.
    expect(persianPage("installation/self-hosting-guide.md")).toContain(
      LOAD_BALANCER,
    );
    expect(persianPage("monitor/ip-monitor.md")).toContain(LOAD_BALANCER);
  });

  test("the docs check finds a load balancer with the ezafe mark or as a distributor, and leaves fenced code alone (control)", () => {
    expect(
      loadBalancersSpeltOtherwiseOn(
        [
          `یک ${LOAD_BALANCER_WITH_HAMZA} بیرونی`,
          `یک ${LOAD_BALANCER} یا ${LOAD_BALANCERS}`,
          "```text",
          LOAD_BALANCER_WITH_HAMZA,
          "```",
          `پراکسی یا یک ${DISTRIBUTOR}${ch(0x654)} بار`,
        ].join("\n"),
      ),
    ).toEqual([`1: ${LOAD_BALANCER_WITH_HAMZA}`, `6: ${DISTRIBUTOR}`]);
  });
});

describe("pages #7089 met in English, in Persian", () => {
  const PAGES: ReadonlyArray<[string, string]> = [
    ["Team Audit Logs", "گزارش‌های ممیزی تیم"],
    ["Remove from Team", "حذف از تیم"],
    ["Add notification method", "افزودن روش اعلان"],
    ["Storage Array Label Rules", "قواعد برچسب آرایه ذخیره‌سازی"],
    ["Health Rollup", "تجمیع سلامت"],
    ["Re-sync Autopay", "همگام‌سازی دوباره پرداخت خودکار"],
    ["Data Residency", "محل نگهداری داده‌ها"],
    ["Never expires", "هرگز منقضی نمی‌شود"],
    // A timeout is مهلت, a time limit (#7607): وقفه is a pause.
    ["Connection Timeout", "مهلت اتصال"],
    ["Exception spike", "جهش استثنا"],
    ["Metric drift: {{metricName}}", "رانش متریک: {{metricName}}"],
    ["Investigate in Logs", "بررسی در لاگ‌ها"],
    ["Out of memory", "کمبود حافظه"],
    ["Kubernetes Cost Allocation", "تخصیص هزینه Kubernetes"],
    ["AI Conversation", "گفتگوی هوش مصنوعی"],
    ["OpenStack Cloud Audit Logs", "گزارش‌های ممیزی ابر OpenStack"],
    ["Table Owner Rules", "قواعد مالکیت جدول"],
  ];

  test.each(PAGES)("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
  });
});

describe("counts on those pages, in Persian digits and Persian words", () => {
  const persian: Translator = dashboardTranslator("fa");

  function plural(other: string): { one: string; other: string } {
    return { one: ENGLISH.get(`${other}_one`) as string, other };
  }

  test("a key's rate limit", () => {
    const line: { one: string; other: string } = plural(
      "{{count}} requests per minute",
    );

    expect(persian.translatePlural(line, 120)).toBe("۱۲۰ درخواست در دقیقه");
    expect(persian.translatePlural(line, 1)).toBe("۱ درخواست در دقیقه");
  });

  test("the invitations a team is waiting on", () => {
    const line: { one: string; other: string } = plural(
      "{{count}} Invitations Pending",
    );

    expect(persian.translatePlural(line, 3)).toBe("۳ دعوت در انتظار");
    expect(persian.translatePlural(line, 1)).toBe("۱ دعوت در انتظار");
  });

  test("the rules removing a notification method takes with it", () => {
    const line: { one: string; other: string } = plural(
      "{{count}} notification rules will be deleted.",
    );

    expect(persian.translatePlural(line, 4)).toBe(
      "۴ قاعده اعلان حذف خواهد شد.",
    );
    expect(persian.translatePlural(line, 1)).toBe(
      "۱ قاعده اعلان حذف خواهد شد.",
    );
  });
});

/*
 * The Admin Dashboard, the sign-in pages, status pages and public
 * dashboards draw some of the Dashboard's own strings from locale files of
 * their own. Where the Dashboard words one in Persian, so do they.
 */
describe("the strings other apps share with the Dashboard", () => {
  test.each(["AdminDashboard", "Accounts", "StatusPage", "PublicDashboard"])(
    "%s reads in Persian wherever the Dashboard does",
    (app: string) => {
      const english: Map<string, string> = leaves(readTree(app, "en"));
      const persian: Map<string, string> = leaves(readTree(app, "fa"));
      const englishOnly: Array<string> = Array.from(english)
        .filter(([key, text]: [string, string]): boolean => {
          return (
            persian.get(key) === text &&
            ENGLISH.get(key) === text &&
            PERSIAN.get(key) !== text
          );
        })
        .map(([key]: [string, string]): string => {
          return key;
        });

      expect(english.size).toBeGreaterThan(10);
      expect(englishOnly).toEqual([]);
    },
  );

  test("the Admin Dashboard names Twilio's account SID and auth token in Persian", () => {
    const admin: Map<string, string> = leaves(readTree("AdminDashboard", "fa"));

    expect(admin.get("Twilio Account SID")).toBe(
      PERSIAN.get("Twilio Account SID"),
    );
    expect(admin.get("Twilio Auth Token")).toBe(
      PERSIAN.get("Twilio Auth Token"),
    );
    expect(admin.get("Twilio Account SID")).not.toBe("Twilio Account SID");
  });
});

/*
 * A PORT IS پورت (#7284).
 *
 * Persian names a network port پورت: the Port monitor, a probe's ports, a
 * receiver's port field. Thirty-five texts said درگاه for one - the word
 * for a gateway or a portal - ("درگاه TCP یا UDP برای بررسی"), so one page
 * named the same port both ways. A text whose English says port or ports,
 * and no gateway, never says درگاه in Persian; a gateway keeps it.
 */
describe("a port is پورت, never درگاه (#7284)", () => {
  const PORT: RegExp = /\bports?\b/i;
  const GATEWAY: RegExp = /gateway/i;
  const GATEWAY_WORD: string = "درگاه";
  const PORT_WORD: string = "پورت";

  // Whether a Persian text names the port its English says as a gateway.
  function saysPortAsGateway(english: string, persian: string): boolean {
    return (
      PORT.test(english) &&
      !GATEWAY.test(english) &&
      persian.includes(GATEWAY_WORD)
    );
  }

  const PORT_TEXTS: Array<[string, string, string]> = WORDED.filter(
    ([, english]: [string, string, string]): boolean => {
      return PORT.test(english) && !GATEWAY.test(english);
    },
  );

  test("no Persian Dashboard text about a port says درگاه", () => {
    expect(findWrong(saysPortAsGateway)).toEqual([]);
  });

  test("they are hundreds, and almost every one says پورت", () => {
    expect(PORT_TEXTS.length).toBeGreaterThan(150);
    expect(
      PORT_TEXTS.filter(([, , persian]: [string, string, string]): boolean => {
        return persian.includes(PORT_WORD);
      }).length,
    ).toBeGreaterThan(150);
  });

  test("a gateway keeps درگاه (control)", () => {
    const gateways: Array<[string, string, string]> = WORDED.filter(
      ([, english]: [string, string, string]): boolean => {
        return GATEWAY.test(english) && !PORT.test(english);
      },
    );

    expect(
      gateways.filter(([, , persian]: [string, string, string]): boolean => {
        return persian.includes(GATEWAY_WORD);
      }).length,
    ).toBeGreaterThan(10);
    expect(PERSIAN.get("How the gateway config works")).toContain(GATEWAY_WORD);
  });

  test("the check finds a port worded as a gateway, and nothing else (control)", () => {
    expect(
      saysPortAsGateway(
        "The TCP or UDP port to check, like 443.",
        "درگاه TCP یا UDP برای بررسی، مثلاً 443.",
      ),
    ).toBe(true);
    expect(saysPortAsGateway("Ports", "درگاه‌ها")).toBe(true);
    // "Report" and "Export" say no port; a gateway's port is the gateway's.
    expect(saysPortAsGateway("Export the report", "درگاه")).toBe(false);
    expect(saysPortAsGateway("The gateway's port", "پورت درگاه")).toBe(false);
  });

  test.each([
    [
      "The TCP or UDP port to check, like 443.",
      "پورت TCP یا UDP برای بررسی، مثلاً 443.",
    ],
    [
      "The host the port is on, like example.com.",
      "میزبانی که پورت روی آن است، مثلاً example.com.",
    ],
    [
      "Prometheus scrape: {{exporter}}, port {{port}}, path {{path}}",
      "اسکرپ Prometheus: {{exporter}}، پورت {{port}}، مسیر {{path}}",
    ],
  ])("%s reads %s", (english: string, persian: string) => {
    expect(PERSIAN.get(english)).toBe(persian);
  });

  test.each(["AdminDashboard", "Accounts", "StatusPage", "PublicDashboard"])(
    "%s's Persian file says پورت for a port too",
    (app: string) => {
      const english: Map<string, string> = leaves(readTree(app, "en"));
      const persian: Map<string, string> = leaves(readTree(app, "fa"));

      expect(
        Array.from(english)
          .filter(([key, text]: [string, string]): boolean => {
            return saysPortAsGateway(text, persian.get(key) || "");
          })
          .map(([key]: [string, string]): string => {
            return key;
          }),
      ).toEqual([]);
    },
  );

  test("the Admin Dashboard's port fields say پورت", () => {
    const english: Map<string, string> = leaves(
      readTree("AdminDashboard", "en"),
    );
    const persian: Map<string, string> = leaves(
      readTree("AdminDashboard", "fa"),
    );
    const ports: Array<string> = Array.from(english.keys()).filter(
      (key: string): boolean => {
        return PORT.test(english.get(key) || "");
      },
    );

    expect(ports.length).toBeGreaterThan(5);
    for (const key of ports) {
      expect({
        key,
        says: (persian.get(key) || "").includes(PORT_WORD),
      }).toEqual({ key, says: true });
    }
  });

  /*
   * The Persian guides for moving from another tool name each of its
   * monitors in bold beside the OneUptime monitor it becomes: the Port
   * monitor, which the Dashboard's monitor picker calls پورت.
   */
  test("the Persian guides for moving to OneUptime name the Port monitor as the Dashboard does", () => {
    const guides: string = path.join(
      APPS,
      "Docs/Content/fa/moving-to-oneuptime",
    );
    const pages: Array<string> = fs
      .readdirSync(guides)
      .filter((file: string): boolean => {
        return file.endsWith(".md");
      });
    const read: (page: string) => string = (page: string): string => {
      return fs.readFileSync(path.join(guides, page), "utf8");
    };

    expect(PERSIAN.get("Port")).toBe(PORT_WORD);
    expect(pages.length).toBeGreaterThan(5);
    expect(
      pages.filter((page: string): boolean => {
        return read(page).includes(GATEWAY_WORD);
      }),
    ).toEqual([]);
    for (const page of [
      "uptimerobot.md",
      "uptime-kuma.md",
      "pingdom.md",
      "statuscake.md",
      "better-stack.md",
    ]) {
      expect({ page, says: read(page).includes(`${PORT_WORD} `) }).toEqual({
        page,
        says: true,
      });
    }
  });
});
