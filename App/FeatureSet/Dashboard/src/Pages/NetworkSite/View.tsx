import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../Components/MonitorStatus/MonitorStatusElement";
import Route from "Common/Types/API/Route";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkSiteView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const openInNetworkMap: VoidFunction = (): void => {
    const mapRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_SITE_MAP] as Route,
    ).addQueryParams({ site: modelId.toString() });
    Navigation.navigate(mapRoute);
  };

  return (
    <Fragment>
      <div className="flex justify-end">
        <Button
          title="Open in Network Map"
          icon={IconProp.Map}
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={openInNetworkMap}
        />
      </div>

      <CardModelDetail<NetworkSite>
        name="Network Site Details"
        cardProps={{
          title: "Network Site Details",
          description:
            "Where this site sits in the hierarchy, and where it is on the map.",
        }}
        isEditable={true}
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
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "39.7817",
          },
          {
            field: {
              longitude: true,
            },
            title: "Longitude",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
        ]}
        modelDetailProps={{
          modelType: NetworkSite,
          id: "network-site-details",
          modelId: modelId,
          /*
           * The Coordinates row below reads both columns, but the API
           * select is built purely from the keys each field declares — so
           * longitude has to be asked for here or it comes back undefined
           * and every pinned site reads "Not pinned on the map". Same
           * reason Sites.tsx passes it for its Location column.
           */
          selectMoreFields: {
            longitude: true,
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                siteType: true,
              },
              title: "Site Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                parentSite: {
                  name: true,
                },
              },
              title: "Parent Site",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.parentSite?.name) {
                  return <span className="text-gray-400">Root site</span>;
                }
                return <span>{item.parentSite.name}</span>;
              },
            },
            {
              field: {
                currentMonitorStatus: {
                  name: true,
                  color: true,
                },
              },
              title: "Current Status",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.currentMonitorStatus) {
                  return <span className="text-gray-400">No Data</span>;
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
                address: true,
              },
              title: "Address",
              fieldType: FieldType.Text,
              showIf: (item: NetworkSite): boolean => {
                return Boolean(item.address);
              },
            },
            {
              field: {
                latitude: true,
              },
              title: "Coordinates",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (
                  item.latitude === undefined ||
                  item.latitude === null ||
                  item.longitude === undefined ||
                  item.longitude === null
                ) {
                  return (
                    <span className="text-gray-400">Not pinned on the map</span>
                  );
                }
                return (
                  <span>
                    {item.latitude}, {item.longitude}
                  </span>
                );
              },
            },
            {
              field: {
                lastRollupAt: true,
              },
              title: "Health Last Rolled Up",
              fieldType: FieldType.DateTime,
              showIf: (item: NetworkSite): boolean => {
                return Boolean(item.lastRollupAt);
              },
            },
          ],
        }}
      />

      <ModelTable<NetworkSite>
        modelType={NetworkSite}
        id="network-site-children-table"
        userPreferencesKey="network-site-children-table"
        query={{ parentSiteId: modelId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        name="Child Sites"
        cardProps={{
          title: "Child Sites",
          description: "Sites nested directly under this one.",
        }}
        noItemsMessage="This site has no child sites."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
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
        ]}
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

      <ModelTable<NetworkDevice>
        modelType={NetworkDevice}
        id="network-site-devices-table"
        userPreferencesKey="network-site-devices-table"
        query={{ siteId: modelId }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        name="Devices in this Site"
        cardProps={{
          title: "Devices in this Site",
          description:
            "Network devices assigned to this site, directly or by an assignment rule.",
        }}
        noItemsMessage="No devices are assigned to this site yet. Assign them from the device settings, or set up assignment rules."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
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
              hostname: true,
            },
            title: "Hostname",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.lastSeenAt) {
                return <span className="text-sm text-gray-400">Never</span>;
              }

              const lastSeen: Date = OneUptimeDate.fromString(item.lastSeenAt);

              return (
                <span
                  className="text-sm text-gray-600"
                  title={OneUptimeDate.getDateAsLocalFormattedString(lastSeen)}
                >
                  {OneUptimeDate.fromNow(lastSeen)}
                </span>
              );
            },
          },
        ]}
        onViewPage={(item: NetworkDevice): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
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

export default NetworkSiteView;
