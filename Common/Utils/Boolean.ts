export default class BooleanUtil {
  public static isBoolean(value: any): boolean {
    return typeof value === "boolean";
  }

  public static convertToBoolean(value: any): boolean {
    return Boolean(value);
  }

  public static canBeConvertedToBoolean(value: any): boolean {
    return (
      value === "true" ||
      value === "false" ||
      value === 1 ||
      value === 0 ||
      value === "1" ||
      value === "0" ||
      value === true ||
      value === false
    );
  }
}
