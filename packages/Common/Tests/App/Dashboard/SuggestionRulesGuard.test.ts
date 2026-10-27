import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every suggestion, AI action and "do this next" prompt shows only when it
 * applies, and the rule that decides it lives in one Common helper per kind
 * of suggestion (Common/Utils/Suggestions), never in a page. This guard
 * holds the pieces that make that true across the product:
 *
 *   1. The helpers are pure, so the server and the Dashboard can share them.
 *   2. The worth-fixing thresholds of the trace performance fix are written
 *      once, in their helper.
 *   3. Every Dashboard surface that offers an AI action asks the AI rule:
 *      anything that opens Ask AI with a prompt, renders "Generate with AI",
 *      or starts an AI code fix. Only Ask AI's own entry points stay with AI
 *      off - opening it is the quiet way back, it says AI is off and links
 *      to the switch.
 *   4. No page reads Project.enableAi itself, outside the pages that own the
 *      switch or explain it.
 *   5. Every server path that creates an AI code-fix task refuses with AI
 *      off, so no page can be talked into offering what the server would
 *      queue and then fail.
 *
 * A new suggestion that fails here belongs in Common/Utils/Suggestions, with
 * its page asking it (see the README-style comment in SuggestionOffer.ts).
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const COMMON: string = path.join(PACKAGES, "Common");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src",
);
const SUGGESTIONS_DIR: string = path.join(COMMON, "Utils/Suggestions");

const SOURCE_FILE_REGEX: RegExp = /\.(ts|tsx)$/;
const IO_MODULE_REGEX: RegExp = /"(fs|path|http|https)"/;
const WORTH_FIXING_EXPORT_REGEX: RegExp = /export const WORTH_FIXING_/;
const ENABLE_AI_WORD_REGEX: RegExp = /\benableAi\b/;

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }
      files.push(...sourceFiles(full));
    } else if (SOURCE_FILE_REGEX.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(PACKAGES, file).split(path.sep).join("/");
}

const DASHBOARD_FILES: Array<string> = sourceFiles(DASHBOARD_SRC);

// Code only: comments name things they do not do.
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line: string): boolean => {
      const trimmed: string = line.trim();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

describe("the suggestion helpers", () => {
  const helpers: Array<string> = fs
    .readdirSync(SUGGESTIONS_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    });

  /*
   * The shared pieces are the offer (SuggestionOffer) and the set-up step
   * every suggestion with one carries (SuggestionBlocker: Code's gate on
   * the wire).
   */
  test("are one per kind of suggestion, plus the shared offer and set-up step", () => {
    expect(helpers.sort()).toEqual(
      [
        "AiSuggestion.ts",
        "CodeFixSuggestion.ts",
        "ProfileFixSuggestion.ts",
        "SuggestionBlocker.ts",
        "SuggestionOffer.ts",
        "TelemetryAiFixSuggestion.ts",
        "TelemetryImprovementSuggestion.ts",
        "TracePerformanceFixSuggestion.ts",
      ].sort(),
    );
  });

  test.each(
    fs.readdirSync(SUGGESTIONS_DIR).filter((name: string): boolean => {
      return name.endsWith(".ts");
    }),
  )(
    "%s is pure: no server, UI, React or I/O imports, so the server and the Dashboard share it",
    (name: string) => {
      const source: string = read(path.join(SUGGESTIONS_DIR, name));
      const imports: Array<string> = source
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("import ") || line.startsWith("} from ");
        });

      for (const line of imports) {
        expect({ name, line, server: line.includes("/Server/") }).toEqual({
          name,
          line,
          server: false,
        });
        expect({ name, line, ui: line.includes("/UI/") }).toEqual({
          name,
          line,
          ui: false,
        });
        expect({ name, line, react: line.includes('"react"') }).toEqual({
          name,
          line,
          react: false,
        });
        expect({ name, line, io: IO_MODULE_REGEX.test(line) }).toEqual({
          name,
          line,
          io: false,
        });
      }
    },
  );
});

describe("the trace performance fix's rule", () => {
  test("its thresholds are written once, in its helper", () => {
    const definers: Array<string> = [
      ...sourceFiles(path.join(COMMON, "Server")),
      ...sourceFiles(path.join(COMMON, "Utils")),
      ...sourceFiles(path.join(COMMON, "UI")),
      ...DASHBOARD_FILES,
    ]
      .filter((file: string): boolean => {
        return WORTH_FIXING_EXPORT_REGEX.test(read(file));
      })
      .map(relative);

    expect(definers).toEqual([
      "Common/Utils/Suggestions/TracePerformanceFixSuggestion.ts",
    ]);
  });

  test("the server's create and suggestion paths, insight fix routing and the trace page all use it", () => {
    const users: Record<string, string> = {
      "Common/Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts":
        "getFindingsWorthFixing",
      "Common/Server/Utils/AI/SRE/Insights/FixRouting.ts":
        "getFindingsWorthFixing",
      "App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer.tsx":
        "parseTracePerformanceFixSuggestion",
    };

    for (const [file, name] of Object.entries(users)) {
      const source: string = read(path.join(PACKAGES, file));
      expect({ file, imports: source.includes(name) }).toEqual({
        file,
        imports: true,
      });
      expect({
        file,
        fromHelper: source.includes(
          "Utils/Suggestions/TracePerformanceFixSuggestion",
        ),
      }).toEqual({ file, fromHelper: true });
    }
  });

  test("the trace header draws no Fix performance button of its own", () => {
    const header: string = read(
      path.join(DASHBOARD_SRC, "Components/Traces/TraceDetail/TraceHeader.tsx"),
    );

    expect(withoutComments(header)).not.toContain("Fix performance with AI");
    expect(header).not.toContain("onCreatePerformanceFix");
    expect(header).toContain("performanceSuggestion");
  });
});

/*
 * Ask AI's own entry points: the header button, the command palette's Ask
 * AI, the chat's own address, and the dialog itself with the events that
 * open it. They stay with AI off - the dialog says AI is off and links to
 * the switch.
 */
const ASK_AI_ENTRY_POINTS: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src/Components/Header/AskAI.tsx",
  "App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette.tsx",
  "App/FeatureSet/Dashboard/src/Components/AIChat/AskAiDialog.tsx",
  "App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents.ts",
  "App/FeatureSet/Dashboard/src/Pages/AICopilot/AICopilot.tsx",
  "App/FeatureSet/Dashboard/src/Utils/EventName.ts",
];

// Opens Ask AI: the event itself, or the helpers that send it.
const OPENS_ASK_AI: RegExp = /AI_CHAT_TOGGLE|\b(?:openAskAi|toggleAskAi)\(/;

describe("every Dashboard AI action asks the AI rule", () => {
  test("whatever opens Ask AI with a prompt (Explain with AI) is drawn only where AI can run", () => {
    const openers: Array<string> = DASHBOARD_FILES.filter(
      (file: string): boolean => {
        return OPENS_ASK_AI.test(withoutComments(read(file)));
      },
    )
      .map(relative)
      .filter((file: string): boolean => {
        return !ASK_AI_ENTRY_POINTS.includes(file);
      });

    expect(openers.length).toBeGreaterThan(0);

    for (const file of openers) {
      expect({
        file,
        asks: read(path.join(PACKAGES, file)).includes("useAiOffered()"),
      }).toEqual({ file, asks: true });
    }

    // Each entry point is still there, so the list cannot excuse a gone file.
    for (const file of ASK_AI_ENTRY_POINTS) {
      expect({ file, exists: fs.existsSync(path.join(PACKAGES, file)) }).toEqual(
        { file, exists: true },
      );
    }
  });

  test("whatever renders Generate with AI asks it too", () => {
    const renderers: Array<string> = DASHBOARD_FILES.filter(
      (file: string): boolean => {
        return withoutComments(read(file)).includes("<GenerateFromAIModal");
      },
    ).map(relative);

    expect(renderers.sort()).toEqual(
      [
        "App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteComposer.tsx",
        "App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Postmortem.tsx",
        "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem.tsx",
      ].sort(),
    );

    for (const file of renderers) {
      expect({
        file,
        asks: read(path.join(PACKAGES, file)).includes("useAiOffered()"),
      }).toEqual({ file, asks: true });
    }
  });

  test.each([
    "App/FeatureSet/Dashboard/src/Components/AI/TelemetryImprovementCard.tsx",
    "App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel.tsx",
    "App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIAssistance.tsx",
    "App/FeatureSet/Dashboard/src/Pages/Exceptions/View/SideMenu.tsx",
    "App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFixStrip.tsx",
  ])("%s, which starts an AI code fix, asks it", (file: string) => {
    expect(read(path.join(PACKAGES, file))).toContain("useAiOffered()");
  });

  /*
   * The Profiler's Fix with AI draws only what the server's suggestion
   * route answers (ProfileFixTaskTrigger.getSuggestion, the same gates the
   * create route enforces), read with the shared parser - and asks nothing
   * with AI off.
   */
  test("the Profiler's fix strip asks the server, and nothing with AI off", () => {
    const strip: string = withoutComments(
      read(path.join(DASHBOARD_SRC, "Components/Profiles/ProfileFixStrip.tsx")),
    );
    const api: string = read(
      path.join(DASHBOARD_SRC, "Components/Profiles/ProfilesApi.ts"),
    );

    expect(strip).toContain("isAiOffered ? requestKey : null");
    expect(strip).toContain("fetchProfileFixSuggestion(");
    expect(api).toContain("parseProfileFixSuggestion(");
    // The rule lives in Common: the strip draws the offer it is given.
    expect(strip).not.toMatch(/PROFILE_FIX_MIN_|ownShare\s*[<>]=?/);
  });

  test("the trace page asks it before it asks the server for a suggestion", () => {
    const explorer: string = read(
      path.join(DASHBOARD_SRC, "Components/Traces/TraceExplorer.tsx"),
    );

    expect(explorer).toContain("isAiOfferedForSelectedProject()");
    expect(explorer.indexOf("isAiOfferedForSelectedProject()")).toBeLessThan(
      explorer.indexOf("PERFORMANCE_FIX_SUGGESTION_PATH,"),
    );
  });

  test("the AI rule is read through the Common helper, not page by page", () => {
    const hook: string = read(
      path.join(DASHBOARD_SRC, "Utils/UseAiOffered.ts"),
    );
    expect(hook).toContain('from "Common/Utils/Suggestions/AiSuggestion";');

    /*
     * Project.enableAi is read only where the switch is owned or explained:
     * the AI settings pages, Code's blocker notice, the investigation card's
     * not-started reasons - and the one hook every other page asks.
     */
    const readers: Array<string> = DASHBOARD_FILES.filter(
      (file: string): boolean => {
        return ENABLE_AI_WORD_REGEX.test(withoutComments(read(file)));
      },
    )
      .map(relative)
      .sort();

    expect(readers).toEqual(
      [
        "App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStarted.tsx",
        "App/FeatureSet/Dashboard/src/Components/AISettings/EnableAiColumn.ts",
        "App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy.ts",
        "App/FeatureSet/Dashboard/src/Components/AISettings/useProjectAiReadiness.ts",
        "App/FeatureSet/Dashboard/src/Components/Code/CodeBlockerNotice.tsx",
        "App/FeatureSet/Dashboard/src/Utils/UseAiOffered.ts",
      ].sort(),
    );
  });
});

describe("every server path that creates an AI code-fix task refuses with AI off", () => {
  test.each([
    "Common/Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts",
    "Common/Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger.ts",
    "Common/Server/Services/TelemetryExceptionService.ts",
    "Common/Server/Utils/AI/SRE/ProfileFixTaskTrigger.ts",
  ])("%s asserts the project's AI switch", (file: string) => {
    expect(read(path.join(PACKAGES, file))).toContain(
      "AIService.assertProjectAIEnabled(",
    );
  });

  test("the suggestion routes answer with the same triggers' rules", () => {
    const api: string = read(
      path.join(COMMON, "Server/API/AIInvestigationAPI.ts"),
    );

    expect(api).toContain('"/ai-investigation/performance-fix-suggestion"');
    expect(api).toContain("FixPerformanceTaskTrigger.getSuggestionForTrace(");
    expect(api).toContain(
      '"/ai-investigation/telemetry-improvement-suggestion"',
    );
    expect(api).toContain("TelemetryImprovementTaskTrigger.getSuggestion(");
    expect(api).toContain('"/ai-investigation/profile-fix-suggestion"');
    expect(api).toContain("ProfileFixTaskTrigger.getSuggestion(");
    expect(api).toContain('"/ai-investigation/create-profile-fix-task"');
    expect(api).toContain("ProfileFixTaskTrigger.createFixTask(");
  });
});
