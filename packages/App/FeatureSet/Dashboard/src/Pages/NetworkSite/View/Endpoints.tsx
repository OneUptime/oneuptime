import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import Route from "Common/Types/API/Route";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * LAN endpoints discovered at this site — POS terminals, cameras,
 * printers — attached to this site's switches, from ARP/FDB walks.
 */
const NetworkSiteEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<NetworkEndpoint>
        modelType={NetworkEndpoint}
        id="network-site-endpoints-table"
        userPreferencesKey="network-site-endpoints-table"
        query={{ siteId: modelId }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        name="Site Endpoints"
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Endpoints at this Site",
          description:
            "Devices attached to this site's monitored switches and routers, discovered from ARP and FDB data.",
        }}
        noItemsMessage="No endpoints discovered at this site yet. Enable endpoint collection on the site's switch and router monitors — attached devices appear here as ARP and FDB data comes in."
        formFields={[
          {
            field: {
              classification: true,
            },
            title: "Classification",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "POS, Kiosk, Camera, Printer, ...",
            description:
              "What this endpoint actually is. Free-form — use whatever taxonomy your team searches by.",
          },
        ]}
        filters={[
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
          },
          {
            field: {
              classification: true,
            },
            title: "Classification",
            type: FieldType.Text,
          },
          {
            field: {
              ipAddress: true,
            },
            title: "IP Address",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              macAddress: true,
            },
            title: "MAC Address",
            type: FieldType.Text,
          },
          {
            field: {
              ipAddress: true,
            },
            title: "IP Address",
            type: FieldType.Element,
            getElement: (item: NetworkEndpoint): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.ipAddress || "—"}
                </span>
              );
            },
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkEndpoint): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.vendor || "—"}
                </span>
              );
            },
          },
          {
            field: {
              classification: true,
            },
            title: "Classification",
            type: FieldType.Element,
            getElement: (item: NetworkEndpoint): ReactElement => {
              if (!item.classification) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                  {item.classification}
                </span>
              );
            },
          },
          {
            field: {
              attachedNetworkDevice: {
                name: true,
                _id: true,
              },
            },
            title: "Attached Device",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkEndpoint): ReactElement => {
              if (
                !item.attachedNetworkDevice?.name ||
                !item.attachedNetworkDevice?._id
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                {
                  modelId: new ObjectID(
                    item.attachedNetworkDevice._id.toString(),
                  ),
                },
              );

              return (
                <AppLink
                  to={route}
                  className="text-sm text-gray-900 hover:underline"
                >
                  {item.attachedNetworkDevice.name}
                </AppLink>
              );
            },
          },
          {
            field: {
              attachedPortName: true,
            },
            title: "Port",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkEndpoint): ReactElement => {
              return (
                <span className="text-sm text-gray-600">
                  {item.attachedPortName || "—"}
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Element,
            getElement: (item: NetworkEndpoint): ReactElement => {
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
      />
    </Fragment>
  );
};

export default NetworkSiteEndpoints;
