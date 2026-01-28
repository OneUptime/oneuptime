import MonitorElement from "../../Components/Monitor/Monitor";
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
import Alert from "Common/Models/DatabaseModels/Alert";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

const NewAlerts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Page
      title={"New Alerts"}
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "New Alerts",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.NEW_ALERTS] as Route,
          ),
        },
      ]}
    >
      <ModelTable<Alert>
        modelType={Alert}
        name="New Alerts"
        id="new-alerts-table"
        userPreferencesKey="new-alerts-table"
        saveFilterProps={{
          tableId: "new-alerts-table",
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
          title: "New Alerts",
          description:
            "Here is a list of new alerts for all of the projects you are a part of.",
        }}
        noItemsMessage={"No alert found."}
        singularName="New Alert"
        pluralName="New Alerts"
        onViewPage={(item: Alert): Promise<Route> => {
          return Promise.resolve(
            new Route(
              `/dashboard/${
                item.projectId || item.project?._id || ""
              }/alerts/${item._id}`,
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
              alertNumber: true,
            },
            type: FieldType.Number,
            title: "Alert Number",
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
            getElement: (item: Alert): ReactElement => {
              return <ProjectElement project={item["project"]!} />;
            },
          },
          {
            field: {
              alertNumber: true,
            },
            title: "Alert Number",
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
              currentAlertState: {
                name: true,
                color: true,
              },
            },
            title: "Current State",
            type: FieldType.Entity,
            getElement: (item: Alert): ReactElement => {
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
            title: "Alert Severity",
            type: FieldType.Entity,

            getElement: (item: Alert): ReactElement => {
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
              monitor: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitor Affected",
            type: FieldType.Text,

            getElement: (item: Alert): ReactElement => {
              if (item["monitor"]) {
                return <MonitorElement monitor={item["monitor"]!} />;
              }
              return <span>-</span>;
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

export default NewAlerts;
