import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTDevice from "Common/Models/DatabaseModels/IoTDevice";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import {
  formatPercent,
  routeParamFromExternalId,
} from "../Utils/IoTDeviceUtils";
import {
  IOT_DEVICES_FLEET_DISCONNECTED_NOTICE,
  IOT_FLEET_DISCONNECTED_ACTION,
  isIoTFleetConnected,
} from "../Utils/IoTFleetConnection";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { IOT_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/IoTMetricDescriptions";
import IoTDeviceStatus from "../../../Components/IoT/IoTDeviceStatus";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

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
 *
 * While the fleet itself is disconnected (#10014), no device's state is
 * current: each was last reported before the fleet stopped, and when the
 * collector is what went away every device can read offline. So the list
 * opens on one notice that says so, which leads to the fleet's Overview
 * and what to check there, and each row's Status says the fleet is
 * disconnected, in grey, with the state the device last reported and when
 * (IoTDeviceStatus) - never a red "Offline" that blames the device. The
 * rest of each row is what the device last sent, dated by Last Seen.
 */

const IoTFleetDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The fleet's own connection: whether its devices' states are current.
  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isFleetLoading, setIsFleetLoading] = useState<boolean>(true);
  const [fleetError, setFleetError] = useState<string>("");

  const fetchFleet: () => Promise<void> = async (): Promise<void> => {
    setIsFleetLoading(true);
    setFleetError("");
    try {
      setFleet(
        await ModelAPI.getItem({
          modelType: IoTFleet,
          id: modelId,
          select: {
            otelCollectorStatus: true,
          },
        }),
      );
    } catch (err) {
      setFleetError(API.getFriendlyMessage(err));
    }
    setIsFleetLoading(false);
  };

  useEffect(() => {
    fetchFleet().catch((err: Error) => {
      setFleetError(API.getFriendlyMessage(err));
      setIsFleetLoading(false);
    });
  }, []);

  if (isFleetLoading) {
    return <PageSkeleton shape="table" />;
  }

  if (fleetError) {
    return (
      <ErrorMessage
        message={fleetError}
        onRefreshClick={() => {
          fetchFleet().catch(() => {
            // fetchFleet says what failed itself.
          });
        }}
      />
    );
  }

  const isFleetConnected: boolean = isIoTFleetConnected(
    fleet?.otelCollectorStatus as string | undefined,
  );

  return (
    <Fragment>
      {!isFleetConnected && (
        <Alert
          className="mb-5"
          type={AlertType.WARNING}
          title={IOT_DEVICES_FLEET_DISCONNECTED_NOTICE}
          textOnRight={IOT_FLEET_DISCONNECTED_ACTION}
          dataTestId="iot-devices-fleet-disconnected"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.IOT_FLEET_VIEW] as Route,
                { modelId: modelId },
              ),
            );
          }}
        />
      )}
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
            // Its name, and its own data under it: the cell reads the name's way.
            getLineText: (item: IoTDevice): string | undefined => {
              return item.name || item.externalId;
            },
            getElement: (item: IoTDevice): ReactElement => {
              return (
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {(item.name as string) || (item.externalId as string) || (
                      <TableEmptyValue />
                    )}
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
                  {(item.deviceType as string) || <TableEmptyValue />}
                </span>
              );
            },
          },
          {
            field: {
              isUp: true,
            },
            title: "Status",
            headerTooltip: IOT_METRIC_DESCRIPTIONS.statusColumn,
            type: FieldType.Element,
            getElement: (item: IoTDevice): ReactElement => {
              return (
                <IoTDeviceStatus
                  isUp={item.isUp}
                  isFleetConnected={isFleetConnected}
                  lastSeenAt={item.lastSeenAt}
                  testId={`iot-device-status-${item.externalId || ""}`}
                />
              );
            },
          },
          {
            field: {
              latestBatteryPercent: true,
            },
            title: "Battery",
            headerTooltip: IOT_METRIC_DESCRIPTIONS.batteryColumn,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestBatteryPercent === undefined ||
                item.latestBatteryPercent === null
              ) {
                return <TableEmptyValue />;
              }
              const battery: number = Number(item.latestBatteryPercent);
              const isLow: boolean = battery <= 20;
              return (
                <span
                  className={`text-sm font-medium ${
                    isLow ? "text-red-700" : "text-gray-700"
                  }`}
                >
                  {getValueOrQuietDash(formatPercent(battery))}
                </span>
              );
            },
          },
          {
            field: {
              latestSignalStrengthDbm: true,
            },
            title: "Signal",
            headerTooltip: IOT_METRIC_DESCRIPTIONS.signalColumn,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestSignalStrengthDbm === undefined ||
                item.latestSignalStrengthDbm === null
              ) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-700">
                  {`${Number(item.latestSignalStrengthDbm).toFixed(0)}\u00A0dBm`}
                </span>
              );
            },
          },
          {
            field: {
              latestTemperatureCelsius: true,
            },
            title: "Temperature",
            headerTooltip: IOT_METRIC_DESCRIPTIONS.temperatureColumn,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTDevice): ReactElement => {
              if (
                item.latestTemperatureCelsius === undefined ||
                item.latestTemperatureCelsius === null
              ) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-700">
                  {`${Number(item.latestTemperatureCelsius).toFixed(1)}\u00A0°C`}
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
