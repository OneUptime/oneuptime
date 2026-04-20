import Text from "../../../../Types/Text";
import Dictionary from "../../../../Types/Dictionary";
import LineChart, { ComponentProps as LineChartProps } from "../Line/LineChart";
import BarChartElement, {
  ComponentProps as BarChartProps,
} from "../Bar/BarChart";
import AreaChartElement, {
  ComponentProps as AreaChartProps,
} from "../Area/AreaChart";
import ExemplarPoint from "../Types/ExemplarPoint";
import Icon, { SizeProp } from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import Modal, { ModalWidth } from "../../Modal/Modal";
import React, { FunctionComponent, ReactElement, useState } from "react";

export enum ChartType {
  LINE = "line",
  BAR = "bar",
  AREA = "area",
}

export interface ChartMetricInfo {
  metricName: string;
  aggregationType: string;
  attributes?: Dictionary<string> | undefined;
  groupByAttribute?: string | undefined;
  unit?: string | undefined;
}

export interface Chart {
  id: string;
  title: string;
  description?: string | undefined;
  type: ChartType;
  props: LineChartProps | BarChartProps | AreaChartProps;
  metricInfo?: ChartMetricInfo | undefined;
  exemplarPoints?: Array<ExemplarPoint> | undefined;
  onExemplarClick?: ((exemplar: ExemplarPoint) => void) | undefined;
}

export interface ComponentProps {
  charts: Array<Chart>;
  hideCard?: boolean | undefined;
  heightInPx?: number | undefined;
  chartCssClass?: string | undefined;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const syncId: string = Text.generateRandomText(10);
  const [metricInfoModalChart, setMetricInfoModalChart] =
    useState<ChartMetricInfo | null>(null);

  const isLastChart: (index: number) => boolean = (index: number): boolean => {
    return index === props.charts.length - 1;
  };

  type GetChartContentFunction = (chart: Chart, index: number) => ReactElement;

  const getChartContent: GetChartContentFunction = (
    chart: Chart,
    index: number,
  ): ReactElement => {
    switch (chart.type) {
      case ChartType.LINE:
        return (
          <LineChart
            key={index}
            {...(chart.props as LineChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
            exemplarPoints={chart.exemplarPoints}
            onExemplarClick={chart.onExemplarClick}
          />
        );
      case ChartType.BAR:
        return (
          <BarChartElement
            key={index}
            {...(chart.props as BarChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
          />
        );
      case ChartType.AREA:
        return (
          <AreaChartElement
            key={index}
            {...(chart.props as AreaChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
            exemplarPoints={chart.exemplarPoints}
            onExemplarClick={chart.onExemplarClick}
          />
        );
      default:
        return <></>;
    }
  };

  type GetInfoIconFunction = (chart: Chart) => ReactElement;

  const getInfoIcon: GetInfoIconFunction = (chart: Chart): ReactElement => {
    if (!chart.metricInfo) {
      return <></>;
    }

    return (
      <button
        type="button"
        className="ml-1.5 inline-flex items-center justify-center rounded-full w-5 h-5 text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all duration-150"
        title="View metric details"
        onClick={() => {
          setMetricInfoModalChart(chart.metricInfo || null);
        }}
      >
        <Icon
          icon={IconProp.InformationCircle}
          size={SizeProp.Smaller}
          className="h-3.5 w-3.5"
        />
      </button>
    );
  };

  const renderMetricInfoModal: () => ReactElement = (): ReactElement => {
    if (!metricInfoModalChart) {
      return <></>;
    }

    const attributes: Dictionary<string> =
      metricInfoModalChart.attributes || {};
    const attributeKeys: Array<string> = Object.keys(attributes);

    return (
      <Modal
        title="Metric Details"
        onClose={() => {
          setMetricInfoModalChart(null);
        }}
        onSubmit={() => {
          setMetricInfoModalChart(null);
        }}
        submitButtonText="Close"
        modalWidth={ModalWidth.Normal}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                    Metric Name
                  </td>
                  <td className="py-2.5 text-gray-900 font-mono text-xs">
                    {metricInfoModalChart.metricName}
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                    Aggregation
                  </td>
                  <td className="py-2.5 text-gray-900">
                    {metricInfoModalChart.aggregationType}
                  </td>
                </tr>
                {metricInfoModalChart.unit && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                      Unit
                    </td>
                    <td className="py-2.5 text-gray-900">
                      {metricInfoModalChart.unit}
                    </td>
                  </tr>
                )}
                {metricInfoModalChart.groupByAttribute && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                      Grouped By
                    </td>
                    <td className="py-2.5 text-gray-900 font-mono text-xs">
                      {metricInfoModalChart.groupByAttribute}
                    </td>
                  </tr>
                )}
                {attributeKeys.length > 0 && (
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap align-top">
                      Attributes
                    </td>
                    <td className="py-2.5">
                      <div className="space-y-1.5">
                        {attributeKeys.map((key: string) => {
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded bg-gray-200 px-2 py-0.5 text-xs font-mono text-gray-700">
                                {key}
                              </span>
                              <span className="text-gray-400">=</span>
                              <span className="text-xs text-gray-900 font-mono">
                                {attributes[key]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  };

  // When hideCard is true, render charts in a clean vertical stack with dividers
  if (props.hideCard) {
    return (
      <>
        {renderMetricInfoModal()}
        <div className="space-y-3">
          {props.charts.map((chart: Chart, index: number) => {
            return (
              <div
                key={index}
                className={`bg-white ${props.chartCssClass || ""}`}
              >
                <div className="px-5 pt-4 pb-4">
                  <div className="mb-3 pb-3 border-b border-gray-100">
                    <div className="flex items-center">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-tight">
                        {chart.title}
                      </h3>
                      {getInfoIcon(chart)}
                    </div>
                    {chart.description && (
                      <p className="mt-1 text-xs text-gray-500 hidden md:block">
                        {chart.description}
                      </p>
                    )}
                  </div>
                  {getChartContent(chart, index)}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // When showing cards, use the grid layout
  const gridCols: string =
    props.charts.length > 1 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  return (
    <>
      {renderMetricInfoModal()}
      <div
        className={`grid grid-cols-1 ${gridCols} gap-4 space-y-4 lg:space-y-0`}
      >
        {props.charts.map((chart: Chart, index: number) => {
          return (
            <div
              key={index}
              className={`p-5 rounded-lg border border-gray-200 bg-white shadow-sm ${props.chartCssClass || ""}`}
            >
              <div className="flex items-center">
                <h2
                  data-testid="card-details-heading"
                  id="card-details-heading"
                  className="text-base font-semibold leading-6 text-gray-900"
                >
                  {chart.title}
                </h2>
                {getInfoIcon(chart)}
              </div>
              {chart.description && (
                <p
                  data-testid="card-description"
                  className="mt-0.5 text-sm text-gray-500 w-full hidden md:block"
                >
                  {chart.description}
                </p>
              )}
              {getChartContent(chart, index)}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default ChartGroup;
