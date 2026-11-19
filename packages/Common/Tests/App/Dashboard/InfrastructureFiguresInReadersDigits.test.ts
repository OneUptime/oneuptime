import { afterEach, describe, expect, test } from "@jest/globals";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  formatBytes as formatProxmoxBytes,
  formatBytesForChart as formatProxmoxChartBytes,
  formatPercent as formatProxmoxPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxResourceUtils";
import {
  formatBytes as formatVMwareBytes,
  formatBytesForChart as formatVMwareChartBytes,
  formatMhz,
  formatMhzForChart,
  formatPercent as formatVMwarePercent,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareResourceUtils";
import CephResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils";

/*
 * THE PROXMOX, VMWARE AND CEPH FIGURES IN THE READER'S DIGITS (#9646).
 *
 * Their formatBytes and formatPercent wrote English digits with toFixed on
 * every page: "36.2 GiB" and "85.4%" on a German or Persian tile. They now
 * write the reader's digits, decimal sign and percent sign, with the same
 * decimals - English exactly as toFixed wrote it. A chart's value axis
 * keeps English (formatBytesForChart, formatMhzForChart): the metric chart
 * writes that in the reader's digits itself, and handed a German "1.000"
 * it would read one thousand as one.
 */

const GIB: number = 1024 * 1024 * 1024;

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("in English, exactly as toFixed wrote them", () => {
  test.each([
    ["Proxmox", formatProxmoxBytes, formatProxmoxPercent],
    ["VMware", formatVMwareBytes, formatVMwarePercent],
    ["Ceph", CephResourceUtils.formatBytes, CephResourceUtils.formatPercent],
  ])(
    "%s",
    (
      _product: string,
      formatBytes: (bytes: number | null | undefined) => string,
      formatPercent: (value: number | null | undefined) => string,
    ) => {
      setDateDisplayLanguage("en");
      expect(formatBytes(36.2 * GIB)).toBe("36.2 GiB");
      expect(formatBytes(512 * GIB)).toBe("512 GiB");
      expect(formatBytes(42)).toBe("42 B");
      expect(formatPercent(85.43)).toBe("85.4%");
    },
  );

  test("Ceph's counts and VMware's MHz", () => {
    setDateDisplayLanguage("en");
    expect(CephResourceUtils.formatCount(1_250_000)).toBe("1.3M");
    expect(CephResourceUtils.formatCount(830)).toBe("830");
    expect(formatMhz(2400)).toBe("2.40 GHz");
    expect(formatMhz(800)).toBe("800 MHz");
  });
});

describe("in the reader's language", () => {
  test.each([
    ["Proxmox", formatProxmoxBytes, formatProxmoxPercent],
    ["VMware", formatVMwareBytes, formatVMwarePercent],
    ["Ceph", CephResourceUtils.formatBytes, CephResourceUtils.formatPercent],
  ])(
    "%s writes German's decimal comma and Persian's digits",
    (
      _product: string,
      formatBytes: (bytes: number | null | undefined) => string,
      formatPercent: (value: number | null | undefined) => string,
    ) => {
      setDateDisplayLanguage("de");
      expect(formatBytes(36.2 * GIB)).toBe("36,2 GiB");
      expect(formatPercent(85.43)).toBe("85,4 %");

      setDateDisplayLanguage("fa");
      expect(formatBytes(36.2 * GIB)).toBe("۳۶٫۲ GiB");
      expect(formatPercent(85.43)).toBe("۸۵٫۴٪");
    },
  );

  test("Ceph's counts and VMware's MHz too", () => {
    setDateDisplayLanguage("fa");
    expect(CephResourceUtils.formatCount(1_250_000)).toBe("۱٫۳M");
    expect(formatMhz(2400)).toBe("۲٫۴۰ GHz");
  });

  test("a chart's axis keeps English, for the chart to write in the reader's digits", () => {
    setDateDisplayLanguage("de");
    expect(formatProxmoxChartBytes(1000 * GIB)).toBe("1000 GiB");
    expect(formatVMwareChartBytes(36.2 * GIB)).toBe("36.2 GiB");
    expect(formatMhzForChart(2400)).toBe("2.40 GHz");
    // A page's own figure is German.
    expect(formatProxmoxBytes(1000 * GIB)).toBe("1.000 GiB");
  });
});
