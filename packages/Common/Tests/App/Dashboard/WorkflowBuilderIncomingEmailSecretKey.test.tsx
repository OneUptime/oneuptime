import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * The workflow Builder page and the incoming email secret key: what the
 * Incoming Email trigger's address is built from.
 *
 * The canvas draws the trigger's settings, so the Builder page is what loads
 * the key and saves a new one, the way it does for the webhook key. Pinned
 * here, with the canvas replaced by a stand-in that records what it is
 * handed:
 *   - the page asks for the key only when the user may read it - an
 *     unreadable column in a select fails the whole request;
 *   - it tells the canvas whether the key could be read, so the trigger can
 *     say "hidden" rather than create an address over a real one;
 *   - Reset address (and the first address of a new step) saves a fresh key
 *     at once and hands it down, and a failed save is passed back.
 */

let mockPermissions: Array<unknown> = [];
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
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 1 };
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
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);
const EMAIL_SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const UUID_V4: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditWorkflow,
];

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

type GetItemCallFunction = () => { select: Record<string, unknown> };

const getItemCall: GetItemCallFunction = (): {
  select: Record<string, unknown>;
} => {
  expect(mockGetItem).toHaveBeenCalledTimes(1);

  return mockGetItem.mock.calls[0]![0] as never;
};

const canvas: () => CanvasProps = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
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
  mockUpdateById.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  /*
   * The API only returns the columns it was asked for, and refuses a column
   * the caller may not read - the way SelectPermission does.
   */
  mockGetItem.mockImplementation(async (...args: Array<unknown>) => {
    const request: { select: Record<string, unknown> } = args[0] as never;
    const workflow: WorkflowModel = new WorkflowModel();
    const mayRead: boolean =
      mockIsMasterAdmin ||
      (mockPermissions as Array<Permission>).some((permission: Permission) => {
        return EDITORS.includes(permission);
      });

    workflow.graph = { nodes: [], edges: [] };

    for (const column of ["webhookSecretKey", "incomingEmailSecretKey"]) {
      if (request.select[column] && !mayRead) {
        throw new Error(
          `You do not have permissions to select on - ${column}.`,
        );
      }
    }

    if (request.select["incomingEmailSecretKey"]) {
      workflow.incomingEmailSecretKey = new ObjectID(EMAIL_SECRET);
    }

    return workflow;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the builder loads the incoming email key only for those who may see it", () => {
  test.each(EDITORS)(
    "%s: the key is loaded with the graph and handed to the canvas",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      expect(getItemCall().select["incomingEmailSecretKey"]).toBe(true);
      expect(canvas().incomingEmailSecretKey).toBe(EMAIL_SECRET);
      expect(canvas().canSeeIncomingEmailSecretKey).toBe(true);
      expect(canvas().onResetIncomingEmailSecretKey).toBeInstanceOf(Function);
    },
  );

  test.each([
    Permission.Viewer,
    Permission.WorkflowViewer,
    Permission.ReadWorkflow,
    Permission.ProjectMember,
  ])(
    "%s: the builder still opens, without the key, and the canvas is told it is hidden",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      // Not even `incomingEmailSecretKey: false`: the column is never named.
      expect(Object.keys(getItemCall().select)).not.toContain(
        "incomingEmailSecretKey",
      );
      expect(canvas().incomingEmailSecretKey).toBe("");
      expect(canvas().canSeeIncomingEmailSecretKey).toBe(false);
      expect(
        screen.queryByText(/permissions to select/),
      ).not.toBeInTheDocument();
    },
  );

  test("before the permission snapshot lands, it does not risk asking", async () => {
    await renderBuilder();

    /*
     * isEnabled sets the Enabled switch at the top of the page, and
     * isArchived says whether to offer turning it on at all.
     */
    expect(Object.keys(getItemCall().select)).toEqual([
      "graph",
      "name",
      "isEnabled",
      "isArchived",
    ]);
    expect(canvas().canSeeIncomingEmailSecretKey).toBe(false);
  });

  test("a master admin gets the key", async () => {
    mockIsMasterAdmin = true;

    await renderBuilder();

    expect(getItemCall().select["incomingEmailSecretKey"]).toBe(true);
    expect(canvas().canSeeIncomingEmailSecretKey).toBe(true);
  });

  test("a workflow with no key yet is handed down as an empty key the user may see, so the trigger can create one", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockGetItem.mockImplementation(async () => {
      const workflow: WorkflowModel = new WorkflowModel();
      workflow.graph = { nodes: [], edges: [] };

      return workflow;
    });

    await renderBuilder();

    expect(canvas().incomingEmailSecretKey).toBe("");
    expect(canvas().canSeeIncomingEmailSecretKey).toBe(true);
  });
});

describe("Reset address, from the Incoming Email trigger's settings", () => {
  test("saves a fresh key on the workflow at once and hands it down", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockUpdateById.mockImplementation(async () => {
      return {};
    });

    await renderBuilder();

    await act(async () => {
      await canvas().onResetIncomingEmailSecretKey!();
    });

    expect(mockUpdateById).toHaveBeenCalledTimes(1);

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = mockUpdateById.mock.calls[0]![0] as never;

    expect(update.modelType).toBe(WorkflowModel);
    expect(update.id.toString()).toBe(WORKFLOW_ID.toString());
    // The key alone: the graph is not re-saved alongside it.
    expect(Object.keys(update.data)).toEqual(["incomingEmailSecretKey"]);

    const newKey: string = update.data["incomingEmailSecretKey"] as string;

    expect(newKey).toMatch(UUID_V4);
    expect(newKey).not.toBe(EMAIL_SECRET);

    await waitFor(() => {
      expect(canvas().incomingEmailSecretKey).toBe(newKey);
    });
    expect(canvas().canSeeIncomingEmailSecretKey).toBe(true);
  });

  test("leaves the webhook key alone", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockUpdateById.mockImplementation(async () => {
      return {};
    });

    await renderBuilder();

    const webhookKey: string | undefined = canvas().webhookSecretKey;

    await act(async () => {
      await canvas().onResetIncomingEmailSecretKey!();
    });

    expect(canvas().webhookSecretKey).toBe(webhookKey);
  });

  test("a refused save is passed back for the trigger to show, and the old key stays", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockUpdateById.mockImplementation(async () => {
      throw new Error(
        "User is not allowed to update on incomingEmailSecretKey column of Workflow",
      );
    });

    await renderBuilder();

    let failure: unknown = null;

    await act(async () => {
      try {
        await canvas().onResetIncomingEmailSecretKey!();
      } catch (err) {
        failure = err;
      }
    });

    expect((failure as Error).message).toContain("is not allowed to update");
    expect(canvas().incomingEmailSecretKey).toBe(EMAIL_SECRET);
    expect(
      screen.queryByText(/is not allowed to update/),
    ).not.toBeInTheDocument();
  });
});

describe("where the key lives in the dashboard", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  const SOURCE_FILE: RegExp = /\.tsx?$/;
  const SELECTS_THE_KEY: RegExp = /incomingEmailSecretKey\s*:\s*true/;

  const sourceFiles: (dir: string) => Array<string> = (
    dir: string,
  ): Array<string> => {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "Locales" && entry.name !== "node_modules") {
          files.push(...sourceFiles(full));
        }
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
    }

    return files;
  };

  test("no dashboard page names the key in a select: it goes through getIncomingEmailSecretKeySelect", () => {
    const offenders: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
      (file: string) => {
        return SELECTS_THE_KEY.test(fs.readFileSync(file, "utf8"));
      },
    );

    expect(offenders).toEqual([]);
  });

  test("the Builder is the one place that saves a new key, through resetIncomingEmailSecretKey", () => {
    const writers: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
      (file: string) => {
        return fs
          .readFileSync(file, "utf8")
          .includes("resetIncomingEmailSecretKey");
      },
    );

    expect(
      writers.map((file: string) => {
        return path.relative(DASHBOARD_SRC, file);
      }),
    ).toEqual([path.join("Pages", "Workflow", "View", "Builder.tsx")]);
  });
});
