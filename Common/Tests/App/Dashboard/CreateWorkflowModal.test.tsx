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
import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../Types/ObjectID";
import {
  WorkflowTemplate,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
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
const FORWARD_TEMPLATE_ID: string = "incident-created-forward";
const ZERO_CONFIG_TEMPLATE_ID: string = "manual-log";

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

type SelectTemplateFunction = (templateId: string) => WorkflowTemplate;

const selectTemplate: SelectTemplateFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate = getTemplate(templateId);

  fireEvent.click(
    screen.getByTestId(`workflow-template-card-${template.name}`),
  );

  return template;
};

type SubmitFunction = () => void;

const submit: SubmitFunction = (): void => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentProjectId.mockReturnValue(PROJECT_ID);
  mockDeleteItem.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("CreateWorkflowModal variable input types", () => {
  test("a secret-only Slack template still presents an ordinary text input", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(SLACK_TEMPLATE_ID);

    expect(template.variables).toHaveLength(1);
    expect(template.variables[0]?.isSecret).toBe(true);
    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute("type", "text");
  });

  test("the mixed SMTP template renders every public and secret value as text", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(EMAIL_TEMPLATE_ID);

    expect(
      template.variables.map((variable: WorkflowTemplateVariable) => {
        return {
          name: variable.name,
          isSecret: variable.isSecret,
          inputType: getVariableInput(variable.name).type,
        };
      }),
    ).toEqual([
      { name: "smtpHost", isSecret: false, inputType: "text" },
      { name: "smtpPort", isSecret: false, inputType: "text" },
      { name: "smtpUsername", isSecret: false, inputType: "text" },
      { name: "smtpPassword", isSecret: true, inputType: "text" },
      { name: "emailFrom", isSecret: false, inputType: "text" },
      { name: "emailTo", isSecret: false, inputType: "text" },
    ]);
  });

  test("a non-secret destination URL uses a text input", () => {
    renderModal();
    const template: WorkflowTemplate = goToConfigure(FORWARD_TEMPLATE_ID);

    expect(template.variables).toHaveLength(1);
    expect(template.variables[0]?.isSecret).toBe(false);
    expect(getVariableInput("forwardUrl")).toHaveAttribute("type", "text");
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
    expect(getVariableInput("smtpPassword")).toHaveAttribute("type", "text");
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

    expect(createArguments).toHaveLength(7);
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

    expect(getVariableInput("slackWebhookUrl")).toHaveAttribute("type", "text");

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
