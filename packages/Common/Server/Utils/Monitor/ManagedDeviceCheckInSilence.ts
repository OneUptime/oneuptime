import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { MANAGED_DEVICE_READING_METRIC_NAMES } from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import DataToProcess from "./DataToProcess";

/*
 * SILENCE IS NOT RECOVERY, FOR A FLEET'S CHECK-INS (#9835).
 *
 * The readings a Metrics monitor of managed devices' check-ins reads
 * (ManagedDeviceAlertTemplates: Esper Device Stopped Checking In) are
 * written by the reads of the devices' connection, never by the devices.
 * One device with no reading in the window left the fleet - Esper no longer
 * lists it, someone disabled it, the Android agent reports it now - and its
 * alert resolves while the others' readings go on. But a window with no
 * reading of any device says the connection stopped reading: its key was
 * refused, Esper was down, or it was turned off. That is not every device
 * checking in again, so their alerts stay open until it reads again, as an
 * infrastructure monitor's do when its agent goes quiet
 * (MonitorResource.isSilentInfrastructureWindow); the connection's row on
 * Inventory > Managed Devices says why it stopped.
 *
 * The same holds for the security patch ages the same reads write (#10098:
 * a device manager's Security Patch Out of Date): no patch reading of any
 * device is a connection that stopped reading, not every device updated.
 */
export default class ManagedDeviceCheckInSilence {
  /*
   * Whether every query of the monitor reads what the managed devices'
   * connection writes of them: their check-ins, or their security patches.
   */
  public static readsCheckIns(
    response: MetricMonitorResponse | undefined,
  ): boolean {
    const queryConfigs: Array<MetricQueryConfigData> =
      response?.metricViewConfig?.queryConfigs || [];

    return (
      queryConfigs.length > 0 &&
      queryConfigs.every((queryConfig: MetricQueryConfigData): boolean => {
        const metricName: unknown =
          queryConfig?.metricQueryData?.filterData?.metricName;

        return (
          typeof metricName === "string" &&
          MANAGED_DEVICE_READING_METRIC_NAMES.includes(metricName)
        );
      })
    );
  }

  /*
   * Whether this check of such a monitor read no reading of any device:
   * not one data point in any query, nor in any series.
   */
  public static isQuietWindow(
    dataToProcess: DataToProcess | undefined,
  ): boolean {
    const response: MetricMonitorResponse | undefined = dataToProcess as
      | MetricMonitorResponse
      | undefined;

    if (
      !response ||
      !Array.isArray(response.metricResult) ||
      !ManagedDeviceCheckInSilence.readsCheckIns(response)
    ) {
      return false;
    }

    const hasData: (results: Array<AggregatedResult> | undefined) => boolean = (
      results: Array<AggregatedResult> | undefined,
    ): boolean => {
      return (results || []).some((result: AggregatedResult): boolean => {
        return Array.isArray(result?.data) && result.data.length > 0;
      });
    };

    if (hasData(response.metricResult)) {
      return false;
    }

    return !(response.seriesBreakdown || []).some(
      (series: MetricSeriesResult): boolean => {
        return hasData(series?.aggregatedResults);
      },
    );
  }
}
