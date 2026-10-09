import TransceiverRxSparkline from "./TransceiverRxSparkline";
import {
  RxTrendView,
  SummaryChip,
  TRANSCEIVER_READING_COLUMN_TITLES,
  TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE,
  TRANSCEIVER_ROWS_SHOWN,
  TRANSCEIVER_SOURCE_LABELS,
  TRANSCEIVER_TABLE_READINGS,
  ThresholdBarLayout,
  ThresholdItem,
  TransceiverStatusView,
  TransceiverTone,
  formatReadingValue,
  getCrossingLabel,
  getLaneCount,
  getLastReadAt,
  getRxTrendView,
  getStatusView,
  getSummaryChips,
  getThresholdBarLayout,
  getThresholdItems,
  getToneForLevel,
  isNoLight,
  pickDisplayVerdict,
} from "./TransceiverViewModel";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import {
  NetworkDeviceTransceiver,
  TRANSCEIVER_READING_KINDS,
  TransceiverFault,
  TransceiverHealth,
  TransceiverMeasurement,
  TransceiverReading,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "Common/Types/ObjectID";
import TransceiverHealthUtil, {
  TRANSCEIVER_RX_BASELINE_DAYS,
  TransceiverHealthSummary,
  TransceiverReadingVerdict,
} from "Common/Utils/NetworkDevice/TransceiverHealthUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

// A day of the trend ("2026-09-13") as the reader's locale writes a date.
function formatDay(day: string | undefined): string {
  if (!day) {
    return "";
  }

  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    `${day}T12:00:00.000Z`,
    true,
  );
}

const PILL_CLASSES: Record<TransceiverTone, string> = {
  [TransceiverTone.Critical]: "bg-red-50 text-red-700",
  [TransceiverTone.Warning]: "bg-amber-50 text-amber-700",
  [TransceiverTone.Healthy]: "bg-emerald-50 text-emerald-700",
  [TransceiverTone.Neutral]: "bg-gray-100 text-gray-700",
};

const DOT_CLASSES: Record<TransceiverTone, string> = {
  [TransceiverTone.Critical]: "bg-red-500",
  [TransceiverTone.Warning]: "bg-amber-500",
  [TransceiverTone.Healthy]: "bg-emerald-500",
  [TransceiverTone.Neutral]: "bg-gray-300",
};

const VALUE_CLASSES: Record<TransceiverTone, string> = {
  [TransceiverTone.Critical]: "text-red-700 font-semibold",
  [TransceiverTone.Warning]: "text-amber-700 font-semibold",
  [TransceiverTone.Healthy]: "text-gray-900",
  [TransceiverTone.Neutral]: "text-gray-900",
};

const BAR_SEGMENT_CLASSES: Record<TransceiverTone, string> = {
  [TransceiverTone.Critical]: "bg-red-500",
  [TransceiverTone.Warning]: "bg-amber-500",
  [TransceiverTone.Healthy]: "bg-emerald-500",
  [TransceiverTone.Neutral]: "bg-gray-300",
};

/*
 * The optics in a device's ports, on its Interfaces page: one row per SFP,
 * SFP+ or QSFP, problems first, with the five DOM readings against the
 * device's own warning and alarm thresholds and a month of received power
 * beside the RX value. A row opens the full picture - every lane, every
 * threshold, the trend and who made the optic.
 *
 * Shown only for a device that reports transceivers. A switch with copper
 * ports only, or one whose agent does not report optics over SNMP, keeps the
 * page as it was; the docs say which MIBs are read.
 */
const TransceiverHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [transceivers, setTransceivers] =
    useState<Array<NetworkDeviceTransceiver> | null>(null);
  const [error, setError] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchTransceivers: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const device: NetworkDevice | null =
        await ModelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: props.networkDeviceId,
          select: {
            transceiverSnapshot: true,
          },
        });

      setTransceivers(
        Array.isArray(device?.transceiverSnapshot)
          ? device!.transceiverSnapshot
          : [],
      );
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    fetchTransceivers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.networkDeviceId.toString()]);

  if (error) {
    return (
      <Card
        title="Transceivers"
        description="SFP, SFP+ and QSFP optics in this device's ports."
      >
        <p className="text-sm text-red-700" data-testid="transceiver-error">
          {error}
        </p>
      </Card>
    );
  }

  if (!transceivers || transceivers.length === 0) {
    return <></>;
  }

  const sorted: Array<NetworkDeviceTransceiver> =
    TransceiverHealthUtil.sortForDisplay(transceivers);
  const visible: Array<NetworkDeviceTransceiver> = showAll
    ? sorted
    : sorted.slice(0, TRANSCEIVER_ROWS_SHOWN);
  const summary: TransceiverHealthSummary =
    TransceiverHealthUtil.summarize(transceivers);
  const lastReadAt: Date | undefined = getLastReadAt(transceivers);
  const selected: NetworkDeviceTransceiver | undefined =
    selectedIndex === null
      ? undefined
      : transceivers.find((transceiver: NetworkDeviceTransceiver) => {
          return transceiver.interfaceIndex === selectedIndex;
        });

  const description: string = lastReadAt
    ? translator.translateTemplate(
        "SFP, SFP+ and QSFP optics in this device's ports, against the warning and alarm thresholds the device reports. Last read {{time}}.",
        { time: OneUptimeDate.fromNow(lastReadAt) },
      )
    : translator.translateText(
        "SFP, SFP+ and QSFP optics in this device's ports, against the warning and alarm thresholds the device reports.",
      ) || "";

  return (
    <Fragment>
      <div className="mb-5" data-testid="transceiver-card">
        <Card
          title="Transceivers"
          description={description}
          rightElement={
            <div
              className="flex flex-wrap items-center justify-end gap-2"
              data-testid="transceiver-summary"
            >
              {getSummaryChips(summary).map(
                (chip: SummaryChip): ReactElement => {
                  return (
                    <span
                      key={chip.template.other}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL_CLASSES[chip.tone]}`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASSES[chip.tone]}`}
                      ></span>
                      {translator.translatePlural(chip.template, chip.count)}
                    </span>
                  );
                },
              )}
            </div>
          }
        >
          {/*
           * A phone gets a list - port, status, optic and the readings that
           * matter in a few lines - rather than a table to scroll sideways
           * past the received power.
           */}
          <ul
            className="-my-1 divide-y divide-gray-100 md:hidden"
            data-testid="transceiver-list"
          >
            {visible.map(
              (transceiver: NetworkDeviceTransceiver): ReactElement => {
                return (
                  <TransceiverListItem
                    key={transceiver.interfaceIndex}
                    transceiver={transceiver}
                    onOpen={() => {
                      setSelectedIndex(transceiver.interfaceIndex);
                    }}
                  />
                );
              },
            )}
          </ul>
          <div
            className="-mx-1 max-md:hidden overflow-x-auto md:block"
            data-testid="transceiver-table"
          >
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr>
                  <th className="py-2 pl-1 pr-4 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    {translator.translateText("Port")}
                  </th>
                  <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    {translator.translateText("Optic")}
                  </th>
                  <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    {translator.translateText("Status")}
                  </th>
                  {TRANSCEIVER_TABLE_READINGS.map(
                    (kind: TransceiverReadingKind): ReactElement => {
                      return (
                        <th
                          key={kind}
                          className={`py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-gray-500 ${
                            TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE.includes(kind)
                              ? "max-md:hidden md:table-cell"
                              : ""
                          }`}
                        >
                          {translator.translateText(
                            TRANSCEIVER_READING_COLUMN_TITLES[kind],
                          )}
                        </th>
                      );
                    },
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(
                  (transceiver: NetworkDeviceTransceiver): ReactElement => {
                    return (
                      <TransceiverRow
                        key={transceiver.interfaceIndex}
                        transceiver={transceiver}
                        onOpen={() => {
                          setSelectedIndex(transceiver.interfaceIndex);
                        }}
                      />
                    );
                  },
                )}
              </tbody>
            </table>
          </div>

          {sorted.length > TRANSCEIVER_ROWS_SHOWN ? (
            <div className="mt-3 flex justify-center">
              <Button
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                title={
                  showAll
                    ? translator.translateText("Show fewer")
                    : translator.translatePlural(
                        {
                          one: "Show all {{count}} transceiver",
                          other: "Show all {{count}} transceivers",
                        },
                        sorted.length,
                      )
                }
                dataTestId="transceiver-show-all"
                onClick={() => {
                  setShowAll(!showAll);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </Card>
      </div>

      {selected ? (
        <TransceiverDetails
          transceiver={selected}
          onClose={() => {
            setSelectedIndex(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

interface RowProps {
  transceiver: NetworkDeviceTransceiver;
  onOpen: () => void;
}

const StatusPill: FunctionComponent<{ view: TransceiverStatusView }> = (props: {
  view: TransceiverStatusView;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PILL_CLASSES[props.view.tone]}`}
      data-testid="transceiver-status"
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASSES[props.view.tone]}`}
      ></span>
      {translator.translateText(props.view.label)}
    </span>
  );
};

const TransceiverRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const transceiver: NetworkDeviceTransceiver = props.transceiver;
  const status: TransceiverStatusView = getStatusView(transceiver);
  const optic: string = [
    transceiver.vendor,
    transceiver.partNumber || transceiver.type,
  ]
    .filter(Boolean)
    .join(" ");
  const isJudged: boolean =
    transceiver.health !== TransceiverHealth.PortDisabled;

  return (
    <tr
      className="cursor-pointer align-top hover:bg-gray-50"
      data-testid={`transceiver-row-${transceiver.interfaceIndex}`}
      onClick={props.onOpen}
    >
      <td className="py-2.5 pl-1 pr-4">
        <button
          type="button"
          className="text-left text-sm font-medium text-gray-900 hover:underline"
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            props.onOpen();
          }}
        >
          {transceiver.interfaceName ||
            translator.translateTemplate("Interface {{index}}", {
              index: transceiver.interfaceIndex.toString(),
            })}
        </button>
        {transceiver.interfaceAlias ? (
          <div className="text-xs text-gray-500">
            {transceiver.interfaceAlias}
          </div>
        ) : (
          <></>
        )}
      </td>
      <td className="py-2.5 pr-4">
        <div
          className={`text-sm ${transceiver.isPresent ? "text-gray-900" : "text-gray-500"}`}
        >
          {optic || "—"}
        </div>
        {transceiver.serialNumber ? (
          <div className="text-xs text-gray-500">
            {translator.translateTemplate("S/N {{serial}}", {
              serial: transceiver.serialNumber,
            })}
          </div>
        ) : (
          <></>
        )}
      </td>
      <td className="py-2.5 pr-4">
        <StatusPill view={status} />
        {!transceiver.isPresent && transceiver.lastSeenAt ? (
          <div className="mt-1 text-xs text-gray-500">
            {translator.translateTemplate("Last seen {{time}}", {
              time: OneUptimeDate.fromNow(new Date(transceiver.lastSeenAt)),
            })}
          </div>
        ) : (
          <></>
        )}
      </td>
      {TRANSCEIVER_TABLE_READINGS.map(
        (kind: TransceiverReadingKind): ReactElement => {
          return (
            <td
              key={kind}
              className={`py-2.5 pr-4 ${
                TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE.includes(kind)
                  ? "max-md:hidden md:table-cell"
                  : ""
              }`}
            >
              <ReadingCell
                transceiver={transceiver}
                kind={kind}
                isJudged={isJudged}
              />
            </td>
          );
        },
      )}
    </tr>
  );
};

// The few readings a phone shows inline: light both ways and temperature.
const LIST_READINGS: Array<TransceiverReadingKind> = [
  TransceiverReadingKind.RxPower,
  TransceiverReadingKind.TxPower,
  TransceiverReadingKind.Temperature,
];

const TransceiverListItem: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const transceiver: NetworkDeviceTransceiver = props.transceiver;
  const status: TransceiverStatusView = getStatusView(transceiver);
  const optic: string = [
    transceiver.vendor,
    transceiver.partNumber || transceiver.type,
  ]
    .filter(Boolean)
    .join(" ");
  const isJudged: boolean =
    transceiver.health !== TransceiverHealth.PortDisabled;
  const rxTrend: RxTrendView = getRxTrendView(transceiver);

  return (
    <li
      className="cursor-pointer py-3"
      data-testid={`transceiver-item-${transceiver.interfaceIndex}`}
      onClick={props.onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            className="text-left text-sm font-medium text-gray-900 hover:underline"
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              props.onOpen();
            }}
          >
            {transceiver.interfaceName ||
              translator.translateTemplate("Interface {{index}}", {
                index: transceiver.interfaceIndex.toString(),
              })}
          </button>
          {transceiver.interfaceAlias ? (
            <div className="truncate text-xs text-gray-500">
              {transceiver.interfaceAlias}
            </div>
          ) : (
            <></>
          )}
        </div>
        <StatusPill view={status} />
      </div>
      <div
        className={`mt-1 text-sm ${transceiver.isPresent ? "text-gray-700" : "text-gray-500"}`}
      >
        {optic || "—"}
        {transceiver.serialNumber ? (
          <span className="text-xs text-gray-500">
            {" · "}
            {translator.translateTemplate("S/N {{serial}}", {
              serial: transceiver.serialNumber,
            })}
          </span>
        ) : (
          <></>
        )}
      </div>
      {transceiver.isPresent ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LIST_READINGS.map((kind: TransceiverReadingKind): ReactElement => {
            const verdict: TransceiverReadingVerdict | undefined =
              pickDisplayVerdict(transceiver, kind);

            if (!verdict) {
              return <Fragment key={kind}></Fragment>;
            }

            const tone: TransceiverTone = isJudged
              ? getToneForLevel(verdict.level)
              : TransceiverTone.Neutral;

            return (
              <span key={kind} className="whitespace-nowrap">
                <span className="text-xs text-gray-500">
                  {translator.translateText(
                    TRANSCEIVER_READING_COLUMN_TITLES[kind],
                  )}{" "}
                </span>
                <span className={VALUE_CLASSES[tone]}>
                  {isNoLight(kind, verdict.value)
                    ? translator.translateText("No light")
                    : formatReadingValue(kind, verdict.value)}
                </span>
              </span>
            );
          })}
        </div>
      ) : transceiver.lastSeenAt ? (
        <div className="mt-1 text-xs text-gray-500">
          {translator.translateTemplate("Last seen {{time}}", {
            time: OneUptimeDate.fromNow(new Date(transceiver.lastSeenAt)),
          })}
        </div>
      ) : (
        <></>
      )}
      {rxTrend.isDropping && rxTrend.trend.dropDb !== undefined ? (
        <div className="mt-1 text-xs text-amber-700">
          {translator.translateTemplate("{{drop}} dB below its best day", {
            drop: rxTrend.trend.dropDb.toFixed(1),
          })}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

interface ReadingCellProps {
  transceiver: NetworkDeviceTransceiver;
  kind: TransceiverReadingKind;
  isJudged: boolean;
}

const ReadingCell: FunctionComponent<ReadingCellProps> = (
  props: ReadingCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const verdict: TransceiverReadingVerdict | undefined = pickDisplayVerdict(
    props.transceiver,
    props.kind,
  );

  if (!props.transceiver.isPresent || !verdict) {
    return <span className="text-gray-400">—</span>;
  }

  const tone: TransceiverTone = props.isJudged
    ? getToneForLevel(verdict.level)
    : TransceiverTone.Neutral;
  const crossing: string | undefined = props.isJudged
    ? getCrossingLabel(verdict)
    : undefined;
  const lanes: number = getLaneCount(props.transceiver, props.kind);
  const rxTrend: RxTrendView | undefined =
    props.kind === TransceiverReadingKind.RxPower
      ? getRxTrendView(props.transceiver)
      : undefined;

  return (
    <div
      className="space-y-0.5"
      data-testid={`transceiver-reading-${props.kind}`}
    >
      <div className={`whitespace-nowrap ${VALUE_CLASSES[tone]}`}>
        {isNoLight(props.kind, verdict.value)
          ? translator.translateText("No light")
          : formatReadingValue(props.kind, verdict.value)}
      </div>
      {crossing ? (
        <div
          className={`text-xs ${tone === TransceiverTone.Critical ? "text-red-700" : "text-amber-700"}`}
        >
          {translator.translateText(crossing)}
        </div>
      ) : (
        <></>
      )}
      {lanes > 1 ? (
        <div className="text-xs text-gray-500">
          {translator.translateTemplate("Worst of {{lanes}} lanes", {
            lanes: lanes.toString(),
          })}
        </div>
      ) : (
        <></>
      )}
      {rxTrend ? (
        <div className="pt-0.5">
          <TransceiverRxSparkline
            points={rxTrend.trend.points}
            baselineDbm={rxTrend.trend.baselineDbm}
            isDropping={rxTrend.isDropping}
          />
          {rxTrend.isDropping && rxTrend.trend.dropDb !== undefined ? (
            <div
              className="text-xs text-amber-700"
              data-testid="transceiver-rx-drop"
            >
              {translator.translateTemplate("{{drop}} dB below its best day", {
                drop: rxTrend.trend.dropDb.toFixed(1),
              })}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface DetailsProps {
  transceiver: NetworkDeviceTransceiver;
  onClose: () => void;
}

/*
 * Everything known about one optic: why it has its status, every reading
 * and lane against the device's thresholds, a month of received power and
 * who made it.
 */
const TransceiverDetails: FunctionComponent<DetailsProps> = (
  props: DetailsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const transceiver: NetworkDeviceTransceiver = props.transceiver;
  const port: string =
    transceiver.interfaceName || `#${transceiver.interfaceIndex}`;
  const status: TransceiverStatusView = getStatusView(transceiver);
  const rxTrend: RxTrendView = getRxTrendView(transceiver);
  const optic: string | undefined =
    TransceiverHealthUtil.describeOptic(transceiver);

  const facts: Array<{ title: string | undefined; value: string | undefined }> =
    [
      { title: translator.translateText("Vendor"), value: transceiver.vendor },
      {
        title: translator.translateText("Part Number"),
        value: transceiver.partNumber,
      },
      {
        title: translator.translateText("Serial Number"),
        value: transceiver.serialNumber,
      },
      {
        title: translator.translateText("Revision"),
        value: transceiver.revision,
      },
      { title: translator.translateText("Type"), value: transceiver.type },
      {
        title: translator.translateText("Wavelength"),
        value: transceiver.wavelengthNm
          ? `${transceiver.wavelengthNm} nm`
          : undefined,
      },
      {
        title: translator.translateText("Read From"),
        value: transceiver.source
          ? TRANSCEIVER_SOURCE_LABELS[transceiver.source] || transceiver.source
          : undefined,
      },
      {
        title: translator.translateText("First Seen"),
        value: transceiver.firstSeenAt
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              transceiver.firstSeenAt,
            )
          : undefined,
      },
      {
        title: translator.translateText("Last Seen"),
        value: transceiver.lastSeenAt
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              transceiver.lastSeenAt,
            )
          : undefined,
      },
    ];

  return (
    <SideOver
      title={translator.translateTemplate("Transceiver in {{port}}", {
        port: port,
      })}
      description={
        optic ||
        translator.translateText("The optic reports no identity.") ||
        ""
      }
      onClose={props.onClose}
      size={SideOverSize.Medium}
    >
      <div className="space-y-6" data-testid="transceiver-details">
        <div className="space-y-2">
          <StatusPill view={status} />
          {!transceiver.isPresent ? (
            <p className="text-sm text-gray-700">
              {transceiver.missingSince
                ? translator.translateTemplate(
                    "No optic has been detected in {{port}} since {{time}}, and the port is still enabled. If it was removed on purpose, disable the port or mute the interface and the alert stops.",
                    {
                      port: port,
                      time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        transceiver.missingSince,
                      ),
                    },
                  )
                : translator.translateText(
                    "No optic is detected in this port any more, and the port is still enabled.",
                  )}
            </p>
          ) : (
            <></>
          )}
          {transceiver.health === TransceiverHealth.PortDisabled ? (
            <p className="text-sm text-gray-700">
              {translator.translateText(
                "The port is administratively disabled, so its laser is off by design and its readings are not judged.",
              )}
            </p>
          ) : (
            <></>
          )}
          {(transceiver.faults || []).length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
              {(transceiver.faults || []).map(
                (fault: TransceiverFault): ReactElement => {
                  return (
                    <li key={fault}>
                      {fault === TransceiverFault.TxFault
                        ? translator.translateText(
                            "The device reports a transmitter fault.",
                          )
                        : translator.translateText(
                            "The device reports a loss of signal on receive.",
                          )}
                    </li>
                  );
                },
              )}
            </ul>
          ) : (
            <></>
          )}
        </div>

        {transceiver.isPresent ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText("Readings")}
            </h3>
            {TRANSCEIVER_READING_KINDS.filter(
              (kind: TransceiverReadingKind) => {
                return Boolean(
                  transceiver.measurements?.[kind]?.readings.length,
                );
              },
            ).length === 0 ? (
              <p className="text-sm text-gray-500">
                {translator.translateText(
                  "This optic reports no diagnostics - usual for copper SFPs and direct-attach cables. It is detected, with nothing to read.",
                )}
              </p>
            ) : (
              <></>
            )}
            {TRANSCEIVER_READING_KINDS.map(
              (kind: TransceiverReadingKind): ReactElement => {
                const measurement: TransceiverMeasurement | undefined =
                  transceiver.measurements?.[kind];

                if (!measurement || measurement.readings.length === 0) {
                  return <Fragment key={kind}></Fragment>;
                }

                return (
                  <ReadingDetails
                    key={kind}
                    kind={kind}
                    measurement={measurement}
                    isJudged={
                      transceiver.health !== TransceiverHealth.PortDisabled
                    }
                  />
                );
              },
            )}
          </div>
        ) : (
          <></>
        )}

        <div className="space-y-2" data-testid="transceiver-rx-trend">
          <h3 className="text-sm font-semibold text-gray-900">
            {transceiver.isPresent
              ? translator.translateTemplate(
                  "Received power, last {{days}} days",
                  { days: TRANSCEIVER_RX_BASELINE_DAYS.toString() },
                )
              : translator.translateText(
                  "Received power until it was last seen",
                )}
          </h3>
          <TransceiverRxSparkline
            points={rxTrend.trend.points}
            baselineDbm={rxTrend.trend.baselineDbm}
            isDropping={rxTrend.isDropping}
            width={320}
            height={64}
            className="w-full max-w-sm"
          />
          {rxTrend.trend.baselineDbm !== undefined &&
          rxTrend.trend.currentDbm !== undefined &&
          rxTrend.trend.dropDb !== undefined ? (
            <p
              className={`text-sm ${rxTrend.isDropping ? "text-amber-700" : "text-gray-700"}`}
            >
              {rxTrend.trend.dropDb >= 0.1
                ? translator.translateTemplate(
                    "Best day {{best}} dBm on {{day}}. Now {{now}} dBm, {{drop}} dB below it.",
                    {
                      best: rxTrend.trend.baselineDbm.toFixed(2),
                      day: formatDay(rxTrend.trend.baselineDay),
                      now: rxTrend.trend.currentDbm.toFixed(2),
                      drop: rxTrend.trend.dropDb.toFixed(2),
                    },
                  )
                : translator.translateTemplate(
                    "Best day {{best}} dBm on {{day}}. Now {{now}} dBm, as good as its best day.",
                    {
                      best: rxTrend.trend.baselineDbm.toFixed(2),
                      day: formatDay(rxTrend.trend.baselineDay),
                      now: rxTrend.trend.currentDbm.toFixed(2),
                    },
                  )}
            </p>
          ) : transceiver.isPresent ? (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "The trend fills in one point a day; the baseline needs one full day of readings.",
              )}
            </p>
          ) : (
            <></>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("About this optic")}
          </h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {facts
              .filter((fact: { value: string | undefined }) => {
                return Boolean(fact.value);
              })
              .map(
                (fact: {
                  title: string | undefined;
                  value: string | undefined;
                }): ReactElement => {
                  return (
                    <div key={fact.title || ""}>
                      <dt className="text-xs text-gray-500">{fact.title}</dt>
                      <dd className="text-gray-900 break-words">
                        {fact.value}
                      </dd>
                    </div>
                  );
                },
              )}
          </dl>
        </div>
      </div>
    </SideOver>
  );
};

interface ReadingDetailsProps {
  kind: TransceiverReadingKind;
  measurement: TransceiverMeasurement;
  isJudged: boolean;
}

const ReadingDetails: FunctionComponent<ReadingDetailsProps> = (
  props: ReadingDetailsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const thresholds: Array<ThresholdItem> = getThresholdItems(
    props.measurement.thresholds,
  );

  return (
    <div className="space-y-2" data-testid={`transceiver-detail-${props.kind}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(
          TRANSCEIVER_READING_COLUMN_TITLES[props.kind],
        )}
      </div>
      {props.measurement.readings.map(
        (reading: TransceiverReading, position: number): ReactElement => {
          const judged: {
            level: TransceiverReadingVerdict["level"];
            crossing?: TransceiverReadingVerdict["crossing"];
          } = TransceiverHealthUtil.judgeReading(
            reading.value,
            props.measurement.thresholds,
          );
          const verdict: TransceiverReadingVerdict = {
            kind: props.kind,
            value: reading.value,
            ...judged,
          };
          const tone: TransceiverTone = props.isJudged
            ? getToneForLevel(verdict.level)
            : TransceiverTone.Neutral;
          const crossing: string | undefined = props.isJudged
            ? getCrossingLabel(verdict)
            : undefined;
          const bar: ThresholdBarLayout | undefined = getThresholdBarLayout(
            reading.value,
            props.measurement.thresholds,
          );

          return (
            <div key={`${reading.lane ?? "module"}-${position}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                {reading.lane !== undefined ? (
                  <span className="text-xs text-gray-500">
                    {translator.translateTemplate("Lane {{lane}}", {
                      lane: reading.lane.toString(),
                    })}
                  </span>
                ) : (
                  <></>
                )}
                <span className={VALUE_CLASSES[tone]}>
                  {isNoLight(props.kind, reading.value)
                    ? translator.translateText("No light")
                    : formatReadingValue(props.kind, reading.value)}
                </span>
                {crossing ? (
                  <span
                    className={`text-xs ${tone === TransceiverTone.Critical ? "text-red-700" : "text-amber-700"}`}
                  >
                    {translator.translateText(crossing)}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              {bar ? (
                <div
                  className="relative mt-1.5 h-1.5 w-full max-w-sm overflow-visible rounded-full"
                  data-testid="transceiver-threshold-bar"
                  aria-hidden="true"
                >
                  {bar.segments.map(
                    (segment: ThresholdBarLayout["segments"][number]) => {
                      return (
                        <span
                          key={`${segment.fromPercent}-${segment.tone}`}
                          className={`absolute top-0 h-1.5 opacity-60 ${BAR_SEGMENT_CLASSES[segment.tone]}`}
                          style={{
                            left: `${segment.fromPercent}%`,
                            width: `${segment.toPercent - segment.fromPercent}%`,
                          }}
                        ></span>
                      );
                    },
                  )}
                  <span
                    className="absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded-full bg-indigo-600"
                    style={{ left: `${bar.markerPercent}%` }}
                  ></span>
                </div>
              ) : (
                <></>
              )}
            </div>
          );
        },
      )}
      <div className="text-xs text-gray-500">
        {thresholds.length > 0
          ? thresholds
              .map((item: ThresholdItem) => {
                return `${translator.translateText(item.label)} ${formatReadingValue(props.kind, item.value)}`;
              })
              .join(" · ")
          : translator.translateText(
              "The device reports no thresholds for this reading.",
            )}
      </div>
    </div>
  );
};

export default TransceiverHealthCard;
