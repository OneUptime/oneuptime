/*
 * The variables table, shared by Workflow > Variables (global, workflowId is
 * null) and Workflow > View > Variables (local to one workflow). The two pages
 * were byte-for-byte identical apart from the query and the wording, and the
 * editing support below is the kind of thing that only ever gets added to one
 * copy — so they share this component instead.
 *
 * Editing a variable used to be impossible: both tables passed
 * isEditable={false} and the only way to change a variable was to delete it and
 * create it again. Turning the flag on by itself does not work, because
 * `content` is a write-only column (ColumnAccessControl.read is []) while its
 * update list is not empty — and ModelForm builds the edit modal's prefetch
 * `select` from each field's UPDATE permissions (ModelForm.getFieldPermissions).
 * The GET would therefore ask for `content`, and SelectPermission would reject
 * the whole request. So the content field is marked doNotShowWhenEditing, which
 * drops it from the edit form's fields, its select and its payload alike, and
 * it gets its own door: the "Update Content" row action below, which writes
 * that one column through ModelAPI. That is the same shape Runbook Secrets and
 * the Security Events connectors use for their own write-only columns.
 *
 * OAuth 2.0 variables follow the same rule for their own write-only columns:
 * the client secret and refresh token are create-only on the form and have
 * their own "Update Credentials" door, while the settings anyone may read
 * (token URL, client ID, scope, ...) are edited in the normal edit form. Their
 * value is an access token OneUptime fetches, so they have no content to
 * update; "Refresh now" in the Token column fetches a new one on demand
 * instead.
 */

import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
  getOAuth2AdditionalParametersError,
  isOAuth2WorkflowVariable,
  toDateOrNull,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import WorkflowVariableTokenStatus from "./WorkflowVariableTokenStatus";

export interface ComponentProps {
  /*
   * The workflow these variables belong to. Leave it out for the project-wide
   * global variables, whose rows are the ones with a null workflowId.
   */
  workflowId?: ObjectID | undefined;
}

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

interface TokenRefreshOutcome {
  variableName: string;
  // Set when the refresh followed a save, so the result can say both.
  savedWhat?: string | undefined;
  expiresAt?: Date | null | undefined;
  error?: string | undefined;
}

export const VARIABLE_TYPE_CARD_OPTIONS: Array<CardSelectOption> = [
  {
    value: WorkflowVariableType.Static,
    title: "Static value",
    description:
      "Content you paste in, such as an API key or a URL. Workflows use it exactly as saved.",
    icon: IconProp.Variable,
  },
  {
    value: WorkflowVariableType.OAuth2,
    title: "OAuth 2.0 access token",
    description:
      "OneUptime fetches an access token from your identity provider and fetches a new one whenever a workflow is about to use an expired token.",
    icon: IconProp.Key,
  },
];

export const GRANT_TYPE_DROPDOWN_OPTIONS: Array<DropdownOption> = [
  {
    value: OAuth2GrantType.ClientCredentials,
    label: "Client Credentials (machine-to-machine)",
  },
  {
    value: OAuth2GrantType.RefreshToken,
    label: "Refresh Token (delegated access for a user)",
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

const WorkflowVariablesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<WorkflowVariable | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [contentUpdateError, setContentUpdateError] = useState<string>("");

  /*
   * What the user typed on a submit that failed. BasicFormModal unmounts its
   * form while isLoading is true, so the form that comes back after an error is
   * a fresh one - without this it would come back empty, and somebody who just
   * pasted a long token would have to go and find it again. Empty until a
   * submit fails, so the first render of the modal still prefills nothing.
   */
  const [contentDraft, setContentDraft] = useState<string>("");

  // The OAuth variable whose client secret / refresh token is being replaced.
  const [credentialsItem, setCredentialsItem] =
    useState<WorkflowVariable | null>(null);
  const [isCredentialsLoading, setIsCredentialsLoading] =
    useState<boolean>(false);
  const [credentialsError, setCredentialsError] = useState<string>("");

  // The variable whose token is being refreshed right now, for its spinner.
  const [refreshingVariableId, setRefreshingVariableId] = useState<
    string | null
  >(null);

  // The result of the last refresh, shown in a modal until dismissed.
  const [tokenRefreshOutcome, setTokenRefreshOutcome] =
    useState<TokenRefreshOutcome | null>(null);

  /*
   * Bumped to make the table fetch again after something outside it - a
   * refresh, a credentials change - wrote to a row.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toISOString(),
  );

  /*
   * The type of the variable in the edit modal. The edit form cannot carry
   * variableType itself (the column is fixed at creation, so it has no update
   * permission, and ModelForm selects and submits only fields the user may
   * update), yet it has to know which fields to show. onBeforeEdit hands the
   * row over before the modal opens, and the row has the type.
   */
  const [editingVariableType, setEditingVariableType] =
    useState<WorkflowVariableType | null>(null);

  /*
   * Bumped once, after the table's first successful fetch. The permission
   * snapshot rides in on an API response header, so on the first paint after a
   * fresh sign-in or a project switch it is still empty - and the gate below
   * would then resolve to "not allowed, no reason" and hide the action for the
   * life of the page. BaseModelTable's own Edit and Delete gates recover on
   * their own because it re-derives them whenever its data changes; this one is
   * computed here, so this component has to re-render for the same thing to
   * happen. One bump is enough: by the time a list request has come back, the
   * header it came with has been read.
   */
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);

  const isGlobal: boolean = !props.workflowId;

  /*
   * "Update Content", "Update Credentials" and "Refresh now" all write
   * through requests ModelTable's own edit gating never sees. Gate them here as
   * well, so a member who cannot update variables gets a disabled button that
   * says why rather than a modal that 403s after they have pasted a token into
   * it.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new WorkflowVariable(),
    ModelAction.Update,
  );

  /*
   * isAllowed false with no reason is PermissionGate's "do not accuse the
   * user" case - the permission snapshot has not arrived yet, or the model
   * declares no update permissions at all. Its contract asks callers to hide
   * the affordance there rather than show a disabled button that blames
   * somebody who may well hold the permission.
   */
  const isUpdateActionVisible: boolean =
    updateGate.isAllowed || Boolean(updateGate.disabledReason);

  /*
   * The type the form is describing. A create form holds variableType (the
   * card picker sets it, Static by default); an edit form does not, and falls
   * back to the row the edit was opened from.
   */
  const getFormVariableType: (
    values: FormValues<WorkflowVariable>,
  ) => WorkflowVariableType = (
    values: FormValues<WorkflowVariable>,
  ): WorkflowVariableType => {
    const fromForm: unknown = values["variableType"];

    if (fromForm) {
      return fromForm as WorkflowVariableType;
    }

    return editingVariableType || WorkflowVariableType.Static;
  };

  const isOAuthForm: (values: FormValues<WorkflowVariable>) => boolean = (
    values: FormValues<WorkflowVariable>,
  ): boolean => {
    return getFormVariableType(values) === WorkflowVariableType.OAuth2;
  };

  const isStaticForm: (values: FormValues<WorkflowVariable>) => boolean = (
    values: FormValues<WorkflowVariable>,
  ): boolean => {
    return !isOAuthForm(values);
  };

  const runTokenRefresh: (data: {
    variable: WorkflowVariable;
    savedWhat?: string | undefined;
  }) => Promise<void> = async (data: {
    variable: WorkflowVariable;
    savedWhat?: string | undefined;
  }): Promise<void> => {
    const variableName: string = data.variable.name || "this variable";

    if (!data.variable.id) {
      setTokenRefreshOutcome({
        variableName,
        savedWhat: data.savedWhat,
        error: "This variable has no id. Refresh the page and try again.",
      });
      return;
    }

    setRefreshingVariableId(data.variable.id.toString());

    try {
      const result: OAuthTokenRefreshResult =
        await refreshWorkflowVariableOAuthToken(data.variable.id);

      setTokenRefreshOutcome({
        variableName,
        savedWhat: data.savedWhat,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      setTokenRefreshOutcome({
        variableName,
        savedWhat: data.savedWhat,
        error: API.getFriendlyMessage(err),
      });
    }

    setRefreshingVariableId(null);

    // The refresh wrote the expiry, or the failure, to the row.
    setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
  };

  const getTokenRefreshDescription: (outcome: TokenRefreshOutcome) => string = (
    outcome: TokenRefreshOutcome,
  ): string => {
    const saved: string = outcome.savedWhat
      ? `${outcome.savedWhat} saved. `
      : "";

    if (outcome.error) {
      return `${saved}OneUptime asked your identity provider for an access token for "${outcome.variableName}" and it said no: ${outcome.error}`;
    }

    return `${saved}OneUptime fetched a new access token for "${outcome.variableName}" from your identity provider. ${
      outcome.expiresAt
        ? `It is valid until ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            outcome.expiresAt,
          )}, and a new one is fetched automatically whenever a workflow is about to use it after that.`
        : "The provider did not say when it expires, so every workflow run fetches a new one."
    }`;
  };

  return (
    <Fragment>
      <ModelTable<WorkflowVariable>
        modelType={WorkflowVariable}
        id={
          isGlobal
            ? "global-workflow-variables-table"
            : "workflow-variables-table"
        }
        saveFilterProps={{
          tableId: isGlobal
            ? "workflow-variables-table"
            : "workflow-view-variables-table",
        }}
        isDeleteable={true}
        isEditable={true}
        /*
         * Named for what it actually edits. Plain "Edit" is the verb a user
         * reaches for when they want to change a variable's value, and the one
         * button that cannot do it - content is not on that form and the modal
         * has no room to say so. Sitting next to "Update Content", this splits
         * the two without either needing an explanation.
         */
        editButtonText="Edit Details"
        isCreateable={true}
        name="Workflows"
        isViewable={false}
        refreshToggle={refreshToggle}
        cardProps={{
          title: isGlobal ? "Global Variables" : "Workflow Variables",
          description: isGlobal
            ? "Here is a list of global secrets and variables for this project. An OAuth 2.0 variable keeps an access token from your identity provider fresh, so workflows never call an API with an expired token."
            : "Here is a list of workflow secrets and variables for this specific workflow. An OAuth 2.0 variable keeps an access token from your identity provider fresh, so workflows never call an API with an expired token.",
        }}
        userPreferencesKey="workflow-variable-table"
        query={{
          workflowId: props.workflowId ? props.workflowId : new IsNull(),
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          variableType: true,
          oauthGrantType: true,
          oauthAccessTokenExpiresAt: true,
          oauthLastRefreshedAt: true,
          oauthLastRefreshError: true,
          oauthLastRefreshErrorAt: true,
        }}
        onBeforeCreate={(item: WorkflowVariable): Promise<WorkflowVariable> => {
          /*
           * A global variable is one whose workflowId stays unset, so there is
           * nothing to stamp on this path.
           */
          if (props.workflowId) {
            item.workflowId = props.workflowId;
          }

          return Promise.resolve(item);
        }}
        onBeforeEdit={(item: WorkflowVariable): Promise<WorkflowVariable> => {
          setEditingVariableType(
            isOAuth2WorkflowVariable(item.variableType)
              ? WorkflowVariableType.OAuth2
              : WorkflowVariableType.Static,
          );

          return Promise.resolve(item);
        }}
        onCreateSuccess={async (
          item: WorkflowVariable,
          modalType?: ModalType,
        ): Promise<WorkflowVariable> => {
          /*
           * Fetch the first token straight away. A mistyped secret or token
           * URL then shows up while the person who typed it is still looking,
           * rather than as a failed workflow run hours later. Only on create:
           * the edit form leaves this to the Refresh now button, because an
           * edit of the name alone has nothing to test.
           */
          if (
            modalType === ModalType.Create &&
            isOAuth2WorkflowVariable(item.variableType) &&
            item.id
          ) {
            await runTokenRefresh({ variable: item });
          }

          return item;
        }}
        noItemsMessage={
          isGlobal
            ? "No global variables found."
            : "No workflow variables found."
        }
        showViewIdButton={true}
        onFetchSuccess={() => {
          if (!hasFetchedOnce) {
            setHasFetchedOnce(true);
          }
        }}
        actionButtons={[
          {
            title: "Update Content",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Variable,
            isVisible: (item: WorkflowVariable): boolean => {
              return (
                isUpdateActionVisible &&
                !isOAuth2WorkflowVariable(item.variableType)
              );
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace this variable's content. Once saved, a variable's content cannot be retrieved, so it is replaced here rather than edited."
              : updateGate.disabledReason,
            onClick: (
              item: WorkflowVariable,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setContentUpdateError("");
                setCurrentlyEditingItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          {
            title: "Update Credentials",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Key,
            isVisible: (item: WorkflowVariable): boolean => {
              return (
                isUpdateActionVisible &&
                isOAuth2WorkflowVariable(item.variableType)
              );
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace the client secret or refresh token. They cannot be retrieved once saved, so they are replaced here rather than edited."
              : updateGate.disabledReason,
            onClick: (
              item: WorkflowVariable,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCredentialsError("");
                setCredentialsItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        formSteps={[
          {
            title: "Variable",
            id: "variable",
          },
          {
            title: "Value",
            id: "value",
            showIf: isStaticForm,
          },
          {
            title: "OAuth 2.0",
            id: "oauth",
            showIf: isOAuthForm,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "variable",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Workflow Name",
            /*
             * The rename warning is not decoration. Nothing links a workflow's
             * graph to the variable row it names: the builder's linter checks
             * that a reference is well formed but leaves its existence to the
             * API, and at run time VMAPI skips a reference it cannot resolve -
             * so a workflow left pointing at the old name posts the literal
             * braces and still reports Success.
             */
            description: isGlobal
              ? "Workflows refer to this variable by name, as {{global.variables.THIS_NAME}}. Renaming it does not update workflows that already refer to the old name."
              : "Workflows refer to this variable by name, as {{local.variables.THIS_NAME}}. Renaming it does not update workflows that already refer to the old name.",
            validation: {
              minLength: 2,
              noSpaces: true,
              noSpecialCharacters: true,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "variable",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              variableType: true,
            },
            title: "Type",
            stepId: "variable",
            description:
              "Fixed once the variable is saved. To turn a static token into an OAuth 2.0 variable, delete it and create it again under the same name - workflows refer to it by name, so they keep working.",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectOptions: VARIABLE_TYPE_CARD_OPTIONS,
            // Two cards with a sentence each read badly in a three-up grid.
            cardSelectSingleColumn: true,
            required: true,
            defaultValue: WorkflowVariableType.Static,
            doNotShowWhenEditing: true,
          },
          {
            field: {
              isSecret: true,
            },
            title: "Secret",
            stepId: "value",
            /*
             * The copy this replaces asked "Should this be encrypted in the
             * Database?", which was not true of this column - content carries
             * no `encrypted: true` and the DDL is a plain text column. Somebody
             * reading it while turning the toggle on would come away believing
             * a database dump was no longer a credential exposure.
             */
            description:
              "Keep this variable's content out of workflow run logs - every run replaces it with [REDACTED] before the log is saved. It applies to future runs only, and it cannot be turned off again once saved.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            // OAuth 2.0 variables are always secret.
            showIf: isStaticForm,
          },
          {
            field: {
              content: true,
            },
            title: "Content",
            stepId: "value",
            description: "Enter the content of the variable",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            showIf: isStaticForm,
            /*
             * The content is never readable back, so it cannot be prefilled and
             * must not join the edit modal's select. Use "Update Content" to
             * change it.
             */
            doNotShowWhenEditing: true,
          },
          {
            field: {
              oauthGrantType: true,
            },
            title: "Grant Type",
            stepId: "oauth",
            description:
              "Client Credentials: OneUptime signs in as your application - the usual choice for server-to-server APIs. Refresh Token: you authorised the application once as a user and have a refresh token; OneUptime trades it for access tokens and keeps the new refresh token when your provider rotates it. Fixed once saved.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: GRANT_TYPE_DROPDOWN_OPTIONS,
            required: true,
            defaultValue: OAuth2GrantType.ClientCredentials,
            showIf: isOAuthForm,
            doNotShowWhenEditing: true,
          },
          {
            field: {
              oauthTokenUrl: true,
            },
            title: "Token URL",
            stepId: "oauth",
            description:
              "Your identity provider's token endpoint. Microsoft Entra ID: https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token. Google: https://oauth2.googleapis.com/token. Okta: https://{your-domain}/oauth2/default/v1/token. Auth0: https://{your-domain}/oauth/token.",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://login.example.com/oauth2/token",
            disableSpellCheck: true,
            showIf: isOAuthForm,
          },
          {
            field: {
              oauthClientId: true,
            },
            title: "Client ID",
            stepId: "oauth",
            description:
              "The client (application) ID of the application registered with your identity provider.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "12345678-1234-1234-1234-123456789012",
            disableSpellCheck: true,
            showIf: isOAuthForm,
          },
          {
            field: {
              oauthClientSecret: true,
            },
            title: "Client Secret",
            stepId: "oauth",
            description:
              "Encrypted, and never shown again once saved - use Update Credentials to replace it. Optional for the Refresh Token grant if your application is a public client.",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: (values: FormValues<WorkflowVariable>): boolean => {
              return values["oauthGrantType"] !== OAuth2GrantType.RefreshToken;
            },
            placeholder: "Client secret",
            disableSpellCheck: true,
            showIf: isOAuthForm,
            // Write-only: see the note on content above.
            doNotShowWhenEditing: true,
          },
          {
            field: {
              oauthRefreshToken: true,
            },
            title: "Refresh Token",
            stepId: "oauth",
            description:
              "The refresh token you got when you authorised the application, for example from your provider's OAuth playground. Encrypted, never shown again, and replaced automatically when your provider rotates it.",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: true,
            placeholder: "Refresh token",
            disableSpellCheck: true,
            showIf: (values: FormValues<WorkflowVariable>): boolean => {
              return (
                isOAuthForm(values) &&
                values["oauthGrantType"] === OAuth2GrantType.RefreshToken
              );
            },
            doNotShowWhenEditing: true,
          },
          {
            field: {
              oauthScope: true,
            },
            title: "Scope",
            stepId: "oauth",
            description:
              "Space-separated scopes to request, for example https://graph.microsoft.com/.default. Leave empty to get your provider's default scopes.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "api.read api.write",
            disableSpellCheck: true,
            showIf: isOAuthForm,
          },
          {
            field: {
              oauthAdditionalParameters: true,
            },
            title: "Additional Parameters",
            stepId: "oauth",
            description:
              "Extra form parameters for the token request, such as audience for Auth0 or resource for Azure AD v1. Anyone who can read this variable can read them, so do not put secrets here.",
            fieldType: FormFieldSchemaType.Dictionary,
            required: false,
            showIf: isOAuthForm,
            customValidation: (
              values: FormValues<WorkflowVariable>,
            ): string | null => {
              return getOAuth2AdditionalParametersError(
                values["oauthAdditionalParameters"],
              );
            },
          },
          {
            field: {
              oauthClientAuthenticationMethod: true,
            },
            title: "Client Authentication",
            stepId: "oauth",
            description:
              "How the client ID and secret are sent. Most providers accept both; if yours answers invalid_client, try the other one.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS,
            required: false,
            defaultValue: DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
            showIf: isOAuthForm,
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              isSecret: true,
            },
            title: "Secret",
            type: FieldType.Boolean,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              variableType: true,
            },
            title: "Type",
            type: FieldType.Element,
            getElement: (item: WorkflowVariable): ReactElement => {
              if (!isOAuth2WorkflowVariable(item.variableType)) {
                return <span>Static</span>;
              }

              return (
                <div className="flex flex-col">
                  <span>OAuth 2.0</span>
                  {item.oauthGrantType ? (
                    <span className="text-xs text-gray-500">
                      {item.oauthGrantType}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              isSecret: true,
            },
            title: "Secret",
            type: FieldType.Boolean,
          },
          {
            field: {
              oauthAccessTokenExpiresAt: true,
            },
            title: "Token",
            type: FieldType.Element,
            getElement: (item: WorkflowVariable): ReactElement => {
              if (!isOAuth2WorkflowVariable(item.variableType)) {
                return <span className="text-gray-400">-</span>;
              }

              const variableId: string = item.id ? item.id.toString() : "";

              return (
                <WorkflowVariableTokenStatus
                  variable={item}
                  refreshAction={
                    isUpdateActionVisible
                      ? {
                          onClick: () => {
                            void runTokenRefresh({ variable: item });
                          },
                          isLoading: refreshingVariableId === variableId,
                          disabled: !updateGate.isAllowed,
                          tooltip: updateGate.isAllowed
                            ? "Fetch a new access token from your identity provider now. Workflows do this on their own when the token has expired; use this to check new settings."
                            : updateGate.disabledReason,
                        }
                      : undefined
                  }
                />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Content"}
          name="Workflow > Update Variable Content"
          isLoading={isLoading}
          error={contentUpdateError || undefined}
          description={`Replace the content of "${
            currentlyEditingItem.name || "this variable"
          }". Every workflow that refers to this variable uses the new content from its next run.`}
          onClose={() => {
            setIsLoading(false);
            setContentUpdateError("");
            setContentDraft("");
            return setCurrentlyEditingItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            const variableId: ObjectID | null = currentlyEditingItem.id;

            if (!variableId) {
              setContentUpdateError(
                "This variable cannot be updated because it has no id. Refresh the page and try again.",
              );
              return;
            }

            try {
              setIsLoading(true);
              setContentUpdateError("");

              await ModelAPI.updateById<WorkflowVariable>({
                modelType: WorkflowVariable,
                id: variableId,
                data: {
                  content: data["content"],
                },
              });

              setContentDraft("");
              setCurrentlyEditingItem(null);
            } catch (err) {
              /*
               * Kept on screen, with the reason and with what the user typed.
               * The neighbouring secret-rotation modals swallow this entirely,
               * which on a credential is the difference between a rotation and
               * a silent non-rotation.
               */
              setContentDraft((data["content"] as string) || "");
              setContentUpdateError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
          }}
          formProps={{
            initialValues: contentDraft ? { content: contentDraft } : {},
            fields: [
              {
                field: {
                  content: true,
                },
                title: "Content",
                description:
                  "The new content of this variable. The stored content cannot be retrieved, so it is not shown here — what you type replaces it outright.",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: "Content of the variable",
              },
            ],
          }}
        />
      )}

      {credentialsItem && (
        <BasicFormModal
          title={"Update Credentials"}
          name="Workflow > Update OAuth Variable Credentials"
          isLoading={isCredentialsLoading}
          error={credentialsError || undefined}
          description={`Replace the credentials "${
            credentialsItem.name || "this variable"
          }" uses to get access tokens. Leave a field empty to keep what is saved. OneUptime fetches a new token with them as soon as you save.`}
          submitButtonText="Save and Refresh Token"
          onClose={() => {
            setIsCredentialsLoading(false);
            setCredentialsError("");
            setCredentialsItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            const variable: WorkflowVariable = credentialsItem;

            if (!variable.id) {
              setCredentialsError(
                "This variable cannot be updated because it has no id. Refresh the page and try again.",
              );
              return;
            }

            const update: JSONObject = {};
            const clientSecret: string = (
              (data["oauthClientSecret"] as string) || ""
            ).trim();
            const refreshToken: string = (
              (data["oauthRefreshToken"] as string) || ""
            ).trim();

            if (clientSecret) {
              update["oauthClientSecret"] = clientSecret;
            }

            if (refreshToken) {
              update["oauthRefreshToken"] = refreshToken;
            }

            if (Object.keys(update).length === 0) {
              setCredentialsError(
                "Enter a new client secret or refresh token, or close this dialog to keep the saved ones.",
              );
              return;
            }

            try {
              setIsCredentialsLoading(true);
              setCredentialsError("");

              await ModelAPI.updateById<WorkflowVariable>({
                modelType: WorkflowVariable,
                id: variable.id,
                data: update,
              });
            } catch (err) {
              setCredentialsError(API.getFriendlyMessage(err));
              setIsCredentialsLoading(false);
              return;
            }

            setIsCredentialsLoading(false);
            setCredentialsItem(null);

            await runTokenRefresh({
              variable,
              savedWhat:
                Object.keys(update).length === 2
                  ? "Client secret and refresh token"
                  : update["oauthClientSecret"]
                    ? "Client secret"
                    : "Refresh token",
            });
          }}
          formProps={{
            fields: [
              {
                field: {
                  oauthClientSecret: true,
                },
                title: "New Client Secret",
                description: "Leave empty to keep the saved client secret.",
                fieldType: FormFieldSchemaType.EncryptedText,
                required: false,
                placeholder: "New client secret",
                disableSpellCheck: true,
              },
              ...(credentialsItem.oauthGrantType ===
              OAuth2GrantType.RefreshToken
                ? [
                    {
                      field: {
                        oauthRefreshToken: true,
                      },
                      title: "New Refresh Token",
                      description:
                        "Leave empty to keep the saved refresh token. Paste a new one if your provider revoked the old one or it expired.",
                      fieldType: FormFieldSchemaType.EncryptedText,
                      required: false,
                      placeholder: "New refresh token",
                      disableSpellCheck: true,
                    },
                  ]
                : []),
            ],
          }}
        />
      )}

      {tokenRefreshOutcome && (
        <ConfirmModal
          title={
            tokenRefreshOutcome.error
              ? "Could Not Fetch an Access Token"
              : "Access Token Fetched"
          }
          description={getTokenRefreshDescription(tokenRefreshOutcome)}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setTokenRefreshOutcome(null);
          }}
        />
      )}
    </Fragment>
  );
};

export default WorkflowVariablesTable;
