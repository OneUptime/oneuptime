/*
 * What the variables list (Workflow > Global Variables and Workflow > View >
 * Workflow Variables) and a variable's own page share: where each page lives,
 * the create forms, the OAuth token refresh call and how its result is worded.
 *
 * The list used to do everything itself - row actions for Show ID, Update
 * Content, Update Credentials, Edit Details and Delete, and a Token column with
 * its own Refresh now button. It now lists and creates; everything done to one
 * variable happens on that variable's page.
 */

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  getOAuth2AdditionalParametersError,
  isOAuth2WorkflowVariable,
  toDateOrNull,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import React, { ReactElement } from "react";
import OAuthProviderHint from "../../Components/Workflow/OAuthProviderHint";
import PageMap from "../PageMap";
import RouteMap, { RouteUtil } from "../RouteMap";
import {
  DEFAULT_OAUTH_GRANT_TYPE,
  OAUTH_IDENTITY_PROVIDER_DROPDOWN_OPTIONS,
  OAUTH_IDENTITY_PROVIDER_FIELD_KEY,
  OAuthProviderHintField,
  applyOAuthIdentityProviderPreset,
  getOAuthTokenUrlPlaceholderError,
} from "./OAuthIdentityProviders";

export interface OAuthTokenRefreshResult {
  expiresAt: Date | null;
}

/*
 * POST /workflow-variable/:id/refresh-oauth-token. A custom route, so it is
 * reached with a raw API.post - and only ModelAPI.getCommonHeaders() adds the
 * `tenantid` header the route scopes the request by.
 *
 * The answer never carries the token, only when the new one expires.
 */
export async function refreshWorkflowVariableOAuthToken(
  variableId: ObjectID,
): Promise<OAuthTokenRefreshResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `/workflow-variable/${variableId.toString()}/refresh-oauth-token`,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return {
    expiresAt: toDateOrNull(response.data?.["oauthAccessTokenExpiresAt"]),
  };
}

export interface TokenRefreshOutcome {
  variableName: string;
  // Set when the refresh followed a save, so the result can say both.
  savedWhat?: string | undefined;
  expiresAt?: Date | null | undefined;
  error?: string | undefined;
}

/*
 * Asks for a new token and describes what happened, rather than throwing: every
 * caller shows the outcome in the same modal, success or not.
 */
export async function fetchTokenRefreshOutcome(data: {
  variable: WorkflowVariable;
  savedWhat?: string | undefined;
}): Promise<TokenRefreshOutcome> {
  const variableName: string = data.variable.name || "this variable";

  if (!data.variable.id) {
    return {
      variableName,
      savedWhat: data.savedWhat,
      error: "This variable has no id. Refresh the page and try again.",
    };
  }

  try {
    const result: OAuthTokenRefreshResult =
      await refreshWorkflowVariableOAuthToken(data.variable.id);

    return {
      variableName,
      savedWhat: data.savedWhat,
      expiresAt: result.expiresAt,
    };
  } catch (err) {
    return {
      variableName,
      savedWhat: data.savedWhat,
      error: API.getFriendlyMessage(err),
    };
  }
}

export function getTokenRefreshTitle(outcome: TokenRefreshOutcome): string {
  return outcome.error
    ? "Could Not Fetch an Access Token"
    : "Access Token Fetched";
}

export function getTokenRefreshDescription(
  outcome: TokenRefreshOutcome,
): string {
  const saved: string = outcome.savedWhat ? `${outcome.savedWhat} saved. ` : "";

  /*
   * Worded without blaming anybody. Not every failure is the identity provider
   * saying no: some never reach it (no token URL saved, the caller may not
   * update the variable, the variable was deleted in another tab, a network
   * error), and the ones that do already say so themselves - "The token
   * endpoint refused the request (HTTP 400): invalid_grant - ...".
   */
  if (outcome.error) {
    return `${saved}OneUptime could not fetch an access token for "${outcome.variableName}": ${outcome.error}`;
  }

  return `${saved}OneUptime fetched a new access token for "${outcome.variableName}" from your identity provider. ${
    outcome.expiresAt
      ? `It is valid until ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          outcome.expiresAt,
        )}, and a new one is fetched automatically whenever a workflow is about to use it after that.`
      : "The provider did not say when it expires, so every workflow run fetches a new one."
  }`;
}

/*
 * The Type field on the variable's own page. The variables list has no Type
 * column; this page is where a variable's type is shown.
 */
export function getVariableTypeLabel(variable: WorkflowVariable): string {
  return isOAuth2WorkflowVariable(variable.variableType)
    ? "OAuth 2.0"
    : "Static";
}

/*
 * How a workflow refers to a variable. Global variables live under `global`,
 * a workflow's own under `local`.
 */
export function getWorkflowVariableReference(data: {
  name: string;
  isGlobal: boolean;
}): string {
  return `{{${data.isGlobal ? "global" : "local"}.variables.${data.name}}}`;
}

/*
 * The list a variable belongs on: the project's global variables, or the
 * variables of the workflow it is local to.
 */
export function getWorkflowVariablesListRoute(
  workflowId?: ObjectID | undefined,
): Route {
  if (workflowId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.WORKFLOW_VARIABLES] as Route,
      { modelId: workflowId },
    );
  }

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route,
  );
}

/*
 * A variable's own page. A global variable's page sits under Workflows >
 * Global Variables; a local one's under the workflow it belongs to, so the
 * workflow's side menu stays on screen.
 */
export function getWorkflowVariableViewRoute(data: {
  variableId: ObjectID;
  workflowId?: ObjectID | undefined;
}): Route {
  if (data.workflowId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.WORKFLOW_VARIABLE_VIEW] as Route,
      { modelId: data.workflowId, subModelId: data.variableId },
    );
  }

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.WORKFLOWS_VARIABLE_VIEW] as Route,
    { modelId: data.variableId },
  );
}

/*
 * Two choices, shown side by side as radio buttons rather than hidden in a
 * dropdown under a paragraph that explained both: each label says what its
 * grant is for.
 */
export const GRANT_TYPE_OPTIONS: Array<RadioButton> = [
  {
    value: OAuth2GrantType.ClientCredentials,
    title: "Client Credentials (machine-to-machine)",
  },
  {
    value: OAuth2GrantType.RefreshToken,
    title: "Refresh Token (delegated access for a user)",
  },
];

export const CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS: Array<DropdownOption> = [
  {
    value: OAuth2ClientAuthenticationMethod.BasicAuthHeader,
    label: "HTTP Basic header (client_secret_basic)",
  },
  {
    value: OAuth2ClientAuthenticationMethod.RequestBody,
    label: "Request body (client_secret_post)",
  },
];

export function getClientAuthenticationLabel(
  method: OAuth2ClientAuthenticationMethod | string | undefined,
): string {
  const option: DropdownOption | undefined =
    CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS.find((item: DropdownOption) => {
      return (
        item.value === (method || DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD)
      );
    });

  return option ? option.label : String(method || "");
}

/*
 * The rename warning is not decoration. Nothing links a workflow's graph to
 * the variable row it names: the builder's linter checks that a reference is
 * well formed but leaves its existence to the API, and at run time VMAPI skips
 * a reference it cannot resolve - so a workflow left pointing at the old name
 * posts the literal braces and still reports Success.
 */
export function getVariableNameFormField(data: {
  isGlobal: boolean;
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      name: true,
    },
    title: "Name",
    stepId: data.stepId,
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "API_KEY",
    description: `Workflows refer to this variable by name, as ${getWorkflowVariableReference(
      { name: "THIS_NAME", isGlobal: data.isGlobal },
    )}. Renaming it does not update workflows that already refer to the old name.`,
    validation: {
      minLength: 2,
      noSpaces: true,
      noSpecialCharacters: true,
    },
  };
}

export function getVariableDescriptionFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      description: true,
    },
    title: "Description",
    stepId: data?.stepId,
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: "What this variable is for",
  };
}

/*
 * The copy this replaces asked "Should this be encrypted in the Database?",
 * which was not true of this column - content carries no `encrypted: true` and
 * the DDL is a plain text column. Somebody reading it while turning the toggle
 * on would come away believing a database dump was no longer a credential
 * exposure.
 */
export const SECRET_TOGGLE_DESCRIPTION: string =
  "Keep this variable's content out of workflow run logs - every run replaces it with [REDACTED] before the log is saved. It applies to future runs only, and it cannot be turned off again once saved.";

export function getSecretFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      isSecret: true,
    },
    title: "Secret",
    stepId: data?.stepId,
    description: SECRET_TOGGLE_DESCRIPTION,
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
  };
}

/*
 * The create form's two steps. Four fields with long help texts made one
 * scrolling page; split, each step asks one question: what the variable is
 * called, then what it holds. The secret switch sits with the value because
 * it is about the value - whether runs may print it.
 */
export const STATIC_VARIABLE_FORM_STEPS: Array<FormStep<WorkflowVariable>> = [
  {
    title: "Variable",
    id: "variable",
  },
  {
    title: "Value",
    id: "value",
  },
];

/*
 * The create form of the list's Create button. A static variable only: the
 * value is pasted in and used as saved. OAuth 2.0 variables have a form of
 * their own, behind the list's More menu, so this one never asks which kind
 * of variable it is creating.
 */
export function getStaticVariableCreateFormFields(data: {
  isGlobal: boolean;
}): Array<ModelField<WorkflowVariable>> {
  return [
    getVariableNameFormField({ isGlobal: data.isGlobal, stepId: "variable" }),
    getVariableDescriptionFormField({ stepId: "variable" }),
    {
      field: {
        content: true,
      },
      title: "Content",
      stepId: "value",
      description:
        "The value workflows use, such as an API key or a URL. It cannot be viewed once saved - open the variable to replace it.",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: "Content of the variable",
    },
    getSecretFormField({ stepId: "value" }),
  ];
}

/*
 * The Create OAuth 2.0 Variable form's steps. It used to ask everything after
 * the name on one step - grant type, token URL with a paragraph of provider
 * URL templates, client ID, client secret, refresh token, scope, additional
 * parameters and client authentication - so the second page was one long
 * scroll. Each step now asks one question:
 *
 *  - Variable: what workflows call it.
 *  - Provider: which identity provider issues the token, its token URL
 *    (filled in for the provider picked) and the grant to ask it for.
 *  - Credentials: what OneUptime signs in with - the client ID and secret,
 *    and the refresh token for that grant.
 *  - Advanced: the optional settings - scope, extra parameters and how the
 *    client authenticates. Last, so the Create button is right there for
 *    the many variables that need none of them.
 */
export const OAUTH_VARIABLE_FORM_STEPS: Array<FormStep<WorkflowVariable>> = [
  {
    title: "Variable",
    id: "variable",
  },
  {
    title: "Provider",
    id: "provider",
  },
  {
    title: "Credentials",
    id: "credentials",
  },
  {
    title: "Advanced",
    id: "advanced",
  },
];

/*
 * The variable page's Edit Settings form walks the same steps as the create
 * form, less Variable (the variable's details have a card of their own), so
 * each setting is under the same step name in both. Its Provider step holds
 * only the token URL - the provider is not saved and the grant is fixed once
 * saved - and its Credentials step only the client ID, as the client secret
 * and refresh token are replaced with Update Credentials.
 */
export const OAUTH_SETTINGS_FORM_STEPS: Array<FormStep<WorkflowVariable>> = [
  {
    title: "Provider",
    id: "provider",
  },
  {
    title: "Credentials",
    id: "credentials",
  },
  {
    title: "Advanced",
    id: "advanced",
  },
];

// The line of help the provider picked on the create form adds under a field.
function renderOAuthProviderHint(
  values: FormValues<WorkflowVariable>,
  field: OAuthProviderHintField,
): ReactElement {
  return React.createElement(OAuthProviderHint, {
    values: values as Record<string, unknown>,
    field,
  });
}

/*
 * The provider picker. Not a column: it only fills in the form, through
 * applyOAuthIdentityProviderPreset, and is never sent (formOnly). It is
 * registered against the token URL column (overrideField) because that is
 * what it fills in, so whoever may not set the token URL is not offered it
 * either.
 */
export function getOAuthIdentityProviderFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    overrideField: {
      oauthTokenUrl: true,
    },
    overrideFieldKey: OAUTH_IDENTITY_PROVIDER_FIELD_KEY,
    formOnly: true,
    title: "Identity Provider",
    stepId: data?.stepId,
    description:
      "OneUptime fills in the token URL for the provider you pick. Pick Other provider if yours is not listed.",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: OAUTH_IDENTITY_PROVIDER_DROPDOWN_OPTIONS,
    required: true,
    placeholder: "Choose your identity provider",
    onChange: (
      value: unknown,
      currentValues: FormValues<WorkflowVariable>,
      setNewFormValues: (values: FormValues<WorkflowVariable>) => void,
    ): void => {
      setNewFormValues(
        applyOAuthIdentityProviderPreset({
          values: currentValues as Record<string, unknown>,
          provider: value,
        }) as FormValues<WorkflowVariable>,
      );
    },
  };
}

const TOKEN_URL_DESCRIPTION: string =
  "Where OneUptime asks your identity provider for access tokens.";

export function getOAuthTokenUrlFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthTokenUrl: true,
    },
    title: "Token URL",
    stepId: data?.stepId,
    description: TOKEN_URL_DESCRIPTION,
    fieldType: FormFieldSchemaType.URL,
    required: true,
    placeholder: "https://login.example.com/oauth2/token",
    disableSpellCheck: true,
    // A preset's URL still holding {tenant-id} or {your-domain}.
    customValidation: (values: FormValues<WorkflowVariable>): string | null => {
      return getOAuthTokenUrlPlaceholderError(values["oauthTokenUrl"]);
    },
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthTokenUrl");
    },
  };
}

export function getOAuthGrantTypeFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthGrantType: true,
    },
    title: "Grant Type",
    stepId: data?.stepId,
    description:
      "How OneUptime signs in: as your application, or as a user who authorised it once. Fixed once saved.",
    fieldType: FormFieldSchemaType.RadioButton,
    radioButtonOptions: GRANT_TYPE_OPTIONS,
    required: true,
    defaultValue: DEFAULT_OAUTH_GRANT_TYPE,
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthGrantType");
    },
  };
}

export function getOAuthClientIdFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthClientId: true,
    },
    title: "Client ID",
    stepId: data?.stepId,
    description:
      "The client (application) ID of the application registered with your identity provider.",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "12345678-1234-1234-1234-123456789012",
    disableSpellCheck: true,
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthClientId");
    },
  };
}

export function getOAuthClientSecretFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthClientSecret: true,
    },
    title: "Client Secret",
    stepId: data?.stepId,
    description:
      "Encrypted, and never shown again once saved - open the variable and use Update Credentials to replace it. Optional for the Refresh Token grant if your application is a public client.",
    fieldType: FormFieldSchemaType.EncryptedText,
    required: (values: FormValues<WorkflowVariable>): boolean => {
      return values["oauthGrantType"] !== OAuth2GrantType.RefreshToken;
    },
    placeholder: "Client secret",
    disableSpellCheck: true,
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthClientSecret");
    },
  };
}

export function getOAuthRefreshTokenFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthRefreshToken: true,
    },
    title: "Refresh Token",
    stepId: data?.stepId,
    description:
      "The refresh token you got when you authorised the application, for example from your provider's OAuth playground. Encrypted, never shown again, and replaced automatically when your provider rotates it.",
    fieldType: FormFieldSchemaType.EncryptedText,
    required: true,
    placeholder: "Refresh token",
    disableSpellCheck: true,
    showIf: (values: FormValues<WorkflowVariable>): boolean => {
      return values["oauthGrantType"] === OAuth2GrantType.RefreshToken;
    },
  };
}

export function getOAuthScopeFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthScope: true,
    },
    title: "Scope",
    stepId: data?.stepId,
    description:
      "Space-separated scopes to request. Leave empty to get your provider's default scopes.",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "api.read api.write",
    disableSpellCheck: true,
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthScope");
    },
  };
}

export function getOAuthAdditionalParametersFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthAdditionalParameters: true,
    },
    title: "Additional Parameters",
    stepId: data?.stepId,
    description:
      "Extra form parameters for the token request, such as audience for Auth0 or resource for Azure AD v1. Anyone who can read this variable can read them, so do not put secrets here.",
    fieldType: FormFieldSchemaType.Dictionary,
    required: false,
    customValidation: (values: FormValues<WorkflowVariable>): string | null => {
      return getOAuth2AdditionalParametersError(
        values["oauthAdditionalParameters"],
      );
    },
    getFooterElement: (values: FormValues<WorkflowVariable>): ReactElement => {
      return renderOAuthProviderHint(values, "oauthAdditionalParameters");
    },
  };
}

export function getOAuthClientAuthenticationFormField(data?: {
  stepId?: string | undefined;
}): ModelField<WorkflowVariable> {
  return {
    field: {
      oauthClientAuthenticationMethod: true,
    },
    title: "Client Authentication",
    stepId: data?.stepId,
    description:
      "How the client ID and secret are sent. Most providers accept both; if yours answers invalid_client, try the other one.",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS,
    required: false,
    defaultValue: DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  };
}

/*
 * The OAuth settings anyone who can read the variable may read, and so may
 * edit in place: the variable's page edits these with the same fields its
 * create form uses, on the same steps (OAUTH_SETTINGS_FORM_STEPS). The client
 * secret and refresh token are write-only and never among them.
 */
export function getOAuthSettingsFormFields(): Array<
  ModelField<WorkflowVariable>
> {
  return [
    getOAuthTokenUrlFormField({ stepId: "provider" }),
    getOAuthClientIdFormField({ stepId: "credentials" }),
    getOAuthScopeFormField({ stepId: "advanced" }),
    getOAuthAdditionalParametersFormField({ stepId: "advanced" }),
    getOAuthClientAuthenticationFormField({ stepId: "advanced" }),
  ];
}

/*
 * The form behind "Create OAuth 2.0 Variable" in the list's More menu, on the
 * steps of OAUTH_VARIABLE_FORM_STEPS. The variable type is not on it: the form
 * only ever creates OAuth 2.0 variables, and stamps the type itself before it
 * saves. The settings shared with the variable page's edit form are built by
 * the same field builders, so the two describe them alike.
 */
export function getOAuthVariableCreateFormFields(data: {
  isGlobal: boolean;
}): Array<ModelField<WorkflowVariable>> {
  return [
    getVariableNameFormField({ isGlobal: data.isGlobal, stepId: "variable" }),
    getVariableDescriptionFormField({ stepId: "variable" }),
    getOAuthIdentityProviderFormField({ stepId: "provider" }),
    getOAuthTokenUrlFormField({ stepId: "provider" }),
    getOAuthGrantTypeFormField({ stepId: "provider" }),
    getOAuthClientIdFormField({ stepId: "credentials" }),
    getOAuthClientSecretFormField({ stepId: "credentials" }),
    getOAuthRefreshTokenFormField({ stepId: "credentials" }),
    getOAuthScopeFormField({ stepId: "advanced" }),
    getOAuthAdditionalParametersFormField({ stepId: "advanced" }),
    getOAuthClientAuthenticationFormField({ stepId: "advanced" }),
  ];
}
