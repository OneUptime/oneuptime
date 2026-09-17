import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
} from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import ProbeService from "../../Services/ProbeService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";

/*
 * Captures the "Monitor Summary" that an incident or alert is about to be
 * created from, so the incident page can show what the monitor saw even
 * after the evidence is gone.
 *
 * It has to be gone: MonitorLog rows are dropped by a ClickHouse TTL whose
 * default is one day (MonitorLogUtil), and MonitorProbe.lastMonitoringLog
 * is overwritten on the very next check. Without this the summary card on
 * an incident older than a day would always be empty.
 *
 * The routing itself is the pure MonitorSummarySnapshotUtil; this wrapper
 * exists only for the one thing that needs the database - turning a probe
 * id into a probe name, which every probeable summary view renders.
 */
export default class MonitorSummaryCapture {
  @CaptureSpan()
  public static async capture(input: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    /*
     * Already resolved by the caller for probeable monitors. Passed in so
     * the common path costs no extra query.
     */
    probeName?: string | undefined;
  }): Promise<MonitorSummarySnapshot | null> {
    try {
      if (!input.monitor.monitorType) {
        return null;
      }

      const probeName: string | undefined =
        input.probeName ||
        (await this.resolveProbeName({
          probeId: (input.dataToProcess as ProbeMonitorResponse | undefined)
            ?.probeId,
        }));

      return MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: input.monitor.monitorType,
        dataToProcess: input.dataToProcess as MonitorSummaryDataToProcess,
        monitorId: input.monitor.id?.toString(),
        monitorName: input.monitor.name || undefined,
        probeName: probeName,
        evaluationSummary: input.evaluationSummary,
        capturedAt: OneUptimeDate.getCurrentDate(),
      });
    } catch (err) {
      /*
       * A summary is evidence, not a precondition. This runs inside the
       * probe / telemetry ingest workers, where a throw fails the whole
       * job and retries forever - losing the incident itself, which is the
       * thing that actually matters.
       */
      logger.error(
        `${input.monitor.id?.toString()} - Could not capture the monitor summary for this evaluation. The incident / alert will be created without it.`,
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Only reached for monitor types the caller does not pre-resolve a probe
   * name for - Network Device is the one that matters, because it is not a
   * "probeable" monitor (the device owns its polling schedule) yet its
   * walk and trap results do arrive as a ProbeMonitorResponse with a
   * probeId on them.
   */
  private static async resolveProbeName(input: {
    probeId?: ObjectID | undefined;
  }): Promise<string | undefined> {
    if (!input.probeId) {
      return undefined;
    }

    const probe: Probe | null = await ProbeService.findOneById({
      id: new ObjectID(input.probeId.toString()),
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return probe?.name || undefined;
  }
}
