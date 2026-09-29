import { GlobalObject } from "../Types/Object";

export default class ObjectUtil {
  public static isEmpty(object: GlobalObject): boolean {
    // check if object is empty
    return Object.keys(object).length === 0;
  }
}
