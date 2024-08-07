import LabelsElement from "../../Components/Label/Labels";
import MonitorsElement from "../../Components/Monitor/Monitors";
import EventName from "../../Utils/EventName";
import DashboardNavigation from "../../Utils/Navigation";
import ProjectUser from "../../Utils/ProjectUser";
import IncidentElement from "./Incident";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/src/Components/Button/Button";
import BasicFormModal from "Common/UI/src/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/src/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/src/Components/Modal/ConfirmModal";
import { ModalTableBulkDefaultActions } from "Common/UI/src/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/src/Components/ModelTable/ModelTable";
import Pill from "Common/UI/src/Components/Pill/Pill";
import FieldType from "Common/UI/src/Components/Types/FieldType";
import API from "Common/UI/src/Utils/API/API";
import Query from "Common/UI/src/Utils/BaseDatabase/Query";
import DropdownUtil from "Common/UI/src/Utils/Dropdown";
import GlobalEvents from "Common/UI/src/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement, useState } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  query?: Query<Incident> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  createInitialValues?: FormValues<Incident> | undefined;
  disableCreate?: boolean | undefined;
}

const IncidentsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [incidentTemplates, setIncidentTemplates] = useState<
    Array<IncidentTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showIncidentTemplateModal, setShowIncidentTemplateModal] =
    useState<boolean>(false);
  const [initialValuesForIncident, setInitialValuesForIncident] =
    useState<JSONObject>({});

  const fetchIncidentTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch incident template

      const incidentTemplate: IncidentTemplate | null =
        await ModelAPI.getItem<IncidentTemplate>({
          modelType: IncidentTemplate,
          id: id,
          select: {
            title: true,
            description: true,
            incidentSeverityId: true,
            monitors: true,
            onCallDutyPolicies: true,
            labels: true,
            changeMonitorStatusToId: true,
          },
        });

      const teamsListResult: ListResult<IncidentTemplateOwnerTeam> =
        await ModelAPI.getList<IncidentTemplateOwnerTeam>({
          modelType: IncidentTemplateOwnerTeam,
          query: {
            incidentTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            teamId: true,
          },
          sort: {},
        });

      const usersListResult: ListResult<IncidentTemplateOwnerUser> =
        await ModelAPI.getList<IncidentTemplateOwnerUser>({
          modelType: IncidentTemplateOwnerUser,
          query: {
            incidentTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            userId: true,
          },
          sort: {},
        });

      if (incidentTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(incidentTemplate, IncidentTemplate),
          incidentSeverity: incidentTemplate.incidentSeverityId?.toString(),
          monitors: incidentTemplate.monitors?.map((monitor: Monitor) => {
            return monitor.id!.toString();
          }),
          labels: incidentTemplate.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
          changeMonitorStatusTo:
            incidentTemplate.changeMonitorStatusToId?.toString(),
          onCallDutyPolicies: incidentTemplate.onCallDutyPolicies?.map(
            (onCallPolicy: OnCallDutyPolicy) => {
              return onCallPolicy.id!.toString();
            },
          ),
          ownerUsers: usersListResult.data.map(
            (user: IncidentTemplateOwnerUser): string => {
              return user.userId!.toString() || "";
            },
          ),
          ownerTeams: teamsListResult.data.map(
            (team: IncidentTemplateOwnerTeam): string => {
              return team.teamId!.toString() || "";
            },
          ),
        };

        setInitialValuesForIncident(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setShowIncidentTemplateModal(false);
  };

  const fetchIncidentTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);
      setInitialValuesForIncident({});

      try {
        const listResult: ListResult<IncidentTemplate> =
          await ModelAPI.getList<IncidentTemplate>({
            modelType: IncidentTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setIncidentTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  return (
    <>
      <ModelTable<Incident>
        name="Incidents"
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
        }}
        onCreateEditModalClose={(): void => {
          setInitialValuesForIncident({});
        }}
        modelType={Incident}
        id="incidents-table"
        isDeleteable={false}
        showCreateForm={Object.keys(initialValuesForIncident).length > 0}
        onCreateSuccess={(incident: Incident): Promise<Incident> => {
          GlobalEvents.dispatchEvent(EventName.ACTIVE_INCIDENTS_COUNT_REFRESH);

          return Promise.resolve(incident);
        }}
        query={props.query || {}}
        isEditable={false}
        isCreateable={!props.disableCreate}
        isViewable={true}
        createInitialValues={
          Object.keys(initialValuesForIncident).length > 0
            ? initialValuesForIncident
            : props.createInitialValues
        }
        cardProps={{
          title: props.title || "Incidents",
          buttons: props.disableCreate
            ? []
            : [
                {
                  title: "Create from Template",
                  icon: IconProp.Template,
                  buttonStyle: ButtonStyleType.OUTLINE,
                  onClick: async (): Promise<void> => {
                    setShowIncidentTemplateModal(true);
                    await fetchIncidentTemplates();
                  },
                },
              ],
          description:
            props.description ||
            "Here is a list of incidents for this project.",
        }}
        noItemsMessage={props.noItemsMessage || "No incidents found."}
        formSteps={[
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
        formFields={[
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
        showRefreshButton={true}
        showViewIdButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS]!,
        )}
        filters={[
          {
            title: "Incident ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              incidentSeverity: {
                name: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,

            filterEntityType: IncidentSeverity,
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
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            filterEntityType: IncidentState,
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
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
          {
            field: {
              labels: {
                name: true,
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
            type: FieldType.Element,
            getElement: (item: Incident): ReactElement => {
              return <IncidentElement incident={item} />;
            },
          },
          {
            field: {
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            getElement: (item: Incident): ReactElement => {
              if (item["currentIncidentState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentIncidentState.color || Black}
                    text={item.currentIncidentState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              incidentSeverity: {
                name: true,
                color: true,
              },
            },

            title: "Severity",
            type: FieldType.Entity,
            getElement: (item: Incident): ReactElement => {
              if (item["incidentSeverity"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.incidentSeverity.color || Black}
                    text={item.incidentSeverity.name || "Unknown"}
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

            getElement: (item: Incident): ReactElement => {
              return <MonitorsElement monitors={item["monitors"] || []} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
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

            getElement: (item: Incident): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />

      {incidentTemplates.length === 0 &&
        showIncidentTemplateModal &&
        !isLoading && (
          <ConfirmModal
            title={`No Incident Templates`}
            description={`No incident templates have been created yet. You can create these in Project Settings > Incident Templates.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setShowIncidentTemplateModal(false);
            }}
          />
        )}

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}

      {showIncidentTemplateModal && incidentTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Incident from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowIncidentTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await fetchIncidentTemplate(data["incidentTemplateId"] as ObjectID);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  incidentTemplateId: true,
                },
                title: "Select Incident Template",
                description:
                  "Select an incident template to create an incident from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: incidentTemplates,
                    labelField: "templateName",
                    valueField: "_id",
                  },
                ),
                required: true,
                placeholder: "Select Template",
              },
            ],
          }}
        />
      ) : (
        <> </>
      )}
    </>
  );
};

export default IncidentsTable;
