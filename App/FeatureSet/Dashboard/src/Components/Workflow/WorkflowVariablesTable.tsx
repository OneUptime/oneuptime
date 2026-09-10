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
 */

import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

export interface ComponentProps {
  /*
   * The workflow these variables belong to. Leave it out for the project-wide
   * global variables, whose rows are the ones with a null workflowId.
   */
  workflowId?: ObjectID | undefined;
}

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

  const isGlobal: boolean = !props.workflowId;

  /*
   * "Update Content" writes through ModelAPI directly, which ModelTable's own
   * edit gating never sees. Gate it here as well, so a member who cannot update
   * variables gets a disabled button that says why rather than a modal that
   * 403s after they have pasted a token into it.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new WorkflowVariable(),
    ModelAction.Update,
  );

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
        isCreateable={true}
        name="Workflows"
        isViewable={false}
        cardProps={{
          title: isGlobal ? "Global Variables" : "Workflow Variables",
          description: isGlobal
            ? "Here is a list of global secrets and variables for this project."
            : "Here is a list of workflow secrets and variables for this specific workflow.",
        }}
        userPreferencesKey="workflow-variable-table"
        query={{
          workflowId: props.workflowId ? props.workflowId : new IsNull(),
          projectId: ProjectUtil.getCurrentProjectId()!,
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
        noItemsMessage={
          isGlobal
            ? "No global variables found."
            : "No workflow variables found."
        }
        showViewIdButton={true}
        actionButtons={[
          {
            title: "Update Content",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Variable,
            /*
             * isAllowed false with no reason is PermissionGate's "do not accuse
             * the user" case - the permission snapshot has not arrived yet, or
             * the model declares no update permissions at all. Its contract asks
             * callers to hide the affordance there rather than show a disabled
             * button that blames somebody who may well hold the permission.
             */
            isVisible: (): boolean => {
              return updateGate.isAllowed || Boolean(updateGate.disabledReason);
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace this variable's content. The stored content is never returned by the API, so changing it needs its own door."
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
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Workflow Name",
            description: isGlobal
              ? "Workflows refer to this variable as {{global.variables.name}}. Renaming it does not update workflows that already refer to the old name."
              : "Workflows refer to this variable as {{local.variables.name}}. Renaming it does not update workflows that already refer to the old name.",
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
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              isSecret: true,
            },
            title: "Secret",
            description:
              "Is this variable secret or secure? Should this be encrypted in the Database?",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              content: true,
            },
            title: "Content",
            description: "Enter the content of the variable",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            /*
             * The content is never readable back, so it cannot be prefilled and
             * must not join the edit modal's select. Use "Update Content" to
             * change it.
             */
            doNotShowWhenEditing: true,
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
                  "The new content of this variable. The stored content is never returned by the API, so it cannot be shown here — what you type replaces it outright.",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: "Content of the variable",
              },
            ],
          }}
        />
      )}
    </Fragment>
  );
};

export default WorkflowVariablesTable;
