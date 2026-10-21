import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import QueryHelper from "../../Types/Database/QueryHelper";

// An alert or incident a monitor's criteria opened and that is still open.
export interface OpenCriteriaRecord {
  createdCriteriaId: string | undefined;
  // Set on a per-series record, absent on one for the whole monitor.
  seriesFingerprint: string | undefined;
}

/**
 * Whether a criteria is already in effect for a series of a monitor - for
 * the whole monitor when the series is undefined.
 *
 * A criteria that opens alerts or incidents is in effect for a series while
 * one it opened for that series is still open. A criteria that only sets the
 * monitor's status is in effect while the monitor has that status: a status
 * is the only trace such a criteria leaves, and acting on it again would
 * change nothing.
 *
 * "All Values" over a metric monitor's time range waits for a series' data
 * to cover the range before it matches (issue #4793), but only a criteria
 * that has not acted yet waits: once it is in effect, its series are judged
 * on their data points as they always were. So a short gap in a firing
 * series' data neither resolves its alert nor opens a new one a window
 * later, and only what is about to be opened has to prove itself over the
 * whole window.
 *
 * The open alerts and incidents are read once per evaluation, and only when
 * a series is waiting - which, past the first window, is rare.
 */
export default class CriteriaInEffect {
  private readonly monitor: Monitor;

  private readonly readOpenRecords:
    | (() => Promise<Array<OpenCriteriaRecord>>)
    | null;

  private openRecords: Promise<Array<OpenCriteriaRecord>> | null = null;

  /*
   * Without readOpenRecords no alert or incident counts as open: what the
   * criteria evaluator falls back to when its caller hands it none.
   */
  public constructor(data: {
    monitor: Monitor;
    readOpenRecords?: (() => Promise<Array<OpenCriteriaRecord>>) | undefined;
  }) {
    this.monitor = data.monitor;
    this.readOpenRecords = data.readOpenRecords || null;
  }

  // Reads the monitor's open alerts and incidents from the database.
  public static forMonitor(monitor: Monitor): CriteriaInEffect {
    return new CriteriaInEffect({
      monitor: monitor,
      readOpenRecords: () => {
        return CriteriaInEffect.readOpenRecordsOf(monitor);
      },
    });
  }

  public async isInEffect(data: {
    criteriaInstance: MonitorCriteriaInstance | undefined;
    seriesFingerprint: string | undefined;
  }): Promise<boolean> {
    const criteria: MonitorCriteriaInstance["data"] | undefined =
      data.criteriaInstance?.data;

    if (!criteria?.id) {
      return false;
    }

    if (CriteriaInEffect.opensRecords(criteria)) {
      if (!this.readOpenRecords) {
        return false;
      }

      if (!this.openRecords) {
        this.openRecords = this.readOpenRecords();
      }

      const records: Array<OpenCriteriaRecord> = await this.openRecords;
      const criteriaId: string = criteria.id.toString();
      const seriesFingerprint: string = data.seriesFingerprint || "";

      return records.some((record: OpenCriteriaRecord) => {
        return (
          record.createdCriteriaId === criteriaId &&
          (record.seriesFingerprint || "") === seriesFingerprint
        );
      });
    }

    if (criteria.changeMonitorStatus && criteria.monitorStatusId) {
      return (
        Boolean(this.monitor.currentMonitorStatusId) &&
        this.monitor.currentMonitorStatusId!.toString() ===
          criteria.monitorStatusId.toString()
      );
    }

    return false;
  }

  /*
   * A criteria opens records when it is switched on to open alerts or
   * incidents and has at least one to open.
   */
  private static opensRecords(
    criteria: NonNullable<MonitorCriteriaInstance["data"]>,
  ): boolean {
    return (
      (Boolean(criteria.createIncidents) &&
        (criteria.incidents || []).length > 0) ||
      (Boolean(criteria.createAlerts) && (criteria.alerts || []).length > 0)
    );
  }

  private static async readOpenRecordsOf(
    monitor: Monitor,
  ): Promise<Array<OpenCriteriaRecord>> {
    if (!monitor.id || !monitor.projectId) {
      return [];
    }

    const projectId: ObjectID = monitor.projectId;

    /*
     * Open: in a state above the project's resolved state, as the resolve
     * passes read them (MonitorAlert / MonitorIncident).
     */
    const [openAlerts, openIncidents]: [Array<Alert>, Array<Incident>] =
      await Promise.all([
        (async (): Promise<Array<Alert>> => {
          return await AlertService.findBy({
            query: {
              monitor: monitor.id!,
              currentAlertStateId: QueryHelper.any(
                await AlertStateService.getUnresolvedAlertStateIds(projectId),
              ),
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            select: {
              _id: true,
              createdCriteriaId: true,
              seriesFingerprint: true,
            },
            props: {
              isRoot: true,
            },
          });
        })(),
        (async (): Promise<Array<Incident>> => {
          return await IncidentService.findBy({
            query: {
              monitors: [monitor.id!],
              currentIncidentStateId: QueryHelper.any(
                await IncidentStateService.getUnresolvedIncidentStateIds(
                  projectId,
                ),
              ),
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            select: {
              _id: true,
              createdCriteriaId: true,
              seriesFingerprint: true,
            },
            props: {
              isRoot: true,
            },
          });
        })(),
      ]);

    return [...openAlerts, ...openIncidents].map(
      (record: Alert | Incident): OpenCriteriaRecord => {
        return {
          createdCriteriaId: record.createdCriteriaId?.toString() || undefined,
          seriesFingerprint: record.seriesFingerprint || undefined,
        };
      },
    );
  }
}
