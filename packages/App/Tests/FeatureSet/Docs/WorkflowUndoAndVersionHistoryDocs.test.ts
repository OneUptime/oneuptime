import { readPage } from "./DocsContentSupport";
import ComponentMetadata from "Common/Types/Workflow/Component";
import Components from "Common/Types/Workflow/Components";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WORKFLOW_VERSIONS_KEPT,
  WORKFLOW_VERSION_GROUPING_MINUTES,
  WorkflowVersionType,
} from "Common/Types/Workflow/WorkflowVersion";
import {
  WorkflowEditCause,
  WorkflowHistoryDirection,
} from "Common/UI/Components/Workflow/WorkflowEditHistory";
import {
  WorkflowRedoCopy,
  WorkflowUndoCopy,
} from "Common/UI/Components/Workflow/WorkflowHistoryLabels";
import { getWorkflowHistoryShortcut } from "Common/UI/Components/Workflow/WorkflowHistoryShortcuts";
import { WorkflowSaveConflictCopy } from "Common/UI/Components/Workflow/WorkflowSaveConflict";
import {
  WorkflowSaveState,
  getWorkflowSaveStatePresentation,
} from "Common/UI/Components/Workflow/WorkflowStatusBar";
import { WorkflowVersionCopy } from "Common/UI/Components/Workflow/WorkflowVersionPresentation";
import { getWorkflowGraphChanges } from "Common/Utils/Workflow/WorkflowGraphChanges";
import {
  WorkflowSavedElsewhereStep,
  getStepsSavedElsewhere,
} from "Common/UI/Components/Workflow/WorkflowSavedElsewhere";
import { AI_ACTION_CARD_LINES } from "Common/Types/AI/AIActionWords";
import {
  WorkflowDraft,
  buildGraphFromDraft,
  getDraftFromGraph,
} from "Common/Types/Workflow/WorkflowDraft";
import {
  WorkflowDraftRebaseKind,
  proposeWorkflowDraft,
  rebaseWorkflowDraft,
} from "Common/Types/Workflow/WorkflowDraftRebase";
import { JSONObject } from "Common/Types/JSON";
import WriteSource from "Common/Types/BaseDatabase/WriteSource";
import { doesNewestVersionTakeInSave } from "Common/Server/Utils/Workflow/WorkflowVersionPolicy";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the authoring page says about Undo, Redo and the Version history
 * (issue #6188), held to the code that makes it true: the buttons' names,
 * the shortcuts, how long one person's saves stay one version, how many
 * versions are kept, and the change lines a version shows.
 */

const AUTHORING: string = readPage("en", "workflows/authoring");

const section: (markdown: string, heading: string) => string = (
  markdown: string,
  heading: string,
): string => {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThan(-1);

  const rest: string = markdown.slice(start + heading.length + 2);
  const next: number = rest.search(/\n## /);

  return next === -1 ? rest : rest.slice(0, next);
};

const HISTORY: string = section(AUTHORING, "## Undo, redo and version history");

const STATUS_BAR: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../Common/UI/Components/Workflow/WorkflowStatusBar.tsx",
  ),
  "utf8",
);

describe("the authoring page on undo, redo and version history", () => {
  it("names the toolbar's buttons as the Builder draws them", () => {
    expect(HISTORY).toContain(`**${WorkflowUndoCopy.plain}**`);
    expect(HISTORY).toContain(`**${WorkflowRedoCopy.plain}**`);
    expect(HISTORY).toContain(`**${WorkflowVersionCopy.openButton}**`);
    expect(HISTORY).toContain(`**${WorkflowVersionCopy.preview}**`);
    expect(HISTORY).toContain(`**${WorkflowVersionCopy.restoreButton}**`);
  });

  it("gives the shortcuts the Builder takes, and only those", () => {
    const shortcuts: Array<{
      written: string;
      event: {
        key: string;
        metaKey?: boolean;
        ctrlKey?: boolean;
        shiftKey?: boolean;
      };
      direction: WorkflowHistoryDirection;
    }> = [
      {
        written: "⌘Z",
        event: { key: "z", metaKey: true },
        direction: WorkflowHistoryDirection.Undo,
      },
      {
        written: "Ctrl+Z",
        event: { key: "z", ctrlKey: true },
        direction: WorkflowHistoryDirection.Undo,
      },
      {
        written: "⇧⌘Z",
        event: { key: "Z", metaKey: true, shiftKey: true },
        direction: WorkflowHistoryDirection.Redo,
      },
      {
        written: "Ctrl+Shift+Z",
        event: { key: "Z", ctrlKey: true, shiftKey: true },
        direction: WorkflowHistoryDirection.Redo,
      },
      {
        written: "Ctrl+Y",
        event: { key: "y", ctrlKey: true },
        direction: WorkflowHistoryDirection.Redo,
      },
    ];

    for (const shortcut of shortcuts) {
      expect({
        written: shortcut.written,
        named: HISTORY.includes(shortcut.written),
      }).toEqual({
        written: shortcut.written,
        named: true,
      });
      expect(getWorkflowHistoryShortcut(shortcut.event)).toBe(
        shortcut.direction,
      );
    }
  });

  it("says how long one person's saves stay one version, and how many versions are kept, as the panel does", () => {
    expect(HISTORY).toContain(
      `within ${WORKFLOW_VERSION_GROUPING_MINUTES} minutes of each other are one version`,
    );
    expect(HISTORY).toContain(
      `The newest ${WORKFLOW_VERSIONS_KEPT} versions of each workflow are kept.`,
    );
    expect(WorkflowVersionCopy.panelDescription).toContain(
      `within ${WORKFLOW_VERSION_GROUPING_MINUTES} minutes of each other`,
    );
    expect(WorkflowVersionCopy.panelDescription).toContain(
      `the newest ${WORKFLOW_VERSIONS_KEPT} versions are kept`,
    );
  });

  it("says each change Ask AI makes is a version of its own, as the version history keeps it (issue #6258)", () => {
    expect(HISTORY).toContain(
      "each change Ask AI makes is a version of its own, saying Ask AI made it for you",
    );
    expect(HISTORY).toContain(
      "Restoring the version before it takes back exactly what Ask AI did.",
    );

    const now: Date = new Date("2026-11-07T12:00:00.000Z");
    const newest: Parameters<typeof doesNewestVersionTakeInSave>[0]["newest"] =
      {
        versionNumber: 2,
        versionType: WorkflowVersionType.Changed,
        graphFingerprint: "a",
        savedByUserId: "ada",
        createdAt: new Date(now.getTime() - 60 * 1000),
      };

    // Never folded into the person's version, nor the person's next edit into it.
    expect(
      doesNewestVersionTakeInSave({
        newest,
        savedByUserId: "ada",
        savedThrough: WriteSource.AskAi,
        now,
      }),
    ).toBe(false);
    expect(
      doesNewestVersionTakeInSave({
        newest: { ...newest, savedThrough: WriteSource.AskAi },
        savedByUserId: "ada",
        now,
      }),
    ).toBe(false);
    // The person's own saves in the window are still one version.
    expect(
      doesNewestVersionTakeInSave({ newest, savedByUserId: "ada", now }),
    ).toBe(true);
  });

  it("says Ask AI's change approved after someone saved keeps their save, and Undo takes back Ask AI's change alone (issue #6274)", () => {
    const askAiParagraph: string =
      AUTHORING.split("\n").find((line: string): boolean => {
        return line.startsWith("You can also describe a workflow to Ask AI");
      }) || "";

    expect(askAiParagraph).toContain(
      "If the workflow is saved while Ask AI's change waits for your approval, by you in the Builder or by someone else, approving it keeps what was saved.",
    );
    expect(askAiParagraph).toContain(
      "When the two changes are to different steps, Ask AI makes its change on top of what was saved, and says so.",
    );
    expect(askAiParagraph).toContain(
      "When they touch the same step, nothing is changed: Ask AI says the workflow changed and proposes its change again on the workflow as it is now.",
    );
    expect(HISTORY).toContain(
      "Undo takes back Ask AI's change alone, and the change saved before it is the next step back.",
    );

    // Held to the code: different steps are made on top, the same step is not made at all.
    const components: Map<string, ComponentMetadata> = new Map<
      string,
      ComponentMetadata
    >(
      (Components as Array<ComponentMetadata>).map(
        (component: ComponentMetadata): [string, ComponentMetadata] => {
          return [component.id, component];
        },
      ),
    );
    const getComponent: (id: string) => ComponentMetadata | undefined = (
      id: string,
    ): ComponentMetadata | undefined => {
      return components.get(id);
    };
    let id: number = 0;
    const generateId: () => string = (): string => {
      id++;
      return `docs-${id}`;
    };
    const digest: (text: string) => string = (text: string): string => {
      return text;
    };
    const base: JSONObject = buildGraphFromDraft({
      draft: {
        steps: [
          { id: "manual-1", componentId: ComponentID.Manual },
          {
            id: "log-1",
            componentId: ComponentID.Log,
            arguments: { value: "a" },
          },
          {
            id: "log-2",
            componentId: ComponentID.Log,
            arguments: { value: "b" },
          },
        ],
        connections: [
          { from: "manual-1", to: "log-1" },
          { from: "manual-1", to: "log-2" },
        ],
      },
      getComponent,
      generateId,
    });
    const read: WorkflowDraft = getDraftFromGraph({
      graph: base,
      getComponent,
    });
    // Ask AI changes Log 1.
    const askAi: WorkflowDraft = {
      ...read,
      steps: read.steps.map((step: WorkflowDraft["steps"][number]) => {
        return step.id === "log-1"
          ? { ...step, arguments: { value: "Ask AI's" } }
          : step;
      }),
    };
    const theirs: (stepId: string) => JSONObject = (
      stepId: string,
    ): JSONObject => {
      const graph: JSONObject = JSON.parse(JSON.stringify(base)) as JSONObject;
      (
        (graph["nodes"] as Array<JSONObject>).find((node: JSONObject) => {
          return (node["data"] as JSONObject)["id"] === stepId;
        })!["data"] as JSONObject
      )["arguments"] = { value: "theirs" };
      return graph;
    };
    const outcomeOver: (graph: JSONObject) => WorkflowDraftRebaseKind = (
      graph: JSONObject,
    ): WorkflowDraftRebaseKind => {
      return rebaseWorkflowDraft({
        draft: askAi,
        proposedOn: proposeWorkflowDraft({
          draft: askAi,
          graph: base,
          graphRevision: 1,
          getComponent,
          generateId,
          digest,
        }),
        graph,
        getComponent,
        generateId,
        digest,
      }).kind;
    };

    expect(outcomeOver(theirs("log-2"))).toBe(WorkflowDraftRebaseKind.Rebased);
    expect(outcomeOver(theirs("log-1"))).toBe(WorkflowDraftRebaseKind.Conflict);
    // And the card says so when it was made on top.
    expect(AI_ACTION_CARD_LINES.workflowSavedSinceKept).toBe(
      "Changes saved after this was proposed were kept",
    );

    // Undo: their save, then Ask AI's change, two steps - Ask AI's the last, so Undo takes it alone.
    const steps: Array<WorkflowSavedElsewhereStep> = getStepsSavedElsewhere({
      known: { nodes: [], edges: [] },
      server: base,
      versions: [
        { versionNumber: 3, graph: base, savedThrough: WriteSource.AskAi },
        { versionNumber: 2, graph: theirs("log-2") },
        { versionNumber: 1, graph: { nodes: [], edges: [] } },
      ],
    });

    expect(
      steps.map((step: WorkflowSavedElsewhereStep): WorkflowEditCause => {
        return step.cause;
      }),
    ).toEqual([WorkflowEditCause.TheirChanges, WorkflowEditCause.AskAi]);
  });

  it("quotes a change line as a version shows it", () => {
    const email: ComponentMetadata | undefined = (
      Components as Array<ComponentMetadata>
    ).find((component: ComponentMetadata): boolean => {
      return component.id === ComponentID.SendEmail;
    });

    const line: string | undefined = getWorkflowGraphChanges({
      before: { nodes: [], edges: [] },
      after: {
        nodes: [
          {
            id: "card",
            position: { x: 0, y: 0 },
            data: { id: "send-email-1", metadataId: ComponentID.SendEmail },
          },
        ],
        edges: [],
      },
      lookup: (componentId: string): ComponentMetadata | undefined => {
        return componentId === ComponentID.SendEmail ? email : undefined;
      },
    }).lines[0];

    expect(line).toBe('Added "Send Email" (send-email-1)');
    expect(HISTORY).toContain(`\`${line}\``);
  });

  it("says what the save pill says when a save fails, and that its Try again tries again", () => {
    const canvas: string = section(AUTHORING, "## The canvas");

    for (const label of ["Saving…", "Saved", "Could not save", "Try again"]) {
      expect({ label, named: canvas.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
      expect(STATUS_BAR).toContain(`translationKey("${label}")`);
    }

    expect(canvas).toContain("(#undo-redo-and-version-history)");
  });

  it("says what happens when someone else saved the workflow first, naming what the Builder draws (issue #6257)", () => {
    const canvas: string = section(AUTHORING, "## The canvas");
    const notSaved: string = getWorkflowSaveStatePresentation(
      WorkflowSaveState.Conflict,
    ).label;

    for (const label of [
      notSaved,
      WorkflowSaveConflictCopy.showTheirChanges,
      WorkflowSaveConflictCopy.keepMine,
      WorkflowUndoCopy.plain,
    ]) {
      expect({ label, named: canvas.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }

    expect(STATUS_BAR).toContain(`translationKey("${notSaved}")`);
    // The page and the dialog say the same: nothing is lost either way.
    expect(
      WorkflowSaveConflictCopy.note.startsWith("Nothing is lost either way."),
    ).toBe(true);
    expect(canvas).toContain("Nothing is lost either way.");
  });
});
