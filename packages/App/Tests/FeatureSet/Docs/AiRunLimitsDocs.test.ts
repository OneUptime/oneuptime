import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { drawnPath } from "./DocsProductsMenu";
import {
  PACKAGES_ROOT,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  PROJECT_AI_RUN_LIMIT_FIELDS,
  PROJECT_AI_RUN_LIMITS_CARD_KEY,
  ProjectAiRunLimitField,
  ProjectAiRunLimitsCopy,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
  DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "Common/Types/AI/AIAgentRunLimits";
import { PROJECT_AI_RUN_LIMIT_COLUMNS } from "Common/Types/AI/ProjectAiRunLimits";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import Permission from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * Issue #6440: an AI run has no artificial limits by default. The docs say
 * so - the AI SRE page's Limits per run section, the pages that used to
 * quote a run's caps, and the 13 → 14 upgrade note - in every language, and
 * this test holds each claim to the code that makes it true: the default
 * time limit, the chat apps' time, the card's title and fields, who may
 * change them, the order the time limits are taken in, the note a stopped
 * run ends with, the migration that adds nothing but empty columns, and the
 * numbers a Runner from before this release still winds down on.
 */

const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const AI_FEATURES_PAGE: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx",
);
const MIGRATION: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809080210000-AddProjectAiRunLimits.ts",
);
const CODE_FIX_COMPLETION: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
);

const SECTION_HEADING: string = `### ${ProjectAiRunLimitsCopy.cardTitle}`;
const NOTE_HEADING: string = "### AI runs are held only to a time limit";
const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const PREVIOUS_NOTE_HEADING: string = "### AI has no limits by default";
const NEXT_NOTE_HEADING: string =
  "### The AI Logs get an index for the daily AI limits";
const SETTINGS_PATH: Array<string> = ["Project Settings", "AI", "AI Features"];
const SETTINGS_URL: string =
  "https://oneuptime.example.com/dashboard/project-id/settings/ai-features#LimitsPerRun";
const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;
const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";
const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// Line breaks read as one space, so a claim may wrap anywhere.
function flat(markdown: string): string {
  return markdown.replace(/\s*\n\s*/g, " ").trim();
}

function page(language: string, file: string): string {
  return read(path.join(CONTENT_DIR, language, file));
}

function legacyConstant(name: string): number {
  const match: RegExpMatchArray | null = read(CODE_FIX_COMPLETION).match(
    new RegExp(`export const ${name}: number = ([\\d_]+);`),
  );

  if (!match) {
    throw new Error(`No constant ${name}`);
  }

  return Number((match[1] as string).replace(/_/g, ""));
}

/*
 * The whole numbers a text states, in Latin or Persian digits, with any
 * digit grouping read away: "100.000", "100 000" and "۱۰۰٬۰۰۰" are 100000.
 */
function statedNumbers(text: string): Array<number> {
  const latin: string = text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });

  return (latin.match(/\d+(?:[,.\u00a0\u202f ٬]\d{3})*/g) || []).map(
    (number: string): number => {
      return Number(number.replace(/[^\d]/g, ""));
    },
  );
}

function englishSection(): string {
  return flat(getSection(page("en", "ai/ai-sre.md"), SECTION_HEADING));
}

function englishNote(): string {
  return flat(
    getSection(page("en", "installation/upgrading.md"), NOTE_HEADING),
  );
}

function stopNote(reason: AIRunStopReason, limits: AIAgentRunLimits): string {
  return AIAgentRunLimitsHelper.getStopNote({
    reason,
    limits,
    settingsUrl: SETTINGS_URL,
  });
}

describe("the AI SRE page's Limits per run section", () => {
  it("sits under Cost controls, after the daily limits and before AI credits, under the card's title", () => {
    const headings: Array<string> = getHeadings(page("en", "ai/ai-sre.md"));
    const position: number = headings.indexOf(SECTION_HEADING);

    expect(ProjectAiRunLimitsCopy.cardTitle).toBe("Limits per run");
    expect(position).toBeGreaterThan(headings.indexOf("## Cost controls"));
    expect(headings[position - 1]).toBe("#### When a limit is reached");
    expect(headings[position + 1]).toBe("### When AI credits run out");
    expect(
      headings.filter((heading: string): boolean => {
        return heading === SECTION_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("says only the time limit holds a run by default, at the code's default", () => {
    const text: string = englishSection();
    const defaults: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    expect(text).toContain(
      `Nothing limits how far one run of OneUptime AI goes — an investigation, an Ask AI, Slack or Microsoft Teams answer, a triage, a fix or a code task — but its time limit: ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes unless the project sets its own.`,
    );
    expect(text).toContain(
      "A run makes as many model and tool calls as its work needs.",
    );
    expect(defaults.maxLlmCalls).toBeUndefined();
    expect(defaults.maxToolCalls).toBeUndefined();
    expect(defaults.maxTokens).toBeUndefined();
    expect(defaults.maxWallClockMs).toBe(
      DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES * MILLISECONDS_IN_A_MINUTE,
    );
    expect(AIAgentRunLimitsHelper.fromSettings({})).toEqual(defaults);
  });

  it("names the four settings by the titles the card shows, in its order, where the card is", () => {
    const text: string = englishSection();
    const card: string = read(AI_FEATURES_PAGE);
    const positions: Array<number> = PROJECT_AI_RUN_LIMIT_FIELDS.map(
      (field: ProjectAiRunLimitField): number => {
        return text.indexOf(`**${field.title}**`);
      },
    );

    expect(
      PROJECT_AI_RUN_LIMIT_FIELDS.map(
        (field: ProjectAiRunLimitField): string => {
          return field.title;
        },
      ),
    ).toEqual([
      "Model Calls per Run",
      "Tool Calls per Run",
      "Tokens per Run",
      "Time Limit per Run (Minutes)",
    ]);
    expect(
      positions.every((at: number): boolean => {
        return at > -1;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);
    expect(text).toContain(
      `set limits on **Project Settings → AI → AI Features**, under **More settings**, in its **${ProjectAiRunLimitsCopy.cardTitle}** section:`,
    );
    expect(PROJECT_AI_RUN_LIMITS_LOCATION).toBe(
      `Project Settings → AI → AI Features → More settings → ${ProjectAiRunLimitsCopy.cardTitle}`,
    );
    // The card is on that page, built from those fields.
    expect(card).toContain("PROJECT_AI_RUN_LIMIT_FIELDS.map(");
    expect(card).toContain("id: PROJECT_AI_RUN_LIMITS_CARD_KEY,");
    expect(PROJECT_AI_RUN_LIMITS_CARD_KEY).toBe("LimitsPerRun");
  });

  it("says each is empty until set, and a lane's investigation time limit comes first, as the limits are worked out", () => {
    const migration: string = read(MIGRATION);
    const withLane: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      timeLimitInMinutes: 30,
      lane: {
        timeLimitInMinutes: 10,
        source: AIRunTimeLimitSource.IncidentInvestigation,
      },
    });
    const withEmptyLane: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings(
      {
        timeLimitInMinutes: 30,
        lane: {
          timeLimitInMinutes: null,
          source: AIRunTimeLimitSource.AlertInvestigation,
        },
      },
    );

    expect(englishSection()).toContain(
      "Each is empty until you set it, and an incident or alert investigation time limit, where one is set, comes first.",
    );
    expect(withLane.maxWallClockMs).toBe(10 * MILLISECONDS_IN_A_MINUTE);
    expect(withLane.timeLimitSource).toBe(
      AIRunTimeLimitSource.IncidentInvestigation,
    );
    expect(withEmptyLane.maxWallClockMs).toBe(30 * MILLISECONDS_IN_A_MINUTE);
    expect(withEmptyLane.timeLimitSource).toBe(AIRunTimeLimitSource.Project);

    // Four empty columns: no default, and no row written.
    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect(migration).toContain(`ADD "${column}" integer\``);
    }

    expect(migration).not.toMatch(/DEFAULT|UPDATE|NOT NULL/);
  });

  it("names who may change them from the columns' own access control", () => {
    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect({
        column,
        update: new Project().getColumnAccessControlFor(column)?.update,
      }).toEqual({
        column,
        update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
      });
    }

    expect(englishSection()).toContain(
      "Only a project owner or someone with **Manage Billing** can change them.",
    );
  });

  it("says a stopped run ends with a note that names the limit and links to it, as the note does", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      maxModelCalls: 7,
      maxToolCalls: 5,
      maxTokens: 9000,
    });
    const where: string = `[${PROJECT_AI_RUN_LIMITS_LOCATION}](${SETTINGS_URL})`;

    expect(englishSection()).toContain(
      "A run that reaches a limit answers with what it found, ending with a note that names the limit and links to it.",
    );
    expect(stopNote(AIRunStopReason.ModelCalls, limits)).toContain(
      "limit of 7 model calls per run",
    );
    expect(stopNote(AIRunStopReason.ToolCalls, limits)).toContain(
      "limit of 5 tool calls per run",
    );
    expect(stopNote(AIRunStopReason.Tokens, limits)).toContain(
      "limit of 9,000 tokens per run",
    );

    for (const reason of [
      AIRunStopReason.ModelCalls,
      AIRunStopReason.ToolCalls,
      AIRunStopReason.Tokens,
      AIRunStopReason.TimeLimit,
    ]) {
      expect({
        reason,
        links: stopNote(reason, limits).includes(where),
      }).toEqual({ reason, links: true });
    }
  });

  it("says a run that keeps repeating itself is stopped, in the loop note's words", () => {
    expect(englishSection()).toContain(
      "An investigation or an answer that keeps repeating calls that show it nothing new is stopped, and you can stop any run yourself.",
    );
    expect(
      stopNote(AIRunStopReason.Loop, AIAgentRunLimitsHelper.getDefault()),
    ).toContain("it kept repeating calls that showed it nothing new");
  });

  it("says a Slack or Microsoft Teams answer takes at most the chat apps' time", () => {
    const answer: AIAgentRunLimits = AIAgentRunLimitsHelper.withTimeCeiling(
      AIAgentRunLimitsHelper.getDefault(),
      CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
      AIRunTimeLimitSource.ChatApp,
    );

    expect(englishSection()).toContain(
      `A Slack or Microsoft Teams answer takes at most ${CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES} minutes.`,
    );
    expect(answer.maxWallClockMs).toBe(
      CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MILLISECONDS_IN_A_MINUTE,
    );
  });

  it("says an investigation runs within that time limit, and the table's unset time limit is the project's", () => {
    const text: string = flat(page("en", "ai/ai-sre.md"));

    expect(text).toContain(
      `An investigation runs until it is done, within its time limit — ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes unless your project sets its own — and nothing caps how many queries or commands it runs.`,
    );
    expect(text).toContain(
      "set an **investigation time limit** per signal type, or limits per run for the whole project (see **Cost controls** below).",
    );
    expect(text).toContain(
      `Unset (the default) means **the project's time limit per run**: ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes unless the project sets its own.`,
    );
    expect(text).toContain("same limits per run as autonomous investigations");
  });
});

// What each page said of a run's caps, which no page says any more.
const OLD_CAPS: Array<[string, Array<string>]> = [
  [
    "ai/ai-sre.md",
    [
      "runaway guard",
      "100 LLM calls and 300 tool calls",
      "per-run budget",
      "**no time limit**",
    ],
  ],
  ["ai/ai-agent.md", ["budget", "**40 LLM calls**", "At most **12** queries"]],
  ["ai/github-app.md", ["budget", "up to 40 LLM calls", "at most 12"]],
  ["ai/external-mcp-servers.md", ["at most 40 calls to MCP servers"]],
  ["ai/ask-ai.md", ["at most 30 for one answer"]],
  ["ai/infrastructure-ai-agents.md", ["200 per investigation", "runaway"]],
];

describe("the AI pages no longer quote a run's old caps", () => {
  it.each(OLD_CAPS)("%s", (file: string, gone: Array<string>) => {
    const text: string = flat(page("en", file));

    for (const words of gone) {
      expect({ file, words, said: text.includes(words) }).toEqual({
        file,
        words,
        said: false,
      });
    }
  });

  it("the pages that shared a budget say they share the limits", () => {
    expect(flat(page("en", "ai/ai-agent.md"))).toContain(
      "It is the same agent, the same Runner and the same limits; only the trigger differs.",
    );
    expect(flat(page("en", "ai/ai-agent.md"))).toContain(
      "They count toward the run's limits, and their edits land in the same commit as the fix.",
    );
    expect(flat(page("en", "ai/external-mcp-servers.md"))).toContain(
      "A run's calls to MCP servers count toward the project's limits per run, when it sets them.",
    );
    expect(flat(page("en", "ai/ask-ai.md"))).toContain(
      "as many as the answer needs, checked by OneUptime and again by the agent, in every permission mode.",
    );
  });
});

describe("the 13 → 14 upgrade note on AI runs", () => {
  it("sits right after the note that AI has no limits by default, once", () => {
    const upgrading: string = page("en", "installation/upgrading.md");
    const headings: Array<string> = getHeadings(
      getSection(upgrading, THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(-1);
    expect(headings[position - 1]).toBe(PREVIOUS_NOTE_HEADING);
    expect(headings[position + 1]).toBe(NEXT_NOTE_HEADING);
    expect(
      getHeadings(upgrading).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("says what a run stopped at before and what holds it now", () => {
    const note: string = englishNote();

    expect(note).toContain(
      `and ${legacyConstant("LEGACY_MAX_COMPLETION_CALLS")} model calls and ${legacyConstant("LEGACY_MAX_OUTPUT_TOKENS").toLocaleString("en-US")} output tokens for a code task.`,
    );
    expect(note).toContain(
      "such as 100 model calls and 300 tool calls for an investigation",
    );
    expect(note).toContain(
      `They are gone: a run now makes as many calls as its work needs, for up to ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes.`,
    );
    expect(note).toContain(
      `An investigation whose time limit is unset, which used to have none, now stops at ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes too.`,
    );
    expect(note).toContain(
      "Loop detection still stops an investigation or an answer that goes in circles, and you can stop any run.",
    );
  });

  it("says what it means for an existing project's cost, how to hold runs to less, and that nothing is migrated", () => {
    const note: string = englishNote();

    expect(note).toContain(
      "For an existing project, a hard question can now take more calls than before, and so more tokens and, on OneUptime Cloud, more AI credits; the project's daily limits still cap the day.",
    );
    expect(note).toContain(
      `To hold every run to less, set ${PROJECT_AI_RUN_LIMIT_FIELDS.slice(0, 3)
        .map((field: ProjectAiRunLimitField): string => {
          return `**${field.title}**`;
        })
        .join(
          ", ",
        )} or **${(PROJECT_AI_RUN_LIMIT_FIELDS[3] as ProjectAiRunLimitField).title}** on **Project Settings → AI → AI Features**, under **More settings**.`,
    );
    expect(note).toContain(
      "A run that reaches one answers with what it found and says which limit stopped it.",
    );
    expect(note).toContain(
      "Nothing is migrated: no project had these settings before.",
    );
    expect(read(MIGRATION)).not.toContain("UPDATE");
  });

  it("says a Runner from before still stops a code task at the numbers the server tells it", () => {
    const completion: string = read(CODE_FIX_COMPLETION);

    expect(englishNote()).toContain(
      `A Runner from before this release still stops a code task at ${legacyConstant("LEGACY_MAX_COMPLETION_CALLS")} model calls and ${legacyConstant("LEGACY_MAX_OUTPUT_TOKENS").toLocaleString("en-US")} output tokens; upgrade it to lift them.`,
    );
    expect(completion).toContain("maxOutputTokens: LEGACY_MAX_OUTPUT_TOKENS,");
    expect(completion).toContain(
      "data.limits.maxLlmCalls ?? LEGACY_MAX_COMPLETION_CALLS,",
    );
  });
});

describe.each(TRANSLATIONS)("the %s docs", (language: string) => {
  const english: Array<string> = page("en", "ai/ai-sre.md").split("\n");
  const translated: Array<string> = page(language, "ai/ai-sre.md").split("\n");
  const headingAt: number = english.indexOf(SECTION_HEADING);

  function drawnBold(label: string): string {
    return `**${drawnDashboardLabel(language, label)}**`;
  }

  it("give the AI SRE page the section, under the card's title as this language's Dashboard draws it", () => {
    expect(headingAt).toBeGreaterThan(-1);
    expect(translated[headingAt]).toBe(
      `### ${drawnDashboardLabel(language, ProjectAiRunLimitsCopy.cardTitle)}`,
    );
  });

  it("name the four settings, the path and More settings as this language's Dashboard draws them, with the numbers", () => {
    const section: string = flat(
      getSection(translated.join("\n"), translated[headingAt] as string),
    );

    for (const label of [
      ...PROJECT_AI_RUN_LIMIT_FIELDS.map(
        (field: ProjectAiRunLimitField): string => {
          return field.title;
        },
      ),
      "More settings",
    ]) {
      expect({ label, named: section.includes(drawnBold(label)) }).toEqual({
        label,
        named: true,
      });
    }

    expect(section).toContain(drawnPath(language, SETTINGS_PATH));
    expect(section).toContain("**Manage Billing**");
    expect(statedNumbers(section)).toEqual(
      expect.arrayContaining([
        DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
        CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
      ]),
    );
  });

  it("state the default time limit where the page used to say there was none", () => {
    const investigation: string = translated[
      english.findIndex((line: string): boolean => {
        return line.startsWith("An investigation runs until it is done");
      })
    ] as string;
    const row: string = translated[
      english.findIndex((line: string): boolean => {
        return line.startsWith("| Investigation time limit |");
      })
    ] as string;

    for (const line of [investigation, row]) {
      expect(statedNumbers(line)).toContain(
        DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
      );
      expect(statedNumbers(line)).not.toContain(300);
    }
  });

  it("drop the old caps from every AI page", () => {
    const lineOf: (file: string, starts: string) => string = (
      file: string,
      starts: string,
    ): string => {
      const at: number = page("en", file)
        .split("\n")
        .findIndex((line: string): boolean => {
          return line.startsWith(starts);
        });

      expect(at).toBeGreaterThan(-1);

      return page(language, file).split("\n")[at] as string;
    };

    expect(
      statedNumbers(lineOf("ai/ask-ai.md", "- It runs only the read-only")),
    ).not.toContain(30);
    expect(
      statedNumbers(lineOf("ai/external-mcp-servers.md", "- **Limits.**")),
    ).not.toContain(40);
    expect(
      statedNumbers(
        lineOf(
          "ai/infrastructure-ai-agents.md",
          "An investigation only ever runs **Read** commands",
        ),
      ),
    ).not.toContain(200);
    expect(
      statedNumbers(
        lineOf("ai/github-app.md", "Every command that starts work"),
      ),
    ).not.toContain(12);
    expect(
      statedNumbers(lineOf("ai/ai-agent.md", "- **Bounded.**")),
    ).not.toContain(12);
  });

  it("carry the upgrade note right after the note on AI limits, naming the settings as the Dashboard draws them, with every number", () => {
    const englishHeadings: Array<string> = getHeadings(
      page("en", "installation/upgrading.md"),
    );
    const upgrading: string = page(language, "installation/upgrading.md");
    const headings: Array<string> = getHeadings(upgrading);
    const heading: string = headings[
      englishHeadings.indexOf(NOTE_HEADING)
    ] as string;
    const note: string = flat(getSection(upgrading, heading));

    expect(headings.length).toBe(englishHeadings.length);
    expect(heading.startsWith("### ")).toBe(true);
    expect(heading).not.toBe(NOTE_HEADING);

    for (const field of PROJECT_AI_RUN_LIMIT_FIELDS) {
      expect({
        label: field.title,
        named: note.includes(drawnBold(field.title)),
      }).toEqual({
        label: field.title,
        named: true,
      });
    }

    expect(note).toContain(drawnBold("More settings"));
    expect(note).toContain(drawnPath(language, SETTINGS_PATH));
    expect(statedNumbers(note)).toEqual(
      expect.arrayContaining([
        100,
        300,
        legacyConstant("LEGACY_MAX_COMPLETION_CALLS"),
        legacyConstant("LEGACY_MAX_OUTPUT_TOKENS"),
        DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
      ]),
    );
  });
});
