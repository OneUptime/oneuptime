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
  formatStorageBytes,
  getHardwareDetail,
  getHardwareKindLabel,
  getHardwareStatusState,
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

/*
 * What the Storage Array volume and hardware dashboard widgets show: how a
 * volume's latency and a component's status are banded and colored, and
 * how Pure's numbers are written. An operator scans these widgets for the
 * one red cell, so the bands have to agree with the alert templates and
 * with the Storage Arrays pages the cell links to.
 */

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
