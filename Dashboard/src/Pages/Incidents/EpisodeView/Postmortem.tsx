import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const EpisodePostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Postmortem"
      cardProps={{
        title: "Postmortem",
        description:
          "Document the postmortem analysis for this episode. Include learnings, action items, and preventive measures.",
      }}
      createEditModalWidth={ModalWidth.Large}
      editButtonText="Edit Postmortem"
      isEditable={true}
      formFields={[
        {
          field: {
            postmortemNote: true,
          },
          title: "Postmortem",

          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          placeholder: "Postmortem analysis and notes",
          description: MarkdownUtil.getMarkdownCheatsheet(
            "Add postmortem notes for this episode here",
          ),
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: IncidentEpisode,
        id: "model-detail-episode-postmortem",
        fields: [
          {
            field: {
              postmortemNote: true,
            },
            title: "Postmortem",
            placeholder: "No postmortem added for this episode.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default EpisodePostmortem;
