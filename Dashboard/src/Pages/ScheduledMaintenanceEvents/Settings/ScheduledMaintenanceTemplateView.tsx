import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorsElement from "../../../Components/Monitor/Monitors";
import TeamElement from "../../../Components/Team/Team";
import UserElement from "../../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../../Utils/PageMap";
import ProjectUser from "../../../Utils/ProjectUser";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
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
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import {
  getFormSteps,
  getTemplateFormFields,
} from "./ScheduledMaintenanceTemplates";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

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
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formSteps={getFormSteps({
          isViewPage: true,
        })}
        formFields={getTemplateFormFields({
          isViewPage: true,
        })}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: ScheduledMaintenanceTemplate,
          id: "model-detail-ScheduledMaintenances",
          selectMoreFields: {
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
              true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
          },
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
                title: true,
              },
              title: "Scheduled Maintenance Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Scheduled Maintenance Description",
              fieldType: FieldType.Markdown,
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
                isRecurringEvent: true,
              },
              title: "Is Recurring Event",
              fieldType: FieldType.Boolean,
            },

            {
              field: {
                firstEventScheduledAt: true,
              },
              showIf: (item: ScheduledMaintenanceTemplate): boolean => {
                return Boolean(item.isRecurringEvent);
              },
              title: "First Event Scheduled At",
              fieldType: FieldType.DateTime,
            },

            {
              field: {
                firstEventStartsAt: true,
              },
              title: "First Event Starts At",
              fieldType: FieldType.DateTime,
              showIf: (item: ScheduledMaintenanceTemplate): boolean => {
                return Boolean(item.isRecurringEvent);
              },
            },
            {
              field: {
                firstEventEndsAt: true,
              },
              title: "First Event Ends At",
              fieldType: FieldType.DateTime,
              showIf: (item: ScheduledMaintenanceTemplate): boolean => {
                return Boolean(item.isRecurringEvent);
              },
            },
            {
              field: {
                scheduleNextEventAt: true,
              },
              title: "Next event will be automatically scheduled at",
              fieldType: FieldType.DateTime,
              showIf: (item: ScheduledMaintenanceTemplate): boolean => {
                return Boolean(item.isRecurringEvent);
              },
            },
            {
              field: {
                sendSubscriberNotificationsOnBeforeTheEvent: true,
              },
              title: "Send reminders to subscribers before the event",
              fieldType: FieldType.Boolean,
              getElement: (
                item: ScheduledMaintenanceTemplate,
              ): ReactElement => {
                return (
                  <RecurringArrayViewElement
                    value={item.sendSubscriberNotificationsOnBeforeTheEvent}
                    postfix=" before the event is begins"
                  />
                );
              },
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
        userPreferencesKey="scheduled-maintenance-owner-team-table"
        name="ScheduledMaintenance Template > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          scheduledMaintenanceTemplateId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceTemplateOwnerTeam,
        ): Promise<ScheduledMaintenanceTemplateOwnerTeam> => {
          item.scheduledMaintenanceTemplateId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "These are the list of teams that will be added to the Scheduled Maintenance by default when its created.",
        }}
        noItemsMessage={
          "No teams associated with this Scheduled Maintenance template so far."
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
        userPreferencesKey="scheduled-maintenance-owner-user-table"
        name="ScheduledMaintenance > Owner Team"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          scheduledMaintenanceTemplateId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ScheduledMaintenanceTemplateOwnerUser,
        ): Promise<ScheduledMaintenanceTemplateOwnerUser> => {
          item.scheduledMaintenanceTemplateId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "These are the list of users that will be added to the Scheduled Maintenance by default when its created.",
        }}
        noItemsMessage={
          "No users associated with this Scheduled Maintenance template so far."
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
                ProjectUtil.getCurrentProjectId()!,
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
            RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
