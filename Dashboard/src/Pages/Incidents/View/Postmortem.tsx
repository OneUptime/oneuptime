import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageComponentProps from "../../PageComponentProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";

const POSTMORTEM_FORM_FIELDS: Fields<Incident> = [
  {
    field: {
      postmortemNote: true,
    },
    title: "Postmortem Note",
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    placeholder: "Postmortem Note",
    description: MarkdownUtil.getMarkdownCheatsheet(
      "Capture what happened, impact, resolution, and follow-up actions.",
    ),
  },
  {
    field: {
      postmortemAttachments: true,
    },
    title: "Postmortem Attachments",
    fieldType: FormFieldSchemaType.MultipleFiles,
    required: false,
    description:
      "Upload supporting evidence (images, reports, timelines) that can be shared once the postmortem is public.",
  },
  {
    field: {
      postmortemPostedAt: true,
    },
    title: "Postmortem Published At",
    fieldType: FormFieldSchemaType.DateTime,
    required: false,
    description: "Set the posted-on timestamp subscribers will see. ",
    placeholder: "Select date and time",
    getDefaultValue: () => {
      return OneUptimeDate.getCurrentDate();
    },
  },
  {
    field: {
      showPostmortemOnStatusPage: true,
    },
    title: "Publish on Status Page",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description:
      "Enable to display the postmortem note and attachments as the closing update for this incident on your status page.",
    defaultValue: false,
  },
  {
    field: {
      notifySubscribersOnPostmortemPublished: true,
    },
    title: "Notify Subscribers",
    fieldType: FormFieldSchemaType.Checkbox,
    required: false,
    description: "Notify subscribers when this postmortem is published.",
    defaultValue: true,
    showIf: (model: FormValues<Incident>) => {
      return Boolean(model && model.showPostmortemOnStatusPage);
    },
  },
];

const IncidentPostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [incidentPostmortemTemplates, setIncidentPostmortemTemplates] =
    useState<Array<IncidentPostmortemTemplate>>([]);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [showTemplateEditModal, setShowTemplateEditModal] =
    useState<boolean>(false);
  const [templateInitialValues, setTemplateInitialValues] =
    useState<FormValues<Incident> | null>(null);
  const [showAIGenerateModal, setShowAIGenerateModal] = useState<boolean>(false);
  const [aiTemplates, setAiTemplates] = useState<
    Array<{ id: string; name: string; content?: string }>
  >([]);

  const handleResendPostmortemNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

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
      } finally {
        setIsLoading(false);
      }
    };

  const fetchTemplates: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const listResult: ListResult<IncidentPostmortemTemplate> =
        await ModelAPI.getList<IncidentPostmortemTemplate>({
          modelType: IncidentPostmortemTemplate,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            templateName: true,
            _id: true,
          },
          sort: {},
        });

      setIncidentPostmortemTemplates(listResult.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const applyTemplate: (templateId: ObjectID) => Promise<void> = async (
    templateId: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const template: IncidentPostmortemTemplate | null =
        await ModelAPI.getItem<IncidentPostmortemTemplate>({
          modelType: IncidentPostmortemTemplate,
          id: templateId,
          select: {
            postmortemNote: true,
          },
        });

      if (!template || !template.postmortemNote) {
        setError("The selected template does not contain a postmortem note.");
        setShowTemplateModal(false);
        return;
      }

      setTemplateInitialValues({
        postmortemNote: template.postmortemNote,
      });
      setShowTemplateModal(false);
      setShowTemplateEditModal(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showTemplateModal) {
      return;
    }

    fetchTemplates().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [showTemplateModal]);

  // Fetch templates for AI generation modal
  useEffect(() => {
    if (!showAIGenerateModal) {
      return;
    }

    const fetchAITemplates: () => Promise<void> = async (): Promise<void> => {
      try {
        const listResult: ListResult<IncidentPostmortemTemplate> =
          await ModelAPI.getList<IncidentPostmortemTemplate>({
            modelType: IncidentPostmortemTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              templateName: true,
              postmortemNote: true,
            },
            sort: {},
          });

        const templates: Array<{ id: string; name: string; content?: string }> =
          listResult.data.map((template: IncidentPostmortemTemplate) => {
            const templateItem: { id: string; name: string; content?: string } = {
              id: template._id?.toString() || "",
              name: template.templateName || "Unnamed Template",
            };
            if (template.postmortemNote) {
              templateItem.content = template.postmortemNote;
            }
            return templateItem;
          });

        setAiTemplates(templates);
      } catch (err) {
        // Silently fail - templates are optional
        setAiTemplates([]);
      }
    };

    fetchAITemplates().catch(() => {
      setAiTemplates([]);
    });
  }, [showAIGenerateModal]);

  const handleGeneratePostmortemFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (data: GenerateAIRequestData): Promise<string> => {
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
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    const postmortemNote: string =
      (response.data as JSONObject)["postmortemNote"] as string;

    if (!postmortemNote) {
      throw new Error("Failed to generate postmortem note from AI.");
    }

    return postmortemNote;
  };

  const handleAIGenerationSuccess: (generatedContent: string) => void = (
    generatedContent: string,
  ): void => {
    setShowAIGenerateModal(false);
    setTemplateInitialValues({
      postmortemNote: generatedContent,
    });
    setShowTemplateEditModal(true);
  };

  return (
    <>
      <CardModelDetail<Incident>
        name="Postmortem Note"
        cardProps={{
          title: "Postmortem Note",
          description:
            "Document the summary, learnings, and follow-ups for this incident.",
          buttons: [
            {
              title: "Generate from AI",
              icon: IconProp.Bolt,
              buttonStyle: ButtonStyleType.SUCCESS,
              onClick: () => {
                setShowAIGenerateModal(true);
              },
            },
            {
              title: "Apply Template",
              icon: IconProp.Template,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                setShowTemplateModal(true);
              },
            },
          ],
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText="Edit Postmortem Note"
        onSaveSuccess={() => {
          setRefreshToggle((previous: boolean) => {
            return !previous;
          });
        }}
        formFields={POSTMORTEM_FORM_FIELDS}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-postmortem-note",
          selectMoreFields: {
            subscriberNotificationStatusMessageOnPostmortemPublished: true,
          },
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
              showIf: (item: Incident): boolean => {
                return Boolean(item.showPostmortemOnStatusPage);
              },
            },
            {
              field: {
                subscriberNotificationStatusOnPostmortemPublished: true,
              },
              title: "Subscriber Notification Status",
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                return (
                  <SubscriberNotificationStatus
                    status={
                      item.subscriberNotificationStatusOnPostmortemPublished
                    }
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessageOnPostmortemPublished
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
                      No postmortem attachments uploaded for this incident.
                    </div>
                  );
                }

                if (!modelIdString) {
                  return (
                    <div className="text-sm text-gray-400 italic">
                      Attachments are available but the incident identifier is
                      missing, so they cannot be displayed.
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
          ],
          modelId: modelId,
        }}
      />

      {showTemplateModal &&
      incidentPostmortemTemplates.length === 0 &&
      !isLoading ? (
        <ConfirmModal
          title={`No Postmortem Templates`}
          description={`No postmortem templates have been created yet. You can create these in Project Settings > Incident > Postmortem Templates.`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowTemplateModal(false);
          }}
        />
      ) : (
        <></>
      )}

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

      {showTemplateModal && incidentPostmortemTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Apply Postmortem Template"
          isLoading={isLoading}
          submitButtonText="Apply Template"
          onClose={() => {
            setShowTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await applyTemplate(
              data["incidentPostmortemTemplateId"] as ObjectID,
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  incidentPostmortemTemplateId: true,
                },
                title: "Select Template",
                description:
                  "Choose a postmortem template to populate the note.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: incidentPostmortemTemplates,
                    labelField: "templateName",
                    valueField: "_id",
                  },
                ),
                required: true,
                placeholder: "Select Template",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {showTemplateEditModal ? (
        <ModelFormModal<Incident>
          title="Edit Postmortem Note"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
          }}
          onSuccess={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
            setRefreshToggle((previous: boolean) => {
              return !previous;
            });
          }}
          name="incident-postmortem-note-from-template"
          modelType={Incident}
          modelIdToEdit={modelId}
          initialValues={templateInitialValues || undefined}
          formProps={{
            id: "incident-postmortem-note-template-form",
            fields: POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: Incident,
            name: "Postmortem Note",
            doNotFetchExistingModel: true,
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
          templates={aiTemplates}
          dataSourceItems={[
            "Incident details and description",
            "State timeline and history",
            "Internal and public notes",
            "Slack/Teams channel discussions",
          ]}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default IncidentPostmortem;
