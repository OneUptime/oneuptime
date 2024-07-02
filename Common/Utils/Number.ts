export default class NumberUtil {
  public static convertToTwoDecimalPlaces(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
