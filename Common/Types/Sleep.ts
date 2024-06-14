import { VoidFunction } from "./FunctionTypes";

export default class Sleep {
  public static async sleep(ms: number): Promise<void> {
    return new Promise((resolve: VoidFunction) => {
      setTimeout(resolve, ms);
    });
  }
}
