import MetricUnitUtil from "../../Utils/MetricUnitUtil";

describe("MetricUnitUtil", () => {
  describe("getCompatibleUnits", () => {
    test("returns empty array for undefined / empty unit", () => {
      expect(MetricUnitUtil.getCompatibleUnits(undefined)).toEqual([]);
      expect(MetricUnitUtil.getCompatibleUnits("")).toEqual([]);
      expect(MetricUnitUtil.getCompatibleUnits("   ")).toEqual([]);
    });

    test("returns byte family for 'bytes'", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("bytes");
      const values: Array<string> = options.map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toEqual(["B", "KB", "MB", "GB", "TB", "PB"]);
    });

    test("returns byte family for UCUM 'By' code", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("By");
      expect(options.length).toBe(6);
      expect(options[0]!.value).toBe("B");
    });

    test("returns time family for 'ms'", () => {
      const values: Array<string> = MetricUnitUtil.getCompatibleUnits("ms").map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toEqual(["ns", "µs", "ms", "sec", "min", "hours", "days"]);
    });

    test("returns time family for 's'", () => {
      const values: Array<string> = MetricUnitUtil.getCompatibleUnits("s").map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toContain("sec");
      expect(values).toContain("ms");
      expect(values).toContain("hours");
    });

    test("returns percent family for '%'", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("%");
      expect(options).toEqual([
        { value: "%", label: "Percent (%)" },
        { value: "1", label: "Fraction (0-1)" },
      ]);
    });

    test("returns percent family for UCUM '1' (dimensionless / ratio)", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("1");
      expect(options).toEqual([
        { value: "%", label: "Percent (%)" },
        { value: "1", label: "Fraction (0-1)" },
      ]);
    });

    test("returns raw unit as sole option for unknown unit", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("widgets");
      expect(options).toEqual([{ value: "widgets", label: "widgets" }]);
    });
  });

  describe("getCanonicalUnitValue", () => {
    test("returns canonical value for aliases", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("bytes")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("Byte")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("MB")).toBe("MB");
      expect(MetricUnitUtil.getCanonicalUnitValue("milliseconds")).toBe("ms");
      expect(MetricUnitUtil.getCanonicalUnitValue("second")).toBe("sec");
      expect(MetricUnitUtil.getCanonicalUnitValue("percent")).toBe("%");
    });

    test("returns '%' for UCUM dimensionless '1' so the threshold UI doesn't default to a literal '1'", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("1")).toBe("%");
    });

    test("passes through unknown units", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("widgets")).toBe("widgets");
    });

    test("returns undefined for empty", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue(undefined)).toBeUndefined();
      expect(MetricUnitUtil.getCanonicalUnitValue("")).toBeUndefined();
    });
  });

  describe("convertToMetricUnit", () => {
    test("no conversion when units match", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 123,
          fromUnit: "MB",
          metricUnit: "MB",
        }),
      ).toBe(123);
    });

    test("converts MB to bytes", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "MB",
          metricUnit: "bytes",
        }),
      ).toBe(2e6);
    });

    test("converts bytes to GB", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 5e9,
          fromUnit: "bytes",
          metricUnit: "GB",
        }),
      ).toBe(5);
    });

    test("converts sec to ms", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "sec",
          metricUnit: "ms",
        }),
      ).toBe(2000);
    });

    test("converts ms to sec", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1500,
          fromUnit: "ms",
          metricUnit: "sec",
        }),
      ).toBe(1.5);
    });

    test("converts min to sec", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "min",
          metricUnit: "sec",
        }),
      ).toBe(120);
    });

    test("converts hours to ms", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1,
          fromUnit: "hours",
          metricUnit: "ms",
        }),
      ).toBe(3_600_000);
    });

    test("returns value unchanged when units are from different families", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: "sec",
        }),
      ).toBe(100);
    });

    test("returns value unchanged when metric unit is unknown", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: "widgets",
        }),
      ).toBe(100);
    });

    test("returns value unchanged when either unit is missing", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: undefined,
          metricUnit: "bytes",
        }),
      ).toBe(100);

      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: undefined,
        }),
      ).toBe(100);
    });

    test("handles case-insensitive unit matching", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "gb",
          metricUnit: "BYTES",
        }),
      ).toBe(2e9);
    });

    test("converts '%' to the fraction unit '1' by dividing by 100", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 50,
          fromUnit: "%",
          metricUnit: "1",
        }),
      ).toBe(0.5);
    });

    test("converts the fraction unit '1' to '%' by multiplying by 100", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 0.05,
          fromUnit: "1",
          metricUnit: "%",
        }),
      ).toBe(5);
    });
  });

  describe("getFamilyBaseUnit", () => {
    test("returns the family's canonical base for every member", () => {
      for (const unit of [
        "B",
        "b",
        "By",
        "bytes",
        "KB",
        "kby",
        "MB",
        "GB",
        "TB",
        "PB",
      ]) {
        expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("B");
      }

      for (const unit of [
        "ns",
        "µs",
        "us",
        "ms",
        "s",
        "sec",
        "seconds",
        "min",
        "hours",
        "d",
        "days",
      ]) {
        expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("sec");
      }

      for (const unit of ["%", "percent", "1"]) {
        expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("%");
      }

      for (const unit of ["bit", "bits", "kbit", "mbit", "gbit"]) {
        expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("bit");
      }
    });

    test("is case- and whitespace-insensitive", () => {
      expect(MetricUnitUtil.getFamilyBaseUnit("  GB  ")).toBe("B");
      expect(MetricUnitUtil.getFamilyBaseUnit("MS")).toBe("sec");
    });

    test("returns null for an unknown or empty unit", () => {
      expect(MetricUnitUtil.getFamilyBaseUnit(undefined)).toBeNull();
      expect(MetricUnitUtil.getFamilyBaseUnit("")).toBeNull();
      expect(MetricUnitUtil.getFamilyBaseUnit("   ")).toBeNull();
      expect(MetricUnitUtil.getFamilyBaseUnit("cores")).toBeNull();
      expect(MetricUnitUtil.getFamilyBaseUnit("widgets")).toBeNull();
      /*
       * A braced annotation is not a unit, even when the text inside it
       * is one — MetricValueFormatter unwraps "{KiBy/s}" itself.
       */
      expect(MetricUnitUtil.getFamilyBaseUnit("{KiBy}")).toBeNull();
    });

    /*
     * The base is the unit every other member converts into with the
     * family's own converter — this is the contract MetricValueFormatter
     * relies on when it restates "2500 GB" as bytes before scaling.
     */
    test("the base it names round-trips through convertToMetricUnit", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2500,
          fromUnit: "GB",
          metricUnit: MetricUnitUtil.getFamilyBaseUnit("GB") as string,
        }),
      ).toBe(2.5e12);

      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 36,
          fromUnit: "hours",
          metricUnit: MetricUnitUtil.getFamilyBaseUnit("hours") as string,
        }),
      ).toBe(129600);
    });
  });

  /*
   * Binary (IEC) byte units — powers of 1024. The vcenter receiver reports
   * memory in "MiBy" and "KiBy", and before these were family members a
   * "MiBy" sample could not be converted at all: a 2 GB threshold on a
   * MiBy metric was compared as "2 MiB", and the notification formatter
   * printed "1048576 MiB" because the unit had no base to scale from.
   */
  describe("binary (IEC) byte units", () => {
    const binaryUnits: Array<{ spellings: Array<string>; bytes: number }> = [
      {
        spellings: ["KiBy", "KiB", "kib", "kiby", "kibibyte", "kibibytes"],
        bytes: 1024,
      },
      {
        spellings: ["MiBy", "MiB", "mib", "miby", "mebibyte", "mebibytes"],
        bytes: 1024 ** 2,
      },
      {
        spellings: ["GiBy", "GiB", "gib", "giby", "gibibyte", "gibibytes"],
        bytes: 1024 ** 3,
      },
      {
        spellings: ["TiBy", "TiB", "tib", "tiby", "tebibyte", "tebibytes"],
        bytes: 1024 ** 4,
      },
      {
        spellings: ["PiBy", "PiB", "pib", "piby", "pebibyte", "pebibytes"],
        bytes: 1024 ** 5,
      },
    ];

    test("every spelling belongs to the byte family", () => {
      for (const { spellings } of binaryUnits) {
        for (const unit of spellings) {
          expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("B");
        }
      }
    });

    test("every spelling converts to its power of 1024 in bytes", () => {
      for (const { spellings, bytes } of binaryUnits) {
        for (const unit of spellings) {
          expect(
            MetricUnitUtil.convertToMetricUnit({
              value: 1,
              fromUnit: unit,
              metricUnit: "By",
            }),
          ).toBe(bytes);
        }
      }
    });

    test("is case- and whitespace-insensitive", () => {
      expect(MetricUnitUtil.getFamilyBaseUnit("  MIBY  ")).toBe("B");
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 3,
          fromUnit: "GIB",
          metricUnit: " bytes ",
        }),
      ).toBe(3 * 1024 ** 3);
    });

    test("a MiBy value converts into a GB threshold (was returned unchanged)", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2048,
          fromUnit: "MiBy",
          metricUnit: "GB",
        }),
      ).toBe(2.147483648);
    });

    test("a GB threshold converts into a MiBy metric's unit", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "GB",
          metricUnit: "MiBy",
        }),
      ).toBe(1907.3486328125);
    });

    test("converts between binary units by powers of 1024", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1,
          fromUnit: "GiBy",
          metricUnit: "MiBy",
        }),
      ).toBe(1024);
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1048576,
          fromUnit: "KiBy",
          metricUnit: "GiBy",
        }),
      ).toBe(1);
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1,
          fromUnit: "PiB",
          metricUnit: "TiB",
        }),
      ).toBe(1024);
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1048576,
          fromUnit: "bytes",
          metricUnit: "KiBy",
        }),
      ).toBe(1024);
    });

    test("the UCUM and short spellings of one unit are the same unit", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 512,
          fromUnit: "MiB",
          metricUnit: "MiBy",
        }),
      ).toBe(512);
    });

    test("still refuses to convert across families", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MiBy",
          metricUnit: "sec",
        }),
      ).toBe(100);
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "KiBy",
          metricUnit: "kbit",
        }),
      ).toBe(100);
    });

    /*
     * The binary units are CONVERSION-ONLY. The threshold and legend unit
     * pickers (CriteriaFilter, MetricAlias) are built from
     * getCompatibleUnits / getCanonicalUnitValue / hasCompatibleUnitFamily,
     * and every bytes dropdown would otherwise grow five near-duplicates
     * of the six decimal units. So the picker contract is exactly what it
     * was before the binary units existed.
     */
    describe("never reach the unit pickers", () => {
      test("no bytes dropdown offers a binary unit", () => {
        for (const unit of ["B", "By", "bytes", "KB", "MB", "GB", "TB"]) {
          expect(
            MetricUnitUtil.getCompatibleUnits(unit).map(
              (o: { value: string; label: string }) => {
                return o.value;
              },
            ),
          ).toEqual(["B", "KB", "MB", "GB", "TB", "PB"]);
        }
      });

      test("a binary native unit still gets its raw spelling as the only option", () => {
        for (const { spellings } of binaryUnits) {
          for (const unit of spellings) {
            expect(MetricUnitUtil.getCompatibleUnits(unit)).toEqual([
              { value: unit, label: unit },
            ]);
            expect(MetricUnitUtil.getCanonicalUnitValue(unit)).toBe(unit);
            expect(MetricUnitUtil.hasCompatibleUnitFamily(unit)).toBe(false);
          }
        }
      });
    });
  });

  /*
   * The binary units were added to the SAME family as B / KB / MB. Every
   * decimal answer below is pinned so that addition can never shift one.
   */
  describe("decimal bytes are unchanged by the binary units", () => {
    test("each decimal spelling still converts by powers of 1000", () => {
      const cases: Array<[string, number]> = [
        ["B", 1],
        ["b", 1],
        ["By", 1],
        ["byte", 1],
        ["bytes", 1],
        ["KB", 1e3],
        ["kby", 1e3],
        ["kilobytes", 1e3],
        ["MB", 1e6],
        ["mby", 1e6],
        ["GB", 1e9],
        ["gby", 1e9],
        ["TB", 1e12],
        ["PB", 1e15],
      ];

      for (const [unit, bytes] of cases) {
        expect(
          MetricUnitUtil.convertToMetricUnit({
            value: 1,
            fromUnit: unit,
            metricUnit: "B",
          }),
        ).toBe(bytes);
        expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("B");
      }
    });

    test("each decimal spelling still canonicalizes to its decimal unit", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("By")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("bytes")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("kby")).toBe("KB");
      expect(MetricUnitUtil.getCanonicalUnitValue("GB")).toBe("GB");
      expect(MetricUnitUtil.hasCompatibleUnitFamily("By")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("KB")).toBe(true);
    });
  });

  describe("hasCompatibleUnitFamily", () => {
    test("true for known families", () => {
      expect(MetricUnitUtil.hasCompatibleUnitFamily("bytes")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("ms")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("%")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("1")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("GB")).toBe(true);
    });

    test("false for unknown or empty", () => {
      expect(MetricUnitUtil.hasCompatibleUnitFamily(undefined)).toBe(false);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("")).toBe(false);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("widgets")).toBe(false);
    });
  });
});
