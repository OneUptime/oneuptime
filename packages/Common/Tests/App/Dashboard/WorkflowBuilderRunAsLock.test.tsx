import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * THE BUILDER OF A WORKFLOW THAT RUNS AS MORE THAN DEFAULT (#9695): only
 * who holds what it runs as may change it, or run it by hand. Anyone else
 * who may edit workflows gets the Builder as a view - the canvas locked,
 * the add button locked, Run Workflow locked - each saying why in the
 * server's own words (WorkflowRunAsGate), and the webhook URL hidden. A
 * Project Owner gets it as ever, and a workflow that runs as Default is
 * the Builder it always was.
 */

let mockPermissions: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: mockPermissions.map((permission: string) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          }),
        };
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
        return false;
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
  WorkflowRunAs,
  getWorkflowRunAsChangeRefusedMessage,
  getWorkflowRunAsRunRefusedMessage,
} from "../../../Types/Workflow/WorkflowRunAs";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "d1d1d1d1-0000-4000-8000-000000000001",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const canvas: () => CanvasProps = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

async function renderBuilder(runAs: WorkflowRunAs): Promise<void> {
  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = { nodes: [], edges: [] } as never;
    workflow.name = "Give new teams their role";
    workflow.isEnabled = true;
    workflow.runAs = runAs;
    workflow.webhookSecretKey = "the-webhook-key";

    return workflow;
  });

  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
}

beforeEach(() => {
  mockPermissions = [];
  mockCanvasProps = null;
  mockGetItem.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a workflow that runs as Project Owner", () => {
  test("is a view for a Workflow Admin: the canvas and the add button are locked, in the server's words", async () => {
    mockPermissions = [Permission.WorkflowAdmin];

    await renderBuilder(WorkflowRunAs.ProjectOwner);

    await waitFor(() => {
      expect(canvas().editDisabledReason).toBe(
        getWorkflowRunAsChangeRefusedMessage({
          runAs: WorkflowRunAs.ProjectOwner,
        }),
      );
    });

    expect(screen.getByTestId("workflow-add-button")).toBeDisabled();
  });

  test("is not run by hand by a Workflow Admin, nor a step of it", async () => {
    mockPermissions = [Permission.WorkflowAdmin];

    await renderBuilder(WorkflowRunAs.ProjectOwner);

    const runRefused: string = getWorkflowRunAsRunRefusedMessage({
      runAs: WorkflowRunAs.ProjectOwner,
    });

    await waitFor(() => {
      expect(screen.getByTestId("run-workflow-button")).toBeDisabled();
    });

    expect(canvas().runDisabledReason).toBe(runRefused);
    expect(canvas().runStepDisabledReason).toBe(runRefused);
  });

  test("hides its webhook URL from a Workflow Admin, as the server does", async () => {
    mockPermissions = [Permission.WorkflowAdmin];

    await renderBuilder(WorkflowRunAs.ProjectOwner);

    await waitFor(() => {
      expect(canvas().editDisabledReason).toBeDefined();
    });

    expect(canvas().canSeeWebhookSecretKey).toBe(false);
  });

  test("is the Builder as ever for a Project Owner", async () => {
    mockPermissions = [Permission.ProjectOwner];

    await renderBuilder(WorkflowRunAs.ProjectOwner);

    await waitFor(() => {
      expect(canvas().canSeeWebhookSecretKey).toBe(true);
    });

    expect(canvas().editDisabledReason).toBeUndefined();
    expect(canvas().runDisabledReason).toBeUndefined();
    expect(screen.getByTestId("workflow-add-button")).not.toBeDisabled();
  });
});

describe("a workflow that runs as Default", () => {
  test("is the Builder it always was for a Workflow Admin", async () => {
    mockPermissions = [Permission.WorkflowAdmin];

    await renderBuilder(WorkflowRunAs.Default);

    await waitFor(() => {
      expect(canvas().canSeeWebhookSecretKey).toBe(true);
    });

    expect(canvas().editDisabledReason).toBeUndefined();
    expect(canvas().runDisabledReason).toBeUndefined();
  });
});
