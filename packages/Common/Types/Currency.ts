import BadDataException from "./Exception/BadDataException";

export default class Currency {
  public static convertToDecimalPlaces(
    value: number,
    decimalPlaces: number = 2,
  ): number {
    if (decimalPlaces < 0) {
      throw new BadDataException(
        "decimalPlaces must be greater than or equal to 0.",
      );
    }

    if (typeof value === "string") {
      value = parseFloat(value);
    }

    if (decimalPlaces === 0) {
      return Math.ceil(value);
    }

    value = value * Math.pow(10, decimalPlaces);

    // convert to int.

    value = Math.round(value);

    // convert back to float.

    value = value / Math.pow(10, decimalPlaces);

    return value;
  }
}
