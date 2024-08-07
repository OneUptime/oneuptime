import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import ObjectID from "Common/Types/ObjectID";

export default class QueryHelper {
  public static lessThan(value: Date | number): LessThan {
    return new LessThan(value);
  }

  public static any(values: Array<string> | Array<ObjectID>): Includes {
    return new Includes(values);
  }

  public static greaterThan(value: Date | number): GreaterThan {
    return new GreaterThan(value);
  }

  public static inBetween(
    startValue: Date | number,
    endValue: Date | number,
  ): InBetween {
    return new InBetween(startValue, endValue);
  }
}
