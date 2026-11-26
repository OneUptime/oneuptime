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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayHardwareTable } from "Common/Types/StorageArray/StorageArrayPlatform";
import Columns from "Common/UI/Components/ModelTable/Columns";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * The array's hardware, one table per kind of part its platform reports
 * (StorageArrayPlatform.hardwareTables, which also says what each lists in
 * the platform's words), each with a status pill coloured from the
 * unhealthy status lists (StorageArrayResourceUtils):
 *
 *   - a FlashArray: chassis, controllers' bays, power supplies, fans,
 *     sensors and ports (kind=Hardware), drives and NVRAM modules
 *     (kind=Drive), controllers (kind=Controller) and network interfaces
 *     (kind=NetworkInterface);
 *   - a FlashBlade: blades, fabric modules, power supplies and fans
 *     (kind=Hardware), laid out by slot and health.
 *
 * The columns are this page's, by kind: a kind it has no columns for (one
 * a platform declares for itself) gets its type, status and model.
 */

function textCell(text: string): ReactElement {
  if (!text) {
    return <TableEmptyValue />;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}

const HARDWARE_COMPONENT_COLUMNS: Columns<StorageArrayResource> = [
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
    headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hardwareTemperatureColumn,
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
];

const DRIVE_COLUMNS: Columns<StorageArrayResource> = [
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
];

const CONTROLLER_COLUMNS: Columns<StorageArrayResource> = [
  {
    field: {
      statusDetail: true,
    },
    title: "Mode",
    headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.controllerModeColumn,
    type: FieldType.Element,
    getElement: (item: StorageArrayResource): ReactElement => {
      return textCell(
        StorageArrayResourceUtils.formatStatusLabel(item.statusDetail),
      );
    },
  },
  StorageArrayResourceColumns.getStatusColumn({
    title: "Status",
    description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.controllerStatusColumn,
  }),
  StorageArrayResourceColumns.getTextColumn({
    field: "model",
    title: "Model (hardware model)",
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
];

const NETWORK_INTERFACE_COLUMNS: Columns<StorageArrayResource> = [
  StorageArrayResourceColumns.getTextColumn({
    field: "componentType",
    title: "Type",
  }),
  StorageArrayResourceColumns.getStatusColumn({
    title: "Status",
    description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceStatusColumn,
  }),
  {
    field: {
      details: true,
    },
    id: "speed",
    title: "Speed",
    headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceSpeedColumn,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: true,
    getElement: (item: StorageArrayResource): ReactElement => {
      const speed: number | null = StorageArrayResourceUtils.getDetailNumber(
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
    headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceTrafficColumn,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: true,
    getElement: (item: StorageArrayResource): ReactElement => {
      const received: number | null = StorageArrayResourceUtils.getDetailNumber(
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
        StorageArrayResourceUtils.joinFiguresOfACell([
          StorageArrayResourceUtils.formatBytesPerSec(received),
          StorageArrayResourceUtils.formatBytesPerSec(transmitted),
        ]),
      );
    },
  },
  {
    field: {
      details: true,
    },
    id: "errors",
    title: "Errors",
    headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.interfaceErrorsColumn,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: true,
    getElement: (item: StorageArrayResource): ReactElement => {
      const errors: number | null = StorageArrayResourceUtils.getDetailNumber(
        item,
        "errorsPerSec",
      );
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
];

interface HardwareTableWords {
  name: string;
  singularName: string;
  pluralName: string;
}

// A kind's table words: the shared kinds' here, a platform's own from it.
const HARDWARE_TABLE_WORDS: Record<string, HardwareTableWords> = {
  [StorageArrayResourceKind.Hardware]: {
    name: "Storage Array Hardware Components",
    singularName: "Hardware Component",
    pluralName: "Hardware Components",
  },
  [StorageArrayResourceKind.Drive]: {
    name: "Storage Array Drives",
    singularName: "Drive",
    pluralName: "Drives",
  },
  [StorageArrayResourceKind.Controller]: {
    name: "Storage Array Controllers",
    singularName: "Controller",
    pluralName: "Controllers",
  },
  [StorageArrayResourceKind.NetworkInterface]: {
    name: "Storage Array Network Interfaces",
    singularName: "Network Interface",
    pluralName: "Network Interfaces",
  },
};

function getHardwareTableWords(kind: string): HardwareTableWords {
  if (Object.prototype.hasOwnProperty.call(HARDWARE_TABLE_WORDS, kind)) {
    return HARDWARE_TABLE_WORDS[kind]!;
  }
  const pluralName: string = StorageArrayResourceKindUtil.getPluralLabel(kind);
  return {
    name: pluralName,
    singularName: StorageArrayResourceKindUtil.getSingularLabel(kind),
    pluralName: pluralName,
  };
}

function getHardwareColumns(
  table: StorageArrayHardwareTable,
): Columns<StorageArrayResource> {
  if (
    table.kind === StorageArrayResourceKind.Hardware &&
    table.layout === "slot-and-health"
  ) {
    return [
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
    ];
  }

  switch (table.kind) {
    case StorageArrayResourceKind.Hardware:
      return HARDWARE_COMPONENT_COLUMNS;
    case StorageArrayResourceKind.Drive:
      return DRIVE_COLUMNS;
    case StorageArrayResourceKind.Controller:
      return CONTROLLER_COLUMNS;
    case StorageArrayResourceKind.NetworkInterface:
      return NETWORK_INTERFACE_COLUMNS;
    default:
      return [
        StorageArrayResourceColumns.getTextColumn({
          field: "componentType",
          title: "Type",
        }),
        StorageArrayResourceColumns.getStatusColumn({
          title: "Status",
        }),
        StorageArrayResourceColumns.getTextColumn({
          field: "model",
          title: "Model (hardware model)",
        }),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ];
  }
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
    return <PageSkeleton shape="table" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray) {
    return <ErrorMessage message="Storage array not found." />;
  }

  const tables: ReadonlyArray<StorageArrayHardwareTable> =
    StorageArrayPlatformRegistry.getPlatformOrDefault(
      storageArray.storageSystem,
    ).hardwareTables;

  return (
    <Fragment>
      {tables.map((table: StorageArrayHardwareTable): ReactElement => {
        const words: HardwareTableWords = getHardwareTableWords(table.kind);
        return (
          <StorageArrayResourceTable
            key={table.tableId}
            storageArrayId={modelId}
            kind={table.kind as StorageArrayResourceKind}
            tableId={table.tableId}
            name={words.name}
            singularName={words.singularName}
            pluralName={words.pluralName}
            title={words.pluralName}
            description={table.description}
            noItemsMessage={table.noItemsMessage}
            columns={getHardwareColumns(table)}
          />
        );
      })}
    </Fragment>
  );
};

export default StorageArrayHardware;
