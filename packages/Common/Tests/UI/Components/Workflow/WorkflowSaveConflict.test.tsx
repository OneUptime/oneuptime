import { WorkflowSaveConflict } from "../../../../UI/Components/Workflow/WorkflowAutosave";
import {
  WorkflowSaveConflictCopy,
  getWorkflowSaveConflictLines,
  isWorkflowSaveConflict,
} from "../../../../UI/Components/Workflow/WorkflowSaveConflict";
import WorkflowSaveConflictModal from "../../../../UI/Components/Workflow/WorkflowSaveConflictModal";
import {
  WorkflowEditCause,
  WorkflowHistoryDirection,
} from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import {
  WorkflowRedoCopy,
  WorkflowUndoCopy,
  getWorkflowHistoryActionText,
} from "../../../../UI/Components/Workflow/WorkflowHistoryLabels";
import WorkflowStatusBar, {
  WorkflowSaveState,
  getWorkflowSaveStatePresentation,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import { WorkflowVersionCopy } from "../../../../UI/Components/Workflow/WorkflowVersionPresentation";
import { getGlobalTranslator } from "../../../../UI/Utils/TranslateTemplate";
import DashboardAPI from "../../../../UI/Utils/API/API";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata from "../../../../Types/Workflow/Component";
import Components from "../../../../Types/Workflow/Components";
import { WORKFLOW_GRAPH_REVISION_KEY } from "../../../../Types/Workflow/WorkflowGraphRevision";
import {
  SavedWorkflowGraph,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import { WorkflowComponentLookup } from "../../../../Utils/Workflow/WorkflowGraphChanges";
import {
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * When someone else saved the workflow first (issue #6257): how the builder
 * knows the server's refusal, what it says they changed, the dialog that
 * asks, the save pill meanwhile, and what Undo says after their changes are
 * shown.
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const COMPONENTS: Array<ComponentMetadata> =
  Components as Array<ComponentMetadata>;

const lookup: WorkflowComponentLookup = (
  componentId: string,
): ComponentMetadata | undefined => {
  return COMPONENTS.find((component: ComponentMetadata): boolean => {
    return component.id === componentId;
  });
};

const BASE: SavedWorkflowGraph = toSavedWorkflowGraph(
  graphOf([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
);

const THEIRS: SavedWorkflowGraph = toSavedWorkflowGraph(
  graphOf(
    [MANUAL, LOG, EMAIL],
    [
      { from: MANUAL.key, to: LOG.key },
      { from: LOG.key, to: EMAIL.key },
    ],
  ),
);

const CONFLICT: WorkflowSaveConflict = {
  theirs: THEIRS,
  revision: 8,
  base: BASE,
};

describe("knowing the server's refusal", () => {
  test("a 409 is someone else's save; nothing else is", () => {
    expect(
      isWorkflowSaveConflict(new HTTPErrorResponse(409, { message: "" }, {})),
    ).toBe(true);
    expect(isWorkflowSaveConflict({ statusCode: 409 })).toBe(true);

    for (const refusal of [
      new HTTPErrorResponse(400, { message: "Bad" }, {}),
      new HTTPErrorResponse(403, { message: "No" }, {}),
      new HTTPErrorResponse(404, { message: "Gone" }, {}),
      new HTTPErrorResponse(422, { message: "Not yours" }, {}),
      new HTTPErrorResponse(500, { message: "Broke" }, {}),
      new Error("409"),
      { statusCode: "409" },
      "409",
      409,
      null,
      undefined,
    ]) {
      expect({ refusal, isConflict: isWorkflowSaveConflict(refusal) }).toEqual({
        refusal,
        isConflict: false,
      });
    }
  });

  test("ModelAPI.updateById sends the revision a save was made to, and a 409 comes back as one", async () => {
    const fetch: jest.SpyInstance = jest
      .spyOn(DashboardAPI, "fetch")
      .mockResolvedValue(
        new HTTPResponse(200, {}, {}) as never,
      ) as unknown as jest.SpyInstance;
    const id: ObjectID = ObjectID.generate();

    await ModelAPI.updateById({
      modelType: Workflow,
      id,
      data: { graph: BASE as unknown as JSONObject },
      miscDataProps: { [WORKFLOW_GRAPH_REVISION_KEY]: 7 },
    });

    expect((fetch.mock.calls[0]?.[0] as { data: JSONObject }).data).toEqual({
      data: { graph: BASE },
      miscDataProps: { graphRevision: 7 },
    });

    // Without one, the request is exactly as it always was.
    await ModelAPI.updateById({
      modelType: Workflow,
      id,
      data: { isEnabled: true },
    });

    expect((fetch.mock.calls[1]?.[0] as { data: JSONObject }).data).toEqual({
      data: { isEnabled: true },
    });

    fetch.mockResolvedValue(
      new HTTPErrorResponse(
        409,
        {
          message:
            "Someone else saved this workflow's graph after you read it.",
        },
        {},
      ) as never,
    );

    let thrown: unknown = null;

    try {
      await ModelAPI.updateById({
        modelType: Workflow,
        id,
        data: { graph: BASE as unknown as JSONObject },
        miscDataProps: { [WORKFLOW_GRAPH_REVISION_KEY]: 7 },
      });
    } catch (error) {
      thrown = error;
    }

    expect(isWorkflowSaveConflict(thrown)).toBe(true);
  });
});

describe("what they changed", () => {
  test("is the version history's lines, from the graph the change was made to, to theirs", () => {
    expect(
      getWorkflowSaveConflictLines({ conflict: CONFLICT, lookup }),
    ).toEqual({
      lines: [
        'Added "Send Email" (send-email-1)',
        'Connected "Log" (log-1) to "Send Email" (send-email-1)',
      ],
      moreCount: 0,
    });
  });

  test("moves are changes too", () => {
    const moved: SavedWorkflowGraph = toSavedWorkflowGraph(
      graphOf(
        [MANUAL, { ...LOG, x: 400 }],
        [{ from: MANUAL.key, to: LOG.key }],
      ),
    );

    expect(
      getWorkflowSaveConflictLines({
        conflict: { theirs: moved, revision: 2, base: BASE },
        lookup,
      }).lines,
    ).toEqual(['Moved "Log" (log-1)']);
  });

  test("the first five, and how many more", () => {
    const many: SavedWorkflowGraph = toSavedWorkflowGraph(
      graphOf(
        [
          MANUAL,
          LOG,
          ...Array.from({ length: 8 }, (_unused: unknown, index: number) => {
            return {
              ...LOG,
              key: `card-log-${index + 2}`,
              stepId: `log-${index + 2}`,
              y: 400 + index * 100,
            };
          }),
        ],
        [{ from: MANUAL.key, to: LOG.key }],
      ),
    );

    const lines: { lines: Array<string>; moreCount: number } =
      getWorkflowSaveConflictLines({
        conflict: { theirs: many, revision: 3, base: BASE },
        lookup,
      });

    expect(lines.lines).toHaveLength(5);
    expect(lines.moreCount).toBe(3);
  });
});

describe("the dialog", () => {
  const renderDialog: () => {
    onShowTheirChanges: MockFunction;
    onKeepMine: MockFunction;
  } = (): { onShowTheirChanges: MockFunction; onKeepMine: MockFunction } => {
    const onShowTheirChanges: MockFunction = getJestMockFunction();
    const onKeepMine: MockFunction = getJestMockFunction();

    render(
      <WorkflowSaveConflictModal
        conflict={CONFLICT}
        components={COMPONENTS}
        onShowTheirChanges={onShowTheirChanges}
        onKeepMine={onKeepMine}
      />,
    );

    return { onShowTheirChanges, onKeepMine };
  };

  test("says what happened, what they changed, and that nothing is lost either way", () => {
    renderDialog();

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: WorkflowSaveConflictCopy.title,
    });

    expect(dialog).toHaveTextContent(WorkflowSaveConflictCopy.description);
    expect(dialog).toHaveTextContent(
      WorkflowSaveConflictCopy.theirChangesTitle,
    );
    expect(
      within(dialog).getByTestId("workflow-save-conflict-changes"),
    ).toHaveTextContent('Added "Send Email" (send-email-1)');
    expect(
      within(dialog).getByTestId("workflow-save-conflict-note"),
    ).toHaveTextContent(WorkflowSaveConflictCopy.note);
  });

  test("Show their changes is the dialog's one primary button, and the focus starts on it", async () => {
    const { onShowTheirChanges, onKeepMine } = renderDialog();

    const show: HTMLElement = screen.getByRole("button", {
      name: WorkflowSaveConflictCopy.showTheirChanges,
    });

    expect(show).toHaveAttribute("data-testid", "modal-footer-submit-button");
    // Enter does the safe thing: nothing of anyone's is replaced.
    await waitFor(() => {
      expect(document.activeElement).toBe(show);
    });
    fireEvent.click(show);

    expect(onShowTheirChanges).toHaveBeenCalledTimes(1);
    expect(onKeepMine).not.toHaveBeenCalled();
  });

  test("Keep mine keeps the canvas's version", () => {
    const { onShowTheirChanges, onKeepMine } = renderDialog();

    fireEvent.click(
      screen.getByRole("button", { name: WorkflowSaveConflictCopy.keepMine }),
    );

    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onShowTheirChanges).not.toHaveBeenCalled();
  });

  test("has no way to leave a change that cannot be saved: no Cancel, no close, and Escape does nothing", () => {
    const { onShowTheirChanges, onKeepMine } = renderDialog();
    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByTestId("close-button")).toBeNull();
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onShowTheirChanges).not.toHaveBeenCalled();
    expect(onKeepMine).not.toHaveBeenCalled();
  });

  test("a long list counts the rest; a change the lines do not name still says the workflow changed", () => {
    const many: SavedWorkflowGraph = toSavedWorkflowGraph(
      graphOf(
        [
          MANUAL,
          LOG,
          ...Array.from({ length: 7 }, (_unused: unknown, index: number) => {
            return {
              ...LOG,
              key: `card-log-${index + 2}`,
              stepId: `log-${index + 2}`,
              y: 400 + index * 100,
            };
          }),
        ],
        [{ from: MANUAL.key, to: LOG.key }],
      ),
    );

    const { unmount } = render(
      <WorkflowSaveConflictModal
        conflict={{ theirs: many, revision: 2, base: BASE }}
        components={COMPONENTS}
        onShowTheirChanges={() => {}}
        onKeepMine={() => {}}
      />,
    );

    expect(
      screen.getByTestId("workflow-save-conflict-changes"),
    ).toHaveTextContent(
      getGlobalTranslator().translatePlural(WorkflowVersionCopy.moreChanges, 2),
    );

    unmount();

    // Their graph differs only in what no line names: a step's identifier inside its card.
    const unnamed: SavedWorkflowGraph = JSON.parse(JSON.stringify(BASE));
    ((unnamed.nodes[0] as JSONObject)["data"] as JSONObject)["internalId"] =
      "runner-renamed";

    render(
      <WorkflowSaveConflictModal
        conflict={{ theirs: unnamed, revision: 2, base: BASE }}
        components={COMPONENTS}
        onShowTheirChanges={() => {}}
        onKeepMine={() => {}}
      />,
    );

    const changes: HTMLElement = screen.getByTestId(
      "workflow-save-conflict-changes",
    );

    expect(
      within(changes)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([WorkflowVersionCopy.changedWithoutLines]);
  });
});

describe("the save pill while the person chooses", () => {
  test("says Not saved, in amber: no failure, and no Try again", () => {
    const presentation: ReturnType<typeof getWorkflowSaveStatePresentation> =
      getWorkflowSaveStatePresentation(WorkflowSaveState.Conflict);

    expect(presentation.label).toBe("Not saved");
    expect(presentation.dotClassName).toBe("bg-amber-500");
    expect(presentation.textClassName).toBe("text-amber-800");

    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Conflict}
        onRetrySave={() => {}}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("workflow-save-status");

    expect(pill).toHaveTextContent("Not saved");
    expect(pill).not.toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("workflow-save-retry-button")).toBeNull();
  });

  test("every save state has words of its own", () => {
    const labels: Array<string> = Object.values(WorkflowSaveState).map(
      (state: WorkflowSaveState): string => {
        return getWorkflowSaveStatePresentation(state).label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("Undo and Redo after their changes are shown", () => {
  test("say so", () => {
    for (const [direction, words] of [
      [WorkflowHistoryDirection.Undo, WorkflowUndoCopy.theirChanges],
      [WorkflowHistoryDirection.Redo, WorkflowRedoCopy.theirChanges],
    ] as Array<[WorkflowHistoryDirection, string]>) {
      expect(
        getWorkflowHistoryActionText({
          direction,
          step: {
            direction,
            cause: WorkflowEditCause.TheirChanges,
            changes: [],
          },
          translator: getGlobalTranslator(),
        }),
      ).toBe(words);
    }

    expect(WorkflowUndoCopy.theirChanges).toBe("Undo showing their changes");
    expect(WorkflowRedoCopy.theirChanges).toBe("Redo showing their changes");
  });
});
