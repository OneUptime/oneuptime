import DashboardNavigation from "../../Utils/Navigation";
import ProjectUser from "../../Utils/ProjectUser";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";

const ScheduledMaintenanceTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceTemplate>
        modelType={ScheduledMaintenanceTemplate}
        id="Scheduled-Maintenance-templates-table"
        name="Settings > Scheduled Maintenance Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Scheduled Maintenance Templates",
          description:
            "Here is a list of all the Scheduled Maintenance templates in this project.",
        }}
        noItemsMessage={"No Scheduled Maintenance templates found."}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Event Details",
            id: "event-info",
          },
          {
            title: "Event Time",
            id: "event-time",
          },
          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "Owners",
            id: "owners",
          },
          {
            title: "More",
            id: "more",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: "template-info",
            required: true,
            placeholder: "Template Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            fieldType: FormFieldSchemaType.LongText,
            stepId: "template-info",
            required: true,
            placeholder: "Template Description",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            stepId: "event-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Event Title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "event-info",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
          },
          {
            field: {
              startsAt: true,
            },
            title: "Event Starts At",
            stepId: "event-time",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            stepId: "event-time",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors affected ",
            stepId: "resources-affected",
            description:
              "Select monitors affected by this scheduled maintenance.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Monitors affected",
          },
          {
            field: {
              changeMonitorStatusTo: true,
            },
            title: "Change Monitor Status to ",
            stepId: "resources-affected",
            description:
              "This will change the status of all the monitors attached when the event starts.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Monitor Status",
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show event on these status pages ",
            stepId: "status-pages",
            description: "Select status pages to show this event on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Status Pages",
          },
          {
            overrideField: {
              ownerTeams: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Teams",
            stepId: "owners",
            description:
              "Select which teams own this event. They will be notified when event status changes.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Teams",
            overrideFieldKey: "ownerTeams",
          },
          {
            overrideField: {
              ownerUsers: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Users",
            stepId: "owners",
            description:
              "Select which users own this event. They will be notified when event status changes.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                DashboardNavigation.getProjectId()!,
              );
            },
            required: false,
            placeholder: "Select Users",
            overrideFieldKey: "ownerUsers",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "more",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
            },

            title: "Event Created: Notify Status Page Subscribers",
            stepId: "more",
            description:
              "Should status page subscribers be notified when this event is created?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                true,
            },

            title: "Event Ongoing: Notify Status Page Subscribers",
            stepId: "more",
            description:
              "Should status page subscribers be notified when this event state changes to ongoing?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                true,
            },

            title: "Event Ended: Notify Status Page Subscribers",
            stepId: "more",
            description:
              "Should status page subscribers be notified when this event state changes to ended?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceTemplates;
