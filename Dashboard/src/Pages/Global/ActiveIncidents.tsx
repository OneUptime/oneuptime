import MonitorsElement from "../../Components/Monitor/Monitors";
import ProjectElement from "../../Components/Project/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, {
  ListResult,
  RequestOptions,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Incident from "Common/Models/DatabaseModels/Incident";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

const ActiveIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page
      title={"Active Incidents"}
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Active Incidents",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ACTIVE_INCIDENTS] as Route,
          ),
        },
      ]}
    >
      <ModelTable<Incident>
        modelType={Incident}
        name="Active Incidents"
        id="active-incidents-table"
        userPreferencesKey="active-incidents-table"
        saveFilterProps={{
          tableId: "active-incidents-table",
        }}
        isDeleteable={false}
        query={{
          currentIncidentState: {
            order: 1,
          },
        }}
        fetchRequestOptions={
          {
            isMultiTenantRequest: true,
          } as RequestOptions
        }
        selectMoreFields={{
          projectId: true,
        }}
        isEditable={false}
        showRefreshButton={true}
        isCreateable={false}
        isViewable={true}
        showViewIdButton={true}
        cardProps={{
          title: "Active Incidents",
          description:
            "Here is a list of active incidents for all of the projects you are a part of.",
        }}
        noItemsMessage={"No incident found."}
        singularName="Active Incident"
        pluralName="Active Incidents"
        onViewPage={(item: Incident): Promise<Route> => {
          return Promise.resolve(
            new Route(
              `/dashboard/${
                item.projectId || item.project?._id || ""
              }/incidents/${item._id}`,
            ),
          );
        }}
        filters={[
          {
            field: {
              projectId: true,
            },
            title: "Project",
            type: FieldType.EntityArray,
            filterEntityType: Project,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
            fetchFilterDropdownOptions: async (): Promise<
              Array<DropdownOption>
            > => {
              const projects: ListResult<Project> =
                await ModelAPI.getList<Project>({
                  modelType: Project,
                  query: {},
                  limit: 100,
                  skip: 0,
                  select: {
                    name: true,
                    _id: true,
                  },
                  sort: {
                    name: SortOrder.Ascending,
                  },
                  requestOptions: {
                    isMultiTenantRequest: true,
                    overrideRequestUrl: URL.fromString(
                      APP_API_URL.toString(),
                    ).addRoute("/project/list-user-projects"),
                  },
                });

              return projects.data.map((project: Project): DropdownOption => {
                return {
                  label: project.name || "",
                  value: project._id || "",
                };
              });
            },
          },
          {
            field: {
              incidentNumber: true,
            },
            type: FieldType.Number,
            title: "Incident Number",
          },
          {
            field: {
              title: true,
            },
            type: FieldType.Text,
            title: "Title",
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.Date,
            title: "Created At",
          },
        ]}
        columns={[
          {
            field: {
              project: {
                name: true,
                _id: true,
              },
            },
            title: "Project",
            type: FieldType.Text,

            selectedProperty: "name",
            getElement: (item: Incident): ReactElement => {
              return <ProjectElement project={item["project"]!} />;
            },
          },
          {
            field: {
              incidentNumber: true,
            },
            title: "Incident Number",
            type: FieldType.Number,
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
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "Current State",
            type: FieldType.Entity,
            getElement: (item: Incident): ReactElement => {
              if (item["currentIncidentState"]) {
                return (
                  <Pill
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
            title: "Incident Severity",
            type: FieldType.Entity,

            getElement: (item: Incident): ReactElement => {
              if (item["incidentSeverity"]) {
                return (
                  <Pill
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
            type: FieldType.Text,

            getElement: (item: Incident): ReactElement => {
              return <MonitorsElement monitors={item["monitors"] || []} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />
    </Page>
  );
};

export default ActiveIncidents;
