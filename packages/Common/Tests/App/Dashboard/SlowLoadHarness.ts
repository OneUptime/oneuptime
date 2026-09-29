import "@testing-library/jest-dom";
import { expect, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react";
import { deferred, Deferred, flush } from "./TimeRangeZoomPageHarness";

/*
 * Helpers for the suites that play a slow backend against the overview
 * pages' auto-refresh (issue #4105 follow-up): every load outlasts the
 * 30-second interval, and the page must still paint, stop its Refresh
 * spinner, and let a zoom win over the load it interrupts. Not a test file
 * itself (no .test. in the name), so jest does not run it.
 */

// Every page here refreshes every 30 seconds unless the reader chose otherwise.
export const AUTO_REFRESH_MS: number = 30_000;

// Moves the clock, and with it the page's auto-refresh timer, on by `ms`.
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

export interface ParkedCall<Call> {
  call: Call;
  release: () => void;
  fail: (error: Error) => void;
}

/*
 * A backend that answers only when a test says so. Each call is parked with
 * the answer it would have got - worked out when it was asked, so it holds
 * the rows of the window asked for - until the test releases or fails it.
 */
export class Backlog<Call> {
  private parked: Array<ParkedCall<Call>> = [];

  public park<Answer>(call: Call, answer: Answer): Promise<Answer> {
    const held: Deferred<Answer> = deferred<Answer>();

    this.parked.push({
      call: call,
      release: (): void => {
        held.resolve(answer);
      },
      fail: (error: Error): void => {
        held.reject(error);
      },
    });

    return held.promise;
  }

  // The calls still waiting for an answer, oldest first.
  public calls(): Array<Call> {
    return this.parked.map((parked: ParkedCall<Call>): Call => {
      return parked.call;
    });
  }

  public clear(): void {
    this.parked = [];
  }

  // Answers every parked call `which` picks; at least one must match.
  public async release(which: (call: Call) => boolean): Promise<void> {
    for (const parked of this.take(which)) {
      parked.release();
    }

    await flush();
  }

  // Fails every parked call `which` picks; at least one must match.
  public async fail(
    which: (call: Call) => boolean,
    error: Error,
  ): Promise<void> {
    for (const parked of this.take(which)) {
      parked.fail(error);
    }

    await flush();
  }

  private take(which: (call: Call) => boolean): Array<ParkedCall<Call>> {
    const taken: Array<ParkedCall<Call>> = this.parked.filter(
      (parked: ParkedCall<Call>): boolean => {
        return which(parked.call);
      },
    );

    this.parked = this.parked.filter((parked: ParkedCall<Call>): boolean => {
      return !taken.includes(parked);
    });

    expect(taken.length).toBeGreaterThan(0);

    return taken;
  }
}

// The hero's Refresh button: AutoRefreshControl, rendered for real.
export function refreshButton(): HTMLButtonElement {
  return screen.getByTitle("Refresh now") as HTMLButtonElement;
}

// While the page loads, Refresh is disabled and its icon spins.
export function expectRefreshSpinning(): void {
  const button: HTMLButtonElement = refreshButton();

  expect(button).toBeDisabled();
  expect(button.querySelector("svg")).toHaveClass("animate-spin");
}

// Once the newest load has landed, Refresh can be pressed again.
export function expectRefreshSettled(): void {
  const button: HTMLButtonElement = refreshButton();

  expect(button).toBeEnabled();
  expect(button.querySelector("svg")).not.toHaveClass("animate-spin");
}
