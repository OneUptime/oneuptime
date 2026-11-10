import { describe, expect, test } from "@jest/globals";
import {
  WORKFLOW_VERSIONS_PER_PAGE,
  WORKFLOW_VERSION_LINES_SHOWN,
  WorkflowVersionCopy,
  WorkflowVersionRow,
  canPreviewWorkflowVersion,
  getWorkflowVersionHeadline,
  describeWorkflowVersionSavedBy,
  getWorkflowVersionLines,
  getWorkflowVersionSavedBy,
} from "../../../../UI/Components/Workflow/WorkflowVersionPresentation";
import { WorkflowVersionType } from "../../../../Types/Workflow/WorkflowVersion";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import { getGlobalTranslator } from "../../../../UI/Utils/TranslateTemplate";

/*
 * What the version history says of each version (issue #6188).
 */

const row: (overrides?: Partial<WorkflowVersionRow>) => WorkflowVersionRow = (
  overrides: Partial<WorkflowVersionRow> = {},
): WorkflowVersionRow => {
  return {
    versionNumber: 4,
    versionType: WorkflowVersionType.Changed,
    changes: ['Added "Log" (log-1)'],
    changeCount: 1,
    restoredFromVersionNumber: null,
    savedBy: "Ada Lovelace",
    ...overrides,
  };
};

describe("what made a version", () => {
  test("a version of changes lets its lines say it", () => {
    expect(getWorkflowVersionHeadline(row())).toBeNull();
  });

  test("a version of changes the lines do not see says it changed the workflow", () => {
    expect(getWorkflowVersionHeadline(row({ changes: [] }))).toEqual({
      template: WorkflowVersionCopy.changedWithoutLines,
    });
  });

  test("the first version says the workflow was created", () => {
    expect(
      getWorkflowVersionHeadline(
        row({ versionType: WorkflowVersionType.Created }),
      ),
    ).toEqual({ template: WorkflowVersionCopy.created });
  });

  test("a restore names the version it restored", () => {
    expect(
      getWorkflowVersionHeadline(
        row({
          versionType: WorkflowVersionType.Restored,
          restoredFromVersionNumber: 2,
        }),
      ),
    ).toEqual({ template: WorkflowVersionCopy.restored, versionNumber: 2 });
  });

  test("a restore that does not say which is a change like any other", () => {
    expect(
      getWorkflowVersionHeadline(
        row({ versionType: WorkflowVersionType.Restored }),
      ),
    ).toBeNull();
  });

  test("the workflow as it was before version history began says so", () => {
    expect(
      getWorkflowVersionHeadline(
        row({ versionType: WorkflowVersionType.Earlier, changes: [] }),
      ),
    ).toEqual({ template: WorkflowVersionCopy.earlier });
  });
});

describe("the lines a row shows", () => {
  test("all of them, when there are few", () => {
    expect(getWorkflowVersionLines(row())).toEqual({
      lines: ['Added "Log" (log-1)'],
      moreCount: 0,
    });
  });

  test("the first few, counting the rest from every change the version made", () => {
    const changes: Array<string> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): string => {
        return index === 24
          ? "and 16 more changes"
          : `Added "Log" (log-${index})`;
      },
    );

    expect(getWorkflowVersionLines(row({ changes, changeCount: 40 }))).toEqual({
      lines: changes.slice(0, WORKFLOW_VERSION_LINES_SHOWN),
      moreCount: 40 - WORKFLOW_VERSION_LINES_SHOWN,
    });
  });

  test("never counts fewer than it was given", () => {
    expect(
      getWorkflowVersionLines(
        row({
          changes: ["a", "b", "c", "d", "e", "f", "g"],
          changeCount: 0,
        }),
      ).moreCount,
    ).toBe(2);
  });

  test("never shows the server's own 'and N more' line, which a row counts itself", () => {
    expect(WORKFLOW_VERSION_LINES_SHOWN).toBeLessThan(25);
  });
});

describe("who saved a version", () => {
  test("a person, by name", () => {
    expect(getWorkflowVersionSavedBy(row())).toEqual({
      person: "Ada Lovelace",
    });
  });

  test("an API key saves as nobody: through the API", () => {
    expect(getWorkflowVersionSavedBy(row({ savedBy: "" }))).toEqual({
      sentence: WorkflowVersionCopy.savedWithoutPerson,
    });
  });

  test("nobody is known for the workflow as it was before version history began", () => {
    expect(
      getWorkflowVersionSavedBy(
        row({ savedBy: "", versionType: WorkflowVersionType.Earlier }),
      ),
    ).toBeNull();
  });

  // Issue #6258: Ask AI saves as the person who asked, and the version says so.
  test("Ask AI, for the person who asked", () => {
    expect(
      getWorkflowVersionSavedBy(row({ savedThrough: WriteSource.AskAi })),
    ).toEqual({ askAiFor: "Ada Lovelace" });
    expect(
      getWorkflowVersionSavedBy(
        row({
          savedThrough: WriteSource.AskAi,
          versionType: WorkflowVersionType.Created,
        }),
      ),
    ).toEqual({ askAiFor: "Ada Lovelace" });
  });

  test("Ask AI, once that person is no longer known", () => {
    expect(
      getWorkflowVersionSavedBy(
        row({ savedThrough: WriteSource.AskAi, savedBy: "" }),
      ),
    ).toEqual({ sentence: WorkflowVersionCopy.savedByAskAi });
  });

  test("a person's own version, and the API's, are as before", () => {
    for (const savedThrough of [null, undefined]) {
      expect(getWorkflowVersionSavedBy(row({ savedThrough }))).toEqual({
        person: "Ada Lovelace",
      });
      expect(
        getWorkflowVersionSavedBy(row({ savedThrough, savedBy: "" })),
      ).toEqual({ sentence: WorkflowVersionCopy.savedWithoutPerson });
    }
  });

  test("said in words: the person's name as written, Ask AI's sentence around it", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();

    expect(
      describeWorkflowVersionSavedBy({
        savedBy: { askAiFor: "Ada Lovelace" },
        translator,
      }),
    ).toBe("Ask AI, for Ada Lovelace");
    expect(
      describeWorkflowVersionSavedBy({
        savedBy: { askAiFor: "{{person}} <b>Eve</b>" },
        translator,
      }),
    ).toBe("Ask AI, for {{person}} <b>Eve</b>");
    expect(
      describeWorkflowVersionSavedBy({
        savedBy: { person: "Grace Hopper" },
        translator,
      }),
    ).toBe("Grace Hopper");
    expect(
      describeWorkflowVersionSavedBy({
        savedBy: { sentence: WorkflowVersionCopy.savedByAskAi },
        translator,
      }),
    ).toBe("Saved by Ask AI");
    expect(
      describeWorkflowVersionSavedBy({
        savedBy: { sentence: WorkflowVersionCopy.savedWithoutPerson },
        translator,
      }),
    ).toBe("Saved through the API");
    expect(describeWorkflowVersionSavedBy({ savedBy: null, translator })).toBe(
      "",
    );
  });
});

describe("which versions offer a preview", () => {
  test("every version but the newest, which is the workflow as it is", () => {
    expect(
      canPreviewWorkflowVersion({ versionNumber: 9, newestVersionNumber: 9 }),
    ).toBe(false);
    expect(
      canPreviewWorkflowVersion({ versionNumber: 8, newestVersionNumber: 9 }),
    ).toBe(true);
    expect(
      canPreviewWorkflowVersion({
        versionNumber: 1,
        newestVersionNumber: null,
      }),
    ).toBe(true);
  });

  test("the list reads a page at a time", () => {
    expect(WORKFLOW_VERSIONS_PER_PAGE).toBe(20);
  });
});
