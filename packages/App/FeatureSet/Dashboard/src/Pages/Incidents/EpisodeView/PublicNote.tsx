import MarkdownUtil from "Common/UI/Utils/Markdown";
import UserElement from "../../../Components/User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlignItem from "Common/UI/Types/AlignItem";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import User from "Common/Models/DatabaseModels/User";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import { getNotifySubscribersOfUpdateFormField } from "../../../Components/StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";

const EpisodePublicNote: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * Where "Notify Status Page Subscribers" starts on a new note: off when
   * the episode was created without notifying subscribers. Null until the
   * episode loads - the create form reads its starting values once, so it
   * must not open before this is known.
   */
  const [notifySubscribersByDefault, setNotifySubscribersByDefault] = useState<
    boolean | null
  >(null);
  const [episodeError, setEpisodeError] = useState<string>("");

  useEffect(() => {
    let isStale: boolean = false;

    setNotifySubscribersByDefault(null);
    setEpisodeError("");

    ModelAPI.getItem<IncidentEpisode>({
      modelType: IncidentEpisode,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      },
    })
      .then((episode: IncidentEpisode | null) => {
        if (!isStale) {
          setNotifySubscribersByDefault(
            PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
              episode,
            ),
          );
        }
      })
      .catch((err: unknown) => {
        if (!isStale) {
          setEpisodeError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isStale = true;
    };
  }, [modelId.toString()]);

  const handleResendNotification: (
    item: IncidentEpisodePublicNote,
  ) => Promise<void> = async (
    item: IncidentEpisodePublicNote,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: IncidentEpisodePublicNote,
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
    item: IncidentEpisodePublicNote,
  ) => Promise<void> = async (
    item: IncidentEpisodePublicNote,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: IncidentEpisodePublicNote,
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

  if (episodeError) {
    return <ErrorMessage message={episodeError} />;
  }

  if (notifySubscribersByDefault === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <ModelTable<IncidentEpisodePublicNote>
        modelType={IncidentEpisodePublicNote}
        id="table-episode-public-note"
        name="Episode > Public Note"
        userPreferencesKey="episode-public-note-table"
        saveFilterProps={{
          tableId: "incident-episode-public-note-table",
        }}
        isDeleteable={true}
        /*
         * The notify flag is seeded as a value, not only as the field's
         * default: the form drops a false default, and an unsent flag would
         * fall back to notifying.
         */
        createInitialValues={{
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
            notifySubscribersByDefault,
        }}
        isCreateable={true}
        showViewIdButton={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isViewable={false}
        refreshToggle={refreshToggle.toString()}
        query={{
          incidentEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: IncidentEpisodePublicNote,
        ): Promise<IncidentEpisodePublicNote> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.incidentEpisodeId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Public Notes",
          description:
            "Here are public notes for this episode. This will show up on the status page.",
        }}
        noItemsMessage={"No public notes created for this episode so far."}
        formFields={[
          {
            field: {
              note: true,
            },
            title: "Public Episode Note",
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
              : PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: notifySubscribersByDefault,
            required: false,
          },
          getNotifySubscribersOfUpdateFormField<IncidentEpisodePublicNote>({
            description:
              "Send subscribers the edited note, marked as an update. Leave this unticked for small fixes such as typos.",
          }),
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
        showAs={ShowAs.List}
        showRefreshButton={true}
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

            getElement: (item: IncidentEpisodePublicNote): ReactElement => {
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
            getElement: (item: IncidentEpisodePublicNote): ReactElement => {
              return (
                <div className="space-y-3">
                  <MarkdownViewer text={item.note || ""} />
                  <AttachmentList
                    modelId={getModelIdString(item)}
                    attachments={item.attachments}
                    attachmentApiPath="/incident-episode-public-note/attachment"
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
            type: FieldType.Element,
            colSpan: 1,
            getElement: (item: IncidentEpisodePublicNote): ReactElement => {
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
            getElement: (item: IncidentEpisodePublicNote): ReactElement => {
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

      {error ? (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600">{error}</p>
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default EpisodePublicNote;
