import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import { JSONObject } from "../../../Types/JSON";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { CloudHealthDescription } from "../../../Utils/Telemetry/CloudHealthDescription";
import {
  CloudHealthDetail,
  getCloudHealthDetail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangesTable";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE LINE UNDER A CLOUD HEALTH EVENT'S TITLE, on a cloud resource's and an
 * account's Changes (#6149's follow-up).
 *
 * The provider's own words - an AWS Health event's description, an Azure
 * resource's health title - are drawn as written, in English, marked so
 * (lang), and never translated: OneUptime would be inventing what the
 * provider said. OneUptime's own words about the event - an Azure event's
 * kind and tracking id, what caused a resource's change, the products a
 * Google Cloud incident affects - read in the reader's language. A line
 * with OneUptime's words reads the reader's way; a line of the provider's
 * words alone reads its own (dir="auto").
 */

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
    ["ja", japaneseLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function healthRow(data: {
  provider: string;
  operation: string;
  description?: string | undefined;
  withSource?: boolean | undefined;
}): ChangeEvent {
  const row: ChangeEvent = new ChangeEvent();
  const attributes: JSONObject = {
    [ChangeEventAttribute.CloudProvider]: data.provider,
    [ChangeEventAttribute.CloudOperation]: data.operation,
  };

  if (data.withSource !== false) {
    attributes[ChangeEventAttribute.Source] = ChangeEventSource.CloudHealth;
  }

  row.title = "Health event";
  row.eventType = ChangeEventType.ProviderEvent;
  row.attributes = attributes;

  if (data.description !== undefined) {
    row.description = data.description;
  }

  return row;
}

const AWS_ROW: ChangeEvent = healthRow({
  provider: "aws",
  operation: "AWS_EC2_OPERATIONAL_ISSUE",
  description:
    "We are investigating increased API error rates for the RunInstances API in the US-EAST-1 Region.",
});

const AZURE_SERVICE_ROW: ChangeEvent = healthRow({
  provider: "azure",
  operation: "ServiceHealth Incident",
  description:
    "Incident published by Azure, tracking id ABC-123, stage Active.",
});

const AZURE_RESOURCE_ROW: ChangeEvent = healthRow({
  provider: "azure",
  operation: "ResourceHealth Unavailable",
  description: "Virtual machine is unavailable. Azure caused it.",
});

const GOOGLE_ROW: ChangeEvent = healthRow({
  provider: "gcp",
  operation: "INCIDENT",
  description: "Affects Cloud SQL, Google Compute Engine.",
});

async function drawDetail(
  language: string,
  row: ChangeEvent,
): Promise<HTMLElement> {
  const detail: CloudHealthDescription | null = getCloudHealthDetail(
    row,
    dashboardTranslator(language),
  );

  expect(detail).not.toBeNull();

  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <CloudHealthDetail detail={detail as CloudHealthDescription} />
      </I18nextProvider>,
    );
  });

  return screen.getByTestId("cloud-change-detail");
}

describe("what a health event's line says", () => {
  test("an AWS event's own description, as written, in every language", () => {
    for (const language of ["en", "de", "fa", "ja"]) {
      expect(
        getCloudHealthDetail(AWS_ROW, dashboardTranslator(language)),
      ).toEqual({ written: AWS_ROW.description, worded: "" });
    }
  });

  test("Azure's kind and tracking id, in the reader's words", () => {
    expect(
      getCloudHealthDetail(AZURE_SERVICE_ROW, dashboardTranslator("de")),
    ).toEqual({
      written: "",
      worded: "Azure hat einen Vorfall veröffentlicht. Tracking-ID: ABC-123.",
      identifier: "ABC-123",
    });
  });

  test("a row an older server wrote without its source is drawn as written", () => {
    const old: ChangeEvent = healthRow({
      provider: "azure",
      operation: "ServiceHealth Incident",
      description:
        "Incident published by Azure, tracking id ABC-123, stage Active.",
      withSource: false,
    });

    expect(getCloudHealthDetail(old, dashboardTranslator("de"))).toEqual({
      written:
        "Incident published by Azure, tracking id ABC-123, stage Active.",
      worded: "",
    });
  });

  test("an event with no words has no line", () => {
    expect(
      getCloudHealthDetail(
        healthRow({ provider: "aws", operation: "AWS_EC2_OPERATIONAL_ISSUE" }),
        dashboardTranslator("de"),
      ),
    ).toBeNull();
    expect(
      getCloudHealthDetail(
        healthRow({
          provider: "aws",
          operation: "AWS_EC2_OPERATIONAL_ISSUE",
          description: "   ",
          withSource: false,
        }),
        dashboardTranslator("de"),
      ),
    ).toBeNull();
  });
});

describe("the line drawn", () => {
  test("the provider's words alone: marked English, reading their own way", async () => {
    const line: HTMLElement = await drawDetail("fa", AWS_ROW);
    const written: HTMLElement = screen.getByTestId(
      "cloud-change-detail-written",
    );

    expect(line).toHaveAttribute("dir", "auto");
    expect(written.tagName).toBe("BDI");
    expect(written).toHaveAttribute("lang", "en");
    expect(written).toHaveAttribute("dir", "auto");
    expect(written.textContent).toBe(AWS_ROW.description);
    expect(screen.queryByTestId("cloud-change-detail-worded")).toBeNull();
    // Cut at two lines, the whole of it on hover.
    expect(line).toHaveAttribute("title", AWS_ROW.description);
    expect(line).toHaveClass("line-clamp-2", "break-words");
  });

  test("OneUptime's words alone read the reader's way: German left to right", async () => {
    const line: HTMLElement = await drawDetail("de", AZURE_SERVICE_ROW);

    expect(line).toHaveAttribute("dir", "ltr");
    expect(line.textContent).toBe(
      "Azure hat einen Vorfall veröffentlicht. Tracking-ID: ABC-123.",
    );
    expect(screen.queryByTestId("cloud-change-detail-written")).toBeNull();
  });

  test("Persian right to left, Azure's title set apart in English, the cause in Persian", async () => {
    const line: HTMLElement = await drawDetail("fa", AZURE_RESOURCE_ROW);

    expect(line).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("cloud-change-detail-written")).toHaveTextContent(
      "Virtual machine is unavailable.",
    );
    expect(screen.getByTestId("cloud-change-detail-written")).toHaveAttribute(
      "lang",
      "en",
    );
    expect(screen.getByTestId("cloud-change-detail-worded")).toHaveTextContent(
      "علت آن Azure بود.",
    );
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      "Virtual machine is unavailable. علت آن Azure بود.",
    );
    expect(line).toHaveAttribute(
      "title",
      "Virtual machine is unavailable. علت آن Azure بود.",
    );
  });

  test("English reads the provider's title and the cause as the connector wrote them", async () => {
    const line: HTMLElement = await drawDetail("en", AZURE_RESOURCE_ROW);

    expect(line.textContent).toBe(
      "Virtual machine is unavailable. Azure caused it.",
    );
  });

  /*
   * #6149's UI review: Azure's tracking id is kept whole on its line - a
   * German line broke it at its hyphen, "7NQ8-" over "TX0." - and the line
   * reads, and copies, word for word as before.
   */
  test("the tracking id is kept whole, in every language", async () => {
    for (const language of ["de", "fa", "ja"]) {
      const line: HTMLElement = await drawDetail(language, AZURE_SERVICE_ROW);
      const identifier: HTMLElement = screen.getByTestId(
        "cloud-change-detail-identifier",
      );

      expect(identifier.textContent).toBe("ABC-123");
      expect(identifier).toHaveClass("whitespace-nowrap");
      expect(line.textContent).toBe(
        getCloudHealthDetail(AZURE_SERVICE_ROW, dashboardTranslator(language))!
          .worded,
      );
      cleanup();
    }
  });

  test("a line with no identifier keeps none", async () => {
    await drawDetail("de", AZURE_RESOURCE_ROW);
    expect(screen.queryByTestId("cloud-change-detail-identifier")).toBeNull();
    cleanup();

    await drawDetail("de", AWS_ROW);
    expect(screen.queryByTestId("cloud-change-detail-identifier")).toBeNull();
  });

  test("Japanese lists Google's products its own way", async () => {
    const line: HTMLElement = await drawDetail("ja", GOOGLE_ROW);

    expect(line.textContent).toBe(
      "Cloud SQL、Google Compute Engine に影響します。",
    );
  });
});
