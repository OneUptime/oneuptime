import PageComponentProps from "../PageComponentProps";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * Inventory of LAN endpoints (POS terminals, kiosks, cameras, printers,
 * ...) discovered via ARP/FDB walks of monitored switches and routers.
 * Rows are upserted by the server as devices report them; classification
 * is the one user-editable field, so a franchise can tag what each MAC
 * actually is.
 */
const NetworkEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkEndpoint>
        modelType={NetworkEndpoint}
        id="network-endpoints-table"
        userPreferencesKey="network-endpoints-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        name="Network Endpoints"
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Endpoints",
          description:
            "Devices attached to your monitored switches and routers, discovered from ARP and FDB data. Endpoints age by Last Seen — nothing is pruned automatically, so a terminal that goes quiet simply drifts down this list.",
        }}
        noItemsMessage={
          "No endpoints discovered yet. Enable endpoint collection on your switch and router monitors — attached devices appear here as ARP and FDB data comes in."
        }
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
              },
            },
            title: "Attached Device",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkEndpoint): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.attachedNetworkDevice?.name || "—"}
                </span>
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
              vlanId: true,
            },
            title: "VLAN",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkEndpoint): ReactElement => {
              if (item.vlanId === undefined || item.vlanId === null) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-600">{item.vlanId}</span>
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

export default NetworkEndpoints;
