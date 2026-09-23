/*
 * Replaces an OAuth 2.0 variable's client secret or refresh token. Both are
 * write-only and encrypted, so - like a static variable's content - they are
 * replaced here rather than edited on the settings form. A field left empty
 * keeps what is saved.
 *
 * The caller fetches a token with the new credentials once this reports what
 * it saved, so a secret the provider refuses shows up while the person who
 * pasted it is still looking.
 */

import React, { FunctionComponent, ReactElement, useState } from "react";
import { JSONObject } from "Common/Types/JSON";
import { OAuth2GrantType } from "Common/Types/Workflow/WorkflowVariableOAuth";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

export interface ComponentProps {
  variable: WorkflowVariable;
  onClose: () => void;
  // What was saved, in words: "Client secret", "Refresh token" or both.
  onSaved: (savedWhat: string) => void;
}

const UpdateWorkflowVariableCredentialsModal: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const fields: Array<Field<JSONObject>> = [
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
  ];

  if (props.variable.oauthGrantType === OAuth2GrantType.RefreshToken) {
    fields.push({
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
    });
  }

  return (
    <BasicFormModal
      title={"Update Credentials"}
      name="Workflow > Update OAuth Variable Credentials"
      isLoading={isLoading}
      error={error || undefined}
      description={`Replace the credentials "${
        props.variable.name || "this variable"
      }" uses to get access tokens. Leave a field empty to keep what is saved. OneUptime fetches a new token with them as soon as you save.`}
      submitButtonText="Save and Refresh Token"
      onClose={() => {
        setIsLoading(false);
        setError("");
        props.onClose();
      }}
      onSubmit={async (data: JSONObject) => {
        if (!props.variable.id) {
          setError(
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
          setError(
            "Enter a new client secret or refresh token, or close this dialog to keep the saved ones.",
          );
          return;
        }

        try {
          setIsLoading(true);
          setError("");

          await ModelAPI.updateById<WorkflowVariable>({
            modelType: WorkflowVariable,
            id: props.variable.id,
            data: update,
          });
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
          return;
        }

        setIsLoading(false);

        props.onSaved(
          clientSecret && refreshToken
            ? "Client secret and refresh token"
            : clientSecret
              ? "Client secret"
              : "Refresh token",
        );
      }}
      formProps={{
        fields,
      }}
    />
  );
};

export default UpdateWorkflowVariableCredentialsModal;
