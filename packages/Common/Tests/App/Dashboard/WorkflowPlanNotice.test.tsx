import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __workflowPlanNoticeConfig: MutableConfig }
).__workflowPlanNoticeConfig = config;

/*
 * BILLING_ENABLED is read when the module loads, so it is a getter here,
 * switchable per test: a self-hosted install has no plans, and the notice
 * says nothing there. CI runs with billing on, a local run with it off -
 * these pass either way.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __workflowPlanNoticeConfig: MutableConfig | undefined;
          }
        ).__workflowPlanNoticeConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

let mockPermissions: Array<string> = ["ProjectAdmin"];

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
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

let mockWorkflowIsEnabled: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        const workflowModule: {
          default: new () => Record<string, unknown>;
        } = jest.requireActual("../../../Models/DatabaseModels/Workflow") as {
          default: new () => Record<string, unknown>;
        };
        const workflow: Record<string, unknown> = new workflowModule.default();

        workflow["graph"] = {
          nodes: [
            {
              id: "canvas-manual-1",
              type: "node",
              position: { x: 160, y: 64 },
              data: {
                id: "manual-1",
                nodeType: "Node",
                componentType: "Trigger",
                metadataId: "manual",
              },
            },
          ],
          edges: [],
        };
        workflow["name"] = "Page the on-call";
        workflow["isEnabled"] = mockWorkflowIsEnabled;

        return workflow;
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

jest.mock("../../../UI/Components/Workflow/Workflow", () => {
  return {
    __esModule: true,
    default: (_props: CanvasProps): React.ReactElement => {
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

import WorkflowPlanNotice, {
  WORKFLOW_PLAN_NOTICE_TEST_ID,
  WorkflowPlanNoticeCopy,
  doesCurrentPlanRunWorkflows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowPlanNotice";
import Builder from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * WORKFLOWS DO NOT RUN ON THIS PROJECT'S PLAN
 * (Components/Workflow/WorkflowPlanNotice).
 *
 * On OneUptime Cloud the Free plan runs no workflows: every run is refused,
 * Run Workflow's included. A Free project could build workflows and turn
 * them on with nothing saying none would ever run. The Builder and the
 * Workflows page now say it, with the way out - the Billing page. Nothing
 * is said where billing is off (every self-hosted install), where the plan
 * cannot be told, or on a plan that runs workflows.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const WORKFLOWS_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Workflow",
  "Workflows.tsx",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

let currentPlan: PlanType | null = null;

beforeEach(() => {
  config.billingEnabled = true;
  currentPlan = PlanType.Free;
  mockPermissions = ["ProjectAdmin"];
  mockWorkflowIsEnabled = false;

  jest.spyOn(ProjectUtil, "getCurrentPlan").mockImplementation(() => {
    return config.billingEnabled ? currentPlan : null;
  });
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194161009"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderNotice: () => void = (): void => {
  render(
    <MemoryRouter>
      <WorkflowPlanNotice />
    </MemoryRouter>,
  );
};

describe("the notice", () => {
  test("on the Free plan, says workflows do not run, naming the plan, and links to Billing", () => {
    renderNotice();

    const notice: HTMLElement = screen.getByTestId(
      WORKFLOW_PLAN_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(WorkflowPlanNoticeCopy.title);
    expect(notice).toHaveTextContent(
      "This project is on the Free plan, so nothing starts a workflow, not even Run Workflow. Upgrade to the Growth plan or above to run workflows.",
    );

    const link: HTMLElement = screen.getByTestId(
      `${WORKFLOW_PLAN_NOTICE_TEST_ID}-upgrade`,
    );

    expect(link).toHaveTextContent(WorkflowPlanNoticeCopy.upgrade);
    expect(link).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_BILLING] as Route,
      ).toString(),
    );
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan, which runs workflows, says nothing",
    (plan: PlanType) => {
      currentPlan = plan;

      renderNotice();

      expect(
        screen.queryByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(doesCurrentPlanRunWorkflows()).toBe(true);
    },
  );

  test("with billing off, as on every self-hosted install, says nothing", () => {
    config.billingEnabled = false;

    renderNotice();

    expect(
      screen.queryByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(doesCurrentPlanRunWorkflows()).toBe(true);
  });

  test("when the plan cannot be told, says nothing: the server has the last word", () => {
    currentPlan = null;

    renderNotice();

    expect(
      screen.queryByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("is a warning to act on, not an info banner", () => {
    renderNotice();

    expect(
      screen.getByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID).className,
    ).toContain("amber");
  });
});

describe("on the Builder", () => {
  const renderBuilder: () => Promise<void> = async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Builder {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
    });
  };

  test("a Free project's off workflow with a trigger is told its plan, not to turn it on", async () => {
    await renderBuilder();

    expect(
      screen.getByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    // Turning it on would start nothing: one notice at a time.
    expect(
      screen.queryByTestId("workflow-turned-off-notice"),
    ).not.toBeInTheDocument();
  });

  test("a Free project's workflow that is on is told too", async () => {
    mockWorkflowIsEnabled = true;

    await renderBuilder();

    expect(
      screen.getByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("on a plan that runs workflows, an off workflow gets the off notice, as before", async () => {
    currentPlan = PlanType.Growth;

    await renderBuilder();

    expect(
      screen.queryByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });

  test("with billing off, an off workflow gets the off notice, as before", async () => {
    config.billingEnabled = false;

    await renderBuilder();

    expect(
      screen.queryByTestId(WORKFLOW_PLAN_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-turned-off-notice"),
    ).toBeInTheDocument();
  });
});

describe("on the Workflows page", () => {
  test("the list draws the notice above itself", () => {
    const source: string = fs.readFileSync(WORKFLOWS_PAGE, "utf8");

    expect(source).toContain(
      'import WorkflowPlanNotice from "../../Components/Workflow/WorkflowPlanNotice";',
    );
    expect(source.indexOf("<WorkflowPlanNotice")).toBeGreaterThan(-1);
    expect(source.indexOf("<WorkflowPlanNotice")).toBeLessThan(
      source.indexOf("<ModelTable<Workflow>"),
    );
  });
});

describe("the words", () => {
  test("every Dashboard language has them, translated", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      for (const key of [
        WorkflowPlanNoticeCopy.title,
        WorkflowPlanNoticeCopy.body,
        WorkflowPlanNoticeCopy.upgrade,
      ]) {
        const value: string | undefined = locale[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect([file, key, value === key]).toEqual([file, key, false]);
        }
      }

      // The body keeps both of its slots, once each.
      const body: string = locale[WorkflowPlanNoticeCopy.body] as string;

      expect([file, body.split("{{plan}}").length - 1]).toEqual([file, 1]);
      expect([file, body.split("{{upgradeLink}}").length - 1]).toEqual([
        file,
        1,
      ]);
    }
  });
});
