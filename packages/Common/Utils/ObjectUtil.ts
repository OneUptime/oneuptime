import { GlobalObject } from "../Types/Object";

export default class ObjectUtil {
  public static isEmpty(object: GlobalObject | null | undefined): boolean {
    if (!object) {
      return true;
    }

    // check if object is empty
    return Object.keys(object).length === 0;
  }
}
