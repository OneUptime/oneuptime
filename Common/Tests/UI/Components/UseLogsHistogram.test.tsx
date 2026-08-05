import useLogsHistogram, {
  FetchHistogramBucketsFunction,
  LogsHistogramState,
} from "../../../UI/Components/LogsViewer/useLogsHistogram";
import { HistogramBucket } from "../../../UI/Components/LogsViewer/types";
import { act, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useCallback } from "react";
import { beforeEach, describe, expect, test } from "@jest/globals";

function bucket(time: string, count: number): HistogramBucket {
  return { time, severity: "Error", count };
}

const FIRST_WINDOW: Array<HistogramBucket> = [bucket("11:59", 3)];
const SECOND_WINDOW: Array<HistogramBucket> = [
  bucket("11:59", 3),
  bucket("12:00", 8),
];

interface ProbeProps {
  fetchBuckets: FetchHistogramBucketsFunction;
  /** Bumping this hands the hook a new query identity, as a filter change would. */
  queryKey?: string | undefined;
  onReady?: ((state: LogsHistogramState) => void) | undefined;
}

/*
 * Renders the hook's state so assertions read it through a real component
 * lifecycle, and hands the state object back so tests can trigger a refresh
 * the way live mode does.
 */
const HistogramProbe: FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): ReactElement => {
  const { fetchBuckets, queryKey } = props;

  const fetch: FetchHistogramBucketsFunction = useCallback(() => {
    return fetchBuckets();
    /*
     * queryKey stands in for the filters/time range the real caller closes
     * over: changing it is what makes the hook reload.
     */
  }, [fetchBuckets, queryKey]);

  const state: LogsHistogramState = useLogsHistogram(fetch);

  props.onReady?.(state);

  return (
    <div>
      <span data-testid="counts">
        {state.buckets
          .map((item: HistogramBucket) => {
            return `${item.time}=${item.count}`;
          })
          .join(",")}
      </span>
      <span data-testid="loading">{String(state.isLoading)}</span>
    </div>
  );
};

function counts(): string {
  return screen.getByTestId("counts").textContent || "";
}

function isLoading(): boolean {
  return screen.getByTestId("loading").textContent === "true";
}

describe("useLogsHistogram", () => {
  let latest: LogsHistogramState | null;
  let loadingStates: Array<boolean>;

  const captureState: (state: LogsHistogramState) => void = (
    state: LogsHistogramState,
  ): void => {
    latest = state;
    loadingStates.push(state.isLoading);
  };

  async function refresh(silent: boolean): Promise<void> {
    await act(async () => {
      await latest!.refresh(silent ? { silent: true } : {});
    });
  }

  beforeEach(() => {
    latest = null;
    loadingStates = [];
  });

  describe("first load", () => {
    test("shows the buckets the query returns", async () => {
      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        return FIRST_WINDOW;
      };

      render(<HistogramProbe fetchBuckets={fetchBuckets} />);

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });
    });

    test("raises the loading flag while the query runs", async () => {
      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        return FIRST_WINDOW;
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      expect(loadingStates).toContain(true);
      expect(isLoading()).toBe(false);
    });

    test("leaves the chart empty when the query fails", async () => {
      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        throw new Error("clickhouse timeout");
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(isLoading()).toBe(false);
      });

      expect(counts()).toBe("");
    });
  });

  describe("when the query changes", () => {
    test("reloads for the new filters", async () => {
      let window: Array<HistogramBucket> = FIRST_WINDOW;

      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        return window;
      };

      const view: ReturnType<typeof render> = render(
        <HistogramProbe fetchBuckets={fetchBuckets} queryKey="one-hour" />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      window = SECOND_WINDOW;

      view.rerender(
        <HistogramProbe fetchBuckets={fetchBuckets} queryKey="one-day" />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3,12:00=8");
      });
    });

    test("does not reload when nothing about the query changed", async () => {
      let calls: number = 0;

      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        calls++;
        return FIRST_WINDOW;
      };

      const view: ReturnType<typeof render> = render(
        <HistogramProbe fetchBuckets={fetchBuckets} queryKey="one-hour" />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      view.rerender(
        <HistogramProbe fetchBuckets={fetchBuckets} queryKey="one-hour" />,
      );

      expect(calls).toBe(1);
    });
  });

  /*
   * Live mode polls the histogram every few seconds. These are the properties
   * that keep the chart from flashing, blanking or stampeding while it does.
   */
  describe("silent refresh", () => {
    test("moves the chart on to the newer window", async () => {
      let window: Array<HistogramBucket> = FIRST_WINDOW;

      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        return window;
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      window = SECOND_WINDOW;
      await refresh(true);

      expect(counts()).toBe("11:59=3,12:00=8");
    });

    test("never raises the loading flag", async () => {
      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        return FIRST_WINDOW;
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      loadingStates = [];

      await refresh(true);
      await refresh(true);

      expect(loadingStates).not.toContain(true);
    });

    test("keeps the chart on screen when a poll fails", async () => {
      let shouldFail: boolean = false;

      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        if (shouldFail) {
          throw new Error("clickhouse timeout");
        }

        return FIRST_WINDOW;
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(counts()).toBe("11:59=3");
      });

      shouldFail = true;
      await refresh(true);

      expect(counts()).toBe("11:59=3");
    });

    test("recovers on the next poll after a failure", async () => {
      let shouldFail: boolean = true;
      let window: Array<HistogramBucket> = FIRST_WINDOW;

      const fetchBuckets: FetchHistogramBucketsFunction = async (): Promise<
        Array<HistogramBucket>
      > => {
        if (shouldFail) {
          throw new Error("clickhouse timeout");
        }

        return window;
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(isLoading()).toBe(false);
      });

      shouldFail = false;
      window = SECOND_WINDOW;
      await refresh(true);

      expect(counts()).toBe("11:59=3,12:00=8");
    });

    test("drops a poll that lands while the previous one is still running", async () => {
      const pending: Array<(buckets: Array<HistogramBucket>) => void> = [];

      const fetchBuckets: FetchHistogramBucketsFunction = (): Promise<
        Array<HistogramBucket>
      > => {
        return new Promise<Array<HistogramBucket>>(
          (resolve: (buckets: Array<HistogramBucket>) => void) => {
            pending.push(resolve);
          },
        );
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      // Let the first load settle so only the polls are in play.
      await waitFor(() => {
        expect(pending.length).toBe(1);
      });
      await act(async () => {
        pending[0]!(FIRST_WINDOW);
      });

      // A poll that is still waiting on a slow aggregation...
      let slowPoll: Promise<void> = Promise.resolve();
      await act(async () => {
        slowPoll = latest!.refresh({ silent: true });
      });
      expect(pending.length).toBe(2);

      // ...swallows the ticks that land behind it.
      await act(async () => {
        await latest!.refresh({ silent: true });
        await latest!.refresh({ silent: true });
      });
      expect(pending.length).toBe(2);

      await act(async () => {
        pending[1]!(SECOND_WINDOW);
        await slowPoll;
      });

      expect(counts()).toBe("11:59=3,12:00=8");

      // The gate lifts once the slow poll comes back.
      await act(async () => {
        void latest!.refresh({ silent: true });
      });
      expect(pending.length).toBe(3);

      await act(async () => {
        pending[2]!(SECOND_WINDOW);
      });
    });

    test("does not hold up a full reload triggered by the reader", async () => {
      const pending: Array<(buckets: Array<HistogramBucket>) => void> = [];

      const fetchBuckets: FetchHistogramBucketsFunction = (): Promise<
        Array<HistogramBucket>
      > => {
        return new Promise<Array<HistogramBucket>>(
          (resolve: (buckets: Array<HistogramBucket>) => void) => {
            pending.push(resolve);
          },
        );
      };

      render(
        <HistogramProbe fetchBuckets={fetchBuckets} onReady={captureState} />,
      );

      await waitFor(() => {
        expect(pending.length).toBe(1);
      });
      await act(async () => {
        pending[0]!(FIRST_WINDOW);
      });

      await act(async () => {
        void latest!.refresh({ silent: true });
      });
      expect(pending.length).toBe(2);

      // A filter change or a manual reload must not be swallowed by the gate.
      await act(async () => {
        void latest!.refresh();
      });
      expect(pending.length).toBe(3);
      expect(isLoading()).toBe(true);

      await act(async () => {
        pending[1]!(FIRST_WINDOW);
        pending[2]!(SECOND_WINDOW);
      });

      expect(isLoading()).toBe(false);
    });
  });
});
