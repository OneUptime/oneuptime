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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * THE BUILDER AS A VIEW, on the real Builder page: for someone who may open
 * a workflow but not change it - a Workflow Member, who runs workflows, or
 * a viewer - by the Workflow model's update list, which the server asks of
 * every save of the graph (WorkflowRunGate's getWorkflowEditGate).
 *
 * The Builder used to work for them as for an editor: they could add a
 * trigger or a step, and every change then failed to save, with an error
 * dialog. Now the add button is locked, saying why; the save pill says
 * "View only"; the canvas is told it is a view; and nothing is saved, however
 * often the canvas reports its graph. Run Workflow is the run gate's
 * (WorkflowBuilderRunPermissions): a Workflow Member still runs it.
 *
 * The canvas is a stand-in that records what it is handed
 * (WorkflowViewOnly.test.tsx and Workflow.test.tsx test the real one).
 */

let mockPermissions: Array<string> = [];
let mockIsMasterAdmin: boolean = false;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 1 };
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

let mockCanvasProps: CanvasProps | null = null;

jest.mock("../../../UI/Components/Workflow/Workflow", () => {
  return {
    __esModule: true,
    default: (props: CanvasProps): React.ReactElement => {
      mockCanvasProps = props;

      return <div data-testid="workflow-canvas" />;
    },
    getEdgeDefaultProps: (): Record<string, unknown> => {
      return {};
    },
    getPlaceholderTriggerNode: (): Record<string, unknown> => {
      return {
        id: "placeholder",
        type: "node",
        position: { x: 0, y: 0 },
        data: { nodeType: "PlaceholderNode", componentType: "Trigger" },
      };
    },
  };
});

import Builder from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { WORKFLOW_EDIT_PERMISSIONS } from "../../../Types/Workflow/WorkflowRunPermissions";
import { WORKFLOW_VIEW_ONLY_TEXT } from "../../../UI/Components/Workflow/WorkflowStatusBar";
import Navigation from "../../../UI/Utils/Navigation";
import { Edge, Node } from "reactflow";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161009",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const EDIT_REFUSED: string =
  "Changing this workflow takes permission to edit it. You need this permission: Edit Workflow.";

// Roles that open a workflow and may not change it.
const MAY_NOT_CHANGE: Array<Permission> = [
  Permission.WorkflowMember,
  Permission.Viewer,
  Permission.WorkflowViewer,
  Permission.ReadWorkflow,
  Permission.ProjectMember,
];

// A trigger, as the canvas holds one.
const TRIGGER_NODE: Node = {
  id: "canvas-manual-1",
  type: "node",
  position: { x: 160, y: 64 },
  data: {
    id: "manual-1",
    nodeType: "Node",
    componentType: "Trigger",
    metadataId: "manual",
    metadata: { componentType: "Trigger", title: "Manual" },
  },
};

const canvas: () => CanvasProps = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

const addButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-add-button");
};

const renderBuilder: (
  graph?: { nodes: Array<Node>; edges: Array<Edge> } | undefined,
) => Promise<void> = async (
  graph?: { nodes: Array<Node>; edges: Array<Edge> } | undefined,
): Promise<void> => {
  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = (graph || { nodes: [], edges: [] }) as never;
    workflow.name = "Page the on-call";
    workflow.isEnabled = true;

    return workflow;
  });

  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

// What the canvas does whenever it draws: report its graph.
const canvasReports: (nodes: Array<Node>) => Promise<void> = async (
  nodes: Array<Node>,
): Promise<void> => {
  await act(async () => {
    canvas().onWorkflowUpdated(nodes, []);
  });

  // The Builder debounces a save by a second.
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
};

beforeEach(() => {
  mockPermissions = [];
  mockIsMasterAdmin = false;
  mockCanvasProps = null;
  mockGetItem.mockReset();
  mockUpdateById.mockReset();
  mockUpdateById.mockImplementation(async () => {
    return {};
  });

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("someone who may not change the workflow", () => {
  test.each(MAY_NOT_CHANGE)(
    "%s: the add button is locked, saying why and who may",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(addButton()).toBeDisabled();

      fireEvent.mouseEnter(
        screen.getByTestId("workflow-add-button-disabled-wrapper"),
      );

      expect(screen.getByRole("tooltip")).toHaveTextContent(EDIT_REFUSED);

      fireEvent.click(addButton());

      expect(canvas().showComponentsPickerModal).toBe(false);
    },
  );

  test.each(MAY_NOT_CHANGE)(
    "%s: the canvas is told it is a view, and why",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(canvas().editDisabledReason).toBe(EDIT_REFUSED);
    },
  );

  test("the save pill says View only, with the reason", async () => {
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder();

    const pill: HTMLElement = screen.getByTestId("workflow-view-only-status");

    expect(pill).toHaveTextContent(WORKFLOW_VIEW_ONLY_TEXT);
    expect(pill).toHaveAttribute("title", EDIT_REFUSED);
    expect(
      screen.queryByTestId("workflow-save-status"),
    ).not.toBeInTheDocument();
  });

  test("Add Trigger is not the page's primary button when it is locked", async () => {
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder();

    expect(addButton()).toHaveTextContent("Add Trigger");
    expect(addButton().className).not.toContain("bg-indigo-600");
  });

  /*
   * A locked button sits in the span that carries its reason (Button's
   * tooltip wrapper), which is only as wide as its words: on a phone the
   * view's locked Add Trigger stood narrower than the full-width Run
   * Workflow under it. The toolbar holds that span to a button's own width
   * - the whole row below md, its words from md up.
   */
  test("the locked add button is as wide as the toolbar's other buttons on a phone", async () => {
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder();

    const toolbar: HTMLElement = screen.getByTestId("workflow-toolbar-buttons");
    const wrapper: HTMLElement = screen.getByTestId(
      "workflow-add-button-disabled-wrapper",
    );

    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper.parentElement).toBe(toolbar);
    expect(toolbar).toHaveClass("[&>span]:w-full", "md:[&>span]:w-auto");
  });

  test("nothing is saved, however often the canvas reports its graph", async () => {
    jest.useFakeTimers();
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder({ nodes: [TRIGGER_NODE], edges: [] });

    await canvasReports([TRIGGER_NODE]);
    await canvasReports([{ ...TRIGGER_NODE, selected: true }]);

    expect(mockUpdateById).not.toHaveBeenCalled();
    // No error dialog for a save that never happened.
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-view-only-status")).toBeInTheDocument();
  });

  test("a Workflow Member still runs the workflow: Run Workflow is the run gate's, not the view's", async () => {
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder({ nodes: [TRIGGER_NODE], edges: [] });

    expect(screen.getByTestId("run-workflow-button")).toBeEnabled();
    expect(canvas().runDisabledReason).toBeUndefined();
  });
});

describe("someone who may change the workflow", () => {
  test.each([...WORKFLOW_EDIT_PERMISSIONS])(
    "%s: the add button works, the canvas is no view, and the pill says the save state",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(addButton()).toBeEnabled();
      expect(canvas().editDisabledReason).toBeUndefined();
      expect(screen.getByTestId("workflow-save-status")).toBeInTheDocument();
      expect(
        screen.queryByTestId("workflow-view-only-status"),
      ).not.toBeInTheDocument();

      fireEvent.click(addButton());

      await waitFor(() => {
        expect(canvas().showComponentsPickerModal).toBe(true);
      });
    },
  );

  test("Add Trigger is the page's primary button while the workflow needs its trigger", async () => {
    mockPermissions = [Permission.ProjectAdmin];

    await renderBuilder();

    expect(addButton()).toHaveTextContent("Add Trigger");
    expect(addButton().className).toContain("bg-indigo-600");
  });

  test("their changes are saved, as they always were", async () => {
    jest.useFakeTimers();
    mockPermissions = [Permission.ProjectAdmin];

    await renderBuilder({ nodes: [TRIGGER_NODE], edges: [] });

    await canvasReports([{ ...TRIGGER_NODE, position: { x: 400, y: 64 } }]);

    expect(mockUpdateById).toHaveBeenCalled();
    expect(
      (mockUpdateById.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data,
    ).toHaveProperty("graph");
  });

  test("a master admin may change it", async () => {
    mockIsMasterAdmin = true;

    await renderBuilder();

    expect(addButton()).toBeEnabled();
    expect(canvas().editDisabledReason).toBeUndefined();
  });

  test("Edit All Operational Resources may change it", async () => {
    mockPermissions = [Permission.EditAllOperationalResources];

    await renderBuilder();

    expect(canvas().editDisabledReason).toBeUndefined();
  });

  /*
   * Before the permission snapshot lands there is nothing honest to say:
   * the Builder is no view, and the server decides each save.
   */
  test("before the permission snapshot lands, nothing is locked", async () => {
    mockPermissions = [];

    await renderBuilder();

    expect(addButton()).toBeEnabled();
    expect(canvas().editDisabledReason).toBeUndefined();
  });
});
