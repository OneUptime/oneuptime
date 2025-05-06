import ProjectUtil from "Common/UI/Utils/Project";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import FetchStatusPages from "../StatusPage/FetchStatusPages";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

export interface ComponentProps {
  query?: Query<StatusPageAnnouncement> | undefined;
  initialValues?: FormValues<StatusPageAnnouncement> | undefined;
  title?: string;
  description?: string;
}

const AnnouncementTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncement>
        modelType={StatusPageAnnouncement}
        localPreferencesKey="status-page-announcements-table"
        id="table-status-page-note"
        isDeleteable={true}
        isCreateable={true}
        showViewIdButton={true}
        isEditable={true}
        name="Status Page > Announcements"
        isViewable={false}
        createInitialValues={props.initialValues}
        query={{
          ...(props.query || {}),
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        cardProps={{
          title: props.title || "Status Page Announcements",
          description:
            props.description ||
            "Create and manage announcements that will be shown on status pages.",
        }}
        noItemsMessage={"No announcements found."}
        formSummary={{
          enabled: true,
        }}
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "More",
            id: "more",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            stepId: "basic",
            description: "Title of announcement",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Title",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: "Add an announcement note. This is in Markdown.",
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show announcement on these status pages ",
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
            getSummaryElement: (item: FormValues<StatusPageAnnouncement>) => {
              if (!item.statusPages || !Array.isArray(item.statusPages)) {
                return <p>No status pages selected for this announcement.</p>;
              }

              const statusPageIds: Array<ObjectID> = [];

              for (const statusPage of item.statusPages) {
                if (typeof statusPage === "string") {
                  statusPageIds.push(new ObjectID(statusPage));
                  continue;
                }

                if (statusPage instanceof ObjectID) {
                  statusPageIds.push(statusPage);
                  continue;
                }

                if (statusPage instanceof StatusPage) {
                  statusPageIds.push(
                    new ObjectID(statusPage._id?.toString() || ""),
                  );
                  continue;
                }
              }

              return (
                <div>
                  <FetchStatusPages statusPageIds={statusPageIds} />
                </div>
              );
            },
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
            defaultValue: true,
            required: false,
          },
        ]}
        createEditModalWidth={ModalWidth.Large}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
          {
            field: {
              statusPages: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Shown on Status Pages",
            type: FieldType.EntityArray,

            filterEntityType: StatusPage,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.DateTime,
            noValueMessage: "-",
          },
          {
            field: {
              statusPages: {
                name: true,
              },
            },
            title: "Shown on Status Pages",
            type: FieldType.Element,
            getElement: (item: StatusPageAnnouncement) => {
              if (!item.statusPages || !Array.isArray(item.statusPages)) {
                return <p>No status pages selected for this announcement.</p>;
              }
              return (
                <div>
                  <StatusPagesElement statusPages={item.statusPages} />
                </div>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default AnnouncementTable;
