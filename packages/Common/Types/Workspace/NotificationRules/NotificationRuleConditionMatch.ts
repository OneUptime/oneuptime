import { ConditionType } from "./NotificationRuleCondition";

/*
 * WHETHER ONE CONDITION OF A WORKSPACE RULE MATCHES WHAT A RECORD HOLDS.
 *
 * The comparison the server matches a rule's conditions with
 * (WorkspaceNotificationRuleUtil.isRuleMatching), with nothing of the
 * server in it, so the Dashboard can ask the very same question: which
 * on-call policies an "On-Call Policy Name contains Primary" condition
 * matches today, before it is switched to the policies themselves (#7806).
 *
 * Text compares as written, letter case included: "contains Primary" does
 * not match "primary on-call". Equal To compares two numbers as numbers
 * ("7" equals "07"); Not Equal To compares text as written. A value or a
 * condition value that is not there matches nothing.
 */
export function doesConditionMatch(data: {
  value: string | Array<string> | undefined;
  condition: ConditionType;
  filterValue: string | Array<string> | undefined;
}): boolean {
  const value: string | Array<string> | undefined = data.value;
  const filterValue: string | Array<string> | undefined = data.filterValue;

  if (value === undefined || filterValue === undefined) {
    return false;
  }

  const values: Array<string> = Array.isArray(value) ? value : [value];
  const filterValues: Array<string> = Array.isArray(filterValue)
    ? filterValue
    : [filterValue];

  // Two numbers compare as numbers; anything else as text.
  const compare: (
    val: string,
    fVal: string,
    byNumber: (a: number, b: number) => boolean,
    byText: (a: string, b: string) => boolean,
  ) => boolean = (
    val: string,
    fVal: string,
    byNumber: (a: number, b: number) => boolean,
    byText: (a: string, b: string) => boolean,
  ): boolean => {
    if (!isNaN(Number(val)) && !isNaN(Number(fVal))) {
      return byNumber(Number(val), Number(fVal));
    }

    return byText(val, fVal);
  };

  // Every value against every condition value.
  const everyPair: (
    byNumber: (a: number, b: number) => boolean,
    byText: (a: string, b: string) => boolean,
  ) => boolean = (
    byNumber: (a: number, b: number) => boolean,
    byText: (a: string, b: string) => boolean,
  ): boolean => {
    return values.every((val: string): boolean => {
      return filterValues.every((fVal: string): boolean => {
        return compare(val, fVal, byNumber, byText);
      });
    });
  };

  // Whether some value has some condition value in it, by `test`.
  const somePair: (test: (val: string, fVal: string) => boolean) => boolean = (
    test: (val: string, fVal: string) => boolean,
  ): boolean => {
    return values.some((val: string): boolean => {
      return filterValues.some((fVal: string): boolean => {
        return test(val, fVal);
      });
    });
  };

  switch (data.condition) {
    case ConditionType.EqualTo:
      return everyPair(
        (a: number, b: number): boolean => {
          return a === b;
        },
        (a: string, b: string): boolean => {
          return a === b;
        },
      );

    case ConditionType.NotEqualTo:
      return Array.isArray(value) && Array.isArray(filterValue)
        ? !value.every((val: string): boolean => {
            return filterValue.includes(val);
          })
        : value !== filterValue;

    case ConditionType.GreaterThan:
      return everyPair(
        (a: number, b: number): boolean => {
          return a > b;
        },
        (a: string, b: string): boolean => {
          return a > b;
        },
      );

    case ConditionType.LessThan:
      return everyPair(
        (a: number, b: number): boolean => {
          return a < b;
        },
        (a: string, b: string): boolean => {
          return a < b;
        },
      );

    case ConditionType.GreaterThanOrEqualTo:
      return everyPair(
        (a: number, b: number): boolean => {
          return a >= b;
        },
        (a: string, b: string): boolean => {
          return a >= b;
        },
      );

    case ConditionType.LessThanOrEqualTo:
      return everyPair(
        (a: number, b: number): boolean => {
          return a <= b;
        },
        (a: string, b: string): boolean => {
          return a <= b;
        },
      );

    case ConditionType.ContainsAny:
    case ConditionType.Contains:
      return somePair((val: string, fVal: string): boolean => {
        return val.includes(fVal);
      });

    case ConditionType.NotContains:
      return !somePair((val: string, fVal: string): boolean => {
        return val.includes(fVal);
      });

    case ConditionType.StartsWith:
      return somePair((val: string, fVal: string): boolean => {
        return val.startsWith(fVal);
      });

    case ConditionType.EndsWith:
      return somePair((val: string, fVal: string): boolean => {
        return val.endsWith(fVal);
      });

    case ConditionType.IsEmpty:
      return Array.isArray(value) ? value.length === 0 : value === "";

    case ConditionType.IsNotEmpty:
      return Array.isArray(value) ? value.length > 0 : value !== "";

    case ConditionType.True:
      return value === "true";

    case ConditionType.False:
      return value === "false";

    case ConditionType.ContainsAll:
      return filterValues.every((fVal: string): boolean => {
        return values.some((val: string): boolean => {
          return val.includes(fVal);
        });
      });

    default:
      return false;
  }
}
