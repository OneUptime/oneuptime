import LabelsElement from "Common/UI/Components/Label/Labels";
import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import TeamElement from "../../../Components/Team/Team";
import UserElement from "../../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../../Utils/PageMap";
import ProjectUser from "../../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

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
        createEditModalWidth={ModalWidth.Large}
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
            required: false,
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
              initialIncidentState: true,
            },
            title: "Initial Incident State",
            stepId: "incident-details",
            description:
              "Select the initial state for incidents created from this template (defaults to 'Created' state if not selected)",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Initial State",
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
                initialIncidentState: {
                  color: true,
                  name: true,
                },
              },
              title: "Initial Incident State",
              fieldType: FieldType.Entity,
              getElement: (item: IncidentTemplate): ReactElement => {
                if (!item["initialIncidentState"]) {
                  return <p>Uses default &apos;Created&apos; state</p>;
                }

                return (
                  <Pill
                    color={item.initialIncidentState.color || Black}
                    text={item.initialIncidentState.name || "Unknown"}
                  />
                );
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

      <CardModelDetail<IncidentTemplate>
        name="Affected Resources"
        cardProps={{
          title: "Affected Resources",
          description:
            "Monitors, hosts, Kubernetes clusters, Docker hosts, and services that incidents created from this template should pre-populate.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              monitors: true,
            },
            title: "",
            description:
              "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services that incidents created from this template should pre-populate.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              values: FormValues<IncidentTemplate>,
              elementProps: CustomElementProps,
            ) => {
              return (
                <AffectedResourcesPicker
                  monitors={values.monitors as Array<Monitor>}
                  hosts={values.hosts as Array<Host>}
                  kubernetesClusters={
                    values.kubernetesClusters as Array<KubernetesCluster>
                  }
                  dockerHosts={values.dockerHosts as Array<DockerHost>}
                  podmanHosts={values.podmanHosts as Array<PodmanHost>}
                  services={values.services as Array<Service>}
                  onChange={(payload: unknown) => {
                    elementProps.onChange?.(payload);
                  }}
                />
              );
            },
            onChange: (
              value: unknown,
              currentValues: FormValues<IncidentTemplate>,
              setNewFormValues: (values: FormValues<IncidentTemplate>) => void,
            ) => {
              if (isAffectedResourcesPayload(value)) {
                const payload: typeof value = value;
                queueMicrotask(() => {
                  setNewFormValues({
                    ...currentValues,
                    monitors: payload.monitors,
                    hosts: payload.hosts,
                    kubernetesClusters: payload.kubernetesClusters,
                    dockerHosts: payload.dockerHosts,
                    podmanHosts: payload.podmanHosts,
                    services: payload.services,
                  } as FormValues<IncidentTemplate>);
                });
              }
            },
          },
          /*
           * Hidden registrations so ModelForm.getSelectFields includes
           * hosts/kubernetesClusters/dockerHosts/services on load and submit.
           */
          {
            field: { hosts: true },
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          {
            field: { kubernetesClusters: true },
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          {
            field: { dockerHosts: true },
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          {
            field: { podmanHosts: true },
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          {
            field: { services: true },
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          {
            field: {
              changeMonitorStatusTo: true,
            },
            title: "Change Monitor Status to ",
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
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentTemplate,
          id: "model-detail-incident-template-affected-resources",
          fields: [
            {
              field: {
                monitors: {
                  name: true,
                  _id: true,
                },
                hosts: {
                  name: true,
                  _id: true,
                },
                kubernetesClusters: {
                  name: true,
                  _id: true,
                },
                dockerHosts: {
                  name: true,
                  _id: true,
                },
                podmanHosts: {
                  name: true,
                  _id: true,
                },
                services: {
                  name: true,
                  _id: true,
                  serviceColor: true,
                },
              },
              title: "",
              fieldType: FieldType.Element,
              getElement: (item: IncidentTemplate): ReactElement => {
                return (
                  <AffectedResourcesDisplay
                    monitors={item.monitors || []}
                    hosts={item.hosts || []}
                    kubernetesClusters={item.kubernetesClusters || []}
                    dockerHosts={item.dockerHosts || []}
                    podmanHosts={item.podmanHosts || []}
                    services={item.services || []}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<IncidentTemplateOwnerTeam>
        modelType={IncidentTemplateOwnerTeam}
        id="table-incident-owner-team"
        userPreferencesKey="incident-owner-team-table"
        name="Incident Template > Owner Team"
        saveFilterProps={{
          tableId: "incident-template-owner-team-table",
        }}
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incidentTemplateId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: IncidentTemplateOwnerTeam,
        ): Promise<IncidentTemplateOwnerTeam> => {
          item.incidentTemplateId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
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
        userPreferencesKey="incident-owner-user-table"
        saveFilterProps={{
          tableId: "incident-template-owner-user-table",
        }}
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          incidentTemplateId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: IncidentTemplateOwnerUser,
        ): Promise<IncidentTemplateOwnerUser> => {
          item.incidentTemplateId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
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
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
