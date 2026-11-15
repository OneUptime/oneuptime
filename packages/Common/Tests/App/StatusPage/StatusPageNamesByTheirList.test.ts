// UX rule: Docs/ux/README.md#in-every-language
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { translateStatusName } from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusTranslation";
import {
  DEFAULT_STATUS_NAMES,
  StatusPageNameList,
} from "../../../Types/StatusPage/DefaultStatusNames";
import { SUPPORTED_STATUS_PAGE_LANGUAGE_CODES } from "../../../Types/StatusPage/StatusPageLanguage";
import { getDefaultRecordNames } from "../../../Utils/DefaultRecordNames";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * A STATUS PAGE NAMES A RECORD BY ITS OWN LIST (#8066).
 *
 * A status page reads OneUptime's default names of states, severities and
 * statuses in its reader's language, and a project's own names as written
 * (StatusPage/src/Utils/StatusTranslation). It once decided which names
 * were defaults against all four lists at once, so an incident state a
 * project named "Degraded" - a default monitor status, not an incident
 * state - read "Beeinträchtigt" on a German status page, and "Degraded" on
 * the Dashboard and in the incident's own record. It now decides by the
 * record's own list, as the Dashboard does (Utils/DefaultRecordNames).
 */

const STATUS_PAGE_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

type LocaleTree = { [key: string]: string | LocaleTree };

const readLocale: (language: string) => LocaleTree = (
  language: string,
): LocaleTree => {
  return JSON.parse(
    fs.readFileSync(path.join(STATUS_PAGE_LOCALES, `${language}.json`), "utf8"),
  ) as LocaleTree;
};

let mockLocale: LocaleTree = {};

// The status page's i18next, answering from the locale a test picks.
jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/i18n", () => {
  return {
    __esModule: true,
    default: {
      t: (key: string, options?: { defaultValue?: string }): string => {
        let node: string | LocaleTree | undefined = mockLocale;

        for (const part of key.split(".")) {
          node = node && typeof node !== "string" ? node[part] : undefined;
        }

        return typeof node === "string"
          ? node
          : options?.defaultValue !== undefined
            ? options.defaultValue
            : key;
      },
    },
  };
});

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

const STATUS_PAGE_LISTS: ReadonlyArray<StatusPageNameList> = [
  StateListType.IncidentState,
  StateListType.IncidentSeverity,
  StateListType.MonitorStatus,
  StateListType.ScheduledMaintenanceState,
];

const GERMAN: LocaleTree = readLocale("de");

// A default name's word on a German status page, from its statusNames.
const german: (key: string) => string = (key: string): string => {
  return (GERMAN["statusNames"] as LocaleTree)[key] as string;
};

beforeEach(() => {
  mockLocale = GERMAN;
});

describe("a name is a default by its own list", () => {
  test("an incident state named Degraded reads as written; the monitor status Degraded in German", () => {
    expect(translateStatusName(StateListType.IncidentState, "Degraded")).toBe(
      "Degraded",
    );
    expect(translateStatusName(StateListType.MonitorStatus, "Degraded")).toBe(
      german("degraded"),
    );
    expect(german("degraded")).not.toBe("Degraded");
  });

  test("a name on another list's defaults reads as written, on every list", () => {
    const translated: Array<string> = [];

    for (const list of STATUS_PAGE_LISTS) {
      const own: ReadonlyArray<string> = getDefaultRecordNames(list);

      for (const name of DEFAULT_STATUS_NAMES) {
        if (own.includes(name)) {
          continue;
        }

        const word: string = translateStatusName(list, name);

        if (word !== name) {
          translated.push(`${list} named ${name} reads ${word}`);
        }
      }
    }

    expect(translated).toEqual([]);
  });

  test("examples across the lists", () => {
    // A maintenance state named Resolved: an incident state's default.
    expect(
      translateStatusName(StateListType.ScheduledMaintenanceState, "Resolved"),
    ).toBe("Resolved");
    // An incident severity named Ongoing: a maintenance state's default.
    expect(translateStatusName(StateListType.IncidentSeverity, "Ongoing")).toBe(
      "Ongoing",
    );
    // A monitor status named Critical Incident: a severity's default.
    expect(
      translateStatusName(StateListType.MonitorStatus, "Critical Incident"),
    ).toBe("Critical Incident");
    // An incident state named Operational: a monitor status's default.
    expect(
      translateStatusName(StateListType.IncidentState, "Operational"),
    ).toBe("Operational");
  });
});

describe("OneUptime's default names still read in the reader's language", () => {
  test.each(SUPPORTED_STATUS_PAGE_LANGUAGE_CODES)(
    "%s: every default of every list reads its statusNames word",
    (language: string) => {
      mockLocale = readLocale(language);

      const statusNames: LocaleTree = mockLocale["statusNames"] as LocaleTree;
      const words: Array<string> = Object.values(statusNames).map(
        (word: string | LocaleTree): string => {
          return word as string;
        },
      );
      const apart: Array<string> = [];

      for (const list of STATUS_PAGE_LISTS) {
        for (const name of getDefaultRecordNames(list)) {
          const word: string = translateStatusName(list, name);

          // The word is the page's own for a default name, never the key.
          if (!words.includes(word) || word.startsWith("statusNames.")) {
            apart.push(`${list} ${name} reads ${word}`);
          }
        }
      }

      expect({ language, apart }).toEqual({ language, apart: [] });
    },
  );

  test("in German, one of each list", () => {
    expect(translateStatusName(StateListType.IncidentState, "Resolved")).toBe(
      german("resolved"),
    );
    expect(
      translateStatusName(StateListType.IncidentSeverity, "Major Incident"),
    ).toBe(german("majorIncident"));
    expect(
      translateStatusName(StateListType.MonitorStatus, "Operational"),
    ).toBe(german("operational"));
    expect(
      translateStatusName(StateListType.ScheduledMaintenanceState, "Ongoing"),
    ).toBe(german("ongoing"));
  });

  test("a default name with spaces around it reads as the name, as on the Dashboard", () => {
    expect(
      translateStatusName(StateListType.IncidentState, "  Resolved "),
    ).toBe(german("resolved"));
  });
});

describe("a project's own name reads as written", () => {
  test("a name of its own, and a default in another case", () => {
    expect(
      translateStatusName(StateListType.IncidentState, "Investigating"),
    ).toBe("Investigating");
    expect(translateStatusName(StateListType.IncidentState, "resolved")).toBe(
      "resolved",
    );
    expect(
      translateStatusName(StateListType.IncidentSeverity, "Sev 1 (EU)"),
    ).toBe("Sev 1 (EU)");
  });

  test("a name that is a key of every object is the project's, not a lookup", () => {
    for (const name of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(translateStatusName(StateListType.IncidentState, name)).toBe(name);
    }
  });

  test("no name is empty", () => {
    expect(translateStatusName(StateListType.IncidentState, "")).toBe("");
    expect(translateStatusName(StateListType.MonitorStatus, undefined)).toBe(
      "",
    );
    expect(translateStatusName(StateListType.IncidentSeverity, null)).toBe("");
  });
});

describe("every status page call names its record's list", () => {
  const STATUS_PAGE_SOURCE: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/StatusPage/src",
  );

  const sources: () => Array<string> = (): Array<string> => {
    const files: Array<string> = [];
    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "Locales") {
            walk(full);
          }
        } else if (TYPESCRIPT_FILE.test(entry.name)) {
          files.push(full);
        }
      }
    };

    walk(STATUS_PAGE_SOURCE);

    return files;
  };

  /*
   * The list a call hands over is the one its record's name is of: a
   * severity's, an incident state's, a maintenance state's or a monitor
   * status's, read off the name it is handed.
   */
  const LIST_OF_NAME: ReadonlyArray<[RegExp, StateListType]> = [
    [/Severity/, StateListType.IncidentSeverity],
    [/scheduledMaintenanceState/i, StateListType.ScheduledMaintenanceState],
    [/incidentState/i, StateListType.IncidentState],
    [/status/i, StateListType.MonitorStatus],
  ];

  /*
   * A name no rule above reads: the overview's maintenance history hands
   * UptimeMaintenanceUtil a function of the event's state's name.
   */
  const LIST_OF_PLAIN_NAME: Readonly<Record<string, StateListType>> = {
    "Pages/Overview/Overview.tsx: name":
      StateListType.ScheduledMaintenanceState,
  };

  // A call: its list, then the name, with the comma prettier may leave after it.
  const CALL: RegExp = /translateStatusName\(\s*([^,)]*),\s*([^)]*?),?\s*\)/g;

  test("each translateStatusName( is handed the list of the name it is handed", () => {
    const calls: Array<string> = [];
    const wrong: Array<string> = [];

    for (const file of sources()) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of Array.from(source.matchAll(CALL))) {
        const first: string = match[1]!.trim();
        const name: string = match[2]!.trim();
        const where: string = `${path.relative(STATUS_PAGE_SOURCE, file)}: ${name}`;

        // The definition names its parameters.
        if (first.startsWith("list:")) {
          continue;
        }

        calls.push(where);

        const rule: [RegExp, StateListType] | undefined = LIST_OF_NAME.find(
          ([pattern]: [RegExp, StateListType]): boolean => {
            return pattern.test(name);
          },
        );
        const expected: StateListType | undefined =
          rule?.[1] || LIST_OF_PLAIN_NAME[where];

        if (!expected || first !== `StateListType.${expected}`) {
          wrong.push(`${where} is handed ${first}, not ${expected}`);
        }
      }
    }

    // The overview, an incident, an episode, an event and a monitor's card.
    expect(calls.length).toBeGreaterThanOrEqual(15);
    expect(wrong).toEqual([]);
  });
});
