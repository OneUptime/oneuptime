/*
 * Unit conversions for transceiver readings.
 *
 * Every vendor MIB reports DOM readings in units of its own choosing: Juniper
 * and HPE Comware in hundredths of a dBm, MikroTik and ArubaOS-Switch in
 * thousandths, Cambium cnMatrix in microwatts, Arista in milliwatts scaled by
 * ENTITY-SENSOR-MIB's SI prefix and precision. The probe turns all of them
 * into the display units of TRANSCEIVER_READING_UNITS here, once, so the
 * server, the dashboard and the AI only ever see degrees C, volts, milliamps
 * and dBm.
 */

/*
 * The floor optical power is shown at. Zero light is minus infinity dBm,
 * which no chart or comparison can use; -40 dBm (0.1 microwatts) is below
 * the sensitivity of every optic in use and is what switch CLIs print for a
 * dark receiver.
 */
export const TRANSCEIVER_MIN_POWER_DBM: number = -40;

/*
 * Raw values that mean "no reading": the Integer32 extremes (HPE Comware
 * returns 2147483647 for an unsupported reading), the ENTITY-SENSOR-MIB
 * underflow and overflow markers (RFC 3433, EntitySensorValue) and -32768
 * (CAMBIUM-NETWORKS-TRANSCEIVER-MIB: "the value is unknown").
 */
const UNAVAILABLE_RAW_VALUES: Set<number> = new Set<number>([
  2147483647, -2147483648, 1000000000, -1000000000, -32768,
]);

export default class TransceiverUnitUtil {
  public static isUnavailableRawValue(raw: number | undefined): boolean {
    return (
      raw === undefined ||
      !Number.isFinite(raw) ||
      UNAVAILABLE_RAW_VALUES.has(raw)
    );
  }

  public static roundTo(value: number, decimals: number): number {
    const factor: number = Math.pow(10, decimals);
    const rounded: number = Math.round(value * factor) / factor;
    // Normalize -0 so a reading of zero never prints as "-0".
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  // An integer in units of 10^-decimals: fromFixedPoint(-473, 2) is -4.73.
  public static fromFixedPoint(raw: number, decimals: number): number {
    return TransceiverUnitUtil.roundTo(raw / Math.pow(10, decimals), decimals);
  }

  /*
   * Milliwatts to dBm: 10 * log10(mW). 1 mW is 0 dBm, 0.5 mW is -3.01 dBm.
   * No light (zero or a negative reading) and anything darker than the
   * floor reads as the floor.
   */
  public static milliwattsToDbm(milliwatts: number): number {
    if (!Number.isFinite(milliwatts) || milliwatts <= 0) {
      return TRANSCEIVER_MIN_POWER_DBM;
    }

    const dbm: number = 10 * Math.log10(milliwatts);

    return TransceiverUnitUtil.roundTo(
      Math.max(TRANSCEIVER_MIN_POWER_DBM, dbm),
      2,
    );
  }

  public static microwattsToDbm(microwatts: number): number {
    return TransceiverUnitUtil.milliwattsToDbm(microwatts / 1000);
  }

  // dBm already measured; only clamps a dark receiver to the floor.
  public static clampDbm(dbm: number): number {
    return TransceiverUnitUtil.roundTo(
      Math.max(TRANSCEIVER_MIN_POWER_DBM, dbm),
      2,
    );
  }

  /*
   * An ENTITY-SENSOR-MIB (RFC 3433) or CISCO-ENTITY-SENSOR-MIB value in SI
   * units. The value is a fixed-point number: scale is the SI prefix as an
   * enumeration (yocto(1) is 10^-24, units(9) is 10^0, yotta(17) is 10^24,
   * three orders of magnitude apart), and a precision of 1 to 9 is the
   * number of decimal places. A precision of zero or below means the value
   * is not fixed-point and is taken as it is.
   *
   * RFC 3433's own example: a reading of 258 with precision 1 and scale
   * units(9) is 25.8 degrees C.
   */
  public static fromEntitySensorValue(data: {
    raw: number;
    scale: number | undefined;
    precision: number | undefined;
  }): number {
    const scale: number =
      data.scale !== undefined &&
      Number.isInteger(data.scale) &&
      data.scale >= 1 &&
      data.scale <= 17
        ? data.scale
        : 9;

    const precision: number =
      data.precision !== undefined &&
      Number.isInteger(data.precision) &&
      data.precision >= 1 &&
      data.precision <= 9
        ? data.precision
        : 0;

    const exponent: number = 3 * (scale - 9) - precision;

    /*
     * Divide by an exact power of ten rather than multiply by its inverse:
     * 258 / 10 is 25.8, while 258 * 0.1 picks up binary noise.
     */
    return exponent < 0
      ? data.raw / Math.pow(10, -exponent)
      : data.raw * Math.pow(10, exponent);
  }
}
