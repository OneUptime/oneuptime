export default class NumberUtil {
  public static parseNumberWithDefault(data: {
    value: string | undefined;
    defaultValue: number;
    min?: number | undefined;
    max?: number | undefined;
  }): number {
    if (data.value === undefined || data.value === null || data.value === "") {
      return data.defaultValue;
    }

    const parsed: number = Number.parseInt(data.value, 10);

    if (!Number.isFinite(parsed)) {
      return data.defaultValue;
    }

    if (data.min !== undefined && parsed < data.min) {
      return data.defaultValue;
    }

    if (data.max !== undefined && parsed > data.max) {
      return data.defaultValue;
    }

    return parsed;
  }

  public static getRandomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

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
