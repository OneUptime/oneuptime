export default class NumberUtil {
  public static convertToTwoDecimalPlaces(value: number): number {
    return Math.round(value * 100) / 100;
  }

  public static isNumber(value: any): boolean {
    return !isNaN(value);
  }

  public static convertToNumber(value: any): number {
    return Number(value);
  }

  public static canBeConvertedToNumber(value: any): boolean {
    return !isNaN(Number(value));
  }

  public static isInteger(value: any): boolean {
    return Number.isInteger(value);
  }

  public static isPositive(value: number): boolean {
    return value > 0;
  }

  public static isNegative(value: number): boolean {
    return value < 0;
  }

  public static isZero(value: number): boolean {
    return value === 0;
  }

  public static isEven(value: number): boolean {
    return value % 2 === 0;
  }

  public static isOdd(value: number): boolean {
    return value % 2 !== 0;
  }

  public static isFloat(value: number): boolean {
    return value % 1 !== 0;
  }
}
