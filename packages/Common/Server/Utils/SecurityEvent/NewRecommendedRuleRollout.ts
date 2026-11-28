import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import DatabaseService from "../../Services/DatabaseService";
import DetectionRuleService from "../../Services/DetectionRuleService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { hasEveryOtherRecommendedRuleOn } from "../../../Utils/SecurityEvent/RecommendedDetectionRules";
import {
  buildDetectionRuleFromLibrary,
  findRuleOfLibraryEntry,
} from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
import logger from "../Logger";

/*
 * A NEW RECOMMENDED RULE, IN THE PROJECTS THAT RUN EVERY OTHER ONE (#11037).
 *
 * Turn on recommended adds the recommended rules a project has not got; one
 * that became recommended later reaches the projects that clicked before
 * only when they click again. For a rule whose silence costs more than its
 * surprise - Sensitive file served, a Critical leak of secrets - an upgrade
 * adds it to the projects that plainly took the whole set:
 *
 *   - the project runs every other recommended rule: each one is a rule of
 *     the project, and on. One that turned any of them off, or deleted one,
 *     chose its own set, and is left as it is - the Overview names the new
 *     rule to it, with Turn On;
 *   - the project has no rule of the new one at all: a copy it turned off,
 *     renamed or changed is its answer already;
 *   - the rule is the library's, on and opening cases, as Turn on
 *     recommended would add it, and says OneUptime added it
 *     (DetectionRule.addedByOneUptimeAt), so the Overview tells the project.
 *
 * Which projects may: those with a rule of another recommended rule that is
 * on - every project that runs all of them has one - read a page at a time
 * by project id, each project then judged on all its rules. Each project's
 * turn is taken under its lock and reads its rules afresh, so two runs at
 * once add the rule once, and a second run adds nothing. A project whose
 * turn fails is logged and the rest go on: the Overview still names the
 * rule to it.
 */

// The projects one read takes.
export const ROLLOUT_PROJECTS_PAGE_SIZE: number = 500;

// Below every project's id: where the first page starts.
export const ROLLOUT_FIRST_PROJECT_ID: string =
  "00000000-0000-0000-0000-000000000000";

/*
 * The projects that may run every other recommended rule, after a project
 * id: each has a rule, on, of another recommended rule - by its Sigma id
 * ($2, a LIKE pattern) or by its name ($3, as SecurityTemplateRecords
 * compares names). Every project that runs all of them is among these.
 */
export const READ_ROLLOUT_CANDIDATES_SQL: string = `SELECT DISTINCT "projectId" AS "projectId" FROM "DetectionRule" WHERE "projectId" > $1::uuid AND "deletedAt" IS NULL AND "isEnabled" = true AND ("sigmaRuleYaml" LIKE $2 OR lower(btrim("name")) = $3) ORDER BY "projectId" ASC LIMIT $4`;

export enum NewRecommendedRuleOutcome {
  // The rule was added, on.
  Added = "added",
  // The project has a rule of it already, on or off.
  AlreadyHas = "already-has",
  // The project does not run every other recommended rule.
  ChoseOwnSet = "chose-own-set",
  // Its turn failed, and was logged.
  Failed = "failed",
}

export interface NewRecommendedRuleRolloutSummary {
  // The projects read as candidates.
  candidates: number;
  outcomes: Record<NewRecommendedRuleOutcome, number>;
}

type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

function emptyOutcomes(): Record<NewRecommendedRuleOutcome, number> {
  return {
    [NewRecommendedRuleOutcome.Added]: 0,
    [NewRecommendedRuleOutcome.AlreadyHas]: 0,
    [NewRecommendedRuleOutcome.ChoseOwnSet]: 0,
    [NewRecommendedRuleOutcome.Failed]: 0,
  };
}

/*
 * The recommended rule whose rules make a project a candidate: the first
 * other one, in the library's order.
 */
export function getRolloutSibling(
  libraryRuleId: string,
): DetectionRuleLibraryEntry | undefined {
  return getRecommendedDetectionRules().find(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return entry.id !== libraryRuleId;
    },
  );
}

// The candidates query's values after the project id, for a sibling rule.
export function getRolloutCandidateValues(sibling: DetectionRuleLibraryEntry): {
  yamlPattern: string;
  name: string;
} {
  return {
    yamlPattern: `%id: ${sibling.id}%`,
    name: sibling.title.trim().toLowerCase(),
  };
}

export default class NewRecommendedRuleRollout {
  public static async addToProjectsRunningEveryOtherRecommendedRule(data: {
    libraryRuleId: string;
    // Where two runs at once wait for each other, a project at a time.
    lockNamespace: string;
    now?: Date | undefined;
  }): Promise<NewRecommendedRuleRolloutSummary> {
    const entry: DetectionRuleLibraryEntry | undefined =
      getDetectionRuleLibraryEntry(data.libraryRuleId);

    if (!entry || !isRecommendedDetectionRule(entry)) {
      throw new Error(
        `NewRecommendedRuleRollout: ${data.libraryRuleId} is no recommended rule of the library.`,
      );
    }

    const summary: NewRecommendedRuleRolloutSummary = {
      candidates: 0,
      outcomes: emptyOutcomes(),
    };
    const sibling: DetectionRuleLibraryEntry | undefined = getRolloutSibling(
      entry.id,
    );

    if (!sibling) {
      return summary;
    }

    const values: { yamlPattern: string; name: string } =
      getRolloutCandidateValues(sibling);
    const repository: ModelRepository = (
      DetectionRuleService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    let lastProjectId: string = ROLLOUT_FIRST_PROJECT_ID;

    for (;;) {
      const rows: Array<JSONObject> = (await repository.manager.query(
        READ_ROLLOUT_CANDIDATES_SQL,
        [
          lastProjectId,
          values.yamlPattern,
          values.name,
          ROLLOUT_PROJECTS_PAGE_SIZE,
        ],
      )) as Array<JSONObject>;

      for (const row of rows) {
        const projectId: string = String(row["projectId"] || "");

        if (!projectId) {
          continue;
        }

        lastProjectId = projectId;
        summary.candidates++;

        const outcome: NewRecommendedRuleOutcome = await this.addToProject({
          projectId: new ObjectID(projectId),
          entry,
          lockNamespace: data.lockNamespace,
          now,
        });

        summary.outcomes[outcome]++;
      }

      if (rows.length < ROLLOUT_PROJECTS_PAGE_SIZE) {
        break;
      }
    }

    return summary;
  }

  /*
   * One project's turn, under its lock - without it, when the lock cannot
   * be had: the rules are read afresh either way. Never throws.
   */
  public static async addToProject(data: {
    projectId: ObjectID;
    entry: DetectionRuleLibraryEntry;
    lockNamespace: string;
    now: Date;
  }): Promise<NewRecommendedRuleOutcome> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.projectId.toString(),
        namespace: data.lockNamespace,
        lockTimeout: 60 * 1000,
        acquireTimeout: 60 * 1000,
      });
    } catch (error) {
      logger.warn(
        `NewRecommendedRuleRollout: could not take project ${data.projectId.toString()}'s lock; judging its rules without it. ${String(error)}`,
      );
    }

    try {
      const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true, name: true, sigmaRuleYaml: true, isEnabled: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      if (findRuleOfLibraryEntry(rules, data.entry)) {
        return NewRecommendedRuleOutcome.AlreadyHas;
      }

      if (!hasEveryOtherRecommendedRuleOn(rules, [data.entry.id])) {
        return NewRecommendedRuleOutcome.ChoseOwnSet;
      }

      const rule: DetectionRule = buildDetectionRuleFromLibrary({
        projectId: data.projectId,
        entry: data.entry,
      });
      rule.addedByOneUptimeAt = data.now;

      await DetectionRuleService.create({
        data: rule,
        props: { isRoot: true },
      });

      return NewRecommendedRuleOutcome.Added;
    } catch (error) {
      logger.error(
        `NewRecommendedRuleRollout: could not add "${data.entry.title}" to project ${data.projectId.toString()}; its Overview still names the rule, with Turn On.`,
      );
      logger.error(error);

      return NewRecommendedRuleOutcome.Failed;
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.warn(
            `NewRecommendedRuleRollout: could not give back project ${data.projectId.toString()}'s lock; it runs out by itself. ${String(error)}`,
          );
        }
      }
    }
  }
}
