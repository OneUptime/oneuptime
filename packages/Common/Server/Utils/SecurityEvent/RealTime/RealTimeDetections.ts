import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { DETECTION_REAL_TIME_RULES_MAX } from "../../../../Types/SecurityEvent/RealTimeDetection";
import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import DetectionRuleService from "../../../Services/DetectionRuleService";
import EventLoop from "../../EventLoop";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { screenSecurityEventRow } from "./RealTimeEventScreen";
import RealTimeJobs, {
  REAL_TIME_EVENTS_PER_JOB,
  REAL_TIME_RULES_CACHE_TTL_MS,
  RealTimeCandidate,
  RealTimeJobData,
} from "./RealTimeJobs";

// The jobs are RealTimeJobs': named here too, for the paths that write events and the Worker.
export {
  REAL_TIME_DETECTION_JOB,
  REAL_TIME_EVENTS_PER_JOB,
  REAL_TIME_FIRST_DELAY_MS,
  REAL_TIME_MAX_ATTEMPTS,
  REAL_TIME_RULES_CACHE_TTL_MS,
} from "./RealTimeJobs";
export type { RealTimeCandidate, RealTimeJobData } from "./RealTimeJobs";

/*
 * REAL-TIME DETECTION RULES (Types/SecurityEvent/RealTimeDetection): a rule
 * that fires on one event checks each event as it reaches OneUptime.
 *
 * Every path that writes security events from a source - the ingest API,
 * the connections, Your logs, Your OneUptime data, Data Security's changes -
 * hands the rows it just wrote to `screen`. It reads the project's real-time
 * rules (kept for REAL_TIME_RULES_CACHE_TTL_MS, so a rule turned on or off
 * takes effect within half a minute) and screens every row against each in
 * memory (RealTimeEventScreen), never throwing into the write. A rule with
 * candidates gets a job, a few seconds later (RealTimeDetectionJob), that
 * confirms them with the rule's own query restricted to those events by
 * id, and does what a scheduled run does with what matches: an alert, an
 * incident if asked for, a finding, a case, risk.
 *
 * The engine's own findings are written past this - a finding is not an
 * event a source sent - and so is the setup test's attack, which runs every
 * rule over its own events (SecuritySetup).
 *
 * A rule that starts to run in real time gets a handover (RealTimeJobs):
 * one read of what arrived since its schedule stopped, until every
 * process screens for it.
 */

// The most projects whose rules one process keeps; the oldest go first.
export const REAL_TIME_RULES_CACHE_MAX_PROJECTS: number = 10000;

// The most candidates one rule takes from one write; a rule that matches more is too noisy for real time.
export const REAL_TIME_MAX_CANDIDATES_PER_WRITE: number = 5000;

// Room around the events' own times for the confirming read.
export const REAL_TIME_TIME_PADDING_MS: number = 1000;

// Rows screened between turns of the event loop.
const ROWS_PER_TURN: number = 500;

export interface RealTimeRule {
  id: string;
  rule: SigmaRule;
}

interface CachedProject {
  loadedAtMs: number;
  rules: Array<RealTimeRule>;
}

// A row's time as it is written for ClickHouse ("2026-10-30 09:00:00.000"), as a Date.
export function readRowTime(value: JSONValue | undefined): Date | null {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return null;
  }

  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export default class RealTimeDetections {
  private static cache: Map<string, CachedProject> = new Map();
  private static loading: Map<string, Promise<Array<RealTimeRule>>> = new Map();

  // Forget every project's rules: tests, and nothing else.
  public static clearCache(): void {
    this.cache.clear();
    this.loading.clear();
  }

  // The project's real-time rules, from the cache while it is fresh.
  public static async getRules(
    projectId: ObjectID,
  ): Promise<Array<RealTimeRule>> {
    const key: string = projectId.toString();
    const cached: CachedProject | undefined = this.cache.get(key);
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (cached && now - cached.loadedAtMs < REAL_TIME_RULES_CACHE_TTL_MS) {
      return cached.rules;
    }

    // One read at a time per project, however many writes arrive meanwhile.
    let load: Promise<Array<RealTimeRule>> | undefined = this.loading.get(key);

    if (!load) {
      load = this.loadRules(projectId).finally((): void => {
        this.loading.delete(key);
      });
      this.loading.set(key, load);
    }

    const rules: Array<RealTimeRule> = await load;

    this.cache.delete(key);

    // The oldest project's rules make room: a Map keeps the order they were set in.
    while (this.cache.size >= REAL_TIME_RULES_CACHE_MAX_PROJECTS) {
      const oldest: string | undefined = this.cache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.cache.delete(oldest);
    }

    this.cache.set(key, { loadedAtMs: now, rules });

    return rules;
  }

  private static async loadRules(
    projectId: ObjectID,
  ): Promise<Array<RealTimeRule>> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
      query: {
        projectId,
        isEnabled: true,
        isRealTime: true,
      },
      select: {
        _id: true,
        sigmaRuleYaml: true,
      },
      skip: 0,
      limit: DETECTION_REAL_TIME_RULES_MAX,
      props: {
        isRoot: true,
      },
    });

    const parsed: Array<RealTimeRule> = [];

    for (const rule of rules) {
      try {
        const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
          rule.sigmaRuleYaml || "",
        );

        // Only a rule that fires on one event saves as real time; anything else is the schedule's.
        if (definition.kind === "single" && rule.id) {
          parsed.push({ id: rule.id.toString(), rule: definition.rule });
        }
      } catch (error) {
        logger.error(
          `RealTimeDetections: rule ${rule.id?.toString() || ""} could not be read:`,
        );
        logger.error(error);
      }
    }

    return parsed;
  }

  /*
   * A write's half: the rows it just stored, screened against the
   * project's real-time rules, and a confirming job queued for each rule
   * with candidates. Returns how many jobs were queued. Never throws: a
   * write is never failed for a detection.
   */
  @CaptureSpan()
  public static async screen(data: {
    projectId: ObjectID;
    rows: Array<JSONObject>;
  }): Promise<number> {
    try {
      if (data.rows.length === 0) {
        return 0;
      }

      const rules: Array<RealTimeRule> = await this.getRules(data.projectId);

      if (rules.length === 0) {
        return 0;
      }

      let jobs: number = 0;
      let screened: number = 0;

      for (const rule of rules) {
        const candidates: Array<RealTimeCandidate> = [];

        for (const row of data.rows) {
          if (screened++ % ROWS_PER_TURN === ROWS_PER_TURN - 1) {
            await EventLoop.yieldToEventLoop();
          }

          if (candidates.length >= REAL_TIME_MAX_CANDIDATES_PER_WRITE) {
            break;
          }

          if (screenSecurityEventRow(rule.rule, row) === "no") {
            continue;
          }

          const id: JSONValue | undefined = row["_id"];
          const time: Date | null = readRowTime(row["time"]);

          if (typeof id === "string" && id && time) {
            candidates.push({ id, time: time.toISOString() });
          }
        }

        for (
          let offset: number = 0;
          offset < candidates.length;
          offset += REAL_TIME_EVENTS_PER_JOB
        ) {
          await this.enqueue({
            projectId: data.projectId.toString(),
            ruleId: rule.id,
            events: candidates.slice(offset, offset + REAL_TIME_EVENTS_PER_JOB),
            attempt: 1,
          });
          jobs++;
        }
      }

      return jobs;
    } catch (error) {
      logger.error(
        `RealTimeDetections: events of project ${data.projectId.toString()} could not be screened:`,
      );
      logger.error(error);
      return 0;
    }
  }

  // A confirming job (RealTimeJobs.enqueue).
  public static async enqueue(job: RealTimeJobData): Promise<void> {
    await RealTimeJobs.enqueue(job);
  }
}
