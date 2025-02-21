import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Incident Settings"
      cardProps={{
        title: "Incident Settings",
        description: "Manage settings for this incident here.",
      }}
      isEditable={true}
      editButtonText="Edit Settings"
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
        modelType: Incident,
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

export default IncidentDelete;
