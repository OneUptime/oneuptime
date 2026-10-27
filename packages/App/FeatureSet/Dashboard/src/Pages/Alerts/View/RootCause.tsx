import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const AlertDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Root Cause"
      cardProps={{
        title: "Root Cause",
        description:
          "Why did this alert happen? Here is the root cause of this alert.",
      }}
      createEditModalWidth={ModalWidth.Large}
      isEditable={true}
      editButtonText="Edit Root Cause"
      formFields={[
        {
          field: {
            rootCause: true,
          },
          title: "Root Cause",

          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          placeholder: "Root Cause",
          description: "Describe the root cause of this alert here.",
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Alert,
        id: "model-detail-alert-root-cause",
        fields: [
          {
            field: {
              rootCause: true,
            },
            title: "",
            placeholder: "No root cause identified for this alert.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default AlertDelete;
