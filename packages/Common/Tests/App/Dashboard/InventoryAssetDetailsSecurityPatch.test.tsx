import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";

/*
 * The card's network-device reads stand in for nothing here: an Android
 * device's item is a host. The typed-row cross-link resolves against other
 * tables, so it is stubbed as in the card's own suite.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink",
  () => {
    return {
      __esModule: true,
      resolveTypedRowLink: () => {
        return Promise.resolve(null);
      },
    };
  },
);

import InventoryAssetDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard";
import { getInventorySecurityPatchColumn } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import {
  SECURITY_PATCH_AGE,
  SECURITY_PATCH_STATUS_LABELS,
  readSecurityPatch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/SecurityPatchStatus";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import { AndroidSecurityPatchStatus } from "../../../Types/Host/AndroidSecurityPatch";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { InventoryAssetField } from "../../../Utils/Inventory/InventoryAssetDetails";

/*
 * A device's Asset Details card says whether its security patch is out of
 * date (#10099): beside the level, the pill Inventory > All Items' Security
 * Patch Level column draws - Out of Date when the level is more than 90 days
 * old, Up to Date otherwise, by the same rule and in the same words - and
 * how many days old it is, in the reader's language, digits and plural.
 */

const NOW: Date = new Date("2026-11-19T08:27:37.467Z");

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: Array<string> = ["de", "fr", "ru", "ja", "fa", "ar"];

// An Android device's item, as the agent or an import describes it.
function androidDevice(securityPatch: string | undefined): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item._id = "40000000-0000-4000-8000-000000000001";
  item.entityType = EntityType.Host;
  item.source = EntitySource.Discovered;
  item.displayName = "store-0412-kiosk-02";
  item.identifyingAttributes = { "host.name": "store-0412-kiosk-02" };
  item.descriptiveAttributes = {
    "os.type": "linux",
    "os.name": "Android",
    "os.version": "14",
    "device.manufacturer": "Zebra",
    "device.model.name": "ET45",
    ...(securityPatch === undefined
      ? {}
      : { "android.os.security_patch": securityPatch }),
  } as never;
  return item;
}

function drawCard(item: InventoryItem): void {
  render(<InventoryAssetDetailsCard item={item} now={NOW} />);
}

function patchCell(): HTMLElement {
  return screen.getByTestId(
    `inventory-asset-${InventoryAssetField.SecurityPatch}`,
  );
}

function statusLine(): HTMLElement {
  return screen.getByTestId(
    `inventory-asset-${InventoryAssetField.SecurityPatch}-status`,
  );
}

// What a page shows, without the isolates a right-to-left sentence sets values in.
function plain(text: string | null | undefined): string {
  return (text || "")
    .split(FIRST_STRONG_ISOLATE)
    .join("")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("")
    .split(" ")
    .join(" ")
    .trim();
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("the Asset Details card's security patch (#10099)", () => {
  test("a patch more than 90 days old reads Out of Date, and how many days old", () => {
    drawCard(androidDevice("2024-06-05"));

    const cell: HTMLElement = patchCell();
    expect(within(cell).getByText("Security Patch Level")).toBeInTheDocument();
    expect(within(cell).getByText("2024-06-05")).toBeInTheDocument();
    expect(within(statusLine()).getByText("Out of Date")).toBeInTheDocument();
    expect(
      plain(
        screen.getByTestId(
          `inventory-asset-${InventoryAssetField.SecurityPatch}-status-age`,
        ).textContent,
      ),
    ).toBe("897 days old");
    // The level can still be copied, as every fact can.
    expect(
      within(cell).getByTitle("Copy Security Patch Level"),
    ).toBeInTheDocument();
  });

  test("a patch from the last 90 days reads Up to Date, at the boundary too", () => {
    drawCard(androidDevice("2026-08-21"));

    expect(within(statusLine()).getByText("Up to Date")).toBeInTheDocument();
    expect(plain(statusLine().textContent)).toContain("90 days old");
    cleanup();

    drawCard(androidDevice("2026-08-20"));

    expect(within(statusLine()).getByText("Out of Date")).toBeInTheDocument();
    expect(plain(statusLine().textContent)).toContain("91 days old");
  });

  test("a patch one day old is said in the singular, and one dated after today is 0 days old", () => {
    drawCard(androidDevice("2026-11-18"));

    expect(plain(statusLine().textContent)).toContain("1 day old");
    expect(plain(statusLine().textContent)).not.toContain("1 days old");
    cleanup();

    drawCard(androidDevice("2026-12-05"));

    expect(within(statusLine()).getByText("Up to Date")).toBeInTheDocument();
    expect(plain(statusLine().textContent)).toContain("0 days old");
  });

  test("says what the list's column says of the same device, in the same words", () => {
    const column: Columns<InventoryItem>[number] =
      getInventorySecurityPatchColumn(NOW);

    for (const level of ["2024-06-05", "2026-08-20", "2026-08-21"]) {
      const item: InventoryItem = androidDevice(level);
      const { container } = render(column.getElement!(item) as ReactElement);
      const columnWords: string = plain(container.textContent);
      cleanup();

      drawCard(item);
      const status: AndroidSecurityPatchStatus = readSecurityPatch(
        level,
        NOW,
      )!.status;
      const pillWords: string = SECURITY_PATCH_STATUS_LABELS[status];

      expect(columnWords).toContain(pillWords);
      expect(within(statusLine()).getByText(pillWords)).toBeInTheDocument();
      cleanup();
    }
  });

  test("a value that is no patch level is shown as written, with no pill and no age", () => {
    drawCard(androidDevice("unknown"));

    expect(within(patchCell()).getByText("unknown")).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        `inventory-asset-${InventoryAssetField.SecurityPatch}-status`,
      ),
    ).toBeNull();
    expect(screen.queryByText("Out of Date")).toBeNull();
    expect(screen.queryByText("Up to Date")).toBeNull();
  });

  test("a host with no patch level has no security patch row, and no pill anywhere", () => {
    drawCard(androidDevice(undefined));

    expect(
      screen.queryByTestId(
        `inventory-asset-${InventoryAssetField.SecurityPatch}`,
      ),
    ).toBeNull();
    expect(screen.queryByText("Out of Date")).toBeNull();
    expect(screen.queryByText("Up to Date")).toBeNull();
  });

  test("the age is the age a read counts, in whole UTC days", () => {
    expect(readSecurityPatch("2024-06-05", NOW)).toEqual({
      level: "2024-06-05",
      status: AndroidSecurityPatchStatus.OutOfDate,
      ageInDays: 897,
    });
    expect(readSecurityPatch(" 2026-08-21 ", NOW)).toEqual({
      level: "2026-08-21",
      status: AndroidSecurityPatchStatus.UpToDate,
      ageInDays: 90,
    });
    expect(readSecurityPatch(undefined, NOW)).toBeUndefined();
    expect(readSecurityPatch("June 2024", NOW)).toBeUndefined();
  });

  test("a level shaped like a date but on no calendar reads as the column and the filter read it, with no age", () => {
    // The rule compares levels as text, in SQL too: the filter and the column agree.
    expect(readSecurityPatch("2023-02-30", NOW)).toEqual({
      level: "2023-02-30",
      status: AndroidSecurityPatchStatus.OutOfDate,
      ageInDays: undefined,
    });

    drawCard(androidDevice("2023-02-30"));

    expect(within(statusLine()).getByText("Out of Date")).toBeInTheDocument();
    // No day to count from: no age, rather than a wrong one.
    expect(
      screen.queryByTestId(
        `inventory-asset-${InventoryAssetField.SecurityPatch}-status-age`,
      ),
    ).toBeNull();
  });
});

describe("the card's security patch in the reader's language", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: the pill in the locale's words, the age in its plural and its digits",
    async (language: string) => {
      await i18next.changeLanguage(language);
      const locale: Record<string, string> = readLocale(language);

      const outOfDate: string = locale["Out of Date"]!;
      const upToDate: string = locale["Up to Date"]!;
      const general: string = locale[SECURITY_PATCH_AGE.other]!;
      const one: string = locale[`${SECURITY_PATCH_AGE.other}_one`]!;

      // Worded, not left in English.
      for (const words of [outOfDate, upToDate, general]) {
        expect(words).toBeTruthy();
      }
      expect(outOfDate).not.toBe("Out of Date");
      expect(general).not.toBe("{{count}} days old");
      expect(one).toBeTruthy();

      const digits: (value: number) => string = (value: number): string => {
        return new Intl.NumberFormat(
          language === "ar" ? "ar-u-nu-latn" : language,
          { useGrouping: false },
        ).format(value);
      };

      drawCard(androidDevice("2024-06-05"));

      expect(within(statusLine()).getByText(outOfDate)).toBeInTheDocument();
      const age: string = plain(
        screen.getByTestId(
          `inventory-asset-${InventoryAssetField.SecurityPatch}-status-age`,
        ).textContent,
      );
      // The locale's own sentence around the count, in the reader's digits.
      for (const piece of general.split("{{count}}")) {
        expect(age).toContain(piece.trim());
      }
      expect(age).toContain(digits(897));
      expect(age).not.toContain("days old");
      // The card's label is the locale's too.
      expect(
        within(patchCell()).getByText(locale["Security Patch Level"]!),
      ).toBeInTheDocument();
      cleanup();

      drawCard(androidDevice("2026-08-21"));
      expect(within(statusLine()).getByText(upToDate)).toBeInTheDocument();
      expect(plain(statusLine().textContent)).toContain(digits(90));
    },
  );

  test("Persian writes the age in Persian digits, Arabic in Latin ones", async () => {
    await i18next.changeLanguage("fa");
    drawCard(androidDevice("2024-06-05"));
    expect(plain(statusLine().textContent)).toContain("۸۹۷");
    cleanup();

    await i18next.changeLanguage("ar");
    drawCard(androidDevice("2024-06-05"));
    expect(plain(statusLine().textContent)).toContain("897");
  });

  test("German, at 1 day, says its one form", async () => {
    await i18next.changeLanguage("de");
    drawCard(androidDevice("2026-11-18"));

    expect(plain(statusLine().textContent)).toContain("1 Tag alt");
  });
});
