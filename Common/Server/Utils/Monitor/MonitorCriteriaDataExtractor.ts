import DataToProcess from "./DataToProcess";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";

export default class MonitorCriteriaDataExtractor {
  public static getProbeMonitorResponse(
    dataToProcess: DataToProcess,
  ): ProbeMonitorResponse | null {
    if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
      return dataToProcess as ProbeMonitorResponse;
    }

    return null;
  }

  public static getServerMonitorResponse(
    dataToProcess: DataToProcess,
  ): ServerMonitorResponse | null {
    if ((dataToProcess as ServerMonitorResponse).hostname) {
      return dataToProcess as ServerMonitorResponse;
    }

    return null;
  }

  public static getIncomingMonitorRequest(
    dataToProcess: DataToProcess,
  ): IncomingMonitorRequest | null {
    if (
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt !==
      undefined
    ) {
      return dataToProcess as IncomingMonitorRequest;
    }

    return null;
  }

  public static getLogMonitorResponse(
    dataToProcess: DataToProcess,
  ): LogMonitorResponse | null {
    if ((dataToProcess as LogMonitorResponse).logCount !== undefined) {
      return dataToProcess as LogMonitorResponse;
    }

    return null;
  }

  public static getTraceMonitorResponse(
    dataToProcess: DataToProcess,
  ): TraceMonitorResponse | null {
    if ((dataToProcess as TraceMonitorResponse).spanCount !== undefined) {
      return dataToProcess as TraceMonitorResponse;
    }

    return null;
  }

  public static getMetricMonitorResponse(
    dataToProcess: DataToProcess,
  ): MetricMonitorResponse | null {
    if ((dataToProcess as MetricMonitorResponse).metricResult !== undefined) {
      return dataToProcess as MetricMonitorResponse;
    }

    return null;
  }

  public static getExceptionMonitorResponse(
    dataToProcess: DataToProcess,
  ): ExceptionMonitorResponse | null {
    if (
      (dataToProcess as ExceptionMonitorResponse).exceptionCount !== undefined
    ) {
      return dataToProcess as ExceptionMonitorResponse;
    }

    return null;
  }

  public static getCustomCodeMonitorResponse(
    dataToProcess: DataToProcess,
  ): CustomCodeMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.customCodeMonitorResponse) {
      return probeResponse.customCodeMonitorResponse;
    }

    return null;
  }

  public static getSyntheticMonitorResponses(
    dataToProcess: DataToProcess,
  ): Array<SyntheticMonitorResponse> {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(dataToProcess);

    return probeResponse?.syntheticMonitorResponse || [];
  }

  public static getSslResponse(
    dataToProcess: DataToProcess,
  ): SslMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.sslResponse) {
      return probeResponse.sslResponse;
    }

    return null;
  }

  public static extractMetricValues(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): { alias: string | null; values: Array<number> } | null {
    const metricResponse: MetricMonitorResponse | null =
      MonitorCriteriaDataExtractor.getMetricMonitorResponse(
        input.dataToProcess,
      );

    if (!metricResponse) {
      return null;
    }

    const aggregatedResults: Array<AggregatedResult> =
      metricResponse.metricResult || [];

    if (!aggregatedResults.length) {
      return {
        alias: input.criteriaFilter.metricMonitorOptions?.metricAlias || null,
        values: [],
      };
    }

    let alias: string | null =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || null;

    let result: AggregatedResult | undefined;

    if (alias) {
      const queryConfigs: Array<MetricQueryConfigData> =
        input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs ||
        [];

      let aliasIndex: number = queryConfigs.findIndex(
        (queryConfig: MetricQueryConfigData) => {
          return queryConfig.metricAliasData?.metricVariable === alias;
        },
      );

      if (aliasIndex < 0) {
        const formulaConfigs: Array<MetricFormulaConfigData> =
          input.monitorStep.data?.metricMonitor?.metricViewConfig
            ?.formulaConfigs || [];

        const formulaIndex: number = formulaConfigs.findIndex(
          (formulaConfig: MetricFormulaConfigData) => {
            return formulaConfig.metricAliasData?.metricVariable === alias;
          },
        );

        if (formulaIndex >= 0) {
          aliasIndex = queryConfigs.length + formulaIndex;
        }
      }

      if (aliasIndex >= 0 && aliasIndex < aggregatedResults.length) {
        result = aggregatedResults[aliasIndex];
      }
    }

    if (!result) {
      result = aggregatedResults[0];
      if (!alias) {
        const defaultAlias: string | undefined =
          input.monitorStep.data?.metricMonitor?.metricViewConfig
            ?.queryConfigs?.[0]?.metricAliasData?.metricVariable;
        alias = defaultAlias || null;
      }
    }

    if (!result) {
      return {
        alias: alias,
        values: [],
      };
    }

    const values: Array<number> = result.data
      .map((entry: AggregateModel) => {
        return entry.value;
      })
      .filter((value: number) => {
        return typeof value === "number" && !isNaN(value);
      });

    return {
      alias: alias,
      values: values,
    };
  }
}
