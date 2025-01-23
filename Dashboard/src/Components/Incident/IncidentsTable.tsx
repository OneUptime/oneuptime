import LabelsElement from "../../Components/Label/Labels";
import MonitorsElement from "../../Components/Monitor/Monitors";
import DashboardNavigation from "../../Utils/Navigation";
import ProjectUser from "../../Utils/ProjectUser";
import IncidentElement from "./Incident";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
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
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

export interface ComponentProps {
  query?: Query<Incident> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  createInitialValues?: FormValues<Incident> | undefined;
  disableCreate?: boolean | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
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


    let cardbuttons: Array<CardButtonSchema> = [];

    if (!props.disableCreate) {
      // then add a card button that takes to monitor create page
      cardbuttons = [
        {
          title: "Create from Template",
          icon: IconProp.Template,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: async (): Promise<void> => {
            setShowIncidentTemplateModal(true);
            await fetchIncidentTemplates();
          },
        },
        {
          title: "Create Monitor",
          onClick: () => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.INCIDENT_CREATE] as Route,
              ),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
      ];
    }

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
        saveFilterProps={props.saveFilterProps}
        id="incidents-table"
        isDeleteable={false}
        showCreateForm={Object.keys(initialValuesForIncident).length > 0}
        query={props.query || {}}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        createInitialValues={
          Object.keys(initialValuesForIncident).length > 0
            ? initialValuesForIncident
            : props.createInitialValues
        }
        cardProps={{
          title: props.title || "Incidents",
          buttons: cardbuttons,
          description:
            props.description ||
            "Here is a list of incidents for this project.",
        }}
        createVerb="Declare"
        noItemsMessage={props.noItemsMessage || "No incidents found."}
       
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
            title: "Incident Number",
            type: FieldType.Number,
            field: {
              incidentNumber: true,
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
              projectId: DashboardNavigation.getProjectId()!,
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
              projectId: DashboardNavigation.getProjectId()!,
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
              projectId: DashboardNavigation.getProjectId()!,
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
              projectId: DashboardNavigation.getProjectId()!,
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
              incidentNumber: true,
            },
            title: "Incident Number",
            type: FieldType.Text,
            getElement: (item: Incident): ReactElement => {
              if (!item.incidentNumber) {
                return <>-</>;
              }

              return <>#{item.incidentNumber}</>;
            },
          },
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
