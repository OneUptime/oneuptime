import { getWorkflowRunAsRoute } from "@oneuptime/dashboard/Components/CustomRole/CustomRoleDeleteWorkflowsChoice";
import AppLink from "@oneuptime/dashboard/Components/AppLink/AppLink";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE WORKFLOWS THAT RUN AS A CUSTOM ROLE (#9831), on the role's page under
 * the teams and API keys given it. A change to the role changes what their
 * steps can do at once, just as it does for the teams and keys, so before
 * changing what a role gives, its page shows everything it reaches.
 *
 * Each row is a workflow, a link to its Run As card (its Settings, opened
 * at #run-as, as the role's Delete dialog links them), where what it runs
 * as is changed. A workflow that runs nothing right now - turned off, or
 * archived - says so beside its name: unarchived or turned on, it runs as
 * this role again, so it is listed all the same, as the Delete dialog and
 * the server count it.
 *
 * Read only: what a workflow runs as is the workflow's to change, by who
 * may edit it (WorkflowRunAsAuthority). Shown only to someone who may read
 * the project's workflows, and the server lists only the workflows they
 * may read (their labels and owners included). An empty card says how a
 * workflow comes to run as the role, with the way to the Workflows page.
 */

export interface ComponentProps {
  customRoleId: ObjectID;
}

export const CUSTOM_ROLE_WORKFLOWS_TEST_ID: string = "custom-role-workflows";

export const CustomRoleWorkflowsCopy: {
  readonly title: string;
  readonly description: string;
  readonly noWorkflow: string;
  readonly noWorkflowTitle: string;
  readonly noWorkflowDescription: string;
} = {
  title: translationKey("Workflows that Run as this Role"),
  description: translationKey(
    "The steps of these workflows can do exactly what this role allows.",
  ),
  noWorkflow: translationKey("No workflow runs as this role yet."),
  noWorkflowTitle: translationKey("No workflow runs as this role yet"),
  noWorkflowDescription: translationKey(
    "Open a workflow from the {{workflows}} page and choose this role in its Settings, under Run As.",
  ),
};

// What a workflow that runs nothing right now says beside its name.
const getStateText: (workflow: Workflow) => string | null = (
  workflow: Workflow,
): string | null => {
  if (workflow.isArchived) {
    return "Archived";
  }

  if (!workflow.isEnabled) {
    return "Disabled";
  }

  return null;
};

const CustomRoleWorkflowsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const mayReadWorkflows: boolean = PermissionGate.check(
    new Workflow(),
    ModelAction.Read,
  ).isAllowed;

  if (!mayReadWorkflows) {
    return <></>;
  }

  // How a workflow comes to run as the role: in its Settings, under Run As.
  const emptyState: EmptyStateOptions = {
    title: CustomRoleWorkflowsCopy.noWorkflowTitle,
    description: (
      <TranslatedSentence
        template={CustomRoleWorkflowsCopy.noWorkflowDescription}
        slots={{
          workflows: (
            <AppLink
              className="font-medium text-indigo-600 hover:underline"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.WORKFLOWS] as Route,
              )}
            >
              {translator.translateText("Workflows") || ""}
            </AppLink>
          ),
        }}
      />
    ),
    hideCreateButton: true,
  };

  return (
    <div data-testid={CUSTOM_ROLE_WORKFLOWS_TEST_ID}>
      <ModelTable<Workflow>
        modelType={Workflow}
        id="table-custom-role-workflows"
        userPreferencesKey="custom-role-workflows-table"
        name="Teams > Role > Workflows"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Workflow"
        pluralName="Workflows"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          runAsCustomRoleId: props.customRoleId,
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: CustomRoleWorkflowsCopy.title,
          description: CustomRoleWorkflowsCopy.description,
        }}
        noItemsMessage={CustomRoleWorkflowsCopy.noWorkflow}
        emptyState={emptyState}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[]}
        selectMoreFields={{
          isEnabled: true,
          isArchived: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Workflow",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            // The workflow's name says what each card is on a phone.
            hideTitleOnMobile: true,
            /*
             * A badge beside the name, in the page's own words (Archived,
             * Disabled): the name reads its own way, the cell the page's.
             */
            getLineText: drawsItsOwnLines,
            getElement: (item: Workflow): ReactElement => {
              const workflowId: string = item.id?.toString() || "";

              if (!workflowId) {
                return <></>;
              }

              const stateText: string | null = getStateText(item);

              return (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AppLink
                    className="font-medium text-gray-900 hover:underline break-words"
                    to={getWorkflowRunAsRoute(workflowId)}
                  >
                    <IsolatedText text={item.name || ""} />
                  </AppLink>
                  {stateText ? (
                    <Pill
                      text={stateText}
                      tone={PillTone.Paused}
                      isMinimal={true}
                      dataTestId="custom-role-workflow-state"
                    />
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default CustomRoleWorkflowsTable;
