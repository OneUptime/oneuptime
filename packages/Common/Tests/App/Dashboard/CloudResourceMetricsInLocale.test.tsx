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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A cloud resource's More Metrics, its Add dialog and a section's key
 * metrics not reported (#9563, #9569), in German - a long language - and
 * Persian, read right to left: every word the Dashboard writes is the
 * locale's, none left in English, and what the cloud named - a metric, a
 * product - is drawn as the cloud wrote it.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const mockList: MockedFn = jest.fn();
const mockExplain: MockedFn = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMetricsApi",
  () => {
    return {
      __esModule: true,
      listCloudResourcePublishedMetrics: (...args: Array<unknown>) => {
        return mockList(...args);
      },
      addCloudResourceMetric: () => {
        return Promise.resolve([]);
      },
      removeCloudResourceMetric: () => {
        return Promise.resolve([]);
      },
      explainCloudResourceUnreportedKeyMetrics: (...args: Array<unknown>) => {
        return mockExplain(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import CloudResourceMoreMetrics, {
  CLOUD_MORE_METRICS_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMoreMetrics";
import { CLOUD_ADD_METRIC_MODAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudAddMetricModal";
import CloudUnreportedKeyMetricsList, {
  CLOUD_UNREPORTED_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudUnreportedKeyMetricsList";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { CloudAddedMetricScope } from "../../../Types/Cloud/CloudAddedMetrics";
import { CloudKeyMetricCondition } from "../../../Types/Cloud/CloudKeyMetricCondition";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudPublishedMetricBlock,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
} from "../../../Types/Cloud/CloudPublishedMetrics";
import {
  CloudUnreportedKeyMetricReport,
  CloudUnreportedReason,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import ObjectID from "../../../Types/ObjectID";

const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-4444-4444-8444-444444444444");

const LOCALES: Record<string, Record<string, unknown>> = {
  en: englishLocale,
  de: germanLocale,
  fa: persianLocale,
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["de", "fa"]) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: LOCALES[language]! },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

// A word as `language`'s Dashboard writes it.
function word(language: string, english: string): string {
  const value: unknown = LOCALES[language]![english];

  expect(typeof value).toBe("string");

  return value as string;
}

const LISTING: CloudPublishedMetricsListing = {
  provider: CloudProvider.Azure,
  resourceType: "Microsoft.Web/sites",
  metrics: [
    {
      name: "Http3xx",
      unit: "Count",
      aggregation: "Total",
      status: CloudPublishedMetricStatus.Added,
      addedKey: "resource|microsoft.web/sites|row||http3xx",
      addedScope: CloudAddedMetricScope.Type,
    },
    {
      name: "AverageMemoryWorkingSet",
      displayName: "Average memory working set",
      unit: "Bytes",
      aggregation: "Average",
      grain: "PT1M",
      status: CloudPublishedMetricStatus.Available,
    },
    {
      name: "InstanceSplit",
      unit: "Count",
      aggregation: "Average",
      status: CloudPublishedMetricStatus.Available,
      block: CloudPublishedMetricBlock.NeedsDimension,
    },
    {
      name: "Requests",
      unit: "Count",
      aggregation: "Total",
      status: CloudPublishedMetricStatus.Key,
    },
  ],
  resourcesOfType: 3,
  readIntervalInMinutes: 5,
  azureMetricsInCall: 20,
  addedForResource: 1,
  canEdit: true,
};

const REPORTS: Array<CloudUnreportedKeyMetricReport> = [
  {
    key: "replica lag",
    name: "physical_replication_delay_in_seconds",
    lastReportedAt: null,
    isNeverReported: true,
    reasons: [
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.Replica,
      },
      { reason: CloudUnreportedReason.NoPermission, fix: "cloud-connect" },
    ],
  },
  {
    key: "storage percent",
    name: "storage_percent",
    lastReportedAt: null,
    isNeverReported: false,
    reasons: [],
  },
];

// Sentences only the Dashboard writes, in English: none may be left.
const ENGLISH: Array<string> = [
  "More Metrics",
  "List Again",
  "Key metric",
  "Added for its type",
  "added metrics",
  "Its cloud reads it only split by one of its dimensions.",
  "Read it for",
  "This resource",
  "this connection reads",
  "Never reported",
  "Not reported in the last",
  "Only a replica reports it.",
  "it may be missing a permission",
  "Open Cloud > Connect",
  "No extra cost",
  "more Azure Monitor calls a month",
];

function expectNoEnglish(element: HTMLElement): void {
  const text: string = withoutIsolateMarks(element.textContent || "");

  for (const english of ENGLISH) {
    expect(text).not.toContain(english);
  }
}

beforeEach(() => {
  mockList.mockReset();
  mockExplain.mockReset();
  mockList.mockImplementation(() => {
    return Promise.resolve(LISTING);
  });
  mockExplain.mockImplementation(() => {
    return Promise.resolve(REPORTS);
  });
});

afterEach(() => {
  cleanup();
});

describe.each(["de", "fa"])("in %s", (language: string) => {
  test("More Metrics and its listing are in the reader's words, the cloud's names as the cloud wrote them", async () => {
    await act(async () => {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <CloudResourceMoreMetrics
            cloudResourceId={RESOURCE}
            provider={CloudProvider.Azure}
            resourceType="Microsoft.Web/sites"
          />
        </I18nextProvider>,
      );
    });

    expect(
      screen.getByText(word(language, "More Metrics")),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: word(language, "List Metrics") }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID),
      ).toHaveLength(4);
    });

    expect(screen.getByText(word(language, "Key metric"))).toBeInTheDocument();
    expect(
      screen.getByText(word(language, "Added for its type")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        word(
          language,
          "Its cloud reads it only split by one of its dimensions.",
        ),
      ),
    ).toBeInTheDocument();
    // The cloud's own names, whatever the page's direction.
    expect(screen.getByText("Average memory working set")).toBeInTheDocument();
    expect(screen.getByText("InstanceSplit")).toBeInTheDocument();

    expectNoEnglish(document.body);
  });

  test("the Add dialog says what each choice costs in the reader's words", async () => {
    await act(async () => {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <CloudResourceMoreMetrics
            cloudResourceId={RESOURCE}
            provider={CloudProvider.Azure}
            resourceType="Microsoft.Web/sites"
          />
        </I18nextProvider>,
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: word(language, "List Metrics") }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID),
      ).toHaveLength(4);
    });

    const memory: HTMLElement = screen
      .getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID)
      .find((row: HTMLElement): boolean => {
        return (row.textContent || "").includes("Average memory working set");
      })!;

    await act(async () => {
      fireEvent.click(
        within(memory).getByRole("button", { name: word(language, "Add") }),
      );
    });

    const dialog: HTMLElement = screen.getByTestId(
      CLOUD_ADD_METRIC_MODAL_TEST_ID,
    );

    expect(
      within(dialog).getByText(word(language, "Read it for")),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    // A call already full: each choice costs calls, said in the reader's words.
    expect(withoutIsolateMarks(dialog.textContent || "")).toContain(
      "App Service or Function App",
    );
    expectNoEnglish(dialog);
  });

  test("a section's key metrics not reported, since when and why, in the reader's words", async () => {
    await act(async () => {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <CloudUnreportedKeyMetricsList
            cloudResourceId={RESOURCE}
            keys={["replica lag", "storage percent"]}
          />
        </I18nextProvider>,
      );
    });
    await waitFor(() => {
      expect(screen.getAllByTestId(CLOUD_UNREPORTED_ROW_TEST_ID)).toHaveLength(
        2,
      );
    });

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      CLOUD_UNREPORTED_ROW_TEST_ID,
    );

    expect(
      within(rows[0]!).getByText(word(language, "Never reported")),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(word(language, "Only a replica reports it.")),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole("link", {
        name: word(language, "Open Cloud > Connect"),
      }),
    ).toBeInTheDocument();
    // The metric's name is the cloud's, left to right in any page.
    expect(
      within(rows[0]!).getByText("physical_replication_delay_in_seconds"),
    ).toHaveAttribute("dir", "ltr");

    expectNoEnglish(document.body);
  });
});
