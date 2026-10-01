/*
 * "Create OAuth 2.0 Variable", from the More menu beside the variables list's
 * Create button. The Create button itself only ever makes a static variable -
 * the kind almost everybody wants - so this form is the one place that asks
 * for a token URL, a client ID and credentials, and it never asks which kind of
 * variable it is creating: it stamps OAuth 2.0 itself before it saves.
 *
 * It walks four steps (OAUTH_VARIABLE_FORM_STEPS): Variable, Provider,
 * Credentials and Advanced. Picking an identity provider fills in its token
 * URL; the provider itself is not saved, so it is taken out of the request
 * here and the variable is created exactly as before the form had steps.
 */

import React, { FunctionComponent, ReactElement } from "react";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { WorkflowVariableType } from "Common/Types/Workflow/WorkflowVariableOAuth";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  OAUTH_VARIABLE_FORM_STEPS,
  getOAuthVariableCreateFormFields,
} from "../../Utils/Workflow/WorkflowVariableUtil";
import { OAUTH_IDENTITY_PROVIDER_FIELD_KEY } from "../../Utils/Workflow/OAuthIdentityProviders";

export interface ComponentProps {
  /*
   * The workflow the new variable belongs to. Leave it out for a project-wide
   * global variable, whose workflowId stays unset.
   */
  workflowId?: ObjectID | undefined;
  onClose: () => void;
  onSuccess: (variable: WorkflowVariable) => void;
}

const CreateOAuthWorkflowVariableModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isGlobal: boolean = !props.workflowId;

  return (
    <ModelFormModal<WorkflowVariable>
      modelType={WorkflowVariable}
      title="Create OAuth 2.0 Variable"
      name="Workflow > Create OAuth 2.0 Variable"
      description="OneUptime fetches an access token from your identity provider and fetches a new one whenever a workflow is about to use an expired token. Workflows use the variable like any other, for example as a bearer token."
      modalWidth={ModalWidth.Medium}
      submitButtonText="Create OAuth 2.0 Variable"
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onBeforeCreate={(
        item: WorkflowVariable,
        miscDataProps: JSONObject,
      ): Promise<WorkflowVariable> => {
        item.variableType = WorkflowVariableType.OAuth2;

        if (props.workflowId) {
          item.workflowId = props.workflowId;
        }

        /*
         * The identity provider only filled in the form. It is no column of
         * the variable, and the server has no use for it.
         */
        delete miscDataProps[OAUTH_IDENTITY_PROVIDER_FIELD_KEY];

        return Promise.resolve(item);
      }}
      formProps={{
        id: "create-oauth-workflow-variable-form",
        name: "Workflow > Create OAuth 2.0 Variable",
        modelType: WorkflowVariable,
        formType: FormType.Create,
        steps: OAUTH_VARIABLE_FORM_STEPS,
        fields: getOAuthVariableCreateFormFields({ isGlobal }),
      }}
    />
  );
};

export default CreateOAuthWorkflowVariableModal;
