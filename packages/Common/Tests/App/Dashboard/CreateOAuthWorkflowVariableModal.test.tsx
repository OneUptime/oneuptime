import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Create OAuth 2.0 Variable" - the form behind the More menu beside the
 * variables list's Create button, on both Workflows > Global Variables and a
 * workflow's own Workflow Variables.
 *
 * The list's Create button only ever makes a static variable now, so this form
 * is the one place OAuth 2.0 variables come from. It must never ask which kind
 * of variable it is creating (the old combined form did, with a card picker
 * and a Value step that showed or hid depending on the answer): it stamps
 * OAuth 2.0 itself before it saves.
 *
 * ModelFormModal is replaced by a prop recorder. What is under test is the
 * configuration this component hands it - the real one would render the whole
 * ModelForm and post to the API on submit.
 */

type FormValuesForTest = Record<string, unknown>;

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  fieldType?: string | undefined;
  required?: boolean | ((values: FormValuesForTest) => boolean) | undefined;
  defaultValue?: unknown;
  description?: string | undefined;
  placeholder?: string | undefined;
  disableSpellCheck?: boolean | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  dropdownOptions?: Array<{ value: unknown; label: string }> | undefined;
  cardSelectOptions?: Array<{ value: string; title: string }> | undefined;
  validation?: Record<string, unknown> | undefined;
  showIf?: ((values: FormValuesForTest) => boolean) | undefined;
  customValidation?: ((values: FormValuesForTest) => string | null) | undefined;
};

type FormStepEntry = {
  id: string;
  title: string;
  showIf?: ((values: FormValuesForTest) => boolean) | undefined;
};

type CapturedModalProps = {
  modelType?: unknown;
  title: string;
  name?: string | undefined;
  description?: string | undefined;
  submitButtonText?: string | undefined;
  modalWidth?: unknown;
  modelIdToEdit?: unknown;
  initialValues?: unknown;
  onClose?: (() => void) | undefined;
  onSuccess?: ((item: unknown) => void) | undefined;
  onBeforeCreate?:
    | ((
        item: unknown,
        miscDataProps: Record<string, unknown>,
      ) => Promise<unknown>)
    | undefined;
  formProps: {
    id?: string | undefined;
    name?: string | undefined;
    modelType?: unknown;
    formType?: unknown;
    steps?: Array<FormStepEntry> | undefined;
    fields: Array<FormFieldEntry>;
  };
};

let capturedModalProps: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): ReactElement => {
      capturedModalProps = props;
      return <div data-testid="model-form-modal" />;
    },
  };
});

import CreateOAuthWorkflowVariableModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateOAuthWorkflowVariableModal";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * Everything the form asks for, in the order it asks: the variable's name and
 * description, then the grant, the token URL and the credentials in the order
 * a provider's console lists them, then the optional settings.
 */
const EXPECTED_FIELD_ORDER: Array<string> = [
  "name",
  "description",
  "oauthGrantType",
  "oauthTokenUrl",
  "oauthClientId",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthScope",
  "oauthAdditionalParameters",
  "oauthClientAuthenticationMethod",
];

const OAUTH_STEP_FIELDS: Array<string> = EXPECTED_FIELD_ORDER.filter(
  (name: string) => {
    return name !== "name" && name !== "description";
  },
);

/*
 * The props of the modal rendered last. render() is synchronous, so right
 * after a render this is that render's modal.
 */
function lastModalProps(): CapturedModalProps {
  if (!capturedModalProps) {
    throw new Error("CreateOAuthWorkflowVariableModal rendered no form modal");
  }

  return capturedModalProps;
}

type OnCloseMock = ReturnType<typeof jest.fn<() => void>>;
type OnSuccessMock = ReturnType<typeof jest.fn<(item: unknown) => void>>;

interface RenderedModal {
  props: CapturedModalProps;
  onClose: OnCloseMock;
  onSuccess: OnSuccessMock;
}

function renderModal(workflowId?: ObjectID | undefined): RenderedModal {
  const onClose: OnCloseMock = jest.fn<() => void>();
  const onSuccess: OnSuccessMock = jest.fn<(item: unknown) => void>();

  render(
    <CreateOAuthWorkflowVariableModal
      workflowId={workflowId}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );

  return {
    props: lastModalProps(),
    onClose,
    onSuccess,
  };
}

function renderGlobal(): RenderedModal {
  return renderModal(undefined);
}

function renderLocal(): RenderedModal {
  return renderModal(WORKFLOW_ID);
}

function fieldName(entry: FormFieldEntry): string {
  return Object.keys(entry.field || {})[0] || "";
}

function fieldNames(props: CapturedModalProps): Array<string> {
  return props.formProps.fields.map((entry: FormFieldEntry) => {
    return fieldName(entry);
  });
}

function formField(props: CapturedModalProps, name: string): FormFieldEntry {
  const entry: FormFieldEntry | undefined = props.formProps.fields.find(
    (candidate: FormFieldEntry) => {
      return fieldName(candidate) === name;
    },
  );

  if (!entry) {
    throw new Error(`The OAuth create form has no field for "${name}"`);
  }

  return entry;
}

function isRequired(entry: FormFieldEntry, values: FormValuesForTest): boolean {
  if (typeof entry.required === "function") {
    return entry.required(values);
  }

  return Boolean(entry.required);
}

function dropdownValues(entry: FormFieldEntry): Array<unknown> {
  return (entry.dropdownOptions || []).map(
    (option: { value: unknown; label: string }) => {
      return option.value;
    },
  );
}

function additionalParametersError(
  props: CapturedModalProps,
  value: unknown,
): string | null | undefined {
  return formField(props, "oauthAdditionalParameters").customValidation?.({
    oauthAdditionalParameters: value,
  });
}

async function runBeforeCreate(
  props: CapturedModalProps,
  item: WorkflowVariable,
): Promise<WorkflowVariable> {
  if (!props.onBeforeCreate) {
    throw new Error("The OAuth create form has no onBeforeCreate");
  }

  return (await props.onBeforeCreate(item, {})) as WorkflowVariable;
}

beforeEach(() => {
  capturedModalProps = null;
});

afterEach(() => {
  cleanup();
});

describe("the modal", () => {
  test("renders the form modal", () => {
    renderLocal();

    expect(screen.getByTestId("model-form-modal")).toBeInTheDocument();
  });

  test('is titled, and submits as, "Create OAuth 2.0 Variable"', () => {
    for (const rendered of [renderGlobal(), renderLocal()]) {
      expect(rendered.props.title).toBe("Create OAuth 2.0 Variable");
      expect(rendered.props.submitButtonText).toBe("Create OAuth 2.0 Variable");
    }
  });

  test("explains that OneUptime fetches the access token itself", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(props.description).toContain(
      "OneUptime fetches an access token from your identity provider",
    );
  });

  test("names the modal and the form for analytics", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(props.name).toBe("Workflow > Create OAuth 2.0 Variable");
    expect(props.formProps.name).toBe("Workflow > Create OAuth 2.0 Variable");
    expect(props.formProps.id).toBe("create-oauth-workflow-variable-form");
  });

  // Two steps of settings do not fit a normal-width modal.
  test("is a medium-width modal", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(props.modalWidth).toBe(ModalWidth.Medium);
  });

  test("creates a new WorkflowVariable rather than editing one", () => {
    for (const rendered of [renderGlobal(), renderLocal()]) {
      expect(rendered.props.modelType).toBe(WorkflowVariable);
      expect(rendered.props.formProps.modelType).toBe(WorkflowVariable);
      expect(rendered.props.formProps.formType).toBe(FormType.Create);
      expect(rendered.props.modelIdToEdit).toBeUndefined();
    }
  });
});

describe("the steps", () => {
  test("are Variable then OAuth 2.0", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(
      (props.formProps.steps || []).map((step: FormStepEntry) => {
        return { id: step.id, title: step.title };
      }),
    ).toEqual([
      { id: "variable", title: "Variable" },
      { id: "oauth", title: "OAuth 2.0" },
    ]);
  });

  /*
   * The old combined form had a Value step shown only for a Static variable
   * and an OAuth step shown only for an OAuth one. This form makes only one
   * kind of variable, so neither is conditional and there is no Value step.
   */
  test("has no Value step, and no step that depends on the variable type", () => {
    const props: CapturedModalProps = renderLocal().props;

    for (const step of props.formProps.steps || []) {
      expect(step.id).not.toBe("value");
      expect(step.title).not.toBe("Value");
      expect(step.showIf).toBeUndefined();
    }
  });

  test("puts the name and description on the Variable step", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(formField(props, "name").stepId).toBe("variable");
    expect(formField(props, "description").stepId).toBe("variable");
  });

  test("puts every OAuth setting on the OAuth 2.0 step", () => {
    const props: CapturedModalProps = renderLocal().props;

    for (const name of OAUTH_STEP_FIELDS) {
      expect(formField(props, name).stepId).toBe("oauth");
    }
  });

  test("leaves no field off a step", () => {
    const stepIds: Array<string> = ["variable", "oauth"];

    for (const rendered of [renderGlobal(), renderLocal()]) {
      for (const entry of rendered.props.formProps.fields) {
        expect(stepIds).toContain(entry.stepId);
      }
    }
  });
});

describe("the fields", () => {
  test("ask for everything an OAuth 2.0 variable needs, in order", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(fieldNames(props)).toEqual(EXPECTED_FIELD_ORDER);
  });

  test("are the same for a global and a local variable", () => {
    expect(fieldNames(renderGlobal().props)).toEqual(
      fieldNames(renderLocal().props),
    );
  });

  /*
   * The user's ask: this form never offers a choice between Static and
   * OAuth 2.0, and never asks for a static value or the secret toggle.
   */
  test("never ask for the variable type, a static value or the secret toggle", () => {
    for (const rendered of [renderGlobal(), renderLocal()]) {
      const names: Array<string> = fieldNames(rendered.props);

      expect(names).not.toContain("variableType");
      expect(names).not.toContain("content");
      expect(names).not.toContain("isSecret");

      for (const entry of rendered.props.formProps.fields) {
        expect(entry.fieldType).not.toBe(FormFieldSchemaType.CardSelect);
        expect(entry.cardSelectOptions).toBeUndefined();
      }
    }
  });

  // OneUptime writes these; nobody may type them in.
  test("never ask for the access token or its bookkeeping", () => {
    const names: Array<string> = fieldNames(renderLocal().props);

    for (const name of [
      "oauthAccessToken",
      "oauthAccessTokenExpiresAt",
      "oauthLastRefreshedAt",
      "oauthLastRefreshError",
      "oauthLastRefreshErrorAt",
      "workflowId",
      "projectId",
    ]) {
      expect(names).not.toContain(name);
    }
  });

  /*
   * With only one kind of variable on this form, nothing is shown or hidden
   * by the variable type any more. The refresh token is the one conditional
   * field, and it depends on the grant.
   */
  test("only the refresh token is conditional", () => {
    const props: CapturedModalProps = renderLocal().props;

    for (const entry of props.formProps.fields) {
      if (fieldName(entry) === "oauthRefreshToken") {
        expect(entry.showIf).toBeDefined();
        continue;
      }

      expect(entry.showIf).toBeUndefined();
    }
  });

  test("give every field a title", () => {
    const props: CapturedModalProps = renderLocal().props;

    for (const entry of props.formProps.fields) {
      expect(entry.title).toBeTruthy();
    }
  });
});

describe("the name field", () => {
  test("is required and must be a single identifier", () => {
    const field: FormFieldEntry = formField(renderLocal().props, "name");

    expect(field.fieldType).toBe(FormFieldSchemaType.Text);
    expect(field.required).toBe(true);
    expect(field.validation).toEqual(
      expect.objectContaining({
        minLength: 2,
        noSpaces: true,
        noSpecialCharacters: true,
      }),
    );
  });

  test("shows a global variable's reference for a global variable", () => {
    const description: string =
      formField(renderGlobal().props, "name").description || "";

    expect(description).toContain("{{global.variables.THIS_NAME}}");
    expect(description).not.toContain("{{local.variables.");
  });

  test("shows a local variable's reference for a workflow's own variable", () => {
    const description: string =
      formField(renderLocal().props, "name").description || "";

    expect(description).toContain("{{local.variables.THIS_NAME}}");
    expect(description).not.toContain("{{global.variables.");
  });

  // Nothing links a workflow to the variable it names, so a rename breaks it.
  test("warns that renaming does not update workflows", () => {
    for (const rendered of [renderGlobal(), renderLocal()]) {
      expect(formField(rendered.props, "name").description).toContain(
        "Renaming it does not update workflows that already refer to the old name.",
      );
    }
  });
});

describe("the description field", () => {
  test("is optional long text", () => {
    const field: FormFieldEntry = formField(renderLocal().props, "description");

    expect(field.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(field.required).toBe(false);
  });
});

describe("the grant type", () => {
  test("is a required dropdown, Client Credentials by default", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthGrantType",
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.required).toBe(true);
    expect(field.defaultValue).toBe(OAuth2GrantType.ClientCredentials);
  });

  test("offers both grants", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthGrantType",
    );

    expect(dropdownValues(field)).toEqual([
      OAuth2GrantType.ClientCredentials,
      OAuth2GrantType.RefreshToken,
    ]);
  });

  // The grant is fixed once saved, and the form should say so up front.
  test("says it is fixed once saved", () => {
    expect(
      formField(renderLocal().props, "oauthGrantType").description,
    ).toContain("Fixed once saved.");
  });
});

describe("the token URL and client ID", () => {
  test("are both required", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(formField(props, "oauthTokenUrl").required).toBe(true);
    expect(formField(props, "oauthClientId").required).toBe(true);
  });

  test("the token URL is typed as a URL", () => {
    expect(formField(renderLocal().props, "oauthTokenUrl").fieldType).toBe(
      FormFieldSchemaType.URL,
    );
  });

  test("the client ID is plain text", () => {
    expect(formField(renderLocal().props, "oauthClientId").fieldType).toBe(
      FormFieldSchemaType.Text,
    );
  });

  // An endpoint or an ID with an autocorrected letter fails for no visible reason.
  test("turn off spell check", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(formField(props, "oauthTokenUrl").disableSpellCheck).toBe(true);
    expect(formField(props, "oauthClientId").disableSpellCheck).toBe(true);
  });
});

describe("the client secret", () => {
  test("is encrypted text", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthClientSecret",
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.EncryptedText);
    expect(field.disableSpellCheck).toBe(true);
  });

  test("is required depending on the grant, not always", () => {
    expect(
      typeof formField(renderLocal().props, "oauthClientSecret").required,
    ).toBe("function");
  });

  // A public client has no secret; client credentials cannot work without one.
  test("is required for client credentials but not for a refresh token", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthClientSecret",
    );

    expect(
      isRequired(field, { oauthGrantType: OAuth2GrantType.ClientCredentials }),
    ).toBe(true);
    expect(
      isRequired(field, { oauthGrantType: OAuth2GrantType.RefreshToken }),
    ).toBe(false);
  });

  // Client Credentials is the default grant, so an untouched form needs it.
  test("is required before a grant has been picked", () => {
    expect(
      isRequired(formField(renderLocal().props, "oauthClientSecret"), {}),
    ).toBe(true);
  });

  test("says how to replace it later", () => {
    expect(
      formField(renderLocal().props, "oauthClientSecret").description,
    ).toContain("Update Credentials");
  });
});

describe("the refresh token", () => {
  test("is shown only for the Refresh Token grant", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthRefreshToken",
    );

    expect(
      field.showIf?.({ oauthGrantType: OAuth2GrantType.RefreshToken }),
    ).toBe(true);
    expect(
      field.showIf?.({ oauthGrantType: OAuth2GrantType.ClientCredentials }),
    ).toBe(false);
    expect(field.showIf?.({})).toBe(false);
  });

  /*
   * The old combined form also required variableType OAuth 2.0 for this to
   * show. There is no type on this form any more, so the grant alone decides.
   */
  test("does not depend on a variable type", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthRefreshToken",
    );

    expect(
      field.showIf?.({
        oauthGrantType: OAuth2GrantType.RefreshToken,
        variableType: WorkflowVariableType.Static,
      }),
    ).toBe(true);
  });

  test("is required whenever it is shown, and encrypted", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthRefreshToken",
    );

    expect(field.required).toBe(true);
    expect(field.fieldType).toBe(FormFieldSchemaType.EncryptedText);
  });
});

describe("the optional settings", () => {
  test("scope, additional parameters and client authentication are optional", () => {
    const props: CapturedModalProps = renderLocal().props;

    for (const name of [
      "oauthScope",
      "oauthAdditionalParameters",
      "oauthClientAuthenticationMethod",
    ]) {
      expect(formField(props, name).required).toBe(false);
    }
  });

  test("additional parameters are a dictionary", () => {
    expect(
      formField(renderLocal().props, "oauthAdditionalParameters").fieldType,
    ).toBe(FormFieldSchemaType.Dictionary);
  });

  test("client authentication is a dropdown of both methods, HTTP Basic by default", () => {
    const field: FormFieldEntry = formField(
      renderLocal().props,
      "oauthClientAuthenticationMethod",
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.defaultValue).toBe(
      DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
    );
    expect(field.defaultValue).toBe(
      OAuth2ClientAuthenticationMethod.BasicAuthHeader,
    );
    expect(dropdownValues(field)).toEqual([
      OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      OAuth2ClientAuthenticationMethod.RequestBody,
    ]);
  });
});

describe("the additional parameters check", () => {
  test("refuses a reserved additional parameter before submitting", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(additionalParametersError(props, { client_secret: "x" })).toContain(
      "cannot be set as an additional parameter",
    );
  });

  // Each of these is set from the variable's other settings.
  test("refuses every reserved parameter, by name", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS.length).toBeGreaterThan(0);

    for (const reserved of RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS) {
      expect(additionalParametersError(props, { [reserved]: "x" })).toBe(
        `"${reserved}" cannot be set as an additional parameter - OneUptime sets it from the variable's other settings.`,
      );
    }
  });

  test("refuses a reserved parameter whatever its case or surrounding spaces", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(additionalParametersError(props, { Grant_Type: "x" })).toContain(
      "cannot be set as an additional parameter",
    );
    expect(additionalParametersError(props, { " scope ": "x" })).toContain(
      "cannot be set as an additional parameter",
    );
  });

  test("accepts a normal parameter", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(additionalParametersError(props, { audience: "x" })).toBeNull();
    expect(
      additionalParametersError(props, {
        audience: "https://api.example.com",
        resource: "https://graph.microsoft.com",
      }),
    ).toBeNull();
  });

  // The key/value editor can hand over numbers and booleans.
  test("accepts numbers and true/false as values", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(
      additionalParametersError(props, { max_age: 3600, prompt: false }),
    ).toBeNull();
  });

  test("accepts no additional parameters at all", () => {
    const props: CapturedModalProps = renderLocal().props;

    expect(additionalParametersError(props, undefined)).toBeNull();
    expect(additionalParametersError(props, null)).toBeNull();
    expect(additionalParametersError(props, {})).toBeNull();
  });

  test("refuses a parameter with no name", () => {
    expect(additionalParametersError(renderLocal().props, { "  ": "x" })).toBe(
      "Every additional parameter needs a name.",
    );
  });

  test("refuses a value that is not text, a number or true/false", () => {
    expect(
      additionalParametersError(renderLocal().props, {
        audience: { nested: "x" },
      }),
    ).toBe(
      'The additional parameter "audience" must be text, a number or true/false.',
    );
  });

  test("warns that the parameters are readable", () => {
    expect(
      formField(renderLocal().props, "oauthAdditionalParameters").description,
    ).toContain("do not put secrets here");
  });
});

describe("before the variable is created", () => {
  test("stamps OAuth 2.0 and the workflow on a workflow's own variable", async () => {
    const props: CapturedModalProps = renderLocal().props;

    const item: WorkflowVariable = new WorkflowVariable();
    item.name = "API_TOKEN";

    const result: WorkflowVariable = await runBeforeCreate(props, item);

    expect(result.variableType).toBe(WorkflowVariableType.OAuth2);
    expect(result.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
  });

  test("stamps OAuth 2.0 and leaves the workflow unset on a global variable", async () => {
    const props: CapturedModalProps = renderGlobal().props;

    const item: WorkflowVariable = new WorkflowVariable();
    item.name = "API_TOKEN";

    const result: WorkflowVariable = await runBeforeCreate(props, item);

    expect(result.variableType).toBe(WorkflowVariableType.OAuth2);
    expect(result.workflowId).toBeUndefined();
  });

  /*
   * Whatever arrives, this form makes an OAuth 2.0 variable - a stray Static
   * would save a variable with OAuth settings and no content.
   */
  test("overrides any other variable type", async () => {
    const props: CapturedModalProps = renderLocal().props;

    const item: WorkflowVariable = new WorkflowVariable();
    item.variableType = WorkflowVariableType.Static;

    const result: WorkflowVariable = await runBeforeCreate(props, item);

    expect(result.variableType).toBe(WorkflowVariableType.OAuth2);
  });

  test("keeps what the form filled in", async () => {
    const props: CapturedModalProps = renderLocal().props;

    const item: WorkflowVariable = new WorkflowVariable();
    item.name = "API_TOKEN";
    item.description = "Graph API";
    item.oauthGrantType = OAuth2GrantType.RefreshToken;
    item.oauthTokenUrl = "https://login.example.com/oauth2/token";
    item.oauthClientId = "client-id";

    const result: WorkflowVariable = await runBeforeCreate(props, item);

    expect(result).toBe(item);
    expect(result.name).toBe("API_TOKEN");
    expect(result.description).toBe("Graph API");
    expect(result.oauthGrantType).toBe(OAuth2GrantType.RefreshToken);
    expect(result.oauthTokenUrl).toBe("https://login.example.com/oauth2/token");
    expect(result.oauthClientId).toBe("client-id");
  });
});

describe("the callbacks", () => {
  test("closing the modal calls onClose", () => {
    const rendered: RenderedModal = renderLocal();

    rendered.props.onClose?.();

    expect(rendered.onClose).toHaveBeenCalledTimes(1);
    expect(rendered.onSuccess).not.toHaveBeenCalled();
  });

  test("a created variable is handed to onSuccess", () => {
    const rendered: RenderedModal = renderGlobal();

    const created: WorkflowVariable = new WorkflowVariable();
    created.name = "API_TOKEN";
    created.variableType = WorkflowVariableType.OAuth2;

    rendered.props.onSuccess?.(created);

    expect(rendered.onSuccess).toHaveBeenCalledTimes(1);
    expect(rendered.onSuccess).toHaveBeenCalledWith(created);
    expect(rendered.onClose).not.toHaveBeenCalled();
  });
});
