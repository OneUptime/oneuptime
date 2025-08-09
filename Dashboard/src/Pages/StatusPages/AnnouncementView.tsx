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
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import EmailStatus from "Common/Types/Mail/MailStatus";
import SmsStatus from "Common/Types/SmsStatus";
import CallStatus from "Common/Types/Call/CallStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";

const AnnouncementView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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

        // Trigger a refresh by toggling the refresh state
        setRefreshToggle(!refreshToggle);
      } catch {
        // Error resending notification: handle appropriately
      }
    };

  return (
    <Page
      title={"Announcement"}
      breadcrumbLinks={[
        {
          title: "Status Pages",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGES] as Route,
          ),
        },
        {
          title: "Announcements",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
          ),
        },
        {
          title: "View Announcement",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ANNOUNCEMENT_VIEW] as Route,
            { modelId },
          ),
        },
      ]}
    >
      <Fragment>
        {/* Status Page Announcement View  */}
        <CardModelDetail<StatusPageAnnouncement>
          name="Status Page Announcement Details"
          cardProps={{
            title: "Status Page Announcement Details",
            description: "Here are more details for this announcement.",
          }}
          formSteps={[
            {
              title: "Basic Information",
              id: "basic",
            },
            {
              title: "Status Pages",
              id: "status-pages",
            },
            {
              title: "Schedule & Settings",
              id: "more",
            },
          ]}
          isEditable={true}
          formFields={[
            {
              field: {
                title: true,
              },
              stepId: "basic",
              title: "Announcement Title",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Announcement Title",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              stepId: "basic",
              fieldType: FormFieldSchemaType.Markdown,
              required: false,
              description: MarkdownUtil.getMarkdownCheatsheet(
                "Add an announcement note",
              ),
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
                showAnnouncementAt: true,
              },
              stepId: "more",
              title: "Start Showing Announcement At",
              fieldType: FormFieldSchemaType.DateTime,
              required: true,
              placeholder: "Pick Date and Time",
            },
            {
              field: {
                endAnnouncementAt: true,
              },
              stepId: "more",
              title: "End Showing Announcement At",
              fieldType: FormFieldSchemaType.DateTime,
              required: false,
              placeholder: "Pick Date and Time",
            },
            {
              field: {
                shouldStatusPageSubscribersBeNotified: true,
              },
              title: "Notify Status Page Subscribers",
              stepId: "more",
              description: "Should status page subscribers be notified?",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 2,
            modelType: StatusPageAnnouncement,
            id: "model-detail-status-page-announcement",
            selectMoreFields: {
              subscriberNotificationStatusMessage: true,
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
                  description: true,
                },
                title: "Description",
                fieldType: FieldType.Markdown,
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

        {/* Announcement Notification Logs */}
        <Fragment>
          {/* Email Logs */}
          <AnnouncementEmailLogs modelId={modelId} />
          <div className="mt-4"></div>
          {/* SMS Logs */}
          <AnnouncementSmsLogs modelId={modelId} />
          <div className="mt-4"></div>
          {/* Call Logs */}
          <AnnouncementCallLogs modelId={modelId} />
          <div className="mt-4"></div>
        </Fragment>

        <ModelDelete
          modelType={StatusPageAnnouncement}
          modelId={modelId}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
              ),
            );
          }}
        />
      </Fragment>
    </Page>
  );
};

export default AnnouncementView;

// Reusable tables for logs filtered by statusPageAnnouncementId

const AnnouncementEmailLogs: FunctionComponent<{ modelId: ObjectID }> = ({
  modelId,
}: {
  modelId: ObjectID;
}): ReactElement => {
  const columns: Columns<EmailLog> = [
    { field: { toEmail: true }, title: "To", type: FieldType.Email },
    {
      field: { fromEmail: true },
      title: "From",
      type: FieldType.Email,
      hideOnMobile: true,
    },
    {
      field: { subject: true },
      title: "Subject",
      type: FieldType.Text,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: EmailLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === EmailStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const filters: Array<Filter<EmailLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<EmailLog>
      modelType={EmailLog}
      id="announcement-email-logs-table"
      name="Email Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="announcement-email-logs-table"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        statusPageAnnouncementId: modelId,
      }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Email Logs",
        description: "Emails sent for this announcement.",
      }}
      noItemsMessage="No email logs for this announcement."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

const AnnouncementSmsLogs: FunctionComponent<{ modelId: ObjectID }> = ({
  modelId,
}: {
  modelId: ObjectID;
}): ReactElement => {
  const columns: Columns<SmsLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: SmsLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === SmsStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const filters: Array<Filter<SmsLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<SmsLog>
      modelType={SmsLog}
      id="announcement-sms-logs-table"
      name="SMS Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="announcement-sms-logs-table"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        statusPageAnnouncementId: modelId,
      }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "SMS Logs",
        description: "SMS sent for this announcement.",
      }}
      noItemsMessage="No SMS logs for this announcement."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

const AnnouncementCallLogs: FunctionComponent<{ modelId: ObjectID }> = ({
  modelId,
}: {
  modelId: ObjectID;
}): ReactElement => {
  const columns: Columns<CallLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    {
      field: { fromNumber: true },
      title: "From",
      type: FieldType.Phone,
      hideOnMobile: true,
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: CallLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              color={item["status"] === CallStatus.Success ? Green : Red}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const filters: Array<Filter<CallLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<CallLog>
      modelType={CallLog}
      id="announcement-call-logs-table"
      name="Call Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="announcement-call-logs-table"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        statusPageAnnouncementId: modelId,
      }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Call Logs",
        description: "Calls made for this announcement.",
      }}
      noItemsMessage="No call logs for this announcement."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};
