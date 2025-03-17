import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import ObjectID from "Common/Types/ObjectID";
import { CompareType } from "../../../Types/Database/CompareBase";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export default class QueryHelper {
  @CaptureSpan()
  public static lessThan<T extends CompareType>(value: T): LessThan<T> {
    return new LessThan(value);
  }

  @CaptureSpan()
  public static any(values: Array<string> | Array<ObjectID>): Includes {
    return new Includes(values);
  }

  @CaptureSpan()
  public static greaterThan<T extends CompareType>(value: T): GreaterThan<T> {
    return new GreaterThan<T>(value);
  }

  @CaptureSpan()
  public static inBetween<T extends CompareType>(
    startValue: T,
    endValue: T,
  ): InBetween<T> {
    return new InBetween(startValue, endValue);
  }
}
