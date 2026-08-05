import useLiveLogsRefresh from "../../../UI/Components/LogsViewer/useLiveLogsRefresh";
import "@testing-library/jest-dom/extend-expect";
import { act, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const POLL_INTERVAL_MS: number = 10000;

interface ProbeProps {
  isLive: boolean;
  isEligible?: boolean | undefined;
  intervalInMs?: number | undefined;
  refreshLogs: () => void;
  refreshHistogram: () => void;
}

/*
 * Exercises the hook through a real component lifecycle (mount, re-render,
 * unmount) rather than poking at it in isolation — the bug this guards
 * against lives in the effect wiring, not in a return value.
 */
const LiveProbe: FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): ReactElement => {
  useLiveLogsRefresh({
    isLive: props.isLive,
    isEligible: props.isEligible ?? true,
    intervalInMs: props.intervalInMs ?? POLL_INTERVAL_MS,
    refreshLogs: props.refreshLogs,
    refreshHistogram: props.refreshHistogram,
  });

  return <div data-testid="live-probe" />;
};

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

describe("useLiveLogsRefresh", () => {
  let refreshLogs: jest.Mock;
  let refreshHistogram: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    refreshLogs = jest.fn();
    refreshHistogram = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("while live mode is off", () => {
    test("refreshes nothing", () => {
      render(
        <LiveProbe
          isLive={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS * 5);

      expect(refreshLogs).not.toHaveBeenCalled();
      expect(refreshHistogram).not.toHaveBeenCalled();
    });

    test("leaves no timer running", () => {
      render(
        <LiveProbe
          isLive={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("when live mode is switched on", () => {
    test("refreshes the logs straight away rather than one tick later", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(refreshLogs).toHaveBeenCalledTimes(1);
    });

    /*
     * The regression this hook exists for: live mode used to poll only the
     * log list, so new rows kept arriving under a histogram that never moved.
     */
    test("refreshes the histogram straight away too", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(refreshHistogram).toHaveBeenCalledTimes(1);
    });

    test("runs exactly one timer", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("on every poll", () => {
    test("waits for the full interval before the next refresh", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS - 1);

      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
    });

    test("refreshes again on the interval boundary", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS);

      expect(refreshLogs).toHaveBeenCalledTimes(2);
      expect(refreshHistogram).toHaveBeenCalledTimes(2);
    });

    test("keeps the histogram on the same beat as the logs over many ticks", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      for (let tick: number = 0; tick < 10; tick++) {
        advance(POLL_INTERVAL_MS);

        expect(refreshHistogram).toHaveBeenCalledTimes(
          refreshLogs.mock.calls.length,
        );
      }

      // 1 immediate + 10 ticks.
      expect(refreshLogs).toHaveBeenCalledTimes(11);
      expect(refreshHistogram).toHaveBeenCalledTimes(11);
    });

    test("does not drift or double up across a long session", () => {
      render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS * 60);

      expect(refreshLogs).toHaveBeenCalledTimes(61);
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("when the view cannot be tailed", () => {
    test("does not poll on a page other than the first", () => {
      render(
        <LiveProbe
          isLive={true}
          isEligible={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS * 3);

      expect(refreshLogs).not.toHaveBeenCalled();
      expect(refreshHistogram).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    test("starts polling both endpoints once the view becomes eligible", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          isEligible={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={true}
          isEligible={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
    });

    test("stops polling when the reader pages away mid-session", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS);

      view.rerender(
        <LiveProbe
          isLive={true}
          isEligible={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS * 5);

      expect(refreshLogs).toHaveBeenCalledTimes(2);
      expect(refreshHistogram).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("when live mode is switched off", () => {
    test("stops refreshing both the logs and the histogram", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS * 5);

      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("refreshes immediately again when switched back on", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={false}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );
      view.rerender(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(refreshLogs).toHaveBeenCalledTimes(2);
      expect(refreshHistogram).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("when the parent re-renders mid-session", () => {
    /*
     * Results landing from a poll re-render the parent, which hands over
     * freshly-created callbacks. Re-arming the timer on that would reset the
     * cadence and fire an extra request on every render.
     */
    test("does not poll again just because the callbacks changed identity", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      // A distinct pair of callbacks per render, as a real parent would hand over.
      const renders: Array<{ logs: () => void; histogram: () => void }> = [
        1, 2, 3, 4, 5,
      ].map(() => {
        return {
          logs: () => {
            refreshLogs();
          },
          histogram: () => {
            refreshHistogram();
          },
        };
      });

      for (const callbacks of renders) {
        view.rerender(
          <LiveProbe
            isLive={true}
            refreshLogs={callbacks.logs}
            refreshHistogram={callbacks.histogram}
          />,
        );
      }

      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
    });

    test("keeps the original cadence rather than restarting the clock", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS - 1000);

      view.rerender(
        <LiveProbe
          isLive={true}
          refreshLogs={() => {
            refreshLogs();
          }}
          refreshHistogram={() => {
            refreshHistogram();
          }}
        />,
      );

      advance(1000);

      expect(refreshLogs).toHaveBeenCalledTimes(2);
      expect(refreshHistogram).toHaveBeenCalledTimes(2);
    });

    test("polls through the newest callbacks", () => {
      const laterLogs: jest.Mock = jest.fn();
      const laterHistogram: jest.Mock = jest.fn();

      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={true}
          refreshLogs={laterLogs}
          refreshHistogram={laterHistogram}
        />,
      );

      advance(POLL_INTERVAL_MS);

      expect(laterLogs).toHaveBeenCalledTimes(1);
      expect(laterHistogram).toHaveBeenCalledTimes(1);
      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the poll interval changes", () => {
    test("adopts the new cadence", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={true}
          intervalInMs={1000}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      advance(1000);

      // 1 on mount, 1 on the re-armed loop's immediate poll, 1 on its tick.
      expect(refreshLogs).toHaveBeenCalledTimes(3);
      expect(refreshHistogram).toHaveBeenCalledTimes(3);
    });

    test("does not leave the old cadence's timer behind", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.rerender(
        <LiveProbe
          isLive={true}
          intervalInMs={1000}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("cleanup", () => {
    test("stops polling once the viewer is unmounted", () => {
      const view: ReturnType<typeof render> = render(
        <LiveProbe
          isLive={true}
          refreshLogs={refreshLogs}
          refreshHistogram={refreshHistogram}
        />,
      );

      view.unmount();

      advance(POLL_INTERVAL_MS * 5);

      expect(refreshLogs).toHaveBeenCalledTimes(1);
      expect(refreshHistogram).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
