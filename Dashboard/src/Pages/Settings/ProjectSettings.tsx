import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Project from "Model/Models/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { BILLING_ENABLED } from "CommonUI/src/Config";

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
            },
            {
              field: {
                name: true,
              },
              title: "Project Name",
            },
          ],
          modelId: DashboardNavigation.getProjectId()!,
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
            modelId: DashboardNavigation.getProjectId()!,
          }}
        />
      )}
    </Fragment>
  );
};

export default Settings;
