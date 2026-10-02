import React from "react";
import { StyleSheet, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import LiveElapsed, { LIVE_ELAPSED_INTERVAL_MS } from "./LiveElapsed";

/*
 * The duration of the status in effect right now, counting up on screen. It
 * has to move every second without anything around it re-rendering, and stop
 * when it is taken off screen.
 */

const NOW: number = new Date("2026-10-02T12:45:57.000Z").getTime();
const SECOND: number = 1000;

function elapsed(): string {
  return String(
    screen.getByTestId("live-elapsed").props.children as React.ReactNode,
  );
}

/*
 * Moves the clock and the timer queue together. Awaited: in this version of
 * @testing-library/react-native an act that is not awaited returns before
 * React has flushed the tick it caused.
 */
async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("LiveElapsed", () => {
  test("shows how long it has been going on", async () => {
    await render(
      <LiveElapsed since={NOW - 174 * SECOND} testID="live-elapsed" />,
    );

    expect(elapsed()).toBe("2m 54s");
  });

  test("counts up every second, with no reload", async () => {
    await render(
      <LiveElapsed since={NOW - 174 * SECOND} testID="live-elapsed" />,
    );

    await advance(SECOND);
    expect(elapsed()).toBe("2m 55s");

    await advance(SECOND);
    expect(elapsed()).toBe("2m 56s");

    await advance(4 * SECOND);
    expect(elapsed()).toBe("3m 0s");
  });

  test("ticks once a second, the resolution it shows", () => {
    expect(LIVE_ELAPSED_INTERVAL_MS).toBe(SECOND);
  });

  test("starts at 0s for something that has only just begun", async () => {
    await render(<LiveElapsed since={NOW} testID="live-elapsed" />);

    expect(elapsed()).toBe("0s");

    await advance(SECOND);
    expect(elapsed()).toBe("1s");
  });

  test("a start a little ahead of the handset's clock reads 0s, not a negative", async () => {
    await render(
      <LiveElapsed since={NOW + 3 * SECOND} testID="live-elapsed" />,
    );

    expect(elapsed()).toBe("0s");
  });

  test("is a timer to assistive technology", async () => {
    await render(<LiveElapsed since={NOW} testID="live-elapsed" />);

    expect(screen.getByTestId("live-elapsed").props.accessibilityRole).toBe(
      "timer",
    );
  });

  test("uses even-width digits, so the words after it do not shuffle", async () => {
    await render(<LiveElapsed since={NOW} testID="live-elapsed" />);

    expect(
      StyleSheet.flatten(screen.getByTestId("live-elapsed").props.style),
    ).toMatchObject({ fontVariant: ["tabular-nums"] });
  });

  test("re-renders itself, not the text it sits inside", async () => {
    let outerRenders: number = 0;

    function Line(): React.JSX.Element {
      outerRenders++;

      return (
        <Text>
          {"for "}
          <LiveElapsed since={NOW - 10 * SECOND} testID="live-elapsed" />
        </Text>
      );
    }

    await render(<Line />);

    const rendersAfterMount: number = outerRenders;

    await advance(5 * SECOND);

    expect(elapsed()).toBe("15s");
    expect(outerRenders).toBe(rendersAfterMount);
  });

  test("stops ticking once it is off screen", async () => {
    const setIntervalSpy: jest.SpyInstance = jest.spyOn(global, "setInterval");
    const clearIntervalSpy: jest.SpyInstance = jest.spyOn(
      global,
      "clearInterval",
    );

    const view: Awaited<ReturnType<typeof render>> = await render(
      <LiveElapsed since={NOW} testID="live-elapsed" />,
    );

    // Its one clock, ticking once a second.
    const secondTicks: Array<jest.MockResult<unknown>> =
      setIntervalSpy.mock.results.filter(
        (_result: jest.MockResult<unknown>, index: number): boolean => {
          return setIntervalSpy.mock.calls[index]?.[1] === SECOND;
        },
      );

    expect(secondTicks).toHaveLength(1);

    const clockId: unknown = secondTicks[0]!.value;

    expect(clearIntervalSpy).not.toHaveBeenCalledWith(clockId);

    await act(async () => {
      view.unmount();
    });

    expect(clearIntervalSpy).toHaveBeenCalledWith(clockId);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
