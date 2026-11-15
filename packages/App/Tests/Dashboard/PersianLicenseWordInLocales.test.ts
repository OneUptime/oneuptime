import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE PERSIAN WORD FOR A LICENSE (#7340).
 *
 * Persian called an Enterprise license two things: پروانه, which most of
 * the license's words used - the License page's status ("پروانه فعال
 * است"), its key field, its buttons, the seat and instance cards, the
 * edition dialog, the sign-in pages' badge - and مجوز, which the card's own
 * title, the breadcrumb and the side menu item of Settings > License said,
 * as did the Enterprise Licenses pages and the SCIM, audit log, backup and
 * session notices. One page said both, and مجوز is the word Persian uses
 * for a permission, which a role grants: a reader could take a license
 * for a permission.
 *
 * A software license is پروانه now, in every Persian locale file and on
 * every Persian docs page: OneUptime's own Enterprise license, and the
 * licenses of the software it names (Valkey's BSD license, a licensed Zoom,
 * Teams or Microsoft 365 user, a Defender XDR or Entra ID license). مجوز is
 * left only where its English means a permission, and the English-letter
 * loanword لایسنس nowhere. A driving licence is گواهینامه, as Persian
 * says it: not a software license, and left alone.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LICENSE_WORD: string = "پروانه";
const PERMISSION_WORD: string = "مجوز";
// The English word in Persian letters.
const LOANWORD: RegExp = /لایسنس|لیسانس/u;

// English that names a license: license, licence, licensed, licensing.
const NAMES_A_LICENSE: RegExp = /\blicen[cs]/i;
// A driving licence, which Persian calls گواهینامه.
const NAMES_A_DRIVING_LICENCE: RegExp = /\bdriv(?:er|ing)/i;
// English that names a permission too, which Persian may call مجوز.
const NAMES_A_PERMISSION: RegExp =
  /\bpermissions?\b|\bauthori[sz]|\bconsent\b|\bgrant/i;
// What a sentence is filled with, never words of its own.
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

// Every Persian locale file a reader of OneUptime meets, beside its English.
const PERSIAN_LOCALES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Locales",
  "packages/App/FeatureSet/AdminDashboard/src/Locales",
  "packages/App/FeatureSet/Accounts/src/Locales",
  "packages/App/FeatureSet/StatusPage/src/Locales",
  "packages/App/FeatureSet/PublicDashboard/src/Locales",
  "packages/App/FeatureSet/Docs/Locales",
  "packages/App/FeatureSet/APIReference/Locales",
  "packages/Common/Server/Locales",
];

const DOCS: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);

type Tree = { [key: string]: unknown };

export interface Text {
  // Where it is: a locale file's key, or a docs page's line.
  where: string;
  english: string;
  persian: string;
}

function readTree(file: string): Tree {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Tree;
}

// Every string of a Persian locale, beside the English at the same key.
function textsOf(folder: string): Array<Text> {
  const english: Tree = readTree(path.join(REPOSITORY_ROOT, folder, "en.json"));
  const persian: Tree = readTree(path.join(REPOSITORY_ROOT, folder, "fa.json"));
  const texts: Array<Text> = [];

  const walk: (fa: Tree, en: unknown, at: Array<string>) => void = (
    fa: Tree,
    en: unknown,
    at: Array<string>,
  ): void => {
    for (const [key, value] of Object.entries(fa)) {
      const englishValue: unknown =
        en && typeof en === "object" ? (en as Tree)[key] : undefined;

      if (typeof value === "string") {
        texts.push({
          where: `${folder}: ${[...at, key].join(".")}`,
          english: typeof englishValue === "string" ? englishValue : key,
          persian: value,
        });
      } else if (value && typeof value === "object") {
        walk(value as Tree, englishValue, [...at, key]);
      }
    }
  };

  walk(persian, english, []);

  return texts;
}

// Whether the English names a software license.
function namesASoftwareLicense(english: string): boolean {
  const words: string = english.replace(PLACEHOLDER, " ");

  return NAMES_A_LICENSE.test(words) && !NAMES_A_DRIVING_LICENCE.test(words);
}

/*
 * What is wrong with how a Persian text words a license its English names,
 * or undefined when nothing is: it says the loanword; it says مجوز where
 * its English names no permission; or it names no license at all - neither
 * پروانه nor a name it keeps in English ("Apache License 2.0").
 */
export function licenseWordProblem(text: Text): string | undefined {
  if (!namesASoftwareLicense(text.english) || text.persian === text.english) {
    // Not a license, or a text the page keeps in English.
    return undefined;
  }

  if (LOANWORD.test(text.persian)) {
    return `${text.where}: says ${LOANWORD.source.split("|")[0]}`;
  }

  if (
    text.persian.includes(PERMISSION_WORD) &&
    !NAMES_A_PERMISSION.test(text.english)
  ) {
    return `${text.where}: says ${PERMISSION_WORD} for a license`;
  }

  if (
    !text.persian.includes(LICENSE_WORD) &&
    !NAMES_A_LICENSE.test(text.persian)
  ) {
    return `${text.where}: names no license`;
  }

  return undefined;
}

function problemsOf(texts: ReadonlyArray<Text>): Array<string> {
  return texts
    .map((text: Text): string | undefined => {
      return licenseWordProblem(text);
    })
    .filter((problem: string | undefined): problem is string => {
      return problem !== undefined;
    });
}

function markdownPages(directory: string): Array<string> {
  const pages: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      pages.push(...markdownPages(full));
    } else if (entry.name.endsWith(".md")) {
      pages.push(full);
    }
  }

  return pages.sort();
}

const PERSIAN_PAGES: Array<string> = markdownPages(path.join(DOCS, "fa"));

// What a docs line says in words: no code, no link target.
const CODE_SPAN: RegExp = /`[^`]*`/g;
const LINK_TARGET: RegExp = /\]\([^)]*\)/g;

function proseOf(line: string): string {
  return line.replace(CODE_SPAN, " ").replace(LINK_TARGET, "] ");
}

/*
 * The lines of each Persian page beside the English page's line of the
 * same number: a translation keeps the English page's lines (the docs'
 * translation suites hold them to it). A page translated in part, whose
 * lines do not line up, is left out here.
 */
function docsLines(): { texts: Array<Text>; pages: number } {
  const texts: Array<Text> = [];
  let pages: number = 0;

  for (const page of PERSIAN_PAGES) {
    const relative: string = path.relative(path.join(DOCS, "fa"), page);
    const englishPage: string = path.join(DOCS, "en", relative);

    if (!fs.existsSync(englishPage)) {
      continue;
    }

    const persian: Array<string> = fs.readFileSync(page, "utf8").split("\n");
    const english: Array<string> = fs
      .readFileSync(englishPage, "utf8")
      .split("\n");

    if (persian.length !== english.length) {
      continue;
    }

    pages += 1;
    persian.forEach((line: string, index: number) => {
      texts.push({
        where: `fa/${relative}:${index + 1}`,
        english: proseOf(english[index] as string),
        persian: line,
      });
    });
  }

  return { texts, pages };
}

const LOCALE_TEXTS: Array<Text> = PERSIAN_LOCALES.flatMap(
  (folder: string): Array<Text> => {
    return textsOf(folder);
  },
);

function persianOf(folder: string, key: string): string | undefined {
  const tree: Tree = readTree(path.join(REPOSITORY_ROOT, folder, "fa.json"));
  let node: unknown = tree;

  for (const part of key.split(".")) {
    node = node && typeof node === "object" ? (node as Tree)[part] : undefined;
  }

  return typeof node === "string" ? node : (tree[key] as string | undefined);
}

const DASHBOARD: string = PERSIAN_LOCALES[0] as string;
const ADMIN_DASHBOARD: string = PERSIAN_LOCALES[1] as string;
const ACCOUNTS: string = PERSIAN_LOCALES[2] as string;

describe("Persian's word for a software license", () => {
  test("every Persian locale text whose English names a license says پروانه, never مجوز", () => {
    const licenses: Array<Text> = LOCALE_TEXTS.filter((text: Text): boolean => {
      return namesASoftwareLicense(text.english);
    });

    // Some 280: a scan that read none would pass.
    expect(licenses.length).toBeGreaterThan(200);
    expect(problemsOf(LOCALE_TEXTS)).toEqual([]);
  });

  test.each(PERSIAN_LOCALES)("%s names a license one way", (folder: string) => {
    expect({ folder, problems: problemsOf(textsOf(folder)) }).toEqual({
      folder,
      problems: [],
    });
  });

  test("مجوز is left only where the English names a permission", () => {
    const permissions: Array<Text> = LOCALE_TEXTS.filter(
      (text: Text): boolean => {
        return (
          text.persian.includes(PERMISSION_WORD) &&
          text.persian !== text.english
        );
      },
    );
    const notPermissions: Array<string> = permissions
      .filter((text: Text): boolean => {
        return (
          namesASoftwareLicense(text.english) &&
          !NAMES_A_PERMISSION.test(text.english)
        );
      })
      .map((text: Text): string => {
        return text.where;
      });

    // A role's permissions: hundreds of them say مجوز, as they should.
    expect(permissions.length).toBeGreaterThan(200);
    expect(notPermissions).toEqual([]);
  });

  test("every Persian docs line whose English names a license says پروانه", () => {
    const { texts, pages } = docsLines();

    // Nearly every page lines up with its English.
    expect(pages).toBeGreaterThan(300);
    expect(
      texts.filter((text: Text): boolean => {
        return namesASoftwareLicense(text.english);
      }).length,
    ).toBeGreaterThan(80);
    expect(problemsOf(texts)).toEqual([]);
  });

  test("no Persian docs page says لایسنس", () => {
    expect(PERSIAN_PAGES.length).toBeGreaterThan(300);
    expect(
      PERSIAN_PAGES.filter((page: string): boolean => {
        return LOANWORD.test(fs.readFileSync(page, "utf8"));
      }).map((page: string): string => {
        return path.relative(DOCS, page);
      }),
    ).toEqual([]);
  });

  test("the check finds مجوز, the loanword and a license left unnamed, and leaves a permission and a driving licence alone (negative control)", () => {
    const planted: Array<Text> = [
      {
        where: "a",
        english: "Enterprise License",
        persian: "مجوز سازمانی",
      },
      {
        where: "b",
        english: "a licensed Zoom user",
        persian: "یک کاربر Zoom دارای لایسنس",
      },
      {
        where: "c",
        english:
          "A warning, not a failure, without the permission or the licence.",
        persian: "بدون مجوز دسترسی یک هشدار است، نه یک شکست.",
      },
      {
        where: "d",
        english: "Enterprise License",
        persian: "پروانهٔ سازمانی",
      },
      {
        where: "e",
        english: "You need this permission: {{permission}}.",
        persian: "به این مجوز نیاز دارید: {{permission}}.",
      },
      {
        where: "f",
        english: "A US driver's license number, next to words that say so.",
        persian: "یک شماره گواهینامه رانندگی آمریکا.",
      },
      {
        where: "g",
        english:
          "A warning, not a failure, without the permission or the licence.",
        persian: "بدون مجوز دسترسی یا پروانه یک هشدار است، نه یک شکست.",
      },
      {
        where: "h",
        english: "Everything outside ee/ is under the Apache License 2.0.",
        persian: "همه چیز بیرون از ee/ تحت Apache License 2.0 است.",
      },
      {
        where: "i",
        english: "License Key",
        persian: "License Key",
      },
    ];

    expect(problemsOf(planted)).toEqual([
      `a: says ${PERMISSION_WORD} for a license`,
      "b: says لایسنس",
      "c: names no license",
    ]);
  });

  /*
   * Settings > License in the Admin Dashboard: its side menu item, its
   * breadcrumb and its card's title (breadcrumbs.enterpriseLicense) say
   * the word the page's status and its cards say.
   */
  test("Settings > License names itself as its status does", () => {
    expect(persianOf(ADMIN_DASHBOARD, "breadcrumbs.enterpriseLicense")).toBe(
      LICENSE_WORD,
    );
    expect(persianOf(ADMIN_DASHBOARD, "License active")).toBe(
      "پروانه فعال است",
    );
    expect(persianOf(ADMIN_DASHBOARD, "Refresh license")).toContain(
      LICENSE_WORD,
    );
  });

  test.each([
    ["breadcrumbs.enterpriseLicenses", "پروانه‌های سازمانی"],
    ["pages.enterpriseLicenses.title", "پروانه‌های سازمانی"],
    ["pages.enterpriseLicenseView.title", "پروانهٔ سازمانی"],
    ["pages.enterpriseLicenseView.cardTitle", "جزئیات پروانه"],
    [
      "pages.enterpriseLicenseView.offlineTokenCardTitle",
      "توکن پروانهٔ آفلاین",
    ],
    ["Enterprise License", "پروانهٔ سازمانی"],
    ["Enterprise license required.", "پروانهٔ Enterprise لازم است."],
  ])("the Admin Dashboard's %s reads %s", (key: string, persian: string) => {
    expect(persianOf(ADMIN_DASHBOARD, key)).toBe(persian);
  });

  test.each([
    ["Enterprise License", "پروانهٔ سازمانی"],
    ["Enterprise Licenses", "پروانه‌های سازمانی"],
    ["Enterprise License Expires At", "تاریخ انقضای پروانهٔ سازمانی"],
    ["License Key", "کلید پروانه"],
    ["Evaluation License", "پروانهٔ ارزیابی"],
    [
      "Enterprise license required: SCIM is off, and this configuration is read-only.",
      "پروانهٔ Enterprise لازم است: SCIM خاموش است و این پیکربندی فقط‌خواندنی است.",
    ],
  ])("the Dashboard's %s reads %s", (key: string, persian: string) => {
    expect(persianOf(DASHBOARD, key)).toBe(persian);
  });

  test("the two dashboards and the sign-in pages name an Enterprise license alike", () => {
    for (const key of ["Enterprise License", "Enterprise Licenses"]) {
      expect(persianOf(ADMIN_DASHBOARD, key)).toBe(persianOf(DASHBOARD, key));
    }

    expect(
      persianOf(ACCOUNTS, "Enterprise Edition (License Required)"),
    ).toContain(LICENSE_WORD);
  });

  test("the docs name Settings > License as the Admin Dashboard draws it", () => {
    const page: string = fs.readFileSync(
      path.join(DOCS, "fa/self-hosted/enterprise.md"),
      "utf8",
    );

    expect(page).toContain(`**تنظیمات** > **${LICENSE_WORD}**`);
    expect(page).not.toContain(`> **${PERMISSION_WORD}**`);
  });
});
