import DataMigrationBase from "./DataMigrationBase";
import logger from "Common/Server/Utils/Logger";
import NewRecommendedRuleRollout, {
  NewRecommendedRuleOutcome,
  NewRecommendedRuleRolloutSummary,
} from "Common/Server/Utils/SecurityEvent/NewRecommendedRuleRollout";
import { SENSITIVE_FILE_SERVED_RULE_ID } from "Common/Types/SecurityEvent/DetectionRuleLibrary";

export const SENSITIVE_FILE_SERVED_ROLLOUT_NAME: string =
  "AddSensitiveFileServedToRecommendedRules";

/*
 * SENSITIVE FILE SERVED, IN THE PROJECTS THAT TURNED ON EVERY RECOMMENDED
 * RULE BEFORE IT WAS ONE (#11037).
 *
 * Sensitive file served (#10912) opens a Critical case when a site served
 * a file that holds secrets, such as /.env. It became a recommended rule
 * after many projects had clicked Turn on recommended, and those run every
 * other recommended rule but not this one: the one that catches a leak
 * nobody else does - a scanner that asks for /.env alone, and gets it,
 * trips no scanning rule.
 *
 * So each project that runs every other recommended rule, and has no rule
 * of this one, gets it now, on and opening cases, as Turn on recommended
 * would have added it (NewRecommendedRuleRollout) - and the Overview says
 * OneUptime added it, with Turn Off. It fires only on an answer OneUptime
 * read as the file itself, and a new rule's first run reads only the
 * minutes before it: the upgrade opens no case for a leak of the past. A
 * project that turned a recommended rule off, or deleted one, chose its own
 * set and is left as it is; the Overview names the rule to it instead.
 *
 * Postgres only. Safe to run twice, and two at once.
 */
export default class AddSensitiveFileServedToRecommendedRules extends DataMigrationBase {
  public constructor() {
    super(SENSITIVE_FILE_SERVED_ROLLOUT_NAME);
  }

  public override async migrate(): Promise<void> {
    const summary: NewRecommendedRuleRolloutSummary =
      await NewRecommendedRuleRollout.addToProjectsRunningEveryOtherRecommendedRule(
        {
          libraryRuleId: SENSITIVE_FILE_SERVED_RULE_ID,
          lockNamespace: SENSITIVE_FILE_SERVED_ROLLOUT_NAME,
        },
      );

    logger.info(
      `${SENSITIVE_FILE_SERVED_ROLLOUT_NAME}: of ${summary.candidates} projects that may run every other recommended rule, Sensitive file served was added to ${summary.outcomes[NewRecommendedRuleOutcome.Added]}; ${summary.outcomes[NewRecommendedRuleOutcome.AlreadyHas]} had it already and ${summary.outcomes[NewRecommendedRuleOutcome.ChoseOwnSet]} chose their own set.`,
    );

    if (summary.outcomes[NewRecommendedRuleOutcome.Failed] > 0) {
      logger.warn(
        `${SENSITIVE_FILE_SERVED_ROLLOUT_NAME}: it could not be added to ${summary.outcomes[NewRecommendedRuleOutcome.Failed]} projects; their Overview names it, with Turn On.`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rule is the project's now, as one Turn on
     * recommended adds is, for it to turn off or delete.
     */
    return;
  }
}
