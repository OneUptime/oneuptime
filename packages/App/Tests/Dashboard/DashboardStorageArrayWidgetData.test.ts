import { describe, expect, test } from "@jest/globals";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
} from "Common/Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import {
  HARDWARE_STATUS_COLORS,
  STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES,
  StorageArrayWidgetState,
  VOLUME_LATENCY_COLORS,
  VOLUME_LATENCY_HIGH_USEC,
  VOLUME_LATENCY_SLOW_USEC,
  formatIops,
  formatLatencyUsec,
  formatReadWriteIops,
  formatReadWriteLatencyUsec,
  formatStorageBytes,
  formatUsedOfProvisioned,
  getHardwareDetail,
  getHardwareKindLabel,
  getHardwareStatusState,
  getHardwareStatusText,
  getHardwareTypeName,
  getHardwareTypeText,
  getTotalIops,
  getVolumeLatencyState,
  getVolumeWorstLatencyUsec,
  humanizeArrayValue,
  normalizeComponentStatus,
  toFiniteNumber,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import {
  StorageArrayAlertTemplate,
  getStorageArrayAlertTemplateById,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import {
  createTranslator,
  getInlineSeparator,
  Translator,
} from "Common/Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import { getKnownStorageArrayStatusKey } from "../../FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";

/*
 * What the Storage Array volume and hardware dashboard widgets show: how a
 * volume's latency and a component's status are banded and colored, and
 * how Pure's numbers are written. An operator scans these widgets for the
 * one red cell, so the bands have to agree with the alert templates and
 * with the Storage Arrays pages the cell links to.
 */

// An English letter, and a Latin digit: what a Persian figure never holds.
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const LATIN_DIGIT: RegExp = /[0-9]/;

describe("toFiniteNumber", () => {
  test("reads numbers and numeric strings, and nothing else", () => {
    expect(toFiniteNumber(12)).toBe(12);
    expect(toFiniteNumber("4.5")).toBe(4.5);
    expect(toFiniteNumber(0)).toBe(0);
    for (const value of [undefined, null, "", "abc", NaN, Infinity]) {
      expect(toFiniteNumber(value)).toBeUndefined();
    }
  });
});

describe("volume latency", () => {
  test("bands at the latency alert templates' threshold", () => {
    /*
     * purefa-read-latency-high / purefa-write-latency-high fire above
     * 5000 µs; the widget's red band starts exactly there.
     */
    for (const templateId of [
      "purefa-read-latency-high",
      "purefa-write-latency-high",
    ]) {
      const template: StorageArrayAlertTemplate | undefined =
        getStorageArrayAlertTemplateById(templateId);
      expect(template).toBeDefined();

      const step: string = JSON.stringify(
        template!.getMonitorStep({
          arrayIdentifier: "fa-prod-01",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "latency",
        }),
      );
      expect(step).toContain(String(VOLUME_LATENCY_HIGH_USEC));
    }
    expect(VOLUME_LATENCY_HIGH_USEC).toBe(5000);
    expect(VOLUME_LATENCY_SLOW_USEC).toBe(1000);
  });

  test("takes the slower of read and write latency", () => {
    expect(getVolumeWorstLatencyUsec(300, 900)).toBe(900);
    expect(getVolumeWorstLatencyUsec(7000, 200)).toBe(7000);
    expect(getVolumeWorstLatencyUsec(undefined, 450)).toBe(450);
    expect(getVolumeWorstLatencyUsec("1200", null)).toBe(1200);
    expect(getVolumeWorstLatencyUsec(undefined, undefined)).toBeUndefined();
    expect(getVolumeWorstLatencyUsec(null, "")).toBeUndefined();
  });

  test.each([
    [250, 400, "Under 1 ms", VOLUME_LATENCY_COLORS.fast],
    [999, 0, "Under 1 ms", VOLUME_LATENCY_COLORS.fast],
    [1000, 0, "1–5 ms", VOLUME_LATENCY_COLORS.slow],
    [200, 5000, "1–5 ms", VOLUME_LATENCY_COLORS.slow],
    [200, 5001, "Over 5 ms", VOLUME_LATENCY_COLORS.high],
    [12000, undefined, "Over 5 ms", VOLUME_LATENCY_COLORS.high],
    [undefined, undefined, "No data", VOLUME_LATENCY_COLORS.noData],
  ])(
    "read %p µs / write %p µs reads %p",
    (
      read: number | undefined,
      write: number | undefined,
      text: string,
      color: string,
    ) => {
      const state: StorageArrayWidgetState = getVolumeLatencyState(read, write);
      expect(state.text).toBe(text);
      expect(state.color).toBe(color);
      expect(state.textColor.length).toBeGreaterThan(0);
    },
  );

  test("writes sub-millisecond latency in µs and the rest in ms", () => {
    expect(formatLatencyUsec(420)).toBe("420 µs");
    expect(formatLatencyUsec(999.4)).toBe("999 µs");
    expect(formatLatencyUsec(1000)).toBe("1.00 ms");
    expect(formatLatencyUsec(2345)).toBe("2.35 ms");
    expect(formatLatencyUsec(undefined)).toBe("—");
    expect(formatLatencyUsec("not a number")).toBe("—");
  });
});

describe("volume IOPS and capacity", () => {
  test("adds read and write IOPS, treating one missing side as zero", () => {
    expect(getTotalIops(1200, 300)).toBe(1500);
    expect(getTotalIops(undefined, 300)).toBe(300);
    expect(getTotalIops(1200, null)).toBe(1200);
    expect(getTotalIops(undefined, undefined)).toBeUndefined();
  });

  test("writes IOPS compactly", () => {
    expect(formatIops(0)).toBe("0");
    expect(formatIops(842.6)).toBe("843");
    expect(formatIops(1500)).toBe("1.5K");
    expect(formatIops(2_400_000)).toBe("2.4M");
    expect(formatIops(undefined)).toBe("—");
  });

  test("writes bytes in binary units up to PiB", () => {
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(1024)).toBe("1.0 KiB");
    expect(formatStorageBytes(5 * 1024 ** 3)).toBe("5.0 GiB");
    expect(formatStorageBytes(3.84 * 1024 ** 4)).toBe("3.8 TiB");
    expect(formatStorageBytes(2 * 1024 ** 5)).toBe("2.0 PiB");
    // Past PiB it stays in PiB rather than inventing a unit.
    expect(formatStorageBytes(4096 * 1024 ** 5)).toBe("4096.0 PiB");
    expect(formatStorageBytes(undefined)).toBe("—");
  });
});

describe("hardware status", () => {
  test("bands by the same critical / warning split ingest derives array health from", () => {
    for (const status of STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES) {
      expect(getHardwareStatusState(status).text).toBe("Critical");
      expect(getHardwareStatusState(status).color).toBe(
        HARDWARE_STATUS_COLORS.critical,
      );
    }
    for (const status of STORAGE_ARRAY_WARNING_COMPONENT_STATUSES) {
      expect(getHardwareStatusState(status).text).toBe("Warning");
      expect(getHardwareStatusState(status).color).toBe(
        HARDWARE_STATUS_COLORS.warning,
      );
    }
  });

  test("reads healthy statuses as green", () => {
    for (const status of ["ok", "healthy", "ready"]) {
      expect(getHardwareStatusState(status).text).toBe("Healthy");
      expect(getHardwareStatusState(status).color).toBe(
        HARDWARE_STATUS_COLORS.healthy,
      );
    }
  });

  test("keeps the expected in-between states gray, never green", () => {
    for (const status of [
      "not_installed",
      "device_off",
      "identifying",
      "empty",
      "unused",
      "something_new",
    ]) {
      const state: StorageArrayWidgetState = getHardwareStatusState(status);
      expect({ status, text: state.text }).toEqual({ status, text: "Other" });
      expect(state.color).toBe(HARDWARE_STATUS_COLORS.other);
    }
  });

  test("reads a missing status as No status", () => {
    for (const status of [undefined, null, "", "   ", 3]) {
      expect(getHardwareStatusState(status).text).toBe("No status");
      expect(getHardwareStatusState(status).color).toBe(
        HARDWARE_STATUS_COLORS.noStatus,
      );
    }
  });

  test("is case- and whitespace-insensitive", () => {
    expect(normalizeComponentStatus("  CRITICAL ")).toBe("critical");
    expect(getHardwareStatusState(" Degraded").text).toBe("Warning");
    expect(getHardwareStatusState("OK").text).toBe("Healthy");
  });

  /*
   * That these lists are the Storage Arrays pages' own is held in
   * Common/Tests/App/Dashboard/DashboardStorageArrayWidgets.test.ts: the
   * pages' module needs a browser to import.
   */
  test("healthy, critical and warning statuses never overlap", () => {
    for (const status of STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES) {
      expect(STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES).not.toContain(status);
      expect(STORAGE_ARRAY_WARNING_COMPONENT_STATUSES).not.toContain(status);
    }
  });
});

describe("hardware text", () => {
  test("humanizes the array's own words, keeping acronyms", () => {
    expect(humanizeArrayValue("not_installed")).toBe("Not Installed");
    expect(humanizeArrayValue("power_supply")).toBe("Power Supply");
    expect(humanizeArrayValue("not ready")).toBe("Not Ready");
    expect(humanizeArrayValue("ok")).toBe("OK");
    expect(humanizeArrayValue("SSD")).toBe("SSD");
    expect(humanizeArrayValue("NVRAM")).toBe("NVRAM");
    expect(humanizeArrayValue(undefined)).toBe("—");
    expect(humanizeArrayValue("  ")).toBe("—");
  });

  test("names each kind the widget lists by its singular label", () => {
    expect(getHardwareKindLabel(StorageArrayResourceKind.Hardware)).toBe(
      "Hardware Component",
    );
    expect(getHardwareKindLabel(StorageArrayResourceKind.Drive)).toBe("Drive");
    expect(getHardwareKindLabel(StorageArrayResourceKind.Controller)).toBe(
      "Controller",
    );
    // A kind the widget does not list falls back to the raw value.
    expect(getHardwareKindLabel(StorageArrayResourceKind.Volume)).toBe(
      "Volume",
    );
    expect(getHardwareKindLabel(undefined)).toBe("—");
  });

  test("names a hardware component by its type, and drives and controllers by kind and type", () => {
    expect(
      getHardwareTypeText({
        kind: StorageArrayResourceKind.Hardware,
        componentType: "power_supply",
      }),
    ).toBe("Power Supply");
    expect(
      getHardwareTypeText({
        kind: StorageArrayResourceKind.Drive,
        componentType: "SSD",
      }),
    ).toBe("Drive · SSD");
    expect(
      getHardwareTypeText({
        kind: StorageArrayResourceKind.Controller,
        componentType: "array_controller",
      }),
    ).toBe("Controller · Array Controller");
    expect(getHardwareTypeText({ kind: StorageArrayResourceKind.Drive })).toBe(
      "Drive",
    );
    expect(
      getHardwareTypeText({
        kind: StorageArrayResourceKind.Hardware,
        componentType: "",
      }),
    ).toBe("Hardware Component");
  });

  test("details a drive by its size, a controller by mode and model, a component by temperature", () => {
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Drive,
        capacityBytes: 3.84 * 1024 ** 4,
      }),
    ).toBe("3.8 TiB");
    // A mode the widget knows is a word of the reader's language (#7091).
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Controller,
        statusDetail: "primary",
        model: "FA-X70R3",
      }),
    ).toBe("Primary · FA-X70R3");
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Controller,
        model: "FA-X70R3",
      }),
    ).toBe("FA-X70R3");
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Hardware,
        temperatureCelsius: 27.6,
      }),
    ).toBe("28 °C");
    // Nothing reported: a dash, never "undefined".
    expect(getHardwareDetail({ kind: StorageArrayResourceKind.Drive })).toBe(
      "—",
    );
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Hardware,
        capacityBytes: 100,
      }),
    ).toBe("—");
  });
});

/*
 * THE HARDWARE LIST'S WORDS, IN THE READER'S LANGUAGE (#7091).
 *
 * The Storage Array hardware list named a component's kind and type in
 * English on every board ("Power supply", "Controller · Array controller",
 * "primary · FA-X70R3"). Each word the widget knows is the reader's now; a
 * type it does not know is the array's own word, drawn as reported, and a
 * model is the array's name. Read with the Dashboard's own locales.
 */
describe("the hardware list's words, in the reader's language", () => {
  const german: Translator = dashboardTranslator("de");
  const persian: Translator = dashboardTranslator("fa");

  // The words the widget writes for the types it knows, and their keys.
  const KNOWN_TYPES: ReadonlyArray<[string, string]> = [
    ["chassis", "Chassis"],
    ["controller", "Controller"],
    ["cooling", "Cooling"],
    ["drive_bay", "Drive Bay"],
    ["nvram_bay", "NVRAM Bay"],
    ["power_supply", "Power Supply"],
    ["temp_sensor", "Temperature Sensor"],
    ["eth_port", "Ethernet Port"],
    ["fc_port", "Fibre Channel Port"],
    ["ib_port", "InfiniBand Port"],
    ["sas_port", "SAS Port"],
    ["mgmt_port", "Management Port"],
    ["array_controller", "Array Controller"],
    ["shelf_controller", "Shelf Controller"],
    ["cache", "Cache"],
    ["ch", "Chassis"],
    ["fb", "Blade"],
    ["fm", "Fabric Module"],
    ["xfm", "External Fabric Module"],
    ["pwr", "Power Supply"],
    ["fan", "Fan"],
    ["eth", "Ethernet Port"],
  ];

  test("with no translator, English, as every caller outside a component reads it", () => {
    expect(getHardwareTypeName("power_supply")).toBe("Power Supply");
    expect(getHardwareKindLabel(StorageArrayResourceKind.Drive)).toBe("Drive");
    expect(
      getHardwareTypeText({
        kind: StorageArrayResourceKind.Controller,
        componentType: "array_controller",
      }),
    ).toBe("Controller · Array Controller");
  });

  test("each type the widget knows is an English word of its own, and a word every Dashboard language has", () => {
    for (const [reported, word] of KNOWN_TYPES) {
      expect({ reported, name: getHardwareTypeName(reported) }).toEqual({
        reported,
        name: word,
      });

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          word,
          worded: isWordedInDashboardLocale(word, language),
        }).toEqual({ language, word, worded: true });
      }
    }
  });

  test("a type is read however the array writes it: case, spaces and dashes aside", () => {
    for (const reported of [
      "power_supply",
      "POWER_SUPPLY",
      "Power supply",
      "power-supply",
      "  power_supply  ",
    ]) {
      expect(getHardwareTypeName(reported, german)).toBe("Netzteil");
    }
  });

  test("a type it does not know is the array's own word, as reported, in any language", () => {
    expect(getHardwareTypeName("SSD", german)).toBe("SSD");
    expect(getHardwareTypeName("NVRAM", persian)).toBe("NVRAM");
    expect(getHardwareTypeName("flux_capacitor", german)).toBe(
      humanizeArrayValue("flux_capacitor"),
    );
    expect(getHardwareTypeName(undefined, german)).toBe("—");
    expect(getHardwareTypeName(42, german)).toBe(humanizeArrayValue(42));
  });

  test("on a German board: the kind and the type in German, set apart as German sets them", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    expect(getHardwareKindLabel(StorageArrayResourceKind.Drive, german)).toBe(
      "Laufwerk",
    );
    expect(
      getHardwareKindLabel(StorageArrayResourceKind.Hardware, german),
    ).toBe(words["Hardware Component"]);
    // A kind the widget does not list is the value as it came.
    expect(getHardwareKindLabel(StorageArrayResourceKind.Volume, german)).toBe(
      "Volume",
    );
    expect(
      getHardwareTypeText(
        {
          kind: StorageArrayResourceKind.Hardware,
          componentType: "power_supply",
        },
        german,
      ),
    ).toBe("Netzteil");
    expect(
      getHardwareTypeText(
        {
          kind: StorageArrayResourceKind.Controller,
          componentType: "array_controller",
        },
        german,
      ),
    ).toBe(["Controller", "Array-Controller"].join(getInlineSeparator("de")));
    expect(
      getHardwareTypeText(
        { kind: StorageArrayResourceKind.Drive, componentType: "SSD" },
        german,
      ),
    ).toBe(["Laufwerk", "SSD"].join(getInlineSeparator("de")));
  });

  test("on a German board a controller's mode is German; its model, and a mode it does not know, are the array's", () => {
    expect(
      getHardwareDetail(
        {
          kind: StorageArrayResourceKind.Controller,
          statusDetail: "primary",
          model: "FA-X70R3",
        },
        german,
      ),
    ).toBe(["Primär", "FA-X70R3"].join(getInlineSeparator("de")));
    expect(
      getHardwareDetail(
        {
          kind: StorageArrayResourceKind.Controller,
          statusDetail: "Secondary",
        },
        german,
      ),
    ).toBe("Sekundär");
    expect(
      getHardwareDetail(
        {
          kind: StorageArrayResourceKind.Controller,
          statusDetail: "not_installed",
        },
        german,
      ),
    ).toBe("not_installed");
  });

  test("on a Persian board a component's temperature is in Persian digits, and the words are Persian", () => {
    const words: Record<string, string> = readDashboardLocale("fa");
    const detail: string = getHardwareDetail(
      { kind: StorageArrayResourceKind.Hardware, temperatureCelsius: 27.6 },
      persian,
    );

    expect(detail).toBe("۲۸ °C");
    expect(detail).not.toMatch(/[0-9]/);
    expect(
      getHardwareTypeText(
        {
          kind: StorageArrayResourceKind.Hardware,
          componentType: "temp_sensor",
        },
        persian,
      ),
    ).toBe(words["Temperature Sensor"]);
    expect(
      getHardwareDetail(
        {
          kind: StorageArrayResourceKind.Controller,
          statusDetail: "primary",
          model: "FA-X70R3",
        },
        persian,
      ),
    ).toBe([words["Primary"], "FA-X70R3"].join(getInlineSeparator("fa")));
  });

  /*
   * A drive's size sits in the Detail column beside a component's
   * temperature: written in Latin digits, a Persian board read "3.5 TiB"
   * one row from "۲۸ °C".
   */
  test("a drive's size is in the reader's digits and decimal sign, as a temperature beside it is", () => {
    const drive: { kind: StorageArrayResourceKind; capacityBytes: number } = {
      kind: StorageArrayResourceKind.Drive,
      capacityBytes: 3.84 * 1024 ** 4,
    };

    expect(getHardwareDetail(drive, persian)).toBe("۳٫۸ TiB");
    expect(getHardwareDetail(drive, german)).toBe("3,8 TiB");
    expect(getHardwareDetail(drive, createTranslator(undefined, "ar"))).toBe(
      "3.8 TiB",
    );
    expect(getHardwareDetail(drive)).toBe("3.8 TiB");
  });

  test("formatStorageBytes writes the reader's number when it is handed a translator", () => {
    expect(formatStorageBytes(512, persian)).toBe("۵۱۲ B");
    expect(formatStorageBytes(2 * 1024 ** 5, german)).toBe("2,0 PiB");
    expect(formatStorageBytes(4096 * 1024 ** 5, german)).toBe("4.096,0 PiB");
    expect(formatStorageBytes(undefined, persian)).toBe("—");
    // Not handed one, it writes as it always has.
    expect(formatStorageBytes(4096 * 1024 ** 5)).toBe("4096.0 PiB");
  });

  test("a translator with no words of its own writes English, as before", () => {
    const wordless: Translator = createTranslator(undefined, "de");

    expect(getHardwareTypeName("power_supply", wordless)).toBe("Power Supply");
    expect(
      getHardwareDetail(
        {
          kind: StorageArrayResourceKind.Controller,
          statusDetail: "primary",
        },
        wordless,
      ),
    ).toBe("Primary");
  });
});

/*
 * #7521: the hardware list's Status column and a tile's Reported Status
 * drew the array's status as it came, "Degraded" and "Not Installed" in a
 * Persian column whose header, types and details were Persian.
 */
describe("a component's status, in the reader's language", () => {
  const german: Translator = dashboardTranslator("de");
  const persian: Translator = dashboardTranslator("fa");
  const arabic: Translator = dashboardTranslator("ar");

  // Every status the Storage Arrays pages word, as the array writes it, and its key.
  const KNOWN_STATUSES: ReadonlyArray<[string, string]> = [
    ["ok", "OK"],
    ["healthy", "Healthy"],
    ["ready", "Ready"],
    ["enabled", "Enabled"],
    ["online", "Online"],
    ["critical", "Critical"],
    ["failed", "Failed"],
    ["missing", "Missing"],
    ["unhealthy", "Unhealthy"],
    ["degraded", "Degraded"],
    ["unknown", "Unknown"],
    ["unrecognized", "Unrecognized"],
    ["not ready", "Not Ready"],
    ["not_installed", "Not Installed"],
    ["device_off", "Device Off"],
    ["identifying", "Identifying"],
    ["empty", "Empty"],
    ["unused", "Unused"],
    ["disabled", "Disabled"],
  ];

  test("each status the widget bands is one the pages word: its critical, warning and healthy lists", () => {
    for (const status of [
      ...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
      ...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
      ...STORAGE_ARRAY_HEALTHY_COMPONENT_STATUSES.filter(
        (healthy: string): boolean => {
          // A replica link's word, drawn as the array writes it on the pages too.
          return healthy !== "replicating";
        },
      ),
    ]) {
      expect({ status, known: getKnownStorageArrayStatusKey(status) }).toEqual({
        status,
        known: expect.any(String),
      });
    }

    expect(
      KNOWN_STATUSES.map(([status]: [string, string]): string | undefined => {
        return getKnownStorageArrayStatusKey(status);
      }),
    ).toEqual(
      KNOWN_STATUSES.map(([, key]: [string, string]): string => {
        return key;
      }),
    );
  });

  test("with no translator, or an English one, each reads exactly as the array's word did", () => {
    const english: Translator = createTranslator(undefined, "en");

    for (const [status] of KNOWN_STATUSES) {
      expect({ status, text: getHardwareStatusText(status) }).toEqual({
        status,
        text: humanizeArrayValue(status),
      });
      expect({
        status,
        text: getHardwareStatusText(status, english),
      }).toEqual({ status, text: humanizeArrayValue(status) });
    }
  });

  test.each([["de"], ["fa"], ["ar"], ["ja"], ["fr"]])(
    "on a %s board each known status is the locale's word",
    (language: string) => {
      const reader: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      for (const [status, key] of KNOWN_STATUSES) {
        // "OK" is written so in every language.
        expect({
          language,
          key,
          worded: key === "OK" || isWordedInDashboardLocale(key, language),
        }).toEqual({ language, key, worded: true });
        expect({
          language,
          status,
          text: getHardwareStatusText(status, reader),
        }).toEqual({ language, status, text: words[key] });
      }
    },
  );

  test("each known status is worded in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const [, key] of KNOWN_STATUSES) {
        expect({
          language,
          key,
          worded: key === "OK" || isWordedInDashboardLocale(key, language),
        }).toEqual({ language, key, worded: true });
      }
    }
  });

  test("the words a German, a Persian and an Arabic reader see for a part that needs them", () => {
    expect(getHardwareStatusText("degraded", german)).toBe("Beeinträchtigt");
    expect(getHardwareStatusText("critical", german)).toBe("Kritisch");
    expect(getHardwareStatusText("not_installed", german)).toBe(
      "Nicht installiert",
    );
    expect(getHardwareStatusText("degraded", persian)).toBe("کاهش کارایی");
    expect(getHardwareStatusText("not_installed", persian)).toBe("نصب‌نشده");
    expect(getHardwareStatusText("failed", arabic)).toBe("فشل");

    // Not one English letter left in a Persian status the widget knows.
    for (const [status, key] of KNOWN_STATUSES) {
      if (key === "OK") {
        continue;
      }

      expect({
        status,
        latin: LATIN_LETTER.test(getHardwareStatusText(status, persian)),
      }).toEqual({ status, latin: false });
    }
  });

  test("a status is read however the array cases or pads it", () => {
    for (const reported of ["degraded", "DEGRADED", " Degraded ", "Degraded"]) {
      expect(getHardwareStatusText(reported, german)).toBe("Beeinträchtigt");
    }

    expect(getHardwareStatusText("NOT READY", german)).toBe("Nicht bereit");
  });

  test("a status it does not know is the array's own word, as reported, in every language", () => {
    for (const translator of [german, persian, arabic, undefined]) {
      expect(getHardwareStatusText("flux_capacitor", translator)).toBe(
        "Flux Capacitor",
      );
      expect(getHardwareStatusText("Rebuilding", translator)).toBe(
        "Rebuilding",
      );
      // A replica link's word: the pages draw it as written too.
      expect(getHardwareStatusText("replicating", translator)).toBe(
        "Replicating",
      );
      expect(getHardwareStatusText(undefined, translator)).toBe("—");
      expect(getHardwareStatusText("   ", translator)).toBe("—");
      expect(getHardwareStatusText(42, translator)).toBe("—");
    }
  });

  test("a word the object holding the list has is no status it knows", () => {
    for (const reported of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(getKnownStorageArrayStatusKey(reported)).toBeUndefined();
      expect(getHardwareStatusText(reported, german)).toBe(
        humanizeArrayValue(reported),
      );
    }

    expect(getKnownStorageArrayStatusKey(undefined)).toBeUndefined();
    expect(getKnownStorageArrayStatusKey(7)).toBeUndefined();
  });
});

/*
 * #7521: the volume list wrote Used and Provisioned, the latencies and the
 * IOPS in Latin digits with a decimal point on every board, beside a
 * drive's "۳٫۵ TiB" one widget over.
 */
describe("a volume's figures, in the reader's digits", () => {
  const german: Translator = dashboardTranslator("de");
  const persian: Translator = dashboardTranslator("fa");
  const arabic: Translator = dashboardTranslator("ar");
  const english: Translator = createTranslator(undefined, "en");

  const TIB: number = 1024 ** 4;

  const apart: (text: string) => string = (text: string): string => {
    return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
  };

  /*
   * A millisecond figure is the Dashboard's duration (#7418): its unit is
   * the reader's too ("۲٫۳۵ میلی‌ثانیه", "2.35 ملي ث"); a microsecond one
   * keeps the symbol every language writes.
   */
  test("latency: the reader's digits and decimal sign, the unit as every language writes it", () => {
    expect(formatLatencyUsec(420, german)).toBe("420 µs");
    expect(formatLatencyUsec(2345, german)).toBe("2,35 ms");
    expect(formatLatencyUsec(1_234_567, german)).toBe("1.234,57 ms");
    expect(formatLatencyUsec(420, persian)).toBe("۴۲۰ µs");
    expect(formatLatencyUsec(2345, persian)).toBe("۲٫۳۵ میلی‌ثانیه");
    expect(formatLatencyUsec(420.4, persian)).toBe("۴۲۰ µs");
    // Arabic writes Latin digits.
    expect(formatLatencyUsec(2345, arabic)).toBe("2.35 ملي ث");
    expect(formatLatencyUsec(undefined, persian)).toBe("—");
    expect(formatLatencyUsec("not a number", german)).toBe("—");
  });

  test("IOPS: the reader's digits and decimal sign, the K and M kept", () => {
    expect(formatIops(1500, german)).toBe("1,5K");
    expect(formatIops(2_400_000, german)).toBe("2,4M");
    expect(formatIops(1500, persian)).toBe("۱٫۵K");
    expect(formatIops(842.6, persian)).toBe("۸۴۳");
    expect(formatIops(2_400_000, persian)).toBe("۲٫۴M");
    expect(formatIops(0, persian)).toBe("۰");
    expect(formatIops(1500, arabic)).toBe("1.5K");
    expect(formatIops(undefined, german)).toBe("—");
  });

  test("with no translator, or an English one, every figure is as before, a thousand milliseconds aside", () => {
    for (const translator of [undefined, english]) {
      expect(formatLatencyUsec(420, translator)).toBe("420 µs");
      expect(formatLatencyUsec(999.4, translator)).toBe("999 µs");
      expect(formatLatencyUsec(1000, translator)).toBe("1.00 ms");
      expect(formatLatencyUsec(2345, translator)).toBe("2.35 ms");
      // A thousand or more takes its separator, as every duration does (#7418).
      expect(formatLatencyUsec(1_234_567, translator)).toBe("1,234.57 ms");
      expect(formatIops(0, translator)).toBe("0");
      expect(formatIops(842.6, translator)).toBe("843");
      expect(formatIops(1500, translator)).toBe("1.5K");
      expect(formatIops(2_400_000, translator)).toBe("2.4M");
      expect(formatStorageBytes(3.5 * TIB, translator)).toBe("3.5 TiB");
      expect(formatReadWriteLatencyUsec(420, 2345, translator)).toBe(
        "420 µs / 2.35 ms",
      );
      expect(formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, translator)).toBe(
        "3.5 TiB of 10.0 TiB",
      );
      expect(formatReadWriteIops(1234, 300, translator)).toBe(
        "Read 1.2K · Write 300",
      );
    }
  });

  test("used of provisioned: the sentence and its sizes in German, Persian and Arabic", () => {
    expect(formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, german)).toBe(
      "3,5 TiB von 10,0 TiB",
    );
    expect(formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, persian)).toBe(
      "۳٫۵ TiB از ۱۰٫۰ TiB",
    );
    expect(formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, arabic)).toBe(
      "3.5 TiB من 10.0 TiB",
    );
    expect(formatUsedOfProvisioned(undefined, 10 * TIB, german)).toBe(
      "— von 10,0 TiB",
    );
  });

  /*
   * A size is written in its sentence's digits: while a language has no
   * wording of the sentence, the English sentence holds English figures,
   * never "۳٫۵ TiB of ۱۰٫۰ TiB".
   */
  test("an English sentence, where the reader's language has none of its own, holds English figures", () => {
    const persianWords: Record<string, string> = readDashboardLocale("fa");
    const persianWithoutTheSentence: Translator = createTranslator(
      (text: string): string | undefined => {
        if (
          text === "{{used}} of {{provisioned}}" ||
          text === "Read {{read}} · Write {{write}}"
        ) {
          return undefined;
        }

        return persianWords[text];
      },
      "fa",
    );

    expect(
      formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, persianWithoutTheSentence),
    ).toBe("3.5 TiB of 10.0 TiB");
    // Persian's separator, whose zero is a dot (getInlineSeparator).
    expect(formatReadWriteIops(1234, 300, persianWithoutTheSentence)).toBe(
      `Read 1.2K${getInlineSeparator("fa")}Write 300`,
    );
    expect(
      formatUsedOfProvisioned(
        3.5 * TIB,
        10 * TIB,
        createTranslator(undefined, "de"),
      ),
    ).toBe("3.5 TiB of 10.0 TiB");
  });

  test("read and write IOPS under the pointer, in the reader's sentence and digits", () => {
    expect(formatReadWriteIops(1234, 300, german)).toBe(
      "Lesen 1,2K · Schreiben 300",
    );
    expect(formatReadWriteIops(1234, 300, persian)).toBe(
      `خواندن ۱٫۲K${getInlineSeparator("fa")}نوشتن ۳۰۰`,
    );
  });

  /*
   * In a cell read from the right, the write latency's figure after the
   * read latency's Latin "µs" joined one left-to-right run with it: "µs /
   * ۲٫۳۵ ms ۴۲۰". Each latency is set apart, so the cell reads read then
   * write from the right, each whole.
   */
  test("read and write latency: each set apart on a page read from the right, as before on one read from the left", () => {
    expect(formatReadWriteLatencyUsec(420, 2345, persian)).toBe(
      `${apart("۴۲۰ µs")} / ${apart("۲٫۳۵ میلی‌ثانیه")}`,
    );
    expect(formatReadWriteLatencyUsec(420, 2345, arabic)).toBe(
      `${apart("420 µs")} / ${apart("2.35 ملي ث")}`,
    );
    expect(formatReadWriteLatencyUsec(420, 2345, german)).toBe(
      "420 µs / 2,35 ms",
    );
    // A latency the array did not report is the dash, which moves nothing.
    expect(formatReadWriteLatencyUsec(undefined, undefined, persian)).toBe(
      "— / —",
    );
    expect(formatReadWriteLatencyUsec(undefined, 2345, persian)).toBe(
      `— / ${apart("۲٫۳۵ میلی‌ثانیه")}`,
    );
  });

  test("no Latin digit is left in a Persian volume's figures", () => {
    for (const text of [
      formatUsedOfProvisioned(3.5 * TIB, 10 * TIB, persian),
      formatReadWriteLatencyUsec(420, 2345, persian),
      formatReadWriteIops(1234, 300, persian),
      formatIops(1_500_000, persian),
    ]) {
      expect({ text, latin: LATIN_DIGIT.test(text) }).toEqual({
        text,
        latin: false,
      });
    }
  });
});
