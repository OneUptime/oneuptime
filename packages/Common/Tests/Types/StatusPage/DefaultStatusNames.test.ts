import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_STATUS_NAMES,
  isDefaultStatusName,
  translateStateName,
} from "../../../Types/StatusPage/DefaultStatusNames";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

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
});

describe("translateStateName", () => {
  const german: Translator = getServerTranslator("de");

  test("writes OneUptime's default names in the reader's language", () => {
    expect(translateStateName(german, "Resolved")).toBe("Behoben");
    expect(translateStateName(german, "Major Incident")).toBe(
      "Schwerwiegender Vorfall",
    );
    expect(translateStateName(german, "Ongoing")).toBe("Laufend");
    expect(translateStateName(getServerTranslator("fa"), "Identified")).toBe(
      "شناسایی‌شده",
    );
  });

  test("reads a default name with spaces around it as the name", () => {
    expect(isDefaultStatusName("  Resolved ")).toBe(true);
    expect(translateStateName(german, "  Resolved ")).toBe("Behoben");
  });

  test("leaves a name the project gave its own state as written", () => {
    expect(translateStateName(german, "Investigating")).toBe("Investigating");
    // Default words in another case are the project's own name.
    expect(translateStateName(german, "resolved")).toBe("resolved");
    expect(isDefaultStatusName("resolved")).toBe(false);
  });

  test("writes every default name as it is written for English", () => {
    const english: Translator = createTranslator(undefined, "en");

    for (const name of DEFAULT_STATUS_NAMES) {
      expect(translateStateName(english, name)).toBe(name);
    }
  });

  test("an empty name stays empty", () => {
    expect(translateStateName(german, "")).toBe("");
    expect(translateStateName(german, undefined)).toBe("");
    expect(translateStateName(german, null)).toBe("");
    expect(isDefaultStatusName(undefined)).toBe(false);
  });
});
