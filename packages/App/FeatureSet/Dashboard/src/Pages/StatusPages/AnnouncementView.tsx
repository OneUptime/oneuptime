import StatusPagesElement from "../../Components/StatusPage/StatusPagesElement";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import SubscriberNotificationStatus from "../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import AttachmentList from "../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../Utils/ModelId";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { getNotifySubscribersOfUpdateFormField } from "../../Components/StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  AnnouncementFormKind,
  getAnnouncementEndsAtError,
  getScheduleAndNotificationsSection,
} from "../../Components/Announcement/AnnouncementForm";

/*
 * The details card's Edit walks the steps of Create Announcement -
 * Announcement, then Status Pages (Components/Announcement/AnnouncementForm).
 * The notify switch is not on it: subscribers are told once, when the
 * announcement starts showing, so the column takes no updates. Its place in
 * Schedule & Notifications is taken by "Notify subscribers about this
 * update", which the folded line reads out.
 */
const detailsAdvancedSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAdvancedFormSection<StatusPageAnnouncement>();

const detailsScheduleSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getScheduleAndNotificationsSection<StatusPageAnnouncement>(
    AnnouncementFormKind.Edit,
  );

const AnnouncementView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const handleResendNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: StatusPageAnnouncement,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage:
              "Notification queued for resending",
          },
        });

        // Refetch the details card so the status reads Pending.
        setRefreshToggle((prev: boolean) => {
          return !prev;
        });
      } catch {
        // Error resending notification: handle appropriately
      }
    };

  const handleResendUpdateNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        await ModelAPI.updateById({
          id: modelId,
          modelType: StatusPageAnnouncement,
          data: {
            subscriberNotificationStatusOnAnnouncementUpdated:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessageOnAnnouncementUpdated:
              SubscriberUpdateNotification.resendQueuedMessage,
          },
        });

        setRefreshToggle((prev: boolean) => {
          return !prev;
        });
      } catch {
        // Error resending notification: handle appropriately
      }
    };

  return (
    <Fragment>
      {/* Status Page Announcement View  */}
      <CardModelDetail<StatusPageAnnouncement>
        name="Status Page Announcement Details"
        cardProps={{
          title: "Status Page Announcement Details",
          description: "Here are more details for this announcement.",
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        formSteps={[
          {
            title: "Announcement",
            id: "announcement",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              title: true,
            },
            stepId: "announcement",
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Announcement Title",
            validation: {
              minLength: 2,
            },
          },
          // Required, as the server requires it.
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "announcement",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Add an announcement note",
            ),
          },
          {
            field: {
              attachments: true,
            },
            title: "Attachments",
            stepId: "announcement",
            fieldType: FormFieldSchemaType.MultipleFiles,
            required: false,
            description:
              "Attach files that should be available with this announcement on the status page.",
            collapsibleSection: detailsAdvancedSection,
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show announcement on these status pages",
            stepId: "status-pages",
            description: "Select status pages to show this announcement on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Status Pages",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors Affected",
            stepId: "status-pages",
            description:
              "Select monitors affected by this announcement. If none selected, all subscribers will be notified.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors",
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            stepId: "status-pages",
            title: "Start Showing Announcement At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
            collapsibleSection: detailsScheduleSection,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            stepId: "status-pages",
            title: "End Showing Announcement At",
            description:
              "Leave empty to keep the announcement up until you set an end.",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            placeholder: "Pick Date and Time",
            collapsibleSection: detailsScheduleSection,
            customValidation: (
              values: FormValues<StatusPageAnnouncement>,
            ): string | null => {
              return getAnnouncementEndsAtError(values);
            },
          },
          getNotifySubscribersOfUpdateFormField<StatusPageAnnouncement>({
            stepId: "status-pages",
            description:
              "Send subscribers the edited announcement, marked as an update. Leave this unticked for small fixes such as typos.",
            collapsibleSection: detailsScheduleSection,
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageAnnouncement,
          id: "model-detail-status-page-announcement",
          selectMoreFields: {
            subscriberNotificationStatusMessage: true,
            subscriberNotificationStatusMessageOnAnnouncementUpdated: true,
          },
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Announcement ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                title: true,
              },
              title: "Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                },
              },
              title: "Shown on Status Pages",
              fieldType: FieldType.Element,
              getElement: (item: StatusPageAnnouncement): ReactElement => {
                return (
                  <StatusPagesElement statusPages={item.statusPages || []} />
                );
              },
            },
            {
              field: {
                showAnnouncementAt: true,
              },
              title: "Show Announcement At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                endAnnouncementAt: true,
              },
              title: "End Announcement At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                subscriberNotificationStatus: true,
              },
              title: "Subscriber Notification Status",
              fieldType: FieldType.Element,
              getElement: (item: StatusPageAnnouncement): ReactElement => {
                return (
                  <SubscriberNotificationStatus
                    status={item.subscriberNotificationStatus}
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessage
                    }
                    onResendNotification={handleResendNotification}
                  />
                );
              },
            },
            {
              field: {
                subscriberNotificationStatusOnAnnouncementUpdated: true,
              },
              title: "Update Notification Status",
              fieldType: FieldType.Element,
              getElement: (item: StatusPageAnnouncement): ReactElement => {
                if (!item.subscriberNotificationStatusOnAnnouncementUpdated) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateText(
                        "No update notification requested.",
                      )}
                    </span>
                  );
                }

                return (
                  <SubscriberNotificationStatus
                    status={
                      item.subscriberNotificationStatusOnAnnouncementUpdated
                    }
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessageOnAnnouncementUpdated
                    }
                    onResendNotification={handleResendUpdateNotification}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                updatedAt: true,
              },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />
      <div className="mt-4"></div>
      <CardModelDetail<StatusPageAnnouncement>
        name="Status Page Announcement Content"
        cardProps={{
          title: "Announcement Content",
          description:
            "Rich-text description and any attachments shared with subscribers.",
        }}
        isEditable={false}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPageAnnouncement,
          id: "model-detail-status-page-announcement-content",
          selectMoreFields: {
            attachments: {
              _id: true,
              name: true,
            },
          },
          fields: [
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Markdown,
            },
            {
              field: {
                attachments: {
                  _id: true,
                  name: true,
                },
              },
              title: "Attachments",
              fieldType: FieldType.Element,
              getElement: (item: StatusPageAnnouncement): ReactElement => {
                const modelIdString: string | null = getModelIdString(item);

                if (!modelIdString || !item.attachments?.length) {
                  return <></>;
                }

                return (
                  <AttachmentList
                    modelId={modelIdString}
                    attachments={item.attachments}
                    attachmentApiPath="/status-page-announcement/attachment"
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
      <div className="mt-4"></div>
    </Fragment>
  );
};

export default AnnouncementView;
