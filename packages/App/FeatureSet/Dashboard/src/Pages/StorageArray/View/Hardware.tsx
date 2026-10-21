import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
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
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { StorageSystemUtil } from "Common/Types/StorageArray/StorageSystem";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * The array's hardware, one table per kind of part, each with a status pill
 * coloured from the unhealthy status lists (StorageArrayResourceUtils):
 *
 *   - FlashArray: chassis, controllers' bays, power supplies, fans, sensors
 *     and ports (purefa_hw_component_status, kind=Hardware), drives and
 *     NVRAM modules (purefa_drive_capacity_bytes, kind=Drive), controllers
 *     (purefa_hw_controller_info, kind=Controller) and network interfaces
 *     (purefa_network_interface_*, kind=NetworkInterface);
 *   - FlashBlade: blades, fabric modules, power supplies and fans
 *     (purefb_hardware_health, kind=Hardware).
 */

function textCell(text: string): ReactElement {
  if (!text) {
    return <span className="text-gray-400">—</span>;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}

const StorageArrayHardware: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStorageArray: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: StorageArray | null = await ModelAPI.getItem({
        modelType: StorageArray,
        id: modelId,
        select: {
          name: true,
          storageSystem: true,
        },
      });
      setStorageArray(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchStorageArray().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray) {
    return <ErrorMessage message="Storage array not found." />;
  }

  if (StorageSystemUtil.isFlashBlade(storageArray.storageSystem)) {
    return (
      <StorageArrayResourceTable
        storageArrayId={modelId}
        kind={StorageArrayResourceKind.Hardware}
        tableId="storage-array-flashblade-hardware-table"
        name="Storage Array Hardware Components"
        singularName="Hardware Component"
        pluralName="Hardware Components"
        title="Hardware Components"
        description="Blades, fabric modules, power supplies, fans and the other parts of this FlashBlade, with the health the FlashBlade reports for each."
        noItemsMessage="No hardware components found in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade."
        columns={[
          StorageArrayResourceColumns.getTextColumn({
            field: "componentType",
            title: "Type",
          }),
          StorageArrayResourceColumns.getStatusColumn({
            title: "Health",
            description:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.flashBladeHardwareStatusColumn,
          }),
          {
            field: {
              details: true,
            },
            id: "slot",
            title: "Slot",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              return textCell(
                StorageArrayResourceUtils.getDetailString(item, "slot"),
              );
            },
          },
          StorageArrayResourceColumns.getLastSeenColumn(),
        ]}
      />
    );
  }

  return (
    <Fragment>
      <StorageArrayResourceTable
        storageArrayId={modelId}
        kind={StorageArrayResourceKind.Hardware}
        tableId="storage-array-hardware-components-table"
        name="Storage Array Hardware Components"
        singularName="Hardware Component"
        pluralName="Hardware Components"
        title="Hardware Components"
        description="The chassis, controller and drive bays, power supplies, fans, temperature sensors and ports of this FlashArray, with the status Purity reports for each."
        noItemsMessage="No hardware components found in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array."
        columns={[
          StorageArrayResourceColumns.getTextColumn({
            field: "componentType",
            title: "Type",
          }),
          StorageArrayResourceColumns.getStatusColumn({
            title: "Status",
            description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hardwareStatusColumn,
          }),
          {
            field: {
              temperatureCelsius: true,
            },
            title: "Temperature",
            headerTooltip:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.hardwareTemperatureColumn,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              const temperature: number | null =
                StorageArrayResourceUtils.freshMetricValue(
                  item,
                  item.temperatureCelsius,
                );
              return textCell(
                temperature === null
                  ? ""
                  : StorageArrayResourceUtils.formatTemperature(temperature),
              );
            },
          },
          StorageArrayResourceColumns.getLastSeenColumn(),
        ]}
      />

      <StorageArrayResourceTable
        storageArrayId={modelId}
        kind={StorageArrayResourceKind.Drive}
        tableId="storage-array-drives-table"
        name="Storage Array Drives"
        singularName="Drive"
        pluralName="Drives"
        title="Drives"
        description="The flash modules, SSDs and NVRAM modules in this FlashArray, with their raw capacity and the status Purity reports for each."
        noItemsMessage="No drives found in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array."
        columns={[
          StorageArrayResourceColumns.getTextColumn({
            field: "componentType",
            title: "Type",
          }),
          StorageArrayResourceColumns.getStatusColumn({
            title: "Status",
            description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.driveStatusColumn,
          }),
          StorageArrayResourceColumns.getProvisionedColumn({
            title: "Capacity",
            description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.driveCapacityColumn,
          }),
          {
            field: {
              details: true,
            },
            id: "protocol",
            title: "Protocol",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              return textCell(
                StorageArrayResourceUtils.getDetailString(item, "protocol"),
              );
            },
          },
          StorageArrayResourceColumns.getLastSeenColumn(),
        ]}
      />

      <StorageArrayResourceTable
        storageArrayId={modelId}
        kind={StorageArrayResourceKind.Controller}
        tableId="storage-array-controllers-table"
        name="Storage Array Controllers"
        singularName="Controller"
        pluralName="Controllers"
        title="Controllers"
        description="The controllers of this FlashArray: which one is primary, their model, the Purity version they run and their status."
        noItemsMessage="No controllers found in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array."
        columns={[
          {
            field: {
              statusDetail: true,
            },
            title: "Mode",
            headerTooltip:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.controllerModeColumn,
            type: FieldType.Element,
            getElement: (item: StorageArrayResource): ReactElement => {
              return textCell(
                StorageArrayResourceUtils.formatStatusLabel(item.statusDetail),
              );
            },
          },
          StorageArrayResourceColumns.getStatusColumn({
            title: "Status",
            description:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.controllerStatusColumn,
          }),
          StorageArrayResourceColumns.getTextColumn({
            field: "model",
            title: "Model",
          }),
          StorageArrayResourceColumns.getTextColumn({
            field: "firmwareVersion",
            title: "Version",
          }),
          StorageArrayResourceColumns.getTextColumn({
            field: "componentType",
            title: "Type",
            isHiddenByDefault: true,
          }),
          StorageArrayResourceColumns.getLastSeenColumn(),
        ]}
      />

      <StorageArrayResourceTable
        storageArrayId={modelId}
        kind={StorageArrayResourceKind.NetworkInterface}
        tableId="storage-array-network-interfaces-table"
        name="Storage Array Network Interfaces"
        singularName="Network Interface"
        pluralName="Network Interfaces"
        title="Network Interfaces"
        description="The Ethernet and Fibre Channel ports of this FlashArray: whether each is enabled, its speed, the traffic it carries and the errors it sees."
        noItemsMessage="No network interfaces found in the inventory yet. They appear here a few minutes after the Storage Array Agent starts scraping the array."
        columns={[
          StorageArrayResourceColumns.getTextColumn({
            field: "componentType",
            title: "Type",
          }),
          StorageArrayResourceColumns.getStatusColumn({
            title: "Status",
            description:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceStatusColumn,
          }),
          {
            field: {
              details: true,
            },
            id: "speed",
            title: "Speed",
            headerTooltip:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceSpeedColumn,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              const speed: number | null =
                StorageArrayResourceUtils.getDetailNumber(
                  item,
                  "speedBytesPerSec",
                );
              return textCell(
                speed === null || speed <= 0
                  ? ""
                  : StorageArrayResourceUtils.formatBytesPerSec(speed),
              );
            },
          },
          {
            field: {
              details: true,
            },
            id: "traffic",
            title: "Received / Transmitted",
            headerTooltip:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceTrafficColumn,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              const received: number | null =
                StorageArrayResourceUtils.getDetailNumber(
                  item,
                  "receivedBytesPerSec",
                );
              const transmitted: number | null =
                StorageArrayResourceUtils.getDetailNumber(
                  item,
                  "transmittedBytesPerSec",
                );
              if (received === null && transmitted === null) {
                return textCell("");
              }
              return textCell(
                [
                  StorageArrayResourceUtils.formatBytesPerSec(received),
                  StorageArrayResourceUtils.formatBytesPerSec(transmitted),
                ].join(" / "),
              );
            },
          },
          {
            field: {
              details: true,
            },
            id: "errors",
            title: "Errors",
            headerTooltip:
              STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceErrorsColumn,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              const errors: number | null =
                StorageArrayResourceUtils.getDetailNumber(item, "errorsPerSec");
              if (errors === null) {
                return textCell("");
              }
              return (
                <span
                  className={`text-sm ${
                    errors > 0 ? "font-medium text-red-700" : "text-gray-700"
                  }`}
                >
                  {`${errors.toFixed(errors > 0 && errors < 10 ? 2 : 0)}/s`}
                </span>
              );
            },
          },
          {
            field: {
              details: true,
            },
            id: "services",
            title: "Services",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (item: StorageArrayResource): ReactElement => {
              return textCell(
                StorageArrayResourceUtils.getDetailString(item, "services"),
              );
            },
          },
          StorageArrayResourceColumns.getLastSeenColumn(),
        ]}
      />
    </Fragment>
  );
};

export default StorageArrayHardware;
