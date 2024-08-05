import LabelsElement from "../../Components/Label/Labels";
import MonitorsElement from "../../Components/Monitor/Monitors";
import OnCallDutyPoliciesView from "../../Components/OnCallPolicy/OnCallPolicies";
import TeamElement from "../../Components/Team/Team";
import UserElement from "../../Components/User/User";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import IncidentSeverity from "Common/AppModels/Models/IncidentSeverity";
import IncidentTemplate from "Common/AppModels/Models/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/AppModels/Models/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/AppModels/Models/IncidentTemplateOwnerUser";
import Label from "Common/AppModels/Models/Label";
import Monitor from "Common/AppModels/Models/Monitor";
import MonitorStatus from "Common/AppModels/Models/MonitorStatus";
import OnCallDutyPolicy from "Common/AppModels/Models/OnCallDutyPolicy";
import Team from "Common/AppModels/Models/Team";
import User from "Common/AppModels/Models/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Incident View  */}
      <CardModelDetail<IncidentTemplate>
        name="Incident Template Details"
        cardProps={{
          title: "Incident Template Details",
          description: "Here are more details for this incident template.",
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Incident Details",
            id: "incident-details",
          },
          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "On-Call",
            id: "on-call",
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
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            stepId: "incident-details",
            required: true,
            placeholder: "Incident Title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "incident-details",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
          },
          {
            field: {
              incidentSeverity: true,
            },
            title: "Incident Severity",
            stepId: "incident-details",
            description: "What type of incident is this?",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Incident Severity",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors affected",
            stepId: "resources-affected",
            description: "Select monitors affected by this incident.",
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
              onCallDutyPolicies: true,
            },
            title: "On-Call Policy",
            stepId: "on-call",
            description:
              "Select on-call duty policy to execute when this incident is created.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select on-call policies",
          },
          {
            field: {
              changeMonitorStatusTo: true,
            },
            title: "Change Monitor Status to ",
            stepId: "resources-affected",
            description:
              "This will change the status of all the monitors attached to this incident.",
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
          modelType: IncidentTemplate,
          id: "model-detail-incidents",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Incident Template ID",
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
              title: "Incident Title",
              fieldType: FieldType.Text,
            },

            {
              field: {
                incidentSeverity: {
                  color: true,
                  name: true,
                },
              },
              title: "Incident Severity",
              fieldType: FieldType.Entity,
              getElement: (item: IncidentTemplate): ReactElement => {
                if (!item["incidentSeverity"]) {
                  return <p>No incident severity.</p>;
                }

                return (
                  <Pill
                    color={item.incidentSeverity.color || Black}
                    text={item.incidentSeverity.name || "Unknown"}
                  />
                );
              },
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
              getElement: (item: IncidentTemplate): ReactElement => {
                return <MonitorsElement monitors={item["monitors"] || []} />;
              },
            },
            {
              field: {
                onCallDutyPolicies: {
                  name: true,
                  _id: true,
                },
              },
              title: "On-Call Duty Policies",
              fieldType: FieldType.Element,
              getElement: (item: IncidentTemplate): ReactElement => {
                return (
                  <OnCallDutyPoliciesView
                    onCallPolicies={item["onCallDutyPolicies"] || []}
                  />
                );
              },
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
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: IncidentTemplate): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<IncidentTemplateOwnerTeam>
        modelType={IncidentTemplateOwnerTeam}
        id="table-incident-owner-team"
        name="Incident Template > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incidentTemplateId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: IncidentTemplateOwnerTeam,
        ): Promise<IncidentTemplateOwnerTeam> => {
          item.incidentTemplateId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "These are the list of teams that will be added to the incident by default when its created.",
        }}
        noItemsMessage={
          "No teams associated with this incident template so far."
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

            getElement: (item: IncidentTemplateOwnerTeam): ReactElement => {
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

      <ModelTable<IncidentTemplateOwnerUser>
        modelType={IncidentTemplateOwnerUser}
        id="table-incident-owner-team"
        name="Incident > Owner Team"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          incidentTemplateId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: IncidentTemplateOwnerUser,
        ): Promise<IncidentTemplateOwnerUser> => {
          item.incidentTemplateId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "These are the list of users that will be added to the incident by default when its created.",
        }}
        noItemsMessage={
          "No users associated with this incident template so far."
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
            getElement: (item: IncidentTemplateOwnerUser): ReactElement => {
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
        modelType={IncidentTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
