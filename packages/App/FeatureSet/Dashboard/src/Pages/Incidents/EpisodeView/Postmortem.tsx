import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { FunctionComponent, ReactElement, useState } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { POSTMORTEM_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import usePostmortemTemplates, {
  PostmortemTemplatesState,
} from "../../../Components/Postmortem/usePostmortemTemplates";
import {
  PostmortemTemplateOption,
  toAITemplates,
} from "../../../Components/Postmortem/PostmortemTemplates";
import { getPostmortemCardButtons } from "../../../Components/Postmortem/PostmortemCardButtons";
import ApplyPostmortemTemplateModal from "../../../Components/Postmortem/ApplyPostmortemTemplateModal";

const POSTMORTEM_FORM_FIELDS: Fields<IncidentEpisode> = [
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
];

const EpisodePostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const postmortemTemplates: PostmortemTemplatesState =
    usePostmortemTemplates();
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  // The note a template or AI wrote, while the editor is open on it.
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [showAIGenerateModal, setShowAIGenerateModal] =
    useState<boolean>(false);

  const handleGeneratePostmortemFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (
    data: GenerateAIRequestData,
  ): Promise<string> => {
    const apiUrl: URL = URL.fromString(
      APP_API_URL.toString() +
        `/incident-episode/generate-postmortem-from-ai/${modelId.toString()}`,
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: apiUrl,
        data: {
          template: data.template,
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    const postmortemNote: string = (response.data as JSONObject)[
      "postmortemNote"
    ] as string;

    if (!postmortemNote) {
      throw new Error("Failed to generate postmortem note with AI.");
    }

    return postmortemNote;
  };

  const handleAIGenerationSuccess: (generatedContent: string) => void = (
    generatedContent: string,
  ): void => {
    setShowAIGenerateModal(false);
    setDraftNote(generatedContent);
  };

  const handleTemplatePicked: (template: PostmortemTemplateOption) => void = (
    template: PostmortemTemplateOption,
  ): void => {
    setShowTemplateModal(false);

    if (!template.note.trim()) {
      setError("The selected template does not contain a postmortem note.");
      return;
    }

    setDraftNote(template.note);
  };

  return (
    <>
      <CardModelDetail<IncidentEpisode>
        name="Postmortem"
        cardProps={{
          title: "Postmortem",
          description:
            "Document the postmortem analysis for this episode. Include learnings, action items, and preventive measures.",
          buttons: getPostmortemCardButtons({
            model: new IncidentEpisode(),
            hasTemplates: postmortemTemplates.templates.length > 0,
            onGenerateWithAI: () => {
              setShowAIGenerateModal(true);
            },
            onApplyTemplate: () => {
              setShowTemplateModal(true);
            },
          }),
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        editButtonText="Edit Postmortem"
        // The dialog names what it edits, as the button does - not "Edit Incident Episode".
        editModalTitle="Edit Postmortem"
        isEditable={true}
        onSaveSuccess={() => {
          setRefreshToggle((previous: boolean) => {
            return !previous;
          });
        }}
        formFields={POSTMORTEM_FORM_FIELDS}
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

      {error ? (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      {showTemplateModal && postmortemTemplates.templates.length > 0 ? (
        <ApplyPostmortemTemplateModal
          name="Incident Episode > Apply Postmortem Template"
          templates={postmortemTemplates.templates}
          onPick={handleTemplatePicked}
          onClose={() => {
            setShowTemplateModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {draftNote !== null ? (
        <ModelFormModal<IncidentEpisode>
          title="Edit Postmortem"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setDraftNote(null);
          }}
          onSuccess={() => {
            setDraftNote(null);
            setRefreshToggle((previous: boolean) => {
              return !previous;
            });
          }}
          name="episode-postmortem-from-template"
          modelType={IncidentEpisode}
          modelIdToEdit={modelId}
          initialValues={{
            postmortemNote: draftNote,
          }}
          formProps={{
            id: "episode-postmortem-template-form",
            fields: POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: IncidentEpisode,
            name: "Postmortem",
            // The note is the form's only field, so there is nothing to fetch.
            doNotFetchExistingModel: true,
          }}
        />
      ) : (
        <></>
      )}

      {showAIGenerateModal ? (
        <GenerateFromAIModal
          title="Generate Postmortem with AI"
          description="AI will analyze the episode data, member incidents, timeline, notes, and channel discussions to generate a comprehensive postmortem."
          onClose={() => {
            setShowAIGenerateModal(false);
          }}
          onGenerate={handleGeneratePostmortemFromAI}
          onSuccess={handleAIGenerationSuccess}
          templates={[
            ...POSTMORTEM_TEMPLATES,
            ...toAITemplates(postmortemTemplates.templates),
          ]}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default EpisodePostmortem;
