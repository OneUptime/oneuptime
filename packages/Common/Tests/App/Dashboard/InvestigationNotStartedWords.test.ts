import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_LANE_SWITCHES,
  AiLane,
  EnableAiCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  getAllNotStartedSentences,
  getInvestigateSwitchTitle,
  getInvestigationNotStartedWords,
  getNotStartedSentences,
  INVESTIGATION_NOT_STARTED_WORDS,
  InvestigationNotStartedWords,
  NOT_STARTED_BY_KIND,
  NotStartedCodeWords,
  NotStartedSentence,
  NotStartedSubjectType,
  WORDED_NOT_STARTED_CODES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStartedWords";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../Types/AI/InvestigationNotStartedReason";
import {
  createTranslator,
  getTemplatePlaceholders,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHY OneUptime AI DID NOT INVESTIGATE, IN THE READER'S LANGUAGE (#6656).
 *
 * The record's AI card says why nothing was investigated. The server words
 * the reason in English and still sends it, for API readers and older
 * Dashboards; the card words each code itself, from how it was decided and
 * the facts sent with it, so a German or Arabic reader reads it in their
 * own language. These tests pin the English the card draws for every code
 * and kind, as decided then and as the settings are now, each fact's
 * effect, and that no line of it is English in any other language.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const KINDS: Array<NotStartedSubjectType> = ["incident", "alert"];
type Source = InvestigationNotStartedReason["source"];
const SOURCES: Array<Source> = ["recorded", "current_configuration"];

// What the server sends, which the card never draws for a code it words.
const SERVER_LINES: Array<string> = [
  "The server's title",
  "The server's description.",
  "The server's next step.",
];

function reasonOf(
  code: InvestigationNotStartedCode,
  overrides: Partial<InvestigationNotStartedReason> = {},
): InvestigationNotStartedReason {
  return {
    code,
    title: SERVER_LINES[0]!,
    description: SERVER_LINES[1]!,
    nextStep: SERVER_LINES[2]!,
    source: "recorded",
    evaluatedAt: "2026-09-17T12:24:00.000Z",
    // Only ever decided when an AI rule's wait ends, with the wait.
    ...(code === "resolved_before_investigation"
      ? { decidedAfterWaitMinutes: 10 }
      : {}),
    ...overrides,
  };
}

// The card's lines as drawn, or null where it draws the server's English.
function drawn(
  code: InvestigationNotStartedCode,
  kind: NotStartedSubjectType,
  overrides: Partial<InvestigationNotStartedReason> = {},
  translator: Translator = ENGLISH,
): InvestigationNotStartedWords | null {
  return getInvestigationNotStartedWords({
    reason: reasonOf(code, overrides),
    subjectType: kind,
    translator,
  });
}

// The lines as a reader reads them: the isolates' marks taken out.
function read(
  code: InvestigationNotStartedCode,
  kind: NotStartedSubjectType,
  overrides: Partial<InvestigationNotStartedReason> = {},
  translator: Translator = ENGLISH,
): [string, string, string] {
  const words: InvestigationNotStartedWords | null = drawn(
    code,
    kind,
    overrides,
    translator,
  );

  if (!words) {
    throw new Error(`No words for ${code} (${kind})`);
  }

  return [
    withoutIsolateMarks(words.title),
    withoutIsolateMarks(words.description),
    withoutIsolateMarks(words.nextStep),
  ];
}

describe("the card words every code the server can send", () => {
  const typeSource: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Types",
      "AI",
      "InvestigationNotStartedReason.ts",
    ),
    "utf8",
  );
  const union: string = (typeSource.match(
    /export type InvestigationNotStartedCode =([\s\S]*?);/,
  ) || [])[1] as string;
  const codes: Array<string> = Array.from(
    (union || "").matchAll(/\|\s*"([a-z_]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  test("reads the union from the type's source", () => {
    expect(codes).toContain("ai_disabled");
    expect(codes).toContain("no_run_recorded");
    expect(codes.length).toBeGreaterThanOrEqual(15);
  });

  test("words each code, for incidents and for alerts alike", () => {
    expect([...WORDED_NOT_STARTED_CODES].sort()).toEqual([...codes].sort());

    for (const kind of KINDS) {
      expect(Object.keys(INVESTIGATION_NOT_STARTED_WORDS[kind]).sort()).toEqual(
        [...codes].sort(),
      );
    }
  });

  test.each(
    KINDS.flatMap((kind: NotStartedSubjectType) => {
      return SOURCES.flatMap((source: Source) => {
        return WORDED_NOT_STARTED_CODES.map(
          (
            code: InvestigationNotStartedCode,
          ): [InvestigationNotStartedCode, NotStartedSubjectType, Source] => {
            return [code, kind, source];
          },
        );
      });
    }),
  )(
    "%s (%s, %s): three lines of its own, none the server's",
    (
      code: InvestigationNotStartedCode,
      kind: NotStartedSubjectType,
      source: Source,
    ) => {
      const lines: Array<string> = read(code, kind, { source });

      for (const line of lines) {
        expect(line.trim().length).toBeGreaterThan(0);
        expect(SERVER_LINES).not.toContain(line);
        // Every placeholder is filled.
        expect(line).not.toMatch(/\{\{|\}\}/);
      }
    },
  );

  test.each([
    "future_reason",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ])(
    "draws no words of its own for %s: the card then draws the server's",
    (code: string) => {
      for (const kind of KINDS) {
        expect(drawn(code as InvestigationNotStartedCode, kind)).toBeNull();
      }
    },
  );
});

/*
 * The English the card draws for an incident, as decided then (recorded)
 * and as the settings are now (current_configuration).
 */
const INCIDENT_ENGLISH: Record<
  InvestigationNotStartedCode,
  Record<"recorded" | "current_configuration", [string, string, string]>
> = {
  ai_disabled: {
    recorded: [
      "AI was off for this project",
      "“Enable AI” was off, so no investigation started.",
      "Check that “Enable AI” is on. This applies to new incidents only, not to this one.",
    ],
    current_configuration: [
      "AI is off for this project",
      "“Enable AI” is off, so no new investigation can start.",
      "Turn on “Enable AI”. This applies to new incidents only, not to this one.",
    ],
  },
  automatic_investigation_disabled: {
    recorded: [
      "AI investigation was off",
      "“Investigate new incidents” was off, so no investigation started.",
      "Check that “Investigate new incidents” is on. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
    current_configuration: [
      "AI investigation is off",
      "“Investigate new incidents” is off, so no new investigation can start.",
      "Turn on “Investigate new incidents”. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
  },
  provider_missing: {
    recorded: [
      "No LLM provider was available",
      "OneUptime AI had no LLM provider to run on, so no investigation started.",
      "Set up an LLM provider for the project. This applies to new incidents only, not to this one.",
    ],
    current_configuration: [
      "No LLM provider is available",
      "OneUptime AI has no LLM provider to run on, so no new investigation can start.",
      "Set up an LLM provider for the project. This applies to new incidents only, not to this one.",
    ],
  },
  insufficient_ai_balance: {
    recorded: [
      "The project was out of AI credits",
      "The project had no AI credits left, so no investigation started.",
      "Add AI credits to the project. This applies to new incidents only, not to this one.",
    ],
    current_configuration: [
      "The project is out of AI credits",
      "The project has no AI credits left, so no new investigation can start.",
      "Add AI credits to the project. This applies to new incidents only, not to this one.",
    ],
  },
  project_daily_limit_reached: {
    recorded: [
      "The project's daily AI limit was reached",
      "The project had reached one of its own daily AI limits, so no investigation started.",
      "OneUptime AI investigates this incident when the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under More settings.",
    ],
    current_configuration: [
      "The project's daily AI limit is reached",
      "The project has reached one of its own daily AI limits, so no new investigation can start before midnight UTC.",
      "Raise or remove the limit under More settings, or wait until midnight UTC, when it resets. This applies to new incidents only, not to this one.",
    ],
  },
  severity_below_threshold: {
    recorded: [
      "Severity was below the minimum for AI investigation",
      "OneUptime AI investigates only the incidents at or above a minimum severity, and this one was below it.",
      "Lower or clear the minimum severity for AI investigation. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
    current_configuration: [
      "Severity is below the minimum for AI investigation",
      "OneUptime AI investigates only the incidents at or above a minimum severity, and this one is below it.",
      "Lower or clear the minimum severity for AI investigation. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
  },
  monitor_cooldown: {
    recorded: [
      "Skipped during the re-investigation cooldown",
      "Another incident on the same monitor had been investigated within the re-investigation cooldown, so no investigation started.",
      "Shorten or clear the re-investigation cooldown. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
    current_configuration: [
      "Within the re-investigation cooldown",
      "Another incident on the same monitor was investigated within the re-investigation cooldown, so no new investigation can start yet.",
      "Shorten or clear the re-investigation cooldown. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
  },
  no_investigation_rule_matched: {
    recorded: [
      "This incident was outside the AI rules that investigate",
      "OneUptime AI investigates only the incidents that match one of the AI rules that investigate, and this one matched none.",
      "Add or change an AI rule so it matches incidents like this one. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
    current_configuration: [
      "This incident is outside the AI rules that investigate",
      "OneUptime AI investigates only the incidents that match one of the AI rules that investigate, and this one matches none.",
      "Add or change an AI rule so it matches incidents like this one. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
  },
  created_resolved: {
    recorded: [
      "This incident was created already resolved",
      "The incident was over before it was recorded, so OneUptime AI did not investigate it automatically.",
      "To look into this incident anyway, ask OneUptime AI below.",
    ],
    current_configuration: [
      "This incident was created already resolved",
      "The incident was over before it was recorded, so OneUptime AI did not investigate it automatically.",
      "To look into this incident anyway, ask OneUptime AI below.",
    ],
  },
  resolved_before_investigation: {
    recorded: [
      "Resolved before the investigation started",
      "An AI rule made OneUptime AI wait 10 minutes to see whether this incident would still be open. It was resolved first, so it was not investigated.",
      "To look into this incident anyway, ask OneUptime AI below. The wait is set on the AI rules, under More settings.",
    ],
    current_configuration: [
      "Resolved before the investigation started",
      "An AI rule made OneUptime AI wait 10 minutes to see whether this incident would still be open. It was resolved first, so it was not investigated.",
      "To look into this incident anyway, ask OneUptime AI below. The wait is set on the AI rules, under More settings.",
    ],
  },
  daily_budget_exhausted: {
    recorded: [
      "The daily AI token limit was reached",
      "AI work had used up the day's “Daily Incident AI Token Limit”, so no investigation started.",
      "Raise “Daily Incident AI Token Limit” under More settings, or wait until midnight UTC, when usage resets. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
    current_configuration: [
      "The daily AI token limit is reached",
      "AI work has used up today's “Daily Incident AI Token Limit”, so no new investigation can start before midnight UTC.",
      "Raise “Daily Incident AI Token Limit” under More settings, or wait until midnight UTC, when usage resets. This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    ],
  },
  budget_check_failed: {
    recorded: [
      "The AI token limit could not be checked",
      "OneUptime AI could not check the daily AI token limit, so it started no investigation that might go over it.",
      "Ask a project administrator to check the service's health and the AI settings. Nothing is tried again automatically.",
    ],
    current_configuration: [
      "The AI token limit cannot be checked right now",
      "OneUptime AI cannot check the daily AI token limit right now, so it cannot tell whether a new investigation could start.",
      "Ask a project administrator to check the service's health and the AI settings. Nothing is tried again automatically.",
    ],
  },
  enqueue_failed: {
    recorded: [
      "The investigation could not be queued",
      "OneUptime AI could not save the investigation to its queue, so none started.",
      "Ask a project administrator to check the service's health and the server logs. Nothing is tried again automatically.",
    ],
    current_configuration: [
      "The investigation queue cannot be checked right now",
      "OneUptime AI cannot tell right now whether a new investigation could be queued.",
      "Ask a project administrator to check the service's health and the server logs. Nothing is tried again automatically.",
    ],
  },
  eligibility_check_failed: {
    recorded: [
      "The AI checks could not be finished",
      "OneUptime AI could not finish the checks it runs before an automatic investigation, so none started.",
      "Ask a project administrator to check the service's health and the AI settings. Nothing is tried again automatically.",
    ],
    current_configuration: [
      "The AI checks cannot be finished right now",
      "OneUptime AI cannot finish the checks it runs before an automatic investigation right now.",
      "Ask a project administrator to check the service's health and the AI settings. Nothing is tried again automatically.",
    ],
  },
  no_run_recorded: {
    recorded: [
      "No investigation was recorded",
      "This incident would be investigated under today's settings, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
      "Automatic investigation starts when an incident is created, so turning it on later does not investigate older ones. If new incidents are not investigated either, check the AI Logs.",
    ],
    current_configuration: [
      "No investigation was recorded",
      "This incident would be investigated under today's settings, but no investigation or decision was recorded for it. The settings may have changed since it was created.",
      "Automatic investigation starts when an incident is created, so turning it on later does not investigate older ones. If new incidents are not investigated either, check the AI Logs.",
    ],
  },
};

// An alert's words are an incident's, naming an alert instead.
function asAlert(text: string): string {
  return text.replace(/incident/g, "alert").replace(/Incident/g, "Alert");
}

describe("in English", () => {
  test("every code has its pinned words", () => {
    expect(Object.keys(INCIDENT_ENGLISH).sort()).toEqual(
      [...WORDED_NOT_STARTED_CODES].sort(),
    );
  });

  test.each(
    SOURCES.flatMap((source: Source) => {
      return WORDED_NOT_STARTED_CODES.map(
        (
          code: InvestigationNotStartedCode,
        ): [InvestigationNotStartedCode, Source] => {
          return [code, source];
        },
      );
    }),
  )(
    "%s, %s, for an incident",
    (code: InvestigationNotStartedCode, source: Source) => {
      expect(read(code, "incident", { source })).toEqual(
        INCIDENT_ENGLISH[code][source as "recorded" | "current_configuration"],
      );
    },
  );

  test.each(
    SOURCES.flatMap((source: Source) => {
      return WORDED_NOT_STARTED_CODES.map(
        (
          code: InvestigationNotStartedCode,
        ): [InvestigationNotStartedCode, Source] => {
          return [code, source];
        },
      );
    }),
  )(
    "%s, %s, for an alert: the incident's words, naming an alert",
    (code: InvestigationNotStartedCode, source: Source) => {
      expect(read(code, "alert", { source })).toEqual(
        INCIDENT_ENGLISH[code][
          source as "recorded" | "current_configuration"
        ].map(asAlert),
      );
    },
  );

  /*
   * A language whose words agree with the record's gender needs to know
   * which record a sentence names, so each kind's sentences name only it.
   */
  test("an incident's sentences never name an alert, nor an alert's an incident", () => {
    for (const kind of KINDS) {
      const other: RegExp = kind === "incident" ? /alert/i : /incident/i;

      for (const code of WORDED_NOT_STARTED_CODES) {
        for (const sentence of getNotStartedSentences(
          INVESTIGATION_NOT_STARTED_WORDS[kind][code],
        )) {
          const forms: Array<string> =
            typeof sentence === "string"
              ? [sentence]
              : [sentence.one, sentence.other];

          for (const form of forms) {
            expect({ kind, code, form, namesOther: other.test(form) }).toEqual({
              kind,
              code,
              form,
              namesOther: false,
            });
          }
        }
      }
    }
  });

  test("says the decision was taken then in the past, and the settings now in the present", () => {
    for (const code of [
      "ai_disabled",
      "provider_missing",
      "insufficient_ai_balance",
      "severity_below_threshold",
      "daily_budget_exhausted",
    ] as Array<InvestigationNotStartedCode>) {
      expect(read(code, "incident")[0]).toMatch(/\bwas\b/);
      expect(
        read(code, "incident", { source: "current_configuration" })[0],
      ).toMatch(/\bis\b/);
    }
  });
});

describe("the settings a reason names are named as their pages draw them", () => {
  const DASHBOARD_SRC: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );

  test("the AI switch is the AI Features page's", () => {
    expect(EnableAiCopy.switchTitle).toBe("Enable AI");
    expect(read("ai_disabled", "alert")[1]).toContain("“Enable AI”");
  });

  test("the record's own switch is its AI settings page's", () => {
    for (const [kind, lane] of [
      ["incident", AiLane.Incident],
      ["alert", AiLane.Alert],
    ] as Array<[NotStartedSubjectType, AiLane]>) {
      const title: string = getInvestigateSwitchTitle(kind);

      expect(title).toBe(
        kind === "incident"
          ? "Investigate new incidents"
          : "Investigate new alerts",
      );
      expect(
        AI_LANE_SWITCHES[lane].map((definition: { title: string }) => {
          return definition.title;
        }),
      ).toContain(title);
      expect(read("automatic_investigation_disabled", kind)[1]).toContain(
        `“${title}”`,
      );
    }
  });

  test.each([
    ["incident", "Pages/Incidents/Settings/IncidentAISettings.tsx"],
    ["alert", "Pages/Alerts/Settings/AlertAISettings.tsx"],
  ] as Array<[NotStartedSubjectType, string]>)(
    "the %s daily token limit is the field its AI settings page titles",
    (kind: NotStartedSubjectType, page: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, page),
        "utf8",
      );
      const name: string = NOT_STARTED_BY_KIND[kind].tokenLimitName;

      expect(source).toContain(`title: ${JSON.stringify(name)}`);
      expect(read("daily_budget_exhausted", kind)[1]).toContain(`“${name}”`);
    },
  );
});

describe("the facts a reason carries", () => {
  describe("severity names", () => {
    const FACTS: InvestigationNotStartedReason["facts"] = {
      severityName: "Low",
      minimumSeverityName: "High",
    };

    test.each(KINDS)(
      "a %s's severity and the minimum, by name",
      (kind: NotStartedSubjectType) => {
        const record: string = kind === "incident" ? "incident" : "alert";

        expect(
          read("severity_below_threshold", kind, { facts: FACTS })[1],
        ).toBe(
          `This ${record}'s severity, Low, was below the minimum for AI investigation, High.`,
        );
        expect(
          read("severity_below_threshold", kind, {
            facts: FACTS,
            source: "current_configuration",
          })[1],
        ).toBe(
          `This ${record}'s severity, Low, is below the minimum for AI investigation, High.`,
        );
      },
    );

    test.each([
      [{ severityName: "Low" }],
      [{ minimumSeverityName: "High" }],
      [{ severityName: "  ", minimumSeverityName: "High" }],
      [{}],
      [undefined],
    ])(
      "with a name missing, the sentence names neither: %j",
      (facts: InvestigationNotStartedReason["facts"]) => {
        expect(read("severity_below_threshold", "incident", { facts })).toEqual(
          INCIDENT_ENGLISH.severity_below_threshold.recorded,
        );
      },
    );

    test("a name is the project's own data: set apart in an Arabic or Persian sentence", () => {
      for (const language of ["ar", "fa"]) {
        const words: InvestigationNotStartedWords = drawn(
          "severity_below_threshold",
          "incident",
          { facts: FACTS },
          dashboardTranslator(language),
        )!;

        expect(words.description).toContain(isolated("Low"));
        expect(words.description).toContain(isolated("High"));
      }
    });

    // German has words for "Low" and "High"; a project's names stay its own.
    test("a name is never translated, even where the language has a word like it", () => {
      const words: InvestigationNotStartedWords = drawn(
        "severity_below_threshold",
        "alert",
        { facts: FACTS },
        dashboardTranslator("de"),
      )!;

      expect(withoutIsolateMarks(words.description)).toBe(
        "Der Schweregrad dieser Warnung, Low, lag unter dem Mindestwert für KI-Untersuchungen, High.",
      );
    });

    test("only the severity reason names them", () => {
      expect(read("monitor_cooldown", "incident", { facts: FACTS })).toEqual(
        INCIDENT_ENGLISH.monitor_cooldown.recorded,
      );
    });
  });

  describe("the re-investigation cooldown", () => {
    test.each([
      [1, "of 1 minute,"],
      [2, "of 2 minutes,"],
      [30, "of 30 minutes,"],
      [1440, "of 1,440 minutes,"],
    ])("%i minutes reads %s", (minutes: number, phrase: string) => {
      for (const source of SOURCES) {
        const description: string = read("monitor_cooldown", "alert", {
          source,
          facts: { cooldownWindowMinutes: minutes },
        })[1];

        expect(description).toContain(
          `within the re-investigation cooldown ${phrase}`,
        );
      }
    });

    test.each([[0], [-5], [0.5], [Number.NaN]])(
      "a cooldown of %p is not said",
      (minutes: number) => {
        expect(
          read("monitor_cooldown", "incident", {
            facts: { cooldownWindowMinutes: minutes },
          }),
        ).toEqual(INCIDENT_ENGLISH.monitor_cooldown.recorded);
      },
    );

    test("German says one minute in its one form", () => {
      const german: Translator = dashboardTranslator("de");
      const one: string = read(
        "monitor_cooldown",
        "incident",
        { facts: { cooldownWindowMinutes: 1 } },
        german,
      )[1];
      const many: string = read(
        "monitor_cooldown",
        "incident",
        { facts: { cooldownWindowMinutes: 30 } },
        german,
      )[1];

      expect(one).toContain("von 1 Minute untersucht");
      expect(many).toContain("von 30 Minuten untersucht");
    });

    /*
     * Arabic reads its general form for 0, 2, 3-10, 11-99 and 100 and up
     * (ARABIC.md): the short unit, the same for every count.
     */
    test.each([
      [1, "(1 دقيقة)"],
      [2, "(2 د)"],
      [5, "(5 د)"],
      [11, "(11 د)"],
      [100, "(100 د)"],
    ])("Arabic says %i minutes as %s", (minutes: number, phrase: string) => {
      expect(
        read(
          "monitor_cooldown",
          "incident",
          { facts: { cooldownWindowMinutes: minutes } },
          dashboardTranslator("ar"),
        )[1],
      ).toContain(phrase);
    });

    test.each([[1], [2], [5], [21]])(
      "Russian says %i minutes with a unit every count reads",
      (minutes: number) => {
        expect(
          read(
            "monitor_cooldown",
            "alert",
            { facts: { cooldownWindowMinutes: minutes } },
            dashboardTranslator("ru"),
          )[1],
        ).toContain(`(${minutes} мин.)`);
      },
    );

    test("Persian writes the count in its own digits", () => {
      expect(
        read(
          "monitor_cooldown",
          "incident",
          { facts: { cooldownWindowMinutes: 30 } },
          dashboardTranslator("fa"),
        )[1],
      ).toContain("۳۰");
    });
  });

  describe("a daily token limit of 0 pauses the work", () => {
    test.each(KINDS)(
      "for an %s, as decided then and as it is now",
      (kind: NotStartedSubjectType) => {
        const limit: string = NOT_STARTED_BY_KIND[kind].tokenLimitName;

        expect(
          read("daily_budget_exhausted", kind, {
            facts: { dailyTokenLimit: 0 },
          }),
        ).toEqual([
          "Automatic AI work was paused",
          `“${limit}” was set to 0, which pauses automatic AI work, so no investigation started.`,
          `Raise “${limit}” above 0 under More settings, or clear it. This applies to new ${kind}s only, not to this one. You can still ask OneUptime AI about it.`,
        ]);
        expect(
          read("daily_budget_exhausted", kind, {
            facts: { dailyTokenLimit: 0 },
            source: "current_configuration",
          }),
        ).toEqual([
          "Automatic AI work is paused",
          `“${limit}” is set to 0, which pauses automatic AI work.`,
          `Raise “${limit}” above 0 under More settings, or clear it. This applies to new ${kind}s only, not to this one. You can still ask OneUptime AI about it.`,
        ]);
      },
    );

    test("waiting until midnight is never offered for a limit of 0", () => {
      expect(
        read("daily_budget_exhausted", "incident", {
          facts: { dailyTokenLimit: 0 },
        })[2],
      ).not.toContain("midnight");
    });

    test.each([[50000], [1], [undefined]])(
      "a limit of %p is used up, not paused",
      (dailyTokenLimit: number | undefined) => {
        expect(
          read("daily_budget_exhausted", "incident", {
            facts:
              dailyTokenLimit === undefined ? undefined : { dailyTokenLimit },
          }),
        ).toEqual(INCIDENT_ENGLISH.daily_budget_exhausted.recorded);
      },
    );

    test("only the daily token limit's reason can be paused", () => {
      expect(
        read("project_daily_limit_reached", "incident", {
          facts: { dailyTokenLimit: 0 },
        }),
      ).toEqual(INCIDENT_ENGLISH.project_daily_limit_reached.recorded);
    });
  });

  describe("a decision taken when an AI rule's wait ended", () => {
    test("says the record matched no rule any more, rather than that it never did", () => {
      expect(
        read("no_investigation_rule_matched", "alert", {
          decidedAfterWaitMinutes: 15,
        })[1],
      ).toBe(
        "An AI rule made OneUptime AI wait, and when the wait ended this alert matched none of the AI rules that investigate any more: it or the rules had changed.",
      );
    });

    test("the settings as they are now never mention the wait", () => {
      expect(
        read("no_investigation_rule_matched", "incident", {
          decidedAfterWaitMinutes: 15,
          source: "current_configuration",
        }),
      ).toEqual(
        INCIDENT_ENGLISH.no_investigation_rule_matched.current_configuration,
      );
    });

    test("another reason reads as it does at creation", () => {
      expect(
        read("severity_below_threshold", "incident", {
          decidedAfterWaitMinutes: 15,
        }),
      ).toEqual(INCIDENT_ENGLISH.severity_below_threshold.recorded);
    });

    test.each([
      [1, "wait 1 minute to see"],
      [45, "wait 45 minutes to see"],
    ])(
      "resolved during a wait of %i says %s",
      (minutes: number, phrase: string) => {
        expect(
          read("resolved_before_investigation", "incident", {
            decidedAfterWaitMinutes: minutes,
          })[1],
        ).toContain(phrase);
      },
    );

    test("resolved during a wait whose length did not arrive: the server's words", () => {
      expect(
        drawn("resolved_before_investigation", "incident", {
          decidedAfterWaitMinutes: undefined,
        }),
      ).toBeNull();
    });
  });

  describe("a reason nothing could be read for", () => {
    test("says neither the decision nor today's checks could be read", () => {
      expect(
        read("eligibility_check_failed", "incident", { source: "unknown" })[1],
      ).toBe(
        "No investigation was found, and neither the decision taken then nor today's checks could be read.",
      );
    });

    test("no run recorded reads as it always does", () => {
      expect(read("no_run_recorded", "alert", { source: "unknown" })).toEqual(
        INCIDENT_ENGLISH.no_run_recorded.recorded.map(asAlert),
      );
    });
  });
});

/*
 * Every placeholder of a sentence is one the card fills for that code, so
 * no reader ever sees {{settingName}}.
 */
describe("every sentence's placeholders are filled for its code", () => {
  function placeholdersAllowed(words: NotStartedCodeWords): Array<string> {
    return [
      ...(words.settingName ? ["settingName", "switchName"] : []),
      ...(words.withFacts?.needs.includes("severityName")
        ? ["severity", "minimumSeverity"]
        : []),
      ...(words.count ? ["count"] : []),
    ];
  }

  test.each(
    KINDS.flatMap((kind: NotStartedSubjectType) => {
      return WORDED_NOT_STARTED_CODES.map(
        (
          code: InvestigationNotStartedCode,
        ): [InvestigationNotStartedCode, NotStartedSubjectType] => {
          return [code, kind];
        },
      );
    }),
  )(
    "%s (%s)",
    (code: InvestigationNotStartedCode, kind: NotStartedSubjectType) => {
      const words: NotStartedCodeWords =
        INVESTIGATION_NOT_STARTED_WORDS[kind][code];
      const allowed: Array<string> = placeholdersAllowed(words);

      for (const sentence of getNotStartedSentences(words)) {
        const forms: Array<string> =
          typeof sentence === "string"
            ? [sentence]
            : [sentence.one, sentence.other];

        for (const form of forms) {
          for (const placeholder of getTemplatePlaceholders(form)) {
            expect({
              form,
              placeholder,
              allowed: allowed.includes(placeholder),
            }).toEqual({ form, placeholder, allowed: true });
          }
        }

        // A count is only ever in a sentence that has a form for one.
        if (typeof sentence === "string") {
          expect(getTemplatePlaceholders(sentence)).not.toContain("count");
        }
      }
    },
  );
});

/*
 * IN EVERY DASHBOARD LANGUAGE, NO LINE IS ENGLISH: every code and kind, as
 * decided then and as the settings are now, with each fact.
 */

interface Variant {
  code: InvestigationNotStartedCode;
  overrides: Partial<InvestigationNotStartedReason>;
}

const VARIANTS: Array<Variant> = [
  ...SOURCES.flatMap((source: Source) => {
    return WORDED_NOT_STARTED_CODES.map(
      (code: InvestigationNotStartedCode): Variant => {
        return { code, overrides: { source } };
      },
    );
  }),
  ...SOURCES.flatMap((source: Source): Array<Variant> => {
    return [
      {
        code: "severity_below_threshold",
        overrides: {
          source,
          facts: { severityName: "Low", minimumSeverityName: "High" },
        },
      },
      {
        code: "monitor_cooldown",
        overrides: { source, facts: { cooldownWindowMinutes: 1 } },
      },
      {
        code: "monitor_cooldown",
        overrides: { source, facts: { cooldownWindowMinutes: 30 } },
      },
      {
        code: "daily_budget_exhausted",
        overrides: { source, facts: { dailyTokenLimit: 0 } },
      },
    ];
  }),
  {
    code: "no_investigation_rule_matched",
    overrides: { decidedAfterWaitMinutes: 15 },
  },
  {
    code: "resolved_before_investigation",
    overrides: { decidedAfterWaitMinutes: 1 },
  },
  { code: "eligibility_check_failed", overrides: { source: "unknown" } },
  { code: "no_run_recorded", overrides: { source: "unknown" } },
];

/*
 * The only Latin words a line in a language not written in Latin letters
 * keeps: product and protocol names, and the severity names a reason sends.
 */
const KEPT_AS_WRITTEN: RegExp = /OneUptime AI|OneUptime|LLM|UTC|AI|Low|High/g;
const NOT_LATIN_SCRIPT: Array<string> = [
  "ar",
  "fa",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
];

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);

  test("no line of any reason is the English one", () => {
    for (const kind of KINDS) {
      for (const variant of VARIANTS) {
        const english: Array<string> = read(
          variant.code,
          kind,
          variant.overrides,
        );
        const translated: Array<string> = read(
          variant.code,
          kind,
          variant.overrides,
          translator,
        );

        translated.forEach((line: string, index: number) => {
          expect({
            kind,
            ...variant,
            line,
            isEnglish: line === english[index],
          }).toEqual({ kind, ...variant, line, isEnglish: false });
          expect(line).not.toMatch(/\{\{|\}\}/);
        });
      }
    }
  });

  if (NOT_LATIN_SCRIPT.includes(language)) {
    test("no English word is left in any line", () => {
      for (const kind of KINDS) {
        for (const variant of VARIANTS) {
          for (const line of read(
            variant.code,
            kind,
            variant.overrides,
            translator,
          )) {
            const rest: string = line.replace(KEPT_AS_WRITTEN, "");

            expect({ line, latin: rest.match(/[A-Za-z]+/g) }).toEqual({
              line,
              latin: null,
            });
          }
        }
      }
    });
  }
});

describe("every sentence the card may draw is listed once", () => {
  test("getAllNotStartedSentences holds each sentence of each code and kind", () => {
    const all: Array<NotStartedSentence> = getAllNotStartedSentences();
    const keys: Array<string> = all.map(
      (sentence: NotStartedSentence): string => {
        return typeof sentence === "string" ? sentence : sentence.other;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);

    for (const kind of KINDS) {
      for (const code of WORDED_NOT_STARTED_CODES) {
        for (const sentence of getNotStartedSentences(
          INVESTIGATION_NOT_STARTED_WORDS[kind][code],
        )) {
          expect(keys).toContain(
            typeof sentence === "string" ? sentence : sentence.other,
          );
        }
      }
    }
  });

  test("the setting names a sentence quotes are among them", () => {
    const keys: Array<string> = getAllNotStartedSentences().map(
      (sentence: NotStartedSentence): string => {
        return typeof sentence === "string" ? sentence : sentence.other;
      },
    );

    expect(keys).toEqual(
      expect.arrayContaining([
        "Enable AI",
        "Investigate new incidents",
        "Investigate new alerts",
        "Daily Incident AI Token Limit",
        "Daily Alert AI Token Limit",
      ]),
    );
  });
});
