import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RESPONSE_TARGET_UNIT_LABELS,
  RESPONSE_TARGET_UNIT_MINUTES,
  RESPONSE_TARGET_UNITS,
  ResponseTargetEntry,
  ResponseTargetUnit,
  getTargetFieldError,
  getTargetFieldValue,
  readTargetEntry,
  splitTargetMinutes,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetDuration";
import {
  RESPONSE_TARGETS_COPY,
  RESPONSE_TARGET_DURATION_COPY,
  SECURITY_CASE_DUE_CELL_IN,
  SECURITY_CASE_DUE_CELL_OVERDUE,
  SECURITY_CASE_TARGET_DUE_AT,
  SECURITY_CASE_TARGET_DUE_IN,
  SECURITY_CASE_TARGET_NAMES,
  SECURITY_CASE_TARGET_OVERDUE_BY,
  SECURITY_CASE_TARGET_TILE_NOTES,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import {
  SecurityCaseDue,
  SecurityCaseTargetCase,
  SecurityCaseTargetNote,
  SecurityCaseTargetTone,
  getSecurityCaseDue,
  getSecurityCaseTargetNote,
  getSecurityCaseTargetTone,
  getSecurityCaseTargetToneClassName,
  getSecurityCaseTargetToneColor,
  projectHasTargets,
  readCaseTargets,
  roundTargetMinutes,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/SecurityCaseTargetDisplay";
import {
  SECURITY_CASE_OPEN_TASKS,
  SECURITY_CASE_TASKS_COPY,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasksCopy";
import {
  SECURITY_CASE_TASKS_LIMIT,
  SECURITY_CASE_TASK_SELECT,
  SECURITY_CASE_TASK_TITLE_LIMIT,
  getSecurityCaseTaskProgress,
  readNewTaskTitle,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasksModel";
import {
  SECURITY_CASE_EVIDENCE_COPY,
  SECURITY_CASE_EVIDENCE_FILE_TYPES,
  getEvidenceDownloadUrl,
  getEvidenceMeta,
  shortenSha256,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceCopy";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import URL from "Common/Types/API/URL";
import { Amber500, Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import MimeType from "Common/Types/File/MimeType";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import {
  SecurityCaseTarget,
  SecurityCaseTargetReading,
  SecurityCaseTargetState,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";
import {
  buildDefaultTestPriorities,
  buildDefaultTestPrioritiesWithTargets,
  testPriorityId,
} from "Common/Tests/Helpers/SecurityCaseValues";

/*
 * A security case's response targets, tasks and evidence as the Dashboard
 * draws them, by the React-free rules behind the pages:
 *
 *   - a target as a person enters it - a whole number and a unit, empty for
 *     none, a year at most - and as the field shows a saved one, in the
 *     largest unit it fills whole;
 *   - where a case stands: the header's chip and the lists' Due column (the
 *     next target, how long is left or how far past it, grey, amber or
 *     red), and the Overview's notes under Time to Acknowledge and Time to
 *     Contain;
 *   - a case's checklist: what the page reads, the progress, a new task's
 *     title;
 *   - a piece of evidence: where its file downloads from, its SHA-256 as a
 *     column shows it;
 *   - every word of them a key every Dashboard locale has, each sentence
 *     with a value worded in the language's own words (a translation the
 *     same as the English would be filled with English values).
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);
const OPENED: Date = new Date("2026-10-14T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(OPENED.getTime() + minutes * MINUTE);
}

function entry(amount: string, unit: ResponseTargetUnit): ResponseTargetEntry {
  return { amount, unit };
}

const PRIORITIES: Array<SecurityCasePriority> =
  buildDefaultTestPrioritiesWithTargets();

// A Critical case, opened at OPENED: acknowledge by minute 15, contain by 240.
function criticalCase(
  overrides: Partial<SecurityCaseTargetCase> = {},
): SecurityCaseTargetCase {
  return {
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Critical),
    createdAt: OPENED,
    acknowledgeDueAt: at(15),
    containDueAt: at(240),
    ...overrides,
  };
}

function due(
  overrides: Partial<SecurityCaseTargetCase>,
  now: Date,
): SecurityCaseDue | null {
  return getSecurityCaseDue({
    securityCase: criticalCase(overrides),
    priorities: PRIORITIES,
    now,
  });
}

function readings(
  overrides: Partial<SecurityCaseTargetCase>,
  now: Date,
): Array<SecurityCaseTargetReading> {
  return readCaseTargets({
    securityCase: criticalCase(overrides),
    priorities: PRIORITIES,
    now,
  });
}

function note(
  overrides: Partial<SecurityCaseTargetCase>,
  now: Date,
  target: SecurityCaseTarget,
): SecurityCaseTargetNote | null {
  const reading: SecurityCaseTargetReading = readings(overrides, now).find(
    (candidate: SecurityCaseTargetReading): boolean => {
      return candidate.target === target;
    },
  )!;

  return getSecurityCaseTargetNote(reading);
}

describe("a target as a person enters it", () => {
  test("in minutes, hours or days, the field's three units", () => {
    expect(RESPONSE_TARGET_UNITS).toEqual([
      ResponseTargetUnit.Minutes,
      ResponseTargetUnit.Hours,
      ResponseTargetUnit.Days,
    ]);
    expect(RESPONSE_TARGET_UNIT_MINUTES).toEqual({
      [ResponseTargetUnit.Minutes]: 1,
      [ResponseTargetUnit.Hours]: 60,
      [ResponseTargetUnit.Days]: 1440,
    });
    expect(RESPONSE_TARGET_UNIT_LABELS).toEqual({
      [ResponseTargetUnit.Minutes]: "Minutes",
      [ResponseTargetUnit.Hours]: "Hours",
      [ResponseTargetUnit.Days]: "Days",
    });
  });

  test("a saved target shows in the largest unit it fills whole; none shows empty, in hours", () => {
    expect(splitTargetMinutes(15)).toEqual(
      entry("15", ResponseTargetUnit.Minutes),
    );
    expect(splitTargetMinutes(90)).toEqual(
      entry("90", ResponseTargetUnit.Minutes),
    );
    expect(splitTargetMinutes(60)).toEqual(
      entry("1", ResponseTargetUnit.Hours),
    );
    expect(splitTargetMinutes(240)).toEqual(
      entry("4", ResponseTargetUnit.Hours),
    );
    expect(splitTargetMinutes(1500)).toEqual(
      entry("25", ResponseTargetUnit.Hours),
    );
    expect(splitTargetMinutes(1440)).toEqual(
      entry("1", ResponseTargetUnit.Days),
    );
    expect(splitTargetMinutes(4320)).toEqual(
      entry("3", ResponseTargetUnit.Days),
    );
    expect(splitTargetMinutes("720")).toEqual(
      entry("12", ResponseTargetUnit.Hours),
    );

    for (const none of [null, undefined, "", 0, -5, 1.5, 525601, "soon"]) {
      expect(splitTargetMinutes(none)).toEqual(
        entry("", ResponseTargetUnit.Hours),
      );
    }
  });

  test("a whole number from 1, in its unit, is kept as minutes; empty is no target", () => {
    expect(readTargetEntry(entry("", ResponseTargetUnit.Hours))).toEqual({
      minutes: null,
      error: null,
    });
    expect(readTargetEntry(entry("  ", ResponseTargetUnit.Days))).toEqual({
      minutes: null,
      error: null,
    });
    expect(readTargetEntry(entry(" 4 ", ResponseTargetUnit.Hours))).toEqual({
      minutes: 240,
      error: null,
    });
    expect(readTargetEntry(entry("15", ResponseTargetUnit.Minutes))).toEqual({
      minutes: 15,
      error: null,
    });
    expect(readTargetEntry(entry("1", ResponseTargetUnit.Days))).toEqual({
      minutes: 1440,
      error: null,
    });
  });

  test("anything but a whole number from 1 is refused, in the field's words", () => {
    for (const amount of ["0", "1.5", "-1", "abc", "1e3", "4h", "1234567890"]) {
      expect(readTargetEntry(entry(amount, ResponseTargetUnit.Hours))).toEqual({
        minutes: null,
        error: RESPONSE_TARGET_DURATION_COPY.wholeNumber,
      });
    }
    expect(RESPONSE_TARGET_DURATION_COPY.wholeNumber).toBe(
      "Enter a whole number from 1 up, or leave it empty.",
    );
  });

  test("a year at the most: 365 days, 8760 hours or 525600 minutes", () => {
    expect(readTargetEntry(entry("365", ResponseTargetUnit.Days)).minutes).toBe(
      525600,
    );
    expect(
      readTargetEntry(entry("8760", ResponseTargetUnit.Hours)).minutes,
    ).toBe(525600);
    expect(
      readTargetEntry(entry("525600", ResponseTargetUnit.Minutes)).minutes,
    ).toBe(525600);

    for (const tooLong of [
      entry("366", ResponseTargetUnit.Days),
      entry("8761", ResponseTargetUnit.Hours),
      entry("525601", ResponseTargetUnit.Minutes),
    ]) {
      expect(readTargetEntry(tooLong)).toEqual({
        minutes: null,
        error: RESPONSE_TARGET_DURATION_COPY.tooLong,
      });
    }
  });

  test("the form gets minutes, null for none, or the entry itself, which its validation refuses", () => {
    expect(getTargetFieldValue(entry("4", ResponseTargetUnit.Hours))).toBe(240);
    expect(getTargetFieldValue(entry("", ResponseTargetUnit.Hours))).toBeNull();

    const refused: ResponseTargetEntry = entry("0", ResponseTargetUnit.Hours);
    expect(getTargetFieldValue(refused)).toBe(refused);

    expect(getTargetFieldError(refused)).toBe(
      RESPONSE_TARGET_DURATION_COPY.wholeNumber,
    );
    expect(getTargetFieldError(entry("400", ResponseTargetUnit.Days))).toBe(
      RESPONSE_TARGET_DURATION_COPY.tooLong,
    );
    expect(getTargetFieldError(240)).toBeNull();
    expect(getTargetFieldError(null)).toBeNull();
    expect(getTargetFieldError(undefined)).toBeNull();
    expect(getTargetFieldError("")).toBeNull();
    expect(getTargetFieldError(0)).toBe(
      RESPONSE_TARGET_DURATION_COPY.wholeNumber,
    );
  });
});

describe("where a case stands against its targets", () => {
  test("each state has its tone and color: grey on track, amber at risk, red missed or met late, green met", () => {
    expect(
      [
        SecurityCaseTargetState.None,
        SecurityCaseTargetState.OnTrack,
        SecurityCaseTargetState.AtRisk,
        SecurityCaseTargetState.Missed,
        SecurityCaseTargetState.Met,
        SecurityCaseTargetState.MetLate,
      ].map((state: SecurityCaseTargetState): SecurityCaseTargetTone => {
        return getSecurityCaseTargetTone(state);
      }),
    ).toEqual([
      SecurityCaseTargetTone.Neutral,
      SecurityCaseTargetTone.Neutral,
      SecurityCaseTargetTone.Warning,
      SecurityCaseTargetTone.Danger,
      SecurityCaseTargetTone.Success,
      SecurityCaseTargetTone.Danger,
    ]);
    expect(getSecurityCaseTargetToneColor(SecurityCaseTargetTone.Neutral)).toBe(
      Gray500,
    );
    expect(getSecurityCaseTargetToneColor(SecurityCaseTargetTone.Warning)).toBe(
      Amber500,
    );
    expect(getSecurityCaseTargetToneColor(SecurityCaseTargetTone.Danger)).toBe(
      Red500,
    );
    expect(getSecurityCaseTargetToneColor(SecurityCaseTargetTone.Success)).toBe(
      Green500,
    );
    // Words drawn on their own use the shades both themes remap.
    expect(
      getSecurityCaseTargetToneClassName(SecurityCaseTargetTone.Danger),
    ).toBe("text-red-700");
    expect(
      getSecurityCaseTargetToneClassName(SecurityCaseTargetTone.Warning),
    ).toBe("text-amber-700");
  });

  test("minutes left read rounded up, never under a minute", () => {
    expect(roundTargetMinutes(null)).toBe(1);
    expect(roundTargetMinutes(Number.NaN)).toBe(1);
    expect(roundTargetMinutes(0)).toBe(1);
    expect(roundTargetMinutes(0.2)).toBe(1);
    expect(roundTargetMinutes(2.5)).toBe(3);
    expect(roundTargetMinutes(3)).toBe(3);
  });

  test("the header and the Due column: the acknowledge target first, in grey while there is time", () => {
    const chip: SecurityCaseDue = due({}, at(5))!;

    expect(chip).toEqual({
      target: SecurityCaseTarget.Acknowledge,
      state: SecurityCaseTargetState.OnTrack,
      dueAt: at(15),
      minutes: 10,
      isOverdue: false,
      tone: SecurityCaseTargetTone.Neutral,
      template: "Acknowledge in {{time}}",
    });
  });

  test("in amber in the target's last fifth, and red, overdue, once it is past", () => {
    expect(due({}, at(13))).toEqual(
      expect.objectContaining({
        state: SecurityCaseTargetState.AtRisk,
        minutes: 2,
        tone: SecurityCaseTargetTone.Warning,
      }),
    );
    expect(due({}, at(20))).toEqual(
      expect.objectContaining({
        state: SecurityCaseTargetState.Missed,
        minutes: 5,
        isOverdue: true,
        tone: SecurityCaseTargetTone.Danger,
        template: "Acknowledge overdue by {{time}}",
      }),
    );
  });

  test("once acknowledged, the contain target; once contained, or closed, nothing", () => {
    expect(due({ acknowledgedAt: at(5) }, at(100))).toEqual(
      expect.objectContaining({
        target: SecurityCaseTarget.Contain,
        minutes: 140,
        template: "Contain in {{time}}",
      }),
    );
    expect(
      due({ acknowledgedAt: at(5), containedAt: at(30) }, at(100)),
    ).toBeNull();
    // Closing a case straight from New acknowledges it too (SecurityCaseStatuses).
    expect(
      due({ acknowledgedAt: at(30), closedAt: at(30) }, at(100)),
    ).toBeNull();
  });

  test("a missed acknowledge target stays the one shown, before the contain target", () => {
    expect(due({ acknowledgeMissedAt: at(15) }, at(200))).toEqual(
      expect.objectContaining({
        target: SecurityCaseTarget.Acknowledge,
        isOverdue: true,
        template: "Acknowledge overdue by {{time}}",
      }),
    );
  });

  test("a case with no due times shows nothing", () => {
    expect(
      due({ acknowledgeDueAt: null, containDueAt: null }, at(5)),
    ).toBeNull();
  });

  test("the Overview's notes: due in, overdue by, within its target, or how far over it", () => {
    expect(note({}, at(5), SecurityCaseTarget.Acknowledge)).toEqual({
      template: SECURITY_CASE_TARGET_TILE_NOTES.dueIn,
      minutes: 10,
      targetInMinutes: 15,
      tone: SecurityCaseTargetTone.Neutral,
    });
    expect(note({}, at(20), SecurityCaseTarget.Acknowledge)).toEqual({
      template: SECURITY_CASE_TARGET_TILE_NOTES.overdueBy,
      minutes: 5,
      targetInMinutes: 15,
      tone: SecurityCaseTargetTone.Danger,
    });
    expect(
      note({ acknowledgedAt: at(10) }, at(20), SecurityCaseTarget.Acknowledge),
    ).toEqual({
      template: SECURITY_CASE_TARGET_TILE_NOTES.withinTarget,
      minutes: null,
      targetInMinutes: 15,
      tone: SecurityCaseTargetTone.Success,
    });
    expect(
      note({ acknowledgedAt: at(25) }, at(30), SecurityCaseTarget.Acknowledge),
    ).toEqual({
      template: SECURITY_CASE_TARGET_TILE_NOTES.overTarget,
      minutes: 10,
      targetInMinutes: 15,
      tone: SecurityCaseTargetTone.Danger,
    });
  });

  test("a priority without a target any more: met by its due time, or how far past it", () => {
    const informational: Partial<SecurityCaseTargetCase> = {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Informational,
      ),
    };

    expect(
      note(
        { ...informational, acknowledgedAt: at(10) },
        at(20),
        SecurityCaseTarget.Acknowledge,
      ),
    ).toEqual(
      expect.objectContaining({
        template: SECURITY_CASE_TARGET_TILE_NOTES.metByDueTime,
        targetInMinutes: null,
      }),
    );
    expect(
      note(
        { ...informational, acknowledgedAt: at(25) },
        at(30),
        SecurityCaseTarget.Acknowledge,
      ),
    ).toEqual(
      expect.objectContaining({
        template: SECURITY_CASE_TARGET_TILE_NOTES.pastDueTime,
        minutes: 10,
      }),
    );
  });

  test("no note for a target the case never had", () => {
    expect(
      note({ acknowledgeDueAt: null }, at(5), SecurityCaseTarget.Acknowledge),
    ).toBeNull();
  });

  test("the lists draw the Due column only for a project whose priorities set a target", () => {
    expect(projectHasTargets(PRIORITIES)).toBe(true);
    expect(projectHasTargets(buildDefaultTestPriorities())).toBe(false);
    expect(projectHasTargets([])).toBe(false);
  });
});

describe("a case's checklist", () => {
  function task(isDone: boolean): SecurityCaseTask {
    const model: SecurityCaseTask = new SecurityCaseTask();
    model.isDone = isDone;
    return model;
  }

  test("counts the tasks done of all of them", () => {
    expect(
      getSecurityCaseTaskProgress([task(true), task(false), task(true)]),
    ).toEqual({ done: 2, total: 3 });
    expect(getSecurityCaseTaskProgress([])).toEqual({ done: 0, total: 0 });
    expect(SECURITY_CASE_TASKS_COPY.progress).toBe(
      "{{done}} of {{total}} done",
    );
  });

  test("a new task's title is sent trimmed, and nothing is sent for an empty or too long one", () => {
    expect(readNewTaskTitle("  Reset the admin password  ")).toBe(
      "Reset the admin password",
    );
    expect(readNewTaskTitle("   ")).toBeNull();
    expect(readNewTaskTitle("x".repeat(SECURITY_CASE_TASK_TITLE_LIMIT))).toBe(
      "x".repeat(500),
    );
    expect(
      readNewTaskTitle("x".repeat(SECURITY_CASE_TASK_TITLE_LIMIT + 1)),
    ).toBeNull();
  });

  test("reads who has each task and who ticked it off, enough for a checklist", () => {
    expect(SECURITY_CASE_TASKS_LIMIT).toBe(200);
    expect(Object.keys(SECURITY_CASE_TASK_SELECT).sort()).toEqual(
      [
        "_id",
        "title",
        "isDone",
        "doneAt",
        "createdAt",
        "assignedToUserId",
        "assignedToUser",
        "doneByUserId",
        "doneByUser",
      ].sort(),
    );
  });

  test("the Close Case reminder counts the open tasks, one or many", () => {
    expect(SECURITY_CASE_OPEN_TASKS).toEqual({
      one: "{{count}} task on this case is still open.",
      other: "{{count}} tasks on this case are still open.",
    });
  });
});

describe("a piece of evidence", () => {
  test("its file downloads from the evidence route, under the project and the evidence", () => {
    expect(
      getEvidenceDownloadUrl({
        apiUrl: URL.fromString("https://oneuptime.example.com/api"),
        projectId: "11111111-1111-4111-8111-111111111111",
        evidenceId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toBe(
      "https://oneuptime.example.com/api/security-case-evidence/file/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444",
    );
  });

  test("its SHA-256 reads short in a column, its two ends kept", () => {
    const sha256: string =
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    expect(shortenSha256(sha256)).toBe("2cf24dba…9824");
    expect(shortenSha256("abc")).toBe("abc");
    expect(shortenSha256(null)).toBe("");
    expect(shortenSha256(undefined)).toBe("");
  });

  test("a file can be any type an upload may be, each once; anything else goes in a .zip", () => {
    expect(new Set(SECURITY_CASE_EVIDENCE_FILE_TYPES).size).toBe(
      SECURITY_CASE_EVIDENCE_FILE_TYPES.length,
    );
    expect(SECURITY_CASE_EVIDENCE_FILE_TYPES).toContain(MimeType.zip);
    /*
     * The picker lists the kinds and the 10 MB under it: the field says
     * what to do with the rest, and asks for one file.
     */
    expect(SECURITY_CASE_EVIDENCE_COPY.fileFieldDescription).toBe(
      "Put any other kind of file, or several files, in a .zip.",
    );
    expect(SECURITY_CASE_EVIDENCE_COPY.filePlaceholder).toBe("Upload a file");
  });

  test("the line under its name says what the name does not: a file's own name and size, a link's address", () => {
    // Named for what it shows: its file and size, or its address, under it.
    expect(
      getEvidenceMeta({
        name: "Okta System Log export",
        isFile: true,
        fileName: "okta-system-log.json",
        size: "470.8 KB",
        link: null,
      }),
    ).toBe("okta-system-log.json · 470.8 KB");
    expect(
      getEvidenceMeta({
        name: "Okta admin console",
        isFile: false,
        link: "https://acme.okta.example/admin",
        size: "",
      }),
    ).toBe("https://acme.okta.example/admin");

    /*
     * Added without a name, it is named after its file or its address: the
     * line no longer says it a second time - a file its size alone, a link
     * nothing more.
     */
    expect(
      getEvidenceMeta({
        name: "screenshot.png",
        isFile: true,
        fileName: "screenshot.png",
        size: "820 B",
        link: null,
      }),
    ).toBe("820 B");
    expect(
      getEvidenceMeta({
        name: "https://acme.okta.example/admin",
        isFile: false,
        link: "https://acme.okta.example/admin",
        size: "",
      }),
    ).toBe("");

    // Nothing known about a file but its name: no line.
    expect(
      getEvidenceMeta({
        name: "capture.pcap",
        isFile: true,
        fileName: "capture.pcap",
        size: "",
        link: null,
      }),
    ).toBe("");
    // A link that opens nowhere (not http or https) is never written out.
    expect(
      getEvidenceMeta({
        name: "Ticket",
        isFile: false,
        link: null,
        size: "",
      }),
    ).toBe("");
  });
});

describe("the words, in every Dashboard language", () => {
  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    })
    .sort();

  function locale(file: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, unknown>;
  }

  const WORDS: Array<string> = Array.from(
    new Set<string>([
      ...Object.values(RESPONSE_TARGETS_COPY),
      ...Object.values(SECURITY_CASE_TARGET_NAMES),
      ...Object.values(SECURITY_CASE_TARGET_DUE_IN),
      ...Object.values(SECURITY_CASE_TARGET_OVERDUE_BY),
      SECURITY_CASE_TARGET_DUE_AT,
      SECURITY_CASE_DUE_CELL_IN,
      SECURITY_CASE_DUE_CELL_OVERDUE,
      ...Object.values(SECURITY_CASE_TARGET_TILE_NOTES),
      ...Object.values(RESPONSE_TARGET_DURATION_COPY),
      ...Object.values(SECURITY_CASE_TASKS_COPY),
      SECURITY_CASE_OPEN_TASKS.other,
      ...Object.values(SECURITY_CASE_EVIDENCE_COPY),
    ]),
  );

  test("are seventeen locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test("every word is a key of every locale", () => {
    for (const file of LOCALE_FILES) {
      const values: Record<string, unknown> = locale(file);

      expect({
        file,
        missing: WORDS.filter((word: string): boolean => {
          return typeof values[word] !== "string";
        }),
      }).toEqual({ file, missing: [] });
      expect(typeof values[`${SECURITY_CASE_OPEN_TASKS.other}_one`]).toBe(
        "string",
      );
    }
  });

  test("every sentence with a value is worded in each language's own words", () => {
    const sentences: Array<string> = WORDS.filter((word: string): boolean => {
      return word.includes("{{");
    });

    expect(sentences.length).toBeGreaterThan(15);

    for (const file of LOCALE_FILES.filter((name: string): boolean => {
      return name !== "en.json";
    })) {
      const values: Record<string, unknown> = locale(file);

      expect({
        file,
        english: sentences.filter((sentence: string): boolean => {
          return values[sentence] === sentence;
        }),
      }).toEqual({ file, english: [] });
    }
  });
});
