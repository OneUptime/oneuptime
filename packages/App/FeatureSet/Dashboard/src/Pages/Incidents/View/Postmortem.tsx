import PageComponentProps from "../../PageComponentProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { FunctionComponent, ReactElement, useState } from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { POSTMORTEM_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  INCIDENT_POSTMORTEM_FORM_FIELDS,
  INCIDENT_POSTMORTEM_FORM_STEPS,
} from "../../../Components/Postmortem/IncidentPostmortemForm";
import usePostmortemTemplates, {
  PostmortemTemplatesState,
} from "../../../Components/Postmortem/usePostmortemTemplates";
import {
  PostmortemTemplateOption,
  toAITemplates,
} from "../../../Components/Postmortem/PostmortemTemplates";
import { getPostmortemCardButtons } from "../../../Components/Postmortem/PostmortemCardButtons";
import ApplyPostmortemTemplateModal from "../../../Components/Postmortem/ApplyPostmortemTemplateModal";

// Whether the postmortem is on the status page, and so what it says there.
const isPublished: (item: Incident) => boolean = (item: Incident): boolean => {
  return Boolean(item.showPostmortemOnStatusPage);
};

const IncidentPostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const postmortemTemplates: PostmortemTemplatesState =
    usePostmortemTemplates();
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  /*
   * The note a template or AI wrote, while the postmortem's editor is open
   * on it. Everything else in that editor is what the incident holds.
   */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [showAIGenerateModal, setShowAIGenerateModal] =
    useState<boolean>(false);

  const handleResendPostmortemNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: Incident,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              "Notification queued for resending",
          },
        });

        // Refresh the data to show updated status
        setRefreshToggle((previous: boolean) => {
          return !previous;
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

  const handleGeneratePostmortemFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (
    data: GenerateAIRequestData,
  ): Promise<string> => {
    const apiUrl: URL = URL.fromString(
      APP_API_URL.toString() +
        `/incident/generate-postmortem-from-ai/${modelId.toString()}`,
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
      <CardModelDetail<Incident>
        name="Postmortem Note"
        cardProps={{
          title: "Postmortem Note",
          description:
            "Document the summary, learnings, and follow-ups for this incident.",
          buttons: getPostmortemCardButtons({
            model: new Incident(),
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
        isEditable={true}
        editButtonText="Edit Postmortem Note"
        // The dialog names what it edits, as the button does - not "Edit Incident".
        editModalTitle="Edit Postmortem Note"
        onSaveSuccess={() => {
          setRefreshToggle((previous: boolean) => {
            return !previous;
          });
        }}
        formSteps={INCIDENT_POSTMORTEM_FORM_STEPS}
        formFields={INCIDENT_POSTMORTEM_FORM_FIELDS}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-postmortem-note",
          selectMoreFields: {
            subscriberNotificationStatusMessageOnPostmortemPublished: true,
            // Whether a skipped notification still waits for the incident to show.
            isVisibleOnStatusPage: true,
          },
          /*
           * The write-up and its files first, then the status page: whether
           * the postmortem is on it and, only while it is, whether and when
           * subscribers heard about it and the time it shows.
           */
          fields: [
            {
              field: {
                postmortemNote: true,
              },
              title: "",
              placeholder: "No postmortem note documented for this incident.",
              fieldType: FieldType.Markdown,
            },
            {
              field: {
                postmortemAttachments: {
                  _id: true,
                  name: true,
                  fileType: true,
                  createdAt: true,
                },
              },
              title: "Postmortem Attachments",
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                const modelIdString: string | null = getModelIdString(item);

                if (!item.postmortemAttachments?.length) {
                  return (
                    <div className="text-sm text-gray-500">
                      {translator.translateText(
                        "No postmortem attachments uploaded for this incident.",
                      )}
                    </div>
                  );
                }

                if (!modelIdString) {
                  return (
                    <div className="text-sm text-gray-400 italic">
                      {translator.translateText(
                        "Attachments are available but the incident identifier is missing, so they cannot be displayed.",
                      )}
                    </div>
                  );
                }

                return (
                  <AttachmentList
                    modelId={modelIdString}
                    attachments={item.postmortemAttachments}
                    attachmentApiPath="/incident/postmortem/attachment"
                  />
                );
              },
            },
            {
              field: {
                showPostmortemOnStatusPage: true,
              },
              title: "Postmortem visible on Status Page?",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                notifySubscribersOnPostmortemPublished: true,
              },
              title: "Notify Subscribers",
              fieldType: FieldType.Boolean,
              showIf: isPublished,
            },
            {
              field: {
                subscriberNotificationStatusOnPostmortemPublished: true,
              },
              title: "Subscriber Notification Status",
              fieldType: FieldType.Element,
              showIf: (item: Incident): boolean => {
                return (
                  isPublished(item) &&
                  Boolean(item.notifySubscribersOnPostmortemPublished)
                );
              },
              getElement: (item: Incident): ReactElement => {
                return (
                  <SubscriberNotificationStatus
                    status={
                      item.subscriberNotificationStatusOnPostmortemPublished
                    }
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessageOnPostmortemPublished
                    }
                    /*
                     * Published while the incident is hidden: not sent yet,
                     * rather than not to be sent - it goes out when the
                     * incident is made visible on status pages.
                     */
                    statusText={
                      IncidentPostmortemPublication.isWaitingForIncidentToShow(
                        item,
                      )
                        ? IncidentPostmortemPublication.hiddenIncidentLabel
                        : undefined
                    }
                    onResendNotification={handleResendPostmortemNotification}
                  />
                );
              },
            },
            {
              field: {
                postmortemPostedAt: true,
              },
              title: "Postmortem Published At",
              fieldType: FieldType.DateTime,
              placeholder: "-",
              showIf: isPublished,
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
          name="Incident > Apply Postmortem Template"
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
        <ModelFormModal<Incident>
          title="Edit Postmortem Note"
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
          name="incident-postmortem-note-from-template"
          modelType={Incident}
          modelIdToEdit={modelId}
          formProps={{
            id: "incident-postmortem-note-template-form",
            steps: INCIDENT_POSTMORTEM_FORM_STEPS,
            fields: INCIDENT_POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: Incident,
            name: "Postmortem Note",
            /*
             * The incident's postmortem as it is stored, with the drafted
             * note in place of its note: a draft must not quietly change
             * whether the postmortem is on the status page, when it was
             * published or its attachments.
             */
            draftValues: {
              postmortemNote: draftNote,
            },
          }}
        />
      ) : (
        <></>
      )}

      {showAIGenerateModal ? (
        <GenerateFromAIModal
          title="Generate Postmortem with AI"
          description="AI will analyze the incident data, timeline, notes, and channel discussions to generate a comprehensive postmortem."
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

export default IncidentPostmortem;
