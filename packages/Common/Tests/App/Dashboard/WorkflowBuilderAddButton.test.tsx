import {
  afterEach,
  beforeAll,
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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as CanvasProps } from "../../../UI/Components/Workflow/Workflow";

/*
 * The Builder toolbar's add button: Add Trigger while the workflow has no
 * trigger, Add Component once it has one.
 *
 * "When there are no triggers on the form, the Add Component button should
 * say 'Add Trigger' so it's easier for people to use and understand." - the
 * maintainer.
 *
 * The real Builder page is rendered; the canvas is a stand-in that hands the
 * test its props, so the test can report graphs the way the canvas does
 * (onWorkflowUpdated) and see what the button asks of it
 * (showComponentsPickerModal). Which panel the canvas then opens is tested
 * on the real canvas: Workflow.test.tsx, and with this page in
 * WorkflowBuilderAddButtonCanvas.test.tsx.
 */

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

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<unknown> => {
        return { data: {} };
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string } | null)?.message || "Server Error";
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
    // The dashed card, as the canvas module builds it.
    getPlaceholderTriggerNode: (): Record<string, unknown> => {
      return {
        id: "placeholder",
        type: "node",
        position: { x: 100, y: 100 },
        data: {
          nodeType: "PlaceholderNode",
          metadata: { componentType: "Trigger" },
        },
      };
    },
  };
});

import Builder from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import WorkflowModel from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { buildGraphForTemplate } from "../../../Types/Workflow/Templates";
import Navigation from "../../../UI/Utils/Navigation";
import { Edge, Node as FlowNode } from "reactflow";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161003",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/workflows/builder"),
  currentProject: null,
  hasPaymentMethod: false,
};

const ADD_BUTTON_TEST_ID: string = "workflow-add-button";

type GraphNodeFunction = (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
}) => JSONObject;

// A step as a saved graph stores it.
const graphNode: GraphNodeFunction = (data: {
  id: string;
  metadataId: string;
  componentType: ComponentType;
}): JSONObject => {
  return {
    id: `canvas-${data.id}`,
    type: "node",
    position: { x: 0, y: 0 },
    data: {
      id: data.id,
      internalId: `runner-${data.id}`,
      nodeType: NodeType.Node,
      componentType: data.componentType,
      metadataId: data.metadataId,
      error: "",
      arguments: {},
      returnValues: {},
    },
  };
};

const WEBHOOK_TRIGGER: JSONObject = graphNode({
  id: "webhook-1",
  metadataId: "webhook",
  componentType: ComponentType.Trigger,
});

const IF_ELSE_STEP: JSONObject = graphNode({
  id: "if-else-1",
  metadataId: "if-else",
  componentType: ComponentType.Component,
});

// The dashed card, as a graph saved before it was replaced keeps it.
const SAVED_PLACEHOLDER: JSONObject = {
  id: "saved-placeholder",
  type: "node",
  position: { x: 100, y: 100 },
  data: {
    id: "",
    internalId: "",
    metadataId: "",
    nodeType: NodeType.PlaceholderNode,
    error: "",
  },
};

interface StoredWorkflow {
  isEnabled: boolean;
  isArchived: boolean;
  graph: JSONObject | undefined;
}

let stored: StoredWorkflow = {
  isEnabled: false,
  isArchived: false,
  graph: { nodes: [], edges: [] },
};

type CanvasFunction = () => CanvasProps;

const canvas: CanvasFunction = (): CanvasProps => {
  if (!mockCanvasProps) {
    throw new Error("Expected the builder to draw its canvas.");
  }

  return mockCanvasProps;
};

type RenderBuilderFunction = (wrap?: { i18n: i18n }) => Promise<void>;

const renderBuilder: RenderBuilderFunction = async (wrap?: {
  i18n: i18n;
}): Promise<void> => {
  render(
    wrap ? (
      <I18nextProvider i18n={wrap.i18n}>
        <Builder {...PAGE_PROPS} />
      </I18nextProvider>
    ) : (
      <Builder {...PAGE_PROPS} />
    ),
  );

  await waitFor(() => {
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });
};

type AddButtonFunction = () => HTMLElement;

const addButton: AddButtonFunction = (): HTMLElement => {
  return screen.getByTestId(ADD_BUTTON_TEST_ID);
};

type ExpectButtonFunction = (name: string) => void;

// The toolbar's add button, and only it, says this.
const expectAddButtonToSay: ExpectButtonFunction = (name: string): void => {
  expect(addButton()).toHaveTextContent(name);
  expect(addButton()).toHaveAccessibleName(name);
  expect(screen.getByRole("button", { name: name, exact: true })).toBe(
    addButton(),
  );

  const other: string =
    name === "Add Trigger" ? "Add Component" : "Add Trigger";

  expect(screen.queryByRole("button", { name: other, exact: true })).toBeNull();
};

type ReportFunction = (nodes: Array<JSONObject>) => Promise<void>;

// What the canvas does after every change: it reports the graph it now has.
const canvasReports: ReportFunction = async (
  nodes: Array<JSONObject>,
): Promise<void> => {
  await act(async () => {
    canvas().onWorkflowUpdated(
      nodes as unknown as Array<FlowNode>,
      [] as Array<Edge>,
    );
  });
};

beforeEach(() => {
  mockCanvasProps = null;
  mockPermissions = [Permission.ProjectAdmin];
  stored = {
    isEnabled: false,
    isArchived: false,
    graph: { nodes: [], edges: [] },
  };
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockUpdateById.mockReset();

  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(WORKFLOW_ID);

  mockGetItem.mockImplementation(async () => {
    const workflow: WorkflowModel = new WorkflowModel();

    if (stored.graph) {
      // A copy: the Builder fills in what it loads.
      workflow.graph = JSON.parse(JSON.stringify(stored.graph)) as JSONObject;
    }

    workflow.name = "Notify on-call";
    workflow.isEnabled = stored.isEnabled;
    workflow.isArchived = stored.isArchived;

    return workflow;
  });

  mockUpdateById.mockImplementation(async () => {
    return {};
  });

  mockGetList.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 1 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Builder's add button on a workflow with no trigger says Add Trigger", () => {
  test("a workflow from scratch, whose graph is empty", async () => {
    stored.graph = { nodes: [], edges: [] };

    await renderBuilder();

    expectAddButtonToSay("Add Trigger");
    // The canvas starts on the dashed card.
    expect(
      canvas().initialNodes.map((node: FlowNode) => {
        return node.data.nodeType;
      }),
    ).toEqual([NodeType.PlaceholderNode]);
  });

  test("a workflow saved without a graph", async () => {
    stored.graph = undefined;

    await renderBuilder();

    expectAddButtonToSay("Add Trigger");
  });

  test("a workflow whose trigger was deleted: its steps, and the dashed card the Builder adds beside them", async () => {
    stored.graph = { nodes: [IF_ELSE_STEP], edges: [] };

    await renderBuilder();

    expectAddButtonToSay("Add Trigger");
    expect(
      canvas().initialNodes.map((node: FlowNode) => {
        return node.data.nodeType;
      }),
    ).toEqual([NodeType.Node, NodeType.PlaceholderNode]);
  });

  test("a workflow saved with the dashed card still in its graph", async () => {
    stored.graph = { nodes: [SAVED_PLACEHOLDER, IF_ELSE_STEP], edges: [] };

    await renderBuilder();

    expectAddButtonToSay("Add Trigger");
  });

  test("turned off, on or archived, it names what the workflow needs all the same", async () => {
    for (const state of [
      { isEnabled: false, isArchived: false },
      { isEnabled: true, isArchived: false },
      { isEnabled: false, isArchived: true },
    ]) {
      stored = { ...state, graph: { nodes: [], edges: [] } };

      await renderBuilder();

      expectAddButtonToSay("Add Trigger");
      cleanup();
    }
  });

  test("for a Workflow Member and for someone who may only read the workflow, too", async () => {
    for (const permissions of [
      [Permission.WorkflowMember, Permission.ReadWorkflow],
      [Permission.ProjectMember, Permission.ReadWorkflow],
    ]) {
      mockPermissions = permissions;

      await renderBuilder();

      expectAddButtonToSay("Add Trigger");
      cleanup();
    }
  });
});

describe("the Builder's add button once the workflow has a trigger says Add Component", () => {
  test("a workflow with a trigger and a step", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER, IF_ELSE_STEP], edges: [] };

    await renderBuilder();

    expectAddButtonToSay("Add Component");
    // No dashed card: the workflow has its trigger.
    expect(
      canvas().initialNodes.some((node: FlowNode) => {
        return node.data.nodeType === NodeType.PlaceholderNode;
      }),
    ).toBe(false);
  });

  test("a workflow made from a template opens with its trigger, and Add Component", async () => {
    let counter: number = 0;

    stored.graph =
      buildGraphForTemplate("incident-created-slack", (): string => {
        counter++;
        return `0198c8ec-2a1d-7f0c-9e75-${String(counter).padStart(12, "0")}`;
      }) || undefined;

    expect(stored.graph).toBeDefined();

    await renderBuilder();

    expectAddButtonToSay("Add Component");
  });
});

describe("the Builder's add button follows the canvas at once", () => {
  test("the first trigger added: Add Component", async () => {
    await renderBuilder();
    expectAddButtonToSay("Add Trigger");

    await canvasReports([WEBHOOK_TRIGGER]);

    expectAddButtonToSay("Add Component");
  });

  test("the last trigger deleted, and the dashed card back: Add Trigger", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER, IF_ELSE_STEP], edges: [] };

    await renderBuilder();
    expectAddButtonToSay("Add Component");

    await canvasReports([
      IF_ELSE_STEP,
      {
        id: "placeholder",
        data: { nodeType: NodeType.PlaceholderNode },
      },
    ]);

    expectAddButtonToSay("Add Trigger");
  });

  test("back and forth, as the trigger is chosen, deleted and chosen again", async () => {
    await renderBuilder();

    for (const [nodes, name] of [
      [[WEBHOOK_TRIGGER], "Add Component"],
      [[IF_ELSE_STEP], "Add Trigger"],
      [[WEBHOOK_TRIGGER, IF_ELSE_STEP], "Add Component"],
      [[], "Add Trigger"],
    ] as Array<[Array<JSONObject>, string]>) {
      await canvasReports(nodes);

      expectAddButtonToSay(name);
    }
  });

  test("a step added or moved changes nothing while the trigger stays", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER], edges: [] };

    await renderBuilder();

    await canvasReports([WEBHOOK_TRIGGER, IF_ELSE_STEP]);
    expectAddButtonToSay("Add Component");

    await canvasReports([
      { ...WEBHOOK_TRIGGER, position: { x: 320, y: 48 } },
      IF_ELSE_STEP,
    ]);
    expectAddButtonToSay("Add Component");
  });
});

describe("pressing the Builder's add button", () => {
  test("asks the canvas for the panel, which reads its own nodes to open the one the button names", async () => {
    await renderBuilder();

    expect(canvas().showComponentsPickerModal).toBe(false);

    fireEvent.click(addButton());

    expect(canvas().showComponentsPickerModal).toBe(true);
  });

  test("once the canvas says the panel closed, pressing it asks again", async () => {
    await renderBuilder();

    fireEvent.click(addButton());
    expect(canvas().showComponentsPickerModal).toBe(true);

    await act(async () => {
      canvas().onComponentPickerModalUpdate(false);
    });
    expect(canvas().showComponentsPickerModal).toBe(false);

    fireEvent.click(addButton());
    expect(canvas().showComponentsPickerModal).toBe(true);
  });

  test("works the same once it says Add Component", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER], edges: [] };

    await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Add Component" }));

    expect(canvas().showComponentsPickerModal).toBe(true);
  });
});

/*
 * UI review: while the workflow has no trigger, choosing one is the only
 * thing to do first, so Add Trigger is the page's one primary button. Once
 * it has one, Add Component is a plain bordered button like the product's
 * other Create and Add buttons - it used to be a borderless one with no
 * hover that read like a label beside the Enabled switch.
 */
const PRIMARY_FILL: string = "bg-indigo-600";
const PLAIN_FILL: string = "bg-white";
const PLAIN_BORDER: string = "border-gray-300";

type ClassesFunction = (element: HTMLElement) => Array<string>;

const classesOf: ClassesFunction = (element: HTMLElement): Array<string> => {
  return Array.from(element.classList);
};

type ExpectStyleFunction = () => void;

const expectAddTriggerToBePrimary: ExpectStyleFunction = (): void => {
  expect(classesOf(addButton())).toContain(PRIMARY_FILL);
  expect(classesOf(addButton())).toContain("text-white");
  expect(classesOf(addButton())).not.toContain(PLAIN_FILL);
};

const expectAddComponentToBePlain: ExpectStyleFunction = (): void => {
  expect(classesOf(addButton())).toContain(PLAIN_FILL);
  expect(classesOf(addButton())).toContain(PLAIN_BORDER);
  expect(classesOf(addButton())).not.toContain(PRIMARY_FILL);
};

type PrimaryButtonsFunction = () => Array<HTMLElement>;

// Every button on the page drawn as a primary one.
const primaryButtons: PrimaryButtonsFunction = (): Array<HTMLElement> => {
  return screen.getAllByRole("button").filter((button: HTMLElement) => {
    return classesOf(button).includes(PRIMARY_FILL);
  });
};

describe("the Builder's add button: the page's primary button until the workflow has a trigger", () => {
  test("Add Trigger is drawn as the primary button on a workflow with no trigger", async () => {
    await renderBuilder();

    expectAddButtonToSay("Add Trigger");
    expectAddTriggerToBePrimary();
  });

  test("Add Component is a plain bordered button once the workflow has a trigger", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER, IF_ELSE_STEP], edges: [] };

    await renderBuilder();

    expectAddButtonToSay("Add Component");
    expectAddComponentToBePlain();
  });

  test("it changes with the label: plain once the first trigger is in, primary again when the last one goes", async () => {
    await renderBuilder();
    expectAddTriggerToBePrimary();

    await canvasReports([WEBHOOK_TRIGGER]);
    expectAddButtonToSay("Add Component");
    expectAddComponentToBePlain();

    await canvasReports([IF_ELSE_STEP]);
    expectAddButtonToSay("Add Trigger");
    expectAddTriggerToBePrimary();
  });

  test("a workflow from scratch that is off has one primary button, Add Trigger", async () => {
    stored = {
      isEnabled: false,
      isArchived: false,
      graph: { nodes: [], edges: [] },
    };

    await renderBuilder();

    expect(primaryButtons()).toEqual([addButton()]);
  });

  test("once it has a trigger, the primary button is the notice's Turn on workflow, not Add Component", async () => {
    stored = {
      isEnabled: false,
      isArchived: false,
      graph: { nodes: [WEBHOOK_TRIGGER], edges: [] },
    };

    await renderBuilder();

    expect(primaryButtons()).toEqual([
      screen.getByTestId("workflow-turn-on-button"),
    ]);
  });

  test("the same plus, and one line on a phone, in both of its names", async () => {
    await renderBuilder();

    const asTrigger: { icon: string; isOneLine: boolean } = {
      icon: addButton().querySelector("svg")?.outerHTML || "",
      isOneLine: classesOf(addButton()).includes("whitespace-nowrap"),
    };

    await canvasReports([WEBHOOK_TRIGGER]);

    const asComponent: { icon: string; isOneLine: boolean } = {
      icon: addButton().querySelector("svg")?.outerHTML || "",
      isOneLine: classesOf(addButton()).includes("whitespace-nowrap"),
    };

    expect(asTrigger.icon).not.toBe("");
    expect(asComponent).toEqual(asTrigger);
    expect(asTrigger.isOneLine).toBe(true);
  });

  test("neither toolbar button keeps a left margin of its own, so one that starts a wrapped row lines up with the switch above it", async () => {
    for (const graph of [
      { nodes: [], edges: [] },
      { nodes: [WEBHOOK_TRIGGER], edges: [] },
    ]) {
      stored.graph = graph;

      await renderBuilder();

      for (const button of [
        addButton(),
        screen.getByTestId("run-workflow-button"),
      ]) {
        // The button's md:ml-3 is there, and the inline margin overrides it.
        expect(classesOf(button)).toContain("md:ml-3");
        expect(button.style.marginInlineStart).toBe("0px");
      }

      cleanup();
    }
  });

  test("it stays where Add Component always was: after the Enabled switch, before Run Workflow", async () => {
    await renderBuilder();

    const toolbar: Array<HTMLElement> = [
      screen.getByRole("switch", { name: "Enabled" }),
      addButton(),
      screen.getByTestId("run-workflow-button"),
    ];

    for (let index: number = 1; index < toolbar.length; index++) {
      expect(
        toolbar[index - 1]!.compareDocumentPosition(toolbar[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

/*
 * UI review: the off notice says the workflow's trigger is paused and that
 * Run Workflow still tests it - neither is true of a workflow with nothing to
 * start it - and its Turn on workflow would be a second primary button
 * beside Add Trigger. So it waits for the first trigger.
 */
describe("the off notice waits for the workflow's first trigger", () => {
  type NoticeFunction = () => HTMLElement | null;

  const notice: NoticeFunction = (): HTMLElement | null => {
    return screen.queryByTestId("workflow-turned-off-notice");
  };

  test("a workflow from scratch that is off: no notice, the switch says off, and Add Trigger", async () => {
    stored = {
      isEnabled: false,
      isArchived: false,
      graph: { nodes: [], edges: [] },
    };

    await renderBuilder();

    expect(notice()).toBeNull();
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expectAddButtonToSay("Add Trigger");
  });

  test("a workflow whose trigger was deleted, with its steps left: no notice", async () => {
    stored = {
      isEnabled: false,
      isArchived: false,
      graph: { nodes: [IF_ELSE_STEP], edges: [] },
    };

    await renderBuilder();

    expect(notice()).toBeNull();
  });

  test("the first trigger brings it, saying the workflow is off", async () => {
    await renderBuilder();
    expect(notice()).toBeNull();

    await canvasReports([WEBHOOK_TRIGGER]);

    expect(notice()).not.toBeNull();
    expect(notice()).toHaveTextContent("This workflow is off");
    expect(
      screen.getByTestId("workflow-turned-off-notice-body"),
    ).toHaveTextContent(
      "Its trigger is paused until you turn it on. You can still test it with Run Workflow.",
    );
  });

  test("deleting the last trigger takes it away again, and a new one brings it back", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER, IF_ELSE_STEP], edges: [] };

    await renderBuilder();
    expect(notice()).not.toBeNull();

    await canvasReports([IF_ELSE_STEP]);
    expect(notice()).toBeNull();

    await canvasReports([WEBHOOK_TRIGGER, IF_ELSE_STEP]);
    expect(notice()).not.toBeNull();
  });

  test("an off workflow with a trigger shows it as soon as it loads", async () => {
    stored = {
      isEnabled: false,
      isArchived: false,
      graph: { nodes: [WEBHOOK_TRIGGER], edges: [] },
    };

    await renderBuilder();

    expect(notice()).not.toBeNull();
    expect(screen.getByTestId("workflow-turn-on-button")).toBeInTheDocument();
  });

  test("on, or archived, there is no notice, trigger or not", async () => {
    for (const state of [
      { isEnabled: true, isArchived: false },
      { isEnabled: false, isArchived: true },
    ]) {
      for (const graph of [
        { nodes: [], edges: [] },
        { nodes: [WEBHOOK_TRIGGER], edges: [] },
      ]) {
        stored = { ...state, graph: graph };

        await renderBuilder();

        expect(notice()).toBeNull();
        cleanup();
      }
    }
  });

  test("the notice is not drawn while the workflow loads", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER], edges: [] };

    let finishLoading: () => void = (): void => {};
    const loaded: Promise<void> = new Promise<void>((resolve: () => void) => {
      finishLoading = resolve;
    });
    const load: (...args: Array<unknown>) => unknown =
      mockGetItem.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;

    mockGetItem.mockImplementation(async (...args: Array<unknown>) => {
      await loaded;
      return load(...args);
    });

    render(<Builder {...PAGE_PROPS} />);

    expect(notice()).toBeNull();

    await act(async () => {
      finishLoading();
    });

    await waitFor(() => {
      expect(notice()).not.toBeNull();
    });
  });
});

describe("the Builder's add button while the workflow loads", () => {
  test("is not drawn until the graph is in: it would say Add Trigger for a workflow that has a trigger", async () => {
    stored.graph = { nodes: [WEBHOOK_TRIGGER, IF_ELSE_STEP], edges: [] };

    let finishLoading: () => void = (): void => {};
    const loaded: Promise<void> = new Promise<void>((resolve: () => void) => {
      finishLoading = resolve;
    });
    const load: (...args: Array<unknown>) => unknown =
      mockGetItem.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;

    mockGetItem.mockImplementation(async (...args: Array<unknown>) => {
      await loaded;
      return load(...args);
    });

    render(<Builder {...PAGE_PROPS} />);

    // The toolbar is there, with Run Workflow, but no add button of either name.
    expect(screen.getByTestId("run-workflow-button")).toBeInTheDocument();
    expect(screen.queryByTestId(ADD_BUTTON_TEST_ID)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Trigger" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Component" })).toBeNull();

    await act(async () => {
      finishLoading();
    });

    await waitFor(() => {
      expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
    });

    expectAddButtonToSay("Add Component");
  });

  test("a workflow that could not be read still gets a button: Add Trigger, for the empty canvas", async () => {
    mockGetItem.mockImplementation(async () => {
      return null;
    });

    await renderBuilder();

    // The error dialog is open over the page, so read the button itself.
    expect(addButton()).toHaveTextContent("Add Trigger");
    expect(canvas().initialNodes).toEqual([]);
  });
});

/*
 * The button in every language the Dashboard speaks, with its real locale
 * files: never the English of either name.
 */
describe("the Builder's add button in the Dashboard's languages", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(".json", "");
    })
    .sort();

  const instances: Record<string, i18n> = {};
  const locales: Record<string, Record<string, string>> = {};

  beforeAll(async () => {
    for (const language of LANGUAGES) {
      locales[language] = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, string>;

      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: language,
        resources: { [language]: { translation: locales[language]! } },
        interpolation: { escapeValue: false },
      });

      instances[language] = instance;
    }
  });

  test("every Dashboard language is read", () => {
    expect(LANGUAGES).toHaveLength(16);
    expect(LANGUAGES).toContain("de");
    expect(LANGUAGES).toContain("zh-TW");
  });

  test.each([
    "da",
    "de",
    "es",
    "fa",
    "fr",
    "hi",
    "it",
    "ja",
    "ko",
    "nl",
    "no",
    "pt",
    "ru",
    "sv",
    "zh-CN",
    "zh-TW",
  ])(
    "%s: the button says its language's Add Trigger, then its Add Component",
    async (language: string) => {
      const addTrigger: string = locales[language]!["Add Trigger"] as string;
      const addComponent: string = locales[language]![
        "Add Component"
      ] as string;

      // A translation, not the English.
      expect({ language, addTrigger }).not.toEqual({
        language,
        addTrigger: "Add Trigger",
      });
      expect({ language, addComponent }).not.toEqual({
        language,
        addComponent: "Add Component",
      });

      await renderBuilder({ i18n: instances[language]! });

      expect(addButton()).toHaveTextContent(addTrigger);
      expect(addButton()).not.toHaveTextContent("Add Trigger");

      await canvasReports([WEBHOOK_TRIGGER]);

      expect(addButton()).toHaveTextContent(addComponent);
      expect(addButton()).not.toHaveTextContent("Add Component");
    },
  );

  test("German, word for word", async () => {
    await renderBuilder({ i18n: instances["de"]! });

    expect(addButton()).toHaveTextContent("Auslöser hinzufügen");

    await canvasReports([WEBHOOK_TRIGGER]);

    expect(addButton()).toHaveTextContent("Komponente hinzufügen");
  });
});
