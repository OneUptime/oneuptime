import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const EpisodeDescription: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Episode Description"
      cardProps={{
        title: "Episode Description",
        description: "Description of this episode in markdown format.",
      }}
      createEditModalWidth={ModalWidth.Large}
      editButtonText="Edit Episode Description"
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
        modelType: IncidentEpisode,
        id: "model-detail-episode-description",
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

export default EpisodeDescription;
