import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO A TEMPLATE PAGES, ASKED IN THE CREATE WIZARD.
 *
 * A template that pages people has a Page step no template can fill in:
 * the people, teams, schedules and policies are the project's own. It used
 * to be left for the Builder, where the new workflow opened with an error
 * on the step - "1 error" on a fresh "Zabbix problems to incidents", the
 * maintainer's screenshot. The wizard now asks, on its Configure step, with
 * the people picker the Builder draws for the step, and the workflow is
 * created with who was picked: it opens with no error.
 *
 * The dialog, its picker and its search list are the real thing; only the
 * API is stood in for: the project's on-call policies, schedules, teams and
 * people, and the create the dialog makes.
 */

const getListMock: jest.Mock<(...args: Array<any>) => Promise<unknown>> =
  jest.fn<(...args: Array<any>) => Promise<unknown>>();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      deleteItem: jest.fn(),
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: jest.fn((error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      }),
    },
  };
});

import CreateWorkflowModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal";
import { WHO_TO_PAGE_REQUIRED_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplateCreateUtil";
import { WorkflowTemplateCollection } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
} from "../../../Types/Workflow/Component";
import { PAGE_ARGUMENT_IDS } from "../../../Types/Workflow/Components/OnCallPageSettings";
import { getWorkflowTemplate } from "../../../Types/Workflow/Templates";
import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  lintWorkflowGraph,
} from "../../../UI/Components/Workflow/GraphLint";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161001";
const WORKFLOW_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161002";

// The project's records, as the API lists them.
const PRIMARY_SCHEDULE: string = "5c4e0000-0000-4000-8000-000000000001";
const CRITICAL_POLICY: string = "dddddddd-0000-4000-8000-000000000001";
const PLATFORM_TEAM: string = "7eae0000-0000-4000-8000-000000000001";
const JANE: string = "10000000-0000-4000-8000-000000000001";

const mockCreate: MockFunction = ModelAPI.create as unknown as MockFunction;
const mockGetCurrentProjectId: MockFunction =
  ProjectUtil.getCurrentProjectId as unknown as MockFunction;

const REGISTRY: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

function result(rows: Array<unknown>): JSONObject {
  return {
    data: rows,
    count: rows.length,
    skip: 0,
    limit: rows.length,
  } as unknown as JSONObject;
}

function answerLists(): void {
  getListMock.mockImplementation(async (request: any): Promise<unknown> => {
    if (request.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = PRIMARY_SCHEDULE;
      schedule.name = "Primary";
      return result([schedule]);
    }

    if (request.modelType === OnCallDutyPolicy) {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = CRITICAL_POLICY;
      policy.name = "Critical";
      return result([policy]);
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = PLATFORM_TEAM;
      team.name = "Platform";
      return result([team]);
    }

    if (request.modelType === TeamMember) {
      const user: User = new User();
      user._id = JANE;
      user.name = new Name("Jane Doe");
      user.email = new Email("jane@example.com");

      const member: TeamMember = new TeamMember();
      member.user = user;
      return result([member]);
    }

    return result([]);
  });
}

interface Harness {
  onCreated: MockFunction;
}

function renderModal(instance?: i18n): Harness {
  const onCreated: MockFunction = getJestMockFunction();
  const modal: React.ReactElement = (
    <CreateWorkflowModal
      onClose={getJestMockFunction()}
      onCreated={onCreated}
    />
  );

  render(
    instance ? (
      <I18nextProvider i18n={instance}>{modal}</I18nextProvider>
    ) : (
      modal
    ),
  );

  return { onCreated: onCreated };
}

// The footer's way on: Use this template, Next, or Create Workflow.
function submit(): void {
  fireEvent.click(
    screen.queryByTestId("modal-footer-next-button") ||
      screen.getByTestId("modal-footer-submit-button"),
  );
}

// Pick a template from All templates, use it, and go on from Name.
function goToConfigure(templateId: string): void {
  fireEvent.change(screen.getByTestId("workflow-template-view-select"), {
    target: { value: String(WorkflowTemplateCollection.All) },
  });
  fireEvent.click(screen.getByTestId(`workflow-template-option-${templateId}`));
  submit();
  submit();

  expect(screen.getByTestId("workflow-wizard-step-content")).toHaveAttribute(
    "data-step",
    "configure",
  );
}

function question(componentId: string): HTMLElement {
  return screen.getByTestId(`workflow-who-to-page-${componentId}`);
}

// Open a question's search list, pick a record by its name, and close the list.
async function pickIn(
  componentId: string,
  buttonName: string,
  recordName: string,
): Promise<void> {
  fireEvent.click(
    within(question(componentId)).getByRole("button", { name: buttonName }),
  );

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: buttonName,
  });

  fireEvent.click(await within(popup).findByText(recordName));

  await waitFor(() => {
    expect(
      within(question(componentId)).queryAllByTestId("people-chip"),
    ).toHaveLength(1);
  });

  fireEvent.keyDown(popup, { key: "Escape" });

  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: buttonName }),
    ).not.toBeInTheDocument();
  });
}

// A template's name, as the wizard's sentences name it.
function nameOf(templateId: string): string {
  return getWorkflowTemplate(templateId)?.name as string;
}

// The graph the dialog asked the API to create.
function createdGraph(): JSONObject {
  const workflow: Workflow = (
    mockCreate.mock.calls[0]?.[0] as { model: Workflow }
  ).model;

  return workflow.graph as JSONObject;
}

function nodeArguments(graph: JSONObject, componentId: string): JSONObject {
  const node: JSONObject | undefined = (
    graph["nodes"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return (candidate["data"] as JSONObject)["id"] === componentId;
  });

  if (!node) {
    throw new Error(`No step ${componentId} in the graph.`);
  }

  return ((node["data"] as JSONObject)["arguments"] as JSONObject) || {};
}

function stepIds(graph: JSONObject): Array<string> {
  return (graph["nodes"] as Array<JSONObject>).map(
    (node: JSONObject): string => {
      return (node["data"] as JSONObject)["id"] as string;
    },
  );
}

// What the Builder's checks say of the graph, as it hydrates it on load.
function lintIssues(graph: JSONObject): Array<string> {
  const nodes: Array<LintGraphNode> = (graph["nodes"] as Array<JSONObject>).map(
    (node: JSONObject): LintGraphNode => {
      const data: JSONObject = node["data"] as JSONObject;

      return {
        id: node["id"] as string,
        data: {
          ...(data as unknown as NodeDataProp),
          metadata: REGISTRY.find((component: ComponentMetadata): boolean => {
            return component.id === data["metadataId"];
          }) as ComponentMetadata,
        },
      };
    },
  );
  const edges: Array<LintGraphEdge> = (graph["edges"] as Array<JSONObject>).map(
    (edge: JSONObject): LintGraphEdge => {
      return {
        source: edge["source"] as string,
        target: edge["target"] as string,
        sourceHandle: edge["sourceHandle"] as string,
      };
    },
  );

  return lintWorkflowGraph({ nodes: nodes, edges: edges }).issues.map(
    (issue: WorkflowLintIssue): string => {
      return issue.message;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/workflows`);
  mockGetCurrentProjectId.mockReturnValue(new ObjectID(PROJECT_ID));
  answerLists();

  const created: Workflow = new Workflow();
  created.id = new ObjectID(WORKFLOW_ID);
  mockCreate.mockResolvedValue({ data: created });
});

afterEach(() => {
  cleanup();
});

describe("a template whose whole job is to page", () => {
  test("asks who to page on the Configure step, in the step's own words", () => {
    renderModal();
    goToConfigure("incident-critical-page-on-call");

    const content: HTMLElement = screen.getByTestId(
      "workflow-wizard-step-content",
    );

    // It asks for nothing saved as a variable, so it says what it does ask.
    expect(content).toHaveTextContent(
      `${nameOf("incident-critical-page-on-call")} pages people in this project. Pick who it pages here, or change it later on its Page step in the Builder.`,
    );
    expect(content).not.toHaveTextContent("saved as workflow variables");
    expect(
      screen.getByRole("group", { name: /Who to page for critical incidents/ }),
    ).toBe(within(question("page-on-call-1")).getByRole("group"));
    expect(
      within(question("page-on-call-1")).getByRole("button", {
        name: "Add on-call schedule",
      }),
    ).toBeInTheDocument();
    expect(content).toHaveTextContent(
      "The on-call schedules whose person on call right now is paged for a critical incident.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Create Workflow",
    );
  });

  test("creates nothing until somebody is picked, and says so under the question", async () => {
    renderModal();
    goToConfigure("incident-critical-page-on-call");

    submit();

    expect(
      within(question("page-on-call-1")).getByTestId("error-message"),
    ).toHaveTextContent(WHO_TO_PAGE_REQUIRED_MESSAGE);
    expect(mockCreate).not.toHaveBeenCalled();

    // Somebody picked: the message goes.
    await pickIn("page-on-call-1", "Add on-call schedule", "Primary");

    expect(
      within(question("page-on-call-1")).queryByTestId("error-message"),
    ).not.toBeInTheDocument();
  });

  test("writes who was picked into the Page step, so the workflow opens with no error", async () => {
    const harness: Harness = renderModal();
    goToConfigure("incident-critical-page-on-call");

    await pickIn("page-on-call-1", "Add on-call schedule", "Primary");
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    const graph: JSONObject = createdGraph();

    expect(
      nodeArguments(graph, "page-on-call-1")[PAGE_ARGUMENT_IDS.onCallSchedules],
    ).toEqual([PRIMARY_SCHEDULE]);
    expect(lintIssues(graph)).toEqual([]);
  });

  test("asks for each Page step on its own, each listing the kind of record it pages", async () => {
    const harness: Harness = renderModal();
    goToConfigure("incident-severity-page");

    expect(
      within(question("page-on-call-policy-1")).getByRole("button", {
        name: "Add on-call policy",
      }),
    ).toBeInTheDocument();
    expect(
      within(question("page-team-1")).getByRole("button", {
        name: "Add team",
      }),
    ).toBeInTheDocument();

    // One answered is not both.
    await pickIn("page-on-call-policy-1", "Add on-call policy", "Critical");
    submit();

    expect(
      within(question("page-team-1")).getByTestId("error-message"),
    ).toHaveTextContent(WHO_TO_PAGE_REQUIRED_MESSAGE);
    expect(
      within(question("page-on-call-policy-1")).queryByTestId("error-message"),
    ).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();

    await pickIn("page-team-1", "Add team", "Platform");
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    const graph: JSONObject = createdGraph();

    expect(
      nodeArguments(graph, "page-on-call-policy-1")[
        PAGE_ARGUMENT_IDS.onCallPolicies
      ],
    ).toEqual([CRITICAL_POLICY]);
    expect(
      nodeArguments(graph, "page-team-1")[PAGE_ARGUMENT_IDS.teams],
    ).toEqual([PLATFORM_TEAM]);
    expect(lintIssues(graph)).toEqual([]);
  });

  test("people, for the template that pages people", async () => {
    const harness: Harness = renderModal();
    goToConfigure("webhook-page-users");

    await pickIn("page-users-1", "Add user", "Jane Doe");
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    expect(
      nodeArguments(createdGraph(), "page-users-1")[PAGE_ARGUMENT_IDS.users],
    ).toEqual([JANE]);
    expect(lintIssues(createdGraph())).toEqual([]);
  });
});

describe("a template that pages on the side", () => {
  test("asks after its settings, under a sentence of its own, and says nobody may be picked", () => {
    renderModal();
    goToConfigure("zabbix-declare-incident-from-problem");

    const content: HTMLElement = screen.getByTestId(
      "workflow-wizard-step-content",
    );

    expect(content).toHaveTextContent("saved as workflow variables");
    expect(screen.getByTestId("workflow-who-to-page-intro")).toHaveTextContent(
      "Who it pages is kept on its Page step, where you can change it later in the Builder.",
    );
    // The Zabbix URL first, then who to page.
    expect(
      screen
        .getByTestId("workflow-variable-zabbixUrl")
        .compareDocumentPosition(question("page-on-call-policy-1")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(content).toHaveTextContent("Pick none to page nobody.");
  });

  test("picking nobody leaves paging out, and the rest of the workflow whole", async () => {
    const harness: Harness = renderModal();
    goToConfigure("zabbix-declare-incident-from-problem");

    fireEvent.change(screen.getByTestId("workflow-variable-zabbixUrl"), {
      target: { value: "https://zabbix.example.com" },
    });
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    const graph: JSONObject = createdGraph();

    expect(stepIds(graph)).toEqual([
      "webhook-1",
      "read-event-1",
      "incident-from-another-tool-1",
    ]);
    expect(lintIssues(graph)).toEqual([]);
  });

  test("with a policy picked, pages it for High and Disaster problems", async () => {
    const harness: Harness = renderModal();
    goToConfigure("zabbix-declare-incident-from-problem");

    fireEvent.change(screen.getByTestId("workflow-variable-zabbixUrl"), {
      target: { value: "https://zabbix.example.com" },
    });
    await pickIn("page-on-call-policy-1", "Add on-call policy", "Critical");
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    const graph: JSONObject = createdGraph();

    expect(stepIds(graph)).toEqual([
      "webhook-1",
      "read-event-1",
      "incident-from-another-tool-1",
      "if-page-1",
      "page-on-call-policy-1",
    ]);
    expect(
      nodeArguments(graph, "page-on-call-policy-1")[
        PAGE_ARGUMENT_IDS.onCallPolicies
      ],
    ).toEqual([CRITICAL_POLICY]);
    expect(lintIssues(graph)).toEqual([]);
  });

  test("Huntress asks too, though it has no settings", async () => {
    const harness: Harness = renderModal();
    goToConfigure("huntress-incident-report-to-incident");

    expect(
      screen.getByTestId("workflow-wizard-step-content"),
    ).toHaveTextContent("pages people in this project");

    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalled();
    });

    expect(stepIds(createdGraph())).toEqual([
      "huntress-1",
      "incident-from-another-tool-1",
    ]);
  });
});

describe("what was picked, going back and on", () => {
  test("is kept going Back to Name and on again", async () => {
    renderModal();
    goToConfigure("incident-critical-page-on-call");
    await pickIn("page-on-call-1", "Add on-call schedule", "Primary");

    fireEvent.click(screen.getByTestId("workflow-wizard-back"));
    submit();

    await waitFor(() => {
      expect(
        within(question("page-on-call-1")).queryAllByTestId("people-chip"),
      ).toHaveLength(1);
    });
  });

  test("is dropped for another template", async () => {
    renderModal();
    goToConfigure("incident-critical-page-on-call");
    await pickIn("page-on-call-1", "Add on-call schedule", "Primary");

    fireEvent.click(screen.getByTestId("workflow-wizard-back"));
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));
    goToConfigure("incident-severity-page");
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));
    goToConfigure("incident-critical-page-on-call");

    expect(
      within(question("page-on-call-1")).queryAllByTestId("people-chip"),
    ).toHaveLength(0);
  });
});

test("a template that pages nobody asks nothing of the kind", () => {
  renderModal();
  goToConfigure("incident-created-slack");

  expect(screen.queryAllByTestId(/^workflow-who-to-page-/)).toHaveLength(0);
  expect(screen.getByTestId("workflow-wizard-step-content")).toHaveTextContent(
    "saved as workflow variables",
  );
});

/*
 * In German, with the Dashboard's real locale: the step's two sentences and
 * the message under a question are translated, and the questions themselves
 * - template text - are shown as the template words them.
 */
describe("in German", () => {
  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  const instance: i18n = createInstance();

  beforeAll(async () => {
    await instance.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: german } },
      interpolation: { escapeValue: false },
    });
  });

  // The German wording, checked to be a translation and not the English.
  function de(english: string): string {
    const value: string | undefined = german[english];

    expect({ english: english, translated: value !== english }).toEqual({
      english: english,
      translated: Boolean(value),
    });

    return value as string;
  }

  test("the sentence of a template that only pages, and the message", () => {
    renderModal(instance);
    goToConfigure("incident-critical-page-on-call");

    expect(
      screen.getByTestId("workflow-wizard-step-content"),
    ).toHaveTextContent(
      de(
        "{{templateName}} pages people in this project. Pick who it pages here, or change it later on its Page step in the Builder.",
      ).replace("{{templateName}}", nameOf("incident-critical-page-on-call")),
    );

    submit();

    expect(
      within(question("page-on-call-1")).getByTestId("error-message"),
    ).toHaveTextContent(de(WHO_TO_PAGE_REQUIRED_MESSAGE));
  });

  test("the sentence over the questions after a template's settings", () => {
    renderModal(instance);
    goToConfigure("zabbix-declare-incident-from-problem");

    expect(screen.getByTestId("workflow-who-to-page-intro")).toHaveTextContent(
      de(
        "Who it pages is kept on its Page step, where you can change it later in the Builder.",
      ),
    );
  });
});
