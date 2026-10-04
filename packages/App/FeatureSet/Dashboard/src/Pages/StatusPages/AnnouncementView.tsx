import StatusPagesElement from "../../Components/StatusPage/StatusPagesElement";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import SubscriberNotificationStatus from "../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import AttachmentList from "../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../Utils/ModelId";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { AnnouncementFormKind } from "../../Components/Announcement/AnnouncementForm";
import {
  ANNOUNCEMENT_FORM_STEPS,
  getAnnouncementFormFields,
} from "../../Components/Announcement/AnnouncementFormFields";

/*
 * The details card's Edit walks the steps of Create Announcement -
 * Announcement, then Status Pages - with the same fields
 * (Components/Announcement/AnnouncementFormFields). The notify switch is not
 * on it: subscribers are told once, when the announcement starts showing,
 * so the column takes no updates. "Notify subscribers about this update"
 * sits under the description instead, and the folded section holds only
 * the Schedule.
 */
const AnnouncementView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const formFields: Array<ModelField<StatusPageAnnouncement>> = useMemo(() => {
    return getAnnouncementFormFields(AnnouncementFormKind.Edit);
  }, []);

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
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        // The steps and fields of Create Announcement, as an Edit.
        formSteps={ANNOUNCEMENT_FORM_STEPS}
        isEditable={true}
        formFields={formFields}
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
