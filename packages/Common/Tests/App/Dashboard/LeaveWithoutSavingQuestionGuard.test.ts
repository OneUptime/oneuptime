// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE QUESTION BEFORE UNSAVED WORK IS LOST (issues #7401, #7973, #7402).
 *
 * Every Dashboard editor that keeps its work on the page until a Save
 * button is pressed holds the leave guard (useLeaveGuard) and asks before
 * the work is lost - a dashboard being edited, a schedule's layers, a
 * runbook's steps, a form's questions, a person's paging steps. They ask
 * with one component, LeaveWithoutSavingQuestion, so the question cannot
 * drift between them: the Layers page drew a copy of its own, word for word
 * the same until the question changed, and then it would quietly have
 * fallen out of step (#7973). Once the question offered Save Changes
 * (#7402), an editor that hands it no save asks with two answers where
 * every other asks with three.
 *
 * This reads every file of the Dashboard's source and fails when one:
 *
 *   - holds the leave guard and never draws LeaveWithoutSavingQuestion;
 *   - draws a question titled "Leave without saving?" of its own;
 *   - draws LeaveWithoutSavingQuestion without onSaveChanges, its page's
 *     save (a page that cannot save at a moment hands it undefined then,
 *     and says so where it does).
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src";

// The question itself, which draws the dialog every editor asks with.
const QUESTION_FILE: string = `${DASHBOARD_SOURCE}/Components/UnsavedChanges/LeaveWithoutSavingQuestion.tsx`;

const LEAVE_TITLE: string = "Leave without saving?";

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const HOLDS_LEAVE_GUARD: RegExp = /\buseLeaveGuard\(/;
const HANDS_ON_SAVE: RegExp = /\bonSaveChanges=/;

export interface LeaveQuestionSource {
  file: string;
  text: string;
}

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listSourceFiles(full));
      }
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

/*
 * Each `<LeaveWithoutSavingQuestion ...>` opening tag of a file, whole: its
 * props may hold objects and functions (a prompt built by hand), so the
 * tag ends at the first `>` outside braces, quotes and template text.
 */
export const readQuestionTags: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const tags: Array<string> = [];
  const opening: RegExp = /<LeaveWithoutSavingQuestion\b/g;
  let match: RegExpExecArray | null = opening.exec(text);

  while (match) {
    let depth: number = 0;
    let quote: string | null = null;
    let end: number = -1;

    for (let index: number = match.index + 1; index < text.length; index++) {
      const character: string = text[index]!;

      if (quote) {
        if (character === "\\") {
          index++;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      } else if (character === ">" && depth === 0) {
        end = index;
        break;
      }
    }

    tags.push(text.slice(match.index, end === -1 ? text.length : end + 1));
    match = opening.exec(text);
  }

  return tags;
};

export const findLeaveQuestionProblems: (
  sources: Array<LeaveQuestionSource>,
) => Array<string> = (sources: Array<LeaveQuestionSource>): Array<string> => {
  const problems: Array<string> = [];

  for (const source of sources) {
    if (source.file === QUESTION_FILE) {
      continue;
    }

    const holdsGuard: boolean = HOLDS_LEAVE_GUARD.test(source.text);
    const tags: Array<string> = readQuestionTags(source.text);

    if (holdsGuard && tags.length === 0) {
      problems.push(
        `${source.file}: holds the leave guard (useLeaveGuard) but never asks with LeaveWithoutSavingQuestion`,
      );
    }

    const titledOwnCopy: RegExp =
      /title=\{?\s*["'`]Leave without saving\?["'`]/;

    if (titledOwnCopy.test(source.text)) {
      problems.push(
        `${source.file}: draws a question titled "${LEAVE_TITLE}" of its own; ask with LeaveWithoutSavingQuestion`,
      );
    }

    for (const tag of tags) {
      if (!HANDS_ON_SAVE.test(tag)) {
        problems.push(
          `${source.file}: asks with LeaveWithoutSavingQuestion but hands it no onSaveChanges, so it asks without Save Changes`,
        );
      }
    }
  }

  return problems;
};

const readDashboardSources: () => Array<LeaveQuestionSource> =
  (): Array<LeaveQuestionSource> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, DASHBOARD_SOURCE)).map(
      (file: string): LeaveQuestionSource => {
        return {
          file: path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
          text: fs.readFileSync(file, "utf8"),
        };
      },
    );
  };

describe("the detector", () => {
  test("finds a page that holds the guard and asks with a copy of its own", () => {
    expect(
      findLeaveQuestionProblems([
        {
          file: "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
          text: `
            const leavePrompt = useLeaveGuard(hasUnsavedChanges);
            return leavePrompt.isAsking && (
              <ConfirmModal
                title={"Leave without saving?"}
                submitButtonText={"Discard Changes"}
                onSubmit={leavePrompt.leave}
              />
            );`,
        },
      ]),
    ).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx: holds the leave guard (useLeaveGuard) but never asks with LeaveWithoutSavingQuestion",
      'packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx: draws a question titled "Leave without saving?" of its own; ask with LeaveWithoutSavingQuestion',
    ]);
  });

  test("finds the copy titled as a plain string too", () => {
    expect(
      findLeaveQuestionProblems([
        {
          file: "Example.tsx",
          text: `<Modal title="Leave without saving?" onClose={stay} />`,
        },
      ]),
    ).toEqual([
      'Example.tsx: draws a question titled "Leave without saving?" of its own; ask with LeaveWithoutSavingQuestion',
    ]);
  });

  test("finds the shared question asked without Save Changes", () => {
    expect(
      findLeaveQuestionProblems([
        {
          file: "Example.tsx",
          text: `
            const leavePrompt = useLeaveGuard(isDirty);
            <LeaveWithoutSavingQuestion
              prompt={leavePrompt}
              description="You have unsaved changes to this thing. If you leave now, they will be lost."
            />`,
        },
      ]),
    ).toEqual([
      "Example.tsx: asks with LeaveWithoutSavingQuestion but hands it no onSaveChanges, so it asks without Save Changes",
    ]);
  });

  test("leaves alone a page that asks with the shared question and its save", () => {
    expect(
      findLeaveQuestionProblems([
        {
          file: "Example.tsx",
          text: `
            const leavePrompt = useLeaveGuard(isDirty);
            <LeaveWithoutSavingQuestion
              prompt={{
                isAsking: isAsking,
                stay: () => { setIsAsking(false); },
                leave: () => { open(); },
                saveAndLeave: async (save) => { await save(); open(); },
              }}
              description={COPY.leaveDescription}
              onSaveChanges={isReadOnly ? undefined : save}
            />`,
        },
      ]),
    ).toEqual([]);
  });

  test("reads a tag whose props hold objects, functions and a '>' in a string", () => {
    expect(
      readQuestionTags(
        `<LeaveWithoutSavingQuestion prompt={{ isAsking: a > b, leave: () => { go(">"); } }} description="x > y" onSaveChanges={save} />`,
      ),
    ).toEqual([
      `<LeaveWithoutSavingQuestion prompt={{ isAsking: a > b, leave: () => { go(">"); } }} description="x > y" onSaveChanges={save} />`,
    ]);
  });

  test("leaves the question's own file alone: it draws the dialog the others ask with", () => {
    expect(
      findLeaveQuestionProblems([
        {
          file: QUESTION_FILE,
          text: `<ConfirmModal title={"Leave without saving?"} />`,
        },
      ]),
    ).toEqual([]);
  });
});

describe("the Dashboard", () => {
  const sources: Array<LeaveQuestionSource> = readDashboardSources();

  test("every editor that holds the leave guard asks with the one question, and offers Save Changes", () => {
    expect(findLeaveQuestionProblems(sources)).toEqual([]);
  });

  test("the scan read the editors it is about", () => {
    const holders: Array<string> = sources
      .filter((source: LeaveQuestionSource): boolean => {
        return HOLDS_LEAVE_GUARD.test(source.text);
      })
      .map((source: LeaveQuestionSource): string => {
        return source.file;
      })
      .sort();

    expect(holders).toEqual(
      expect.arrayContaining([
        `${DASHBOARD_SOURCE}/Components/Dashboard/DashboardView.tsx`,
        `${DASHBOARD_SOURCE}/Components/FormBuilder/Builder/FormBuilder.tsx`,
        `${DASHBOARD_SOURCE}/Components/NotificationRule/PagingLadder/PagingLadderEditor.tsx`,
        `${DASHBOARD_SOURCE}/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx`,
        `${DASHBOARD_SOURCE}/Pages/Runbook/View/Steps.tsx`,
      ]),
    );
    expect(sources.length).toBeGreaterThan(1000);
  });
});
