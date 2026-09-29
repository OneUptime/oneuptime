import { JSONObject } from "../../../Types/JSON";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * Computes per-interface rates (bandwidth, utilization, errors) for SNMP
 * walks by comparing the cumulative IF-MIB counters of the current walk
 * against the previous walk stored in NetworkDevice.lastWalkLog.
 *
 * Probes stay stateless — the delta is computed here, on ingest, before the
 * walk is persisted. Negative deltas (counter wrap or device reboot) are
 * skipped for that interface; rates resume on the following walk.
 */
export default class SnmpInterfaceRateUtil {
  public static attachInterfaceRates(data: {
    snmpResponse: SnmpMonitorResponse | undefined;
    /*
     * The device's previous walk: `{ snmpResponse, monitoredAt }` as stored
     * in NetworkDevice.lastWalkLog. Undefined on a device's first walk.
     */
    previousWalkLog: JSONObject | undefined;
  }): void {
    const interfaces: Array<SnmpInterface> | undefined =
      data.snmpResponse?.interfaces;

    if (!interfaces || interfaces.length === 0) {
      return;
    }

    if (!data.previousWalkLog) {
      return;
    }

    const previousSnmpResponse: JSONObject | undefined = data.previousWalkLog[
      "snmpResponse"
    ] as JSONObject | undefined;

    const previousInterfaces: Array<JSONObject> | undefined =
      previousSnmpResponse?.["interfaces"] as Array<JSONObject> | undefined;

    const previousMonitoredAtValue: unknown =
      data.previousWalkLog["monitoredAt"];

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
     * lastWalkLog stores server receipt time as monitoredAt, so the
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
      `Attached SNMP interface rates over ${round(elapsedSeconds)}s window`,
    );
  }
}
