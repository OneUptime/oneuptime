/** @timezone UTC */

import React, { FunctionComponent, ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import useClockTick from "../../../UI/Utils/UseClockTick";

const START: Date = new Date("2026-08-03T18:07:09.500Z");

/*
 * A probe that renders whatever the hook hands back, so the assertions read
 * the value through a real component lifecycle (mount, re-render, unmount)
 * rather than poking at the hook in isolation.
 */
const ClockProbe: FunctionComponent<{ showSeconds: boolean }> = (props: {
  showSeconds: boolean;
}): ReactElement => {
  const now: Date = useClockTick(props.showSeconds);

  return <div data-testid="now">{now.toISOString()}</div>;
};

function renderedTime(): string {
  return screen.getByTestId("now").textContent || "";
}

/** Move both the clock and the timer queue forward together. */
function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

/** Fire the event the browser sends when a tab comes back to the foreground. */
function becomeVisible(): void {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function becomeHidden(): void {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useClockTick", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: START });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("reports the current time on the very first render", () => {
    render(<ClockProbe showSeconds={true} />);

    expect(renderedTime()).toBe(START.toISOString());
  });

  describe("second cadence", () => {
    it("does not advance before the next second boundary", () => {
      render(<ClockProbe showSeconds={true} />);

      advance(499);

      expect(renderedTime()).toBe(START.toISOString());
    });

    it("advances exactly on the next second boundary", () => {
      render(<ClockProbe showSeconds={true} />);

      advance(500);

      expect(renderedTime()).toBe("2026-08-03T18:07:10.000Z");
    });

    it("keeps ticking once a second after the first alignment", () => {
      render(<ClockProbe showSeconds={true} />);

      advance(500);
      advance(1000);

      expect(renderedTime()).toBe("2026-08-03T18:07:11.000Z");

      advance(1000);

      expect(renderedTime()).toBe("2026-08-03T18:07:12.000Z");
    });

    it("stays aligned to the second rather than drifting off it", () => {
      render(<ClockProbe showSeconds={true} />);

      advance(500);

      for (let tick: number = 0; tick < 30; tick++) {
        advance(1000);
      }

      // 30 aligned ticks after 18:07:10 — no accumulated drift.
      expect(renderedTime()).toBe("2026-08-03T18:07:40.000Z");
    });
  });

  describe("minute cadence", () => {
    it("does not advance part-way through the minute", () => {
      render(<ClockProbe showSeconds={false} />);

      advance(50499);

      expect(renderedTime()).toBe(START.toISOString());
    });

    it("advances exactly on the next minute boundary", () => {
      render(<ClockProbe showSeconds={false} />);

      advance(50500);

      expect(renderedTime()).toBe("2026-08-03T18:08:00.000Z");
    });

    it("keeps ticking once a minute after the first alignment", () => {
      render(<ClockProbe showSeconds={false} />);

      advance(50500);
      advance(60000);

      expect(renderedTime()).toBe("2026-08-03T18:09:00.000Z");
    });

    it("does not schedule a second-by-second wake-up it does not need", () => {
      render(<ClockProbe showSeconds={false} />);

      advance(1000);
      advance(1000);

      expect(renderedTime()).toBe(START.toISOString());
    });
  });

  describe("when the tab comes back to the foreground", () => {
    it("catches up immediately instead of waiting for the throttled timer", () => {
      render(<ClockProbe showSeconds={false} />);

      /*
       * Reproduces what a real background tab does: the wall clock moves on
       * but the throttled timer never fires, so the rendered time goes stale.
       */
      becomeHidden();
      act(() => {
        jest.setSystemTime(new Date("2026-08-03T18:42:31.000Z"));
      });

      expect(renderedTime()).toBe(START.toISOString());

      becomeVisible();

      expect(renderedTime()).toBe("2026-08-03T18:42:31.000Z");
    });

    it("re-aligns the following tick to the new boundary", () => {
      render(<ClockProbe showSeconds={true} />);

      becomeHidden();
      act(() => {
        jest.setSystemTime(new Date("2026-08-03T18:42:31.250Z"));
      });
      becomeVisible();

      advance(749);

      expect(renderedTime()).toBe("2026-08-03T18:42:31.250Z");

      advance(1);

      expect(renderedTime()).toBe("2026-08-03T18:42:32.000Z");
    });

    it("ignores the event while the tab is still hidden", () => {
      render(<ClockProbe showSeconds={true} />);

      act(() => {
        jest.setSystemTime(new Date("2026-08-03T18:42:31.000Z"));
      });
      becomeHidden();

      expect(renderedTime()).toBe(START.toISOString());
    });

    it("does not leave a second timer running after a resync", () => {
      render(<ClockProbe showSeconds={true} />);

      becomeVisible();
      becomeVisible();
      becomeVisible();

      /*
       * Three resyncs must leave exactly one pending timer. A leaked one
       * would fire alongside it and double-schedule from then on.
       */
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("cleanup", () => {
    it("stops ticking once the widget is removed from the dashboard", () => {
      const view: ReturnType<typeof render> = render(
        <ClockProbe showSeconds={true} />,
      );

      view.unmount();

      expect(jest.getTimerCount()).toBe(0);
    });

    it("stops listening for visibility changes once unmounted", () => {
      const removeSpy: jest.SpyInstance = jest.spyOn(
        document,
        "removeEventListener",
      );

      const view: ReturnType<typeof render> = render(
        <ClockProbe showSeconds={true} />,
      );

      view.unmount();

      expect(removeSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });

    it("runs exactly one timer per mounted clock", () => {
      render(<ClockProbe showSeconds={true} />);

      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe("when the cadence changes", () => {
    it("switches to the second boundary after seconds are turned on", () => {
      const view: ReturnType<typeof render> = render(
        <ClockProbe showSeconds={false} />,
      );

      view.rerender(<ClockProbe showSeconds={true} />);

      advance(500);

      expect(renderedTime()).toBe("2026-08-03T18:07:10.000Z");
    });

    it("does not leave the old cadence's timer behind", () => {
      const view: ReturnType<typeof render> = render(
        <ClockProbe showSeconds={false} />,
      );

      view.rerender(<ClockProbe showSeconds={true} />);

      expect(jest.getTimerCount()).toBe(1);
    });
  });
});
