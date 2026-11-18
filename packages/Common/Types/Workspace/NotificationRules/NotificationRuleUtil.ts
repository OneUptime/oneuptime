import logger from "../../../Server/Utils/Logger";
import FilterCondition from "../../Filter/FilterCondition";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "./NotificationRuleCondition";
import { doesConditionMatch } from "./NotificationRuleConditionMatch";
import IncidentNotificationRule from "./NotificationRuleTypes/IncidentNotificationRule";

export class WorkspaceNotificationRuleUtil {
  public static isRuleMatching(data: {
    notificationRule: IncidentNotificationRule;
    values: {
      [key in NotificationRuleConditionCheckOn]:
        | string
        | Array<string>
        | undefined;
    };
  }): boolean {
    const notificationRule: IncidentNotificationRule = data.notificationRule;

    logger.debug("Checking if rule matches for notificationRule:");
    logger.debug(notificationRule);

    // no filters means all filters are matched
    if (data.notificationRule.filters.length === 0) {
      logger.debug("No filters found. Rule matches by default.");
      return true;
    }

    const filterCondition: FilterCondition = notificationRule.filterCondition;

    logger.debug("Filter condition:");
    logger.debug(filterCondition);

    for (const filter of notificationRule.filters) {
      const value: string | Array<string> | undefined =
        data.values[filter.checkOn];
      const condition: ConditionType | undefined = filter.conditionType;
      const filterValue: string | Array<string> | undefined = filter.value;

      logger.debug("Evaluating filter:");
      logger.debug(filter);
      logger.debug("Value:");
      logger.debug(value);
      logger.debug("Condition:");
      logger.debug(condition);
      logger.debug("Filter value:");
      logger.debug(filterValue);

      if (!condition) {
        logger.debug("No condition found for filter. Skipping.");
        continue;
      }

      const isMatched: boolean = this.didConditionMatch({
        value,
        condition,
        filterValue,
      });

      logger.debug("Filter match result:");
      logger.debug(isMatched);

      if (filterCondition === FilterCondition.All) {
        if (!isMatched) {
          logger.debug(
            "Filter condition is 'All' and a filter did not match. Rule does not match.",
          );
          return false;
        }
      }

      if (filterCondition === FilterCondition.Any) {
        if (isMatched) {
          logger.debug(
            "Filter condition is 'Any' and a filter matched. Rule matches.",
          );
          return true;
        }
      }
    }

    if (filterCondition === FilterCondition.All) {
      logger.debug("All filters matched. Rule matches.");
      return true;
    }

    if (filterCondition === FilterCondition.Any) {
      logger.debug("No filters matched. Rule does not match.");
      return false;
    }

    logger.debug("No valid filter condition found. Rule does not match.");
    return false;
  }

  /*
   * One condition against what the record holds: the comparison lives in
   * doesConditionMatch, which the Dashboard asks too - an On-Call Policy
   * Name condition says which policies it matches today by it (#7806).
   */
  private static didConditionMatch(data: {
    value: string | Array<string> | undefined;
    condition: ConditionType;
    filterValue: string | Array<string> | undefined;
  }): boolean {
    logger.debug("Checking condition match:");
    logger.debug("Value:");
    logger.debug(data.value);
    logger.debug("Condition:");
    logger.debug(data.condition);
    logger.debug("Filter value:");
    logger.debug(data.filterValue);

    const result: boolean = doesConditionMatch(data);

    logger.debug(`${data.condition} condition result:`);
    logger.debug(result);

    return result;
  }
}
