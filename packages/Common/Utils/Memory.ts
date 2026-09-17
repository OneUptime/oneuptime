import NumberUtil from "./Number";

export default class MemoryUtil {
  public static convertToGb(memoryInBytes: number): number {
    const gb: number = memoryInBytes / 1024 / 1024 / 1024;
    //return two decimal places
    return NumberUtil.convertToTwoDecimalPlaces(gb);
  }
}
