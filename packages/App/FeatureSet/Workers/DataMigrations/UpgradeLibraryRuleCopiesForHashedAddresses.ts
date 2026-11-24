import DataMigrationBase from "./DataMigrationBase";
import DetectionRuleLibraryUpgradeCopies from "Common/Server/Utils/SecurityEvent/DetectionRuleLibraryUpgradeCopies";
import logger from "Common/Server/Utils/Logger";

/*
 * THE OPENSTACK RULES THAT COUNT PER ADDRESS, IN THE PROJECTS THAT ADDED
 * THEM BEFORE (#10773).
 *
 * OpenStack failed logins burst grouped its sign-ins by the parser's own
 * openstack.audit.initiator_address, and OpenStack admin credential used
 * from a new address read that attribute as its new value. The attribute
 * holds real addresses only, on purpose (#10415), so a sign-in whose
 * address a Hash scrub rule hid was never counted, though the log scan
 * names its real address in principalIp (#10419). The library's rules
 * read principalIp now (DETECTION_RULE_LIBRARY_UPGRADES), and each
 * project's copy that is still the library's gets the same:
 *
 *   - OpenStack failed logins burst, still grouped by the old attribute,
 *     is grouped by principalIp;
 *   - OpenStack admin credential used from a new address, its YAML still
 *     word for word the library's, gets the library's YAML.
 *
 * A rule anyone edited is theirs and is left as it is, and so is a field
 * someone chose to group it by (DetectionRuleLibraryUpgradeCopies). The
 * earlier library fixes are given too, to any copy still without them.
 *
 * UpgradeLibraryRuleCopies gave the fixes before these, and has run on the
 * servers that had it: this runs them again, with these. Postgres only.
 * Safe to run twice, and two at once: a copy already given a fix is no
 * longer the earlier wording, nor grouped by the earlier field.
 */
export default class UpgradeLibraryRuleCopiesForHashedAddresses extends DataMigrationBase {
  public constructor() {
    super("UpgradeLibraryRuleCopiesForHashedAddresses");
  }

  public override async migrate(): Promise<void> {
    const upgraded: number =
      await DetectionRuleLibraryUpgradeCopies.upgradeAll();

    logger.info(
      `UpgradeLibraryRuleCopiesForHashedAddresses: ${upgraded} copies of Rule Library rules were given the library's fix.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: grouped by the parser's attribute again, the rules
     * would stop counting sign-ins whose address a Hash rule hid.
     */
    return;
  }
}
