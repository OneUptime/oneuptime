import { JSONObject } from "../../../Types/JSON";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * Computes per-interface rates (bandwidth, utilization, errors) for SNMP
 * monitors by comparing the cumulative IF-MIB counters of the current check
 * against the previous check stored in MonitorProbe.lastMonitoringLog.
 *
 * Probes stay stateless — the delta is computed here, on ingest, before the
 * response is persisted. Negative deltas (counter wrap or device reboot) are
 * skipped for that interface; rates resume on the following check.
 */
export default class SnmpInterfaceRateUtil {
  public static attachInterfaceRates(data: {
    probeMonitorResponse: ProbeMonitorResponse;
    previousStepLog: JSONObject | undefined;
  }): void {
    const interfaces: Array<SnmpInterface> | undefined =
      data.probeMonitorResponse.snmpResponse?.interfaces;

    if (!interfaces || interfaces.length === 0) {
      return;
    }

    if (!data.previousStepLog) {
      return;
    }

    const previousSnmpResponse: JSONObject | undefined = data.previousStepLog[
      "snmpResponse"
    ] as JSONObject | undefined;

    const previousInterfaces: Array<JSONObject> | undefined =
      previousSnmpResponse?.["interfaces"] as Array<JSONObject> | undefined;

    const previousMonitoredAtValue: unknown =
      data.previousStepLog["monitoredAt"];

    if (
      !previousInterfaces ||
      previousInterfaces.length === 0 ||
      !previousMonitoredAtValue
    ) {
      return;
    }

    const previousMonitoredAt: Date = new Date(
      previousMonitoredAtValue as string,
    );

    if (isNaN(previousMonitoredAt.getTime())) {
      return;
    }

    /*
     * lastMonitoringLog stores server receipt time as monitoredAt, so the
     * current side of the delta uses server time too.
     */
    const elapsedSeconds: number =
      (OneUptimeDate.getCurrentDate().getTime() -
        previousMonitoredAt.getTime()) /
      1000;

    if (elapsedSeconds <= 0) {
      return;
    }

    const counterDelta: (
      currentValue: number | undefined,
      previousValue: unknown,
    ) => number | undefined = (
      currentValue: number | undefined,
      previousValue: unknown,
    ) => {
      if (
        currentValue === undefined ||
        typeof previousValue !== "number" ||
        !isFinite(previousValue)
      ) {
        return undefined;
      }

      const delta: number = currentValue - previousValue;

      // Negative delta: counter wrapped or the device rebooted.
      return delta >= 0 ? delta : undefined;
    };

    const round: (value: number) => number = (value: number) => {
      return Math.round(value * 100) / 100;
    };

    const previousByIndex: Map<number, JSONObject> = new Map();
    for (const previousInterface of previousInterfaces) {
      const index: unknown = previousInterface["interfaceIndex"];
      if (typeof index === "number") {
        previousByIndex.set(index, previousInterface);
      }
    }

    for (const currentInterface of interfaces) {
      const previousInterface: JSONObject | undefined = previousByIndex.get(
        currentInterface.interfaceIndex,
      );

      if (!previousInterface) {
        continue;
      }

      const inOctetsDelta: number | undefined = counterDelta(
        currentInterface.inOctets,
        previousInterface["inOctets"],
      );
      const outOctetsDelta: number | undefined = counterDelta(
        currentInterface.outOctets,
        previousInterface["outOctets"],
      );

      if (inOctetsDelta !== undefined) {
        currentInterface.inBitsPerSecond = round(
          (inOctetsDelta * 8) / elapsedSeconds,
        );
      }

      if (outOctetsDelta !== undefined) {
        currentInterface.outBitsPerSecond = round(
          (outOctetsDelta * 8) / elapsedSeconds,
        );
      }

      if (
        currentInterface.speedInBitsPerSecond &&
        currentInterface.speedInBitsPerSecond > 0 &&
        (currentInterface.inBitsPerSecond !== undefined ||
          currentInterface.outBitsPerSecond !== undefined)
      ) {
        const busiestDirectionBps: number = Math.max(
          currentInterface.inBitsPerSecond || 0,
          currentInterface.outBitsPerSecond || 0,
        );
        currentInterface.utilizationPercent = round(
          (busiestDirectionBps / currentInterface.speedInBitsPerSecond) * 100,
        );
      }

      const inErrorsDelta: number | undefined = counterDelta(
        currentInterface.inErrors,
        previousInterface["inErrors"],
      );
      const outErrorsDelta: number | undefined = counterDelta(
        currentInterface.outErrors,
        previousInterface["outErrors"],
      );

      if (inErrorsDelta !== undefined || outErrorsDelta !== undefined) {
        currentInterface.errorsPerSecond = round(
          ((inErrorsDelta || 0) + (outErrorsDelta || 0)) / elapsedSeconds,
        );
      }
    }

    logger.debug(
      `Attached SNMP interface rates for monitor ${data.probeMonitorResponse.monitorId.toString()} over ${round(elapsedSeconds)}s window`,
    );
  }
}
