import DataMigrationBase from "./DataMigrationBase";
import DetectionRuleLibraryUpgradeCopies from "Common/Server/Utils/SecurityEvent/DetectionRuleLibraryUpgradeCopies";
import logger from "Common/Server/Utils/Logger";

/*
 * A FIXED RULE LIBRARY RULE, IN THE PROJECTS THAT ADDED IT BEFORE.
 *
 * A project's rule added from the Rule Library is a copy of the library's
 * YAML, so a fix to a library rule reached only the rules added after it.
 * Each copy that is still word for word a fixed rule as it was added
 * (DETECTION_RULE_LIBRARY_UPGRADES) gets the library's YAML now, and its
 * description while that is the library's too: Burst of access-denied API
 * calls leaves OneUptime's own reads of a connected AWS account out
 * (#10427), so Data Security's reads no longer open a case that names
 * OneUptime's own role as the suspect. A rule anyone edited is theirs and
 * is left as it is; so is everything a team sets on a rule beside its YAML.
 *
 * Postgres only. Safe to run twice, and two at once: a copy already given
 * the fix is no longer the earlier wording, and is not touched again.
 */
export default class UpgradeLibraryRuleCopies extends DataMigrationBase {
  public constructor() {
    super("UpgradeLibraryRuleCopies");
  }

  public override async migrate(): Promise<void> {
    const upgraded: number =
      await DetectionRuleLibraryUpgradeCopies.upgradeAll();

    logger.info(
      `UpgradeLibraryRuleCopies: ${upgraded} copies of Rule Library rules were given the library's fix.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the fix leaves out only the events OneUptime knows
     * are its own, and putting the earlier wording back would open cases
     * about OneUptime's own role again.
     */
    return;
  }
}
