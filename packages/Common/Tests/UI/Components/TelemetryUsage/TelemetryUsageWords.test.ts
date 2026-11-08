import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { TELEMETRY_USAGE_PRODUCT_TYPES } from "../../../../Types/Telemetry/TelemetryUsage";
import { Translator } from "../../../../Types/Translator";
import { TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES } from "../../../../Server/Services/TelemetryUsageBillingService";
import {
  formatTelemetryUsageAmount,
  formatTelemetryUsageCost,
  formatTelemetryUsageRetention,
  formatTelemetryUsageSize,
  getTelemetryUsageResourceName,
  getTelemetryUsageResourceTypeLabel,
  getTelemetryUsageSignalTitle,
  TELEMETRY_USAGE_RESOURCE_TYPE_LABELS,
  TELEMETRY_USAGE_SIGNAL_COLORS,
  TELEMETRY_USAGE_SIGNAL_TITLES,
} from "../../../../UI/Components/TelemetryUsage/TelemetryUsageWords";
import { TELEMETRY_ENTITY_TYPES } from "../../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * What the usage pages call things (issue #5916): the signals, sizes from
 * kilobytes to gigabytes, costs to the cent, retention, and the resources -
 * in English here, and in the reader's language through the translator they
 * are handed (Tests/Dashboard/TelemetryUsageWordsInEveryLanguage holds the
 * locales to them).
 */

const english: Translator = createTranslator(undefined, "en");

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

describe("the signals", () => {
  test("each has a title and a colour of its own", () => {
    for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
      expect(TELEMETRY_USAGE_SIGNAL_TITLES[productType]).toBeTruthy();
      expect(TELEMETRY_USAGE_SIGNAL_COLORS[productType]).toBeTruthy();
    }

    expect(
      new Set(Object.values(TELEMETRY_USAGE_SIGNAL_COLORS)).size,
    ).toBe(TELEMETRY_USAGE_PRODUCT_TYPES.length);
  });

  test("are named as the explorers name them", () => {
    expect(getTelemetryUsageSignalTitle(ProductType.Logs, english)).toBe(
      "Logs",
    );
    expect(
      getTelemetryUsageSignalTitle(ProductType.SessionReplay, english),
    ).toBe("Session Replays");
    expect(
      getTelemetryUsageSignalTitle(ProductType.SecurityEvents, english),
    ).toBe("Security Events");
  });
});

describe("a size", () => {
  test.each([
    [0, "0 GB"],
    [1, "1 GB"],
    [12.345, "12.35 GB"],
    [1024, "1,024 GB"],
    [0.5, "512 MB"],
    [0.0005, "524.3 KB"],
    // A row smaller than a tenth of a kilobyte still shows there was one.
    [0.0000000001, "0.1 KB"],
  ])("of %f GB reads %s", (gigabytes: number, expected: string) => {
    expect(formatTelemetryUsageSize(gigabytes, english)).toBe(expected);
  });

  test("never reads as a negative or broken number", () => {
    expect(formatTelemetryUsageSize(-3, english)).toBe("0 GB");
    expect(formatTelemetryUsageSize(Number.NaN, english)).toBe("0 GB");
  });

  test("is written the reader's way", () => {
    const german: Translator = createTranslator(undefined, "de");

    expect(formatTelemetryUsageSize(1234.5, german)).toBe("1.234,5 GB");
  });
});

describe("a cost", () => {
  test("is to the cent, in US dollars", () => {
    expect(formatTelemetryUsageCost(4.256, english)).toBe("4.26 USD");
    expect(formatTelemetryUsageCost(0, english)).toBe("0 USD");
  });

  test("sits beside the size only where it is known", () => {
    expect(
      formatTelemetryUsageAmount({ dataIngestedInGB: 2 }, english),
    ).toBe("2 GB");
    expect(
      formatTelemetryUsageAmount(
        { dataIngestedInGB: 2, totalCostInUSD: 0.5 },
        english,
      ),
    ).toBe("2 GB · 0.5 USD");
  });
});

describe("a resource's retention", () => {
  test("is its telemetry's", () => {
    expect(
      formatTelemetryUsageRetention(
        { retentionInDays: 15, sessionReplayRetentionInDays: null },
        english,
      ),
    ).toBe("15 days");
    expect(
      formatTelemetryUsageRetention(
        { retentionInDays: 1, sessionReplayRetentionInDays: null },
        english,
      ),
    ).toBe("1 day");
  });

  test("names its session replays' apart, when it kept any", () => {
    expect(
      formatTelemetryUsageRetention(
        { retentionInDays: 30, sessionReplayRetentionInDays: 7 },
        english,
      ),
    ).toBe("30 days · Session replays: 7 days");
    expect(
      formatTelemetryUsageRetention(
        { retentionInDays: null, sessionReplayRetentionInDays: 7 },
        english,
      ),
    ).toBe("7 days");
  });

  test("is nothing when none was counted", () => {
    expect(
      formatTelemetryUsageRetention(
        { retentionInDays: null, sessionReplayRetentionInDays: null },
        english,
      ),
    ).toBe("");
  });
});

describe("a resource", () => {
  test("is called by its name", () => {
    expect(
      getTelemetryUsageResourceName(
        {
          primaryEntityId: "22222222-2222-4222-8222-222222222222",
          primaryEntityType: ServiceType.OpenTelemetry,
          name: "checkout",
        },
        PROJECT_ID,
        english,
      ),
    ).toBe("checkout");
  });

  test("that named no service is the project's Unknown Service", () => {
    for (const type of [ServiceType.Unknown, ServiceType.OpenTelemetry]) {
      expect(
        getTelemetryUsageResourceName(
          { primaryEntityId: PROJECT_ID, primaryEntityType: type, name: null },
          PROJECT_ID,
          english,
        ),
      ).toBe("Unknown Service");
    }
  });

  test("that is gone is its kind and the start of its id", () => {
    expect(
      getTelemetryUsageResourceName(
        {
          primaryEntityId: "abcdef12-2222-4222-8222-222222222222",
          primaryEntityType: ServiceType.DockerHost,
          name: null,
        },
        PROJECT_ID,
        english,
      ),
    ).toBe("Docker Host abcdef12");
  });

  test("of every kind usage is counted for has the label the explorers give it", () => {
    for (const type of Object.values(ServiceType) as Array<ServiceType>) {
      if (TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES.includes(type)) {
        continue;
      }

      expect({
        type,
        label: TELEMETRY_USAGE_RESOURCE_TYPE_LABELS[type],
      }).toEqual({ type, label: TELEMETRY_ENTITY_TYPES[type].label });
    }
  });

  test("of no kind is a Service, as legacy rows are", () => {
    expect(getTelemetryUsageResourceTypeLabel(null, english)).toBe("Service");
    expect(getTelemetryUsageResourceTypeLabel("SomethingNew", english)).toBe(
      "Service",
    );
  });
});
