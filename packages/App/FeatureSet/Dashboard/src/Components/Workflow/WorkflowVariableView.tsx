/*
 * A workflow variable's own page, shared by a global variable (Workflows >
 * Global Variables > View Variable) and a variable local to one workflow
 * (Workflow > Workflow Variables > View Variable).
 *
 * Everything done to one variable happens here rather than in the list's row
 * actions: its details are edited, a static variable's content or an OAuth 2.0
 * variable's credentials are replaced, the OAuth token is checked and
 * refreshed, and the variable is deleted.
 *
 * Which cards appear depends on the variable's type, so the page reads the
 * variable once itself before it lays them out. It reads only columns anybody
 * who may see the variable may read - never content, a credential or a token.
 */

import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Select from "Common/Types/BaseDatabase/Select";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OAuth2ClientAuthenticationMethod,
  isOAuth2WorkflowVariable,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import UpdateWorkflowVariableContentModal from "./UpdateWorkflowVariableContentModal";
import UpdateWorkflowVariableCredentialsModal from "./UpdateWorkflowVariableCredentialsModal";
import WorkflowVariableTokenRefreshModal from "./WorkflowVariableTokenRefreshModal";
import WorkflowVariableTokenStatus from "./WorkflowVariableTokenStatus";
import {
  TokenRefreshOutcome,
  fetchTokenRefreshOutcome,
  getClientAuthenticationLabel,
  getOAuthSettingsFormFields,
  getSecretFormField,
  getVariableTypeLabel,
  getVariableDescriptionFormField,
  getVariableNameFormField,
  getWorkflowVariableReference,
  getWorkflowVariablesListRoute,
} from "../../Utils/Workflow/WorkflowVariableUtil";

export interface ComponentProps {
  variableId: ObjectID;
  /*
   * The workflow whose page this is. Leave it out on the global variable
   * page.
   */
  workflowId?: ObjectID | undefined;
}

interface TokenRefreshState {
  variableName: string;
  // Null while OneUptime is still waiting for the identity provider.
  outcome: TokenRefreshOutcome | null;
}

/*
 * What the page reads to decide its layout and to show the token's state.
 * Only readable columns: content, the client secret, the refresh token and the
 * access token are never selected (and the server would refuse the request if
 * they were).
 */
export const WORKFLOW_VARIABLE_VIEW_SELECT: Select<WorkflowVariable> = {
  _id: true,
  name: true,
  workflowId: true,
  variableType: true,
  isSecret: true,
  oauthGrantType: true,
  oauthAccessTokenExpiresAt: true,
  oauthLastRefreshedAt: true,
  oauthLastRefreshError: true,
  oauthLastRefreshErrorAt: true,
};

/*
 * A variable opened under the wrong page - a local variable's id on the global
 * page, or another workflow's variable under this one - is refused rather than
 * shown under a breadcrumb that says it is something it is not.
 */
export function getVariableScopeError(data: {
  variable: WorkflowVariable;
  workflowId?: ObjectID | undefined;
}): string | null {
  const variableWorkflowId: string = data.variable.workflowId
    ? data.variable.workflowId.toString()
    : "";

  if (!data.workflowId) {
    return variableWorkflowId
      ? "This variable belongs to a workflow, not to the project's global variables. Open it from that workflow's Workflow Variables page."
      : null;
  }

  return variableWorkflowId === data.workflowId.toString()
    ? null
    : "This variable does not belong to this workflow.";
}

const WorkflowVariableView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isGlobal: boolean = !props.workflowId;

  const [variable, setVariable] = useState<WorkflowVariable | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [showUpdateContent, setShowUpdateContent] = useState<boolean>(false);
  const [contentUpdated, setContentUpdated] = useState<boolean>(false);
  const [showUpdateCredentials, setShowUpdateCredentials] =
    useState<boolean>(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState<boolean>(false);
  const [tokenRefresh, setTokenRefresh] = useState<TokenRefreshState | null>(
    null,
  );

  /*
   * Bumped by every load (and on unmount). A response only lands if no newer
   * load has started since, so a slow read of the previous variable - after
   * moving from one variable's page to another's - can never replace the one
   * on screen.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      loadGenerationRef.current++;
    };
  }, []);

  /*
   * A foreground load (opening the page, Refresh on the error) owns the whole
   * page: it shows the loader and, if it fails, the error. A background reload
   * - after a save or a token refresh, to pick up what that wrote - does not:
   * the page is already showing a variable that exists, and swapping it for an
   * error would also take down the token refresh result, which is the one
   * thing somebody needs to read at that moment. A failed background reload
   * leaves the page as it was.
   */
  const loadVariable: (options?: {
    isBackground?: boolean | undefined;
  }) => Promise<void> = async (options?: {
    isBackground?: boolean | undefined;
  }): Promise<void> => {
    const isBackground: boolean = Boolean(options?.isBackground);

    loadGenerationRef.current++;
    const generation: number = loadGenerationRef.current;

    if (!isBackground) {
      setIsLoading(true);
    }

    let item: WorkflowVariable | null = null;
    let loadError: string = "";

    try {
      item = await ModelAPI.getItem<WorkflowVariable>({
        modelType: WorkflowVariable,
        id: props.variableId,
        select: WORKFLOW_VARIABLE_VIEW_SELECT,
      });
    } catch (err) {
      loadError = API.getFriendlyMessage(err);
    }

    if (generation !== loadGenerationRef.current) {
      return;
    }

    /*
     * The API answers a missing, deleted or out-of-tenant id with an empty
     * object rather than null, and ModelAPI turns that into a WorkflowVariable
     * with nothing set - so "no id" is what not-found looks like here. It is
     * checked before the scope, so a local page reports a missing variable as
     * missing rather than as one that belongs to another workflow.
     */
    if (!loadError && (!item || !item.id)) {
      loadError =
        "This variable could not be found. It may have been deleted, or you may not have access to it.";
    }

    if (!loadError && item) {
      loadError =
        getVariableScopeError({
          variable: item,
          workflowId: props.workflowId,
        }) || "";
    }

    if (loadError) {
      if (!isBackground) {
        setVariable(null);
        setError(loadError);
        setIsLoading(false);
      }

      return;
    }

    setVariable(item);
    setError("");
    setIsLoading(false);
  };

  useEffect(() => {
    setVariable(null);
    setError("");
    setContentUpdated(false);
    void loadVariable();
  }, [props.variableId.toString(), props.workflowId?.toString()]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error || !variable) {
    return (
      <ErrorMessage
        message={error || "This variable could not be loaded."}
        onRefreshClick={() => {
          void loadVariable();
        }}
      />
    );
  }

  const isOAuth: boolean = isOAuth2WorkflowVariable(variable.variableType);
  const variableName: string = variable.name || "this variable";

  /*
   * Replacing content or credentials, and fetching a token, all write through
   * requests the detail cards' own edit gating never sees. Gate them here as
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

  const runTokenRefresh: (
    savedWhat?: string | undefined,
  ) => Promise<void> = async (
    savedWhat?: string | undefined,
  ): Promise<void> => {
    setIsRefreshingToken(true);

    /*
     * After a credentials save the modal that was on screen has just closed,
     * so say at once that a token is on its way. Refresh now has its own
     * spinner on the button that was clicked.
     */
    if (savedWhat) {
      setTokenRefresh({ variableName, outcome: null });
    }

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable,
      savedWhat,
    });

    setTokenRefresh({ variableName, outcome });
    setIsRefreshingToken(false);

    // The refresh wrote the expiry, or the failure, to the variable.
    await loadVariable({ isBackground: true });
  };

  /*
   * The detail card's edit form. Content and the OAuth credentials are
   * write-only, so they are never on it - they have their own doors below.
   * The type and the grant are fixed once saved, so they are not on it either.
   *
   * The secret toggle is offered only while the variable is not yet secret:
   * the server refuses to turn it off again (so a caller who may write a
   * variable but not read it cannot clear the flag and read the value out of a
   * run log), and a toggle that can only fail would be a trap. OAuth 2.0
   * variables are always secret.
   */
  const detailFormFields: Array<ModelField<WorkflowVariable>> = [
    getVariableNameFormField({ isGlobal }),
    getVariableDescriptionFormField(),
  ];

  if (!isOAuth && !variable.isSecret) {
    detailFormFields.push(getSecretFormField());
  }

  return (
    <Fragment>
      <CardModelDetail<WorkflowVariable>
        name="Workflow > Variable Details"
        cardProps={{
          title: "Variable Details",
          description: `Workflows refer to this variable by its name. Renaming it does not update workflows that already refer to the old name.`,
        }}
        isEditable={true}
        editButtonText="Edit Variable"
        onSaveSuccess={() => {
          void loadVariable({ isBackground: true });
        }}
        formFields={detailFormFields}
        modelDetailProps={{
          modelType: WorkflowVariable,
          id: "workflow-variable-details",
          modelId: props.variableId,
          showDetailsInNumberOfColumns: 2,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                variableType: true,
              },
              title: "Type",
              fieldType: FieldType.Element,
              getElement: (item: WorkflowVariable): ReactElement => {
                return (
                  <span data-testid="workflow-variable-type">
                    {getVariableTypeLabel(item)}
                  </span>
                );
              },
            },
            {
              field: {
                name: true,
              },
              title: "Use in Workflows",
              description:
                "Paste this into any text field of a workflow's components.",
              fieldType: FieldType.Element,
              getElement: (item: WorkflowVariable): ReactElement => {
                const itemReference: string = getWorkflowVariableReference({
                  name: item.name || "",
                  isGlobal,
                });

                return (
                  <div className="flex items-center gap-3">
                    <code
                      className="px-2 py-1 bg-gray-100 text-gray-800 rounded font-mono text-sm border border-gray-200 break-all"
                      data-testid="workflow-variable-reference"
                    >
                      {itemReference}
                    </code>
                    <CopyableButton textToBeCopied={itemReference} />
                  </div>
                );
              },
            },
            {
              field: {
                isSecret: true,
              },
              title: "Secret",
              description: isOAuth
                ? "OAuth 2.0 variables are always secret."
                : "A secret variable's content is replaced with [REDACTED] in workflow run logs.",
              fieldType: FieldType.Element,
              getElement: (item: WorkflowVariable): ReactElement => {
                if (item.isSecret) {
                  return (
                    <Pill
                      text="Secret"
                      color={Green500}
                      icon={IconProp.Lock}
                      isMinimal={true}
                    />
                  );
                }

                return (
                  <Pill text="Not secret" color={Gray500} isMinimal={true} />
                );
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              placeholder: "No description",
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                _id: true,
              },
              title: "Variable ID",
              fieldType: FieldType.ObjectID,
            },
          ],
        }}
      />

      {!isOAuth ? (
        <Card
          title="Content"
          description="The value workflows use. Content is write-only: once saved it cannot be viewed through the dashboard or the API, only replaced."
          buttons={
            isUpdateActionVisible
              ? [
                  {
                    title: "Update Content",
                    buttonStyle: ButtonStyleType.NORMAL,
                    icon: IconProp.Edit,
                    disabled: !updateGate.isAllowed,
                    tooltip: updateGate.isAllowed
                      ? "Replace this variable's content. Once saved, a variable's content cannot be retrieved, so it is replaced here rather than edited."
                      : updateGate.disabledReason,
                    onClick: () => {
                      if (!updateGate.isAllowed) {
                        return;
                      }

                      setContentUpdated(false);
                      setShowUpdateContent(true);
                    },
                  },
                ]
              : []
          }
        >
          <p
            className="text-sm text-gray-500"
            data-testid="workflow-variable-content-note"
          >
            {contentUpdated
              ? "Content updated. Every workflow that refers to this variable uses the new content from its next run."
              : "Hidden. The content cannot be viewed once saved."}
          </p>
        </Card>
      ) : (
        <></>
      )}

      {isOAuth ? (
        <Card
          title="Access Token"
          description="OneUptime fetches an access token from your identity provider, and a new one whenever a workflow is about to use an expired token. The token itself is never shown."
        >
          <WorkflowVariableTokenStatus
            variable={variable}
            refreshAction={
              isUpdateActionVisible
                ? {
                    onClick: () => {
                      void runTokenRefresh();
                    },
                    isLoading: isRefreshingToken,
                    disabled: !updateGate.isAllowed,
                    tooltip: updateGate.isAllowed
                      ? "Fetch a new access token from your identity provider now. Workflows do this on their own when the token has expired; use this to check new settings."
                      : updateGate.disabledReason,
                  }
                : undefined
            }
          />
        </Card>
      ) : (
        <></>
      )}

      {isOAuth ? (
        <CardModelDetail<WorkflowVariable>
          name="Workflow > OAuth 2.0 Settings"
          cardProps={{
            title: "OAuth 2.0 Settings",
            description:
              "How OneUptime asks your identity provider for a token. Changing a setting discards the cached token, so the next run fetches one with the new settings. The client secret and refresh token are never shown - use Update Credentials to replace them.",
            buttons: isUpdateActionVisible
              ? [
                  {
                    title: "Update Credentials",
                    buttonStyle: ButtonStyleType.OUTLINE,
                    icon: IconProp.Key,
                    disabled: !updateGate.isAllowed,
                    tooltip: updateGate.isAllowed
                      ? "Replace the client secret or refresh token. They cannot be retrieved once saved, so they are replaced here rather than edited."
                      : updateGate.disabledReason,
                    onClick: () => {
                      if (!updateGate.isAllowed) {
                        return;
                      }

                      setShowUpdateCredentials(true);
                    },
                  },
                ]
              : [],
          }}
          isEditable={true}
          editButtonText="Edit Settings"
          onSaveSuccess={() => {
            // A settings change discards the cached token.
            void loadVariable({ isBackground: true });
          }}
          formFields={getOAuthSettingsFormFields()}
          modelDetailProps={{
            modelType: WorkflowVariable,
            id: "workflow-variable-oauth-settings",
            modelId: props.variableId,
            showDetailsInNumberOfColumns: 2,
            fields: [
              {
                field: {
                  oauthGrantType: true,
                },
                title: "Grant Type",
                description: "Fixed once the variable is saved.",
              },
              {
                field: {
                  oauthTokenUrl: true,
                },
                title: "Token URL",
              },
              {
                field: {
                  oauthClientId: true,
                },
                title: "Client ID",
              },
              {
                field: {
                  oauthScope: true,
                },
                title: "Scope",
                placeholder: "Your provider's default scopes",
              },
              {
                field: {
                  oauthClientAuthenticationMethod: true,
                },
                title: "Client Authentication",
                fieldType: FieldType.Element,
                getElement: (item: WorkflowVariable): ReactElement => {
                  return (
                    <span>
                      {getClientAuthenticationLabel(
                        item.oauthClientAuthenticationMethod as
                          | OAuth2ClientAuthenticationMethod
                          | undefined,
                      )}
                    </span>
                  );
                },
              },
              {
                field: {
                  oauthAdditionalParameters: true,
                },
                title: "Additional Parameters",
                fieldType: FieldType.DictionaryOfStrings,
                placeholder: "None",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      <ModelDelete<WorkflowVariable>
        modelType={WorkflowVariable}
        modelId={props.variableId}
        onDeleteSuccess={() => {
          Navigation.navigate(getWorkflowVariablesListRoute(props.workflowId));
        }}
      />

      {showUpdateContent ? (
        <UpdateWorkflowVariableContentModal
          variable={variable}
          onClose={() => {
            setShowUpdateContent(false);
          }}
          onSuccess={() => {
            setShowUpdateContent(false);
            setContentUpdated(true);
          }}
        />
      ) : (
        <></>
      )}

      {showUpdateCredentials ? (
        <UpdateWorkflowVariableCredentialsModal
          variable={variable}
          onClose={() => {
            setShowUpdateCredentials(false);
          }}
          onSaved={(savedWhat: string) => {
            setShowUpdateCredentials(false);
            void runTokenRefresh(savedWhat);
          }}
        />
      ) : (
        <></>
      )}

      {tokenRefresh ? (
        <WorkflowVariableTokenRefreshModal
          variableName={tokenRefresh.variableName}
          outcome={tokenRefresh.outcome}
          onClose={() => {
            setTokenRefresh(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default WorkflowVariableView;
