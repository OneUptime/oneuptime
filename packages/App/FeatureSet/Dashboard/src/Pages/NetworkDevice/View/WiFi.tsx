import PageComponentProps from "../../PageComponentProps";
import WifiEmptyState from "../../../Components/NetworkDevice/WifiEmptyState";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { SnmpTableSnapshot } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import WifiRadioUtil, {
  WifiAccessPointView,
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
} from "Common/Utils/NetworkDevice/WifiRadioUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

type FormatNumberFunction = (
  value: number | undefined,
  unit?: string | undefined,
) => string;

const formatNumber: FormatNumberFunction = (
  value: number | undefined,
  unit?: string | undefined,
): string => {
  if (value === undefined) {
    return "—";
  }

  return unit ? `${value} ${unit}` : `${value}`;
};

interface StatusDotProps {
  isGood: boolean | undefined;
  text: string | undefined;
  goodText: string;
  badText: string;
}

// A green or grey dot with the status the table reported, or a dash.
const StatusDot: FunctionComponent<StatusDotProps> = (
  props: StatusDotProps,
): ReactElement => {
  if (props.isGood === undefined) {
    return <span className="text-gray-400">{props.text || "—"}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          props.isGood ? "bg-emerald-500" : "bg-gray-400"
        }`}
      ></span>
      {props.text || (props.isGood ? props.goodText : props.badText)}
    </span>
  );
};

/*
 * An access point's radios and SSIDs - band, channel, frequency, channel
 * width, transmit power, clients, noise floor, airtime - and, on a wireless
 * controller, the access points it manages, read from the device's walked
 * SNMP tables (any table of a Wi-Fi kind, which the Wi-Fi vendor templates
 * bring: Cambium, Ubiquiti UniFi, HPE Aruba, Extreme Networks). Frequency is
 * worked out from the band and channel; no vendor reports it.
 */
const NetworkDeviceWiFi: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const item: NetworkDevice | null =
        await ModelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: modelId,
          select: {
            snmpTableSnapshot: true,
            // What the empty state needs to name the device's template.
            snmpTables: true,
            sysObjectId: true,
            sysDescr: true,
            monitoringMethod: true,
            oidTemplateId: true,
          },
        });

      setDevice(item);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchDevice().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const snapshots: Array<SnmpTableSnapshot> = device?.snmpTableSnapshot || [];

  if (!WifiRadioUtil.hasWifiTables(snapshots)) {
    return (
      <WifiEmptyState
        modelId={modelId}
        device={{
          monitoringMethod: device?.monitoringMethod,
          oidTemplateId: device?.oidTemplateId,
          sysObjectId: device?.sysObjectId,
          sysDescr: device?.sysDescr,
          snmpTables: device?.snmpTables,
        }}
      />
    );
  }

  const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

  const radiosOn: number = summary.radios.filter(
    (radio: WifiRadioView): boolean => {
      return radio.isOn !== false;
    },
  ).length;

  const accessPointsUp: number = summary.accessPoints.filter(
    (accessPoint: WifiAccessPointView): boolean => {
      return accessPoint.isUp !== false;
    },
  ).length;

  // Columns no access point fills are left out, not shown as dashes.
  const showAccessPointRadios: boolean = summary.accessPoints.some(
    (accessPoint: WifiAccessPointView): boolean => {
      return accessPoint.radioCount !== undefined;
    },
  );

  const showAccessPointClients: boolean = summary.accessPoints.some(
    (accessPoint: WifiAccessPointView): boolean => {
      return accessPoint.clients !== undefined;
    },
  );

  const tiles: Array<{ title: string; value: string }> = [
    ...(summary.accessPoints.length > 0
      ? [
          {
            title:
              translator.translateText("Access points up") ||
              "Access points up",
            value: `${accessPointsUp} / ${summary.accessPoints.length}`,
          },
        ]
      : []),
    {
      title: translator.translateText("Radios on") || "Radios on",
      value: `${radiosOn} / ${summary.radios.length}`,
    },
    {
      title: translator.translateText("Clients") || "Clients",
      value: formatNumber(summary.totalClients),
    },
    {
      title: translator.translateText("SSIDs") || "SSIDs",
      value: `${summary.ssids.length}`,
    },
  ];

  return (
    <Fragment>
      {summary.failureCause ? (
        <Alert
          type={AlertType.WARNING}
          className="mb-4"
          title={translator.translateTemplate(
            "The last walk of the radio table failed, so these are the values from the walk before it: {{cause}}",
            { cause: summary.failureCause },
          )}
        />
      ) : (
        <></>
      )}

      <div
        className={`mb-5 grid grid-cols-1 gap-4 ${
          tiles.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
        }`}
        data-testid="wifi-tiles"
      >
        {tiles.map((tile: { title: string; value: string }): ReactElement => {
          return (
            <div
              key={tile.title}
              className="rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {tile.title}
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {tile.value}
              </div>
            </div>
          );
        })}
      </div>

      {summary.accessPoints.length > 0 ? (
        <Card
          title="Access Points"
          description="Every access point this controller manages, and whether it is connected."
        >
          <div className="overflow-x-auto" data-testid="wifi-access-points">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  {[
                    translationKey("Access Point"),
                    translationKey("Status"),
                    ...(showAccessPointRadios ? [translationKey("Radios")] : []),
                    ...(showAccessPointClients
                      ? [translationKey("Clients")]
                      : []),
                  ].map((title: string): ReactElement => {
                    return (
                      <th
                        key={title}
                        className="py-2 pr-4 text-left font-medium text-gray-500"
                      >
                        {translator.translateText(title)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.accessPoints.map(
                  (accessPoint: WifiAccessPointView): ReactElement => {
                    return (
                      <tr key={`${accessPoint.index}-${accessPoint.name}`}>
                        <td className="py-2 pr-4 font-medium text-gray-900">
                          {accessPoint.name}
                        </td>
                        <td className="py-2 pr-4">
                          <StatusDot
                            isGood={accessPoint.isUp}
                            text={accessPoint.statusText}
                            goodText={translator.translateText("Up") || "Up"}
                            badText={
                              translator.translateText("Down") || "Down"
                            }
                          />
                        </td>
                        {showAccessPointRadios ? (
                          <td className="py-2 pr-4">
                            {formatNumber(accessPoint.radioCount)}
                          </td>
                        ) : (
                          <></>
                        )}
                        {showAccessPointClients ? (
                          <td className="py-2 pr-4">
                            {formatNumber(accessPoint.clients)}
                          </td>
                        ) : (
                          <></>
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <Card
        title="Radios"
        description={
          summary.collectedAt
            ? translator.translateTemplate(
                "Channel, frequency, width and power of every radio, collected {{time}}.",
                { time: OneUptimeDate.fromNow(new Date(summary.collectedAt)) },
              )
            : translator.translateText(
                "Channel, frequency, width and power of every radio.",
              )
        }
      >
        <div className="overflow-x-auto" data-testid="wifi-radios">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr>
                {[
                  translationKey("Radio"),
                  translationKey("Status"),
                  translationKey("Band"),
                  translationKey("Channel"),
                  translationKey("Frequency"),
                  translationKey("Width"),
                  translationKey("TX Power"),
                  translationKey("Clients"),
                  translationKey("Noise Floor"),
                  translationKey("Airtime"),
                ].map((title: string): ReactElement => {
                  return (
                    <th
                      key={title}
                      className="py-2 pr-4 text-left font-medium text-gray-500"
                    >
                      {translator.translateText(title)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summary.radios.map((radio: WifiRadioView): ReactElement => {
                return (
                  <tr key={`${radio.index}-${radio.name}`}>
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {radio.name}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusDot
                        isGood={radio.isOn}
                        text={radio.statusText}
                        goodText={translator.translateText("On") || "On"}
                        badText={translator.translateText("Off") || "Off"}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      {radio.band || radio.bandText || "—"}
                    </td>
                    <td className="py-2 pr-4">{formatNumber(radio.channel)}</td>
                    <td className="py-2 pr-4">
                      {formatNumber(radio.frequencyMHz, "MHz")}
                    </td>
                    <td className="py-2 pr-4">
                      {formatNumber(radio.channelWidthMHz, "MHz")}
                    </td>
                    <td className="py-2 pr-4">
                      {formatNumber(radio.txPowerDbm, "dBm")}
                    </td>
                    <td className="py-2 pr-4">{formatNumber(radio.clients)}</td>
                    <td className="py-2 pr-4">
                      {formatNumber(radio.noiseFloorDbm, "dBm")}
                    </td>
                    <td className="py-2 pr-4">
                      {formatNumber(radio.utilizationPercent, "%")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {summary.ssids.length > 0 ? (
        <Card
          title="SSIDs"
          description="Every SSID the access point broadcasts, and who is on it."
        >
          <div className="overflow-x-auto" data-testid="wifi-ssids">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  {[
                    translationKey("SSID"),
                    translationKey("Band"),
                    translationKey("Clients"),
                  ].map((title: string): ReactElement => {
                    return (
                      <th
                        key={title}
                        className="py-2 pr-4 text-left font-medium text-gray-500"
                      >
                        {translator.translateText(title)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.ssids.map(
                  (ssid: WifiSsidView, position: number): ReactElement => {
                  return (
                    <tr key={`${position}-${ssid.name}`}>
                      <td className="py-2 pr-4 font-medium text-gray-900">
                        {ssid.ssid}
                      </td>
                      <td className="py-2 pr-4">
                        {ssid.band || ssid.bandText || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {formatNumber(ssid.clients)}
                      </td>
                    </tr>
                  );
                  },
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <p className="text-xs text-gray-500">
        {translator.translateText(
          "Alert on any of these with a Network Device monitor: SNMP Table Value on the Wi-Fi Radios table (for example TX Power or Clients, with Row set to * for one alert per radio), or SNMP Table Row Is Unhealthy for a radio that switches off or an access point that drops off its controller.",
        )}
      </p>
    </Fragment>
  );
};

export default NetworkDeviceWiFi;
