import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import { ComponentProps as CanvasProps } from "../../../../UI/Components/Workflow/Workflow";

/*
 * THE BUILDER'S VERSION HISTORY (issue #6188), on the real panel and preview:
 * every version newest first, with who saved it, when and what it changed;
 * a preview of any earlier one, with what restoring it would change; and
 * Restore, for whoever may change the workflow.
 *
 * The API is a stand-in that serves versions, and so is the preview's canvas
 * (Workflow.test.tsx tests the real one): it records what it is handed.
 */

const mockGetList: MockFunction = getJestMockFunction();
const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
    },
  };
});

let mockCanvasProps: CanvasProps | null = null;

jest.mock("../../../../UI/Components/Workflow/Workflow", () => {
  return {
    __esModule: true,
    default: (props: CanvasProps): React.ReactElement => {
      mockCanvasProps = props;

      return (
        <div data-testid="preview-canvas">
          {props.initialNodes.map((node: { id: string; data: { id?: string } }) => {
            return <span key={node.id}>{node.data.id || "slot"}</span>;
          })}
        </div>
      );
    },
    getEdgeDefaultProps: (): Record<string, unknown> => {
      return { type: "smoothstep" };
    },
    getPlaceholderTriggerNode: (): Record<string, unknown> => {
      return {
        id: "placeholder",
        type: "node",
        position: { x: 100, y: 100 },
        data: {
          nodeType: "PlaceholderNode",
          metadata: { componentType: "Trigger", title: "Trigger" },
          id: "",
        },
      };
    },
  };
});

import WorkflowVersionHistory from "../../../../UI/Components/Workflow/WorkflowVersionHistory";
import { WorkflowVersionCopy } from "../../../../UI/Components/Workflow/WorkflowVersionPresentation";
import WorkflowVersion from "../../../../Models/DatabaseModels/WorkflowVersion";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata from "../../../../Types/Workflow/Component";
import { WorkflowVersionType } from "../../../../Types/Workflow/WorkflowVersion";
import {
  SavedWorkflowGraph,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import {
  COMPONENTS_BY_ID,
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161188",
);

const COMPONENTS: Array<ComponentMetadata> = Array.from(
  COMPONENTS_BY_ID.values(),
);

// On the canvas now: a trigger and a Log step.
const CURRENT: SavedWorkflowGraph = toSavedWorkflowGraph(graphOf([MANUAL, LOG]));

// Version 2 had a Send Email step too.
const VERSION_2_GRAPH: JSONObject = toSavedWorkflowGraph(
  graphOf([MANUAL, LOG, EMAIL]),
) as unknown as JSONObject;

const version: (data: {
  number: number;
  type: WorkflowVersionType;
  changes?: Array<string>;
  changeCount?: number;
  restoredFrom?: number;
  savedBy?: string;
  updatedAt?: Date;
}) => WorkflowVersion = (data: {
  number: number;
  type: WorkflowVersionType;
  changes?: Array<string>;
  changeCount?: number;
  restoredFrom?: number;
  savedBy?: string;
  updatedAt?: Date;
}): WorkflowVersion => {
  const model: WorkflowVersion = new WorkflowVersion();
  model._id = `0198c8ec-2a1d-7f0c-9e75-0000000000${String(data.number).padStart(2, "0")}`;
  model.id = new ObjectID(model._id);
  model.versionNumber = data.number;
  model.versionType = data.type;
  model.changes = data.changes || [];
  model.changeCount = data.changeCount ?? (data.changes || []).length;
  model.restoredFromVersionNumber = data.restoredFrom as number;
  model.createdAt = data.updatedAt || new Date(Date.now() - 60 * 60 * 1000);
  model.updatedAt = data.updatedAt || new Date(Date.now() - 60 * 60 * 1000);

  if (data.savedBy) {
    model.createdByUser = { name: data.savedBy } as never;
  }

  return model;
};

const VERSIONS: Array<WorkflowVersion> = [
  version({
    number: 4,
    type: WorkflowVersionType.Restored,
    restoredFrom: 2,
    changes: ['Added "Send Email" (send-email-1)'],
    savedBy: "Ada Lovelace",
    updatedAt: new Date(Date.now() - 2 * 60 * 1000),
  }),
  version({
    number: 3,
    type: WorkflowVersionType.Changed,
    changes: [
      'Removed "Send Email" (send-email-1)',
      'Changed "Value" in "Log" (log-1)',
      "a",
      "b",
      "c",
      "d",
      "e",
    ],
    changeCount: 9,
    savedBy: "Grace Hopper",
  }),
  version({
    number: 2,
    type: WorkflowVersionType.Changed,
    changes: ['Added "Send Email" (send-email-1)'],
  }),
  version({ number: 1, type: WorkflowVersionType.Earlier }),
];

const serve: (versions: Array<WorkflowVersion>, count?: number) => void = (
  versions: Array<WorkflowVersion>,
  count?: number,
): void => {
  mockGetList.mockImplementation(
    async (request: { skip: number; limit: number }) => {
      return {
        data: versions.slice(request.skip, request.skip + request.limit),
        count: count ?? versions.length,
        skip: request.skip,
        limit: request.limit,
      };
    },
  );
};

const renderPanel: (overrides?: {
  restoreDisabledReason?: string;
  refreshToken?: number;
  onRestore?: MockFunction;
  onClose?: MockFunction;
}) => ReturnType<typeof render> = (
  overrides: {
    restoreDisabledReason?: string;
    refreshToken?: number;
    onRestore?: MockFunction;
    onClose?: MockFunction;
  } = {},
): ReturnType<typeof render> => {
  return render(
    <WorkflowVersionHistory
      workflowId={WORKFLOW_ID}
      refreshToken={overrides.refreshToken ?? 0}
      currentGraph={CURRENT}
      components={COMPONENTS}
      restoreDisabledReason={overrides.restoreDisabledReason}
      onRestore={(overrides.onRestore || getJestMockFunction()) as never}
      onClose={(overrides.onClose || getJestMockFunction()) as never}
    />,
  );
};

const row: (versionNumber: number) => HTMLElement = (
  versionNumber: number,
): HTMLElement => {
  return screen.getByTestId(`workflow-version-${versionNumber}`);
};

beforeEach(() => {
  mockGetList.mockReset();
  mockGetItem.mockReset();
  mockCanvasProps = null;
  mockGetItem.mockImplementation(async () => {
    const model: WorkflowVersion = new WorkflowVersion();
    model.graph = VERSION_2_GRAPH;
    return model;
  });
});

afterEach(() => {
  cleanup();
});

describe("the list", () => {
  test("reads this workflow's versions, newest first", async () => {
    serve(VERSIONS);
    renderPanel();

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    const request: {
      query: JSONObject;
      sort: JSONObject;
      skip: number;
      limit: number;
      select: JSONObject;
    } = mockGetList.mock.calls[0]?.[0] as never;

    expect(request.query["workflowId"]).toEqual(WORKFLOW_ID);
    expect(request.sort).toEqual({ versionNumber: "DESC" });
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(20);
    // A list never reads every version's graph.
    expect(request.select["graph"]).toBeUndefined();

    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      WorkflowVersionCopy.panelTitle,
    );
    expect(
      screen
        .getAllByTestId(/^workflow-version-\d+$/)
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-testid");
        }),
    ).toEqual([
      "workflow-version-4",
      "workflow-version-3",
      "workflow-version-2",
      "workflow-version-1",
    ]);
  });

  test("says of each version what made it, who saved it and when", async () => {
    serve(VERSIONS);
    renderPanel();

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    expect(row(4)).toHaveTextContent("Version 4");
    expect(within(row(4)).getByText("Current")).toBeInTheDocument();
    expect(row(4)).toHaveTextContent("Ada Lovelace");
    expect(row(4)).toHaveTextContent("Restored version 2");
    expect(row(4)).toHaveTextContent('Added "Send Email" (send-email-1)');
    // When, in the reader's words, with the full time under the pointer.
    const time: HTMLTimeElement | null = row(4).querySelector("time");

    expect(time).not.toBeNull();
    expect(time?.getAttribute("dateTime")).toBe(
      VERSIONS[0]?.updatedAt?.toISOString(),
    );
    expect(time?.textContent).toMatch(/minutes? ago/);
    expect(time?.getAttribute("title")).toBeTruthy();

    expect(within(row(3)).queryByText("Current")).toBeNull();
    expect(row(3)).toHaveTextContent("Grace Hopper");
    expect(
      within(row(3)).getAllByRole("listitem").map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual([
      'Removed "Send Email" (send-email-1)',
      'Changed "Value" in "Log" (log-1)',
      "a",
      "b",
      "c",
    ]);
    expect(row(3)).toHaveTextContent("And 4 more changes");

    // Saved through the API: nobody to name.
    expect(row(2)).toHaveTextContent("Saved through the API");

    expect(row(1)).toHaveTextContent(
      "The workflow before version history began",
    );
    expect(row(1)).not.toHaveTextContent("Saved through the API");
  });

  test("offers a preview of every version but the newest", async () => {
    serve(VERSIONS);
    renderPanel();

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    expect(screen.queryByTestId("workflow-version-preview-4")).toBeNull();

    for (const versionNumber of [3, 2, 1]) {
      expect(
        screen.getByTestId(`workflow-version-preview-${versionNumber}`),
      ).toHaveTextContent("Preview");
    }
  });

  test("with no versions yet, says so", async () => {
    serve([]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-version-history-empty"),
      ).toHaveTextContent(WorkflowVersionCopy.noVersions);
    });
  });

  test("a list it could not read says why", async () => {
    mockGetList.mockImplementation(async () => {
      throw new Error("You do not have permission to read this workflow.");
    });
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to read this workflow."),
      ).toBeInTheDocument();
    });
  });

  test("Show more reads the next page and adds it", async () => {
    const many: Array<WorkflowVersion> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): WorkflowVersion => {
        return version({
          number: 25 - index,
          type: WorkflowVersionType.Changed,
          changes: [`Changed "Value" in "Log" (log-${index})`],
        });
      },
    );
    serve(many);
    renderPanel();

    await waitFor(() => {
      expect(row(25)).toBeInTheDocument();
    });

    expect(screen.queryByTestId("workflow-version-5")).toBeNull();

    fireEvent.click(screen.getByTestId("workflow-version-history-show-more"));

    await waitFor(() => {
      expect(row(1)).toBeInTheDocument();
    });

    expect((mockGetList.mock.calls[1]?.[0] as { skip: number }).skip).toBe(20);
    expect(screen.getAllByTestId(/^workflow-version-\d+$/)).toHaveLength(25);
    expect(screen.queryByTestId("workflow-version-history-show-more")).toBeNull();
  });

  test("reads again after a save, keeping as many as it shows", async () => {
    serve(VERSIONS);
    const view: ReturnType<typeof render> = renderPanel({ refreshToken: 0 });

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    serve([
      version({
        number: 5,
        type: WorkflowVersionType.Changed,
        changes: ['Added "Log" (log-2)'],
      }),
      ...VERSIONS,
    ]);

    view.rerender(
      <WorkflowVersionHistory
        workflowId={WORKFLOW_ID}
        refreshToken={1}
        currentGraph={CURRENT}
        components={COMPONENTS}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(row(5)).toBeInTheDocument();
    });

    expect(within(row(5)).getByText("Current")).toBeInTheDocument();
    expect(within(row(4)).queryByText("Current")).toBeNull();
  });

  test("closes when asked", async () => {
    serve(VERSIONS);
    const onClose: MockFunction = getJestMockFunction();
    renderPanel({ onClose });

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("close-button"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the preview", () => {
  const openPreviewOf: (versionNumber: number) => Promise<void> = async (
    versionNumber: number,
  ): Promise<void> => {
    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTestId(`workflow-version-preview-${versionNumber}`),
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-version-preview")).toBeInTheDocument();
    });
  };

  test("reads that version's graph and says what restoring it would change", async () => {
    serve(VERSIONS);
    renderPanel();
    await openPreviewOf(2);

    expect(
      (mockGetItem.mock.calls[0]?.[0] as { id: ObjectID; select: JSONObject })
        .select,
    ).toEqual({ graph: true });
    expect(screen.getByRole("dialog", { name: /Version 2/ })).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-version-preview-changes"),
    ).toHaveTextContent('Added "Send Email" (send-email-1)');
    expect(screen.getByTestId("workflow-version-preview-note")).toHaveTextContent(
      WorkflowVersionCopy.restoreNote,
    );
  });

  test("draws the version on a canvas of its own where nothing changes", async () => {
    serve(VERSIONS);
    renderPanel();
    await openPreviewOf(2);

    expect(screen.getByTestId("preview-canvas")).toHaveTextContent(
      "send-email-1",
    );
    expect(mockCanvasProps?.editDisabledReason).toBe(
      WorkflowVersionCopy.previewReadOnly,
    );
    expect(mockCanvasProps?.runDisabledReason).toBe(
      WorkflowVersionCopy.previewRunRefused,
    );
    expect(mockCanvasProps?.canvasHeight).toBeDefined();
  });

  test("Restore hands the version to the builder, and closes", async () => {
    serve(VERSIONS);
    const onRestore: MockFunction = getJestMockFunction();
    renderPanel({ onRestore });
    await openPreviewOf(2);

    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));

    expect(onRestore).toHaveBeenCalledWith({
      versionNumber: 2,
      graph: VERSION_2_GRAPH,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-version-preview")).toBeNull();
    });

    // The panel stays open, for the restore to show up in it once saved.
    expect(row(4)).toBeInTheDocument();
  });

  test("a version the same as the canvas says so, and cannot be restored", async () => {
    serve(VERSIONS);
    mockGetItem.mockImplementation(async () => {
      const model: WorkflowVersion = new WorkflowVersion();
      model.graph = CURRENT as unknown as JSONObject;
      return model;
    });
    const onRestore: MockFunction = getJestMockFunction();
    renderPanel({ onRestore });
    await openPreviewOf(3);

    expect(screen.getByTestId("workflow-version-preview-same")).toHaveTextContent(
      WorkflowVersionCopy.sameAsNow,
    );

    const restore: HTMLElement = screen.getByRole("button", {
      name: "Restore this version",
    });

    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    expect(onRestore).not.toHaveBeenCalled();
  });

  test("for someone who may not change the workflow: a look, and why they cannot restore it", async () => {
    serve(VERSIONS);
    renderPanel({
      restoreDisabledReason:
        "Changing this workflow takes permission to edit it.",
    });
    await openPreviewOf(2);

    expect(screen.getByTestId("workflow-version-preview-note")).toHaveTextContent(
      "Changing this workflow takes permission to edit it.",
    );
    expect(
      screen.queryByRole("button", { name: "Restore this version" }),
    ).toBeNull();
    expect(screen.getByTestId("preview-canvas")).toBeInTheDocument();
  });

  test("a version with a step OneUptime no longer has cannot be drawn or restored", async () => {
    serve(VERSIONS);
    mockGetItem.mockImplementation(async () => {
      const model: WorkflowVersion = new WorkflowVersion();
      model.graph = toSavedWorkflowGraph(
        graphOf([MANUAL, { ...LOG, componentId: "a-step-that-is-gone" }]),
      ) as unknown as JSONObject;
      return model;
    });
    serve(VERSIONS);
    renderPanel();

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("workflow-version-preview-2"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "This version cannot be shown: it has a step OneUptime no longer has.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("preview-canvas")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore this version" }),
    ).toBeDisabled();
  });

  test("a graph it could not read says why", async () => {
    serve(VERSIONS);
    mockGetItem.mockImplementation(async () => {
      throw new Error("This version is no longer kept.");
    });
    renderPanel();

    await waitFor(() => {
      expect(row(4)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("workflow-version-preview-1"));

    await waitFor(() => {
      expect(
        screen.getByText("This version is no longer kept."),
      ).toBeInTheDocument();
    });
  });

  test("Close leaves the version as it is", async () => {
    serve(VERSIONS);
    const onRestore: MockFunction = getJestMockFunction();
    renderPanel({ onRestore });
    await openPreviewOf(2);

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: /Version 2/,
    });

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).pop() as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByTestId("workflow-version-preview")).toBeNull();
    });
    expect(onRestore).not.toHaveBeenCalled();
  });
});
