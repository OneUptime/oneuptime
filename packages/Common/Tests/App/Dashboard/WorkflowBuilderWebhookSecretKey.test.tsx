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
 * The workflow Builder page and the webhook secret key.
 *
 * The key used to be loaded, shown and reset by the workflow's Settings page.
 * It now belongs to the Webhook trigger, whose settings are drawn by the
 * builder's canvas, so the Builder page is what loads it and saves a new one.
 *
 * Pinned here, with the canvas replaced by a stand-in that records what it is
 * handed:
 *   - the page asks for the key only when the user may read it - an
 *     unreadable column in a select fails the whole request, and the builder
 *     would not open for a Viewer;
 *   - it tells the canvas whether the key could be read, so the trigger can
 *     say "hidden" rather than "no URL yet";
 *   - Reset URL saves a fresh key on the workflow at once and hands the new
 *     key down, and a failed save is passed back for the trigger to show.
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
let mockCanvasRenders: number = 0;

jest.mock("../../../UI/Components/Workflow/Workflow", () => {
  return {
    __esModule: true,
    default: (props: CanvasProps): React.ReactElement => {
      mockCanvasProps = props;
      mockCanvasRenders++;

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
const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";

const UUID_V4: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

type GetItemCallFunction = () => {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
};

const getItemCall: GetItemCallFunction = (): {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
} => {
  expect(mockGetItem).toHaveBeenCalledTimes(1);

  return mockGetItem.mock.calls[0]![0] as never;
};

type CanvasFunction = () => CanvasProps;

const canvas: CanvasFunction = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

type RenderBuilderFunction = () => Promise<void>;

const renderBuilder: RenderBuilderFunction = async (): Promise<void> => {
  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

beforeEach(() => {
  mockPermissions = [];
  mockIsMasterAdmin = false;
  mockCanvasProps = null;
  mockCanvasRenders = 0;
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

    workflow.graph = { nodes: [], edges: [] };

    if (request.select["webhookSecretKey"]) {
      if (
        !mockIsMasterAdmin &&
        !(mockPermissions as Array<Permission>).some(
          (permission: Permission) => {
            return [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.EditWorkflow,
            ].includes(permission);
          },
        )
      ) {
        throw new Error(
          "You do not have permissions to select on - webhookSecretKey.",
        );
      }

      workflow.webhookSecretKey = SECRET;
    }

    return workflow;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the builder loads the webhook secret key only for those who may see it", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])(
    "%s: the key is loaded with the graph and handed to the canvas",
    async (permission: Permission) => {
      mockPermissions = [permission];

      await renderBuilder();

      /*
       * The name names a run downloaded from the builder's run modal. The
       * incoming email key is read by the same people, for the Incoming
       * Email trigger (WorkflowBuilderIncomingEmailSecretKey.test.tsx).
       */
      expect(getItemCall().select).toEqual({
        graph: true,
        name: true,
        webhookSecretKey: true,
        incomingEmailSecretKey: true,
      });
      expect(getItemCall().id.toString()).toBe(WORKFLOW_ID.toString());
      expect(canvas().webhookSecretKey).toBe(SECRET);
      expect(canvas().canSeeWebhookSecretKey).toBe(true);
      expect(canvas().onResetWebhookSecretKey).toBeInstanceOf(Function);
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

      // Not even `webhookSecretKey: false`: the column is never named.
      expect(Object.keys(getItemCall().select)).toEqual(["graph", "name"]);
      expect(canvas().webhookSecretKey).toBe("");
      expect(canvas().canSeeWebhookSecretKey).toBe(false);
      expect(
        screen.queryByText(/permissions to select/),
      ).not.toBeInTheDocument();
    },
  );

  test("before the permission snapshot lands, it does not risk asking", async () => {
    mockPermissions = [];

    await renderBuilder();

    expect(Object.keys(getItemCall().select)).toEqual(["graph", "name"]);
    expect(canvas().canSeeWebhookSecretKey).toBe(false);
  });

  test("a master admin gets the key", async () => {
    mockIsMasterAdmin = true;

    await renderBuilder();

    expect(getItemCall().select["webhookSecretKey"]).toBe(true);
    expect(canvas().canSeeWebhookSecretKey).toBe(true);
  });

  test("a workflow with no key is handed down as an empty key the user may see", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockGetItem.mockImplementation(async () => {
      const workflow: WorkflowModel = new WorkflowModel();
      workflow.graph = { nodes: [], edges: [] };

      return workflow;
    });

    await renderBuilder();

    expect(canvas().webhookSecretKey).toBe("");
    expect(canvas().canSeeWebhookSecretKey).toBe(true);
  });
});

describe("Reset URL, from the Webhook trigger's settings", () => {
  test("saves a fresh key on the workflow at once and hands it down", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockUpdateById.mockImplementation(async () => {
      return {};
    });

    await renderBuilder();

    await act(async () => {
      await canvas().onResetWebhookSecretKey!();
    });

    expect(mockUpdateById).toHaveBeenCalledTimes(1);

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = mockUpdateById.mock.calls[0]![0] as never;

    expect(update.modelType).toBe(WorkflowModel);
    expect(update.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(Object.keys(update.data)).toEqual(["webhookSecretKey"]);

    const newKey: string = update.data["webhookSecretKey"] as string;

    expect(newKey).toMatch(UUID_V4);
    expect(newKey).not.toBe(SECRET);

    await waitFor(() => {
      expect(canvas().webhookSecretKey).toBe(newKey);
    });
    expect(canvas().canSeeWebhookSecretKey).toBe(true);
    // Saved on its own: the graph is not re-saved alongside it.
    expect(getItemCall()).toBeDefined();
  });

  test("a refused save is passed back for the trigger to show, and the old key stays", async () => {
    mockPermissions = [Permission.EditWorkflow];
    mockUpdateById.mockImplementation(async () => {
      throw new Error(
        "User is not allowed to update on webhookSecretKey column of Workflow",
      );
    });

    await renderBuilder();

    let failure: unknown = null;

    await act(async () => {
      try {
        await canvas().onResetWebhookSecretKey!();
      } catch (err) {
        failure = err;
      }
    });

    expect((failure as Error).message).toContain("is not allowed to update");
    expect(canvas().webhookSecretKey).toBe(SECRET);
    /*
     * The page's own error dialog stays shut: the trigger's confirmation is
     * still open and shows the reason itself.
     */
    expect(
      screen.queryByText(/is not allowed to update/),
    ).not.toBeInTheDocument();
  });

  test("each reset gives a different key", async () => {
    mockPermissions = [Permission.ProjectOwner];
    mockUpdateById.mockImplementation(async () => {
      return {};
    });

    await renderBuilder();

    await act(async () => {
      await canvas().onResetWebhookSecretKey!();
    });
    await act(async () => {
      await canvas().onResetWebhookSecretKey!();
    });

    const keys: Array<string> = mockUpdateById.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { data: Record<string, string> }).data[
          "webhookSecretKey"
        ] as string;
      },
    );

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(canvas().webhookSecretKey).toBe(keys[1]);
    expect(mockCanvasRenders).toBeGreaterThan(1);
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
  const SELECTS_THE_KEY: RegExp = /webhookSecretKey\s*:\s*true/;

  type SourceFilesFunction = (dir: string) => Array<string>;

  const sourceFiles: SourceFilesFunction = (dir: string): Array<string> => {
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

  test("no dashboard page names the key in a select: it goes through getWebhookSecretKeySelect", () => {
    /*
     * A page that asks for the column outright fails to load for everyone
     * who may not read it - every Viewer, for a page every Viewer can open.
     */
    const offenders: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
      (file: string) => {
        return SELECTS_THE_KEY.test(fs.readFileSync(file, "utf8"));
      },
    );

    expect(offenders).toEqual([]);
  });

  test("the workflow's Settings page no longer manages the key", () => {
    const settings: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Workflow", "View", "Settings.tsx"),
      "utf8",
    );

    expect(settings).not.toMatch(/webhookSecretKey\s*[:=]/);
    expect(settings).not.toContain("Reset Secret Key");
    expect(settings).not.toContain("Webhook Secret Key");
  });

  test("the Builder is the one place that saves a new key, through resetWebhookSecretKey", () => {
    const writers: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
      (file: string) => {
        return fs.readFileSync(file, "utf8").includes("resetWebhookSecretKey");
      },
    );

    expect(
      writers.map((file: string) => {
        return path.relative(DASHBOARD_SRC, file);
      }),
    ).toEqual([path.join("Pages", "Workflow", "View", "Builder.tsx")]);
  });
});
