import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Project from "Common/AppModels/Models/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      {/* Project Settings View  */}
      <CardModelDetail
        name="Feature Flags"
        cardProps={{
          title: "Feature Flags",
          description:
            "Feature flags allow you to toggle features on and off for your project.",
        }}
        isEditable={true}
        editButtonText="Edit Feature Flags"
        formFields={[
          {
            field: {
              isFeatureFlagMonitorGroupsEnabled: true,
            },
            title: "Enable Monitor Groups",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Monitor Groups allow you to group monitors together and view them as a group and allows you to add these to your status page.",
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
                isFeatureFlagMonitorGroupsEnabled: true,
              },
              fieldType: FieldType.Boolean,
              title: "Monitor Groups Enabled",
              description:
                "Monitor Groups allow you to group monitors together and view them as a group and allows you to add these to your status page.",
              placeholder: "No",
            },
          ],
          modelId: DashboardNavigation.getProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default Settings;
