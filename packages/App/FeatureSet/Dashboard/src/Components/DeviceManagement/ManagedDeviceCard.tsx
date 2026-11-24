import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import ManagedDevice from "Common/Models/DatabaseModels/ManagedDevice";
import Route from "Common/Types/API/Route";
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
import { translationKey } from "Common/Types/Translator";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getManagedDeviceMatchWords,
  getManagedDeviceOperatingSystemLine,
} from "./DeviceManagementWords";
import {
  MANAGED_DEVICE_ALERT_SUBJECT_SELECT,
  ManagedDeviceAlertSubject,
  ManagedDeviceOpenRecords,
  fetchManagedDeviceOpenRecords,
  toManagedDeviceAlertSubject,
} from "./ManagedDeviceAlerts";
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
 *
 * And while its device manager's monitors are alerting on it - it stopped
 * checking in, its battery or its storage, its patch - the card lists those
 * open incidents and alerts, each a link to its page (#10007): a device the
 * Android agent does not report is no Host, so nothing else on its page
 * said so (ManagedDeviceAlerts).
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

// One open incident or alert, as the card lists it.
interface OpenRecordRow {
  id: string;
  title: string;
  number: string;
  severityName: string;
  severityColor: string;
  createdAt: Date | undefined;
  route: Route;
}

function alertRow(alert: Alert): OpenRecordRow {
  return {
    id: alert._id || "",
    title: alert.title || "",
    number: alert.alertNumberWithPrefix || "",
    severityName: alert.alertSeverity?.name || "",
    severityColor: alert.alertSeverity?.color?.toString() || "",
    createdAt: alert.createdAt,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.ALERT_VIEW] as Route,
      { modelId: new ObjectID(alert._id || "") },
    ),
  };
}

function incidentRow(incident: Incident): OpenRecordRow {
  return {
    id: incident._id || "",
    title: incident.title || "",
    number: incident.incidentNumberWithPrefix || "",
    severityName: incident.incidentSeverity?.name || "",
    severityColor: incident.incidentSeverity?.color?.toString() || "",
    createdAt: incident.createdAt,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_VIEW] as Route,
      { modelId: new ObjectID(incident._id || "") },
    ),
  };
}

const ManagedDeviceCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [device, setDevice] = useState<ManagedDevice | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [openRecords, setOpenRecords] =
    useState<ManagedDeviceOpenRecords | null>(null);

  /*
   * What its device manager's monitors are alerting on it with, once the
   * device says its connection and names. Best effort: a failed read lists
   * nothing, as a device with none does, and the rest of the card stands.
   */
  useEffect(() => {
    const subject: ManagedDeviceAlertSubject | null = device
      ? toManagedDeviceAlertSubject(device)
      : null;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!subject || !projectId) {
      setOpenRecords(null);
      return;
    }

    let isCurrent: boolean = true;

    fetchManagedDeviceOpenRecords({ projectId, device: subject })
      .then((records: ManagedDeviceOpenRecords) => {
        if (isCurrent) {
          setOpenRecords(records);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setOpenRecords(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [device]);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    ModelAPI.getItem<ManagedDevice>({
      modelType: ManagedDevice,
      id: props.managedDeviceId,
      select: {
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
        connection: { name: true, config: true, provider: true },
        /*
         * With its name and serial number above, what its readings name it
         * by, and its connection (#10007: MANAGED_DEVICE_ALERT_SUBJECT_SELECT).
         */
        connectionId: MANAGED_DEVICE_ALERT_SUBJECT_SELECT.connectionId,
        providerDeviceId: MANAGED_DEVICE_ALERT_SUBJECT_SELECT.providerDeviceId,
      },
    })
      .then((loaded: ManagedDevice | null) => {
        if (isCurrent) {
          setDevice(loaded);
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

  // One kind of open record: its heading, with how many, and the newest.
  const renderRecords: (data: {
    heading: string;
    count: number;
    rows: Array<OpenRecordRow>;
    severityList: StateListType;
    testId: string;
  }) => ReactElement = (data: {
    heading: string;
    count: number;
    rows: Array<OpenRecordRow>;
    severityList: StateListType;
    testId: string;
  }): ReactElement => {
    return (
      <div data-testid={data.testId}>
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(data.heading)} (
          {translator.formatNumber(data.count)})
        </h3>
        <ul className="mt-1 divide-y divide-gray-100">
          {data.rows.map((row: OpenRecordRow): ReactElement => {
            return (
              <li key={row.id} className="py-2">
                <AppLink
                  to={row.route}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  <IsolatedLine text={row.title} />
                </AppLink>
                <p className="mt-0.5 flex flex-wrap items-center text-xs text-gray-500">
                  {row.severityName ? (
                    <span
                      className="font-medium"
                      style={
                        row.severityColor
                          ? { color: row.severityColor }
                          : undefined
                      }
                    >
                      {translateRecordName(
                        translator,
                        data.severityList,
                        row.severityName,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                  {row.severityName && row.number ? <InlineSeparator /> : <></>}
                  {row.number ? <span>{row.number}</span> : <></>}
                  {row.createdAt && (row.severityName || row.number) ? (
                    <InlineSeparator />
                  ) : (
                    <></>
                  )}
                  {row.createdAt ? (
                    <span>
                      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        row.createdAt,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  /*
   * Its device manager's open incidents and alerts about it, each a link:
   * nothing while there are none, as a quiet device has nothing to say.
   */
  const renderOpenRecords: () => ReactElement = (): ReactElement => {
    if (
      !openRecords ||
      (openRecords.alertCount === 0 && openRecords.incidentCount === 0)
    ) {
      return <></>;
    }

    return (
      <div className="space-y-3" data-testid="managed-device-open-records">
        {openRecords.incidentCount > 0 ? (
          renderRecords({
            heading: translationKey("Active incidents"),
            count: openRecords.incidentCount,
            rows: openRecords.incidents.map(incidentRow),
            severityList: StateListType.IncidentSeverity,
            testId: "managed-device-active-incidents",
          })
        ) : (
          <></>
        )}
        {openRecords.alertCount > 0 ? (
          renderRecords({
            heading: translationKey("Active alerts"),
            count: openRecords.alertCount,
            rows: openRecords.alerts.map(alertRow),
            severityList: StateListType.AlertSeverity,
            testId: "managed-device-active-alerts",
          })
        ) : (
          <></>
        )}
      </div>
    );
  };

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
    const address: string = getDeviceManagementConnectionAddress({
      provider,
      config: readDeviceManagementConfig(device.connection?.config, provider),
    });

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

        {renderOpenRecords()}

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
            {translator.translateTemplate(
              "Imported by the {{provider}} connection {{name}} ({{address}}).",
              { provider: providerTitle, name: connectionName, address },
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
