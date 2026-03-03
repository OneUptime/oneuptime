import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const EpisodeSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Episode Settings"
      cardProps={{
        title: "Episode Settings",
        description: "Manage settings for this episode here.",
      }}
      isEditable={true}
      editButtonText="Edit Settings"
      formFields={[
        {
          field: {
            isVisibleOnStatusPage: true,
          },
          title: "Visible on Status Page",
          fieldType: FormFieldSchemaType.Checkbox,
          required: false,
          description:
            "When enabled, this episode will be visible on your public status pages.",
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: IncidentEpisode,
        id: "model-detail-episode-settings",
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

export default EpisodeSettings;
