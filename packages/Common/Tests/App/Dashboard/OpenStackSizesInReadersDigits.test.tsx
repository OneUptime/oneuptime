import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  OPENSTACK_RESOURCE_DISK_GB,
  OPENSTACK_RESOURCE_MEMORY_MB,
  OPENSTACK_RESOURCE_VCPU,
} from "../../../Types/OpenStack/OpenStackCapacity";
import { OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES } from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { OpenStackTopConsumers } from "../../../Types/OpenStack/OpenStackOverview";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import OpenStackTopConsumersCard, {
  OPENSTACK_TOP_CONSUMER_VALUE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackTopConsumersCard";
import {
  OpenStackListColumn,
  formatOpenStackAmount,
  getOpenStackAmountColumn,
  getOpenStackSizeColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList";
import {
  formatBytes,
  getBytesReading,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import { formatOpenStackCapacityAmount } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackCapacityView";
import {
  formatOpenStackBytes,
  formatOpenStackChartBytes,
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackFigures";
import { formatOpenStackCapacityPair } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Capacity";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * OPENSTACK'S SIZES, IN THE READER'S DIGITS AND READ THEIR OWN WAY (#7191).
 *
 * Every OpenStack size went through telemetryFormat's formatBytes: toFixed,
 * so Latin digits whatever the page's language, and a bare "6.0 TiB" in a
 * line read from the right was drawn "TiB 6.0". The Overview's Top
 * consumers put that beside counts in Persian digits in the same card.
 *
 * OpenStackFigures writes the same figure in the same unit, rounded as
 * before, in the reader's digits; each size is drawn as a value of its own
 * (a bdi) or set apart in its sentence. English is unchanged; a chart's
 * axis keeps Latin digits, as every chart in the product does. The layout
 * itself - the number's box left of the unit's - is measured in real
 * Chromium by E2E/OpenStackPages (Overview, "in Persian, every size ...").
 */

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

const KIB: number = 1024;
const MIB: number = KIB * 1024;
const GIB: number = MIB * 1024;
const TIB: number = GIB * 1024;

// Sizes across every unit and both roundings (one decimal under ten, none from ten up).
const SIZES: Array<number> = [
  0,
  512,
  1536,
  9.96 * KIB,
  100 * MIB,
  480 * GIB,
  500 * GIB,
  TIB,
  6 * TIB,
  12.4 * TIB,
  2048 * TIB,
];

// The size as OpenStack wrote it before: telemetryFormat's toFixed, which English keeps.
function writtenTheOldWay(bytes: number): string {
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value: number = bytes;
  let index: number = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", "de", "fa", "ar"]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  setDateDisplayLanguage("en");
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

// The page in `language`: its words, and its figures.
async function pageIn(language: string): Promise<void> {
  setDateDisplayLanguage(language);
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

describe("telemetryFormat's formatBytes, which other products share, is unchanged", () => {
  test("its output is what it always wrote, read from its pieces", () => {
    for (const bytes of SIZES) {
      expect(formatBytes(bytes)).toBe(writtenTheOldWay(bytes));
    }
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  test("its pieces: the figure, its unit and its decimals", () => {
    expect(getBytesReading(6 * TIB)).toEqual({
      value: 6,
      unit: "TiB",
      decimals: 1,
    });
    expect(getBytesReading(500 * GIB)).toEqual({
      value: 500,
      unit: "GiB",
      decimals: 0,
    });
    expect(getBytesReading(512)).toEqual({
      value: 512,
      unit: "B",
      decimals: 0,
    });
    // Past the largest unit it stays in TiB.
    expect(getBytesReading(2048 * TIB).unit).toBe("TiB");
  });
});

describe("formatOpenStackBytes", () => {
  test("English is written exactly as before", () => {
    for (const bytes of SIZES) {
      expect(formatOpenStackBytes(bytes, { language: "en" })).toBe(
        writtenTheOldWay(bytes),
      );
    }
  });

  test("Persian in Persian digits, with the same rounding and the same unit", () => {
    expect(
      SIZES.map((bytes: number): string => {
        return formatOpenStackBytes(bytes, { language: "fa" });
      }),
    ).toEqual([
      "۰٫۰ B",
      "۵۱۲ B",
      "۱٫۵ KiB",
      "۱۰٫۰ KiB",
      "۱۰۰ MiB",
      "۴۸۰ GiB",
      "۵۰۰ GiB",
      "۱٫۰ TiB",
      "۶٫۰ TiB",
      "۱۲ TiB",
      "۲٬۰۴۸ TiB",
    ]);

    for (const bytes of SIZES) {
      const size: string = formatOpenStackBytes(bytes, { language: "fa" });

      expect(size).not.toMatch(LATIN_DIGIT);
      expect(size).toMatch(PERSIAN_DIGIT);
      // The same unit as English, after its number.
      expect(size.split(" ")[1]).toBe(writtenTheOldWay(bytes).split(" ")[1]);
    }
  });

  test("German with its decimal comma; Arabic in the Latin digits it writes by choice", () => {
    expect(formatOpenStackBytes(6 * TIB, { language: "de" })).toBe("6,0 TiB");
    expect(formatOpenStackBytes(480 * GIB, { language: "de" })).toBe("480 GiB");
    expect(formatOpenStackBytes(6 * TIB, { language: "ar" })).toBe("6.0 TiB");
    expect(formatOpenStackBytes(480 * GIB, { language: "ar" })).toBe("480 GiB");
  });

  test("without a language, the page's", () => {
    setDateDisplayLanguage("fa");
    expect(formatOpenStackBytes(6 * TIB)).toBe("۶٫۰ TiB");
    setDateDisplayLanguage("en");
    expect(formatOpenStackBytes(6 * TIB)).toBe("6.0 TiB");
  });

  test("no size for what is not one", () => {
    expect(formatOpenStackBytes(Number.NaN, { language: "fa" })).toBe("—");
  });

  test("negative control: the old helper fails the Persian check", () => {
    expect(writtenTheOldWay(6 * TIB)).toMatch(LATIN_DIGIT);
    expect(formatBytes(6 * TIB)).toMatch(LATIN_DIGIT);
  });
});

describe("the rest of OpenStack's figures", () => {
  test("a chart's axis and tooltip keep Latin digits on a Persian page, as every chart does", () => {
    setDateDisplayLanguage("fa");

    for (const bytes of SIZES) {
      expect(formatOpenStackChartBytes(bytes)).toBe(writtenTheOldWay(bytes));
    }
  });

  test("a count: English as before, Persian in Persian digits", () => {
    expect(formatOpenStackCount(12, { language: "en" })).toBe("12");
    expect(formatOpenStackCount(1234, { language: "en" })).toBe("1234");
    expect(formatOpenStackCount(1.5, { language: "en" })).toBe("1.5");
    expect(formatOpenStackCount(12, { language: "fa" })).toBe("۱۲");
    expect(formatOpenStackCount(1.5, { language: "fa" })).toBe("۱٫۵");
    expect(formatOpenStackCount(1.5, { language: "de" })).toBe("1,5");
  });

  test("a share: a whole percent, in the reader's digits", () => {
    expect(formatOpenStackPercent(91.6, { language: "en" })).toBe("92%");
    expect(formatOpenStackPercent(91.6, { language: "fa" })).toBe("۹۲%");
    expect(formatOpenStackPercent(0, { language: "fa" })).toBe("۰%");
  });

  test("the Capacity page's amounts: sizes in the reader's digits, counts as before", () => {
    setDateDisplayLanguage("fa");

    expect(
      formatOpenStackCapacityAmount(OPENSTACK_RESOURCE_MEMORY_MB, 1024),
    ).toBe("۱٫۰ GiB");
    expect(
      formatOpenStackCapacityAmount(OPENSTACK_RESOURCE_DISK_GB, 6144),
    ).toBe("۶٫۰ TiB");
    expect(
      formatOpenStackCapacityAmount(
        OPENSTACK_CAPACITY_RESOURCE_STORAGE_BYTES,
        480 * GIB,
      ),
    ).toBe("۴۸۰ GiB");
    expect(formatOpenStackCapacityAmount(OPENSTACK_RESOURCE_VCPU, 1280)).toBe(
      "۱٬۲۸۰",
    );

    setDateDisplayLanguage("en");

    expect(
      formatOpenStackCapacityAmount(OPENSTACK_RESOURCE_MEMORY_MB, 1024),
    ).toBe("1.0 GiB");
    expect(
      formatOpenStackCapacityAmount(OPENSTACK_RESOURCE_DISK_GB, 6144),
    ).toBe("6.0 TiB");
  });

  test("the Capacity page's pair: each amount set apart on a page read from the right, as written in English", () => {
    expect(
      formatOpenStackCapacityPair({
        used: "۸۶۹ GiB",
        total: "۱٫۲ TiB",
        language: "fa",
      }),
    ).toBe(
      `${FIRST_STRONG_ISOLATE}۸۶۹ GiB${POP_DIRECTIONAL_ISOLATE} / ${FIRST_STRONG_ISOLATE}۱٫۲ TiB${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(
      formatOpenStackCapacityPair({
        used: "869 GiB",
        total: "1.2 TiB",
        language: "en",
      }),
    ).toBe("869 GiB / 1.2 TiB");
  });
});

describe("the Overview's Top consumers card", () => {
  const CONSUMERS: OpenStackTopConsumers = {
    projectsByInstances: [
      { projectId: "p-1", name: "acme-payments", value: 20 },
      { projectId: "p-2", name: "acme-research", value: 16 },
    ],
    projectsByVolumeBytes: [
      { projectId: "p-2", name: "acme-research", value: 6 * TIB },
      { projectId: "p-1", name: "acme-payments", value: 2 * TIB },
      { projectId: "p-3", name: "acme-web", value: 500 * GIB },
      { projectId: "p-4", name: "acme-data", value: 20 * GIB },
    ],
  };

  function drawCard(): HTMLElement {
    render(
      <OpenStackTopConsumersCard
        consumers={CONSUMERS}
        rows={[]}
        getProjectRoute={() => {
          return undefined;
        }}
        getHypervisorRoute={() => {
          return undefined;
        }}
      />,
    );

    return screen
      .getAllByTestId("openstack-top-consumers-list")
      .find((list: HTMLElement): boolean => {
        return list.getAttribute("data-key") === "projects-volumes";
      })!;
  }

  function valuesOf(list: HTMLElement): Array<HTMLElement> {
    return within(list).getAllByTestId("openstack-top-consumers-value");
  }

  test("fa: volume storage in Persian digits, each value a figure of its own read left to right", async () => {
    await pageIn("fa");
    const volumes: HTMLElement = drawCard();
    const values: Array<HTMLElement> = valuesOf(volumes);

    expect(
      values.map((value: HTMLElement): string => {
        return value.textContent || "";
      }),
    ).toEqual(["۶٫۰ TiB", "۲٫۰ TiB", "۵۰۰ GiB", "۲۰ GiB"]);

    for (const value of values) {
      expect(value.textContent).not.toMatch(LATIN_DIGIT);
      // Its own direction: "۶٫۰ TiB" with its number first, in a row read from the right.
      expect(value.tagName).toBe("BDI");
      expect(value).toHaveAttribute("dir", "ltr");
      expect(value.getAttribute("class")).toBe(
        OPENSTACK_TOP_CONSUMER_VALUE_CLASS_NAME,
      );
    }

    // The counts beside them were already the reader's; the card is now one in its digits.
    for (const value of screen.getAllByTestId(
      "openstack-top-consumers-value",
    )) {
      expect(value.textContent).not.toMatch(LATIN_DIGIT);
    }
  });

  test("en: as it was, the same figures and units", async () => {
    await pageIn("en");
    const values: Array<HTMLElement> = valuesOf(drawCard());

    expect(
      values.map((value: HTMLElement): string => {
        return value.textContent || "";
      }),
    ).toEqual(["6.0 TiB", "2.0 TiB", "500 GiB", "20 GiB"]);
  });

  test("de: the decimal comma", async () => {
    await pageIn("de");

    expect(valuesOf(drawCard())[0]).toHaveTextContent("6,0 TiB");
  });

  /*
   * Negative control: the value as the card drew it before - the shared
   * helper's text in a plain span - is what the Persian checks refuse.
   */
  test("negative control: the old value, a bare span in Latin digits, is refused", () => {
    render(
      <span
        className={OPENSTACK_TOP_CONSUMER_VALUE_CLASS_NAME}
        data-testid="old-value"
      >
        {formatBytes(6 * TIB)}
      </span>,
    );

    const old: HTMLElement = screen.getByTestId("old-value");

    expect(old.textContent).toMatch(LATIN_DIGIT);
    expect(old.tagName).not.toBe("BDI");
    expect(old).not.toHaveAttribute("dir");
  });
});

describe("a list's amounts", () => {
  function hypervisor(data: Partial<OpenStackResource>): OpenStackResource {
    const row: OpenStackResource = new OpenStackResource();
    Object.assign(row, data);
    return row;
  }

  const MEMORY: OpenStackListColumn = getOpenStackAmountColumn({
    title: "Memory Allocated",
    field: "memoryAllocatedBytes",
    capacityField: "memoryCapacityBytes",
    format: formatOpenStackBytes,
  });

  const SIZE: OpenStackListColumn = getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  });

  test("fa: a pair reads the page's way, each size set apart; the export holds no marks", async () => {
    await pageIn("fa");
    const row: OpenStackResource = hypervisor({
      memoryAllocatedBytes: 480 * GIB,
      memoryCapacityBytes: TIB,
    });

    render(<div data-testid="cell">{MEMORY.getElement!(row)}</div>);

    const pair: HTMLElement = screen.getByTestId("openstack-amount-cell");

    // A sentence, in the page's direction: not an isolate that would take its first unit's.
    expect(pair.tagName).toBe("SPAN");
    expect(pair).not.toHaveAttribute("dir");
    expect(pair.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}۴۸۰ GiB${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(pair.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}۱٫۰ TiB${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(withoutIsolateMarks(pair.textContent || "")).not.toMatch(
      LATIN_DIGIT,
    );

    const exported: string = String(MEMORY.getExportValue!(row));

    expect(exported).toBe(withoutIsolateMarks(exported));
    expect(exported).toContain("۴۸۰ GiB");
  });

  test("fa: one size alone is a figure of its own", async () => {
    await pageIn("fa");

    render(
      <div data-testid="cell">
        {SIZE.getElement!(hypervisor({ diskCapacityBytes: 6 * TIB }))}
      </div>,
    );

    const cell: HTMLElement = screen.getByTestId("cell");
    const value: HTMLElement = cell.querySelector("bdi") as HTMLElement;

    expect(value).toHaveTextContent("۶٫۰ TiB");
  });

  test("en: the pair as it was, with nothing set apart", async () => {
    await pageIn("en");

    expect(
      formatOpenStackAmount({
        taken: 480 * GIB,
        capacity: TIB,
        format: formatOpenStackBytes,
        setsValuesApart: true,
      }),
    ).toBe("480 GiB of 1.0 TiB");
  });
});

describe("OpenStack writes its sizes through OpenStackFigures", () => {
  const OPENSTACK_DIRECTORIES: Array<string> = [
    "Components/OpenStack",
    "Pages/OpenStack",
  ];

  const SOURCE_FILE: RegExp = /\.tsx?$/;
  const IMPORTS_FORMAT_BYTES: RegExp =
    /import\s*\{[^}]*\bformatBytes\b[^}]*\}\s*from\s*"[^"]*telemetryFormat"/;

  function filesUnder(directory: string): Array<string> {
    const files: Array<string> = [];
    for (const entry of fs.readdirSync(path.join(DASHBOARD_SRC, directory), {
      withFileTypes: true,
    })) {
      const relative: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...filesUnder(relative));
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(relative);
      }
    }
    return files;
  }

  test("no OpenStack page or part reads telemetryFormat's formatBytes but OpenStackFigures", () => {
    const readers: Array<string> = OPENSTACK_DIRECTORIES.flatMap(
      filesUnder,
    ).filter((file: string): boolean => {
      return IMPORTS_FORMAT_BYTES.test(readSource(file));
    });

    expect(readers).toEqual([
      path.join("Pages/OpenStack/Utils/OpenStackFigures.ts"),
    ]);
  });

  test("the charts keep Latin digits through the chart formatter", () => {
    for (const file of [
      "Pages/OpenStack/View/HypervisorDetail.tsx",
      "Components/OpenStack/Part/OpenStackInstanceUsage.tsx",
    ]) {
      expect(readSource(file)).not.toContain("format: formatOpenStackBytes,");
      expect(readSource(file)).toContain("formatOpenStackChartBytes");
    }

    expect(
      readSource("Components/OpenStack/Part/OpenStackLoadBalancerTraffic.tsx"),
    ).not.toMatch(/formatOpenStackBytes\b/);
  });
});
