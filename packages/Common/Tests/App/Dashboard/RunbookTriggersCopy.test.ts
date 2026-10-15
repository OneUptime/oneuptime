import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DAY_NAMES,
  DAY_SHORT_NAMES,
  EVERY_HOURS_LABEL,
  EVERY_MINUTES_LABEL,
  MISSED_RUN_LABELS,
  MISSED_RUN_SUMMARIES,
  OVERLAP_LABELS,
  OVERLAP_SUMMARIES,
  REPEAT_LABELS,
  RunbookTriggersDocs,
  SCHEDULE_PROBLEM_TEMPLATES,
  SCHEDULE_SENTENCES,
  TRIGGER_NAMES,
  formatScheduleTime,
  getEveryOptions,
  getMinuteOptions,
  getScheduleProblemText,
  getScheduleSentence,
  translateCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy";
import {
  getRunInputs,
  getTriggerFilterOptions,
  getUnattendedTriggerText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookExecutionTrigger";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import {
  RUNBOOK_SCHEDULE_HOUR_INTERVALS,
  RUNBOOK_SCHEDULE_MAX_CRON_LENGTH,
  RUNBOOK_SCHEDULE_MINUTE_INTERVALS,
  RunbookScheduleChoice,
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  RunbookScheduleProblem,
  RunbookScheduleProblemCode,
  RunbookScheduleRepeat,
  getRunbookScheduleChoiceProblem,
  getRunbookScheduleCronProblem,
} from "../../../Types/Runbook/RunbookSchedule";
import RunbookTriggerType, {
  RUNBOOK_TRIGGER_TYPES,
} from "../../../Types/Runbook/RunbookTriggerType";
import { JSONObject } from "../../../Types/JSON";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * THE TRIGGERS PAGE, IN WORDS.
 *
 * The schedule card and dialog say a schedule in a sentence ("Runs every
 * weekday at 09:00"), name the days and the policies, and say what is wrong
 * with a schedule the server would refuse - in the reader's language, from
 * one whole template per kind of sentence. A run started by a schedule or a
 * webhook says so on the Executions lists and its own page. These pin the
 * sentences, that every one of them is in every locale, and that the
 * dashboard's wording of a schedule problem never drifts from the server's.
 */

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(language: string): Translator {
  const table: Record<string, unknown> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    const value: unknown = table[key];
    return typeof value === "string" ? value : undefined;
  }, language);
}

const english: Translator = createTranslator(undefined, "en");

function choice(
  patch: Partial<RunbookScheduleChoice> = {},
): RunbookScheduleChoice {
  return {
    repeat: RunbookScheduleRepeat.Weekly,
    every: 15,
    minute: 0,
    hour: 9,
    days: [1, 2, 3, 4, 5],
    cron: "",
    ...patch,
  };
}

describe("a schedule in a sentence", () => {
  test("every few minutes, one minute and many", () => {
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 15 }),
        false,
      ),
    ).toBe("Runs every 15 minutes");
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 1 }),
        false,
      ),
    ).toBe("Runs every minute");
  });

  test("every few hours, on the hour or at a minute past it", () => {
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 6, minute: 0 }),
        false,
      ),
    ).toBe("Runs every 6 hours, on the hour");
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 1, minute: 0 }),
        false,
      ),
    ).toBe("Runs every hour, on the hour");
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 2, minute: 5 }),
        false,
      ),
    ).toBe("Runs every 2 hours at :05");
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 1, minute: 30 }),
        false,
      ),
    ).toBe("Runs every hour at :30");
  });

  test("every day, on a 24-hour or a 12-hour clock", () => {
    const daily: RunbookScheduleChoice = choice({
      repeat: RunbookScheduleRepeat.Daily,
      hour: 23,
      minute: 5,
    });

    expect(getScheduleSentence(english, daily, false)).toBe(
      "Runs every day at 23:05",
    );
    expect(getScheduleSentence(english, daily, true)).toBe(
      "Runs every day at 11:05 PM",
    );
  });

  test("on days of the week: weekdays, every day, or the days named in week order", () => {
    expect(getScheduleSentence(english, choice(), false)).toBe(
      "Runs every weekday at 09:00",
    );
    expect(
      getScheduleSentence(
        english,
        choice({ days: [0, 1, 2, 3, 4, 5, 6] }),
        false,
      ),
    ).toBe("Runs every day at 09:00");
    // Sunday is named last: weeks start on Monday here, as the day buttons do.
    expect(
      getScheduleSentence(english, choice({ days: [0, 5, 1, 3] }), false),
    ).toBe("Runs every Monday, Wednesday, Friday and Sunday at 09:00");
    expect(getScheduleSentence(english, choice({ days: [6] }), false)).toBe(
      "Runs every Saturday at 09:00",
    );
  });

  test("a cron expression, as written", () => {
    expect(
      getScheduleSentence(
        english,
        choice({ repeat: RunbookScheduleRepeat.Cron, cron: "0 9 1 * *" }),
        false,
      ),
    ).toBe("Runs on the cron schedule 0 9 1 * *");
  });

  test("in German, with the days in German too", () => {
    const german: Translator = translatorFor("de");

    expect(getScheduleSentence(german, choice(), false)).toBe(
      "Läuft an jedem Wochentag um 09:00",
    );
    expect(
      getScheduleSentence(german, choice({ days: [1, 3] }), false),
    ).toContain("Montag");
    expect(
      getScheduleSentence(
        german,
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 1 }),
        false,
      ),
    ).toBe("Läuft jede Minute");
    expect(
      getScheduleSentence(
        german,
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 5 }),
        false,
      ),
    ).toBe("Läuft alle 5 Minuten");
  });
});

describe("the dialog's choices", () => {
  test("every N minutes and every N hours offer their own steps, labelled with a count", () => {
    expect(
      getEveryOptions(english, RunbookScheduleRepeat.Minutes).map(
        (option: { value: number }): number => {
          return option.value;
        },
      ),
    ).toEqual([...RUNBOOK_SCHEDULE_MINUTE_INTERVALS]);
    expect(
      getEveryOptions(english, RunbookScheduleRepeat.Hours).map(
        (option: { value: number }): number => {
          return option.value;
        },
      ),
    ).toEqual([...RUNBOOK_SCHEDULE_HOUR_INTERVALS]);
    expect(getEveryOptions(english, RunbookScheduleRepeat.Minutes)[0]).toEqual({
      value: 1,
      label: "1 minute",
    });
    expect(getEveryOptions(english, RunbookScheduleRepeat.Hours)[1]).toEqual({
      value: 2,
      label: "2 hours",
    });
  });

  test("minutes past the hour come every five, plus the one a schedule already has", () => {
    expect(getMinuteOptions(0)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
    expect(getMinuteOptions(7)).toEqual([
      0, 5, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
    expect(getMinuteOptions(75)).not.toContain(75);
  });

  test("a time reads 09:00, or 9:00 AM on a 12-hour clock", () => {
    expect(formatScheduleTime(9, 0, false)).toBe("09:00");
    expect(formatScheduleTime(0, 5, false)).toBe("00:05");
    expect(formatScheduleTime(0, 5, true)).toBe("12:05 AM");
    expect(formatScheduleTime(12, 30, true)).toBe("12:30 PM");
    expect(formatScheduleTime(17, 45, true)).toBe("5:45 PM");
  });

  test("every choice and every policy has a label, and every policy a summary", () => {
    for (const repeat of Object.values(RunbookScheduleRepeat)) {
      expect(REPEAT_LABELS[repeat]).toBeTruthy();
    }

    for (const policy of Object.values(RunbookScheduleOverlapPolicy)) {
      expect(OVERLAP_LABELS[policy]).toBeTruthy();
      expect(OVERLAP_SUMMARIES[policy]).toBeTruthy();
    }

    for (const policy of Object.values(RunbookScheduleMissedRunPolicy)) {
      expect(MISSED_RUN_LABELS[policy]).toBeTruthy();
      expect(MISSED_RUN_SUMMARIES[policy]).toBeTruthy();
    }

    expect(DAY_NAMES).toHaveLength(7);
    expect(DAY_SHORT_NAMES).toHaveLength(7);
  });
});

describe("what is wrong with a schedule", () => {
  const problems: Array<RunbookScheduleProblem> = [
    getRunbookScheduleCronProblem("")!,
    getRunbookScheduleCronProblem(
      `0 9 * * ${"1,".repeat(RUNBOOK_SCHEDULE_MAX_CRON_LENGTH)}1`,
    )!,
    getRunbookScheduleCronProblem("0 0 9 * * *")!,
    getRunbookScheduleCronProblem("61 9 * * *")!,
    getRunbookScheduleCronProblem("0 0 31 2 *")!,
    getRunbookScheduleChoiceProblem(
      choice({ repeat: RunbookScheduleRepeat.Minutes, every: 7 }),
    )!,
    getRunbookScheduleChoiceProblem(
      choice({ repeat: RunbookScheduleRepeat.Hours, every: 5 }),
    )!,
    getRunbookScheduleChoiceProblem(
      choice({ repeat: RunbookScheduleRepeat.Hours, every: 2, minute: 60 }),
    )!,
    getRunbookScheduleChoiceProblem(
      choice({ repeat: RunbookScheduleRepeat.Daily, hour: 24 }),
    )!,
    getRunbookScheduleChoiceProblem(choice({ days: [] }))!,
    getRunbookScheduleChoiceProblem(
      choice({ repeat: "Monthly" as RunbookScheduleRepeat }),
    )!,
  ];

  test("every kind of problem is drawn, and each has a template", () => {
    const codes: Set<RunbookScheduleProblemCode> = new Set(
      problems.map((problem: RunbookScheduleProblem) => {
        return problem.code;
      }),
    );

    expect([...codes].sort()).toEqual(
      Object.values(RunbookScheduleProblemCode).sort(),
    );

    for (const code of Object.values(RunbookScheduleProblemCode)) {
      expect(SCHEDULE_PROBLEM_TEMPLATES[code]).toBeTruthy();
    }
  });

  test("in English, the dashboard says exactly what the server refuses with", () => {
    for (const problem of problems) {
      const text: string = getScheduleProblemText(english, problem);

      if (problem.code === RunbookScheduleProblemCode.CronInvalid) {
        // The cron parser's own reason, after a sentence of ours.
        expect(text).toBe(
          `This cron expression cannot be read. ${problem.message}`,
        );
        continue;
      }

      expect(text).toBe(problem.message);
    }
  });

  test("in another language, the whole sentence is translated with its values", () => {
    const german: Translator = translatorFor("de");
    const fieldCount: RunbookScheduleProblem =
      getRunbookScheduleCronProblem("0 9 * *")!;

    expect(getScheduleProblemText(german, fieldCount)).toBe(
      "Ein Runbook-Zeitplan hat fünf Felder – Minute, Stunde, Tag des Monats, Monat und Wochentag – und dieser hat 4. Runbooks laufen höchstens einmal pro Minute, daher gibt es kein Sekundenfeld.",
    );
    expect(
      getScheduleProblemText(
        german,
        getRunbookScheduleChoiceProblem(choice({ days: [] }))!,
      ),
    ).toBe("Wählen Sie mindestens einen Tag.");
  });
});

describe("what started a run", () => {
  function execution(data: {
    triggerType?: RunbookTriggerType;
    triggerDetails?: JSONObject;
    inputs?: unknown;
  }): RunbookExecution {
    const run: RunbookExecution = new RunbookExecution();

    if (data.triggerType) {
      run.triggerType = data.triggerType;
    }

    if (data.triggerDetails) {
      run.triggerDetails = data.triggerDetails;
    }

    if (data.inputs !== undefined) {
      run.inputs = data.inputs as JSONObject;
    }

    return run;
  }

  test("every way a run starts has a name, and the filter offers each", () => {
    for (const trigger of RUNBOOK_TRIGGER_TYPES) {
      expect(TRIGGER_NAMES[trigger]).toBeTruthy();
    }

    expect(
      getTriggerFilterOptions().map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual([...RUNBOOK_TRIGGER_TYPES]);
  });

  test("a scheduled run says when it was due, and whether it made up for missed times or waited", () => {
    const due: string = "2026-10-15T08:00:00.000Z";

    expect(
      getUnattendedTriggerText(
        english,
        execution({
          triggerType: RunbookTriggerType.Schedule,
          triggerDetails: { scheduledFor: due },
        }),
      ),
    ).toEqual({
      label: "Schedule",
      details: [expect.stringMatching(/^Due at /)],
    });

    expect(
      getUnattendedTriggerText(
        english,
        execution({
          triggerType: RunbookTriggerType.Schedule,
          triggerDetails: { scheduledFor: due, isCatchUp: true },
        }),
      )!.details[1],
    ).toBe("Run once to make up for times OneUptime missed");

    expect(
      getUnattendedTriggerText(
        english,
        execution({
          triggerType: RunbookTriggerType.Schedule,
          triggerDetails: { scheduledFor: due, waitedForPreviousRun: true },
        }),
      )!.details[1],
    ).toBe("Waited for the run before it to end");
  });

  test("a time that is not one is left out rather than shown as Invalid date", () => {
    expect(
      getUnattendedTriggerText(
        english,
        execution({
          triggerType: RunbookTriggerType.Schedule,
          triggerDetails: { scheduledFor: "not a time" },
        }),
      ),
    ).toEqual({ label: "Schedule", details: [] });
  });

  test("a webhook run says the address that called it", () => {
    expect(
      getUnattendedTriggerText(
        english,
        execution({
          triggerType: RunbookTriggerType.Webhook,
          triggerDetails: { callerIp: "203.0.113.9" },
        }),
      ),
    ).toEqual({ label: "Webhook", details: ["From 203.0.113.9"] });

    expect(
      getUnattendedTriggerText(
        english,
        execution({ triggerType: RunbookTriggerType.Webhook }),
      ),
    ).toEqual({ label: "Webhook", details: [] });
  });

  test("every other run says what started it through what it carries", () => {
    for (const trigger of [
      RunbookTriggerType.Manual,
      RunbookTriggerType.Rule,
      RunbookTriggerType.AutoRemediation,
      RunbookTriggerType.AI,
    ]) {
      expect(
        getUnattendedTriggerText(english, execution({ triggerType: trigger })),
      ).toBeNull();
    }

    // Runs from before triggers were recorded.
    expect(getUnattendedTriggerText(english, execution({}))).toBeNull();
  });

  test("a run's inputs are an object with values, or nothing", () => {
    expect(getRunInputs(execution({ inputs: { host: "web-1" } }))).toEqual({
      host: "web-1",
    });
    expect(getRunInputs(execution({ inputs: {} }))).toBeNull();
    expect(getRunInputs(execution({ inputs: ["a"] }))).toBeNull();
    expect(getRunInputs(execution({ inputs: null }))).toBeNull();
    expect(getRunInputs(execution({}))).toBeNull();
  });
});

describe("in every language", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(REPEAT_LABELS),
    ...Object.values(OVERLAP_LABELS),
    ...Object.values(OVERLAP_SUMMARIES),
    ...Object.values(MISSED_RUN_LABELS),
    ...Object.values(MISSED_RUN_SUMMARIES),
    ...DAY_NAMES,
    ...DAY_SHORT_NAMES,
    ...Object.values(SCHEDULE_PROBLEM_TEMPLATES),
    ...Object.values(TRIGGER_NAMES),
    SCHEDULE_SENTENCES.everyDay,
    SCHEDULE_SENTENCES.everyWeekday,
    SCHEDULE_SENTENCES.everyDays,
    SCHEDULE_SENTENCES.cron,
    SCHEDULE_SENTENCES.everyMinutes.other,
    SCHEDULE_SENTENCES.everyHoursOnTheHour.other,
    SCHEDULE_SENTENCES.everyHoursAtMinute.other,
    EVERY_MINUTES_LABEL.other,
    EVERY_HOURS_LABEL.other,
  ];

  test("every sentence is a key of every locale", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const language of LANGUAGES) {
      const table: Record<string, unknown> = readLocale(language);
      const missing: Array<string> = SENTENCES.filter(
        (sentence: string): boolean => {
          return typeof table[sentence] !== "string";
        },
      );

      expect({ language, missing }).toEqual({ language, missing: [] });
    }
  });

  test("the schedule's own sentences are translated, not left in English", () => {
    const ownSentences: Array<string> = [
      SCHEDULE_SENTENCES.everyDay,
      SCHEDULE_SENTENCES.everyWeekday,
      SCHEDULE_SENTENCES.everyDays,
      SCHEDULE_SENTENCES.cron,
      SCHEDULE_SENTENCES.everyMinutes.other,
      ...Object.values(SCHEDULE_PROBLEM_TEMPLATES),
    ];

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const table: Record<string, unknown> = readLocale(language);
      const english_: Array<string> = ownSentences.filter(
        (sentence: string): boolean => {
          return table[sentence] === sentence;
        },
      );

      expect({ language, english: english_ }).toEqual({
        language,
        english: [],
      });
    }
  });

  test("a fixed string is a string in every language", () => {
    for (const language of LANGUAGES) {
      expect(
        translateCopy(translatorFor(language), REPEAT_LABELS.Weekly),
      ).toBeTruthy();
    }
  });
});

describe("the docs the cards link to", () => {
  test("are headings of the triggers page", () => {
    expect(RunbookTriggersDocs.schedule).toBe(
      "/docs/runbooks/triggers#run-on-a-schedule",
    );
    expect(RunbookTriggersDocs.webhook).toBe(
      "/docs/runbooks/triggers#call-the-webhook",
    );
  });
});
