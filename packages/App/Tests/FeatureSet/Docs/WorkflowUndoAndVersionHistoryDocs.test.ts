import { readPage } from "./DocsContentSupport";
import ComponentMetadata from "Common/Types/Workflow/Component";
import Components from "Common/Types/Workflow/Components";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WORKFLOW_VERSIONS_KEPT,
  WORKFLOW_VERSION_GROUPING_MINUTES,
} from "Common/Types/Workflow/WorkflowVersion";
import { WorkflowHistoryDirection } from "Common/UI/Components/Workflow/WorkflowEditHistory";
import {
  WorkflowRedoCopy,
  WorkflowUndoCopy,
} from "Common/UI/Components/Workflow/WorkflowHistoryLabels";
import { getWorkflowHistoryShortcut } from "Common/UI/Components/Workflow/WorkflowHistoryShortcuts";
import { WorkflowVersionCopy } from "Common/UI/Components/Workflow/WorkflowVersionPresentation";
import { getWorkflowGraphChanges } from "Common/Utils/Workflow/WorkflowGraphChanges";
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
      event: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };
      direction: WorkflowHistoryDirection;
    }> = [
      { written: "⌘Z", event: { key: "z", metaKey: true }, direction: WorkflowHistoryDirection.Undo },
      { written: "Ctrl+Z", event: { key: "z", ctrlKey: true }, direction: WorkflowHistoryDirection.Undo },
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
      { written: "Ctrl+Y", event: { key: "y", ctrlKey: true }, direction: WorkflowHistoryDirection.Redo },
    ];

    for (const shortcut of shortcuts) {
      expect({ written: shortcut.written, named: HISTORY.includes(shortcut.written) }).toEqual({
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
});
