import logger from "../../../Server/Utils/Logger";
import FilterCondition from "../../Filter/FilterCondition";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "./NotificationRuleCondition";
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

  private static didConditionMatch(data: {
    value: string | Array<string> | undefined;
    condition: ConditionType;
    filterValue: string | Array<string> | undefined;
  }): boolean {
    const value: string | Array<string> | undefined = data.value;
    const condition: ConditionType = data.condition;
    const filterValue: string | Array<string> | undefined = data.filterValue;

    logger.debug("Checking condition match:");
    logger.debug("Value:");
    logger.debug(value);
    logger.debug("Condition:");
    logger.debug(condition);
    logger.debug("Filter value:");
    logger.debug(filterValue);

    if (value === undefined || filterValue === undefined) {
      logger.debug(
        "Value or filter value is undefined. Condition does not match.",
      );
      return false;
    }

    switch (condition) {
      case ConditionType.EqualTo: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = values.every((val: string) => {
          return filterValues.every((fVal: string) => {
            // if val and fVal can be  converted to numbers, compare them as numbers
            if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
              return Number(val) === Number(fVal);
            }

            return val === fVal;
          });
        });
        logger.debug("EqualTo condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.NotEqualTo: {
        const result: boolean =
          Array.isArray(value) && Array.isArray(filterValue)
            ? !value.every((val: string) => {
                return filterValue.includes(val);
              })
            : value !== filterValue;
        logger.debug("NotEqualTo condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.GreaterThan: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = values.every((val: string) => {
          return filterValues.every((fVal: string) => {
            // if val and fVal can be  converted to numbers, compare them as numbers
            if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
              return Number(val) > Number(fVal);
            }

            return val > fVal;
          });
        });
        logger.debug("GreaterThan condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.LessThan: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = values.every((val: string) => {
          return filterValues.every((fVal: string) => {
            // if val and fVal can be  converted to numbers, compare them as numbers
            if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
              return Number(val) < Number(fVal);
            }

            return val < fVal;
          });
        });
        logger.debug("LessThan condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.GreaterThanOrEqualTo: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = values.every((val: string) => {
          return filterValues.every((fVal: string) => {
            // if val and fVal can be  converted to numbers, compare them as numbers
            if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
              return Number(val) >= Number(fVal);
            }

            return val >= fVal;
          });
        });
        logger.debug("GreaterThanOrEqualTo condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.LessThanOrEqualTo: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = values.every((val: string) => {
          return filterValues.every((fVal: string) => {
            // if val and fVal can be  converted to numbers, compare them as numbers
            if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
              return Number(val) <= Number(fVal);
            }

            return val <= fVal;
          });
        });

        logger.debug("LessThanOrEqualTo condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.ContainsAny:
      case ConditionType.Contains: {
        const result: boolean = false;

        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        logger.debug("Values:");
        logger.debug(values);
        logger.debug("Filter values:");
        logger.debug(filterValues);

        for (const val of values) {
          for (const fVal of filterValues) {
            if (val.includes(fVal)) {
              logger.debug("ContainsAny condition result:");
              logger.debug(true);
              return true;
            }
          }
        }

        logger.debug("ContainsAny condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.NotContains: {
        const result: boolean = true;
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        for (const val of values) {
          for (const fVal of filterValues) {
            if (val.includes(fVal)) {
              logger.debug("NotContains condition result:");
              logger.debug(false);
              return false;
            }
          }
        }

        logger.debug("NotContains condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.StartsWith: {
        const result: boolean = false;
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        for (const val of values) {
          for (const fVal of filterValues) {
            if (val.startsWith(fVal)) {
              logger.debug("StartsWith condition result:");
              logger.debug(true);
              return true;
            }
          }
        }

        logger.debug("StartsWith condition result:");
        logger.debug(result);

        return result;
      }

      case ConditionType.EndsWith: {
        const result: boolean = false;
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        for (const val of values) {
          for (const fVal of filterValues) {
            if (val.endsWith(fVal)) {
              logger.debug("StartsWith condition result:");
              logger.debug(true);
              return true;
            }
          }
        }

        logger.debug("StartsWith condition result:");
        logger.debug(result);

        return result;
      }

      case ConditionType.IsEmpty: {
        const result: boolean = Array.isArray(value)
          ? value.length === 0
          : value === "";
        logger.debug("IsEmpty condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.IsNotEmpty: {
        const result: boolean = Array.isArray(value)
          ? value.length > 0
          : value !== "";
        logger.debug("IsNotEmpty condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.True: {
        const result: boolean = value === "true";
        logger.debug("True condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.False: {
        const result: boolean = value === "false";
        logger.debug("False condition result:");
        logger.debug(result);
        return result;
      }

      case ConditionType.ContainsAll: {
        const values: string[] = Array.isArray(value) ? value : [value];
        const filterValues: string[] = Array.isArray(filterValue)
          ? filterValue
          : [filterValue];

        const result: boolean = filterValues.every((fVal: string) => {
          return values.some((val: string) => {
            return val.includes(fVal);
          });
        });
        logger.debug("ContainsAll condition result:");
        logger.debug(result);
        return result;
      }

      default: {
        logger.debug("Unknown condition type. Condition does not match.");
        return false;
      }
    }
  }
}
