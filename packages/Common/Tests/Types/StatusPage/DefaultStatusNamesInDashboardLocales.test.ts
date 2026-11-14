import { describe, expect, test } from "@jest/globals";
import { SERVER_LOCALES } from "../../../Server/Utils/ServerTranslation";
import { DEFAULT_STATUS_NAMES } from "../../../Types/StatusPage/DefaultStatusNames";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ONEUPTIME'S DEFAULT NAMES ARE WORDS OF THE DASHBOARD, IN EVERY LANGUAGE
 * (#7821).
 *
 * A badge on a Dashboard page looks its text up in the reader's language
 * (Pill), so the states, severities and statuses a new project starts with
 * read in the reader's words - while their names are keys of the
 * Dashboard's locale files. "Critical Incident", "Major Incident" and
 * "Minor Incident" were not: no file the Dashboard's extraction reads
 * writes them, so the severities every project starts with read English in
 * every language, where the status page and the notifications said them in
 * the reader's.
 *
 * The extraction does not read DEFAULT_STATUS_NAMES: the Admin Dashboard's
 * bundle reaches the list (through BaseModelTable), and every frontend that
 * reaches an extracted file is held to its words
 * (AdminImportedCommonStringsLocales), though no Admin page shows a
 * project's severity. This test keeps every name of the list a key of the
 * Dashboard's own files instead: written as itself in en.json, and worded
 * in every other language. The three severities are worded as the
 * project's notifications word them (Common/Server/Locales), so a reader
 * meets one name for one severity on the page and in the message about it.
 *
 * A key is a whole name, as written. A severity a project renamed has none
 * and reads as its owner wrote it (DefaultIncidentSeverityNamesInLocale).
 */

const DEFAULT_INCIDENT_SEVERITY_NAMES: ReadonlyArray<string> = [
  "Critical Incident",
  "Major Incident",
  "Minor Incident",
];

describe("OneUptime's default names in the Dashboard's locale files", () => {
  test("the severities a new project starts with are among the default names", () => {
    for (const name of DEFAULT_INCIDENT_SEVERITY_NAMES) {
      expect(DEFAULT_STATUS_NAMES).toContain(name);
    }
  });

  test("every default name is a key of en.json, written as itself", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const missing: Array<string> = DEFAULT_STATUS_NAMES.filter(
      (name: string): boolean => {
        return english[name] !== name;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every default name",
    (language: string) => {
      const unworded: Array<string> = DEFAULT_STATUS_NAMES.filter(
        (name: string): boolean => {
          return !isWordedInDashboardLocale(name, language);
        },
      );

      expect({ language, unworded }).toEqual({ language, unworded: [] });
    },
  );

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s names the severities a new project starts with as its notifications do",
    (language: string) => {
      const dashboard: Record<string, string> = readDashboardLocale(language);
      const server: Readonly<Record<string, string>> | undefined =
        SERVER_LOCALES[language];

      expect(server).toBeDefined();

      for (const name of DEFAULT_INCIDENT_SEVERITY_NAMES) {
        const word: string | undefined = server![name];

        expect({ language, name, isWorded: Boolean(word) }).toEqual({
          language,
          name,
          isWorded: true,
        });
        expect({ language, name, word: dashboard[name] }).toEqual({
          language,
          name,
          word: word,
        });
      }
    },
  );
});
