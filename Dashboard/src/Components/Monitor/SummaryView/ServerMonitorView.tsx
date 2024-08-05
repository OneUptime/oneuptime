import OneUptimeDate from "Common/Types/Date";
import { BasicDiskMetrics } from "Common/Types/Infrastructure/BasicMetrics";
import ServerMonitor from "Common/Types/Monitor/ServerMonitor/ServerMonitor";
import Button, { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import Detail from "CommonUI/src/Components/Detail/Detail";
import Field from "CommonUI/src/Components/Detail/Field";
import InfoCard from "CommonUI/src/Components/InfoCard/InfoCard";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";
import MemoryUtil from "Common/Utils/Memory";
import NumberUtil from "Common/Utils/Number";

export interface ComponentProps {
  serverMonitor: ServerMonitor;
}

const ServerMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<ServerMonitor>> = [];

  if (props.serverMonitor?.processes) {
    fields.push({
      key: "processes",
      title: "Processes",
      description: "Processes running on the machine.",
      fieldType: FieldType.JSON,
    });
  }

  const getCpuMetrics: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="CPU % Used"
          value={
            props.serverMonitor?.basicInfrastructureMetrics?.cpuMetrics?.percentUsed?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitor.basicInfrastructureMetrics
                    .cpuMetrics.percentUsed,
                ).toString()
              : "-"
          }
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="CPU Cores"
          value={
            props.serverMonitor?.basicInfrastructureMetrics?.cpuMetrics?.cores?.toString() ||
            "-" ||
            "-"
          }
        />
      </div>
    );
  };

  const getMemoryMetrics: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="flex space-x-3 mt-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Total Memory (GB)"
          value={
            props.serverMonitor?.basicInfrastructureMetrics?.memoryMetrics?.total?.toString()
              ? MemoryUtil.convertToGb(
                  props.serverMonitor.basicInfrastructureMetrics
                    .memoryMetrics.total,
                ).toString()
              : "-"
          }
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Memory % Used"
          value={
            props.serverMonitor?.basicInfrastructureMetrics?.memoryMetrics?.percentUsed?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitor.basicInfrastructureMetrics
                    .memoryMetrics.percentUsed,
                ).toString()
              : "-"
          }
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Memory % Free"
          value={
            props.serverMonitor?.basicInfrastructureMetrics?.memoryMetrics?.percentFree?.toString()
              ? NumberUtil.convertToTwoDecimalPlaces(
                  props.serverMonitor.basicInfrastructureMetrics
                    .memoryMetrics.percentFree,
                ).toString()
              : "-"
          }
        />
      </div>
    );
  };

  const getDiskMetrics: GetReactElementFunction = (): ReactElement => {
    const diskMetrics: Array<BasicDiskMetrics> | undefined =
      props.serverMonitor?.basicInfrastructureMetrics?.diskMetrics;

    if (!diskMetrics) {
      return <div></div>;
    }

    const diskMetricsElements: Array<ReactElement> = diskMetrics.map(
      (diskMetric: BasicDiskMetrics, index: number) => {
        return (
          <div className="mt-3">
            <div className="mb-1">Disk {diskMetric.diskPath}</div>
            <div key={index} className="flex space-x-3">
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title={`Total Size (GB)`}
                value={
                  diskMetric.total.toString()
                    ? MemoryUtil.convertToGb(diskMetric.total).toString()
                    : "-"
                }
              />
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title={`% Used`}
                value={
                  diskMetric.percentUsed.toString()
                    ? NumberUtil.convertToTwoDecimalPlaces(
                        diskMetric.percentUsed,
                      ).toString()
                    : "-"
                }
              />
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title={`% Free`}
                value={
                  diskMetric.percentFree.toString()
                    ? NumberUtil.convertToTwoDecimalPlaces(
                        diskMetric.percentFree,
                      ).toString()
                    : "-"
                }
              />
            </div>
          </div>
        );
      },
    );

    return <div className="mb-3">{diskMetricsElements}</div>;
  };

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Hostname"
          value={props.serverMonitor?.hostname || "-"}
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Last Ping At"
          value={
            props.serverMonitor?.requestReceivedAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.serverMonitor.requestReceivedAt,
                )
              : "-"
          }
        />
      </div>

      {props.serverMonitor.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={props.serverMonitor.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {showMoreDetails && fields.length > 0 && (
        <div>
          {props.serverMonitor?.basicInfrastructureMetrics
            ?.cpuMetrics && getCpuMetrics()}

          {props.serverMonitor?.basicInfrastructureMetrics
            ?.memoryMetrics && getMemoryMetrics()}

          {props.serverMonitor?.basicInfrastructureMetrics
            ?.diskMetrics && getDiskMetrics()}

          <Detail<ServerMonitor>
            id={"website-monitor-summary-detail"}
            item={props.serverMonitor}
            fields={fields}
            showDetailsInNumberOfColumns={1}
          />
        </div>
      )}

      {!showMoreDetails && fields.length > 0 && (
        <div className="-ml-2">
          <Button
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title="Show More Details"
            onClick={() => {
              return setShowMoreDetails(true);
            }}
          />
        </div>
      )}

      {/* Hide details button */}

      {showMoreDetails && fields.length > 0 && (
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
    </div>
  );
};

export default ServerMonitorSummaryView;
