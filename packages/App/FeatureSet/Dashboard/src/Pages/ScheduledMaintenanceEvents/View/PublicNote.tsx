import MarkdownUtil from "Common/UI/Utils/Markdown";
import UserElement from "../../../Components/User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlignItem from "Common/UI/Types/AlignItem";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "Common/Models/DatabaseModels/User";
import ProjectUtil from "Common/UI/Utils/Project";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import { getNotifySubscribersOfUpdateFormField } from "../../../Components/StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { PUBLIC_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";

const PublicNote: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [
    scheduledMaintenanceNoteTemplates,
    setScheduledMaintenanceNoteTemplates,
  ] = useState<Array<ScheduledMaintenanceNoteTemplate>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [
    showScheduledMaintenanceNoteTemplateModal,
    setShowScheduledMaintenanceNoteTemplateModal,
  ] = useState<boolean>(false);
  const [
    initialValuesForScheduledMaintenance,
    setInitialValuesForScheduledMaintenance,
  ] = useState<JSONObject>({});
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [showGenerateFromAIModal, setShowGenerateFromAIModal] =
    useState<boolean>(false);
  /*
   * Where "Notify Status Page Subscribers" starts on a new note: off when
   * the event was created without notifying subscribers. Null until the
   * event loads - the create form reads its starting values once, so it
   * must not open before this is known.
   */
  const [notifySubscribersByDefault, setNotifySubscribersByDefault] = useState<
    boolean | null
  >(null);
  const [scheduledMaintenanceError, setScheduledMaintenanceError] =
    useState<string>("");

  useEffect(() => {
    let isStale: boolean = false;

    setNotifySubscribersByDefault(null);
    setScheduledMaintenanceError("");
    /*
     * Drop a template or AI draft from the previous event. The table
     * remounts once this event's flag loads and opens its create form when
     * a draft is present, which would post the old draft on this event.
     */
    setInitialValuesForScheduledMaintenance({});

    ModelAPI.getItem<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
      },
    })
      .then((scheduledMaintenance: ScheduledMaintenance | null) => {
        if (!isStale) {
          setNotifySubscribersByDefault(
            PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
              scheduledMaintenance,
            ),
          );
        }
      })
      .catch((err: unknown) => {
        if (!isStale) {
          setScheduledMaintenanceError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isStale = true;
    };
  }, [modelId.toString()]);

  const generateNoteFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (
    data: GenerateAIRequestData,
  ): Promise<string> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/scheduled-maintenance/generate-note-from-ai/${modelId.toString()}`,
        ),
        data: {
          template: data.template,
          noteType: "public",
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(response.message || "Failed to generate note with AI");
    }

    return response.data["note"] as string;
  };

  const handleAIGenerationSuccess: (generatedContent: string) => void = (
    generatedContent: string,
  ): void => {
    setShowGenerateFromAIModal(false);
    setInitialValuesForScheduledMaintenance({
      note: generatedContent,
    });
  };

  const handleResendNotification: (
    item: ScheduledMaintenancePublicNote,
  ) => Promise<void> = async (
    item: ScheduledMaintenancePublicNote,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: ScheduledMaintenancePublicNote,
        id: item.id!,
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage: null,
        },
      });
      setRefreshToggle(!refreshToggle);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  const handleResendUpdateNotification: (
    item: ScheduledMaintenancePublicNote,
  ) => Promise<void> = async (
    item: ScheduledMaintenancePublicNote,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: ScheduledMaintenancePublicNote,
        id: item.id!,
        data: {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessageOnNoteUpdated:
            SubscriberUpdateNotification.resendQueuedMessage,
        },
      });
      setRefreshToggle(!refreshToggle);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  const fetchScheduledMaintenanceNoteTemplate: (
    id: ObjectID,
  ) => Promise<void> = async (id: ObjectID): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch scheduledMaintenance template

      const scheduledMaintenanceNoteTemplate: ScheduledMaintenanceNoteTemplate | null =
        await ModelAPI.getItem<ScheduledMaintenanceNoteTemplate>({
          modelType: ScheduledMaintenanceNoteTemplate,
          id,
          select: {
            note: true,
          },
        });

      if (scheduledMaintenanceNoteTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(
            scheduledMaintenanceNoteTemplate,
            ScheduledMaintenanceNoteTemplate,
          ),
        };

        setInitialValuesForScheduledMaintenance(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setShowScheduledMaintenanceNoteTemplateModal(false);
  };

  const fetchScheduledMaintenanceNoteTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);
      setInitialValuesForScheduledMaintenance({});

      try {
        const listResult: ListResult<ScheduledMaintenanceNoteTemplate> =
          await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>({
            modelType: ScheduledMaintenanceNoteTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setScheduledMaintenanceNoteTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  if (scheduledMaintenanceError) {
    return <ErrorMessage message={scheduledMaintenanceError} />;
  }

  if (notifySubscribersByDefault === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenancePublicNote>
        modelType={ScheduledMaintenancePublicNote}
        id="table-scheduled-maintenance-internal-note"
        name="Scheduled Maintenance Events > Public Notes"
        userPreferencesKey="scheduled-maintenance-public-note-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-public-note-table",
        }}
        isDeleteable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        isEditable={true}
        showViewIdButton={true}
        showCreateForm={
          Object.keys(initialValuesForScheduledMaintenance).length > 0
        }
        /*
         * The notify flag is seeded as a value, not only as the field's
         * default: the form drops a false default, and an unsent flag would
         * fall back to notifying. It is kept out of
         * initialValuesForScheduledMaintenance, whose keys are what open the
         * form from a template or AI draft.
         */
        createInitialValues={{
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
            notifySubscribersByDefault,
          ...initialValuesForScheduledMaintenance,
        }}
        isViewable={false}
        refreshToggle={refreshToggle.toString()}
        query={{
          scheduledMaintenanceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenancePublicNote,
        ): Promise<ScheduledMaintenancePublicNote> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.scheduledMaintenanceId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Public Notes",
          buttons: [
            {
              title: "Generate with AI",
              icon: IconProp.Bolt,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: async (): Promise<void> => {
                setShowGenerateFromAIModal(true);
              },
            },
            {
              title: "Create from Template",
              icon: IconProp.Template,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: async (): Promise<void> => {
                setShowScheduledMaintenanceNoteTemplateModal(true);
                await fetchScheduledMaintenanceNoteTemplates();
              },
            },
          ],
          description:
            "Here are public notes for this scheduled maintenance. This will show up on the status page.",
        }}
        noItemsMessage={
          "No public notes created for this scheduled maintenance so far."
        }
        formFields={[
          {
            field: {
              note: true,
            },
            title: "Public Scheduled Maintenance Note",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "This note is visible on your Status Page",
            ),
          },
          {
            field: {
              attachments: true,
            },
            title: "Attachments",
            fieldType: FormFieldSchemaType.MultipleFiles,
            required: false,
            description:
              "Attach files that should be shared with subscribers on the status page.",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
            },

            title: "Notify Status Page Subscribers",
            stepId: "more",
            description: notifySubscribersByDefault
              ? "Should status page subscribers be notified?"
              : PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: notifySubscribersByDefault,
            required: false,
          },
          getNotifySubscribersOfUpdateFormField<ScheduledMaintenancePublicNote>(
            {
              description:
                "Send subscribers the edited note, marked as an update. Leave this unticked for small fixes such as typos.",
            },
          ),
          {
            field: {
              postedAt: true,
            },
            title: "Posted At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            description:
              "This is the date and time this note was posted. This is in " +
              OneUptimeDate.getCurrentTimezoneString() +
              ".",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
        ]}
        showRefreshButton={true}
        showAs={ShowAs.List}
        viewPageRoute={Navigation.getCurrentRoute()}
        selectMoreFields={{
          subscriberNotificationStatusMessage: true,
          subscriberNotificationStatusMessageOnNoteUpdated: true,
          attachments: {
            _id: true,
            name: true,
          },
        }}
        filters={[
          {
            field: {
              createdByUser: true,
            },
            type: FieldType.Entity,
            title: "Created By",
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              note: true,
            },
            type: FieldType.Text,
            title: "Note",
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.Date,
            title: "Created At",
          },
        ]}
        columns={[
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "",

            type: FieldType.Entity,

            getElement: (
              item: ScheduledMaintenancePublicNote,
            ): ReactElement => {
              return (
                <UserElement
                  user={item["createdByUser"]}
                  suffix={"wrote"}
                  usernameClassName={"text-base text-gray-900"}
                  suffixClassName={"text-base text-gray-500 mt-1"}
                />
              );
            },
          },
          {
            field: {
              postedAt: true,
            },

            alignItem: AlignItem.Right,
            title: "",
            type: FieldType.DateTime,
            contentClassName:
              "mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right",
          },
          {
            field: {
              note: true,
            },

            title: "",
            type: FieldType.Element,
            contentClassName: "-mt-3 space-y-3 text-sm text-gray-800",
            colSpan: 2,
            getElement: (
              item: ScheduledMaintenancePublicNote,
            ): ReactElement => {
              return (
                <div className="space-y-3">
                  <MarkdownViewer text={item.note || ""} />
                  <AttachmentList
                    modelId={getModelIdString(item)}
                    attachments={item.attachments}
                    attachmentApiPath="/scheduled-maintenance-public-note/attachment"
                  />
                </div>
              );
            },
          },
          {
            field: {
              subscriberNotificationStatusOnNoteCreated: true,
            },
            title: "Subscriber Notification Status",
            type: FieldType.Text,
            colSpan: 1,
            getElement: (
              item: ScheduledMaintenancePublicNote,
            ): ReactElement => {
              return (
                <SubscriberNotificationStatus
                  status={item.subscriberNotificationStatusOnNoteCreated}
                  subscriberNotificationStatusMessage={
                    item.subscriberNotificationStatusMessage
                  }
                  onResendNotification={() => {
                    return handleResendNotification(item);
                  }}
                />
              );
            },
          },
          {
            field: {
              subscriberNotificationStatusOnNoteUpdated: true,
            },
            title: "Update Notification Status",
            type: FieldType.Element,
            colSpan: 1,
            getElement: (
              item: ScheduledMaintenancePublicNote,
            ): ReactElement => {
              // Nothing to show until someone asks to notify about an edit.
              if (!item.subscriberNotificationStatusOnNoteUpdated) {
                return <></>;
              }

              return (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Update:</span>
                  <SubscriberNotificationStatus
                    status={item.subscriberNotificationStatusOnNoteUpdated}
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessageOnNoteUpdated
                    }
                    onResendNotification={() => {
                      return handleResendUpdateNotification(item);
                    }}
                  />
                </div>
              );
            },
          },
        ]}
      />

      {scheduledMaintenanceNoteTemplates.length === 0 &&
      showScheduledMaintenanceNoteTemplateModal &&
      !isLoading ? (
        <ConfirmModal
          title={`No ScheduledMaintenance Note Templates`}
          description={`No scheduled maintenance note templates have been created yet. You can create these in Project Settings > Scheduled Maintenance > Note Templates.`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setShowScheduledMaintenanceNoteTemplateModal(false);
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
            return setError("");
          }}
        />
      ) : (
        <></>
      )}

      {showScheduledMaintenanceNoteTemplateModal &&
      scheduledMaintenanceNoteTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Note from Template"
          name="Scheduled Maintenance > Public Note from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowScheduledMaintenanceNoteTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await fetchScheduledMaintenanceNoteTemplate(
              data["scheduledMaintenanceNoteTemplateId"] as ObjectID,
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  scheduledMaintenanceNoteTemplateId: true,
                },
                title: "Select Note Template",
                description: "Select a template to create a note from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: scheduledMaintenanceNoteTemplates,
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
        <> </>
      )}

      {showGenerateFromAIModal && (
        <GenerateFromAIModal
          title="Generate Public Note with AI"
          description="AI will analyze the scheduled maintenance data and generate a customer-facing public note."
          templates={PUBLIC_NOTE_TEMPLATES}
          onClose={() => {
            setShowGenerateFromAIModal(false);
          }}
          onGenerate={generateNoteFromAI}
          onSuccess={handleAIGenerationSuccess}
        />
      )}
    </Fragment>
  );
};

export default PublicNote;
