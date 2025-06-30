import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Incident Description"
      cardProps={{
        title: "Incident Description",
        description:
          "Description of this incident. This is visible on Status Page and is in markdown format.",
      }}
      editButtonText="Edit Incident Description"
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
          description: MarkdownUtil.getMarkdownCheatsheet(
            "Describe the incident details here",
          ),
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Incident,
        id: "model-detail-incident-description",
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

export default IncidentDelete;
