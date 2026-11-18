import {
  HardcodedString,
  SourceKind,
  SourceScanResult,
  UndefinedNestedKey,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import fs from "fs";
import path from "path";

/*
 * The texts the Admin Dashboard's own pages hand a translation lookup, read
 * the way the Dashboard's string extractor reads the Dashboard
 * (scanSourceText): a page's titles, descriptions, columns, buttons, empty
 * states, the text of a translation call. Each is looked up by its English
 * text in the Admin Dashboard's own locales (src/Locales), so a text with
 * no entry reads English in every language (#8227).
 *
 * For AdminOwnPagesStringsLocales.test.ts, which holds every Admin locale
 * to them, and its fixtures.
 */

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

export const ADMIN_DASHBOARD_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/AdminDashboard/src",
);

export const ADMIN_DASHBOARD_LOCALES: string = path.join(
  ADMIN_DASHBOARD_SOURCE,
  "Locales",
);

export type LocaleTree = { [key: string]: string | LocaleTree };

const SOURCE_FILE: RegExp = /\.tsx?$/;

// One place a page hands a text over.
export interface OwnText {
  // The key it is looked up by: its English, or the plural's key plus "_one".
  key: string;
  // Its English: the key, or the plural's one form.
  english: string;
  // Repository-relative, with forward slashes, and the line.
  file: string;
  line: number;
}

/*
 * A nested key a page reads: t("pages.settings.email.smtpCardTitle"), with
 * or without its English beside it.
 */
export interface OwnNestedKey {
  path: Array<string>;
  file: string;
  line: number;
}

export interface OwnStrings {
  texts: Array<OwnText>;
  nestedKeys: Array<OwnNestedKey>;
  files: number;
}

// A TypeScript source file, not a declaration file.
export function isSourceFile(name: string): boolean {
  return SOURCE_FILE.test(name) && !name.endsWith(".d.ts");
}

export function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (isSourceFile(entry.name)) {
        files.push(full);
      }
    }
  };

  walk(directory);

  return files.sort();
}

/*
 * What one source file hands a lookup. An element's text the page draws as
 * written (the extractor's "hardcoded" list: <th>Shard</th>, a sentence
 * glued from pieces) is not looked up, so an entry would change nothing it
 * shows; that is the work of routing it through translation, not of the
 * locales.
 */
export function readOwnStrings(
  relativeFile: string,
  source: string,
  kind: SourceKind = "ui",
): { texts: Array<OwnText>; nestedKeys: Array<OwnNestedKey> } {
  const result: SourceScanResult = scanSourceText(relativeFile, source, {
    kind,
  });
  const drawnAsWritten: Set<string> = new Set<string>(
    result.hardcoded.map((entry: HardcodedString): string => {
      return `${entry.line}\u0000${entry.text}`;
    }),
  );
  const texts: Array<OwnText> = [];
  // A t("pages.settings.email.smtpCardTitle") with no English beside it.
  const nestedKeys: Array<OwnNestedKey> = result.nestedKeyReferences.map(
    (reference: UndefinedNestedKey): OwnNestedKey => {
      return {
        path: reference.path,
        file: reference.file,
        line: reference.line,
      };
    },
  );

  for (const entry of result.strings) {
    if (entry.nestedPath) {
      nestedKeys.push({
        path: entry.nestedPath,
        file: entry.file,
        line: entry.line,
      });
      continue;
    }

    if (drawnAsWritten.has(`${entry.line}\u0000${entry.text}`)) {
      continue;
    }

    texts.push({
      key: entry.text,
      english: entry.text,
      file: entry.file,
      line: entry.line,
    });

    if (entry.pluralOne !== undefined) {
      texts.push({
        key: `${entry.text}_one`,
        english: entry.pluralOne,
        file: entry.file,
        line: entry.line,
      });
    }
  }

  return { texts, nestedKeys };
}

/*
 * Shared catalogs outside the Admin's src whose words its pages draw: the
 * activation milestones' titles and what a project is missing, on a
 * project's milestones card and its setup pill (#8599). Each is read for
 * what it marks as a key (translationKey), as the Dashboard's extractor
 * reads such a file ("keys"): its other strings are values, not words.
 */
export const ADMIN_DASHBOARD_CATALOGS: ReadonlyArray<string> = [
  "packages/Common/Types/Analytics/ActivationMilestone.ts",
  /*
   * What a feedback answer was about - a guided setup by its name, Give
   * feedback's kind, the check-in's question - which the Feedback page looks
   * up by the answer's kind and topic (#8893).
   */
  "packages/Common/Types/ProductFeedback/ProductFeedback.ts",
  /*
   * What Ask AI's answers rated down drew on that is no product - the docs,
   * other data, nothing - on the Feedback page's Ask AI card (#7365).
   */
  "packages/Common/Types/AI/AskAiRatings.ts",
];

export function readAdminCatalogStrings(): OwnStrings {
  const texts: Array<OwnText> = [];
  const nestedKeys: Array<OwnNestedKey> = [];

  for (const file of ADMIN_DASHBOARD_CATALOGS) {
    const read: { texts: Array<OwnText>; nestedKeys: Array<OwnNestedKey> } =
      readOwnStrings(
        file,
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        "keys",
      );

    texts.push(...read.texts);
    nestedKeys.push(...read.nestedKeys);
  }

  return { texts, nestedKeys, files: ADMIN_DASHBOARD_CATALOGS.length };
}

// Every text the Admin Dashboard's own src hands a lookup.
export function readAdminOwnStrings(
  directory: string = ADMIN_DASHBOARD_SOURCE,
): OwnStrings {
  const files: Array<string> = listSourceFiles(directory);
  const texts: Array<OwnText> = [];
  const nestedKeys: Array<OwnNestedKey> = [];

  for (const file of files) {
    const read: { texts: Array<OwnText>; nestedKeys: Array<OwnNestedKey> } =
      readOwnStrings(
        path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf8"),
      );

    texts.push(...read.texts);
    nestedKeys.push(...read.nestedKeys);
  }

  return { texts, nestedKeys, files: files.length };
}

/*
 * What the pages under `directory` draw as written, with no lookup: an
 * element's own text, a text attribute of a plain HTML element, a sentence
 * glued from pieces (the extractor's "hardcoded" list). Each reads English
 * in every language whatever the locales hold (#8555).
 */
export function readDrawnAsWritten(
  directory: string = ADMIN_DASHBOARD_SOURCE,
): Array<HardcodedString> {
  const drawn: Array<HardcodedString> = [];

  for (const file of listSourceFiles(directory)) {
    drawn.push(
      ...readDrawnAsWrittenIn(
        path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf8"),
      ),
    );
  }

  return drawn;
}

// What one source file draws as written.
export function readDrawnAsWrittenIn(
  relativeFile: string,
  source: string,
): Array<HardcodedString> {
  return scanSourceText(relativeFile, source, { kind: "ui" }).hardcoded;
}

export function readAdminLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(
      path.join(ADMIN_DASHBOARD_LOCALES, `${language}.json`),
      "utf8",
    ),
  ) as LocaleTree;
}

// A nested key's string in `locale`, or undefined.
export function readNested(
  locale: LocaleTree,
  keyPath: Array<string>,
): string | undefined {
  let node: string | LocaleTree | undefined = locale;

  for (const part of keyPath) {
    if (!node || typeof node === "string") {
      return undefined;
    }

    node = node[part];
  }

  return typeof node === "string" ? node : undefined;
}

/*
 * The texts `locale` holds no entry for - no flat string under the text -
 * each once, in the order the pages hand them over, with the first place
 * that does: "Poll Telegram for Messages (Pages/Settings/Telegram/...)".
 */
export function findMissingEntries(
  texts: Array<OwnText>,
  locale: LocaleTree,
): Array<OwnText> {
  const seen: Set<string> = new Set<string>();
  const missing: Array<OwnText> = [];

  for (const text of texts) {
    if (seen.has(text.key)) {
      continue;
    }

    seen.add(text.key);

    if (typeof locale[text.key] !== "string") {
      missing.push(text);
    }
  }

  return missing;
}

// The texts, each once: the key and its English.
export function uniqueTexts(texts: Array<OwnText>): Map<string, string> {
  const unique: Map<string, string> = new Map<string, string>();

  for (const text of texts) {
    if (!unique.has(text.key)) {
      unique.set(text.key, text.english);
    }
  }

  return unique;
}
