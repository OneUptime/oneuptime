import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskStepKind,
} from "../../../Types/AI/CodeTask";
import {
  CODE_CONTEXT_REFUSALS,
  CODE_GITHUB_NOT_CONNECTED,
  CODE_PICKER_COPY,
  CODE_PICKER_VALUE_LABEL,
  CODE_TASK_ADD_AI_CREDITS,
  CODE_TASK_ASKED_BY,
  CODE_TASK_BLOCKER_FIXES,
  CODE_TASK_BLOCKER_SENTENCES,
  CODE_TASK_BLOCKER_WHO_CAN_FIX,
  CODE_TASK_REPOSITORY_SETTINGS_FIXES,
  CODE_TASK_RUNNER_NOT_ONLINE_NAMED,
  CODE_TURN_FAILED,
  CODE_TASK_CONTEXT_KINDS,
  CODE_TASK_CONTEXT_MENU_ORDER,
  CODE_TASK_CONTEXT_RECORD_PAGES,
  CODE_TASK_DIFF_STAT_LABEL,
  CODE_TASK_EXAMPLE_REQUESTS,
  CODE_TASK_FILE_STATUS_LABELS,
  CODE_TASK_FILE_STATUS_MARKS,
  CODE_TASK_ORIGIN_SENTENCES,
  CODE_TASK_RECIPE_LABELS,
  CODE_TASK_START_FOOTER,
  CODE_TASK_STATE_COPY,
  CODE_TASK_STATE_TEXT_CLASS_NAMES,
  CODE_TASK_STEP_ICONS,
  CODE_TASK_STEP_SENTENCES,
  QUEUED_LABEL,
  getRecipeLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";
import { CodeRepositorySetting } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySettingsCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * The words Code's pages use for a task - its state, its kind, what started
 * it, a step the AI took, the context a person can add, what stops AI
 * working and what fixes it - live in one module (CodeTaskCopy). These hold
 * it complete for every value of every enum it covers, so a new state, step
 * or blocker cannot reach a page as a blank, and hold every one of its
 * sentences translated in all sixteen Dashboard locales, so Code never reads
 * half in English.
 */

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const SAME_AS_ENGLISH_FILE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/SameAsEnglish.json",
);
const PROGRESS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);

const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

type LocaleFile = Record<string, unknown>;

function readJson(file: string): LocaleFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleFile;
}

const ENGLISH: LocaleFile = readJson(path.join(LOCALES_DIRECTORY, "en.json"));
const GLOBAL_SAME: Set<string> = new Set<string>(
  JSON.parse(fs.readFileSync(SAME_AS_ENGLISH_FILE, "utf8")) as Array<string>,
);
const LOCALES: Array<string> = fs
  .readdirSync(LOCALES_DIRECTORY)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(".json", "");
  })
  .sort();

function placeholdersOf(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1] || "";
    })
    .sort();
}

// Every sentence the copy module hands the pages, as English keys.
const SENTENCES: Array<string> = Array.from(
  new Set<string>([
    ...Object.values(CODE_TASK_STATE_COPY).map(
      (copy: { label: string }): string => {
        return copy.label;
      },
    ),
    QUEUED_LABEL,
    ...Object.values(CODE_TASK_RECIPE_LABELS),
    ...Object.values(CODE_TASK_ORIGIN_SENTENCES),
    CODE_TASK_ASKED_BY,
    ...Object.values(CODE_TASK_STEP_SENTENCES).filter(
      (sentence: string): boolean => {
        // A note or a pull request step is the AI's own words.
        return sentence !== "{{subject}}";
      },
    ),
    ...Object.values(CODE_TASK_CONTEXT_KINDS).flatMap(
      (kind: { label: string; addTitle: string }): Array<string> => {
        return [kind.label, kind.addTitle];
      },
    ),
    ...Object.values(CODE_TASK_FILE_STATUS_LABELS),
    ...(Object.values(CODE_TASK_BLOCKER_SENTENCES) as Array<string>),
    CODE_TASK_RUNNER_NOT_ONLINE_NAMED,
    ...Object.values(CODE_TASK_BLOCKER_FIXES).map(
      (fix: { title: string } | undefined): string => {
        return fix!.title;
      },
    ),
    CODE_TASK_ADD_AI_CREDITS,
    ...(Object.values(CODE_TASK_BLOCKER_WHO_CAN_FIX) as Array<string>),
    ...CODE_CONTEXT_REFUSALS,
    CODE_TURN_FAILED,
    ...CODE_TASK_EXAMPLE_REQUESTS,
    // The request box's pickers, and what it says around them.
    ...Object.values(CODE_PICKER_COPY),
    CODE_TASK_DIFF_STAT_LABEL,
    CODE_TASK_START_FOOTER,
    CODE_GITHUB_NOT_CONNECTED,
  ]),
).sort();

describe("Code's words are complete", () => {
  test("every task state has a label, a badge, a dot, an icon and a mark", () => {
    for (const state of Object.values(CodeTaskState)) {
      const copy: (typeof CODE_TASK_STATE_COPY)[CodeTaskState] =
        CODE_TASK_STATE_COPY[state];
      expect(copy.label.trim()).not.toBe("");
      expect(copy.badgeClassName).toContain("bg-");
      expect(copy.dotClassName).toContain("bg-");
      expect(copy.icon).toBeTruthy();
      expect(copy.markClassName).toMatch(/^text-[a-z]+-\d00$/);
      expect(CODE_TASK_STATE_TEXT_CLASS_NAMES[state]).toMatch(
        /^text-[a-z]+-\d00$/,
      );
    }
  });

  test("a task list says in words only the states that move or ask something of someone", () => {
    const said: Array<CodeTaskState> = Object.values(CodeTaskState).filter(
      (state: CodeTaskState): boolean => {
        return CODE_TASK_STATE_COPY[state].isSaidInRow;
      },
    );

    expect(said.sort()).toEqual(
      [
        CodeTaskState.Working,
        CodeTaskState.WaitingForYou,
        CodeTaskState.Failed,
      ].sort(),
    );
  });

  test("the pickers' words: what each picks, how it searches, and every empty or failed list", () => {
    expect(CODE_PICKER_COPY).toEqual({
      repositoryLabel: "Repository",
      repositoryNone: "Pick a repository",
      repositorySearch: "Find a repository",
      repositoryNoMatch: "No repository matches your search.",
      branchLabel: "Branch",
      branchSearch: "Find a branch",
      branchNoMatch: "No branch matches your search.",
      branchLoading: "Loading branches…",
      branchUnknownDefault: "Default branch",
      branchDefaultBadge: "Default",
      branchesUnreadable:
        "OneUptime could not read this repository's branches from GitHub.",
      branchesSearchToFindMore:
        "Type a branch's name to find one that is not listed.",
    });
    // A picker's button reads out its name and what it holds.
    expect(placeholdersOf(CODE_PICKER_VALUE_LABEL)).toEqual(["label", "value"]);
    expect(placeholdersOf(CODE_TASK_DIFF_STAT_LABEL)).toEqual([
      "additions",
      "deletions",
    ]);
  });

  test("the AI at work says Working…, never the Dashboard's Working (a monitor that works)", () => {
    expect(CODE_TASK_STATE_COPY[CodeTaskState.Working].label).toBe("Working…");
    // What the badge would otherwise have read in German.
    expect(
      (readJson(path.join(LOCALES_DIRECTORY, "de.json"))["Working"] as string)
        .toLowerCase()
        .includes("funktion"),
    ).toBe(true);
  });

  test("the states read in the order people expect, each its own colour", () => {
    const dots: Array<string> = Object.values(CodeTaskState).map(
      (state: CodeTaskState): string => {
        return CODE_TASK_STATE_COPY[state].dotClassName;
      },
    );
    expect(new Set(dots).size).toBe(dots.length);
  });

  test("every recipe has a name, and an unknown one reads as itself", () => {
    for (const recipe of Object.values(CodeFixTaskType)) {
      expect(CODE_TASK_RECIPE_LABELS[recipe]).toBeTruthy();
    }
    expect(getRecipeLabel(undefined)).toBe("Fix Exception");
    expect(getRecipeLabel("SomethingNew")).toBe("SomethingNew");
  });

  test("every origin has a sentence, and those that name a record name it", () => {
    for (const origin of Object.values(CodeTaskOriginType)) {
      expect(CODE_TASK_ORIGIN_SENTENCES[origin]).toBeTruthy();
    }
    for (const origin of [
      CodeTaskOriginType.Exception,
      CodeTaskOriginType.Incident,
      CodeTaskOriginType.Alert,
      CodeTaskOriginType.Trace,
      CodeTaskOriginType.Service,
      CodeTaskOriginType.GitHubIssue,
      CodeTaskOriginType.GitHubPullRequest,
    ]) {
      expect(placeholdersOf(CODE_TASK_ORIGIN_SENTENCES[origin])).toEqual([
        "label",
      ]);
    }
    expect(placeholdersOf(CODE_TASK_ASKED_BY)).toEqual(["name"]);
  });

  test("every step kind has words and an icon, and names what it was about", () => {
    for (const kind of Object.values(CodeTaskStepKind)) {
      expect(placeholdersOf(CODE_TASK_STEP_SENTENCES[kind])).toEqual([
        "subject",
      ]);
      expect(CODE_TASK_STEP_ICONS[kind]).toBeTruthy();
    }
  });

  test("every kind of context is offered once, with a label, a dialog title and an icon", () => {
    expect([...CODE_TASK_CONTEXT_MENU_ORDER].sort()).toEqual(
      Object.values(CodeTaskContextType).sort(),
    );
    for (const kind of Object.values(CodeTaskContextType)) {
      const copy: (typeof CODE_TASK_CONTEXT_KINDS)[CodeTaskContextType] =
        CODE_TASK_CONTEXT_KINDS[kind];
      expect(copy.label).toBeTruthy();
      expect(copy.addTitle).toBeTruthy();
      expect(copy.icon).toBeTruthy();
    }
    // The person's own come first, then what is read from OneUptime.
    const isRecord: Array<boolean> = CODE_TASK_CONTEXT_MENU_ORDER.map(
      (kind: CodeTaskContextType): boolean => {
        return CODE_TASK_CONTEXT_KINDS[kind].isRecord;
      },
    );
    expect(isRecord).toEqual([...isRecord].sort());
  });

  test("a record in the context opens its page", () => {
    for (const [kind, pageMap] of Object.entries(
      CODE_TASK_CONTEXT_RECORD_PAGES,
    ) as Array<[CodeTaskContextType, PageMap]>) {
      expect(CODE_TASK_CONTEXT_KINDS[kind].isRecord).toBe(true);
      expect(RouteMap[pageMap]).toBeTruthy();
    }
  });

  test("every file change has a letter and a word", () => {
    for (const status of Object.values(CodeTaskFileStatus)) {
      expect(CODE_TASK_FILE_STATUS_MARKS[status]).toMatch(/^[A-Z]$/);
      expect(CODE_TASK_FILE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  test("whatever stops AI is said in the reader's words, with a link where there is something to open", () => {
    for (const type of Object.values(CodeTaskBlockerType)) {
      if (type === CodeTaskBlockerType.DailyLimitReached) {
        // Only the server knows the limit and when it resets: its own sentence.
        expect(CODE_TASK_BLOCKER_SENTENCES[type]).toBeUndefined();
        continue;
      }
      expect(CODE_TASK_BLOCKER_SENTENCES[type]).toBeTruthy();
    }

    // Permission is asked for, not opened; a limit resets on its own.
    expect(CODE_TASK_BLOCKER_FIXES[CodeTaskBlockerType.NoPermission]).toBe(
      undefined,
    );
    expect(CODE_TASK_BLOCKER_FIXES[CodeTaskBlockerType.DailyLimitReached]).toBe(
      undefined,
    );
    for (const [type, fix] of Object.entries(CODE_TASK_BLOCKER_FIXES)) {
      expect(RouteMap[fix!.pageMap]).toBeTruthy();
      expect(fix!.title).toBeTruthy();
      expect(type).not.toBe(CodeTaskBlockerType.NoPermission);
      /*
       * A fix on a repository's settings lands on the setting that fixes it
       * - each is folded under More settings, which opens there - and only
       * such a fix names a setting.
       */
      expect(Boolean(fix!.setting)).toBe(
        fix!.pageMap === PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
      );
      expect(
        CODE_TASK_REPOSITORY_SETTINGS_FIXES.includes(
          type as CodeTaskBlockerType,
        ),
      ).toBe(fix!.pageMap === PageMap.CODE_REPOSITORY_VIEW_SETTINGS);

      if (fix!.setting) {
        expect(Object.values(CodeRepositorySetting)).toContain(fix!.setting);
      }
    }
    /*
     * A repository that is not connected is fixed where repositories
     * connect: Code's Repositories (Code's first page connects GitHub from
     * the box itself).
     */
    expect(
      CODE_TASK_BLOCKER_FIXES[CodeTaskBlockerType.RepositoryNotConnected],
    ).toEqual({ pageMap: PageMap.CODE_REPOSITORIES, title: "Connect GitHub" });
  });

  test("a fix only some may make says who can instead, for each blocker that has one", () => {
    const gated: Array<CodeTaskBlockerType> = [
      CodeTaskBlockerType.AiDisabled,
      CodeTaskBlockerType.NoLlmProvider,
      CodeTaskBlockerType.NoAgent,
      CodeTaskBlockerType.RunnerNotOnline,
      CodeTaskBlockerType.GlobalRunnersOff,
    ];

    for (const type of gated) {
      expect(CODE_TASK_BLOCKER_FIXES[type]).toBeTruthy();
      expect(CODE_TASK_BLOCKER_WHO_CAN_FIX[type]).toBeTruthy();
    }
    expect(Object.keys(CODE_TASK_BLOCKER_WHO_CAN_FIX).sort()).toEqual(
      [...gated].sort(),
    );
    // Each names where the fix is made, as the link would have opened it.
    expect(
      CODE_TASK_BLOCKER_WHO_CAN_FIX[CodeTaskBlockerType.AiDisabled],
    ).toContain("Project Settings → AI → AI Features");
    expect(
      CODE_TASK_BLOCKER_WHO_CAN_FIX[CodeTaskBlockerType.NoLlmProvider],
    ).toContain("Project Settings → AI → LLM Providers");
    /*
     * A missing Runner is picked in the repository's own settings, which
     * every Runner blocker links to.
     */
    for (const type of [
      CodeTaskBlockerType.NoAgent,
      CodeTaskBlockerType.RunnerNotOnline,
      CodeTaskBlockerType.GlobalRunnersOff,
    ]) {
      expect(CODE_TASK_BLOCKER_WHO_CAN_FIX[type]).toBe(
        "A project admin can pick this repository's Runner in its settings.",
      );
      /*
       * The repository's settings, at its Runner: More settings, where the
       * Runner is, opens there.
       */
      expect(CODE_TASK_BLOCKER_FIXES[type]).toEqual({
        pageMap: PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
        title: "Pick a Runner",
        setting: CodeRepositorySetting.Runner,
      });
      expect(CODE_TASK_REPOSITORY_SETTINGS_FIXES).toContain(type);
      // Never the switch Runners no longer have.
      expect(CODE_TASK_BLOCKER_SENTENCES[type]).not.toContain("Code Fixes");
    }
  });

  /*
   * A Runner the server names (CodeTaskBlocker.runnerName) is said in the
   * unnamed sentence's own words, with the name where "The Runner this
   * repository picks" stands - one slot, the same fix.
   */
  test("the named Runner sentence is the unnamed one with the Runner's name in it", () => {
    expect(CODE_TASK_RUNNER_NOT_ONLINE_NAMED).toBe(
      "The Runner this repository picks, {{runner}}, is not online. Check that its container is running, or pick another Runner.",
    );
    expect(CODE_TASK_RUNNER_NOT_ONLINE_NAMED.replace(", {{runner}},", "")).toBe(
      CODE_TASK_BLOCKER_SENTENCES[CodeTaskBlockerType.RunnerNotOnline],
    );
  });

  test("a failed turn is said in plain words, and the dialog's refusals are sentences", () => {
    expect(CODE_TURN_FAILED).toBe("AI could not finish.");
    expect(CODE_TURN_FAILED.toLowerCase()).not.toContain("turn");
    expect(CODE_CONTEXT_REFUSALS.length).toBeGreaterThan(0);
    for (const refusal of CODE_CONTEXT_REFUSALS) {
      expect(refusal.endsWith(".")).toBe(true);
    }
  });

  test("the examples are requests a person could send as they are", () => {
    expect(CODE_TASK_EXAMPLE_REQUESTS.length).toBeGreaterThanOrEqual(3);
    for (const example of CODE_TASK_EXAMPLE_REQUESTS) {
      expect(example.length).toBeLessThan(80);
      expect(example.endsWith(".")).toBe(false);
    }
  });
});

describe("Code's words are translated", () => {
  test("every sentence is an English key", () => {
    for (const sentence of SENTENCES) {
      expect(ENGLISH[sentence]).toBe(sentence);
    }
  });

  test.each(LOCALES)(
    "%s words every sentence, keeping its placeholders",
    (locale: string) => {
      const translations: LocaleFile = readJson(
        path.join(LOCALES_DIRECTORY, `${locale}.json`),
      );
      const progress: LocaleFile = readJson(
        path.join(PROGRESS_DIRECTORY, `${locale}.json`),
      );
      const localSame: Set<string> = new Set<string>(
        (progress["sameAsEnglish"] as Array<string> | undefined) || [],
      );

      const untranslated: Array<string> = SENTENCES.filter(
        (sentence: string): boolean => {
          return (
            translations[sentence] === sentence &&
            !GLOBAL_SAME.has(sentence) &&
            !localSame.has(sentence)
          );
        },
      );
      expect(untranslated).toEqual([]);

      for (const sentence of SENTENCES) {
        expect(placeholdersOf(translations[sentence] as string)).toEqual(
          placeholdersOf(sentence),
        );
      }
    },
  );
});
