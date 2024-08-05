import DashboardNavigation from "../../Utils/Navigation";
import ProjectUser from "../../Utils/ProjectUser";
import LabelsElement from "../Label/Labels";
import MonitorsElement from "../Monitor/Monitors";
import StatusPagesElement from "../StatusPage/StatusPagesLabel";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  query?: Query<ScheduledMaintenance> | undefined;
  viewPageRoute?: Route;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
}

const ScheduledMaintenancesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<ScheduledMaintenance>
      modelType={ScheduledMaintenance}
      id="scheduledMaintenances-table"
      name="Scheduled Maintenance Events"
      isDeleteable={false}
      query={props.query || {}}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      cardProps={{
        title: props.title || "Scheduled Maintenance Events",
        description:
          props.description ||
          "Here is a list of scheduled maintenance events for this project.",
      }}
      noItemsMessage={
        props.noItemsMessage || "No scheduled Maintenance Event found."
      }
      formSteps={[
        {
          title: "Event Info",
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
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
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
      showViewIdButton={true}
      viewButtonText="View Event"
      showRefreshButton={true}
      viewPageRoute={props.viewPageRoute}
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
            currentScheduledMaintenanceState: {
              name: true,
            },
          },
          title: "Current State",
          type: FieldType.Entity,
          filterEntityType: ScheduledMaintenanceState,
          filterQuery: {
            projectId: DashboardNavigation.getProjectId()?.toString(),
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
        {
          field: {
            monitors: {
              name: true,
              _id: true,
              projectId: true,
            },
          },
          title: "Monitors Affected",
          type: FieldType.EntityArray,
          filterEntityType: Monitor,
          filterQuery: {
            projectId: DashboardNavigation.getProjectId()?.toString(),
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
        {
          field: {
            statusPages: {
              name: true,
              _id: true,
              projectId: true,
            },
          },
          title: "Shown on Status Page",
          type: FieldType.EntityArray,
          filterEntityType: StatusPage,
          filterQuery: {
            projectId: DashboardNavigation.getProjectId()?.toString(),
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
        {
          field: {
            createdAt: true,
          },
          title: "Created At",
          type: FieldType.Date,
        },
        {
          field: {
            startsAt: true,
          },
          title: "Starts At",
          type: FieldType.Date,
        },
        {
          field: {
            endsAt: true,
          },
          title: "Ends At",
          type: FieldType.Date,
        },
        {
          field: {
            labels: {
              name: true,
              color: true,
            },
          },
          title: "Labels",
          type: FieldType.EntityArray,
          filterEntityType: Label,
          filterQuery: {
            projectId: DashboardNavigation.getProjectId()?.toString(),
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
            currentScheduledMaintenanceState: {
              name: true,
              color: true,
            },
          },
          title: "Current State",
          type: FieldType.Entity,

          getElement: (item: ScheduledMaintenance): ReactElement => {
            if (item["currentScheduledMaintenanceState"]) {
              return (
                <Pill
                  color={item.currentScheduledMaintenanceState.color || Black}
                  text={item.currentScheduledMaintenanceState.name || "Unknown"}
                />
              );
            }

            return <></>;
          },
        },

        {
          field: {
            monitors: {
              name: true,
              _id: true,
              projectId: true,
            },
          },
          title: "Monitors Affected",
          type: FieldType.EntityArray,

          getElement: (item: ScheduledMaintenance): ReactElement => {
            return <MonitorsElement monitors={item["monitors"] || []} />;
          },
        },
        {
          field: {
            statusPages: {
              name: true,
              _id: true,
              projectId: true,
            },
          },
          title: "Shown on Status Page",
          type: FieldType.EntityArray,

          getElement: (item: ScheduledMaintenance): ReactElement => {
            return (
              <StatusPagesElement statusPages={item["statusPages"] || []} />
            );
          },
        },
        {
          field: {
            startsAt: true,
          },
          title: "Starts At",
          type: FieldType.DateTime,
        },
        {
          field: {
            endsAt: true,
          },
          title: "Ends At",
          type: FieldType.DateTime,
        },
        {
          field: {
            labels: {
              name: true,
              color: true,
            },
          },
          title: "Labels",
          type: FieldType.EntityArray,

          getElement: (item: ScheduledMaintenance): ReactElement => {
            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default ScheduledMaintenancesTable;
