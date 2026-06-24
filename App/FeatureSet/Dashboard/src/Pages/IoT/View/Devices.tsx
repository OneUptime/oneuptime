import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTDevice from "Common/Models/DatabaseModels/IoTDevice";
import {
  formatPercent,
  routeParamFromExternalId,
} from "../Utils/IoTDeviceUtils";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Devices in a single fleet. Reads the IoTDevice Postgres inventory
 * table scoped to this fleet (an IoT fleet contains only Devices — no
 * nodes/guests/storage like Proxmox). Read-only: rows are upserted by
 * the OTel ingest path, never created by users.
 *
 * The view route's subModelId is the device `externalId` (the
 * `device.id` datapoint label) percent-encoded as a single path
 * segment — same identity scheme as the Proxmox guest/node detail
 * routes — not the DB `_id`.
 */

const IoTFleetDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<IoTDevice>
        modelType={IoTDevice}
        id="iot-devices-table"
        userPreferencesKey="iot-devices-table"
        query={{
          iotFleetId: modelId,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showRefreshButton={true}
        name="IoT Devices"
        isViewable={true}
        searchableFields={["name", "externalId"]}
        filters={[]}
        cardProps={{
          title: "Devices",
          description:
            "Sensors, gateways, and devices reporting into this fleet with their latest status, battery, connectivity, and temperature.",
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: IoTDevice): ReactElement => {
              return (
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {(item.name as string) || (item.externalId as string) || "—"}
                  </span>
                  {item.name && item.externalId ? (
                    <span className="text-xs text-gray-500">
                      {item.externalId as string}
                    </span>
                  ) : (
                    <Fragment />
                  )}
                </div>
              );
            },
          },
          {
            field: {
              kind: true,
            },
            title: "Kind",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              deviceType: true,
            },
            title: "Device Type",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {(item.deviceType as string) || "—"}
                </span>
              );
            },
          },
          {
            field: {
              isUp: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: IoTDevice): ReactElement => {
              if (item.isUp === undefined || item.isUp === null) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <StatusBadge
                  text={item.isUp ? "Online" : "Offline"}
                  type={
                    item.isUp ? StatusBadgeType.Success : StatusBadgeType.Danger
                  }
                />
              );
            },
          },
          {
            field: {
              latestBatteryPercent: true,
            },
            title: "Battery",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestBatteryPercent === undefined ||
                item.latestBatteryPercent === null
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const battery: number = Number(item.latestBatteryPercent);
              const isLow: boolean = battery <= 20;
              return (
                <span
                  className={`text-sm font-medium ${
                    isLow ? "text-red-700" : "text-gray-700"
                  }`}
                >
                  {formatPercent(battery)}
                </span>
              );
            },
          },
          {
            field: {
              latestSignalStrengthDbm: true,
            },
            title: "Signal",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestSignalStrengthDbm === undefined ||
                item.latestSignalStrengthDbm === null
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {Number(item.latestSignalStrengthDbm).toFixed(0)} dBm
                </span>
              );
            },
          },
          {
            field: {
              latestTemperatureCelsius: true,
            },
            title: "Temperature",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestTemperatureCelsius === undefined ||
                item.latestTemperatureCelsius === null
              ) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {Number(item.latestTemperatureCelsius).toFixed(1)} °C
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
        ]}
        onViewPage={(item: IoTDevice): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL] as Route,
              {
                modelId: modelId,
                subModelId: routeParamFromExternalId(
                  (item.externalId as string) || "",
                ),
              },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default IoTFleetDevices;
