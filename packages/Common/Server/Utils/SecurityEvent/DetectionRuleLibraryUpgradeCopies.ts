import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DETECTION_RULE_LIBRARY_UPGRADES,
  DetectionRuleLibraryUpgrade,
  isSameRuleYaml,
} from "../../../Types/SecurityEvent/DetectionRuleLibraryUpgrades";
import DetectionRuleService from "../../Services/DetectionRuleService";
import logger from "../Logger";

/*
 * A PROJECT'S COPY OF A LIBRARY RULE, GIVEN THE LIBRARY'S FIX.
 *
 * A rule added from the Rule Library is a copy of the library's YAML, so a
 * fix to the library rule (DETECTION_RULE_LIBRARY_UPGRADES) reaches a
 * project's rule only through here: every copy that is still word for word
 * the library rule as it was before the fix (isSameRuleYaml) gets the
 * library's YAML now - and its description, when that is still the
 * library's too. A rule anyone edited is theirs, and is left as it is; so
 * is its name, its switch, its threshold and everything else a team sets.
 * Written as OneUptime, through the service, so the YAML is checked as any
 * save checks it. Safe to run any number of times, and two at once: a copy
 * already upgraded is no longer the earlier wording.
 */

const PAGE_SIZE: number = 200;

export default class DetectionRuleLibraryUpgradeCopies {
  // Upgrades every project's copy of each fixed library rule; returns how many it upgraded.
  public static async upgradeAll(): Promise<number> {
    let upgraded: number = 0;

    for (const upgrade of DETECTION_RULE_LIBRARY_UPGRADES) {
      upgraded += await this.upgradeCopiesOf(upgrade);
    }

    return upgraded;
  }

  public static async upgradeCopiesOf(
    upgrade: DetectionRuleLibraryUpgrade,
  ): Promise<number> {
    const entry: DetectionRuleLibraryEntry | undefined =
      getDetectionRuleLibraryEntry(upgrade.id);

    if (
      !entry ||
      isSameRuleYaml(entry.sigmaRuleYaml, upgrade.previousSigmaRuleYaml)
    ) {
      return 0;
    }

    let upgraded: number = 0;
    let skip: number = 0;

    for (;;) {
      /*
       * The rules whose YAML names the library rule's id: a copy keeps the
       * id whatever else changes, and keeps naming it once upgraded, so
       * the pages read stay the pages they were.
       */
      const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
        query: { sigmaRuleYaml: new Search(`id: ${upgrade.id}`) },
        select: { _id: true, sigmaRuleYaml: true, description: true },
        sort: { createdAt: SortOrder.Ascending },
        skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });

      for (const rule of rules) {
        if (
          !rule.id ||
          !isSameRuleYaml(
            rule.sigmaRuleYaml || "",
            upgrade.previousSigmaRuleYaml,
          )
        ) {
          continue;
        }

        try {
          await DetectionRuleService.updateOneById({
            id: rule.id,
            data: {
              sigmaRuleYaml: entry.sigmaRuleYaml,
              ...((rule.description || "").trim() ===
              upgrade.previousDescription.trim()
                ? { description: entry.description }
                : {}),
            },
            props: { isRoot: true },
          });
          upgraded++;
        } catch (error) {
          // One rule that cannot be saved does not keep the rest from their fix.
          logger.error(
            `Detection rules: could not give rule ${rule.id.toString()} the library's fix (${upgrade.why}):`,
          );
          logger.error(error);
        }
      }

      if (rules.length < PAGE_SIZE) {
        break;
      }

      skip += PAGE_SIZE;
    }

    if (upgraded > 0) {
      logger.info(
        `Detection rules: ${upgraded} copies of library rule ${upgrade.id} were given its fix: ${upgrade.why}.`,
      );
    }

    return upgraded;
  }
}
