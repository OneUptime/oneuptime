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

const EpisodeRemediation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Remediation Notes"
      cardProps={{
        title: "Remediation Notes",
        description:
          "What steps should be taken to resolve this episode? Here are the remediation notes.",
      }}
      createEditModalWidth={ModalWidth.Large}
      editButtonText="Edit Remediation Notes"
      isEditable={true}
      formFields={[
        {
          field: {
            remediationNotes: true,
          },
          title: "Remediation Notes",

          fieldType: FormFieldSchemaType.Markdown,
          required: true,
          placeholder: "Remediation Notes",
          description: MarkdownUtil.getMarkdownCheatsheet(
            "Add remediation notes for this episode here",
          ),
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: IncidentEpisode,
        id: "model-detail-episode-remediation-notes",
        fields: [
          {
            field: {
              remediationNotes: true,
            },
            title: "Remediation Notes",
            placeholder: "No remediation notes added for this episode.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default EpisodeRemediation;
