import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  NetworkDeviceTransceiver,
  TRANSCEIVER_READING_KINDS,
  TRANSCEIVER_READING_TITLES,
  TransceiverHealth,
  TransceiverMeasurement,
  TransceiverReading,
  TransceiverThresholds,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "../../../../Types/ObjectID";
import TransceiverHealthUtil, {
  TRANSCEIVER_RX_BASELINE_DAYS,
  TransceiverRxPowerTrend,
  TransceiverRxPowerTrendPoint,
} from "../../../../Utils/NetworkDevice/TransceiverHealthUtil";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import QueryHelper from "../../../Types/Database/QueryHelper";

/*
 * What OneUptime AI is told about a network device's transceivers.
 *
 * "If the switch is still reachable, the interface is down and the
 * transceiver is suddenly no longer detected, the AI already has some very
 * useful information to work with. Or if the RX optical power has slowly
 * been decreasing over the past few weeks ..." - the customer this was built
 * for. So an investigation of an alert or incident raised by a Network
 * Device monitor starts with the optics of the ports it is about: still
 * detected or not, every reading against the device's own thresholds, and
 * the received power of the last weeks. The query_network_transceivers tool
 * reads the same rows on demand.
 *
 * Everything is worded by TransceiverHealthUtil, the judge the device page
 * and the alerts use, so the AI never contradicts what the operator sees.
 */

// Optics an investigation is told about in detail, beyond the ones it is about.
export const MAX_TRANSCEIVERS_IN_CONTEXT: number = 12;

// Daily received power averages handed over per optic.
const MAX_TREND_POINTS: number = TRANSCEIVER_RX_BASELINE_DAYS + 1;

/*
 * A character that would continue a port name: "Gi1/0/1" named in a text is
 * not "Gi1/0/17", "Gi1/0/1/2" or "xGi1/0/1".
 */
const PORT_NAME_CHARACTER_REGEX: RegExp = /[a-z0-9/_-]/;

export interface TransceiverDevice {
  name?: string | undefined;
  transceivers: Array<NetworkDeviceTransceiver>;
}

export default class NetworkTransceiverContext {
  // One optic as a flat row: what the tool returns and the section lists.
  public static toRow(transceiver: NetworkDeviceTransceiver): JSONObject {
    const trend: TransceiverRxPowerTrend =
      TransceiverHealthUtil.getRxPowerTrend(transceiver);

    const row: JSONObject = {
      port: transceiver.interfaceName || `ifIndex ${transceiver.interfaceIndex}`,
      health: transceiver.health,
      detected: transceiver.isPresent,
    };

    if (transceiver.interfaceAlias) {
      row["portAlias"] = transceiver.interfaceAlias;
    }

    const optic: string | undefined =
      TransceiverHealthUtil.describeOptic(transceiver);
    if (optic) {
      row["optic"] = optic;
    }

    if (transceiver.type) {
      row["type"] = transceiver.type;
    }

    if (transceiver.wavelengthNm) {
      row["wavelengthNm"] = transceiver.wavelengthNm;
    }

    if (transceiver.source) {
      row["readFrom"] = transceiver.source;
    }

    if (!transceiver.isPresent) {
      row["missingSince"] = transceiver.missingSince || null;
      row["missingForPolls"] = transceiver.missingPolls || 0;
      row["lastSeenAt"] = transceiver.lastSeenAt || null;
    } else {
      row["firstSeenAt"] = transceiver.firstSeenAt || null;
    }

    const readings: Array<string> =
      NetworkTransceiverContext.describeReadings(transceiver);

    if (readings.length > 0) {
      row["readings"] = readings;
    }

    const issues: Array<string> =
      TransceiverHealthUtil.describeIssues(transceiver);

    if (issues.length > 0) {
      row["issues"] = issues;
    }

    if (trend.points.length > 0) {
      row["rxPowerDailyAverageDbm"] = trend.points
        .slice(-MAX_TREND_POINTS)
        .map((point: TransceiverRxPowerTrendPoint) => {
          return `${point.day} ${point.averageDbm.toFixed(2)}`;
        });
    }

    if (trend.baselineDbm !== undefined) {
      row["rxPowerBestDayDbm"] = trend.baselineDbm;
      row["rxPowerBestDay"] = trend.baselineDay || null;
    }

    if (trend.dropDb !== undefined) {
      row["rxPowerDropFromBestDayDb"] = trend.dropDb;
    }

    return row;
  }

  // "RX power -4.70 dBm (lane 1) - low alarm -16.40 dBm, low warning ..."
  public static describeReadings(
    transceiver: NetworkDeviceTransceiver,
  ): Array<string> {
    const lines: Array<string> = [];

    for (const kind of TRANSCEIVER_READING_KINDS) {
      const measurement: TransceiverMeasurement | undefined =
        transceiver.measurements?.[kind];

      if (!measurement || measurement.readings.length === 0) {
        continue;
      }

      const values: string = measurement.readings
        .map((reading: TransceiverReading) => {
          return `${TransceiverHealthUtil.formatReading(kind, reading.value)}${
            reading.lane !== undefined ? ` (lane ${reading.lane})` : ""
          }`;
        })
        .join(", ");

      const thresholds: TransceiverThresholds | undefined =
        TransceiverHealthUtil.normalizeThresholds(measurement.thresholds);

      const limits: Array<string> = [];

      if (thresholds?.lowAlarm !== undefined) {
        limits.push(
          `low alarm ${TransceiverHealthUtil.formatReading(kind, thresholds.lowAlarm)}`,
        );
      }
      if (thresholds?.lowWarning !== undefined) {
        limits.push(
          `low warning ${TransceiverHealthUtil.formatReading(kind, thresholds.lowWarning)}`,
        );
      }
      if (thresholds?.highWarning !== undefined) {
        limits.push(
          `high warning ${TransceiverHealthUtil.formatReading(kind, thresholds.highWarning)}`,
        );
      }
      if (thresholds?.highAlarm !== undefined) {
        limits.push(
          `high alarm ${TransceiverHealthUtil.formatReading(kind, thresholds.highAlarm)}`,
        );
      }

      lines.push(
        `${TRANSCEIVER_READING_TITLES[kind]} ${values}${
          limits.length > 0
            ? ` - device thresholds: ${limits.join(", ")}`
            : " - the device reports no thresholds"
        }`,
      );
    }

    return lines;
  }

  /*
   * The optics an investigation is about: the port the alert names (its
   * series labels, or a port named in its root cause), every optic with a
   * problem, then the rest - up to MAX_TRANSCEIVERS_IN_CONTEXT.
   */
  public static pickRelevant(data: {
    transceivers: Array<NetworkDeviceTransceiver>;
    focusText?: string | undefined;
    seriesLabels?: JSONObject | undefined;
  }): Array<NetworkDeviceTransceiver> {
    const labelNames: Array<string> = [
      data.seriesLabels?.["interfaceName"],
      data.seriesLabels?.["interfaceAlias"],
    ]
      .filter((value: unknown): value is string => {
        return typeof value === "string" && value.trim().length > 0;
      })
      .map((value: string) => {
        return value.trim().toLowerCase();
      });

    const focusText: string = (data.focusText || "").toLowerCase();

    const isFocus: (transceiver: NetworkDeviceTransceiver) => boolean = (
      transceiver: NetworkDeviceTransceiver,
    ): boolean => {
      const names: Array<string> = [
        transceiver.interfaceName,
        transceiver.interfaceAlias,
      ]
        .filter((value: string | undefined): value is string => {
          return Boolean(value && value.trim());
        })
        .map((value: string) => {
          return value.trim().toLowerCase();
        });

      return names.some((name: string) => {
        return (
          labelNames.includes(name) ||
          (name.length >= 3 &&
            NetworkTransceiverContext.mentionsPort(focusText, name))
        );
      });
    };

    const ranked: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.sortForDisplay(data.transceivers).sort(
        (a: NetworkDeviceTransceiver, b: NetworkDeviceTransceiver) => {
          return (isFocus(a) ? 0 : 1) - (isFocus(b) ? 0 : 1);
        },
      );

    return ranked.slice(0, MAX_TRANSCEIVERS_IN_CONTEXT);
  }

  // The markdown section an investigation's context ends with.
  public static renderSection(data: {
    devices: Array<TransceiverDevice>;
    focusText?: string | undefined;
    seriesLabels?: JSONObject | undefined;
  }): string {
    const blocks: Array<string> = [];

    for (const device of data.devices) {
      if (device.transceivers.length === 0) {
        continue;
      }

      const relevant: Array<NetworkDeviceTransceiver> =
        NetworkTransceiverContext.pickRelevant({
          transceivers: device.transceivers,
          focusText: data.focusText,
          seriesLabels: data.seriesLabels,
        });

      const summary: ReturnType<typeof TransceiverHealthUtil.summarize> =
        TransceiverHealthUtil.summarize(device.transceivers);

      const lines: Array<string> = [
        `### ${device.name || "Network device"}`,
        `${summary.total} transceiver(s): ${summary.notDetected} not detected, ${summary.alarm} past an alarm threshold, ${summary.warning} past a warning threshold, ${summary.healthy} healthy${
          summary.notJudged > 0
            ? `, ${summary.notJudged} without thresholds to judge by`
            : ""
        }${summary.portDisabled > 0 ? `, ${summary.portDisabled} in disabled ports` : ""}.`,
      ];

      for (const transceiver of relevant) {
        lines.push(
          `- ${JSON.stringify(NetworkTransceiverContext.toRow(transceiver))}`,
        );
      }

      if (relevant.length < device.transceivers.length) {
        lines.push(
          `- ${device.transceivers.length - relevant.length} more transceiver(s) not listed; read them with query_network_transceivers.`,
        );
      }

      blocks.push(lines.join("\n"));
    }

    if (blocks.length === 0) {
      return "";
    }

    return `\n\n## Transceivers (SFP, SFP+, QSFP optics) of the affected network device\nAs of the device's last poll. "health" is judged against the device's own warning and alarm thresholds; "rxPowerDropFromBestDayDb" is how far the received power is below its best daily average of the last ${TRANSCEIVER_RX_BASELINE_DAYS} days. A port whose optic is "not detected" had one and lost it while the port stayed enabled.\n\n${blocks.join("\n\n")}`;
  }

  /*
   * The section for an alert or incident: empty unless one of its monitors
   * is a Network Device monitor whose device reports transceivers. Never
   * throws for a missing monitor or device - it is enrichment.
   */
  public static async buildContextSection(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    focusText?: string | undefined;
    seriesLabels?: JSONObject | undefined;
  }): Promise<string> {
    if (data.monitorIds.length === 0) {
      return "";
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(
          data.monitorIds.map((monitorId: ObjectID) => {
            return monitorId.toString();
          }),
        ),
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
        monitorSteps: true,
      },
      limit: data.monitorIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const deviceIds: Set<string> = new Set<string>();

    for (const monitor of monitors) {
      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || ([] as Array<MonitorStep>)) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;

        if (deviceId) {
          deviceIds.add(deviceId);
        }
      }
    }

    if (deviceIds.size === 0) {
      return "";
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(deviceIds)),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        transceiverSnapshot: true,
      },
      limit: deviceIds.size,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return NetworkTransceiverContext.renderSection({
      devices: devices.map((device: NetworkDevice): TransceiverDevice => {
        return {
          name: device.name,
          transceivers: Array.isArray(device.transceiverSnapshot)
            ? device.transceiverSnapshot
            : [],
        };
      }),
      focusText: data.focusText,
      seriesLabels: data.seriesLabels,
    });
  }

  /*
   * Whether a (lower-cased) text names a (lower-cased) port as a whole word,
   * not as the start of a longer port name.
   */
  public static mentionsPort(text: string, portName: string): boolean {
    let from: number = 0;

    for (;;) {
      const at: number = text.indexOf(portName, from);

      if (at === -1) {
        return false;
      }

      const before: string = at > 0 ? text.charAt(at - 1) : "";
      const after: string = text.charAt(at + portName.length);

      if (
        !PORT_NAME_CHARACTER_REGEX.test(before) &&
        !PORT_NAME_CHARACTER_REGEX.test(after)
      ) {
        return true;
      }

      from = at + 1;
    }
  }

  // Whether an optic needs a look: anything but healthy, unjudged or disabled.
  public static hasProblem(transceiver: NetworkDeviceTransceiver): boolean {
    return (
      transceiver.health === TransceiverHealth.NotDetected ||
      transceiver.health === TransceiverHealth.Alarm ||
      transceiver.health === TransceiverHealth.Warning
    );
  }
}
