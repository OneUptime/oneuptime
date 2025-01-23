import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../Utils/ProjectUser";
import DashboardNavigation from "../../Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";

const IncidentCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Card
        title="Declare New Incident"
        description={
          "Declare a new incident to let your team know what's going on and how to respond."
        }
        className="mb-10"
      >
        <ModelForm<Incident>
          modelType={Incident}
          name="Create New Incident"
          id="create-incident-form"
          fields={[
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
              required: true,
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
              overrideField: {
                ownerTeams: true,
              },
              showEvenIfPermissionDoesNotExist: true,
              title: "Owner - Teams",
              stepId: "owners",
              description:
                "Select which teams own this incident. They will be notified when the incident is created or updated.",
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
                "Select which users own this incident. They will be notified when the incident is created or updated.",
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
                shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
              },
  
              title: "Notify Status Page Subscribers",
              stepId: "more",
              description:
                "Should status page subscribers be notified when this incident is created?",
              fieldType: FormFieldSchemaType.Checkbox,
              defaultValue: true,
              required: false,
            },
          ]}
          steps={[
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
              title: "Owners",
              id: "owners",
            },
            {
              title: "More",
              id: "more",
            },
          ]}
          onSuccess={(createdItem: Incident) => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.INCIDENT_VIEW] as Route,
                  {
                    modelId: createdItem._id,
                  },
                ),
              ),
            );
          }}
          submitButtonText={"Declare Incident"}
          formType={FormType.Create}
        />
      </Card>
    </Fragment>
  );
};

export default IncidentCreate;
