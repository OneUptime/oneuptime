import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { SnmpTableSnapshot } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import WifiRadioUtil, {
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
} from "Common/Utils/NetworkDevice/WifiRadioUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
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

/*
 * An access point's radios and SSIDs - band, channel, frequency, channel
 * width, transmit power, clients, noise floor, airtime - read from its
 * walked SNMP tables (any table of kind Wi-Fi Radio or SSID, such as the
 * Cambium Enterprise Wi-Fi vendor template's). Frequency is worked out from
 * the band and channel; no vendor reports it.
 */
const NetworkDeviceWiFi: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [snapshots, setSnapshots] = useState<Array<SnmpTableSnapshot>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const device: NetworkDevice | null =
        await ModelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: modelId,
          select: {
            snmpTableSnapshot: true,
          },
        });

      setSnapshots(device?.snmpTableSnapshot || []);
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

  if (!WifiRadioUtil.hasWifiTables(snapshots)) {
    const settingsRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
      { modelId: modelId },
    );

    return (
      <EmptyState
        id="network-device-wifi-empty"
        icon={IconProp.Wifi}
        title="No Wi-Fi radios reported"
        description={
          <TranslatedSentence
            template="Radios and SSIDs appear here once the device walks a Wi-Fi radio table. For Cambium access points, apply the Cambium Enterprise Wi-Fi vendor template (or link an OID Collection Template that includes its tables) in {{settings}}, and make sure SNMP is enabled in the AP Group in cnMaestro."
            slots={{
              settings: (
                <AppLink to={settingsRoute}>
                  {translator.translateText("Settings") || "Settings"}
                </AppLink>
              ),
            }}
          />
        }
      />
    );
  }

  const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

  const radiosOn: number = summary.radios.filter(
    (radio: WifiRadioView): boolean => {
      return radio.isOn !== false;
    },
  ).length;

  const tiles: Array<{ title: string; value: string }> = [
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

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                      {radio.isOn === undefined ? (
                        <span className="text-gray-400">
                          {radio.statusText || "—"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              radio.isOn ? "bg-emerald-500" : "bg-gray-400"
                            }`}
                          ></span>
                          {radio.statusText ||
                            (radio.isOn
                              ? translator.translateText("On")
                              : translator.translateText("Off"))}
                        </span>
                      )}
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
                {summary.ssids.map((ssid: WifiSsidView): ReactElement => {
                  return (
                    <tr key={ssid.name}>
                      <td className="py-2 pr-4 font-medium text-gray-900">
                        {ssid.ssid}
                      </td>
                      <td className="py-2 pr-4">{ssid.bandText || "—"}</td>
                      <td className="py-2 pr-4">
                        {formatNumber(ssid.clients)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <p className="text-xs text-gray-500">
        {translator.translateText(
          "Alert on any of these with a Network Device monitor: SNMP Table Value on the Wi-Fi Radios table (for example TX Power or Clients, with Row set to * for one alert per radio), or SNMP Table Row Is Unhealthy for a radio that switches off.",
        )}
      </p>
    </Fragment>
  );
};

export default NetworkDeviceWiFi;
