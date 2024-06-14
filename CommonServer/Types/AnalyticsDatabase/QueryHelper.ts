import LessThan from "Common/Types/BaseDatabase/LessThan";

export default class QueryHelper {
  public static lessThan(value: Date | number): LessThan {
    return new LessThan(value);
  }
}
