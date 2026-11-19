import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import HostFilesystemsTable, {
  HOST_FILESYSTEMS_TABLE_ID,
  HOST_FILESYSTEMS_TABLE_KEY,
  HostMount,
  getHostMountUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostFilesystemsTable";
import { HOST_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import { forgetRememberedTableFits } from "../../../UI/Components/Table/useTableFit";
import { TABLE_FOLDED_VALUE_TEST_ID } from "../../../UI/Components/Table/TableFoldedValues";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import {
  StorageUsage,
  StorageUsageLevel,
} from "../../../Utils/Storage/StorageUsage";
import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_DISK_USAGE_THRESHOLDS,
} from "../../../Types/Host/HostHealth";

/*
 * A host's Filesystems (the host Overview) are drawn by the product's
 * table, as every other list is, with the shared storage bar (#9647): how
 * full each mount is (df's Use%), what is free, and its size with the space
 * reserved for root said under it. "466 GiB / 512 GiB" beside 95% read like
 * a mistake while Free and the reserved space were never shown.
 *
 * Where the card is narrower than 48rem (TableFit), the type and the device
 * go under the mount point and Free and Size under the bar; on a phone each
 * mount is a card. jsdom lays nothing out: the box is never measured, so
 * the window stands in for it, as it does before a first measurement.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const GIB: number = 1024 ** 3;
const MIB: number = 1024 ** 2;

/*
 * "/" as df reads an ext4 root that keeps 5% for root: 466 GiB used,
 * 23 GiB anyone can write, 23 GiB reserved - 512 GiB in all, and 95.3% used
 * (466 of 489): past the host's 95% line.
 */
const MOUNTS: Array<HostMount> = [
  {
    mountpoint: "/",
    device: "/dev/nvme0n1p2",
    type: "ext4",
    totalBytes: 512 * GIB,
    usedBytes: 466 * GIB,
    freeBytes: 23 * GIB,
    reservedBytes: 23 * GIB,
    utilizationPercent: (466 / 489) * 100,
  },
  {
    mountpoint: "/boot/efi",
    device: null,
    type: null,
    totalBytes: 512 * MIB,
    usedBytes: 6 * MIB,
    freeBytes: 506 * MIB,
    reservedBytes: 0,
    utilizationPercent: (6 / 512) * 100,
  },
];

const formatBytes: (bytes: number | null | undefined) => string = (
  bytes: number | null | undefined,
): string => {
  return `${Math.round((bytes || 0) / GIB)} GiB`;
};

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const draw: (width: number, mounts?: Array<HostMount>) => void = (
  width: number,
  mounts: Array<HostMount> = MOUNTS,
): void => {
  setWindowWidth(width);
  render(<HostFilesystemsTable mounts={mounts} formatBytes={formatBytes} />);
};

const headerTitles: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("thead th")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
};

const rows: () => Array<HTMLTableRowElement> =
  (): Array<HTMLTableRowElement> => {
    return Array.from(
      document.querySelectorAll<HTMLTableRowElement>(
        `#${HOST_FILESYSTEMS_TABLE_ID}-body > tr`,
      ),
    );
  };

afterEach(() => {
  cleanup();
  forgetRememberedTableFits();
  setWindowWidth(1024);
});

describe("how full a mount is, as the shared storage bar reads it", () => {
  test("used of used plus free: df's Use%, the root-reserved space left out", () => {
    const usage: StorageUsage | null = getHostMountUsage(MOUNTS[0]!);

    expect(usage?.capacity).toBe(489 * GIB);
    expect(usage?.used).toBe(466 * GIB);
    expect(usage?.free).toBe(23 * GIB);
    expect(usage?.usedPercent).toBeCloseTo(MOUNTS[0]!.utilizationPercent, 6);
  });

  test("turns at the host's own lines, only past them, as Needs attention lists a mount", () => {
    expect(HOST_DISK_USAGE_THRESHOLDS).toEqual({
      warningPercent: HOST_DISK_NEAR_FULL_PERCENT,
      criticalPercent: HOST_DISK_FULL_PERCENT,
      isPastLineOnly: true,
    });

    const at: (percent: number) => StorageUsageLevel | undefined = (
      percent: number,
    ): StorageUsageLevel | undefined => {
      return getHostMountUsage({
        usedBytes: percent,
        freeBytes: 100 - percent,
      })?.level;
    };

    expect(at(85)).toBe(StorageUsageLevel.Normal);
    expect(at(85.5)).toBe(StorageUsageLevel.Warning);
    expect(at(95)).toBe(StorageUsageLevel.Warning);
    expect(at(95.5)).toBe(StorageUsageLevel.Critical);
  });

  test("a mount that reports no space has no reading, never 0%", () => {
    expect(getHostMountUsage({ usedBytes: 0, freeBytes: 0 })).toBeNull();
  });
});

describe("a host's Filesystems, on a wide screen", () => {
  test("is the product's table: the mount, its type, its device, how full it is, what is free and its size", () => {
    draw(1280);

    expect(headerTitles()).toEqual([
      "Mount",
      "Type",
      "Device",
      "Used",
      "Free",
      "Size",
    ]);
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Filesystems")).toBeInTheDocument();
  });

  test("each mount: its point and device in a fixed-width face, its type as a tag, then its bar, what is free and its size", () => {
    draw(1280);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[0]!.cells);

    expect(within(cells[0]!).getByText("/")).toHaveClass("font-mono");
    expect(
      within(cells[1]!).getByText("ext4").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "neutral");
    expect(within(cells[2]!).getByText("/dev/nvme0n1p2")).toHaveClass(
      "font-mono",
    );
    // The bar, its percent (whole, rounded down) and the amount used.
    expect(
      within(cells[3]!).getByTestId("host-filesystem-usage"),
    ).toHaveTextContent("95%466 GiB");
    expect(cells[4]).toHaveTextContent("23 GiB");
    // Its whole size, and what of it only root can write.
    expect(
      within(cells[5]!).getByTestId("host-filesystem-size"),
    ).toHaveTextContent("512 GiB23 GiB reserved for root");
  });

  test("a mount with nothing reserved says nothing about it", () => {
    draw(1280);

    expect(
      within(rows()[1]!).queryByTestId("host-filesystem-reserved"),
    ).toBeNull();
  });

  /*
   * On a Persian page /var/lib/postgresql read "var/lib/postgresql/" and a
   * size put its unit first. Each is isolated (bdi), so it reads the way
   * the host wrote it whatever the page's direction.
   */
  test("the mount, its device and its sizes each read the way the host wrote them", () => {
    draw(1280);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[0]!.cells);

    for (const testId of [
      "host-filesystem-mount",
      "host-filesystem-device",
      "host-filesystem-free",
    ]) {
      expect(within(rows()[0]!).getByTestId(testId).tagName).toBe("BDI");
    }
    expect(
      within(cells[5]!).getByTestId("host-filesystem-size").querySelector(
        "bdi",
      ),
    ).toHaveTextContent("512 GiB");
  });

  test("a mount that names no type or device shows the quiet dash", () => {
    draw(1280);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[1]!.cells);

    expect(
      within(cells[1]!).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
    expect(
      within(cells[2]!).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("the bar is as long as the mount is full, calm, amber past 85% and red past 95%, as Needs attention lists it", () => {
    draw(1280);

    const fills: Array<HTMLElement> = screen.getAllByTestId(
      "storage-usage-fill",
    );

    expect(Number.parseFloat(fills[0]!.style.width)).toBeCloseTo(95.3, 1);
    expect(fills[0]).toHaveAttribute("data-level", StorageUsageLevel.Critical);
    expect(fills[0]).toHaveClass("bg-red-500");
    expect(Number.parseFloat(fills[1]!.style.width)).toBeCloseTo(1.17, 1);
    expect(fills[1]).toHaveAttribute("data-level", StorageUsageLevel.Normal);
    expect(fills[1]).toHaveClass("bg-emerald-500");
  });

  test("a bar never runs past its track: a mount that reports less than nothing free is full", () => {
    draw(1280, [{ ...MOUNTS[0]!, freeBytes: -2 * GIB }]);

    const fill: HTMLElement = screen.getByTestId("storage-usage-fill");
    expect(fill.style.width).toBe("100%");
    expect(screen.getByTestId("host-filesystem-usage")).toHaveTextContent(
      "100%",
    );
    // What is free never reads below nothing.
    expect(screen.getByTestId("host-filesystem-free")).toHaveTextContent(
      "0 GiB",
    );
  });

  test("its three metric columns say what they measure, under their (i)", () => {
    draw(1280);

    for (const title of ["Used", "Free", "Size"]) {
      const header: Element = Array.from(
        document.querySelectorAll("thead th"),
      ).find((cell: Element): boolean => {
        return (cell.textContent || "").trim() === title;
      }) as Element;

      expect(header.querySelector("button")).not.toBeNull();
    }
    expect(HOST_METRIC_DESCRIPTIONS.filesystemSize).toContain("1024-based");
    expect(HOST_METRIC_DESCRIPTIONS.filesystemSize).toContain(
      "reserved for root",
    );
    expect(HOST_METRIC_DESCRIPTIONS.filesystemFree).toContain(
      "reserved for root is not counted",
    );
  });

  test("its columns can be sized, and are kept as the Filesystems table's", () => {
    draw(1280);

    expect(HOST_FILESYSTEMS_TABLE_KEY).toBe("host-filesystems-table");
    expect(
      document.querySelectorAll('[data-testid="table-column-resize-handle"]')
        .length,
    ).toBe(6);
  });
});

describe("a host's Filesystems in a card narrower than 48rem", () => {
  test("the type and the device go under the mount point, Free and Size under the bar", () => {
    // Below lg the window stands in for the box: a narrow card.
    draw(900);

    expect(headerTitles()).toEqual(["Mount", "Used"]);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[0]!.cells);
    const folded: (cell: HTMLTableCellElement) => Array<string> = (
      cell: HTMLTableCellElement,
    ): Array<string> => {
      return within(cell)
        .getAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)
        .map((line: HTMLElement): string => {
          return (line.textContent || "").trim();
        });
    };

    // Each named for a screen reader, before its value.
    expect(folded(cells[0]!)).toEqual(["Typeext4", "Device/dev/nvme0n1p2"]);
    expect(folded(cells[1]!)).toEqual([
      "Free23 GiB",
      "Size512 GiB23 GiB reserved for root",
    ]);
  });

  test("a mount that names no type or device draws no empty lines under it", () => {
    draw(900);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[1]!.cells);

    expect(
      within(cells[0]!).queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID),
    ).toEqual([]);
  });
});

describe("a host's Filesystems on a phone", () => {
  test("each mount is a card: no table at all", () => {
    draw(390);

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText("/boot/efi")).toBeInTheDocument();
    expect(screen.getAllByText("Used").length).toBeGreaterThan(0);
  });
});
