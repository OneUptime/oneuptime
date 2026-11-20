import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import ManagedDevice from "Common/Models/DatabaseModels/ManagedDevice";
import Select from "Common/Types/BaseDatabase/Select";
import OneUptimeDate from "Common/Types/Date";
import {
  getDeviceManagementConnectionAddress,
  readDeviceManagementConfig,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import DeviceManagementProvider, {
  getDeviceManagementProviderTitle,
  readDeviceManagementProvider,
} from "Common/Types/DeviceManagement/DeviceManagementProvider";
import { isManagedDeviceHostMatch } from "Common/Types/DeviceManagement/ManagedDeviceIdentity";
import {
  ManagedDevicePlatform,
  readManagedDevicePlatform,
} from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
import {
  getManagedDeviceMatchWords,
  getManagedDeviceOperatingSystemLine,
} from "./DeviceManagementWords";
import ManagedDeviceStatusPill from "./ManagedDeviceStatusPill";

/*
 * What its device manager - Esper, Microsoft Intune (#9837) - knows about a
 * device, on the device's Inventory page: whether it is there (online, or
 * offline and since when), its group, its operating system, build and
 * security patch, its serial number and IMEI, its battery and storage, an
 * Esper device's Esper agent, and whether its apps or agent send telemetry
 * under its name. Read from the device's own row (ManagedDevice), current
 * to its connection's last read.
 *
 * A device that left its device manager says so, and when: its item is
 * archived, and goes 30 days after it left.
 */

export interface ComponentProps {
  managedDeviceId: ObjectID;
}

interface Fact {
  label: string;
  value: ReactNode;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * An amount with the unit Esper reports it in ("64 GB"), joined by a
 * no-break space so a narrow card never leaves the unit alone on a line.
 */
function withUnit(amount: string, unit: string): string {
  return unit ? `${amount}\u00A0${unit}` : amount;
}

/*
 * What the card reads of the device, and of the connection that imports it
 * through its relation: the connection's name and service, which a relation
 * reads (canReadOnRelationQuery). Its settings are not - the server refused
 * the whole read for them, and the card said "Column config on Device
 * Management Connection does not support read on relation query." on every
 * device - so they are read from the connection itself
 * (readConnectionSettings).
 */
export const MANAGED_DEVICE_CARD_SELECT: Select<ManagedDevice> = {
  deviceName: true,
  alias: true,
  serialNumber: true,
  imei: true,
  manufacturer: true,
  model: true,
  platform: true,
  osVersion: true,
  buildNumber: true,
  securityPatchLevel: true,
  agentVersion: true,
  providerState: true,
  lastCheckInAt: true,
  groupName: true,
  groupPath: true,
  isKioskMode: true,
  batteryLevel: true,
  details: true,
  provisionedAt: true,
  removedAt: true,
  appCount: true,
  inventoryMatch: true,
  connectionId: true,
  connection: { name: true, provider: true },
};

// What the card reads of the connection itself: its settings say its address.
export const MANAGED_DEVICE_CONNECTION_SELECT: Select<DeviceManagementConnection> =
  {
    _id: true,
    config: true,
  };

/*
 * The settings of the connection that imports a device, read from the
 * connection by its own read permissions; null when there is none, or they
 * cannot be read - the card then names the connection without its address.
 */
export async function readConnectionSettings(
  connectionId: ObjectID | undefined,
): Promise<JSONObject | null> {
  if (!connectionId) {
    return null;
  }

  try {
    const connection: DeviceManagementConnection | null =
      await ModelAPI.getItem<DeviceManagementConnection>({
        modelType: DeviceManagementConnection,
        id: connectionId,
        select: MANAGED_DEVICE_CONNECTION_SELECT,
      });

    return connection?.config && typeof connection.config === "object"
      ? (connection.config as JSONObject)
      : null;
  } catch {
    return null;
  }
}

const ManagedDeviceCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [device, setDevice] = useState<ManagedDevice | null>(null);
  const [connectionSettings, setConnectionSettings] =
    useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    ModelAPI.getItem<ManagedDevice>({
      modelType: ManagedDevice,
      id: props.managedDeviceId,
      select: MANAGED_DEVICE_CARD_SELECT,
    })
      .then(async (loaded: ManagedDevice | null) => {
        const settings: JSONObject | null = loaded
          ? await readConnectionSettings(loaded.connectionId)
          : null;

        if (isCurrent) {
          setDevice(loaded);
          setConnectionSettings(settings);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.managedDeviceId.toString()]);

  const now: Date = OneUptimeDate.getCurrentDate();

  const body: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <DetailListSkeleton fields={8} columns={3} />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!device) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "This device is no longer imported from its device manager.",
          )}
        </p>
      );
    }

    const details: JSONObject =
      device.details && typeof device.details === "object"
        ? (device.details as JSONObject)
        : {};
    const units: string = text(details["memoryUnits"]);
    const totalStorage: string = text(details["totalStorage"]);
    const totalRam: string = text(details["totalRam"]);
    const provider: DeviceManagementProvider = readDeviceManagementProvider(
      device.connection?.provider,
    );
    const isEsper: boolean = provider === DeviceManagementProvider.Esper;
    const matchWords: string | undefined = getManagedDeviceMatchWords(
      isManagedDeviceHostMatch(device.inventoryMatch)
        ? device.inventoryMatch
        : undefined,
      provider,
    );
    const hasAgentVersion: boolean = Boolean(device.agentVersion);
    const isAndroid: boolean =
      readManagedDevicePlatform(device.platform) ===
      ManagedDevicePlatform.Android;
    const operatingSystem: string = getManagedDeviceOperatingSystemLine(device);

    const facts: Array<Fact> = [
      {
        label: "Last Check-In",
        value: device.lastCheckInAt
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              device.lastCheckInAt,
            )
          : undefined,
      },
      {
        // Esper names a device itself, beside the alias people give it.
        label: isEsper ? "Esper Name" : "Device Name",
        value: text(device.deviceName) ? (
          <IsolatedLine text={text(device.deviceName)} />
        ) : undefined,
      },
      {
        label: "Group",
        value:
          text(device.groupPath) || text(device.groupName) ? (
            <IsolatedLine
              text={text(device.groupPath) || text(device.groupName)}
            />
          ) : undefined,
      },
      {
        label: "Operating System",
        value: operatingSystem ? (
          <IsolatedLine text={operatingSystem} />
        ) : undefined,
      },
      {
        label: "Build Number",
        value: text(device.buildNumber) || undefined,
      },
      // Android's alone.
      ...(isAndroid
        ? [
            {
              label: "Security Patch Level",
              value: text(device.securityPatchLevel) || undefined,
            },
          ]
        : []),
      {
        label: "Serial Number",
        value: text(device.serialNumber) || undefined,
      },
      { label: "IMEI", value: text(device.imei) || undefined },
      {
        label: "Model (hardware model)",
        value:
          [text(device.manufacturer), text(device.model)]
            .filter(Boolean)
            .join(" ") || undefined,
      },
      {
        label: "Battery",
        value:
          typeof device.batteryLevel === "number"
            ? translator.translateTemplate("{{percent}}%", {
                percent: translator.formatNumber(device.batteryLevel),
              })
            : undefined,
      },
      {
        label: "Storage",
        value: totalStorage ? withUnit(totalStorage, units) : undefined,
      },
      {
        label: "Memory",
        value: totalRam ? withUnit(totalRam, units) : undefined,
      },
      {
        label: "Kiosk Mode",
        value:
          device.isKioskMode === true
            ? translator.translateText("On")
            : device.isKioskMode === false
              ? translator.translateText("Off")
              : undefined,
      },
      // The Esper agent runs on an Esper Android device: an Apple device has none.
      ...(isEsper && isAndroid
        ? [
            {
              label: "Esper Agent",
              /*
               * Drawn as every agent version is (AgentVersion): Esper
               * releases and updates its agent, so it is never called
               * outdated.
               */
              value: hasAgentVersion ? (
                <AgentVersion
                  kind={AgentKind.EsperAgent}
                  version={device.agentVersion}
                />
              ) : undefined,
            },
          ]
        : []),
      {
        label: "Enrolled",
        value: device.provisionedAt
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              device.provisionedAt,
            )
          : undefined,
      },
      {
        label: "Telemetry",
        value: matchWords ? translator.translateText(matchWords) : undefined,
      },
    ];

    const connectionName: string = text(device.connection?.name);
    const providerTitle: string = getDeviceManagementProviderTitle(provider);
    const address: string = connectionSettings
      ? getDeviceManagementConnectionAddress({
          provider,
          config: readDeviceManagementConfig(connectionSettings, provider),
        })
      : "";

    return (
      <div className="space-y-4">
        <ManagedDeviceStatusPill
          providerState={device.providerState}
          lastCheckInAt={device.lastCheckInAt}
          removedAt={device.removedAt}
          provider={device.connection?.provider}
          platform={device.platform}
          now={now}
          showAge={true}
        />

        {device.removedAt ? (
          <p
            className="text-sm text-gray-700"
            data-testid="managed-device-removed"
          >
            {translator.translateTemplate(
              "Removed from {{provider}} {{time}}. Its item is archived, and goes 30 days after the device left.",
              {
                provider: providerTitle,
                time: OneUptimeDate.fromNow(device.removedAt),
              },
            )}
          </p>
        ) : (
          <></>
        )}

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact: Fact): ReactElement => {
            return (
              <div key={fact.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText(fact.label)}
                </dt>
                <dd className="mt-1 break-words text-sm text-gray-900">
                  {fact.value === undefined ? <EmptyValue /> : fact.value}
                </dd>
              </div>
            );
          })}
        </dl>

        {connectionName ? (
          <p className="text-xs text-gray-500">
            {address
              ? translator.translateTemplate(
                  "Imported by the {{provider}} connection {{name}} ({{address}}).",
                  { provider: providerTitle, name: connectionName, address },
                )
              : translator.translateTemplate(
                  "Imported by the {{provider}} connection {{name}}.",
                  { provider: providerTitle, name: connectionName },
                )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  // The service's name once the device says which; a product name.
  const loadedProvider: DeviceManagementProvider | undefined = device
    ? readDeviceManagementProvider(device.connection?.provider)
    : undefined;

  return (
    <Card
      title={
        loadedProvider
          ? getDeviceManagementProviderTitle(loadedProvider)
          : "Device Manager"
      }
      description={
        loadedProvider
          ? translator.translateTemplate(
              "What {{provider}}, the device management service that enrolls this device, knows about it.",
              { provider: getDeviceManagementProviderTitle(loadedProvider) },
            )
          : "What the device management service that enrolls this device knows about it."
      }
    >
      {body()}
    </Card>
  );
};

export default ManagedDeviceCard;
