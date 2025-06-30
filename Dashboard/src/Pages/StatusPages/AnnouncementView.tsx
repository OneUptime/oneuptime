import StatusPagesElement from "../../Components/StatusPage/StatusPagesElement";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
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
                  shouldStatusPageSubscribersBeNotified: true,
                },
                title: "Notify Status Page Subscribers",
                fieldType: FieldType.Boolean,
                getElement: (item: StatusPageAnnouncement): ReactElement => {
                  return (
                    <CheckboxViewer
                      isChecked={
                        item.shouldStatusPageSubscribersBeNotified as boolean
                      }
                      text={
                        item.shouldStatusPageSubscribersBeNotified
                          ? "Notify Subscribers"
                          : "Do Not Notify Subscribers"
                      }
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
