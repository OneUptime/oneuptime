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
 * library's too. A fix that moved the field the rule groups by (#10773)
 * moves a copy still grouped by the library's old field, its YAML still the
 * library's. A rule anyone edited is theirs, and is left as it is; so is a
 * field it was grouped by that someone chose, its name, its switch, its
 * threshold and everything else a team sets.
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

    if (!entry) {
      return 0;
    }

    const isYamlFixed: boolean = !isSameRuleYaml(
      entry.sigmaRuleYaml,
      upgrade.previousSigmaRuleYaml,
    );
    // The field the library's rule groups by moved (#10773).
    const isGroupByFixed: boolean =
      upgrade.previousGroupByField !== undefined &&
      upgrade.previousGroupByField !== (entry.groupByField || "");

    if (!isYamlFixed && !isGroupByFixed) {
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
        select: {
          _id: true,
          sigmaRuleYaml: true,
          description: true,
          groupByField: true,
        },
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

        const data: Record<string, string> = {};

        if (isYamlFixed) {
          data["sigmaRuleYaml"] = entry.sigmaRuleYaml;

          if (
            (rule.description || "").trim() ===
            upgrade.previousDescription.trim()
          ) {
            data["description"] = entry.description;
          }
        }

        // Grouped as the library's rule was: grouped as it is now.
        if (
          isGroupByFixed &&
          (rule.groupByField || "") === upgrade.previousGroupByField
        ) {
          data["groupByField"] = entry.groupByField || "";
        }

        if (Object.keys(data).length === 0) {
          continue;
        }

        try {
          await DetectionRuleService.updateOneById({
            id: rule.id,
            data: data as never,
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
