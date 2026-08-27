import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { BILLING_ENABLED } from "Common/UI/Config";

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
    </Fragment>
  );
};

export default Settings;
