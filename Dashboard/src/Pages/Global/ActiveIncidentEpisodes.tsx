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
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import LabelsElement from "Common/UI/Components/Label/Labels";

const ActiveIncidentEpisodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page
      title={"Active Incident Episodes"}
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Active Incident Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ACTIVE_INCIDENT_EPISODES] as Route,
          ),
        },
      ]}
    >
      <ModelTable<IncidentEpisode>
        modelType={IncidentEpisode}
        name="Active Incident Episodes"
        id="active-incident-episodes-table"
        userPreferencesKey="active-incident-episodes-table"
        saveFilterProps={{
          tableId: "active-incident-episodes-table",
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
          episodeNumberWithPrefix: true,
        }}
        isEditable={false}
        showRefreshButton={true}
        isCreateable={false}
        isViewable={true}
        showViewIdButton={true}
        cardProps={{
          title: "Active Incident Episodes",
          description:
            "Here is a list of active incident episodes for all of the projects you are a part of.",
        }}
        noItemsMessage={"No active incident episodes found."}
        singularName="Active Incident Episode"
        pluralName="Active Incident Episodes"
        onViewPage={(item: IncidentEpisode): Promise<Route> => {
          return Promise.resolve(
            new Route(
              `/dashboard/${
                item.projectId || item.project?._id || ""
              }/incident-episodes/${item._id}`,
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
              episodeNumber: true,
            },
            type: FieldType.Number,
            title: "Episode Number",
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
            getElement: (item: IncidentEpisode): ReactElement => {
              return <ProjectElement project={item["project"]!} />;
            },
          },
          {
            field: {
              episodeNumber: true,
              episodeNumberWithPrefix: true,
            },
            title: "Episode #",
            type: FieldType.Text,
            getElement: (item: IncidentEpisode): ReactElement => {
              if (!item.episodeNumber) {
                return <>-</>;
              }
              return <>{item.episodeNumberWithPrefix || `#${item.episodeNumber}`}</>;
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
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "Current State",
            type: FieldType.Entity,
            getElement: (item: IncidentEpisode): ReactElement => {
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
            title: "Severity",
            type: FieldType.Entity,

            getElement: (item: IncidentEpisode): ReactElement => {
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
              incidentCount: true,
            },
            title: "Incidents",
            type: FieldType.Number,
            getElement: (item: IncidentEpisode): ReactElement => {
              return <>{item.incidentCount || 0}</>;
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
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: IncidentEpisode): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
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

export default ActiveIncidentEpisodes;
