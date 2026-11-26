import CloudCostReport from "../../../Models/DatabaseModels/CloudCostReport";
import OneUptimeDate from "../../../Types/Date";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceSummaryScheduleUtil from "../../../Utils/Workspace/WorkspaceSummarySchedule";
import CloudCostReportService from "../../Services/CloudCostReportService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudCostReportSender, {
  CloudCostReportSendResult,
  isCloudCostReportDelivered,
} from "./CloudCostReportSender";

/*
 * WHEN SCHEDULED COST REPORTS GO OUT (#11009).
 *
 * A report's schedule follows the workspace summaries' rules
 * (WorkspaceSummaryScheduleUtil): weekly or monthly, at the same time of
 * day in its time zone all year. Each minute (Cloud:SendCloudCostReports)
 * the reports whose next send has come are:
 *
 *   1. claimed: the next send moved to the schedule's next occurrence in
 *      one statement that matches only the next send it read
 *      (compareAndSetColumnsByIdWithoutHooks), so of two replicas that read
 *      the same report one sends it and the other moves on;
 *   2. sent, for the days of the send that was due - a worker that was down
 *      on Monday still sends last week, not the week after - and a send
 *      long past is sent once, never caught up on with one a minute;
 *   3. recorded: what the send did (CloudCostReportSendResult), and when it
 *      last reached anyone.
 */

// The most reports one tick sends: the rest wait for the next minute.
export const CLOUD_COST_REPORTS_PER_TICK: number = 20;

export default class CloudCostReportSchedule {
  @CaptureSpan()
  public static async sendDue(now?: Date | undefined): Promise<number> {
    const at: Date = now || OneUptimeDate.getCurrentDate();
    const due: Array<CloudCostReport> = await CloudCostReportService.findBy({
      query: {
        isEnabled: true,
        nextSendAt: QueryHelper.lessThanEqualTo(at),
      },
      select: {
        _id: true,
        nextSendAt: true,
        recurringInterval: true,
        sendFirstReportAt: true,
        timezone: true,
      },
      sort: { nextSendAt: "Ascending" } as never,
      skip: 0,
      limit: CLOUD_COST_REPORTS_PER_TICK,
      props: { isRoot: true },
    });

    let sent: number = 0;

    for (const report of due) {
      if (!report.id || !report.nextSendAt || !report.recurringInterval) {
        continue;
      }

      try {
        if (await this.claimAndSend(report, at)) {
          sent++;
        }
      } catch (error) {
        logger.error(
          `Cloud cost report ${report.id.toString()} could not be sent:`,
        );
        logger.error(error);
      }
    }

    return sent;
  }

  /*
   * One due report: claimed, sent for the days of the send that was due,
   * and its result kept. False when another worker claimed it first.
   */
  public static async claimAndSend(
    report: CloudCostReport,
    now: Date,
  ): Promise<boolean> {
    const dueAt: Date = report.nextSendAt!;
    const nextSendAt: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt,
      recurringInterval: report.recurringInterval as Recurring | JSONObject,
      sendFirstReportAt: report.sendFirstReportAt,
      timezone: report.timezone,
      now,
    });

    const isClaimed: boolean =
      await CloudCostReportService.compareAndSetColumnsByIdWithoutHooks({
        id: report.id!,
        data: { nextSendAt },
        expectedData: { nextSendAt: dueAt },
      });

    if (!isClaimed) {
      return false;
    }

    const result: CloudCostReportSendResult = await CloudCostReportSender.send({
      reportId: report.id!,
      at: dueAt,
    });

    await this.recordResult({ reportId: report.id!, result, now });

    return true;
  }

  // What a send did, kept on its report: when it last reached anyone too.
  public static async recordResult(data: {
    reportId: ObjectID;
    result: CloudCostReportSendResult;
    now: Date;
  }): Promise<void> {
    const written: CloudCostReport = new CloudCostReport();
    written.lastSendResult = data.result as unknown as JSONObject;

    if (isCloudCostReportDelivered(data.result)) {
      written.lastSentAt = data.now;
    }

    await CloudCostReportService.updateOneById({
      id: data.reportId,
      data: written as never,
      props: { isRoot: true },
    });
  }
}
