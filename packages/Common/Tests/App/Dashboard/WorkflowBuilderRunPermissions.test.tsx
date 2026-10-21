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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * Who the Builder lets run a workflow, by the lists the server asks for
 * (Types/Workflow/WorkflowRunPermissions):
 *
 *   - Run Workflow: the workflow's editors and Workflow Members, who run
 *     workflows without changing them;
 *   - Run just this step: the editors alone - one step on its own skips every
 *     condition before it.
 *
 * Somebody who may not sees the button locked, with the server's own
 * refusal and the permissions that would let them in its tooltip - never a
 * button that answers with an error. Before the permission snapshot lands
 * nothing is locked and the server decides.
 *
 * The real Builder page is rendered; the canvas is a stand-in that records
 * what it is handed.
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
      updateById: async (): Promise<unknown> => {
        return {};
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
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_REFUSED_MESSAGE,
  WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
} from "../../../Types/Workflow/WorkflowRunPermissions";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161009",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const RUN_REFUSED: string = `${WORKFLOW_RUN_REFUSED_MESSAGE} You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin, Workflow Member.`;

const STEP_RUN_REFUSED: string = `${WORKFLOW_STEP_RUN_REFUSED_MESSAGE} You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.`;

// Roles that open a workflow and may not run it.
const MAY_NOT_RUN: Array<Permission> = [
  Permission.Viewer,
  Permission.WorkflowViewer,
  Permission.ReadWorkflow,
  Permission.ProjectMember,
];

const canvas: () => CanvasProps = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

const runButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("run-workflow-button");
};

const renderBuilder: () => Promise<void> = async (): Promise<void> => {
  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

beforeEach(() => {
  mockPermissions = [];
  mockIsMasterAdmin = false;
  mockCanvasProps = null;
  mockGetItem.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = { nodes: [], edges: [] };
    workflow.name = "Page the on-call";
    workflow.isEnabled = true;

    return workflow;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Run Workflow", () => {
  test.each([...WORKFLOW_RUN_PERMISSIONS])(
    "%s may run the workflow: the button opens the run panel",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(runButton()).toBeEnabled();
      expect(canvas().showRunModal).toBe(false);

      fireEvent.click(runButton());

      await waitFor(() => {
        expect(canvas().showRunModal).toBe(true);
      });
    },
  );

  test.each(MAY_NOT_RUN)(
    "%s may not: the button is locked, saying why and who may",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(runButton()).toBeDisabled();

      fireEvent.mouseEnter(
        screen.getByTestId("run-workflow-button-disabled-wrapper"),
      );

      expect(screen.getByRole("tooltip")).toHaveTextContent(RUN_REFUSED);

      fireEvent.click(runButton());

      expect(canvas().showRunModal).toBe(false);
    },
  );

  test("Edit All Operational Resources may run it, as it may edit it", async () => {
    mockPermissions = [Permission.EditAllOperationalResources];

    await renderBuilder();

    expect(runButton()).toBeEnabled();
  });

  test("a master admin may run it", async () => {
    mockIsMasterAdmin = true;

    await renderBuilder();

    expect(runButton()).toBeEnabled();
  });

  test("before the permission snapshot lands nothing is locked: the server decides", async () => {
    mockPermissions = [];

    await renderBuilder();

    expect(runButton()).toBeEnabled();
  });
});

describe("Run just this step", () => {
  test.each([...WORKFLOW_EDIT_PERMISSIONS])(
    "%s may run one step: the canvas is told nothing is in the way",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(canvas().runStepDisabledReason).toBeUndefined();
    },
  );

  /*
   * A Workflow Member runs the whole workflow, from its trigger and through
   * every condition, as its editors built it - but not one step on its own.
   */
  test("a Workflow Member runs the workflow but not one step of it", async () => {
    mockPermissions = [Permission.WorkflowMember];

    await renderBuilder();

    expect(runButton()).toBeEnabled();
    expect(canvas().runStepDisabledReason).toBe(STEP_RUN_REFUSED);
  });

  test.each(MAY_NOT_RUN)(
    "%s may not run a step either",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(canvas().runStepDisabledReason).toBe(STEP_RUN_REFUSED);
    },
  );

  test("a master admin may", async () => {
    mockIsMasterAdmin = true;

    await renderBuilder();

    expect(canvas().runStepDisabledReason).toBeUndefined();
  });

  test("before the permission snapshot lands nothing is locked", async () => {
    mockPermissions = [];

    await renderBuilder();

    expect(canvas().runStepDisabledReason).toBeUndefined();
  });
});
