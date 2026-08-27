import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  BILLING_ENABLED,
  PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE,
} from "Common/UI/Config";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      {/* Project Settings View  */}
      <CardModelDetail
        name="Project Details"
        cardProps={{
          title: "Project Details",
          description: "Here are more details for this Project.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Project Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Project Name",
            validation: {
              minLength: 2,
            },
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Project ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Project Name",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/* Project Settings View  */}
      {BILLING_ENABLED && (
        <CardModelDetail
          name="Enable Customer Support Access"
          cardProps={{
            title: "Enable Customer Support Access",
            description:
              "Enable Customer Support Access to this project. This will allow Customer Support to access this project for troubleshooting purposes.",
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                letCustomerSupportAccessProject: true,
              },
              title: "Let Customer Support Access Project",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
          ]}
          onSaveSuccess={() => {
            Navigation.reload();
          }}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project",
            fields: [
              {
                field: {
                  letCustomerSupportAccessProject: true,
                },
                fieldType: FieldType.Boolean,
                title: "Let Customer Support Access Project",
                placeholder: "No",
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />
      )}

      {/*
        Project half of the private-network webhook opt-in (issue #3424).

        Only rendered when the instance operator configured the exception
        (ALLOW_PRIVATE_NETWORK_WEBHOOKS / PRIVATE_NETWORK_WEBHOOK_ALLOWLIST) —
        on every other deployment, SaaS included, the toggle would be a switch
        wired to nothing. Hiding it is presentation only: the server re-derives
        both halves of the policy on every outbound webhook.
      */}
      {PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE && (
        <CardModelDetail
          name="Private Network Webhooks"
          cardProps={{
            title: "Private Network Webhooks",
            description:
              "Your OneUptime instance permits webhooks to private network addresses. Turn this on to let workflows, project webhooks and on-call user webhooks in this project reach internal services — for example a self-hosted Mattermost on your private network. Status page subscriber webhooks are never included, because anyone can register one. Leave it off unless you need it.",
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                allowPrivateNetworkWebhooks: true,
              },
              title: "Allow Private Network Webhooks",
              description:
                "Which internal addresses become reachable is decided by your instance configuration, not by this project.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
          ]}
          onSaveSuccess={() => {
            Navigation.reload();
          }}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-private-network-webhooks",
            fields: [
              {
                field: {
                  allowPrivateNetworkWebhooks: true,
                },
                fieldType: FieldType.Boolean,
                title: "Allow Private Network Webhooks",
                placeholder: "No",
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />
      )}
    </Fragment>
  );
};

export default Settings;
