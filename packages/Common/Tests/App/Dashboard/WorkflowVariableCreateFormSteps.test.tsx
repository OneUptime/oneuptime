import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Create Workflow Variable form, walked in a real browser-like DOM.
 *
 * The maintainer's screenshot showed this form as one long scrolling page:
 * Name, Description, Content and the Secret switch, each with a paragraph of
 * help. It is now a two step wizard - Variable (name, description), then
 * Value (content, secret) - on both the Global Variables page and a
 * workflow's own Variables page.
 *
 * The production page builds the form; only the table around it is replaced,
 * by the create modal the real table opens (the same ModelFormModal, ModelForm,
 * BasicForm, validation and step navigation), so a field put on the wrong
 * step, a value lost between steps or a step that cannot be left all show up
 * here. Transport, permissions and the project are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const createOrUpdateMock: MockFunction = getJestMockFunction();
const successMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<WorkflowVariable>): ReactElement => {
      // What the real table opens from its Create button.
      return (
        <ModelFormModal<WorkflowVariable>
          title="Create New Workflow Variable"
          name="Workflows > Create New Workflow Variable"
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText="Create Workflow Variable"
          onClose={() => {}}
          onSuccess={successMock}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: "create-WorkflowVariable-from",
            name: "create-WorkflowVariable-from",
            modelType: props.modelType,
            fields: props.formFields || [],
            steps: props.formSteps || [],
            summary: props.formSummary,
            formType: FormType.Create,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): ObjectID => {
        return WORKFLOW_ID;
      },
      getCurrentRoute: (): unknown => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import GlobalVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Variable";
import WorkflowVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Variable";
import { WorkflowVariableType } from "../../../Types/Workflow/WorkflowVariableOAuth";

type Page = "global" | "local";

const NAME_PLACEHOLDER: string = "API_KEY";
const DESCRIPTION_PLACEHOLDER: string = "What this variable is for";
const CONTENT_PLACEHOLDER: string = "Content of the variable";

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create New Workflow Variable" });
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function secretSwitch(): HTMLElement {
  return within(dialog()).getByRole("switch", { name: /^Secret/ });
}

async function renderForm(page: Page): Promise<UserEvent> {
  const props: Record<string, unknown> = {};

  await act(async (): Promise<void> => {
    if (page === "global") {
      render(
        <GlobalVariablesPage
          {...(props as unknown as React.ComponentProps<
            typeof GlobalVariablesPage
          >)}
        />,
      );
      return;
    }

    render(
      <WorkflowVariablesPage
        {...(props as unknown as React.ComponentProps<
          typeof WorkflowVariablesPage
        >)}
      />,
    );
  });

  await screen.findByPlaceholderText(NAME_PLACEHOLDER);

  return userEvent.setup({ delay: null });
}

async function next(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
}

async function create(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", {
      name: "Create Workflow Variable",
    }),
  );
}

async function enterVariable(user: UserEvent, name: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
    target: { value: name },
  });
  fireEvent.change(screen.getByPlaceholderText(DESCRIPTION_PLACEHOLDER), {
    target: { value: "The key PagerDuty gave us" },
  });
  await next(user);
  await screen.findByPlaceholderText(CONTENT_PLACEHOLDER);
}

function createdModel(): WorkflowVariable {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: WorkflowVariable })
    .model;
}

describe.each<Page>(["global", "local"])(
  "Create Workflow Variable, on the %s variables page",
  (page: Page) => {
    beforeEach(() => {
      createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
      successMock.mockReset();
    });

    afterEach(() => {
      cleanup();
    });

    test("opens on the Variable step, asking only for the name and description", async () => {
      await renderForm(page);

      expect(activeStep()).toBe("Variable");
      expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeVisible();
      expect(
        screen.getByPlaceholderText(DESCRIPTION_PLACEHOLDER),
      ).toBeVisible();
      expect(
        screen.queryByPlaceholderText(CONTENT_PLACEHOLDER),
      ).not.toBeInTheDocument();
      expect(
        within(dialog()).queryByRole("switch", { name: /^Secret/ }),
      ).not.toBeInTheDocument();
    });

    test("lists the two steps, Variable then Value, with no Back button", async () => {
      await renderForm(page);

      const titles: Array<string> = Array.from(
        progress().querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      });

      expect(titles).toEqual(["Variable", "Value"]);
      expect(
        within(dialog()).queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      // Not the last step yet, so the main button moves on rather than saves.
      expect(
        within(dialog()).getByRole("button", { name: "Next" }),
      ).toBeVisible();
      expect(
        within(dialog()).queryByRole("button", {
          name: "Create Workflow Variable",
        }),
      ).not.toBeInTheDocument();
    });

    test("does not leave the Variable step without a name", async () => {
      const user: UserEvent = await renderForm(page);

      await next(user);

      expect(await screen.findByText("Name is required.")).toBeVisible();
      expect(activeStep()).toBe("Variable");
      expect(
        screen.queryByPlaceholderText(CONTENT_PLACEHOLDER),
      ).not.toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("does not leave the Variable step with a name a workflow cannot refer to", async () => {
      const user: UserEvent = await renderForm(page);

      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: "API KEY" },
      });
      await next(user);

      await waitFor(() => {
        expect(within(dialog()).getAllByRole("alert").length).toBeGreaterThan(
          0,
        );
      });
      expect(activeStep()).toBe("Variable");
      expect(
        screen.queryByPlaceholderText(CONTENT_PLACEHOLDER),
      ).not.toBeInTheDocument();
    });

    test("moves to the Value step, asking for the content and the secret switch", async () => {
      const user: UserEvent = await renderForm(page);

      await enterVariable(user, "PAGERDUTY_KEY");

      expect(activeStep()).toBe("Value");
      expect(screen.getByPlaceholderText(CONTENT_PLACEHOLDER)).toBeVisible();
      expect(secretSwitch()).toBeVisible();
      expect(secretSwitch()).toHaveAttribute("aria-checked", "false");
      expect(
        screen.queryByPlaceholderText(NAME_PLACEHOLDER),
      ).not.toBeInTheDocument();
      // The last step: the main button now creates the variable.
      expect(
        await within(dialog()).findByRole("button", {
          name: "Create Workflow Variable",
        }),
      ).toBeVisible();
      expect(
        within(dialog()).queryByRole("button", { name: "Next" }),
      ).not.toBeInTheDocument();
    });

    test("does not create a variable without content", async () => {
      const user: UserEvent = await renderForm(page);

      await enterVariable(user, "PAGERDUTY_KEY");
      await create(user);

      expect(await screen.findByText("Content is required.")).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("keeps what was typed when going back to the Variable step and on again", async () => {
      const user: UserEvent = await renderForm(page);

      await enterVariable(user, "PAGERDUTY_KEY");
      fireEvent.change(screen.getByPlaceholderText(CONTENT_PLACEHOLDER), {
        target: { value: "pd-secret-value" },
      });

      await user.click(within(progress()).getByText("Variable"));
      await waitFor(() => {
        expect(activeStep()).toBe("Variable");
      });
      expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toHaveValue(
        "PAGERDUTY_KEY",
      );
      expect(screen.getByPlaceholderText(DESCRIPTION_PLACEHOLDER)).toHaveValue(
        "The key PagerDuty gave us",
      );

      await next(user);
      expect(
        await screen.findByPlaceholderText(CONTENT_PLACEHOLDER),
      ).toHaveValue("pd-secret-value");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("creates the variable with everything both steps asked for", async () => {
      const user: UserEvent = await renderForm(page);

      await enterVariable(user, "PAGERDUTY_KEY");
      fireEvent.change(screen.getByPlaceholderText(CONTENT_PLACEHOLDER), {
        target: { value: "pd-secret-value" },
      });
      await user.click(secretSwitch());
      await waitFor(() => {
        expect(secretSwitch()).toHaveAttribute("aria-checked", "true");
      });

      await create(user);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
        expect(successMock).toHaveBeenCalledTimes(1);
      });

      const model: WorkflowVariable = createdModel();

      expect(model.name).toBe("PAGERDUTY_KEY");
      expect(model.description).toBe("The key PagerDuty gave us");
      expect(model.content).toBe("pd-secret-value");
      expect(model.isSecret).toBe(true);
      expect(model.variableType).toBe(WorkflowVariableType.Static);

      if (page === "local") {
        expect(model.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
      } else {
        expect(model.workflowId).toBeUndefined();
      }
    });

    test("creates a variable that is not secret when the switch is left off", async () => {
      const user: UserEvent = await renderForm(page);

      await enterVariable(user, "STATUS_URL");
      fireEvent.change(screen.getByPlaceholderText(CONTENT_PLACEHOLDER), {
        target: { value: "https://status.example.com" },
      });
      await create(user);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      expect(createdModel().name).toBe("STATUS_URL");
      expect(createdModel().content).toBe("https://status.example.com");
      expect(createdModel().isSecret).toBe(false);
    });
  },
);
