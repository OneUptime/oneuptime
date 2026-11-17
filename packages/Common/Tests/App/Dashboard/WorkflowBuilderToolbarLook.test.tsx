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
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * THE BUILDER'S TOOLBAR AND ITS LOADING BOX ARE CARDS (#9194), on the real
 * Builder page.
 *
 * Both were drawn with inline styles of their own - 10px corners where a
 * card has 12px, a shadow no card has, colours read from CSS variables -
 * and its buttons came in two sizes: Undo, Redo and Version history small,
 * Add and Run Workflow normal, so the toolbar's controls were 30px and 38px
 * tall side by side. Now the toolbar and the loading box take the card's
 * frame (CARD_FRAME_CLASS_NAME), which the dark theme already draws, every
 * button in it is the shared Button at its normal size, and the loading box
 * is as tall as the canvas that takes its place.
 *
 * The canvas is a stand-in (Workflow.test.tsx tests the real one).
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
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

import Builder, {
  WORKFLOW_CANVAS_LOADING_CLASS_NAME,
  WORKFLOW_TOOLBAR_CLASS_NAME,
  WORKFLOW_TOOLBAR_GROUP_CLASS_NAME,
  WORKFLOW_TOOLBAR_RUN_GROUP_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { ButtonSize } from "../../../UI/Components/Button/Button";
import { CARD_FRAME_CLASS_NAME } from "../../../UI/Components/Card/Card";
import Navigation from "../../../UI/Utils/Navigation";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161019",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const BUILDER_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder.tsx",
  ),
  "utf8",
);

const UNDO_REDO_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../UI/Components/Workflow/WorkflowUndoRedoButtons.tsx",
  ),
  "utf8",
);

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return element.className.split(/\s+/u).filter(Boolean);
};

const expectClasses: (element: Element, classNames: string) => void = (
  element: Element,
  classNames: string,
): void => {
  const has: Array<string> = classesOf(element);

  for (const className of classNames.split(/\s+/u).filter(Boolean)) {
    expect(has).toContain(className);
  }
};

const renderBuilder: () => Promise<void> = async (): Promise<void> => {
  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    workflow.graph = { nodes: [], edges: [] } as never;
    workflow.name = "Page the on-call";
    workflow.isEnabled = true;

    return workflow;
  });

  render(<Builder {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

beforeEach(() => {
  mockGetItem.mockReset();
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Workflow builder's toolbar", () => {
  test("is drawn in a card's frame, with Tailwind classes and no inline style", async () => {
    await renderBuilder();

    const toolbar: HTMLElement = screen.getByTestId("workflow-toolbar");

    expectClasses(toolbar, CARD_FRAME_CLASS_NAME);
    expect(toolbar.className).toBe(WORKFLOW_TOOLBAR_CLASS_NAME);
    expect(toolbar.getAttribute("style")).toBeNull();

    for (const testId of [
      "workflow-toolbar-history",
      "workflow-toolbar-run",
      "workflow-toolbar-buttons",
    ]) {
      expect(screen.getByTestId(testId).getAttribute("style")).toBeNull();
    }

    expectClasses(
      screen.getByTestId("workflow-toolbar-history"),
      WORKFLOW_TOOLBAR_GROUP_CLASS_NAME,
    );
    expectClasses(
      screen.getByTestId("workflow-toolbar-buttons"),
      WORKFLOW_TOOLBAR_GROUP_CLASS_NAME,
    );
    expectClasses(
      screen.getByTestId("workflow-toolbar-run"),
      WORKFLOW_TOOLBAR_RUN_GROUP_CLASS_NAME,
    );
  });

  test("its rows wrap a whole control at a time, so a phone keeps every button whole", () => {
    for (const className of [
      WORKFLOW_TOOLBAR_CLASS_NAME,
      WORKFLOW_TOOLBAR_GROUP_CLASS_NAME,
      WORKFLOW_TOOLBAR_RUN_GROUP_CLASS_NAME,
    ]) {
      expect(className.split(" ")).toContain("flex-wrap");
    }
  });

  test("every button in it is the shared Button at the one normal size", async () => {
    await renderBuilder();

    const toolbar: HTMLElement = screen.getByTestId("workflow-toolbar");
    const buttons: Array<HTMLButtonElement> = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>(
        "[data-testid='workflow-undo-button'], [data-testid='workflow-redo-button'], [data-testid='workflow-version-history-button'], [data-testid='workflow-add-button'], [data-testid='run-workflow-button']",
      ),
    );

    expect(buttons).toHaveLength(5);

    for (const button of buttons) {
      const classes: Array<string> = classesOf(button);

      // The shared frame: the same corners, words and focus ring.
      expect(classes).toContain("rounded-md");
      expect(classes).toContain("focus-visible:ring-2");
      // The normal size: py-2 with words, p-2 round an icon alone.
      expect(classes.includes("py-2") || classes.includes("p-2")).toBe(true);
      expect(classes).not.toContain("py-1");
      expect(classes).not.toContain("p-1");
    }
  });

  test("nothing in it asks for the small size or an inline style", () => {
    expect(BUILDER_SOURCE).not.toMatch(/ButtonSize\.Small/u);
    expect(UNDO_REDO_SOURCE).not.toMatch(/ButtonSize\.Small/u);
    expect(BUILDER_SOURCE).not.toMatch(/borderRadius/u);
    expect(BUILDER_SOURCE).not.toMatch(/style=\{\{/u);
    expect(ButtonSize.Normal).toBe("px-3 py-2");
  });
});

describe("the canvas's loading box", () => {
  test("is a card as tall as the canvas that takes its place", async () => {
    let answer: (workflow: WorkflowModel) => void = (): void => {};

    mockGetItem.mockImplementation(() => {
      return new Promise<WorkflowModel>(
        (resolve: (workflow: WorkflowModel) => void) => {
          answer = resolve;
        },
      );
    });

    render(<Builder {...PAGE_PROPS} />);

    const box: HTMLElement = await screen.findByTestId(
      "workflow-canvas-loading",
    );

    expect(box.className).toBe(WORKFLOW_CANVAS_LOADING_CLASS_NAME);
    expectClasses(box, CARD_FRAME_CLASS_NAME);
    expect(box.getAttribute("style")).toBeNull();
    // The canvas's own height (Workflow: calc(100vh - 220px), 400px at least).
    expect(classesOf(box)).toContain("h-[calc(100vh-220px)]");
    expect(classesOf(box)).toContain("min-h-[400px]");

    const workflow: WorkflowModel = new WorkflowModel();
    workflow.graph = { nodes: [], edges: [] } as never;
    answer(workflow);

    await waitFor(() => {
      expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("workflow-canvas-loading"),
    ).not.toBeInTheDocument();
  });
});
