import MetricView from "../Metrics/MetricView";
import { chartWordsInReadersLanguage } from "../Metrics/Utils/ChartWordsInReadersLanguage";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import {
  FIBRE_CHANNEL_COUNTERS,
  FIBRE_CHANNEL_COUNTER_DESCRIPTIONS,
  FIBRE_CHANNEL_COUNTER_TITLES,
  FIBRE_CHANNEL_IF_TYPE,
  FibreChannelCounter,
} from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import Card from "Common/UI/Components/Card/Card";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

/*
 * A SAN switch's Fibre Channel ports, on its Interfaces page: one counter at
 * a time - CRC errors, link failures, discards, credit loss - per second,
 * one line per port, so a port degrading stands out from the ones that are
 * not. The switch's own counters (Brocade's SW-MIB and FCMGMT-MIB, Cisco's
 * CISCO-FC-FE-MIB), rated between polls by the server.
 *
 * Draws nothing on a device with no Fibre Channel ports, as the
 * Transceivers card draws nothing on one with no optics.
 */

// One line per port, named by the port.
function seriesOfPort(data: AggregateModel, fallback: string): ChartSeries {
  let attributes: JSONObject | undefined = data?.["attributes"] as
    | JSONObject
    | undefined;

  if (typeof attributes === "string") {
    try {
      attributes = JSONFunctions.parseJSONObject(attributes);
    } catch {
      attributes = undefined;
    }
  }

  const name: unknown = attributes?.["interfaceName"];

  return { title: typeof name === "string" && name ? name : fallback };
}

const FibreChannelPortsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [portCount, setPortCount] = useState<number | null>(null);
  const [counter, setCounter] = useState<FibreChannelCounter>(
    FibreChannelCounter.CrcErrors,
  );
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.count<NetworkInterface>({
      modelType: NetworkInterface,
      query: {
        networkDeviceId: props.networkDeviceId.toString(),
        interfaceType: FIBRE_CHANNEL_IF_TYPE,
      },
    })
      .then((count: number) => {
        if (isCurrent) {
          setPortCount(count);
        }
      })
      .catch(() => {
        // The card is supplementary: the interface list still renders.
        if (isCurrent) {
          setPortCount(0);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.networkDeviceId.toString()]);

  const counterOptions: Array<DropdownOption> = FIBRE_CHANNEL_COUNTERS.map(
    (option: FibreChannelCounter): DropdownOption => {
      return {
        value: option,
        label:
          translator.translateText(FIBRE_CHANNEL_COUNTER_TITLES[option]) ||
          FIBRE_CHANNEL_COUNTER_TITLES[option],
      };
    },
  );

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const counterTitle: string = FIBRE_CHANNEL_COUNTER_TITLES[counter];

    return chartWordsInReadersLanguage(
      [
        {
          metricAliasData: {
            metricVariable: "fibre_channel_counter",
            title: counterTitle,
            description: FIBRE_CHANNEL_COUNTER_DESCRIPTIONS[counter],
            legend: counterTitle,
            legendUnit: "/s",
          },
          metricQueryData: {
            filterData: {
              metricName: MonitorMetricType.SnmpInterfaceFibreChannelPerSecond,
              attributes: {
                networkDeviceId: props.networkDeviceId.toString(),
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
                fibreChannelCounter: counter,
              },
              // The worst moment of a bucket is what a port's trouble looks like.
              aggegationType: AggregationType.Max,
            },
            groupBy: {
              attributes: true,
            },
          },
          getSeries: (data: AggregateModel): ChartSeries => {
            return seriesOfPort(data, counterTitle);
          },
        },
      ],
      translator,
    );
  }, [props.networkDeviceId.toString(), counter, translator.language]);

  const [viewData, setViewData] = useState<MetricViewData>(() => {
    return {
      startAndEndDate:
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange),
      queryConfigs: queryConfigs,
      formulaConfigs: [],
    };
  });

  useEffect(() => {
    setViewData((previous: MetricViewData) => {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

      return {
        ...previous,
        startAndEndDate: dateRange,
        queryConfigs: queryConfigs,
      };
    });
  }, [timeRange, queryConfigs]);

  if (!portCount) {
    return <></>;
  }

  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <Card
        title="Fibre Channel Ports"
        description="Each port's errors, discards and credit counters per second, read from the switch's own counters. Pick a counter to compare the ports on it."
        rightElement={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Dropdown
                ariaLabel={
                  translator.translateText("Fibre Channel Counter") ||
                  "Fibre Channel Counter"
                }
                options={counterOptions}
                value={counterOptions.find((option: DropdownOption) => {
                  return option.value === counter;
                })}
                isClearable={false}
                isCompact={true}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const picked: FibreChannelCounter | undefined =
                    FIBRE_CHANNEL_COUNTERS.find(
                      (option: FibreChannelCounter) => {
                        return option === value?.toString();
                      },
                    );

                  if (picked) {
                    setCounter(picked);
                  }
                }}
              />
            </div>
            <RangeStartAndEndDateView
              dashboardStartAndEndDate={timeRange}
              onChange={(newRange: RangeStartAndEndDateTime) => {
                setTimeRange(newRange);
              }}
            />
            <ResetTimeRangeZoomButton />
          </div>
        }
      >
        <p
          className="mb-3 text-sm text-gray-600"
          data-testid="fibre-channel-counter-description"
        >
          {translator.translateText(
            FIBRE_CHANNEL_COUNTER_DESCRIPTIONS[counter],
          )}
        </p>
        <MetricView
          data={viewData}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={(data: MetricViewData) => {
            setViewData({
              ...data,
              queryConfigs: queryConfigs,
              formulaConfigs: [],
            });
          }}
        />
      </Card>
    </TimeRangeZoomScope>
  );
};

export default FibreChannelPortsCard;
