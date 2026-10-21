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
    expect(
      getHardwareDetail({
        kind: StorageArrayResourceKind.Controller,
        statusDetail: "primary",
        model: "FA-X70R3",
      }),
    ).toBe("primary · FA-X70R3");
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
