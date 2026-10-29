import PageComponentProps from "../../PageComponentProps";
import WifiEmptyState from "../../../Components/NetworkDevice/WifiEmptyState";
import WifiTablesNotReadState from "../../../Components/NetworkDevice/WifiTablesNotReadState";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import {
  SnmpTableFailureReason,
  SnmpTableSnapshot,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import ObjectID from "Common/Types/ObjectID";
import { FIRST_PROBE_VERSION_WITH_SNMP_TABLES } from "Common/Types/Probe/ProbeCapability";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import WifiRadioUtil, {
  WifiAccessPointView,
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
  WifiTablesState,
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
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
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

// One column of a Wi-Fi table: its title (a translation key), and how a row fills it.
interface WifiColumn<T> {
  title: string;
  hasValue: (row: T) => boolean;
  render: (row: T) => ReactNode;
}

// The columns at least one row fills, in their order.
function visibleColumns<T>(
  rows: Array<T>,
  columns: Array<WifiColumn<T>>,
): Array<WifiColumn<T>> {
  return columns.filter((column: WifiColumn<T>): boolean => {
    return rows.some((row: T): boolean => {
      return column.hasValue(row);
    });
  });
}

// A column of numbers, with a unit after each, and a dash where a row has none.
function numberColumn<T>(
  title: string,
  read: (row: T) => number | undefined,
  unit?: string | undefined,
): WifiColumn<T> {
  return {
    title: title,
    hasValue: (row: T): boolean => {
      return read(row) !== undefined;
    },
    render: (row: T): ReactNode => {
      return formatNumber(read(row), unit);
    },
  };
}

interface WifiTableProps<T> {
  testId: string;
  // The name column's title, a translation key.
  nameTitle: string;
  rows: Array<T>;
  columns: Array<WifiColumn<T>>;
  getKey: (row: T) => string;
  getName: (row: T) => string;
  /*
   * Let a long name wrap. For SSIDs: names people chose, up to 32
   * characters, in a table of two short columns.
   */
  wrapNames?: boolean | undefined;
}

/*
 * A Wi-Fi table: the name first, then the columns. Cells do not wrap, so
 * "5 GHz" never stacks over two lines and a narrow screen scrolls the table
 * sideways - except an SSID, which wraps (at 8rem or wider), so on a phone
 * a long SSID takes two lines and its band and clients stay on screen.
 */
function WifiTable<T>(props: WifiTableProps<T>): ReactElement {
  const translator: Translator = useTranslator();

  const columnTitles: Array<string> = [
    props.nameTitle,
    ...props.columns.map((column: WifiColumn<T>): string => {
      return column.title;
    }),
  ];

  // A column's id: "name" for the name, else its title, a translation key.
  const getColumnId: (index: number) => string = (index: number): string => {
    return index === 0 ? "name" : columnTitles[index] || `column-${index}`;
  };

  /*
   * Its columns as wide as a person makes them (Common's
   * Table/ColumnResize), each table's remembered on its own: a name gives
   * way - an SSID wraps - and a reading never does.
   */
  const wifiColumns: ResizableColumns = useResizableColumns({
    tableKey: `${props.testId}-table`,
    columns: columnTitles.map(
      (_title: string, index: number): { id: string; cellNumber: number } => {
        return { id: getColumnId(index), cellNumber: index + 1 };
      },
    ),
  });

  const nameKind: ColumnWidthKind = props.wrapNames
    ? ColumnWidthKind.Prose
    : ColumnWidthKind.Name;

  return (
    <div className="overflow-x-auto" data-testid={props.testId}>
      {wifiColumns.styles}
      <table
        className={`${wifiColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
        {...wifiColumns.tableAttributes}
      >
        <thead>
          <tr>
            {columnTitles.map((title: string, index: number): ReactElement => {
              const columnTitle: string =
                translator.translateText(title) || title;

              return (
                <ResizableHeaderCell
                  key={title}
                  className="whitespace-nowrap py-2 pr-4 text-left font-medium text-gray-500"
                  resize={wifiColumns.getResize(
                    getColumnId(index),
                    columnTitle,
                    index === 0 ? nameKind : ColumnWidthKind.Whole,
                  )}
                >
                  <span>{columnTitle}</span>
                </ResizableHeaderCell>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {props.rows.map((row: T, position: number): ReactElement => {
            return (
              <tr key={`${position}-${props.getKey(row)}`}>
                <td
                  className={`py-2 pr-4 font-medium text-gray-900 ${
                    props.wrapNames
                      ? "min-w-[8rem] [overflow-wrap:anywhere]"
                      : "whitespace-nowrap"
                  }`}
                >
                  {props.getName(row)}
                </td>
                {props.columns.map((column: WifiColumn<T>): ReactElement => {
                  return (
                    <td
                      key={column.title}
                      className="whitespace-nowrap py-2 pr-4"
                    >
                      {column.render(row)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
      const item: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
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
          // Who to name when the probe cannot walk the tables.
          probe: {
            _id: true,
            name: true,
          },
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

  const tablesState: WifiTablesState = WifiRadioUtil.getTablesState(summary);

  /*
   * Polled, and nothing to list: say why rather than draw tiles of zeros
   * over an empty table.
   */
  if (tablesState !== WifiTablesState.HasRows) {
    return (
      <WifiTablesNotReadState
        modelId={modelId}
        state={tablesState}
        failureCause={summary.failureCause}
        probeName={device?.probe?.name || undefined}
      />
    );
  }

  const accessPointsUp: number = summary.accessPoints.filter(
    (accessPoint: WifiAccessPointView): boolean => {
      return accessPoint.isUp !== false;
    },
  ).length;

  /*
   * "Radios on" only when the radios say whether they are on: a vendor
   * that reports no radio status (UniFi, IQ Engine) gets a plain count,
   * not a claim that every radio is on.
   */
  const radiosReportStatus: boolean = summary.radios.some(
    (radio: WifiRadioView): boolean => {
      return radio.isOn !== undefined;
    },
  );

  const radiosOn: number = summary.radios.filter(
    (radio: WifiRadioView): boolean => {
      return radio.isOn !== false;
    },
  ).length;

  /*
   * The SSIDs card lists the SSIDs or, as the Radios card does, says the
   * device has none, by what its last walk read in full: an access point
   * whose only networks are its own (UniFi's mesh link and adoption
   * network) broadcasts no SSID, and a walk that found no row reported none.
   * A table whose last walk failed or was cut short says nothing here; the
   * SNMP Tables page says why.
   */
  const ownNetworksOnly: boolean = Boolean(summary.ownNetworksOnly);

  const showsSsidsCard: boolean =
    summary.ssids.length > 0 ||
    ownNetworksOnly ||
    WifiRadioUtil.hasReadSsidTable(snapshots);

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
    radiosReportStatus
      ? {
          title: translator.translateText("Radios on") || "Radios on",
          value: `${radiosOn} / ${summary.radios.length}`,
        }
      : {
          title: translator.translateText("Radios") || "Radios",
          value: `${summary.radios.length}`,
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

  /*
   * Each table's columns, every one but the name left out when no row
   * fills it: vendors report different things, and a column of dashes
   * says nothing. The names are translationKey()s, looked up as rendered.
   */
  const accessPointColumns: Array<WifiColumn<WifiAccessPointView>> =
    visibleColumns(summary.accessPoints, [
      {
        title: translationKey("Status"),
        hasValue: (accessPoint: WifiAccessPointView): boolean => {
          return (
            accessPoint.isUp !== undefined ||
            accessPoint.statusText !== undefined
          );
        },
        render: (accessPoint: WifiAccessPointView): ReactNode => {
          return (
            <StatusDot
              isGood={accessPoint.isUp}
              text={accessPoint.statusText}
              goodText={translator.translateText("Up") || "Up"}
              badText={translator.translateText("Down") || "Down"}
            />
          );
        },
      },
      {
        title: translationKey("Radios"),
        hasValue: (accessPoint: WifiAccessPointView): boolean => {
          return accessPoint.radioCount !== undefined;
        },
        render: (accessPoint: WifiAccessPointView): ReactNode => {
          return formatNumber(accessPoint.radioCount);
        },
      },
      {
        title: translationKey("Clients"),
        hasValue: (accessPoint: WifiAccessPointView): boolean => {
          return accessPoint.clients !== undefined;
        },
        render: (accessPoint: WifiAccessPointView): ReactNode => {
          return formatNumber(accessPoint.clients);
        },
      },
    ]);

  const radioColumns: Array<WifiColumn<WifiRadioView>> = visibleColumns(
    summary.radios,
    [
      {
        title: translationKey("Status"),
        hasValue: (radio: WifiRadioView): boolean => {
          return radio.isOn !== undefined || radio.statusText !== undefined;
        },
        render: (radio: WifiRadioView): ReactNode => {
          return (
            <StatusDot
              isGood={radio.isOn}
              text={radio.statusText}
              goodText={translator.translateText("On") || "On"}
              badText={translator.translateText("Off") || "Off"}
            />
          );
        },
      },
      {
        title: translationKey("Band"),
        hasValue: (radio: WifiRadioView): boolean => {
          return Boolean(radio.band || radio.bandText);
        },
        render: (radio: WifiRadioView): ReactNode => {
          return radio.band || radio.bandText || "—";
        },
      },
      numberColumn(translationKey("Channel"), (radio: WifiRadioView) => {
        return radio.channel;
      }),
      numberColumn(
        translationKey("Frequency"),
        (radio: WifiRadioView) => {
          return radio.frequencyMHz;
        },
        "MHz",
      ),
      numberColumn(
        translationKey("Width"),
        (radio: WifiRadioView) => {
          return radio.channelWidthMHz;
        },
        "MHz",
      ),
      numberColumn(
        translationKey("TX Power"),
        (radio: WifiRadioView) => {
          return radio.txPowerDbm;
        },
        "dBm",
      ),
      numberColumn(translationKey("Clients"), (radio: WifiRadioView) => {
        return radio.clients;
      }),
      numberColumn(
        translationKey("Noise Floor"),
        (radio: WifiRadioView) => {
          return radio.noiseFloorDbm;
        },
        "dBm",
      ),
      numberColumn(
        translationKey("Airtime"),
        (radio: WifiRadioView) => {
          return radio.utilizationPercent;
        },
        "%",
      ),
    ],
  );

  const ssidColumns: Array<WifiColumn<WifiSsidView>> = visibleColumns(
    summary.ssids,
    [
      {
        title: translationKey("Band"),
        hasValue: (ssid: WifiSsidView): boolean => {
          return Boolean(ssid.band || ssid.bandText);
        },
        render: (ssid: WifiSsidView): ReactNode => {
          return ssid.band || ssid.bandText || "—";
        },
      },
      numberColumn(translationKey("Clients"), (ssid: WifiSsidView) => {
        return ssid.clients;
      }),
    ],
  );

  return (
    <Fragment>
      {summary.failureReason ===
      SnmpTableFailureReason.ProbeDidNotWalkTables ? (
        <Alert
          type={AlertType.WARNING}
          className="mb-4"
          dataTestId="wifi-not-walked-by-probe"
          title={translator.translateTemplate(
            "The probe that polls this device answered its last poll without walking its Wi-Fi tables, so these are the values from the last walk that read them. Probes released before version {{version}} do not walk SNMP tables: update the probe to the latest version.",
            { version: FIRST_PROBE_VERSION_WITH_SNMP_TABLES },
          )}
        />
      ) : summary.failureCause ? (
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

      {/*
       * Small tiles, side by side on a phone too - three in a row, or two by
       * two with the access points - so the lists start on the first screen.
       * A title that does not fit wraps, and the values stay level.
       */}
      <div
        className={`mb-5 grid gap-3 sm:gap-4 ${
          tiles.length > 3 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"
        }`}
        data-testid="wifi-tiles"
      >
        {tiles.map((tile: { title: string; value: string }): ReactElement => {
          return (
            <div
              key={tile.title}
              className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white px-3 py-3 sm:px-4"
            >
              <div className="break-words text-xs font-medium uppercase tracking-wide text-gray-500">
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
          <WifiTable
            testId="wifi-access-points"
            nameTitle={translationKey("Access Point")}
            rows={summary.accessPoints}
            columns={accessPointColumns}
            getKey={(accessPoint: WifiAccessPointView): string => {
              return `${accessPoint.index}-${accessPoint.name}`;
            }}
            getName={(accessPoint: WifiAccessPointView): string => {
              return accessPoint.name;
            }}
          />
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
        {summary.radios.length > 0 ? (
          <WifiTable
            testId="wifi-radios"
            nameTitle={translationKey("Radio")}
            rows={summary.radios}
            columns={radioColumns}
            getKey={(radio: WifiRadioView): string => {
              return `${radio.index}-${radio.name}`;
            }}
            getName={(radio: WifiRadioView): string => {
              return radio.name;
            }}
          />
        ) : (
          <p className="text-sm text-gray-500" data-testid="wifi-no-radios">
            {translator.translateText(
              "The device reported no radios on its last walk.",
            )}
          </p>
        )}
      </Card>

      {showsSsidsCard ? (
        <Card
          title="SSIDs"
          description={
            summary.accessPoints.length > 0
              ? "Every SSID its access points broadcast, and who is on it."
              : "Every SSID the access point broadcasts, and who is on it."
          }
        >
          {summary.ssids.length > 0 ? (
            <WifiTable
              testId="wifi-ssids"
              nameTitle={translationKey("SSID")}
              rows={summary.ssids}
              columns={ssidColumns}
              wrapNames={true}
              getKey={(ssid: WifiSsidView): string => {
                return ssid.name;
              }}
              getName={(ssid: WifiSsidView): string => {
                return ssid.ssid;
              }}
            />
          ) : (
            <p className="text-sm text-gray-500" data-testid="wifi-no-ssids">
              {ownNetworksOnly
                ? translator.translateText(
                    "The device reports no SSIDs. Networks it runs for itself, such as a wireless mesh link, are not listed.",
                  )
                : translator.translateText(
                    "The device reported no SSIDs on its last walk.",
                  )}
            </p>
          )}
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
