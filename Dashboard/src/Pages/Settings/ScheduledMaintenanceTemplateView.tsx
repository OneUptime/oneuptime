import LabelsElement from "../../Components/Label/Labels";
import MonitorsElement from "../../Components/Monitor/Monitors";
import TeamElement from "../../Components/Team/Team";
import UserElement from "../../Components/User/User";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagesElement from "../../Components/StatusPage/StatusPagesLabel";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";

const TeamView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* ScheduledMaintenance View  */}
      <CardModelDetail<ScheduledMaintenanceTemplate>
        name="Scheduled Maintenance Template Details"
        cardProps={{
          title: "Scheduled Maintenance Template Details",
          description:
            "Here are more details for this ScheduledMaintenance template.",
        }}
        isEditable={true}
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
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "Labels",
            id: "labels",
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
            fieldType: FormFieldSchemaType.Text,
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
            stepId: "event-info",
            title: "Scheduled Maintenance Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Scheduled Maintenance Title",
            validation: {
              minLength: 2,
            },
          },

          {
            field: {
              startsAt: true,
            },
            stepId: "event-info",
            title: "Event Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            stepId: "event-info",
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
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
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
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: ScheduledMaintenanceTemplate,
          id: "model-detail-ScheduledMaintenances",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Scheduled Maintenance Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                _id: true,
              },
              title: "Scheduled Maintenance ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                title: true,
              },
              title: "Scheduled Maintenance Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitors: {
                  name: true,
                  _id: true,
                },
              },
              title: "Monitors Affected",
              fieldType: FieldType.Element,
              getElement: (
                item: ScheduledMaintenanceTemplate,
              ): ReactElement => {
                return <MonitorsElement monitors={item.monitors || []} />;
              },
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
              getElement: (
                item: ScheduledMaintenanceTemplate,
              ): ReactElement => {
                return (
                  <StatusPagesElement statusPages={item.statusPages || []} />
                );
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
              },
              title: "Notify Status Page Subscribers",
              fieldType: FieldType.Boolean,
              getElement: (
                item: ScheduledMaintenanceTemplate,
              ): ReactElement => {
                return (
                  <div>
                    <div className="">
                      <CheckboxViewer
                        isChecked={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
                          ] as boolean
                        }
                        text={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
                          ]
                            ? "Event Created: Notify Subscribers"
                            : "Event Created: Do Not Notify Subscribers"
                        }
                      />{" "}
                    </div>
                    <div className="">
                      <CheckboxViewer
                        isChecked={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing"
                          ] as boolean
                        }
                        text={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing"
                          ]
                            ? "Event Ongoing: Notify Subscribers"
                            : "Event Ongoing: Do Not Notify Subscribers"
                        }
                      />{" "}
                    </div>
                    <div className="">
                      <CheckboxViewer
                        isChecked={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded"
                          ] as boolean
                        }
                        text={
                          item[
                            "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded"
                          ]
                            ? "Event Ended: Notify Subscribers"
                            : "Event Ended: Do Not Notify Subscribers"
                        }
                      />{" "}
                    </div>
                  </div>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (
                item: ScheduledMaintenanceTemplate,
              ): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<ScheduledMaintenanceTemplateOwnerTeam>
        modelType={ScheduledMaintenanceTemplateOwnerTeam}
        id="table-ScheduledMaintenance-owner-team"
        name="ScheduledMaintenance Template > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          scheduledMaintenanceTemplateId: modelId,
          projectId: DashboardNavigation.getProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceTemplateOwnerTeam,
        ): Promise<ScheduledMaintenanceTemplateOwnerTeam> => {
          item.scheduledMaintenanceTemplateId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "These are the list of teams that will be added to the ScheduledMaintenance by default when its created.",
        }}
        noItemsMessage={
          "No teams associated with this ScheduledMaintenance template so far."
        }
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Team",
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Entity,

            getElement: (
              item: ScheduledMaintenanceTemplateOwnerTeam,
            ): ReactElement => {
              if (!item["team"]) {
                throw new BadDataException("Team not found");
              }

              return <TeamElement team={item["team"] as Team} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<ScheduledMaintenanceTemplateOwnerUser>
        modelType={ScheduledMaintenanceTemplateOwnerUser}
        id="table-ScheduledMaintenance-owner-team"
        name="ScheduledMaintenance > Owner Team"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          scheduledMaintenanceTemplateId: modelId,
          projectId: DashboardNavigation.getProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceTemplateOwnerUser,
        ): Promise<ScheduledMaintenanceTemplateOwnerUser> => {
          item.scheduledMaintenanceTemplateId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "These are the list of users that will be added to the ScheduledMaintenance by default when its created.",
        }}
        noItemsMessage={
          "No users associated with this ScheduledMaintenance template so far."
        }
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select User",
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                DashboardNavigation.getProjectId()!,
              );
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              user: {
                name: true,
                email: true,
              },
            },
            title: "User",
            type: FieldType.Entity,
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Entity,
            getElement: (
              item: ScheduledMaintenanceTemplateOwnerUser,
            ): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }

              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelDelete
        modelType={ScheduledMaintenanceTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.SETTINGS_SCHEDULED_MAINTENANCE_TEMPLATES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
