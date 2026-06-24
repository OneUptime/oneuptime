import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTDeviceModel from "Common/Models/DatabaseModels/IoTDevice";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  externalIdFromRouteParam,
  fetchIoTInventoryRow,
  formatBytes,
  formatPercent,
  formatUptime,
  displayNameForDevice,
  displayStatusForDevice,
} from "../Utils/IoTDeviceUtils";
import OneUptimeDate from "Common/Types/Date";

const IoTFleetDeviceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../iot/:modelId/devices/:subModelId — subModelId is
   * the percent-encoded device externalId (the `device.id` datapoint
   * label), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [row, setRow] = useState<IoTDeviceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: IoTFleet | null = await ModelAPI.getItem({
        modelType: IoTFleet,
        id: modelId,
        select: {
          name: true,
        },
      });
      setFleet(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    try {
      const inventoryRow: IoTDeviceModel | null = await fetchIoTInventoryRow({
        iotFleetId: modelId,
        externalId: externalId,
      });
      setRow(inventoryRow);
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!fleet?.name) {
    return <ErrorMessage message="Fleet not found." />;
  }

  const fleetName: string = fleet.name;
  const deviceName: string = row ? displayNameForDevice(row) : externalId;

  /*
   * All charts filter on the raw `id` datapoint label (the device.id
   * label every IoT data series carries), scoped to this fleet via the
   * resource attribute.
   */
  const idAttributes: Record<string, string> = {
    "resource.iot.fleet.name": fleetName,
    id: externalId,
  };

  const batteryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "device_battery",
      title: "Battery Level",
      description: `Battery level percent for device ${deviceName} (iot_battery_percent).`,
      legend: "Battery",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "iot_battery_percent",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const signalQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "device_signal",
      title: "Signal Strength",
      description: `Signal strength in dBm for device ${deviceName} (iot_signal_strength_dbm).`,
      legend: "Signal",
      legendUnit: "dBm",
    },
    metricQueryData: {
      filterData: {
        metricName: "iot_signal_strength_dbm",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const temperatureQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "device_temperature",
      title: "Temperature",
      description: `Temperature in degrees Celsius for device ${deviceName} (iot_temperature_celsius).`,
      legend: "Temperature",
      legendUnit: "°C",
    },
    metricQueryData: {
      filterData: {
        metricName: "iot_temperature_celsius",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "device_memory",
      title: "Memory Usage",
      description: `Memory usage for device ${deviceName} (iot_memory_usage_bytes).`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "iot_memory_usage_bytes",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  // Build read-only overview summary fields (latest-metric tiles) from
  // the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Device Name", value: deviceName },
    { title: "Fleet", value: fleetName },
  ];

  if (row) {
    const status: string = displayStatusForDevice(row);
    if (status) {
      summaryFields.push({
        title: "Status",
        value: (
          <StatusBadge
            text={status}
            type={row.isUp ? StatusBadgeType.Success : StatusBadgeType.Danger}
          />
        ),
      });
    }

    if (row.kind) {
      summaryFields.push({ title: "Kind", value: row.kind });
    }
    if (row.deviceType) {
      summaryFields.push({ title: "Device Type", value: row.deviceType });
    }
    if (row.firmwareVersion) {
      summaryFields.push({
        title: "Firmware Version",
        value: row.firmwareVersion,
      });
    }

    const uptime: string = formatUptime(row.uptimeSeconds);
    if (uptime) {
      summaryFields.push({ title: "Uptime", value: uptime });
    }

    if (
      row.latestBatteryPercent !== null &&
      row.latestBatteryPercent !== undefined
    ) {
      summaryFields.push({
        title: "Battery",
        value: formatPercent(Number(row.latestBatteryPercent)),
      });
    }

    if (
      row.latestSignalStrengthDbm !== null &&
      row.latestSignalStrengthDbm !== undefined
    ) {
      summaryFields.push({
        title: "Signal Strength",
        value: `${Number(row.latestSignalStrengthDbm).toFixed(0)} dBm`,
      });
    }

    if (
      row.latestTemperatureCelsius !== null &&
      row.latestTemperatureCelsius !== undefined
    ) {
      summaryFields.push({
        title: "Temperature",
        value: `${Number(row.latestTemperatureCelsius).toFixed(1)} °C`,
      });
    }

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      summaryFields.push({
        title: "CPU",
        value: formatPercent(Number(row.latestCpuPercent)),
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      summaryFields.push({
        title: "Memory (Used / Max)",
        value: `${formatBytes(Number(row.latestMemoryBytes))} / ${formatBytes(
          row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
            ? Number(row.maxMemoryBytes)
            : null,
        )}`,
      });
    }

    summaryFields.push({ title: "External ID", value: externalId });

    if (row.lastSeenAt) {
      summaryFields.push({
        title: "Last Seen",
        value: OneUptimeDate.fromNow(new Date(row.lastSeenAt as Date)),
      });
    }
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Device details not reported yet. Make sure the IoT fleet agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Device Metrics: ${deviceName}`}
          description="Battery, connectivity, temperature, and memory for this device over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[
              batteryQuery,
              signalQuery,
              temperatureQuery,
              memoryQuery,
            ]}
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default IoTFleetDeviceDetail;
