import Project from "../../../../Models/DatabaseModels/Project";
import SecurityEntityRisk from "../../../../Models/DatabaseModels/SecurityEntityRisk";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import ProjectService from "../../../Services/ProjectService";
import SecurityEntityCriticalityService from "../../../Services/SecurityEntityCriticalityService";
import SecurityEntityRiskService from "../../../Services/SecurityEntityRiskService";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../SecurityCase/SecurityCaseIngest";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { buildEntityRiskSignal } from "./SecurityEntityRiskCases";
import { SecurityRiskFinding } from "./SecurityEntityRiskFindings";
import Includes from "../../../../Types/BaseDatabase/Includes";
import QueryHelper from "../../../Types/Database/QueryHelper";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import { JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_HISTORY_IN_DAYS,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
} from "../../../../Types/SecurityCase/SecurityEntityRisk";
import {
  SecurityEntityCriticalityRule,
  SecurityEntityRiskObservation,
  SecurityEntityRiskSummary,
  addRiskObservation,
  computeEntityRisk,
  findEntityCriticalityRule,
  getEntityRiskKey,
  getRiskEntities,
  getRiskSinceLastCase,
  readRiskCaseThreshold,
  readRiskContributions,
  readRiskHistory,
  shouldRaiseRiskCase,
  updateRiskHistory,
} from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";

export interface SecurityEntityRiskRecordResult {
  entitiesUpdated: number;
  riskCasesRaised: number;
}

// The project's say in its risk: whether risk opens cases, and at what.
export interface SecurityEntityRiskSettings {
  isRiskCaseEnabled: boolean;
  threshold: number;
}

// The most entities one call takes in, per project.
export const ENTITY_RISK_ENTITIES_PER_CALL: number = 500;

// The most rows one turn of the refresh works out again, per project.
export const ENTITY_RISK_REFRESH_ROWS_PER_PROJECT: number = 2000;

// The most projects one turn of the refresh visits.
export const ENTITY_RISK_REFRESH_PROJECTS_PER_TURN: number = 500;

const LOCK_NAMESPACE: string = "SecurityEntityRisk";

const ROW_SELECT: {
  _id: true;
  entityType: true;
  entityValue: true;
  entityKey: true;
  contributions: true;
  riskHistory: true;
  riskCaseAt: true;
  riskScore: true;
  lastRiskAt: true;
} = {
  _id: true,
  entityType: true,
  entityValue: true,
  entityKey: true,
  contributions: true,
  riskHistory: true,
  riskCaseAt: true,
  riskScore: true,
  lastRiskAt: true,
};

interface EntityObservations {
  entity: SecurityEntity;
  observations: Array<SecurityEntityRiskObservation>;
}

/*
 * THE RISK OF EACH USER, HOST AND ADDRESS.
 *
 * Every detection source hands what it found here (SecurityRiskFinding:
 * a rule's matches, a feed's matches, a product's imported alerts), and each
 * finding adds its points to the risk of the entities it names - one row per
 * entity (SecurityEntityRisk), its sources in it
 * (Utils/SecurityCase/SecurityEntityRiskScore says how they count). When an
 * entity's risk from sources new since its last risk case reaches the
 * project's threshold, and the project opens cases from risk, a detection
 * about the entity is handed to the case ingest: it joins the open case
 * about the entity, or opens one.
 *
 * One project's risk is written under one lock, by the sources and by the
 * refresh every 15 minutes alike, so two of them never add to one row at
 * once. The cases are recorded once the lock is given back: the case ingest
 * takes the project's own lock, and nothing a playbook does should hold risk
 * up.
 *
 * Never throws: what was found is recorded already where it belongs, and
 * risk that could not be written must not fail the run that found it.
 */
export default class SecurityEntityRiskRecorder {
  @CaptureSpan()
  public static async record(
    findings: Array<SecurityRiskFinding>,
  ): Promise<SecurityEntityRiskRecordResult> {
    const result: SecurityEntityRiskRecordResult = {
      entitiesUpdated: 0,
      riskCasesRaised: 0,
    };

    const byProject: Map<string, Array<SecurityRiskFinding>> = new Map();

    for (const finding of findings) {
      if (!finding || !finding.projectId || finding.points <= 0) {
        continue;
      }

      const key: string = finding.projectId.toString();
      byProject.set(key, [...(byProject.get(key) || []), finding]);
    }

    for (const projectFindings of byProject.values()) {
      try {
        const projectResult: SecurityEntityRiskRecordResult =
          await this.recordProject(projectFindings);

        result.entitiesUpdated += projectResult.entitiesUpdated;
        result.riskCasesRaised += projectResult.riskCasesRaised;
      } catch (error) {
        logger.error(
          `SecurityEntityRiskRecorder: could not record the risk of project ${projectFindings[0]!.projectId.toString()}'s findings:`,
        );
        logger.error(error);
      }
    }

    return result;
  }

  // Whether the project opens cases from risk, and at what (defaults when unread).
  public static async getSettings(
    projectId: ObjectID,
  ): Promise<SecurityEntityRiskSettings> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableSecurityRiskCases: true,
        securityRiskCaseThreshold: true,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      isRiskCaseEnabled: project?.enableSecurityRiskCases === true,
      threshold: readRiskCaseThreshold(project?.securityRiskCaseThreshold),
    };
  }

  private static async lockProject(
    projectId: ObjectID,
  ): Promise<SemaphoreMutex> {
    return Semaphore.lock({
      key: projectId.toString(),
      namespace: LOCK_NAMESPACE,
      lockTimeout: 120000,
      acquireTimeout: 120000,
    });
  }

  private static async recordProject(
    findings: Array<SecurityRiskFinding>,
  ): Promise<SecurityEntityRiskRecordResult> {
    const projectId: ObjectID = findings[0]!.projectId;
    const signals: Array<SecurityDetectionSignal> = [];
    let entitiesUpdated: number = 0;

    const mutex: SemaphoreMutex = await this.lockProject(projectId);

    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const settings: SecurityEntityRiskSettings =
        await this.getSettings(projectId);
      const rules: Array<SecurityEntityCriticalityRule> =
        await SecurityEntityCriticalityService.getRules(projectId);

      const byKey: Map<string, EntityObservations> = new Map();

      for (const finding of findings) {
        // A finding from the future (a skewed clock) counts from now.
        const seenAt: Date =
          finding.seenAt.getTime() > now.getTime() ? now : finding.seenAt;

        for (const entity of getRiskEntities(finding.entities)) {
          const key: string = getEntityRiskKey(entity.value);

          if (!byKey.has(key)) {
            if (byKey.size >= ENTITY_RISK_ENTITIES_PER_CALL) {
              continue;
            }

            byKey.set(key, { entity, observations: [] });
          }

          byKey.get(key)!.observations.push({
            sourceKey: finding.sourceKey,
            source: finding.source,
            sourceName: finding.sourceName,
            severity: finding.severity,
            points: finding.points,
            seenAt,
            mitreTactics: finding.mitreTactics,
            mitreTechniques: finding.mitreTechniques,
            detectionRuleId: finding.detectionRuleId?.toString(),
            threatIntelFeedId: finding.threatIntelFeedId?.toString(),
            securityEventConnectionId:
              finding.securityEventConnectionId?.toString(),
          });
        }
      }

      if (byKey.size === 0) {
        return { entitiesUpdated: 0, riskCasesRaised: 0 };
      }

      const rows: Array<SecurityEntityRisk> =
        await SecurityEntityRiskService.findBy({
          query: {
            projectId,
            entityKey: new Includes(Array.from(byKey.keys())),
          },
          select: ROW_SELECT,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      const rowsByKey: Map<string, SecurityEntityRisk> = new Map();

      for (const row of rows) {
        if (row.entityKey) {
          rowsByKey.set(row.entityKey, row);
        }
      }

      for (const [key, entry] of byKey.entries()) {
        try {
          const row: SecurityEntityRisk | undefined = rowsByKey.get(key);

          let contributions: Array<SecurityEntityRiskContribution> =
            readRiskContributions(row?.contributions);

          for (const observation of [...entry.observations].sort(
            (
              a: SecurityEntityRiskObservation,
              b: SecurityEntityRiskObservation,
            ): number => {
              return a.seenAt.getTime() - b.seenAt.getTime();
            },
          )) {
            contributions = addRiskObservation(contributions, observation, now);
          }

          const signal: SecurityDetectionSignal | null = await this.writeRow({
            projectId,
            entityKey: key,
            entity: row
              ? {
                  type: row.entityType || entry.entity.type,
                  value: row.entityValue || entry.entity.value,
                }
              : entry.entity,
            row,
            contributions,
            rules,
            settings,
            now,
          });

          entitiesUpdated++;

          if (signal) {
            signals.push(signal);
          }
        } catch (error) {
          logger.error(
            `SecurityEntityRiskRecorder: could not record the risk of an entity of project ${projectId.toString()}:`,
          );
          logger.error(error);
        }
      }
    } finally {
      await Semaphore.release(mutex);
    }

    if (signals.length > 0) {
      try {
        await SecurityCaseIngest.recordDetections(signals);
      } catch (error) {
        logger.error(
          `SecurityEntityRiskRecorder: could not record project ${projectId.toString()}'s risk cases:`,
        );
        logger.error(error);
      }
    }

    return { entitiesUpdated, riskCasesRaised: signals.length };
  }

  /*
   * One entity's row once its sources are what they are now: its score and
   * criticality, its ATT&CK ids, when its next source stops counting, and
   * today's point of its history. Returns the detection its risk raises,
   * when it raises one, having marked the row with when.
   */
  private static async writeRow(data: {
    projectId: ObjectID;
    entityKey: string;
    entity: SecurityEntity;
    row: SecurityEntityRisk | undefined;
    contributions: Array<SecurityEntityRiskContribution>;
    rules: Array<SecurityEntityCriticalityRule>;
    settings: SecurityEntityRiskSettings;
    now: Date;
  }): Promise<SecurityDetectionSignal | null> {
    const { now, settings } = data;

    const criticality: SecurityEntityCriticality | null =
      findEntityCriticalityRule({ entity: data.entity, rules: data.rules })
        ?.criticality || null;

    const summary: SecurityEntityRiskSummary = computeEntityRisk({
      contributions: data.contributions,
      criticality,
      now,
    });

    const riskSinceLastCase: number = getRiskSinceLastCase({
      contributions: summary.contributors,
      riskCaseAt: data.row?.riskCaseAt || null,
      criticality,
      now,
    });

    const raisesCase: boolean = shouldRaiseRiskCase({
      isEnabled: settings.isRiskCaseEnabled,
      threshold: settings.threshold,
      riskSinceLastCase,
    });

    const history: JSONArray = updateRiskHistory(
      readRiskHistory(data.row?.riskHistory),
      summary.score,
      now,
    ) as unknown as JSONArray;

    const columns: {
      riskScore: number;
      criticality: SecurityEntityCriticality | null;
      contributorCount: number;
      contributions: JSONArray;
      mitreTactics: Array<string>;
      mitreTechniques: Array<string>;
      firstRiskAt: Date | null;
      lastRiskAt: Date | null;
      riskExpiresAt: Date | null;
      riskHistory: JSONArray;
      riskCaseAt?: Date | undefined;
    } = {
      riskScore: summary.score,
      criticality,
      contributorCount: summary.contributors.length,
      contributions: summary.contributors as unknown as JSONArray,
      mitreTactics: summary.mitreTactics,
      mitreTechniques: summary.mitreTechniques,
      firstRiskAt: summary.firstRiskAt,
      /*
       * When nothing counts any more, the last finding's time stays: it is
       * when the entity's risk went quiet, and what forgetting it reads.
       */
      lastRiskAt: summary.lastRiskAt || data.row?.lastRiskAt || null,
      riskExpiresAt: summary.expiresAt,
      riskHistory: history,
      ...(raisesCase ? { riskCaseAt: now } : {}),
    };

    if (data.row?.id) {
      // Typed as the update's own payload type, which the compiler need not unfold.
      const update: PartialEntity<SecurityEntityRisk> = {};
      const record: Record<string, unknown> = update as Record<string, unknown>;

      for (const [column, value] of Object.entries(columns)) {
        record[column] = value;
      }

      await SecurityEntityRiskService.updateColumnsByIdWithoutHooks({
        id: data.row.id,
        data: update,
      });
    } else {
      const risk: SecurityEntityRisk = new SecurityEntityRisk();
      risk.projectId = data.projectId;
      risk.entityType = data.entity.type;
      risk.entityValue = data.entity.value;
      risk.entityKey = data.entityKey;
      risk.riskScore = columns.riskScore;
      risk.contributorCount = columns.contributorCount;
      risk.contributions = columns.contributions;
      risk.mitreTactics = columns.mitreTactics;
      risk.mitreTechniques = columns.mitreTechniques;
      risk.riskHistory = columns.riskHistory;

      if (columns.criticality) {
        risk.criticality = columns.criticality;
      }

      if (columns.firstRiskAt) {
        risk.firstRiskAt = columns.firstRiskAt;
      }

      if (columns.lastRiskAt) {
        risk.lastRiskAt = columns.lastRiskAt;
      }

      if (columns.riskExpiresAt) {
        risk.riskExpiresAt = columns.riskExpiresAt;
      }

      if (columns.riskCaseAt) {
        risk.riskCaseAt = columns.riskCaseAt;
      }

      await SecurityEntityRiskService.create({
        data: risk,
        props: {
          isRoot: true,
        },
      });
    }

    if (!raisesCase) {
      return null;
    }

    return buildEntityRiskSignal({
      projectId: data.projectId,
      entity: data.entity,
      summary,
      criticality,
      threshold: settings.threshold,
      now,
    });
  }

  /*
   * One project's rows worked out again: those whose next source has
   * stopped counting by now (the refresh every 15 minutes), or every one (a
   * change to the project's Entity Criticality list, `isWhole`). A score
   * that falls never opens a case, but one that rises - an entity newly
   * marked as mattering more - can, as it would from a new finding.
   */
  @CaptureSpan()
  public static async refreshProject(data: {
    projectId: ObjectID;
    isWhole?: boolean | undefined;
  }): Promise<number> {
    const signals: Array<SecurityDetectionSignal> = [];
    let refreshed: number = 0;

    const mutex: SemaphoreMutex = await this.lockProject(data.projectId);

    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const settings: SecurityEntityRiskSettings = await this.getSettings(
        data.projectId,
      );
      const rules: Array<SecurityEntityCriticalityRule> =
        await SecurityEntityCriticalityService.getRules(data.projectId);

      const rows: Array<SecurityEntityRisk> =
        await SecurityEntityRiskService.findBy({
          query: data.isWhole
            ? { projectId: data.projectId }
            : {
                projectId: data.projectId,
                riskExpiresAt: QueryHelper.lessThanEqualTo(now),
              },
          select: ROW_SELECT,
          sort: {
            riskExpiresAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: ENTITY_RISK_REFRESH_ROWS_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      for (const row of rows) {
        if (!row.entityKey || !row.entityValue) {
          continue;
        }

        try {
          const signal: SecurityDetectionSignal | null = await this.writeRow({
            projectId: data.projectId,
            entityKey: row.entityKey,
            entity: {
              type: row.entityType!,
              value: row.entityValue,
            },
            row,
            contributions: readRiskContributions(row.contributions),
            rules,
            settings,
            now,
          });

          refreshed++;

          if (signal) {
            signals.push(signal);
          }
        } catch (error) {
          logger.error(
            `SecurityEntityRiskRecorder: could not refresh an entity's risk in project ${data.projectId.toString()}:`,
          );
          logger.error(error);
        }
      }
    } finally {
      await Semaphore.release(mutex);
    }

    if (signals.length > 0) {
      try {
        await SecurityCaseIngest.recordDetections(signals);
      } catch (error) {
        logger.error(
          `SecurityEntityRiskRecorder: could not record project ${data.projectId.toString()}'s risk cases:`,
        );
        logger.error(error);
      }
    }

    return refreshed;
  }

  /*
   * The hourly turn: every project with an entity whose next source has
   * stopped counting is refreshed, and the entities whose risk has been
   * quiet for ENTITY_RISK_HISTORY_IN_DAYS days are forgotten, their history
   * with them. Returns how many rows it worked out again.
   */
  @CaptureSpan()
  public static async refreshDue(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const dueRows: Array<SecurityEntityRisk> =
      await SecurityEntityRiskService.findBy({
        query: {
          riskExpiresAt: QueryHelper.lessThanEqualTo(now),
        },
        select: {
          projectId: true,
        },
        sort: {
          riskExpiresAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const projectIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const row of dueRows) {
      const id: string | undefined = row.projectId?.toString();

      if (
        id &&
        !seen.has(id) &&
        projectIds.length < ENTITY_RISK_REFRESH_PROJECTS_PER_TURN
      ) {
        seen.add(id);
        projectIds.push(row.projectId!);
      }
    }

    let refreshed: number = 0;

    for (const projectId of projectIds) {
      try {
        refreshed += await this.refreshProject({ projectId });
      } catch (error) {
        logger.error(
          `SecurityEntityRiskRecorder: could not refresh project ${projectId.toString()}'s entity risk:`,
        );
        logger.error(error);
      }
    }

    await this.forgetQuietEntities(now);

    return refreshed;
  }

  /*
   * The entities nothing has added to for ENTITY_RISK_HISTORY_IN_DAYS days:
   * their score has long been 0, and their history holds nothing newer.
   */
  @CaptureSpan()
  public static async forgetQuietEntities(now: Date): Promise<number> {
    try {
      return await SecurityEntityRiskService.deleteBy({
        query: {
          riskScore: 0,
          lastRiskAt: QueryHelper.lessThan(
            OneUptimeDate.addRemoveDays(now, -ENTITY_RISK_HISTORY_IN_DAYS),
          ),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        "SecurityEntityRiskRecorder: could not forget the entities whose risk went quiet:",
      );
      logger.error(error);
      return 0;
    }
  }
}
