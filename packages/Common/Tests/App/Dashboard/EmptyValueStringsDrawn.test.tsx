import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { ReactFlowProvider } from "reactflow";
import IconProp from "../../../Types/Icon/IconProp";
import DashboardWidgetLine from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetLine";
import { ResourceListNameCell } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import ResourcePartDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartDetailsCard";
import TopologyNodeCard from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyNodeCard";
import StorageArrayResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  formatBytes,
  formatCompact,
  formatDurationMsInLanguage,
  formatPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import {
  formatRowCount,
  formatSize,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityFormat";
import { formatOpenStackUsageNumber } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackSpendView";
import { formatEfficiency } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils";
import {
  EMPTY_VALUE_MARK,
  EMPTY_VALUE_TEST_ID,
} from "../../../UI/Components/Detail/EmptyValue";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

/*
 * THE DASHBOARD DRAWS A VALUE IT DOES NOT HAVE AS THE QUIET DASH, AND ITS
 * FORMATTERS WRITE ONE MARK FOR IT (#8262).
 *
 * A list widget's host or cluster cell, a honeycomb tile's details, a
 * resource part's Details row and a topology card's stat were handed a
 * dash written as a string ("—") and drew it bare - beside quiet dashes in
 * the same table - with nothing for a screen reader. They draw the quiet
 * dash now for a value that is missing, blank or the formatters' mark, and
 * the formatters write the one shared mark (EMPTY_VALUE_MARK) for nothing,
 * where some wrote a hyphen and some an en dash.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: ReadonlyArray<Language> = ["en", "de", "ar", "fa"];

const NOT_SET: Record<Language, string> = {
  en: "Not set",
  de: "Nicht festgelegt",
  ar: "غير معيّن",
  fa: "تنظیم نشده",
};

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
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

function renderIn(
  language: Language,
  element: React.ReactElement,
): RenderResult {
  return render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

function spokenText(element: Element): string {
  const copy: Element = element.cloneNode(true) as Element;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return (copy.textContent || "").trim();
}

const NO_VALUES: ReadonlyArray<string | undefined> = [
  undefined,
  "",
  "-",
  EMPTY_VALUE_MARK,
];

const EVERY_LANGUAGE: Array<[Language]> = LANGUAGES.map(
  (language: Language): [Language] => {
    return [language];
  },
);

describe("a widget's line", () => {
  test.each(EVERY_LANGUAGE)(
    "in %s, a line with no words is the small quiet dash",
    (language: Language) => {
      for (const text of NO_VALUES) {
        const { getByTestId, unmount } = renderIn(
          language,
          <DashboardWidgetLine
            as="span"
            text={text}
            dataTestId="widget-line"
          />,
        );

        const line: HTMLElement = getByTestId("widget-line");
        expect(within(line).getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toHaveClass(
          "text-xs",
        );
        expect(spokenText(line)).toBe(NOT_SET[language]);
        unmount();
      }
    },
  );

  test("a line with words, or with an element of its own, draws them", () => {
    const { getByTestId } = renderIn(
      "en",
      <>
        <DashboardWidgetLine text="checkout-api" dataTestId="words" />
        <DashboardWidgetLine text="" dataTestId="link">
          <a href="#host">host-1</a>
        </DashboardWidgetLine>
      </>,
    );

    expect(getByTestId("words")).toHaveTextContent("checkout-api");
    expect(getByTestId("link")).toHaveTextContent("host-1");
    expect(
      within(getByTestId("link")).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeNull();
  });
});

describe("a list widget's name cell", () => {
  test.each(EVERY_LANGUAGE)(
    "in %s, a row with no host or cluster draws the quiet dash in its cell",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <table>
          <tbody>
            <tr>
              <ResourceListNameCell
                name={undefined}
                className="px-3 py-2 text-xs text-gray-500 truncate"
                dataTestId="cluster-cell"
              />
            </tr>
          </tbody>
        </table>,
      );

      const cell: HTMLElement = getByTestId("cluster-cell");
      expect(cell.tagName).toBe("TD");
      expect(spokenText(cell)).toBe(NOT_SET[language]);
      expect(cell.textContent).toBe(`${EMPTY_VALUE_MARK}${NOT_SET[language]}`);
    },
  );
});

describe("a resource part's Details card", () => {
  test.each(EVERY_LANGUAGE)(
    "in %s, a row with no value draws the card's quiet dash",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <ResourcePartDetailsCard
          testId="part-details"
          description="What this part is."
          rows={[
            { key: "group", label: "Host Group", value: undefined },
            {
              key: "zone",
              label: "Availability Zone",
              value: EMPTY_VALUE_MARK,
            },
            { key: "size", label: "Size", value: "12 GiB" },
          ]}
        />,
      );

      const card: HTMLElement = getByTestId("part-details");
      expect(within(card).getAllByTestId(EMPTY_VALUE_TEST_ID)).toHaveLength(2);
      for (const empty of within(card).getAllByTestId(EMPTY_VALUE_TEST_ID)) {
        expect(spokenText(empty)).toBe(NOT_SET[language]);
      }
      expect(card).toHaveTextContent("12 GiB");
    },
  );
});

describe("a topology card's stat", () => {
  test.each(EVERY_LANGUAGE)(
    "in %s, a stat with no reading is the small quiet dash beside its label",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <ReactFlowProvider>
          <TopologyNodeCard
            title="checkout"
            subtitle="Service"
            icon={IconProp.Server}
            color="#4f46e5"
            statusColor="#10b981"
            statusLabel="Healthy"
            stats={[
              { label: "avg", value: undefined },
              { label: "calls/s", value: "12" },
            ]}
          />
        </ReactFlowProvider>,
      );

      const empty: Element | null = container.querySelector(
        `[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`,
      );
      expect(empty).not.toBeNull();
      expect(spokenText(empty!)).toBe(NOT_SET[language]);
      expect(container).toHaveTextContent("12");
    },
  );
});

describe("the formatters write one mark for nothing", () => {
  const translator: Translator = dashboardTranslator("de");

  test.each([
    ["telemetry formatBytes", formatBytes(null)],
    ["telemetry formatCompact", formatCompact(null)],
    ["telemetry formatPercent", formatPercent(Number.NaN)],
    ["telemetry duration", formatDurationMsInLanguage(null, translator)],
    ["storage array formatBytes", StorageArrayResourceUtils.formatBytes(null)],
    [
      "storage array formatLatencyUsec",
      StorageArrayResourceUtils.formatLatencyUsec(undefined),
    ],
    // These three wrote a hyphen, and OpenStack's usage an en dash.
    ["data observability rows", formatRowCount(translator, null)],
    ["data observability size", formatSize(undefined)],
    ["kubernetes efficiency", formatEfficiency(null)],
    ["openstack usage", formatOpenStackUsageNumber(null, translator)],
  ])("%s", (_name: string, written: string) => {
    expect(written).toBe(EMPTY_VALUE_MARK);
  });

  test("and still write a value they have", () => {
    expect(formatBytes(2048)).not.toBe(EMPTY_VALUE_MARK);
    expect(formatSize(0)).not.toBe(EMPTY_VALUE_MARK);
    expect(formatEfficiency(0)).not.toBe(EMPTY_VALUE_MARK);
  });
});
