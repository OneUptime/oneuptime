/*
 * The variables list, shared by Workflow > Global Variables (workflowId is
 * null) and Workflow > View > Workflow Variables (local to one workflow). The
 * two pages differ only in their query and their wording, so they share this
 * component rather than two copies that drift apart.
 *
 * The list lists and creates; nothing else. Each row has one action, View,
 * which opens the variable's own page (WorkflowVariableView) - that is where a
 * variable is edited, its content or credentials replaced, its OAuth token
 * refreshed and the variable deleted. Five row actions and a Token column with
 * a button of its own made the table hard to read and pushed the actions off
 * screen on an ordinary laptop.
 *
 * Create makes a static variable - the kind almost everybody wants - and its
 * form never asks which kind. An OAuth 2.0 variable is created from the More
 * menu beside it, with a form of its own (CreateOAuthWorkflowVariableModal).
 */

import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  WorkflowVariableType,
  isOAuth2WorkflowVariable,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import CreateOAuthWorkflowVariableModal from "./CreateOAuthWorkflowVariableModal";
import WorkflowVariableTokenRefreshModal from "./WorkflowVariableTokenRefreshModal";
import {
  TokenRefreshOutcome,
  fetchTokenRefreshOutcome,
  getStaticVariableCreateFormFields,
  getVariableTypeLabel,
  getWorkflowVariableViewRoute,
} from "../../Utils/Workflow/WorkflowVariableUtil";

export interface ComponentProps {
  /*
   * The workflow these variables belong to. Leave it out for the project-wide
   * global variables, whose rows are the ones with a null workflowId.
   */
  workflowId?: ObjectID | undefined;
}

interface TokenRefreshState {
  variableName: string;
  // Null while OneUptime is still waiting for the identity provider.
  outcome: TokenRefreshOutcome | null;
}

const WorkflowVariablesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isGlobal: boolean = !props.workflowId;

  const [showCreateOAuthModal, setShowCreateOAuthModal] =
    useState<boolean>(false);

  // The first token fetch of a newly created OAuth 2.0 variable.
  const [tokenRefresh, setTokenRefresh] = useState<TokenRefreshState | null>(
    null,
  );

  /*
   * Bumped to make the table fetch again after something outside it - the
   * OAuth create form - added a row.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toISOString(),
  );

  /*
   * Bumped once, after the table's first successful fetch. The permission
   * snapshot rides in on an API response header, so on the first paint after a
   * fresh sign-in or a project switch it is still empty - and the gate below
   * would then resolve to "not allowed, no reason" and hide the OAuth create
   * option for the life of the page. BaseModelTable's own Create gate recovers
   * on its own because it re-derives it whenever its data changes; this one is
   * computed here, so this component has to re-render for the same thing to
   * happen.
   */
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);

  /*
   * The OAuth create form writes through a modal ModelTable's own create
   * gating never sees, so it is gated here the same way: locked with the
   * reason for somebody who may not create variables, rather than a form that
   * 403s after they have pasted a client secret into it.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new WorkflowVariable(),
    ModelAction.Create,
  );

  /*
   * isAllowed false with no reason is PermissionGate's "do not accuse the
   * user" case - the permission snapshot has not arrived yet, or the model
   * declares no create permissions at all. Its contract asks callers to hide
   * the affordance there rather than show a disabled one that blames somebody
   * who may well hold the permission.
   */
  const isCreateOAuthVisible: boolean =
    createGate.isAllowed || Boolean(createGate.disabledReason);

  /*
   * An outline button, never NORMAL or PRIMARY: the table puts its main
   * button beside the search and everything else in the More (⋯) menu, and it
   * picks the main button by style. Outline keeps this one in the menu even
   * when the Create button is not there to be picked first.
   */
  const moreMenuButtons: Array<CardButtonSchema> = isCreateOAuthVisible
    ? [
        {
          title: "Create OAuth 2.0 Variable",
          icon: IconProp.Key,
          buttonStyle: ButtonStyleType.OUTLINE,
          buttonSize: ButtonSize.Small,
          disabled: !createGate.isAllowed,
          tooltip: createGate.isAllowed
            ? "A variable whose value is an access token OneUptime fetches from your identity provider and keeps fresh."
            : createGate.disabledReason,
          onClick: () => {
            if (!createGate.isAllowed) {
              return;
            }

            setShowCreateOAuthModal(true);
          },
        },
      ]
    : [];

  const onOAuthVariableCreated: (
    variable: WorkflowVariable,
  ) => Promise<void> = async (variable: WorkflowVariable): Promise<void> => {
    setShowCreateOAuthModal(false);
    setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());

    /*
     * Creating a variable and refreshing its token are different permissions:
     * the refresh route writes the token to the variable, so it checks for
     * update, and a member may create variables without being allowed to edit
     * them. Asking anyway would only bring back OneUptime's refusal. Such a
     * variable gets its first token the first time a workflow uses it.
     */
    const updateGate: PermissionGateResult = PermissionGate.check(
      new WorkflowVariable(),
      ModelAction.Update,
    );

    if (!updateGate.isAllowed) {
      return;
    }

    /*
     * Fetch the first token straight away. A mistyped secret or token URL then
     * shows up while the person who typed it is still looking, rather than as
     * a failed workflow run hours later.
     */
    const variableName: string = variable.name || "this variable";
    setTokenRefresh({ variableName, outcome: null });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable,
    });

    setTokenRefresh({ variableName, outcome });

    // The refresh wrote the expiry, or the failure, to the row.
    setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
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
        /*
         * Edit and Delete live on the variable's page, where there is room to
         * say what each one does. The row keeps a single way in.
         */
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        viewButtonText="View"
        onViewPage={(item: WorkflowVariable): Promise<Route> => {
          if (!item.id) {
            return Promise.reject(
              new Error(
                "This variable has no id. Refresh the page and try again.",
              ),
            );
          }

          return Promise.resolve(
            getWorkflowVariableViewRoute({
              variableId: item.id,
              workflowId: props.workflowId,
            }),
          );
        }}
        name="Workflows"
        refreshToggle={refreshToggle}
        cardProps={{
          title: isGlobal ? "Global Variables" : "Workflow Variables",
          description: isGlobal
            ? "Values every workflow in this project can use, such as API keys and URLs. Open a variable to edit it, replace its value or delete it. Use the More menu to create an OAuth 2.0 variable, which keeps an access token from your identity provider fresh."
            : "Values only this workflow can use, such as API keys and URLs. Open a variable to edit it, replace its value or delete it. Use the More menu to create an OAuth 2.0 variable, which keeps an access token from your identity provider fresh.",
          buttons: moreMenuButtons,
        }}
        userPreferencesKey="workflow-variable-table"
        query={{
          workflowId: props.workflowId ? props.workflowId : new IsNull(),
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          variableType: true,
          oauthGrantType: true,
        }}
        onBeforeCreate={(item: WorkflowVariable): Promise<WorkflowVariable> => {
          /*
           * The Create button's form makes static variables only. Stamped here
           * rather than left to the column default, so the form cannot make
           * anything else whatever the default becomes.
           */
          item.variableType = WorkflowVariableType.Static;

          /*
           * A global variable is one whose workflowId stays unset, so there is
           * nothing to stamp on that path.
           */
          if (props.workflowId) {
            item.workflowId = props.workflowId;
          }

          return Promise.resolve(item);
        }}
        noItemsMessage={
          isGlobal
            ? "No global variables found."
            : "No workflow variables found."
        }
        onFetchSuccess={() => {
          if (!hasFetchedOnce) {
            setHasFetchedOnce(true);
          }
        }}
        formFields={getStaticVariableCreateFormFields({ isGlobal })}
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
                return <span>{getVariableTypeLabel(item)}</span>;
              }

              return (
                <div className="flex flex-col">
                  <span>{getVariableTypeLabel(item)}</span>
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
        ]}
      />

      {showCreateOAuthModal ? (
        <CreateOAuthWorkflowVariableModal
          workflowId={props.workflowId}
          onClose={() => {
            setShowCreateOAuthModal(false);
          }}
          onSuccess={(variable: WorkflowVariable) => {
            void onOAuthVariableCreated(variable);
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

export default WorkflowVariablesTable;
