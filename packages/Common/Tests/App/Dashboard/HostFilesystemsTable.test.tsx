import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import HostFilesystemsTable, {
  HOST_FILESYSTEMS_TABLE_ID,
  HOST_FILESYSTEMS_TABLE_KEY,
  HostMount,
  getMountBarClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostFilesystemsTable";
import { HOST_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import { forgetRememberedTableFits } from "../../../UI/Components/Table/useTableFit";
import { TABLE_FOLDED_VALUE_TEST_ID } from "../../../UI/Components/Table/TableFoldedValues";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";

/*
 * A host's Filesystems (the host Overview) are drawn by the product's
 * table, as every other list is: "the host Overview's filesystems table
 * scrolls inside its card at 768" - its own <table> had five columns and
 * no way to give: beside the side menu the card is some 480px wide, the
 * Utilization bar out of sight and "/boot/efi" broken a letter a line.
 * Now, where the card is narrower than 48rem (TableFit), the type and the
 * device go under the mount point and the sizes under the bar; on a phone
 * each mount is a card.
 *
 * jsdom lays nothing out: the box is never measured, so the window stands
 * in for it, as it does before a first measurement.
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

const MOUNTS: Array<HostMount> = [
  {
    mountpoint: "/",
    device: "/dev/nvme0n1p2",
    type: "ext4",
    totalBytes: 512 * 1024 ** 3,
    usedBytes: 488 * 1024 ** 3,
    utilizationPercent: 95.31,
  },
  {
    mountpoint: "/boot/efi",
    device: null,
    type: null,
    totalBytes: 512 * 1024 ** 2,
    usedBytes: 6 * 1024 ** 2,
    utilizationPercent: 1.2,
  },
];

const formatBytes: (bytes: number | null | undefined) => string = (
  bytes: number | null | undefined,
): string => {
  return `${Math.round((bytes || 0) / 1024 ** 3)} GiB`;
};

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const draw: (width: number) => void = (width: number): void => {
  setWindowWidth(width);
  render(<HostFilesystemsTable mounts={MOUNTS} formatBytes={formatBytes} />);
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

describe("a host's Filesystems, on a wide screen", () => {
  test("is the product's table: a column each for the mount, its type, its device, its sizes and how full it is", () => {
    draw(1280);

    expect(headerTitles()).toEqual([
      "Mount",
      "Type",
      "Device",
      "Used / Total",
      "Utilization",
    ]);
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Filesystems")).toBeInTheDocument();
  });

  test("each mount: its point and device in a fixed-width face, its type as a tag, its sizes and its bar", () => {
    draw(1280);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[0]!.cells);

    expect(within(cells[0]!).getByText("/")).toHaveClass("font-mono");
    expect(within(cells[1]!).getByText("ext4")).toHaveClass("ring-1");
    expect(within(cells[2]!).getByText("/dev/nvme0n1p2")).toHaveClass(
      "font-mono",
    );
    expect(cells[3]).toHaveTextContent("488 GiB/512 GiB");
    expect(cells[4]).toHaveTextContent("95.3%");
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

  test("the bar is as long as the mount is full, in green, amber from 75% and red from 90%", () => {
    draw(1280);

    const bars: Array<HTMLElement> = screen
      .getAllByTestId("host-filesystem-utilization")
      .map((utilization: HTMLElement): HTMLElement => {
        // The track, then the bar in it.
        return utilization.firstElementChild!.firstElementChild as HTMLElement;
      });

    expect(bars[0]!.style.width).toBe("95.31%");
    expect(bars[0]).toHaveClass("bg-red-500");
    expect(bars[1]!.style.width).toBe("1.2%");
    expect(bars[1]).toHaveClass("bg-emerald-500");

    expect(getMountBarClassName(74.99)).toBe("bg-emerald-500");
    expect(getMountBarClassName(75)).toBe("bg-amber-500");
    expect(getMountBarClassName(90)).toBe("bg-red-500");
  });

  test("a bar never runs past its track, nor below its start", () => {
    setWindowWidth(1280);
    render(
      <HostFilesystemsTable
        mounts={[
          { ...MOUNTS[0]!, utilizationPercent: 104.2 },
          { ...MOUNTS[1]!, utilizationPercent: -3 },
        ]}
        formatBytes={formatBytes}
      />,
    );

    const texts: Array<string> = screen
      .getAllByTestId("host-filesystem-utilization")
      .map((utilization: HTMLElement): string => {
        return (utilization.textContent || "").trim();
      });

    expect(texts).toEqual(["100.0%", "0.0%"]);
  });

  test("its two metric columns say what they measure, under their (i)", () => {
    draw(1280);

    const usedTotal: Element = Array.from(
      document.querySelectorAll("thead th"),
    ).find((cell: Element): boolean => {
      return (cell.textContent || "").includes("Used / Total");
    }) as Element;
    const utilization: Element = Array.from(
      document.querySelectorAll("thead th"),
    ).find((cell: Element): boolean => {
      return (cell.textContent || "").includes("Utilization");
    }) as Element;

    expect(usedTotal.querySelector("button")).not.toBeNull();
    expect(utilization.querySelector("button")).not.toBeNull();
    expect(HOST_METRIC_DESCRIPTIONS.filesystemUsedTotal).toContain(
      "1024-based",
    );
  });

  test("its columns can be sized, and are kept as the Filesystems table's", () => {
    draw(1280);

    expect(HOST_FILESYSTEMS_TABLE_KEY).toBe("host-filesystems-table");
    expect(
      document.querySelectorAll('[data-testid="table-column-resize-handle"]')
        .length,
    ).toBe(5);
  });
});

describe("a host's Filesystems in a card narrower than 48rem", () => {
  test("the type and the device go under the mount point, the sizes under the bar", () => {
    // Below lg the window stands in for the box: a narrow card.
    draw(900);

    expect(headerTitles()).toEqual(["Mount", "Utilization"]);

    const cells: Array<HTMLTableCellElement> = Array.from(rows()[0]!.cells);
    const underMount: Array<string> = within(cells[0]!)
      .getAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)
      .map((line: HTMLElement): string => {
        return (line.textContent || "").trim();
      });

    // Each named for a screen reader, before its value.
    expect(underMount).toEqual(["Typeext4", "Device/dev/nvme0n1p2"]);
    expect(
      within(cells[1]!).getByTestId(TABLE_FOLDED_VALUE_TEST_ID),
    ).toHaveTextContent("488 GiB/512 GiB");
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
    expect(screen.getAllByText("Utilization").length).toBeGreaterThan(0);
  });
});
