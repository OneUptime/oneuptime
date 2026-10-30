import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DbJSONResponse,
  Results,
} from "../../../Services/AnalyticsDatabaseService";
import DetectionRuleService from "../../../Services/DetectionRuleService";
import SecurityEventService from "../../../Services/SecurityEventService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DetectionRuleEvaluator, {
  DETECTION_RULE_REAL_TIME_SELECT,
} from "../DetectionRuleEvaluator";
import RealTimeDetections, {
  REAL_TIME_EVENTS_PER_JOB,
  REAL_TIME_MAX_ATTEMPTS,
  REAL_TIME_TIME_PADDING_MS,
  RealTimeCandidate,
  RealTimeJobData,
} from "./RealTimeDetections";

/*
 * THE WORKER'S HALF OF A REAL-TIME RULE (RealTimeDetections screens, this
 * confirms): the candidates one write handed one rule, confirmed with the
 * rule's own query - exceptions and watchlists included - restricted to
 * them by id, once they can be read (DetectionRuleEvaluator.evaluateRealTime),
 * which does what a scheduled run does with what matches.
 *
 * Kept apart from the screen, so every path that writes security events
 * loads the screen alone and never the engine.
 */

// What a job carries, read defensively: a job written by an older version, or a broken one, names nothing.
export function readRealTimeJobData(value: unknown): RealTimeJobData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data: JSONObject = value as JSONObject;
  const projectId: unknown = data["projectId"];
  const ruleId: unknown = data["ruleId"];

  if (
    typeof projectId !== "string" ||
    !ObjectID.isValidUUID(projectId) ||
    typeof ruleId !== "string" ||
    !ObjectID.isValidUUID(ruleId)
  ) {
    return null;
  }

  const events: Array<RealTimeCandidate> = [];

  for (const item of Array.isArray(data["events"]) ? data["events"] : []) {
    const record: JSONObject =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as JSONObject)
        : {};
    const id: unknown = record["id"];
    const time: unknown = record["time"];

    if (
      typeof id === "string" &&
      id &&
      typeof time === "string" &&
      !Number.isNaN(new Date(time).getTime())
    ) {
      events.push({ id, time });
    }

    if (events.length >= REAL_TIME_EVENTS_PER_JOB) {
      break;
    }
  }

  const attempt: number = Number(data["attempt"]);

  return {
    projectId,
    ruleId,
    events,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
  };
}

export default class RealTimeDetectionJob {
  // The events of a job that can be read now: inserts are buffered, so not always all of them.
  public static async countReadable(data: {
    projectId: ObjectID;
    ids: Array<string>;
    startTime: Date;
    endTime: Date;
  }): Promise<number> {
    if (!SecurityEventService.database) {
      SecurityEventService.useDefaultDatabase();
    }

    const statement: Statement = SQL`SELECT count() AS readable FROM `;
    statement.append(
      `${SecurityEventService.database.getDatasourceOptions().database!}.${SecurityEventService.model.tableName}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.startTime,
      }} AND time < ${{
        type: TableColumnType.DateTime64,
        value: data.endTime,
      }} AND _id IN ${{ type: TableColumnType.ArrayText, value: data.ids }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 30,
        timeoutOverflowMode: "throw",
      }),
    );

    const results: Results = await SecurityEventService.executeQuery(statement);
    const response: DbJSONResponse = await results.json<{
      data?: Array<JSONObject>;
    }>();
    const first: JSONObject | undefined = (
      response.data as unknown as Array<JSONObject> | undefined
    )?.[0];

    return Number(first?.["readable"] || 0);
  }

  /*
   * Confirm one job's candidates: a rule turned off, or back on its
   * schedule, since they were screened confirms nothing; events that
   * cannot all be read yet are waited for again, twice as long, at most
   * REAL_TIME_MAX_ATTEMPTS times, and then what can be read is confirmed.
   */
  @CaptureSpan()
  public static async evaluate(job: RealTimeJobData): Promise<void> {
    if (job.events.length === 0) {
      return;
    }

    const projectId: ObjectID = new ObjectID(job.projectId);
    const rule: DetectionRule | null = await DetectionRuleService.findOneBy({
      query: {
        _id: job.ruleId,
        projectId,
      },
      select: DETECTION_RULE_REAL_TIME_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!rule || rule.isEnabled === false || rule.isRealTime !== true) {
      return;
    }

    const times: Array<number> = job.events.map(
      (event: RealTimeCandidate): number => {
        return new Date(event.time).getTime();
      },
    );
    const startTime: Date = new Date(
      Math.min(...times) - REAL_TIME_TIME_PADDING_MS,
    );
    const endTime: Date = new Date(
      Math.max(...times) + REAL_TIME_TIME_PADDING_MS,
    );
    const ids: Array<string> = job.events.map(
      (event: RealTimeCandidate): string => {
        return event.id;
      },
    );

    const readable: number = await this.countReadable({
      projectId,
      ids,
      startTime,
      endTime,
    });

    if (readable < ids.length && job.attempt < REAL_TIME_MAX_ATTEMPTS) {
      await RealTimeDetections.enqueue({ ...job, attempt: job.attempt + 1 });
      return;
    }

    if (readable === 0) {
      logger.warn(
        `RealTimeDetectionJob: none of the ${ids.length} events rule ${job.ruleId} was handed could be read after ${job.attempt} attempts.`,
      );
      return;
    }

    await DetectionRuleEvaluator.evaluateRealTime(rule, {
      restrictTo: SQL`_id IN ${{ type: TableColumnType.ArrayText, value: ids }}`,
      startTime,
      endTime,
    });
  }
}
