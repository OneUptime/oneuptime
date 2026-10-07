import DataMigrationBase from "./DataMigrationBase";
import PlanDowngradeOwnerNotice, {
  AlreadyBelowPlanNoticeSummary,
} from "Common/Server/Utils/Billing/PlanDowngradeOwnerNotice";
import logger from "Common/Server/Utils/Logger";

/*
 * On OneUptime Cloud, a project's API keys stop working below Growth, and
 * its SCIM connections only remove people below Scale
 * (Common/Types/Billing/PlanCutoffCredentials). A plan change that moves a
 * project below them tells its owners (ProjectService.changePlan). The
 * projects that were already below them when the cut-off shipped got no
 * word: their owners only met the refusals. This tells them, once - what
 * stopped on the plan the project is on, and how to turn it back on - in
 * the words of the plan change's email (PlanDowngradeOwnerNotice
 * .notifyProjectsAlreadyBelowPlan): the projects with API keys that have not
 * expired, or SCIM connections, whose plan does not include them.
 *
 * Self-hosted installs (billing off) have no plans: nothing is read or sent.
 * Safe to run twice, at once or later: each project's owners are told only
 * by the run that claims its planCutoffNoticeSentAt while it is still empty
 * (one conditional UPDATE), and owners a plan change already told are not
 * told again. Each email is handed to the mail service before the run goes
 * on - this runs in the migrate Job, which exits when it is done. A project
 * that cannot be told is logged and the others go on: one with no owners is
 * not claimed, and a claim whose emails all failed is given back, so running
 * it again tells them.
 */
export default class NotifyOwnersOfStoppedApiKeysAndScim extends DataMigrationBase {
  public constructor() {
    super("NotifyOwnersOfStoppedApiKeysAndScim");
  }

  public override async migrate(): Promise<void> {
    const summary: AlreadyBelowPlanNoticeSummary =
      await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan();

    logger.info(
      `NotifyOwnersOfStoppedApiKeysAndScim: ${summary.projects} project(s) with API keys or SCIM connections; owners told for ${summary.told}, already told for ${summary.alreadyTold}, nothing stopped for ${summary.nothingStopped}, no plan for ${summary.noPlan}, no owners for ${summary.noOwners}, could not be told for ${summary.failed} (logged).`,
    );
  }

  public override async rollback(): Promise<void> {
    // An email that went out cannot be taken back.
    return;
  }
}
