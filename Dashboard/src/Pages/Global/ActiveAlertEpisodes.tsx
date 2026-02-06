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
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import LabelsElement from "Common/UI/Components/Label/Labels";

const ActiveAlertEpisodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page
      title={"Active Alert Episodes"}
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Active Alert Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ACTIVE_ALERT_EPISODES] as Route,
          ),
        },
      ]}
    >
      <ModelTable<AlertEpisode>
        modelType={AlertEpisode}
        name="Active Alert Episodes"
        id="active-alert-episodes-table"
        userPreferencesKey="active-alert-episodes-table"
        saveFilterProps={{
          tableId: "active-alert-episodes-table",
        }}
        isDeleteable={false}
        query={{
          currentAlertState: {
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
          title: "Active Alert Episodes",
          description:
            "Here is a list of active alert episodes for all of the projects you are a part of.",
        }}
        noItemsMessage={"No active alert episodes found."}
        singularName="Active Alert Episode"
        pluralName="Active Alert Episodes"
        onViewPage={(item: AlertEpisode): Promise<Route> => {
          return Promise.resolve(
            new Route(
              `/dashboard/${
                item.projectId || item.project?._id || ""
              }/alert-episodes/${item._id}`,
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
            getElement: (item: AlertEpisode): ReactElement => {
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
            getElement: (item: AlertEpisode): ReactElement => {
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
              currentAlertState: {
                name: true,
                color: true,
              },
            },
            title: "Current State",
            type: FieldType.Entity,
            getElement: (item: AlertEpisode): ReactElement => {
              if (item["currentAlertState"]) {
                return (
                  <Pill
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertSeverity: {
                name: true,
                color: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,

            getElement: (item: AlertEpisode): ReactElement => {
              if (item["alertSeverity"]) {
                return (
                  <Pill
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertCount: true,
            },
            title: "Alerts",
            type: FieldType.Number,
            getElement: (item: AlertEpisode): ReactElement => {
              return <>{item.alertCount || 0}</>;
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
            getElement: (item: AlertEpisode): ReactElement => {
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

export default ActiveAlertEpisodes;
