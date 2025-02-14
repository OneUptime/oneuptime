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

    // no filters means all filters are matched
    if (data.notificationRule.filters.length === 0) {
      return true;
    }

    const filterCondition: FilterCondition = notificationRule.filterCondition;

    for (const filter of notificationRule.filters) {
      const value: string | Array<string> | undefined =
        data.values[filter.checkOn];
      const condition: ConditionType | undefined = filter.conditionType;
      const filterValue: string | Array<string> | undefined = filter.value;

      if (!condition) {
        continue;
      }

      const isMatched: boolean = this.didConditionMatch({
        value,
        condition,
        filterValue,
      });

      if (filterCondition === FilterCondition.All) {
        if (!isMatched) {
          return false;
        }
      }

      if (filterCondition === FilterCondition.Any) {
        if (isMatched) {
          return true;
        }
      }
    }

    if (filterCondition === FilterCondition.All) {
      return true;
    }

    if (filterCondition === FilterCondition.Any) {
      return false;
    }

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
        
        if(value === undefined || filterValue === undefined) {
            return false;
        }

        switch(condition) {
            case ConditionType.EqualTo: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.includes(val));
                } 
                    return value === filterValue;
                
            }

            case ConditionType.NotEqualTo: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return !value.every(val => filterValue.includes(val));
                } else {
                    return value !== filterValue;
                }
            }

            case ConditionType.GreaterThan: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.every(fVal => val > fVal));
                } else if (value !== undefined && filterValue !== undefined) {
                    return value > filterValue;
                }
                return false;
            }

            case ConditionType.LessThan: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.every(fVal => val < fVal));
                } else if (value !== undefined && filterValue !== undefined) {
                    return value < filterValue;
                }
                return false;
            }

            case ConditionType.GreaterThanOrEqualTo: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.every(fVal => val >= fVal));
                } else if (value !== undefined && filterValue !== undefined) {
                    return value >= filterValue;
                }
                return false;
            }

            case ConditionType.LessThanOrEqualTo: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.every(fVal => val <= fVal));
                } else if (value !== undefined && filterValue !== undefined) {
                    return value <= filterValue;
                }
                return false;
            }

            case ConditionType.ContainsAny: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.some(val => filterValue.includes(val));
                } else if (value !== undefined && filterValue !== undefined && typeof value === "string") {
                    return filterValue.includes(value);
                }
                return false;
            }

            case ConditionType.NotContains: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return !value.some(val => filterValue.includes(val));
                } else if (value !== undefined && filterValue !== undefined && typeof value === "string") {
                    return !filterValue.includes(value);
                }
                return false;
            }

            case ConditionType.StartsWith: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val => filterValue.every(fVal => val.startsWith(fVal)));
                } else if (value !== undefined && filterValue !== undefined && typeof value === "string") {
                    return value.startsWith(filterValue.toString());
                }
                return false;
            }

            case ConditionType.EndsWith: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return value.every(val =>
                        filterValue.every(fVal => val.endsWith(fVal)),
                    );
                } else if (value !== undefined && filterValue !== undefined && typeof value === "string") {
                    return value.endsWith(filterValue.toString());
                }
                return false;
            }

            case ConditionType.IsEmpty: {
                if (Array.isArray(value)) {
                    return value.length === 0;
                } else {
                    return value === "" || value === undefined;
                }
            }

            case ConditionType.IsNotEmpty: {
                if (Array.isArray(value)) {
                    return value.length > 0;
                } else {
                    return value !== "" && value !== undefined;
                }
            }

            case ConditionType.True: {
                if (Array.isArray(value)) {
                    return value.every(val => val === "true");
                } else {
                    return value === "true";
                }
            }

            case ConditionType.False: {
                if (Array.isArray(value)) {
                    return value.every(val => val === "false");
                } else {
                    return value === "false";
                }
            }

            case ConditionType.ContainsAll: {
                if (Array.isArray(value) && Array.isArray(filterValue)) {
                    return filterValue.every(fVal => value.includes(fVal));
                }
                return false;
            }

            default: {
                return false;
            }

        }
                

    }
}
