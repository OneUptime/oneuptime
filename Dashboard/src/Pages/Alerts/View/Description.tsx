import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const AlertDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Alert Description"
      cardProps={{
        title: "Alert Description",
        description:
          "Description of this alert. This is visible on Status Page and is in markdown format.",
      }}
      editButtonText="Edit Alert Description"
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
        modelType: Alert,
        id: "model-detail-alert-description",
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

export default AlertDelete;
