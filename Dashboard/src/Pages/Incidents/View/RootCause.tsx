import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Root Cause"
      cardProps={{
        title: "Root Cause",
        description:
          "Why did this incident happen? Here is the root cause of this incident.",
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
          description: MarkdownUtil.getMarkdownCheatsheet(
            "Describe the root cause of this incident here",
          ),
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Incident,
        id: "model-detail-incident-root-cause",
        fields: [
          {
            field: {
              rootCause: true,
            },
            title: "",
            placeholder: "No root cause identified for this incident.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default IncidentDelete;
