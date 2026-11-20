import "@testing-library/jest-dom";
import {
  afterEach,
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
import * as React from "react";

/*
 * How a cloud resource's metrics were collected (#10291), above them on its
 * Metrics tab and its Overview: one line while all is well, and - when its
 * connection's last read could not read some of them, or any - "Show why",
 * which opens each, why in OneUptime's words, since when, and the cloud's
 * own words after.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const mockCollection: MockedFn = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMetricsApi",
  () => {
    return {
      __esModule: true,
      getCloudResourceMetricCollection: (...args: Array<unknown>) => {
        return mockCollection(...args);
      },
    };
  },
);

import CloudResourceMetricCollectionLine, {
  CLOUD_METRICS_FIRST_READ,
  CLOUD_METRICS_NOT_READ,
  CLOUD_METRICS_NOT_READ_SINCE,
  CLOUD_METRICS_READ_AT,
  CLOUD_METRIC_COLLECTION_TEST_ID,
  CLOUD_METRIC_NOT_READ_SINCE,
  CLOUD_METRIC_NOT_READ_TEST_ID,
  getCloudMetricCollectionLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMetricCollectionLine";
import {
  CLOUD_UNREPORTED_REASON_SENTENCES,
  CloudUnreportedReason,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  CloudMetricCollectionState,
  CloudMetricNotRead,
  CloudMetricNotReadKind,
  CloudResourceMetricCollection,
} from "../../../Types/Cloud/CloudResourceMetricCollection";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { INLINE_VALUE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/InlineValueSkeleton";

const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-3333-4333-8333-333333333333");
const READ_AT: string = "2026-11-19T11:58:00.000Z";
const SINCE: string = "2026-11-19T09:00:00.000Z";

const BYTE_HIT_RATIO: CloudMetricNotRead = {
  name: "ByteHitRatio",
  kind: CloudMetricNotReadKind.Unsupported,
  error:
    "Sampling type is not found. Metric: AzureFrontdoorShoebox/ByteHitRatio. Sampling type requested: Sum.",
  since: SINCE,
  at: READ_AT,
  until: "2026-11-20T11:58:00.000Z",
};
const CPU_PERCENTAGE: CloudMetricNotRead = {
  name: "CpuPercentage",
  kind: CloudMetricNotReadKind.Throttled,
  error:
    "Query was throttled with reason: ServerBusy. Too many queries are in flight.",
  since: SINCE,
  at: READ_AT,
};

async function renderLine(
  collection: CloudResourceMetricCollection | null,
): Promise<void> {
  mockCollection.mockImplementation(() => {
    return Promise.resolve(collection);
  });

  await act(async () => {
    render(<CloudResourceMetricCollectionLine cloudResourceId={RESOURCE} />);
  });
}

beforeEach(() => {
  mockCollection.mockReset();
  jest
    .spyOn(OneUptimeDate, "fromNow")
    .mockImplementation((date: Date): string => {
      return date.toISOString() === READ_AT ? "2 minutes ago" : "3 hours ago";
    });
  // Since a moment: the moment, as the reader's dates are written.
  jest
    .spyOn(OneUptimeDate, "getDateAsUserFriendlyLocalFormattedString")
    .mockImplementation((date: string | Date): string => {
      return new Date(date).toISOString() === SINCE
        ? "Nov 19, 2026 09:00"
        : "another moment";
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("how a cloud resource's metrics were collected", () => {
  test("read in full: one line - when - and nothing to open", async () => {
    await renderLine({
      state: CloudMetricCollectionState.Collected,
      lastReadAt: READ_AT,
      metrics: [],
    });

    const line: HTMLElement = await screen.findByTestId(
      CLOUD_METRIC_COLLECTION_TEST_ID,
    );

    expect(line).toHaveTextContent("Its metrics were read 2 minutes ago.");
    expect(within(line).queryByRole("button")).toBeNull();
    expect(mockCollection).toHaveBeenCalledWith(RESOURCE);
    expect(line.querySelector(".bg-green-500")).not.toBeNull();
  });

  test("some not read: how many, and Show why opens each - why in OneUptime's words, since when, then the cloud's own words", async () => {
    await renderLine({
      state: CloudMetricCollectionState.Partial,
      lastReadAt: READ_AT,
      metrics: [BYTE_HIT_RATIO, CPU_PERCENTAGE],
    });

    const line: HTMLElement = await screen.findByTestId(
      CLOUD_METRIC_COLLECTION_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "Its metrics were read 2 minutes ago, but 2 of them could not be.",
    );
    expect(line.querySelector(".bg-amber-500")).not.toBeNull();
    expect(screen.queryAllByTestId(CLOUD_METRIC_NOT_READ_TEST_ID)).toHaveLength(
      0,
    );

    const toggle: HTMLElement = within(line).getByRole("button", {
      name: "Show why",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(within(line).getByRole("button", { name: "Hide" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const items: Array<HTMLElement> = screen.getAllByTestId(
      CLOUD_METRIC_NOT_READ_TEST_ID,
    );

    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("ByteHitRatio")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(
      within(items[0]!).getByText(
        "Its cloud answered that it does not serve this metric for this resource, so its connection stops asking for it for a day.",
      ),
    ).toBeInTheDocument();
    expect(
      within(items[0]!).getByText("Not read since Nov 19, 2026 09:00."),
    ).toBeInTheDocument();
    expect(within(items[0]!).getByText(BYTE_HIT_RATIO.error)).toHaveClass(
      "font-mono",
    );
    expect(
      within(items[1]!).getByText(
        "Its cloud was too busy to answer for it at the last read. The next read asks again.",
      ),
    ).toBeInTheDocument();
    expect(
      within(items[1]!).getByText(CPU_PERCENTAGE.error),
    ).toBeInTheDocument();

    fireEvent.click(within(line).getByRole("button", { name: "Hide" }));
    expect(screen.queryAllByTestId(CLOUD_METRIC_NOT_READ_TEST_ID)).toHaveLength(
      0,
    );
  });

  test("one not read is said as one", async () => {
    await renderLine({
      state: CloudMetricCollectionState.Partial,
      lastReadAt: READ_AT,
      metrics: [CPU_PERCENTAGE],
    });

    expect(
      await screen.findByTestId(CLOUD_METRIC_COLLECTION_TEST_ID),
    ).toHaveTextContent(
      "Its metrics were read 2 minutes ago, but one of them could not be.",
    );
  });

  test("none read: since when, and Show why says what the cloud answered", async () => {
    await renderLine({
      state: CloudMetricCollectionState.Failed,
      lastReadAt: null,
      failedSince: SINCE,
      error:
        "Azure metrics request failed with HTTP 529: Query was throttled with reason: ServerBusy.",
      metrics: [],
    });

    const line: HTMLElement = await screen.findByTestId(
      CLOUD_METRIC_COLLECTION_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "Its metrics have not been read since Nov 19, 2026 09:00.",
    );
    expect(line.querySelector(".bg-red-500")).not.toBeNull();

    fireEvent.click(within(line).getByRole("button", { name: "Show why" }));

    expect(
      within(line).getByText(
        "Azure metrics request failed with HTTP 529: Query was throttled with reason: ServerBusy.",
      ),
    ).toHaveAttribute("dir", "ltr");
  });

  test("its connection's read failed, its first read to come, its connection off: each its sentence", async () => {
    await renderLine({
      state: CloudMetricCollectionState.Failed,
      lastReadAt: null,
      metrics: [],
    });
    expect(
      await screen.findByTestId(CLOUD_METRIC_COLLECTION_TEST_ID),
    ).toHaveTextContent(
      "Its metrics could not be read at its connection's last read.",
    );
    // Nothing more to say: nothing to open.
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    await renderLine({
      state: CloudMetricCollectionState.Waiting,
      lastReadAt: null,
      metrics: [],
    });
    expect(
      await screen.findByTestId(CLOUD_METRIC_COLLECTION_TEST_ID),
    ).toHaveTextContent(
      "Its metrics are read for the first time at its connection's next read.",
    );
    cleanup();

    await renderLine({
      state: CloudMetricCollectionState.Off,
      lastReadAt: null,
      metrics: [],
    });
    expect(
      await screen.findByTestId(CLOUD_METRIC_COLLECTION_TEST_ID),
    ).toHaveTextContent("Its cloud connection is turned off.");
  });

  test("nothing to say of the resource: nothing drawn", async () => {
    await renderLine(null);

    await waitFor(() => {
      expect(mockCollection).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId(CLOUD_METRIC_COLLECTION_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeNull();
  });

  test("while it loads, the line's shape; a question that fails says why", async () => {
    let answer: (
      value: CloudResourceMetricCollection | null,
    ) => void = () => {};

    mockCollection.mockImplementation(() => {
      return new Promise<CloudResourceMetricCollection | null>(
        (resolve: (value: CloudResourceMetricCollection | null) => void) => {
          answer = resolve;
        },
      );
    });

    await act(async () => {
      render(<CloudResourceMetricCollectionLine cloudResourceId={RESOURCE} />);
    });

    expect(
      screen.getByTestId(INLINE_VALUE_SKELETON_TEST_ID),
    ).toBeInTheDocument();

    await act(async () => {
      answer({
        state: CloudMetricCollectionState.Collected,
        lastReadAt: READ_AT,
        metrics: [],
      });
    });

    expect(screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeNull();
    cleanup();

    mockCollection.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have permission to read this cloud resource."),
      );
    });

    await act(async () => {
      render(<CloudResourceMetricCollectionLine cloudResourceId={RESOURCE} />);
    });

    expect(
      await screen.findByText(
        "You do not have permission to read this cloud resource.",
      ),
    ).toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  const PLURAL: string =
    "Its metrics were read {{time}}, but {{count}} of them could not be.";
  const KEYS: Array<string> = [
    CLOUD_METRICS_READ_AT,
    CLOUD_METRICS_NOT_READ_SINCE,
    CLOUD_METRICS_NOT_READ,
    CLOUD_METRICS_FIRST_READ,
    CLOUD_METRIC_NOT_READ_SINCE,
    PLURAL,
    `${PLURAL}_one`,
    "Couldn't load how this resource's metrics were collected.",
    CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.NotServed],
    CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.CloudBusy],
  ];

  test("every sentence is worded in every Dashboard language, with its placeholders", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of KEYS) {
        expect([
          language,
          key,
          isWordedInDashboardLocale(key, language),
        ]).toEqual([language, key, true]);
        expect([
          language,
          key,
          placeholdersOf(readDashboardLocale(language)[key]!),
        ]).toEqual([
          language,
          key,
          placeholdersOf(readDashboardLocale("en")[key]!),
        ]);
      }
    }
  });

  test("the line is said in each language, its time and count where the language puts them", () => {
    const english: Translator = dashboardTranslator("en");
    const partial: CloudResourceMetricCollection = {
      state: CloudMetricCollectionState.Partial,
      lastReadAt: READ_AT,
      metrics: [BYTE_HIT_RATIO, CPU_PERCENTAGE],
    };

    for (const language of DASHBOARD_LANGUAGES) {
      const line: string = getCloudMetricCollectionLine({
        collection: partial,
        translator: dashboardTranslator(language),
      });

      expect(line).not.toContain("{{");
      expect(line).toContain("2 minutes ago");

      if (language !== "en") {
        expect([language, line]).not.toEqual([
          language,
          getCloudMetricCollectionLine({
            collection: partial,
            translator: english,
          }),
        ]);
      }
    }
  });
});
