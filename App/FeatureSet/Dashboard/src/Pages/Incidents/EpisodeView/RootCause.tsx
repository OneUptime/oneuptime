import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const EpisodeRootCause: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Episode Root Cause"
      cardProps={{
        title: "Episode Root Cause",
        description:
          "Document the root cause of this episode for future reference.",
      }}
      createEditModalWidth={ModalWidth.Large}
      editButtonText="Edit Root Cause"
      isEditable={true}
      formFields={[
        {
          field: {
            rootCause: true,
          },
          title: "Root Cause",
          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          placeholder: "What was the root cause of this episode?",
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: IncidentEpisode,
        id: "model-detail-episode-root-cause",
        fields: [
          {
            field: {
              rootCause: true,
            },
            title: "Root Cause",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default EpisodeRootCause;
