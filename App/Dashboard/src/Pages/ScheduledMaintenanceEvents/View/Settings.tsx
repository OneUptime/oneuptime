import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const ScheduledMaintenanceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Scheduled Maintenance Settings"
      cardProps={{
        title: "Scheduled Maintenance Settings",
        description: "Manage your scheduled maintenance event settings here.",
      }}
      editButtonText="Edit Settings"
      isEditable={true}
      formFields={[
        {
          field: {
            isVisibleOnStatusPage: true,
          },
          title: "Visible on Status Page",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: ScheduledMaintenance,
        id: "model-detail-incident-settings",
        fields: [
          {
            field: {
              isVisibleOnStatusPage: true,
            },
            title: "Visible on Status Page",
            fieldType: FieldType.Boolean,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default ScheduledMaintenanceDelete;
