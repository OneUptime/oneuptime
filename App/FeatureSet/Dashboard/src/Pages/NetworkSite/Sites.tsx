import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../Components/MonitorStatus/MonitorStatusElement";
import Route from "Common/Types/API/Route";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkSites: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkSite>
        modelType={NetworkSite}
        id="network-sites-table"
        userPreferencesKey="network-sites-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="Network Sites"
        searchableFields={["name", "description"]}
        cardProps={{
          title: "Network Sites",
          description:
            "Group your network devices into a drill-down hierarchy — regions, franchisees, markets, units. Each site rolls up the health of everything below it.",
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              siteType: true,
            },
            title: "Site Type",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(NetworkSiteType),
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              siteType: true,
            },
            title: "Site Type",
            description:
              "Level of this site in the hierarchy. Units are leaf sites — the network map opens their device topology.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(NetworkSiteType),
            required: true,
            placeholder: "Unit",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            description:
              "The site this one is nested under. Leave empty for a root site.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Parent Site (optional)",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            description:
              "Between -90 and 90. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "39.7817",
          },
          {
            field: {
              longitude: true,
            },
            title: "Longitude",
            description:
              "Between -180 and 180. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkSite): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              siteType: true,
            },
            title: "Site Type",
            type: FieldType.Text,
          },
          {
            field: {
              parentSite: {
                name: true,
              },
            },
            title: "Parent Site",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.parentSite?.name) {
                return <span className="text-sm text-gray-400">Root</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.parentSite.name}
                </span>
              );
            },
          },
          {
            field: {
              currentMonitorStatus: {
                name: true,
                color: true,
              },
            },
            title: "Status",
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.currentMonitorStatus) {
                return <span className="text-sm text-gray-400">No Data</span>;
              }
              return (
                <MonitorStatusElement
                  monitorStatus={item.currentMonitorStatus}
                  shouldAnimate={false}
                />
              );
            },
          },
          {
            field: {
              latitude: true,
            },
            title: "Location",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (
                item.latitude === undefined ||
                item.latitude === null ||
                item.longitude === undefined ||
                item.longitude === null
              ) {
                return (
                  <span className="text-sm text-gray-400">Not pinned</span>
                );
              }
              return (
                <span className="text-sm text-gray-600">
                  {item.latitude}, {item.longitude}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        selectMoreFields={{
          longitude: true,
        }}
        onViewPage={(item: NetworkSite): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default NetworkSites;
