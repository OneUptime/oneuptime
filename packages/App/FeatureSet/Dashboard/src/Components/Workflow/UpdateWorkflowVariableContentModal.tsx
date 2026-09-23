/*
 * Replaces a static variable's content. `content` is write-only - its
 * ColumnAccessControl.read is [] - so it can never be prefilled or edited in
 * place, and it cannot ride along on the variable's edit form either: ModelForm
 * builds that form's prefetch select from each field's UPDATE permissions, so
 * the GET would ask for a column nobody may read and SelectPermission would
 * reject the whole request. It gets this door of its own instead, writing that
 * one column through ModelAPI - the same shape Runbook Secrets and the Security
 * Events connectors use for their own write-only columns.
 */

import React, { FunctionComponent, ReactElement, useState } from "react";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

export interface ComponentProps {
  variable: WorkflowVariable;
  onClose: () => void;
  onSuccess: () => void;
}

const UpdateWorkflowVariableContentModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * What the user typed on a submit that failed. BasicFormModal unmounts its
   * form while isLoading is true, so the form that comes back after an error is
   * a fresh one - without this it would come back empty, and somebody who just
   * pasted a long token would have to go and find it again. Empty until a
   * submit fails, so the modal still opens prefilled with nothing.
   */
  const [draft, setDraft] = useState<string>("");

  return (
    <BasicFormModal
      title={"Update Content"}
      name="Workflow > Update Variable Content"
      isLoading={isLoading}
      error={error || undefined}
      description={`Replace the content of "${
        props.variable.name || "this variable"
      }". Every workflow that refers to this variable uses the new content from its next run.`}
      submitButtonText="Update Content"
      onClose={() => {
        setIsLoading(false);
        setError("");
        setDraft("");
        props.onClose();
      }}
      onSubmit={async (data: JSONObject) => {
        const variableId: ObjectID | null = props.variable.id;

        if (!variableId) {
          setError(
            "This variable cannot be updated because it has no id. Refresh the page and try again.",
          );
          return;
        }

        try {
          setIsLoading(true);
          setError("");

          await ModelAPI.updateById<WorkflowVariable>({
            modelType: WorkflowVariable,
            id: variableId,
            data: {
              content: data["content"],
            },
          });
        } catch (err) {
          /*
           * Kept on screen, with the reason and with what the user typed. On a
           * credential, swallowing this is the difference between a rotation
           * and a silent non-rotation.
           */
          setDraft((data["content"] as string) || "");
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
          return;
        }

        setIsLoading(false);
        setDraft("");
        props.onSuccess();
      }}
      formProps={{
        initialValues: draft ? { content: draft } : {},
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
  );
};

export default UpdateWorkflowVariableContentModal;
