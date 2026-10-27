import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import ObjectID from "../../../Types/ObjectID";
import { CompareType } from "../../../Types/Database/CompareBase";

/*
 * No @CaptureSpan here: each method only builds a query operator, in
 * microseconds. The statement that runs is traced instead
 * (ClickhouseQuerySpans).
 */
export default class QueryHelper {
  public static lessThan<T extends CompareType>(value: T): LessThan<T> {
    return new LessThan(value);
  }

  public static any(values: Array<string> | Array<ObjectID>): Includes {
    return new Includes(values);
  }

  public static greaterThan<T extends CompareType>(value: T): GreaterThan<T> {
    return new GreaterThan<T>(value);
  }

  public static inBetween<T extends CompareType>(
    startValue: T,
    endValue: T,
  ): InBetween<T> {
    return new InBetween(startValue, endValue);
  }
}
