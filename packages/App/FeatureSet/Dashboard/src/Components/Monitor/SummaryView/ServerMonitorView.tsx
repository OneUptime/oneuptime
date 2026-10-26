import OneUptimeDate from "Common/Types/Date";
import { BasicDiskMetrics } from "Common/Types/Infrastructure/BasicMetrics";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";
import MemoryUtil from "Common/Utils/Memory";
import NumberUtil from "Common/Utils/Number";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  serverMonitorResponse: ServerMonitorResponse;
}

const ServerMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<ServerMonitorResponse>> = [];

  const cpuCores: number | undefined =
    props.serverMonitorResponse?.basicInfrastructureMetrics?.cpuMetrics?.cores;

  if (props.serverMonitorResponse?.processes) {
    fields.push({
      key: "processes",
      title: "Processes",
      description: "Processes running on the machine.",
      fieldType: FieldType.JSON,
    });
  }

  const getCpuMetrics: GetReactElementFunction = (): ReactElement => {
    return (
      <SummaryFacts dataTestId="server-monitor-cpu-facts">
        <SummaryFact
          title="CPU % Used"
          value={
            props.serverMonitorResponse?.basicInfrastructureMetrics?.cpuMetrics?.percentUsed?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitorResponse.basicInfrastructureMetrics
                    .cpuMetrics.percentUsed,
                ).toString()
              : "-"
          }
        />
        <SummaryFact
          title="CPU Cores"
          value={cpuCores !== undefined ? cpuCores.toString() : "-"}
        />
      </SummaryFacts>
    );
  };

  const getMemoryMetrics: GetReactElementFunction = (): ReactElement => {
    return (
      <SummaryFacts isInThrees={true} dataTestId="server-monitor-memory-facts">
        <SummaryFact
          title="Total Memory (GB)"
          value={
            props.serverMonitorResponse?.basicInfrastructureMetrics?.memoryMetrics?.total?.toString()
              ? MemoryUtil.convertToGb(
                  props.serverMonitorResponse.basicInfrastructureMetrics
                    .memoryMetrics.total,
                ).toString()
              : "-"
          }
        />
        <SummaryFact
          title="Memory % Used"
          value={
            props.serverMonitorResponse?.basicInfrastructureMetrics?.memoryMetrics?.percentUsed?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitorResponse.basicInfrastructureMetrics
                    .memoryMetrics.percentUsed,
                ).toString()
              : "-"
          }
        />
        <SummaryFact
          title="Memory % Free"
          value={
            props.serverMonitorResponse?.basicInfrastructureMetrics?.memoryMetrics?.percentFree?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitorResponse.basicInfrastructureMetrics
                    .memoryMetrics.percentFree,
                ).toString()
              : "-"
          }
        />
      </SummaryFacts>
    );
  };

  const getDiskMetrics: GetReactElementFunction = (): ReactElement => {
    const diskMetrics: Array<BasicDiskMetrics> | undefined =
      props.serverMonitorResponse?.basicInfrastructureMetrics?.diskMetrics;

    if (!diskMetrics) {
      return <></>;
    }

    return (
      <>
        {diskMetrics.map((diskMetric: BasicDiskMetrics, index: number) => {
          return (
            <div
              key={index}
              className="space-y-2"
              data-testid="server-monitor-disk"
            >
              <div className="text-sm font-medium text-gray-700 [overflow-wrap:anywhere]">
                {translator.translateTemplate("Disk {{path}}", {
                  path: diskMetric.diskPath,
                })}
              </div>
              <SummaryFacts isInThrees={true}>
                <SummaryFact
                  title="Total Size (GB)"
                  value={
                    diskMetric.total.toString()
                      ? MemoryUtil.convertToGb(diskMetric.total).toString()
                      : "-"
                  }
                />
                <SummaryFact
                  title="% Used"
                  value={
                    diskMetric.percentUsed.toString()
                      ? NumberUtil.convertToTwoDecimalPlaces(
                          diskMetric.percentUsed,
                        ).toString()
                      : "-"
                  }
                />
                <SummaryFact
                  title="% Free"
                  value={
                    diskMetric.percentFree.toString()
                      ? NumberUtil.convertToTwoDecimalPlaces(
                          diskMetric.percentFree,
                        ).toString()
                      : "-"
                  }
                />
              </SummaryFacts>
            </div>
          );
        })}
      </>
    );
  };

  /*
   * What Show More Details opens: the machine's CPU, memory and disks, and
   * the processes it reported. It used to open only for an agent that
   * reported processes, so a report of CPU, memory and disks alone could
   * not be read at all.
   */
  const hasMoreDetails: boolean =
    fields.length > 0 ||
    Boolean(
      props.serverMonitorResponse?.basicInfrastructureMetrics?.cpuMetrics ||
        props.serverMonitorResponse?.basicInfrastructureMetrics
          ?.memoryMetrics ||
        props.serverMonitorResponse?.basicInfrastructureMetrics?.diskMetrics,
    );

  return (
    <SummaryView dataTestId="server-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          title="Hostname"
          value={props.serverMonitorResponse?.hostname || "-"}
        />
        <SummaryFact
          title="Last Ping At"
          value={
            props.serverMonitorResponse?.requestReceivedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.serverMonitorResponse.requestReceivedAt,
                )
              : "-"
          }
        />
        {props.serverMonitorResponse.failureCause ? (
          <SummaryFact
            isWide={true}
            title="Error"
            value={props.serverMonitorResponse.failureCause.toString()}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {showMoreDetails && hasMoreDetails && (
        <div className="space-y-5">
          {props.serverMonitorResponse?.basicInfrastructureMetrics
            ?.cpuMetrics && getCpuMetrics()}

          {props.serverMonitorResponse?.basicInfrastructureMetrics
            ?.memoryMetrics && getMemoryMetrics()}

          {props.serverMonitorResponse?.basicInfrastructureMetrics
            ?.diskMetrics && getDiskMetrics()}

          {fields.length > 0 && (
            <Detail<ServerMonitorResponse>
              id={"website-monitor-summary-detail"}
              item={props.serverMonitorResponse}
              fields={fields}
              showDetailsInNumberOfColumns={1}
            />
          )}
        </div>
      )}

      {!showMoreDetails && hasMoreDetails && (
        <div className="-ml-3">
          <Button
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title="Show More Details"
            onClick={() => {
              return setShowMoreDetails(true);
            }}
          />
        </div>
      )}

      {showMoreDetails && hasMoreDetails && (
        <div className="-ml-3">
          <Button
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title="Hide Details"
            onClick={() => {
              return setShowMoreDetails(false);
            }}
          />
        </div>
      )}
    </SummaryView>
  );
};

export default ServerMonitorSummaryView;
