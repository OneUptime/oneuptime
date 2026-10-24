import { TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS } from "Common/Types/Billing/PayAsYouGoPricing";
import { MeteredPlanUtil } from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import TelemetryMeteredPlan from "Common/Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Telemetry kept for fewer than 7 days is billed as 7 days, session replays
 * excepted (TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS). Usage History
 * shows the days telemetry is really kept next to what it cost, so a row
 * kept for 3 days costs what a 7-day row costs: the card says why, in every
 * Dashboard language.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const MINIMUM: number = TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS;

const NOTE: string = `Except for session replays, telemetry kept for fewer than ${MINIMUM} days is billed as ${MINIMUM} days.`;
const DESCRIPTION: string = `How much telemetry each service sent each day, how long it is kept and what it cost. ${NOTE} The pricing page has the rates.`;
const REPLACED_DESCRIPTION: string =
  "How much telemetry each service sent each day, how long it is kept and what it cost. The pricing page has the rates.";

const FLOORED_PRODUCT_TYPES: Array<ProductType> = [
  ProductType.Logs,
  ProductType.Metrics,
  ProductType.Traces,
  ProductType.Profiles,
  ProductType.SecurityEvents,
];

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const NON_ENGLISH: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

const usageHistory: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Pages", "Settings", "UsageHistory.tsx"),
  "utf8",
);

// Persian writes its digits its own way: ۷ is 7.
function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(digit.charCodeAt(0) - "۰".charCodeAt(0));
  });
}

function numbersIn(text: string): Array<number> {
  return (toLatinDigits(text).match(/\d+/g) || []).map(Number);
}

function planFor(productType: ProductType): TelemetryMeteredPlan {
  return MeteredPlanUtil.getMeteredPlanByProductType(
    productType,
  ) as TelemetryMeteredPlan;
}

describe("Usage History says telemetry kept under 7 days is billed as 7", () => {
  test("the card's description carries the note, between what the list shows and where the rates are", () => {
    const cardProps: string = usageHistory.slice(
      usageHistory.indexOf("cardProps={{"),
      usageHistory.indexOf("}}", usageHistory.indexOf("cardProps={{")),
    );

    expect(cardProps).toContain('title: "Telemetry Usage History",');
    expect(cardProps).toContain(`"${DESCRIPTION}"`);
  });

  test("the note names the minimum billing uses", () => {
    expect(MINIMUM).toBe(7);
    expect(numbersIn(NOTE)).toEqual([MINIMUM, MINIMUM]);
  });

  test.each(FLOORED_PRODUCT_TYPES)(
    "%s is billed for at least the days the note names",
    (productType: ProductType) => {
      expect(planFor(productType).minimumBillableRetentionInDays).toBe(MINIMUM);
      expect(planFor(productType).getBillableRetentionInDays(3)).toBe(MINIMUM);
    },
  );

  test("session replays, the note's exception, are billed for the days they are kept", () => {
    expect(
      planFor(ProductType.SessionReplay).minimumBillableRetentionInDays,
    ).toBe(0);
    expect(
      planFor(ProductType.SessionReplay).getBillableRetentionInDays(3),
    ).toBe(3);
  });

  test("the list still shows the days telemetry is kept, next to what it cost", () => {
    const columns: string = usageHistory.slice(
      usageHistory.indexOf("columns={["),
    );

    expect(columns).toContain('title: "Data Retention (in Days)",');
    expect(columns).toContain('item["retainTelemetryDataForDays"]');
    expect(columns).toContain('title: "Total Cost",');
    expect(columns).toContain('item["totalCostInUSD"]');
  });
});

describe("every Dashboard language says it", () => {
  test("there are sixteen languages besides English", () => {
    expect(NON_ENGLISH).toHaveLength(16);
  });

  test("English maps the description to itself", () => {
    expect(locales["en"]![DESCRIPTION]).toBe(DESCRIPTION);
  });

  test.each(NON_ENGLISH)(
    "%s translates the description, with the same days",
    (code: string) => {
      const value: unknown = locales[code]![DESCRIPTION];

      expect({ code, isString: typeof value === "string" }).toEqual({
        code,
        isString: true,
      });
      expect({ code, translated: value !== DESCRIPTION }).toEqual({
        code,
        translated: true,
      });
      expect({ code, numbers: numbersIn(value as string) }).toEqual({
        code,
        numbers: [MINIMUM, MINIMUM],
      });
    },
  );

  test.each(Object.keys(locales))(
    "%s no longer has the description it replaced",
    (code: string) => {
      expect(Object.keys(locales[code]!)).not.toContain(REPLACED_DESCRIPTION);
    },
  );
});
