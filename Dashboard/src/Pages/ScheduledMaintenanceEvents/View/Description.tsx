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
      name="Scheduled Maintenance Description"
      cardProps={{
        title: "Scheduled Maintenance Description",
        description:
          "Description of this scheduled maintenance. This is visible on Status Page and is in markdown format.",
      }}
      editButtonText="Edit Scheduled Maintenance Description"
      isEditable={true}
      formFields={[
        {
          field: {
            description: true,
          },
          title: "Description",

          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          placeholder: "Description",
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: ScheduledMaintenance,
        id: "model-detail-scheduled-maintenance-description",
        fields: [
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default ScheduledMaintenanceDelete;
