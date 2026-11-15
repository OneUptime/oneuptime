import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as DefaultStatusNamesModule from "../../../Types/StatusPage/DefaultStatusNames";
import {
  DEFAULT_STATUS_NAMES,
  StatusPageNameList,
} from "../../../Types/StatusPage/DefaultStatusNames";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  getDefaultRecordNames,
  isDefaultRecordName,
  translateRecordName,
} from "../../../Utils/DefaultRecordNames";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * THE NAMES ONEUPTIME GIVES EVERY NEW PROJECT'S STATES, SEVERITIES AND
 * STATUSES, AND HOW A READER READS THEM.
 *
 * A status page shows OneUptime's own default names in its reader's
 * language, and its notifications to its subscribers do the same. The list
 * is the one the project seeds (ProjectService) and the one the status page
 * translates (StatusPage/src/Utils/StatusTranslation): one list, read from
 * both here, so a name added to either is translated everywhere.
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_DIRECTORY, "..", "..");

// The quoted names a source assigns or lists, in order.
const NAME_ASSIGNMENT: RegExp = /\.name = "([^"]+)";/g;

const DEFAULT_STATUS_NAMES_FILE: string = path.join(
  COMMON_DIRECTORY,
  "Types",
  "StatusPage",
  "DefaultStatusNames.ts",
);

// The lists a status page names records of.
const STATUS_PAGE_LISTS: ReadonlyArray<StatusPageNameList> = [
  StateListType.IncidentState,
  StateListType.IncidentSeverity,
  StateListType.MonitorStatus,
  StateListType.ScheduledMaintenanceState,
];

/*
 * Where the product's own code is: what the Dashboard, a status page, an
 * on-call page and the server's messages run.
 */
const PRODUCT_SOURCE_DIRECTORIES: ReadonlyArray<string> = [
  path.join(COMMON_DIRECTORY, "Types"),
  path.join(COMMON_DIRECTORY, "Utils"),
  path.join(COMMON_DIRECTORY, "Server"),
  path.join(COMMON_DIRECTORY, "UI"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
]);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// A source that reads the union of the lists.
const READS_THE_UNION: RegExp = /\bDEFAULT_STATUS_NAMES\b/;

// Every TypeScript source under `directory`, tests and dependencies aside.
const sourceFilesIn: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (TYPESCRIPT_FILE.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  };

  walk(directory);

  return files;
};

describe("DEFAULT_STATUS_NAMES", () => {
  test("are the names a new project's states, severities and statuses are given", () => {
    const projectService: string = fs.readFileSync(
      path.join(COMMON_DIRECTORY, "Server", "Services", "ProjectService.ts"),
      "utf8",
    );

    const seeded: Array<string> = Array.from(
      projectService.matchAll(NAME_ASSIGNMENT),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    // Every name the status page shows a reader is one the project seeds.
    for (const name of DEFAULT_STATUS_NAMES) {
      expect(seeded).toContain(name);
    }
  });

  test("are the names the status page translates for its readers", () => {
    const statusTranslation: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "App",
        "FeatureSet",
        "StatusPage",
        "src",
        "Utils",
        "StatusTranslation.ts",
      ),
      "utf8",
    );

    for (const name of DEFAULT_STATUS_NAMES) {
      const quoted: string = name.includes(" ") ? `"${name}":` : `${name}:`;

      expect(statusTranslation).toContain(quoted);
    }
  });

  test("are the four lists' default names, each name on one list", () => {
    const names: Array<string> = STATUS_PAGE_LISTS.flatMap(
      (list: StatusPageNameList): Array<string> => {
        return [...getDefaultRecordNames(list)];
      },
    );

    expect([...names].sort()).toEqual([...DEFAULT_STATUS_NAMES].sort());
    expect(new Set(names).size).toBe(names.length);
  });
});

/*
 * A NAME IS A DEFAULT BY ITS OWN LIST (#8066).
 *
 * The notifications once decided a name against all four lists at once
 * (translateStateName, which this file held), and so did a status page and
 * an on-call page: an incident state a project named "Degraded" read
 * "Beeinträchtigt" in a German email and on the page, and "Degraded" on the
 * Dashboard. Each now hands the record's list to Utils/DefaultRecordNames,
 * as the Dashboard does, and this file holds the lists only.
 */
describe("a status page's default names, as the server reads them", () => {
  const german: Translator = getServerTranslator("de");

  test("writes OneUptime's default names of each list in the reader's language", () => {
    expect(
      translateRecordName(german, StateListType.IncidentState, "Resolved"),
    ).toBe("Behoben");
    expect(
      translateRecordName(
        german,
        StateListType.IncidentSeverity,
        "Major Incident",
      ),
    ).toBe("Schwerwiegender Vorfall");
    expect(
      translateRecordName(
        german,
        StateListType.ScheduledMaintenanceState,
        "Ongoing",
      ),
    ).toBe("Laufend");
    expect(
      translateRecordName(german, StateListType.MonitorStatus, "Degraded"),
    ).toBe("Beeinträchtigt");
    expect(
      translateRecordName(
        getServerTranslator("fa"),
        StateListType.IncidentState,
        "Identified",
      ),
    ).toBe("شناسایی‌شده");
  });

  test("reads a default name with spaces around it as the name", () => {
    expect(
      isDefaultRecordName(StateListType.IncidentState, "  Resolved "),
    ).toBe(true);
    expect(
      translateRecordName(german, StateListType.IncidentState, "  Resolved "),
    ).toBe("Behoben");
  });

  test("leaves a name the project gave its own state as written", () => {
    expect(
      translateRecordName(german, StateListType.IncidentState, "Investigating"),
    ).toBe("Investigating");
    // Default words in another case are the project's own name.
    expect(
      translateRecordName(german, StateListType.IncidentState, "resolved"),
    ).toBe("resolved");
    expect(isDefaultRecordName(StateListType.IncidentState, "resolved")).toBe(
      false,
    );
  });

  test("leaves a name that is only another list's default as written", () => {
    const translated: Array<string> = [];

    for (const list of STATUS_PAGE_LISTS) {
      const own: ReadonlyArray<string> = getDefaultRecordNames(list);

      for (const name of DEFAULT_STATUS_NAMES) {
        if (own.includes(name)) {
          continue;
        }

        const word: string = translateRecordName(german, list, name);

        if (word !== name) {
          translated.push(`${list} named ${name} reads ${word}`);
        }
      }
    }

    expect(translated).toEqual([]);
  });

  test("writes every default name as it is written for English", () => {
    const english: Translator = createTranslator(undefined, "en");

    for (const list of STATUS_PAGE_LISTS) {
      for (const name of getDefaultRecordNames(list)) {
        expect(translateRecordName(english, list, name)).toBe(name);
      }
    }
  });

  test("an empty name stays empty", () => {
    for (const name of ["", undefined, null]) {
      expect(
        translateRecordName(german, StateListType.IncidentState, name),
      ).toBe("");
      expect(isDefaultRecordName(StateListType.IncidentState, name)).toBe(
        false,
      );
    }
  });
});

describe("nothing decides a default name against every list at once", () => {
  test("DefaultStatusNames holds the lists, and no function that decides", () => {
    const exported: Array<[string, unknown]> = Object.entries(
      DefaultStatusNamesModule,
    );

    expect(exported.length).toBeGreaterThan(0);

    for (const [name, value] of exported) {
      expect({ name, isList: Array.isArray(value) }).toEqual({
        name,
        isList: true,
      });
    }
  });

  test("no product source reads the union of the lists", () => {
    const readers: Array<string> = [];

    for (const directory of PRODUCT_SOURCE_DIRECTORIES) {
      for (const file of sourceFilesIn(directory)) {
        if (file === DEFAULT_STATUS_NAMES_FILE) {
          continue;
        }

        if (READS_THE_UNION.test(fs.readFileSync(file, "utf8"))) {
          readers.push(path.relative(REPOSITORY_ROOT, file));
        }
      }
    }

    expect(readers).toEqual([]);
  });
});
