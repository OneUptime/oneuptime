/*
 * Unit conversion utilities for metric alert thresholds. Separate from
 * ValueFormatter (which focuses on auto-scaled display formatting) because
 * thresholds need deterministic, user-selected units — not whatever unit
 * happens to read best for a given magnitude.
 */

export interface UnitOption {
  value: string;
  label: string;
}

interface UnitDefinition {
  value: string;
  label: string;
  aliases: Array<string>;
  toCanonical: number;
}

/*
 * Within a family, `toCanonical` is the multiplier that converts a value
 * expressed in this unit into the family's canonical base (bytes for data,
 * seconds for time, % for percent).
 */
const byteUnits: Array<UnitDefinition> = [
  {
    value: "B",
    label: "Bytes (B)",
    aliases: ["b", "byte", "bytes", "by"],
    toCanonical: 1,
  },
  {
    value: "KB",
    label: "Kilobytes (KB)",
    aliases: ["kb", "kilobyte", "kilobytes", "kby"],
    toCanonical: 1e3,
  },
  {
    value: "MB",
    label: "Megabytes (MB)",
    aliases: ["mb", "megabyte", "megabytes", "mby"],
    toCanonical: 1e6,
  },
  {
    value: "GB",
    label: "Gigabytes (GB)",
    aliases: ["gb", "gigabyte", "gigabytes", "gby"],
    toCanonical: 1e9,
  },
  {
    value: "TB",
    label: "Terabytes (TB)",
    aliases: ["tb", "terabyte", "terabytes", "tby"],
    toCanonical: 1e12,
  },
  {
    value: "PB",
    label: "Petabytes (PB)",
    aliases: ["pb", "petabyte", "petabytes", "pby"],
    toCanonical: 1e15,
  },
];

const timeUnits: Array<UnitDefinition> = [
  {
    value: "ns",
    label: "Nanoseconds (ns)",
    aliases: ["ns", "nanosecond", "nanoseconds"],
    toCanonical: 1e-9,
  },
  {
    value: "µs",
    label: "Microseconds (µs)",
    aliases: ["µs", "us", "microsecond", "microseconds"],
    toCanonical: 1e-6,
  },
  {
    value: "ms",
    label: "Milliseconds (ms)",
    aliases: ["ms", "millisecond", "milliseconds"],
    toCanonical: 1e-3,
  },
  {
    value: "sec",
    label: "Seconds (sec)",
    aliases: ["s", "sec", "second", "seconds"],
    toCanonical: 1,
  },
  {
    value: "min",
    label: "Minutes (min)",
    aliases: ["min", "minute", "minutes"],
    toCanonical: 60,
  },
  {
    value: "hours",
    label: "Hours",
    aliases: ["h", "hr", "hour", "hours"],
    toCanonical: 3600,
  },
  {
    value: "days",
    label: "Days",
    aliases: ["d", "day", "days"],
    toCanonical: 86400,
  },
];

const percentUnits: Array<UnitDefinition> = [
  {
    value: "%",
    label: "Percent (%)",
    aliases: ["%", "percent"],
    toCanonical: 1,
  },
];

const bitUnits: Array<UnitDefinition> = [
  {
    value: "bit",
    label: "Bits (bit)",
    aliases: ["bit", "bits"],
    toCanonical: 1,
  },
  {
    value: "kbit",
    label: "Kilobits (kbit)",
    aliases: ["kbit", "kilobit", "kilobits"],
    toCanonical: 1e3,
  },
  {
    value: "mbit",
    label: "Megabits (mbit)",
    aliases: ["mbit", "megabit", "megabits"],
    toCanonical: 1e6,
  },
  {
    value: "gbit",
    label: "Gigabits (gbit)",
    aliases: ["gbit", "gigabit", "gigabits"],
    toCanonical: 1e9,
  },
];

const allFamilies: Array<Array<UnitDefinition>> = [
  byteUnits,
  timeUnits,
  percentUnits,
  bitUnits,
];

function normalize(unit: string): string {
  return unit.trim().toLowerCase();
}

function findDefinitionInFamily(
  unit: string,
  family: Array<UnitDefinition>,
): UnitDefinition | null {
  const normalized: string = normalize(unit);
  return (
    family.find((u: UnitDefinition) => {
      return u.aliases.includes(normalized);
    }) || null
  );
}

function findFamily(unit: string): Array<UnitDefinition> | null {
  if (!unit || !unit.trim()) {
    return null;
  }
  for (const family of allFamilies) {
    if (findDefinitionInFamily(unit, family)) {
      return family;
    }
  }
  return null;
}

export default class MetricUnitUtil {
  /*
   * Returns the dropdown options the UI should show next to the threshold
   * input, given the metric's native unit. If the unit isn't in any known
   * family, returns a single option matching the raw unit so users still
   * see what they're working with.
   */
  public static getCompatibleUnits(
    metricUnit: string | undefined,
  ): Array<UnitOption> {
    if (!metricUnit || !metricUnit.trim()) {
      return [];
    }

    const family: Array<UnitDefinition> | null = findFamily(metricUnit);
    if (!family) {
      return [{ value: metricUnit, label: metricUnit }];
    }

    return family.map((u: UnitDefinition) => {
      return { value: u.value, label: u.label };
    });
  }

  /*
   * Returns the canonical unit value for the metric's native unit, which
   * is what the threshold dropdown should default to when nothing is
   * selected yet. Returns the input unit unchanged if the family is
   * unknown.
   */
  public static getCanonicalUnitValue(
    metricUnit: string | undefined,
  ): string | undefined {
    if (!metricUnit || !metricUnit.trim()) {
      return undefined;
    }

    const family: Array<UnitDefinition> | null = findFamily(metricUnit);
    if (!family) {
      return metricUnit;
    }

    const def: UnitDefinition | null = findDefinitionInFamily(
      metricUnit,
      family,
    );
    return def?.value || metricUnit;
  }

  /*
   * Converts a threshold value from the user-selected unit into the
   * metric's native unit so comparisons can happen against raw samples.
   * Returns the unchanged value when either unit is unknown or they
   * belong to different families — the evaluator shouldn't silently
   * produce nonsense numbers.
   */
  public static convertToMetricUnit(input: {
    value: number;
    fromUnit: string | undefined;
    metricUnit: string | undefined;
  }): number {
    const { value, fromUnit, metricUnit } = input;

    if (!fromUnit || !metricUnit) {
      return value;
    }

    if (normalize(fromUnit) === normalize(metricUnit)) {
      return value;
    }

    const family: Array<UnitDefinition> | null = findFamily(metricUnit);
    if (!family) {
      return value;
    }

    const fromDef: UnitDefinition | null = findDefinitionInFamily(
      fromUnit,
      family,
    );
    const metricDef: UnitDefinition | null = findDefinitionInFamily(
      metricUnit,
      family,
    );

    if (!fromDef || !metricDef) {
      return value;
    }

    /*
     * value_in_canonical = value * fromDef.toCanonical
     * value_in_metric    = value_in_canonical / metricDef.toCanonical
     */
    return (value * fromDef.toCanonical) / metricDef.toCanonical;
  }

  /*
   * Convenience: does the metric unit belong to a family we can offer
   * conversions for? When false, the UI should still render a dropdown,
   * but with just the raw unit.
   */
  public static hasCompatibleUnitFamily(
    metricUnit: string | undefined,
  ): boolean {
    if (!metricUnit || !metricUnit.trim()) {
      return false;
    }
    return findFamily(metricUnit) !== null;
  }
}
