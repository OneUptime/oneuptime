import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import MonitorSummarySnapshot from "../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
  MonitorSummaryInfoProps,
} from "./MonitorSummarySnapshotUtil";

/*
 * The "View Summary" modal on a monitor's Monitoring Logs page.
 *
 * A MonitorLog row's logBody is the payload one evaluation ran on: the same
 * DataToProcess an incident captures as its monitor summary, written with a
 * plain JSON round trip (MonitorLogUtil.saveMonitorLog). So the modal routes
 * it through MonitorSummarySnapshotUtil instead of keeping a table of its
 * own. The page used to hand the body to every SummaryInfo slot except the
 * email one, and every row of an Incoming Email monitor read "no email has
 * been received yet" - one routing table for incidents, alerts and logs is
 * what stops a monitor type from going missing in one of them.
 *
 * Pure, like the snapshot util, so it is tested without React.
 */
export default class MonitorLogSummaryUtil {
  public static toSummaryInfoProps(data: {
    monitorType: MonitorType;
    logBody: JSONObject | null | undefined;
    /*
     * The row's time. Telemetry monitors show it as "Monitored At"; a
     * payload of theirs carries no time of its own.
     */
    monitoredAt?: Date | undefined;
    // Only a probe check has one.
    probeName?: string | undefined;
  }): MonitorSummaryInfoProps {
    const typeOnly: MonitorSummaryInfoProps = {
      monitorType: data.monitorType,
    };

    if (
      !data.logBody ||
      typeof data.logBody !== "object" ||
      Array.isArray(data.logBody)
    ) {
      return typeOnly;
    }

    /*
     * The ObjectIDs in a stored body are wrapped by their toJSON, and its
     * dates are ISO strings. deserialize() restores what JSONFunctions
     * recognises and leaves the rest as it is, which the views render.
     */
    const dataToProcess: MonitorSummaryDataToProcess =
      JSONFunctions.deserialize(
        data.logBody,
      ) as unknown as MonitorSummaryDataToProcess;

    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: data.monitorType,
        dataToProcess: dataToProcess,
        probeName: data.probeName,
        /*
         * Only a telemetry summary reads this, and it is dropped below when
         * the row has no time.
         */
        capturedAt: data.monitoredAt || new Date(),
        /*
         * The size budget bounds what an incident stores. A log row is
         * already stored, and the modal shows all of it: a synthetic check
         * keeps its screenshots.
         */
        maxSizeInBytes: 0,
      });

    if (!snapshot) {
      return typeOnly;
    }

    const props: MonitorSummaryInfoProps =
      MonitorSummarySnapshotUtil.toSummaryInfoProps(snapshot);

    if (!data.monitoredAt && props.telemetryMonitorSummary) {
      // Better "-" than the moment the modal was opened.
      delete props.telemetryMonitorSummary;
    }

    return props;
  }

  /*
   * The id of the probe that ran the check, if the row names one. A stored
   * body carries it the way ObjectID serialises itself,
   * {"_type": "ObjectID", "value": "..."}, so the page's old
   * `probeId.toString()` produced "[object Object]", matched no probe, and
   * the Probe column read "Unknown" on every row. A plain string, or an
   * ObjectID from a body that was already deserialized, is taken as is.
   */
  public static getProbeId(
    logBody: JSONObject | null | undefined,
  ): string | undefined {
    if (!logBody || typeof logBody !== "object") {
      return undefined;
    }

    const probeId: unknown = logBody["probeId"];

    if (typeof probeId === "string") {
      return probeId || undefined;
    }

    if (probeId instanceof ObjectID) {
      return probeId.toString() || undefined;
    }

    if (probeId && typeof probeId === "object") {
      const value: unknown = (probeId as JSONObject)["value"];

      if (typeof value === "string" && value) {
        return value;
      }
    }

    return undefined;
  }
}
