import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      deleteItem: jest.fn(),
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
import { workflowTemplateViewDomId } from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowTemplatePicker";
import {
  WorkflowTemplateCollection,
  WorkflowTemplatePickerView,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);

const SLACK_TEMPLATE_ID: string = "incident-created-slack";
const EMAIL_TEMPLATE_ID: string = "scheduled-email-digest";
const ZERO_CONFIG_TEMPLATE_ID: string = "manual-log";

/*
 * Every Jira template comes in an incident and an alert version. Alerts have
 * no public notes, so the alert set has no public-note template and is one
 * shorter.
 */
interface JiraKind {
  /** The record, as the template ids and help text name it. */
  noun: string;
  /** The other kind's record, which nothing of this kind should mention. */
  otherNoun: string;
  /** The part of the Jira category the picker lists them under. */
  part: string;
  /** In the order the picker shows them. */
  templateIds: Array<string>;
  createIssueTemplateId: string;
  /** Calls Jira, so asks for the site URL and the token and nothing else. */
  createFromIssueTemplateId: string;
  /** Receive a Jira webhook and write to OneUptime only: nothing to configure. */
  webhookOnlyTemplateIds: Array<string>;
}

const INCIDENT_JIRA_KIND: JiraKind = {
  noun: "incident",
  otherNoun: "alert",
  part: "Incidents",
  templateIds: [
    "jira-create-issue-for-incident",
    "jira-transition-issue-on-incident-state",
    "jira-comment-from-incident-private-note",
    "jira-comment-from-incident-public-note",
    "jira-comment-on-incident-update",
    "jira-declare-incident-from-issue",
    "jira-status-to-incident-state",
    "jira-comment-to-incident-private-note",
    "jira-issue-changes-to-incident-private-note",
  ],
  createIssueTemplateId: "jira-create-issue-for-incident",
  createFromIssueTemplateId: "jira-declare-incident-from-issue",
  webhookOnlyTemplateIds: [
    "jira-status-to-incident-state",
    "jira-issue-changes-to-incident-private-note",
  ],
};

const ALERT_JIRA_KIND: JiraKind = {
  noun: "alert",
  otherNoun: "incident",
  part: "Alerts",
  templateIds: [
    "jira-create-issue-for-alert",
    "jira-transition-issue-on-alert-state",
    "jira-comment-from-alert-private-note",
    "jira-comment-on-alert-update",
    "jira-create-alert-from-issue",
    "jira-status-to-alert-state",
    "jira-comment-to-alert-private-note",
    "jira-issue-changes-to-alert-private-note",
  ],
  createIssueTemplateId: "jira-create-issue-for-alert",
  createFromIssueTemplateId: "jira-create-alert-from-issue",
  webhookOnlyTemplateIds: [
    "jira-status-to-alert-state",
    "jira-issue-changes-to-alert-private-note",
  ],
};

const JIRA_KINDS: Array<JiraKind> = [INCIDENT_JIRA_KIND, ALERT_JIRA_KIND];

/** Every Jira template, in the order the picker shows them: incidents, then alerts. */
const JIRA_TEMPLATE_IDS: Array<string> = [
  ...INCIDENT_JIRA_KIND.templateIds,
  ...ALERT_JIRA_KIND.templateIds,
];

const JIRA_WEBHOOK_ONLY_TEMPLATE_IDS: Array<string> = [
  ...INCIDENT_JIRA_KIND.webhookOnlyTemplateIds,
  ...ALERT_JIRA_KIND.webhookOnlyTemplateIds,
];

const JIRA_TOKEN_VARIABLE: string = "jiraBasicAuthToken";

/** The one setting whose help text names the record: it is what the issue links back to. */
const ONEUPTIME_URL_VARIABLE: string = "oneuptimeUrl";

/** What someone setting the Jira templates up would type, in the order the wizard asks. */
const JIRA_VALUES: Record<string, string> = {
  jiraBaseUrl: "https://acme.atlassian.net",
  jiraBasicAuthToken: "cHJpeWFAYWNtZS5jb206QVRBVFQzeEZmR0YwUzNjcjN0",
  jiraProjectKey: "OPS",
  jiraIssueType: "Task",
  oneuptimeUrl: "https://oneuptime.com",
};

interface ModelCreateArguments {
  model: Workflow | WorkflowVariable;
  modelType: typeof Workflow | typeof WorkflowVariable;
}

interface ModelDeleteArguments {
  modelType: typeof Workflow;
  id: ObjectID;
}

const mockCreate: MockFunction = ModelAPI.create as unknown as MockFunction;
const mockDeleteItem: MockFunction =
  ModelAPI.deleteItem as unknown as MockFunction;
const mockGetCurrentProjectId: MockFunction =
  ProjectUtil.getCurrentProjectId as unknown as MockFunction;

interface ModalHarness {
  view: RenderResult;
  onClose: MockFunction;
  onCreated: MockFunction;
}

type RenderModalFunction = () => ModalHarness;

const renderModal: RenderModalFunction = (): ModalHarness => {
  const onClose: MockFunction = getJestMockFunction();
  const onCreated: MockFunction = getJestMockFunction();
  const view: RenderResult = render(
    <CreateWorkflowModal onClose={onClose} onCreated={onCreated} />,
  );

  return {
    view: view,
    onClose: onClose,
    onCreated: onCreated,
  };
};

type GetTemplateFunction = (templateId: string) => WorkflowTemplate;

const getTemplate: GetTemplateFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`Workflow template "${templateId}" was not found.`);
  }

  return template;
};

const OPTION_TEST_ID_PREFIX: string = "workflow-template-option-";
const VARIABLE_INPUT_TEST_ID_PREFIX: string = "workflow-variable-";

type ShowViewFunction = (view: WorkflowTemplatePickerView) => void;

/** Choose a category (or a collection) in the picker's list of them. */
const showView: ShowViewFunction = (view: WorkflowTemplatePickerView): void => {
  fireEvent.click(screen.getByTestId(workflowTemplateViewDomId(view)));
};

type HighlightTemplateFunction = (templateId: string) => WorkflowTemplate;

/**
 * Click a template's row, which previews it. Opens All templates first when
 * the row is not on the list being shown.
 */
const highlightTemplate: HighlightTemplateFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate = getTemplate(templateId);

  if (!screen.queryByTestId(`${OPTION_TEST_ID_PREFIX}${templateId}`)) {
    showView(WorkflowTemplateCollection.All);
  }

  fireEvent.click(screen.getByTestId(`${OPTION_TEST_ID_PREFIX}${templateId}`));

  return template;
};

type SubmitFunction = () => void;

/** The footer's primary button: Use this template, Next or Create Workflow. */
const submit: SubmitFunction = (): void => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
};

type SelectTemplateFunction = (templateId: string) => WorkflowTemplate;

/** Pick a template and use it: the wizard moves on to Name. */
const selectTemplate: SelectTemplateFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate = highlightTemplate(templateId);

  submit();

  return template;
};

type GoToConfigureFunction = (templateId: string) => WorkflowTemplate;

const goToConfigure: GoToConfigureFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate = selectTemplate(templateId);

  submit();

  const firstVariable: WorkflowTemplateVariable | undefined =
    template.variables[0];

  if (!firstVariable) {
    throw new Error(`Workflow template "${templateId}" has no variables.`);
  }

  expect(
    screen.getByTestId(`workflow-variable-${firstVariable.name}`),
  ).toBeInTheDocument();

  return template;
};

type GetVariableInputFunction = (variableName: string) => HTMLInputElement;

const getVariableInput: GetVariableInputFunction = (
  variableName: string,
): HTMLInputElement => {
  return screen.getByTestId(
    `workflow-variable-${variableName}`,
  ) as HTMLInputElement;
};

type FillVariableFunction = (variableName: string, value: string) => void;

const fillVariable: FillVariableFunction = (
  variableName: string,
  value: string,
): void => {
  fireEvent.change(getVariableInput(variableName), {
    target: { value: value },
  });
};

type GetProgressFunction = () => HTMLElement;

const getProgress: GetProgressFunction = (): HTMLElement => {
  return screen.getByRole("navigation", { name: "Progress" });
};

type ExpectActiveStepFunction = (title: string) => void;

const expectActiveStep: ExpectActiveStepFunction = (title: string): void => {
  const label: HTMLElement = within(getProgress()).getByText(title);

  expect(label.closest('[aria-current="step"]')).not.toBeNull();
};

type CreatedWorkflowFunction = () => Workflow;

const createdWorkflow: CreatedWorkflowFunction = (): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.name = "Created workflow";
  return workflow;
};

type SearchTemplatesFunction = (query: string) => void;

const searchTemplates: SearchTemplatesFunction = (query: string): void => {
  fireEvent.change(screen.getByTestId("workflow-template-search"), {
    target: { value: query },
  });
};

type GetStepContentFunction = () => HTMLElement;

const getStepContent: GetStepContentFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-wizard-step-content");
};

type GetListboxFunction = () => HTMLElement;

const getListbox: GetListboxFunction = (): HTMLElement => {
  return screen.getByRole("listbox");
};

type GetPreviewFunction = () => HTMLElement;

const getPreview: GetPreviewFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-template-preview");
};

type TestIdSuffixesFunction = (
  container: HTMLElement,
  prefix: string,
) => Array<string>;

/** What follows the prefix on each matching test id, in document order. */
const testIdSuffixes: TestIdSuffixesFunction = (
  container: HTMLElement,
  prefix: string,
): Array<string> => {
  return within(container)
    .queryAllByTestId((testId: string) => {
      return testId.startsWith(prefix);
    })
    .map((element: HTMLElement): string => {
      return (element.getAttribute("data-testid") || "").slice(prefix.length);
    });
};

type OptionIdsInFunction = (container: HTMLElement) => Array<string>;

/** The ids of the templates listed in a part of the picker, in the order shown. */
const optionIdsIn: OptionIdsInFunction = (
  container: HTMLElement,
): Array<string> => {
  return testIdSuffixes(container, OPTION_TEST_ID_PREFIX);
};

type GroupNamesFunction = () => Array<string>;

/** The headed parts of the list, in the order they show. */
const groupNames: GroupNamesFunction = (): Array<string> => {
  return within(getListbox())
    .queryAllByRole("group")
    .map((group: HTMLElement): string => {
      return group.getAttribute("aria-label") || "";
    });
};

type ActiveOptionIdFunction = () => string | null;

/** The template the list has highlighted. */
const activeOptionId: ActiveOptionIdFunction = (): string | null => {
  const active: Array<HTMLElement> = within(getListbox())
    .queryAllByRole("option")
    .filter((option: HTMLElement) => {
      return option.getAttribute("aria-selected") === "true";
    });

  expect(active.length).toBeLessThanOrEqual(1);

  return active[0]
    ? (active[0].getAttribute("data-testid") || "").slice(
        OPTION_TEST_ID_PREFIX.length,
      )
    : null;
};

type ArgumentsOfComponentFunction = (
  graph: JSONObject,
  componentId: string,
) => JSONObject;

const argumentsOfComponent: ArgumentsOfComponentFunction = (
  graph: JSONObject,
  componentId: string,
): JSONObject => {
  const node: JSONObject | undefined = (
    graph["nodes"] as Array<JSONObject>
  ).find((candidate: JSONObject) => {
    return (candidate["data"] as JSONObject)["id"] === componentId;
  });

  if (!node) {
    throw new Error(`The graph has no component "${componentId}".`);
  }

  return (node["data"] as JSONObject)["arguments"] as JSONObject;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentProjectId.mockReturnValue(PROJECT_ID);
  mockDeleteItem.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("CreateWorkflowModal variable input types", () => {
  test("a secret-only Slack template masks its webhook URL", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(SLACK_TEMPLATE_ID);

    expect(template.variables).toHaveLength(1);
    expect(template.variables[0]?.isSecret).toBe(true);
    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute(
      "type",
      "password",
    );
    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute(
      "spellcheck",
      "false",
    );
  });

  test("the mixed SMTP template masks only its secret values", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(EMAIL_TEMPLATE_ID);

    for (const variable of template.variables) {
      expect(getVariableInput(variable.name)).toHaveAttribute(
        "type",
        variable.isSecret ? "password" : "text",
      );
    }

    expect(getVariableInput("smtpPassword")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(getVariableInput("smtpHost")).not.toHaveAttribute("autocomplete");
  });

  test("a non-secret SMTP host remains a text input", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(EMAIL_TEMPLATE_ID);
    const smtpHost: WorkflowTemplateVariable | undefined =
      template.variables.find((variable: WorkflowTemplateVariable) => {
        return variable.name === "smtpHost";
      });

    expect(smtpHost?.isSecret).toBe(false);
    expect(getVariableInput("smtpHost")).toHaveAttribute("type", "text");
    expect(getVariableInput("smtpHost")).not.toHaveAttribute("autocomplete");
  });
});

describe("CreateWorkflowModal standard form steps", () => {
  test("uses the shared vertical progress rail and its active-step semantics", () => {
    renderModal();

    const progress: HTMLElement = getProgress();
    const stepList: HTMLElement = within(progress).getByRole("list");

    expect(stepList).toHaveClass("space-y-6");
    expectActiveStep("Start from");
    expect(within(progress).getByText("Name")).toBeInTheDocument();
    expect(within(progress).queryByText("Configure")).not.toBeInTheDocument();
  });

  /*
   * The rail sits beside a picker whose rows are as wide as their longest
   * description. Free to shrink, it was squeezed until "Start from" broke
   * over two lines.
   */
  test("the progress rail keeps its width beside the picker", () => {
    renderModal();

    expect(screen.getByTestId("workflow-wizard-steps")).toHaveStyle({
      flex: "0 0 auto",
    });
    expect(getStepContent()).toHaveClass("min-w-0");
  });

  test("only adds Configure for templates that declare variables", () => {
    renderModal();

    selectTemplate(ZERO_CONFIG_TEMPLATE_ID);

    expectActiveStep("Name");
    expect(
      within(getProgress()).queryByText("Configure"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(getProgress()).getByText("Start from"));
    expect(screen.getByTestId("workflow-template-search")).toBeInTheDocument();

    selectTemplate(SLACK_TEMPLATE_ID);

    expectActiveStep("Name");
    expect(within(getProgress()).getByText("Configure")).toBeInTheDocument();
  });

  test("a completed step can navigate back to the template picker", () => {
    renderModal();
    selectTemplate(SLACK_TEMPLATE_ID);

    const startFromStep: HTMLElement =
      within(getProgress()).getByText("Start from");
    expect(startFromStep.closest("li")).toHaveClass("cursor-pointer");

    fireEvent.click(startFromStep);

    expect(screen.getByTestId("workflow-template-search")).toBeInTheDocument();
    expectActiveStep("Start from");
  });
});

describe("CreateWorkflowModal's Start from step", () => {
  /*
   * Two ways in, and one primary button: Use this template, in the footer.
   * Start from scratch is the other way, drawn plain beside the search.
   */
  test("offers Start from scratch and Use this template, and only the second is primary", () => {
    renderModal();

    const useTemplate: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );
    const scratch: HTMLElement = screen.getByTestId(
      "workflow-start-from-scratch",
    );

    expect(useTemplate).toHaveTextContent("Use this template");
    expect(useTemplate).toBeEnabled();
    expect(scratch).toHaveTextContent("Start from scratch");
    expect(scratch.tagName).toBe("BUTTON");
    expect(scratch).toHaveAttribute("aria-pressed", "false");
    expect(scratch.className).not.toMatch(/bg-indigo-600/);
    // No Back on the first step.
    expect(
      screen.queryByTestId("workflow-wizard-back"),
    ).not.toBeInTheDocument();
  });

  test("opens on the recommended templates, with the first one highlighted and previewed", () => {
    renderModal();

    expect(optionIdsIn(getListbox())).toEqual([
      ...RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
    ]);
    expect(activeOptionId()).toBe(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]);
    expect(
      within(getPreview()).getByRole("heading", {
        name: getTemplate(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]!).name,
      }),
    ).toBeInTheDocument();
  });

  test("the search box has the focus, so typing searches straight away", () => {
    renderModal();

    expect(screen.getByTestId("workflow-template-search")).toHaveFocus();
  });

  test("Use this template, with nothing picked, takes the highlighted first recommendation", () => {
    renderModal();

    submit();

    const first: WorkflowTemplate = getTemplate(
      RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]!,
    );

    expectActiveStep("Name");
    expect(screen.getByTestId("workflow-name-input")).toHaveValue(
      first.workflowName,
    );
    expect(screen.getByTestId("workflow-description-input")).toHaveValue(
      first.workflowDescription,
    );
  });

  test("Start from scratch moves on to Name with nothing filled in, and creates an empty, switched-off workflow", async () => {
    const created: Workflow = createdWorkflow();

    mockCreate.mockResolvedValue({ data: created });

    const harness: ModalHarness = renderModal();

    fireEvent.click(screen.getByTestId("workflow-start-from-scratch"));

    expectActiveStep("Name");
    expect(
      within(getProgress()).queryByText("Configure"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workflow-name-input")).toHaveValue("");
    expect(screen.getByTestId("workflow-description-input")).toHaveValue("");
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Create Workflow",
    );

    fireEvent.change(screen.getByTestId("workflow-name-input"), {
      target: { value: "My own workflow" },
    });
    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalledWith(created);
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const workflow: Workflow = (
      mockCreate.mock.calls[0]?.[0] as ModelCreateArguments
    ).model as Workflow;

    expect(workflow.name).toBe("My own workflow");
    expect(workflow.isEnabled).toBe(false);
    expect(workflow.graph).toEqual({ nodes: [], edges: [] });
  });

  test("after Start from scratch, Back shows it as the start chosen", () => {
    renderModal();

    fireEvent.click(screen.getByTestId("workflow-start-from-scratch"));
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));

    expect(screen.getByTestId("workflow-start-from-scratch")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Enter in the search box uses the highlighted template", () => {
    renderModal();
    searchTemplates("discord");

    fireEvent.keyDown(screen.getByTestId("workflow-template-search"), {
      key: "Enter",
    });

    expectActiveStep("Name");
    expect(screen.getByTestId("workflow-name-input")).toHaveValue(
      getTemplate("incident-created-discord").workflowName,
    );
  });

  test("a double-click on a template uses it", () => {
    renderModal();
    showView(WorkflowTemplateCategory.Monitors);

    fireEvent.doubleClick(
      screen.getByTestId(
        `${OPTION_TEST_ID_PREFIX}monitor-status-changed-forward`,
      ),
    );

    expectActiveStep("Name");
    expect(screen.getByTestId("workflow-name-input")).toHaveValue(
      getTemplate("monitor-status-changed-forward").workflowName,
    );
  });

  test("Use this template is disabled when a search matches nothing", () => {
    renderModal();
    searchTemplates("pagerduty");

    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    expect(screen.getByTestId("workflow-template-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expectActiveStep("Start from");
  });

  /*
   * Escape clears a search first. Only an empty search lets it through to
   * the dialog, which then closes.
   */
  test("Escape clears the search first, and closes the dialog only once it is empty", () => {
    const harness: ModalHarness = renderModal();
    const search: HTMLElement = screen.getByTestId("workflow-template-search");

    searchTemplates("slack");
    fireEvent.keyDown(search, { key: "Escape" });

    expect(search).toHaveValue("");
    expect(harness.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(search, { key: "Escape" });

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("Back from Name finds the picker as it was left: the same search, category and template", () => {
    renderModal();

    searchTemplates("slack");
    showView(WorkflowTemplateCategory.Monitors);
    highlightTemplate("monitor-offline-only-slack");
    submit();

    expectActiveStep("Name");

    fireEvent.click(screen.getByTestId("workflow-wizard-back"));

    expectActiveStep("Start from");
    expect(screen.getByTestId("workflow-template-search")).toHaveValue("slack");
    expect(
      screen.getByTestId(
        workflowTemplateViewDomId(WorkflowTemplateCategory.Monitors),
      ),
    ).toHaveAttribute("aria-checked", "true");
    expect(activeOptionId()).toBe("monitor-offline-only-slack");
  });

  test("taking the same template again keeps the name typed for it", () => {
    renderModal();
    selectTemplate(SLACK_TEMPLATE_ID);

    fireEvent.change(screen.getByTestId("workflow-name-input"), {
      target: { value: "Page the team in #incidents" },
    });
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));

    submit();

    expect(screen.getByTestId("workflow-name-input")).toHaveValue(
      "Page the team in #incidents",
    );
  });

  test("taking another template starts from that template's own suggestions", () => {
    renderModal();
    selectTemplate(SLACK_TEMPLATE_ID);

    fireEvent.change(screen.getByTestId("workflow-name-input"), {
      target: { value: "Page the team in #incidents" },
    });
    fireEvent.click(screen.getByTestId("workflow-wizard-back"));

    selectTemplate("incident-created-teams");

    expect(screen.getByTestId("workflow-name-input")).toHaveValue(
      getTemplate("incident-created-teams").workflowName,
    );
  });

  test("the Name step still says what the chosen template shows you", () => {
    renderModal();
    const template: WorkflowTemplate = selectTemplate("webhook-branch");

    expect(
      within(getStepContent()).getByText(template.name),
    ).toBeInTheDocument();
    expect(
      within(getStepContent()).getByText(template.teaches),
    ).toBeInTheDocument();
  });
});

describe("CreateWorkflowModal wizard state and validation", () => {
  test("Back preserves the workflow name and values already entered", async () => {
    renderModal();
    selectTemplate(EMAIL_TEMPLATE_ID);

    fireEvent.change(screen.getByTestId("workflow-name-input"), {
      target: { value: "My daily digest" },
    });
    submit();

    fillVariable("smtpHost", "smtp.example.com");
    fillVariable("smtpPassword", "not-masked-in-this-form");

    fireEvent.click(screen.getByTestId("workflow-wizard-back"));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-name-input")).toHaveValue(
        "My daily digest",
      );
    });

    submit();

    await waitFor(() => {
      expect(getVariableInput("smtpHost")).toHaveValue("smtp.example.com");
      expect(getVariableInput("smtpPassword")).toHaveValue(
        "not-masked-in-this-form",
      );
    });
    expect(getVariableInput("smtpPassword")).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("reports every missing required SMTP field but not optional fields", () => {
    renderModal();
    goToConfigure(EMAIL_TEMPLATE_ID);

    submit();

    expect(screen.getByText("SMTP Host is required.")).toBeInTheDocument();
    expect(screen.getByText("SMTP Port is required.")).toBeInTheDocument();
    expect(screen.getByText("From Address is required.")).toBeInTheDocument();
    expect(screen.getByText("To Address is required.")).toBeInTheDocument();
    expect(
      screen.queryByText("SMTP Username is required."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("SMTP Password is required."),
    ).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("CreateWorkflowModal creation orchestration", () => {
  test("creates the workflow first, then variables in declaration order with secret flags intact", async () => {
    const created: Workflow = createdWorkflow();

    mockCreate.mockImplementation(
      async (
        data: ModelCreateArguments,
      ): Promise<{ data: Workflow | WorkflowVariable }> => {
        if (data.modelType === Workflow) {
          return { data: created };
        }

        return { data: data.model };
      },
    );

    const harness: ModalHarness = renderModal();
    goToConfigure(EMAIL_TEMPLATE_ID);

    const values: Record<string, string> = {
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpSecure: "false",
      smtpUsername: "mailer",
      smtpPassword: "smtp-secret",
      emailFrom: "notifications@example.com",
      emailTo: "team@example.com",
    };

    for (const [name, value] of Object.entries(values)) {
      fillVariable(name, value);
    }

    submit();

    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalledWith(created);
    });

    const createArguments: Array<ModelCreateArguments> =
      mockCreate.mock.calls.map((call: Array<unknown>) => {
        return call[0] as ModelCreateArguments;
      });

    expect(createArguments).toHaveLength(8);
    expect(createArguments[0]?.modelType).toBe(Workflow);
    expect(createArguments[0]?.model).toBeInstanceOf(Workflow);

    const variableRows: Array<WorkflowVariable> = createArguments
      .slice(1)
      .map((data: ModelCreateArguments) => {
        expect(data.modelType).toBe(WorkflowVariable);
        expect(data.model).toBeInstanceOf(WorkflowVariable);
        return data.model as WorkflowVariable;
      });

    expect(
      variableRows.map((variable: WorkflowVariable) => {
        return variable.name;
      }),
    ).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpSecure",
      "smtpUsername",
      "smtpPassword",
      "emailFrom",
      "emailTo",
    ]);

    expect(
      variableRows.map((variable: WorkflowVariable) => {
        return {
          name: variable.name,
          content: variable.content,
          isSecret: (variable as unknown as { isSecret: boolean }).isSecret,
          workflowId: variable.workflowId?.toString(),
          projectId: variable.projectId?.toString(),
        };
      }),
    ).toEqual([
      {
        name: "smtpHost",
        content: "smtp.example.com",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "smtpPort",
        content: "587",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "smtpSecure",
        content: "false",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "smtpUsername",
        content: "mailer",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "smtpPassword",
        content: "smtp-secret",
        isSecret: true,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "emailFrom",
        content: "notifications@example.com",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
      {
        name: "emailTo",
        content: "team@example.com",
        isSecret: false,
        workflowId: WORKFLOW_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
    ]);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  test("rolls the new workflow back when creating its variable fails", async () => {
    const created: Workflow = createdWorkflow();
    const variableFailure: Error = new Error("Variable could not be saved.");

    mockCreate.mockImplementation(
      async (
        data: ModelCreateArguments,
      ): Promise<{ data: Workflow | WorkflowVariable }> => {
        if (data.modelType === Workflow) {
          return { data: created };
        }

        throw variableFailure;
      },
    );

    const harness: ModalHarness = renderModal();
    goToConfigure(SLACK_TEMPLATE_ID);
    fillVariable("slackWebhookUrl", "https://hooks.slack.com/services/T/B/X");

    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute(
      "type",
      "password",
    );

    submit();

    await waitFor(() => {
      expect(mockDeleteItem).toHaveBeenCalledTimes(1);
    });

    const deleteArguments: ModelDeleteArguments = mockDeleteItem.mock
      .calls[0]?.[0] as ModelDeleteArguments;

    expect(deleteArguments.modelType).toBe(Workflow);
    expect(deleteArguments.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(harness.onCreated).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Variable could not be saved."),
    ).toBeInTheDocument();

    const failedVariable: WorkflowVariable = mockCreate.mock.calls[1]?.[0]
      .model as WorkflowVariable;
    expect(failedVariable.name).toBe("slackWebhookUrl");
    expect((failedVariable as unknown as { isSecret: boolean }).isSecret).toBe(
      true,
    );
  });
});

type AcceptEveryCreateFunction = (created: Workflow) => void;

/** The API accepts the workflow and every variable row the wizard sends after it. */
const acceptEveryCreate: AcceptEveryCreateFunction = (
  created: Workflow,
): void => {
  mockCreate.mockImplementation(
    async (
      data: ModelCreateArguments,
    ): Promise<{ data: Workflow | WorkflowVariable }> => {
      if (data.modelType === Workflow) {
        return { data: created };
      }

      return { data: data.model };
    },
  );
};

type CreateCallsFunction = () => Array<ModelCreateArguments>;

/** Everything the wizard sent to the API to create, in the order it sent it. */
const createCalls: CreateCallsFunction = (): Array<ModelCreateArguments> => {
  return mockCreate.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ModelCreateArguments;
  });
};

interface WrittenRow {
  name: string | undefined;
  content: string | undefined;
  isSecret: boolean;
  workflowId: string | undefined;
  projectId: string | undefined;
}

type WrittenRowsFunction = (
  calls: Array<ModelCreateArguments>,
) => Array<WrittenRow>;

/** The variable rows among those calls, as the API received them. */
const writtenRows: WrittenRowsFunction = (
  calls: Array<ModelCreateArguments>,
): Array<WrittenRow> => {
  return calls.map((data: ModelCreateArguments): WrittenRow => {
    expect(data.modelType).toBe(WorkflowVariable);

    const variable: WorkflowVariable = data.model as WorkflowVariable;

    return {
      name: variable.name,
      content: variable.content,
      isSecret: (variable as unknown as { isSecret: boolean }).isSecret,
      workflowId: variable.workflowId?.toString(),
      projectId: variable.projectId?.toString(),
    };
  });
};

type ExpectedRowFunction = (name: string) => WrittenRow;

/** The row a Jira setting should become: only the token is secret. */
const expectedJiraRow: ExpectedRowFunction = (name: string): WrittenRow => {
  return {
    name: name,
    content: JIRA_VALUES[name],
    isSecret: name === JIRA_TOKEN_VARIABLE,
    workflowId: WORKFLOW_ID.toString(),
    projectId: PROJECT_ID.toString(),
  };
};

describe("CreateWorkflowModal Jira templates", () => {
  /*
   * Seventeen Jira templates in one run read as a wall. The Jira category
   * splits them by the record they work on, in the order the Jira guide
   * lists them.
   */
  test("the Jira category holds the seventeen Jira templates: nine for incidents, then eight for alerts", () => {
    renderModal();
    showView(WorkflowTemplateCategory.Jira);

    expect(JIRA_TEMPLATE_IDS).toHaveLength(17);
    expect(groupNames()).toEqual([
      INCIDENT_JIRA_KIND.part,
      ALERT_JIRA_KIND.part,
    ]);

    for (const kind of JIRA_KINDS) {
      expect(
        optionIdsIn(
          within(getListbox()).getByRole("group", { name: kind.part }),
        ),
      ).toEqual(kind.templateIds);
    }

    expect(
      screen.getByTestId(
        workflowTemplateViewDomId(WorkflowTemplateCategory.Jira),
      ),
    ).toHaveAccessibleName("Jira (17)");
  });

  /*
   * The picker lists the categories from WorkflowTemplateCategories, not from
   * the templates, so a category missing from that list would hide all of its
   * templates with no error anywhere.
   */
  test("the categories follow the declared order, between Recommended and All templates, Jira included", () => {
    renderModal();

    const radios: Array<HTMLElement> = within(
      screen.getByRole("radiogroup", { name: "Template categories" }),
    ).getAllByRole("radio");

    expect(
      radios.map((radio: HTMLElement): string => {
        return radio.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      workflowTemplateViewDomId(WorkflowTemplateCollection.Recommended),
      ...WorkflowTemplateCategories.filter(
        (category: WorkflowTemplateCategory) => {
          return getWorkflowTemplatesByCategory(category).length > 0;
        },
      ).map((category: WorkflowTemplateCategory): string => {
        return workflowTemplateViewDomId(category);
      }),
      workflowTemplateViewDomId(WorkflowTemplateCollection.All),
    ]);
    expect(
      screen.getByTestId(
        workflowTemplateViewDomId(WorkflowTemplateCategory.Jira),
      ),
    ).toBeInTheDocument();
  });

  test("All templates lists the Jira templates under Jira, in the same order", () => {
    renderModal();
    showView(WorkflowTemplateCollection.All);

    expect(groupNames()).toContain("Jira");
    expect(
      optionIdsIn(within(getListbox()).getByRole("group", { name: "Jira" })),
    ).toEqual(JIRA_TEMPLATE_IDS);
  });

  /*
   * Search reads the name, description, teaches line and category, trimmed
   * and case-insensitively. Every Jira template names Jira, and nothing
   * outside Jira mentions it, so the results are exactly the seventeen, in
   * the catalog's order: their names match equally well.
   */
  test("searching for jira shows exactly the seventeen Jira templates", () => {
    renderModal();

    for (const query of ["jira", "JIRA", "  Jira  "]) {
      searchTemplates(query);

      expect({
        query: query,
        results: optionIdsIn(getListbox()),
        jiraCount: screen
          .getByTestId(workflowTemplateViewDomId(WorkflowTemplateCategory.Jira))
          .getAttribute("aria-label"),
      }).toEqual({
        query: query,
        results: JIRA_TEMPLATE_IDS,
        jiraCount: "Jira (17)",
      });
    }
  });

  /*
   * Someone looking for what OneUptime can do with alerts finds the Jira
   * versions after the alert templates they already know. The incident Jira
   * templates never mention alerts, so they stay out of it.
   */
  test("searching for alert shows the Alerts templates, then the alert Jira templates", () => {
    renderModal();

    const alertCategoryTemplateIds: Array<string> =
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Alerts).map(
        (template: WorkflowTemplate): string => {
          return template.id;
        },
      );

    expect(alertCategoryTemplateIds.length).toBeGreaterThan(0);

    for (const query of ["alert", "ALERT", "  Alert  "]) {
      searchTemplates(query);

      expect({
        query: query,
        results: optionIdsIn(getListbox()),
      }).toEqual({
        query: query,
        results: [...alertCategoryTemplateIds, ...ALERT_JIRA_KIND.templateIds],
      });
    }
  });

  /*
   * Each kind's text names only its own record, so searching for one never
   * turns up the other's Jira templates. Narrowed to Jira, the search shows
   * exactly that kind's.
   */
  test.each(JIRA_KINDS)(
    "searching for $noun, narrowed to Jira, leaves only the $noun templates",
    (kind: JiraKind) => {
      renderModal();
      searchTemplates(kind.noun);
      showView(WorkflowTemplateCategory.Jira);

      expect(optionIdsIn(getListbox())).toEqual(kind.templateIds);
    },
  );

  /*
   * The preview is how someone can tell, before choosing, which Jira
   * templates need a Jira API token. The four webhook-only ones need nothing
   * at all.
   */
  test("each Jira template's preview lists the settings it will ask for", () => {
    renderModal();
    showView(WorkflowTemplateCategory.Jira);

    const expectedSettings: Record<string, Array<string>> = {
      "jira-create-issue-for-incident": Object.keys(JIRA_VALUES),
      "jira-transition-issue-on-incident-state": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-comment-from-incident-private-note": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-comment-from-incident-public-note": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-comment-on-incident-update": ["jiraBaseUrl", JIRA_TOKEN_VARIABLE],
      "jira-declare-incident-from-issue": ["jiraBaseUrl", JIRA_TOKEN_VARIABLE],
      "jira-status-to-incident-state": [],
      "jira-comment-to-incident-private-note": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-issue-changes-to-incident-private-note": [],
      "jira-create-issue-for-alert": Object.keys(JIRA_VALUES),
      "jira-transition-issue-on-alert-state": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-comment-from-alert-private-note": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-comment-on-alert-update": ["jiraBaseUrl", JIRA_TOKEN_VARIABLE],
      "jira-create-alert-from-issue": ["jiraBaseUrl", JIRA_TOKEN_VARIABLE],
      "jira-status-to-alert-state": [],
      "jira-comment-to-alert-private-note": [
        "jiraBaseUrl",
        JIRA_TOKEN_VARIABLE,
      ],
      "jira-issue-changes-to-alert-private-note": [],
    };

    expect(Object.keys(expectedSettings)).toEqual(JIRA_TEMPLATE_IDS);

    for (const templateId of JIRA_TEMPLATE_IDS) {
      highlightTemplate(templateId);

      const preview: HTMLElement = getPreview();

      expect({
        template: templateId,
        settings: testIdSuffixes(preview, "workflow-template-preview-setting-"),
        saysNothingToFill: Boolean(
          within(preview).queryByTestId(
            "workflow-template-preview-no-settings",
          ),
        ),
      }).toEqual({
        template: templateId,
        settings: expectedSettings[templateId],
        saysNothingToFill: expectedSettings[templateId]?.length === 0,
      });
    }
  });

  test("the preview marks the Jira API token as the secret among the settings", () => {
    renderModal();
    highlightTemplate(INCIDENT_JIRA_KIND.createIssueTemplateId);

    const token: HTMLElement = screen.getByTestId(
      `workflow-template-preview-setting-${JIRA_TOKEN_VARIABLE}`,
    );
    const siteUrl: HTMLElement = screen.getByTestId(
      "workflow-template-preview-setting-jiraBaseUrl",
    );

    expect(token).toHaveTextContent("Secret");
    expect(siteUrl).not.toHaveTextContent("Secret");
  });

  describe.each(JIRA_KINDS)(
    "the $noun templates in the wizard",
    (kind: JiraKind) => {
      test("the create-issue template asks for its five settings and masks only the token", () => {
        renderModal();
        const template: WorkflowTemplate = goToConfigure(
          kind.createIssueTemplateId,
        );

        expect(
          testIdSuffixes(getStepContent(), VARIABLE_INPUT_TEST_ID_PREFIX),
        ).toEqual(Object.keys(JIRA_VALUES));

        const token: HTMLInputElement = getVariableInput(JIRA_TOKEN_VARIABLE);

        expect(token).toHaveAttribute("type", "password");
        expect(token).toHaveAttribute("autocomplete", "new-password");
        expect(token).toHaveAttribute("spellcheck", "false");

        /*
         * The site URL is not a secret, and masking it would hide the typo that
         * sends every request to the wrong host.
         */
        const baseUrl: HTMLInputElement = getVariableInput("jiraBaseUrl");

        expect(baseUrl).toHaveAttribute("type", "text");
        expect(baseUrl).not.toHaveAttribute("autocomplete");
        expect(baseUrl).not.toHaveAttribute("spellcheck", "false");

        for (const variable of template.variables) {
          expect({
            variable: variable.name,
            type: getVariableInput(variable.name).getAttribute("type"),
          }).toEqual({
            variable: variable.name,
            type: variable.name === JIRA_TOKEN_VARIABLE ? "password" : "text",
          });
        }
      });

      /*
       * The OneUptime URL is what the new issue links back to, so its help text
       * is the one place the wizard names the record. Someone setting up the
       * alert version should not be told the link goes to an incident.
       */
      test(`the create-issue template's OneUptime URL help text says the issue links back to the ${kind.noun}`, () => {
        renderModal();
        const template: WorkflowTemplate = goToConfigure(
          kind.createIssueTemplateId,
        );

        const variable: WorkflowTemplateVariable | undefined =
          template.variables.find((candidate: WorkflowTemplateVariable) => {
            return candidate.name === ONEUPTIME_URL_VARIABLE;
          });

        if (!variable) {
          throw new Error(
            `"${kind.createIssueTemplateId}" does not ask for the OneUptime URL.`,
          );
        }

        const helpText: HTMLElement = within(getStepContent()).getByText(
          variable.description,
        );

        /* Shown beside the OneUptime URL field, not beside some other one. */
        expect(helpText.parentElement).toContainElement(
          getVariableInput(ONEUPTIME_URL_VARIABLE),
        );
        expect(helpText).toHaveTextContent(
          `link the Jira issue back to the ${kind.noun}`,
        );
        expect(helpText.textContent).not.toContain(kind.otherNoun);
        expect(
          within(getStepContent()).queryByText(
            new RegExp(`back to the ${kind.otherNoun}`),
          ),
        ).not.toBeInTheDocument();
      });

      test("the create-issue template reports every missing setting and creates nothing", () => {
        renderModal();
        const template: WorkflowTemplate = goToConfigure(
          kind.createIssueTemplateId,
        );

        submit();

        expect(template.variables).toHaveLength(5);

        for (const variable of template.variables) {
          expect(
            screen.getByText(`${variable.title} is required.`),
          ).toBeInTheDocument();
        }

        expect(mockCreate).not.toHaveBeenCalled();
      });

      test("creating from the create-issue template writes a disabled workflow, then its five settings with only the token secret", async () => {
        const created: Workflow = createdWorkflow();

        acceptEveryCreate(created);

        const harness: ModalHarness = renderModal();
        const template: WorkflowTemplate = goToConfigure(
          kind.createIssueTemplateId,
        );

        for (const [name, value] of Object.entries(JIRA_VALUES)) {
          fillVariable(name, value);
        }

        submit();

        await waitFor(() => {
          expect(harness.onCreated).toHaveBeenCalledWith(created);
        });

        const calls: Array<ModelCreateArguments> = createCalls();

        expect(calls).toHaveLength(6);
        expect(calls[0]?.modelType).toBe(Workflow);

        /*
         * The workflow goes out switched off, under the name the template
         * suggests — which differs between the two kinds, because a project
         * cannot hold two workflows of the same name — and carrying only the
         * reference: the token itself is written to the secret variable row
         * and nowhere else.
         */
        const workflow: Workflow = calls[0]?.model as Workflow;
        const graph: JSONObject = workflow.graph as JSONObject;

        expect(workflow.isEnabled).toBe(false);
        expect(workflow.name).toBe(template.workflowName);
        expect(workflow.name).toContain(kind.noun);
        expect(
          argumentsOfComponent(graph, "create-issue-1")["request-headers"],
        ).toEqual({
          Authorization: "Basic {{local.variables.jiraBasicAuthToken}}",
        });
        expect(JSON.stringify(graph)).not.toContain(
          JIRA_VALUES[JIRA_TOKEN_VARIABLE],
        );

        expect(writtenRows(calls.slice(1))).toEqual(
          Object.keys(JIRA_VALUES).map(expectedJiraRow),
        );
        expect(mockDeleteItem).not.toHaveBeenCalled();
      });

      /*
       * The other Jira-calling templates ask only where Jira is and as whom.
       * The token is just as much a credential there, so it is written secret
       * whichever kind of record the workflow is for.
       */
      test("creating from the create-from-issue template writes the site URL and a secret token", async () => {
        const created: Workflow = createdWorkflow();

        acceptEveryCreate(created);

        const harness: ModalHarness = renderModal();
        goToConfigure(kind.createFromIssueTemplateId);

        expect(
          testIdSuffixes(getStepContent(), VARIABLE_INPUT_TEST_ID_PREFIX),
        ).toEqual(["jiraBaseUrl", JIRA_TOKEN_VARIABLE]);
        expect(getVariableInput(JIRA_TOKEN_VARIABLE)).toHaveAttribute(
          "type",
          "password",
        );

        fillVariable("jiraBaseUrl", JIRA_VALUES["jiraBaseUrl"] as string);
        fillVariable(
          JIRA_TOKEN_VARIABLE,
          JIRA_VALUES[JIRA_TOKEN_VARIABLE] as string,
        );

        submit();

        await waitFor(() => {
          expect(harness.onCreated).toHaveBeenCalledWith(created);
        });

        const calls: Array<ModelCreateArguments> = createCalls();

        expect(calls[0]?.modelType).toBe(Workflow);
        expect((calls[0]?.model as Workflow).isEnabled).toBe(false);
        expect(writtenRows(calls.slice(1))).toEqual([
          expectedJiraRow("jiraBaseUrl"),
          expectedJiraRow(JIRA_TOKEN_VARIABLE),
        ]);
        expect(mockDeleteItem).not.toHaveBeenCalled();
      });
    },
  );

  /*
   * A template that declares nothing must not show an empty Configure step,
   * and must not write any variable rows: the webhook URL it needs is the
   * one the created workflow's trigger shows.
   */
  test.each(JIRA_WEBHOOK_ONLY_TEMPLATE_IDS)(
    "the webhook-only %s skips Configure and creates only the workflow",
    async (templateId: string) => {
      const created: Workflow = createdWorkflow();

      mockCreate.mockResolvedValue({ data: created });

      const harness: ModalHarness = renderModal();
      const template: WorkflowTemplate = selectTemplate(templateId);

      expect(template.variables).toEqual([]);
      expectActiveStep("Name");
      expect(
        within(getProgress()).queryByText("Configure"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Create Workflow");

      submit();

      await waitFor(() => {
        expect(harness.onCreated).toHaveBeenCalledWith(created);
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);

      const data: ModelCreateArguments = mockCreate.mock
        .calls[0]?.[0] as ModelCreateArguments;
      const workflow: Workflow = data.model as Workflow;

      expect(data.modelType).toBe(Workflow);
      expect(workflow.name).toBe(template.workflowName);
      expect(workflow.isEnabled).toBe(false);
    },
  );
});
