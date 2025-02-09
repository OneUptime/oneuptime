import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import ObjectID from "Common/Types/ObjectID";
import { CompareType } from "../../../Types/Database/CompareBase";

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
