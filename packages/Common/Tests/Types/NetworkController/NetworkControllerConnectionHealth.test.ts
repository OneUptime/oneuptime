import {
  NetworkControllerConnectionHealthInput,
  NetworkControllerConnectionStatus,
  getNetworkControllerConnectionHealth,
  getNetworkControllerStaleAfterMinutes,
  isNetworkControllerStatusAProblem,
} from "../../../Types/NetworkController/NetworkControllerConnectionHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * How a connection is doing, in one word - the same rule on its row, over
 * its traffic and in the API's summary. A failure says so until a read
 * works; reads that stopped make the connection stale after three of its
 * intervals, so traffic that stopped coming in is never a quiet network.
 */

const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function health(
  input: Partial<NetworkControllerConnectionHealthInput>,
): NetworkControllerConnectionStatus {
  return getNetworkControllerConnectionHealth(
    { readIntervalInMinutes: 5, isEnabled: true, ...input },
    NOW,
  ).status;
}

describe("a connection's status", () => {
  test("turned off is Off, whatever happened before", () => {
    expect(
      health({ isEnabled: false, lastError: "refused", lastPulledAt: ago(1) }),
    ).toBe(NetworkControllerConnectionStatus.Off);
  });

  test("never read is Waiting, until it waited longer than a read could take", () => {
    expect(health({ createdAt: ago(2) })).toBe(
      NetworkControllerConnectionStatus.Waiting,
    );
    expect(health({ createdAt: ago(31) })).toBe(
      NetworkControllerConnectionStatus.Stale,
    );
  });

  test("a read that failed is Failing until one works", () => {
    expect(
      health({ lastPulledAt: ago(2), lastError: "Meraki refused the key" }),
    ).toBe(NetworkControllerConnectionStatus.Failing);
    expect(
      health({
        lastPulledAt: ago(2),
        lastSuccessfulPullAt: ago(30),
        lastError: "HTTP 500",
      }),
    ).toBe(NetworkControllerConnectionStatus.Failing);
  });

  test("an error left over from before the last read that worked is not a failure", () => {
    expect(
      health({
        lastPulledAt: ago(2),
        lastSuccessfulPullAt: ago(2),
        lastError: "an old error",
      }),
    ).toBe(NetworkControllerConnectionStatus.Healthy);
  });

  test("a read that worked is Healthy, and Partial when it worked in part", () => {
    expect(health({ lastPulledAt: ago(3), lastSuccessfulPullAt: ago(3) })).toBe(
      NetworkControllerConnectionStatus.Healthy,
    );
    expect(
      health({
        lastPulledAt: ago(3),
        lastSuccessfulPullAt: ago(3),
        lastReadStatus: "partial",
      }),
    ).toBe(NetworkControllerConnectionStatus.Partial);
  });

  test("no read working for longer than three intervals is Stale", () => {
    expect(
      health({ lastPulledAt: ago(29), lastSuccessfulPullAt: ago(29) }),
    ).toBe(NetworkControllerConnectionStatus.Healthy);
    expect(
      health({ lastPulledAt: ago(31), lastSuccessfulPullAt: ago(31) }),
    ).toBe(NetworkControllerConnectionStatus.Stale);
    expect(
      getNetworkControllerConnectionHealth(
        {
          isEnabled: true,
          lastPulledAt: ago(31),
          lastSuccessfulPullAt: ago(31),
          readIntervalInMinutes: 5,
        },
        NOW,
      ).since?.toISOString(),
    ).toBe(ago(31).toISOString());
  });

  test("an hourly connection is not stale after half an hour", () => {
    expect(getNetworkControllerStaleAfterMinutes(60)).toBe(190);
    expect(
      health({
        readIntervalInMinutes: 60,
        lastPulledAt: ago(65),
        lastSuccessfulPullAt: ago(65),
      }),
    ).toBe(NetworkControllerConnectionStatus.Healthy);
    expect(
      health({
        readIntervalInMinutes: 60,
        lastPulledAt: ago(191),
        lastSuccessfulPullAt: ago(191),
      }),
    ).toBe(NetworkControllerConnectionStatus.Stale);
  });

  test("dates arrive as text from the API and still count", () => {
    expect(
      health({
        lastPulledAt: ago(1).toISOString(),
        lastSuccessfulPullAt: ago(1).toISOString(),
      }),
    ).toBe(NetworkControllerConnectionStatus.Healthy);
    expect(health({ lastSuccessfulPullAt: "not a date" })).toBe(
      NetworkControllerConnectionStatus.Waiting,
    );
  });

  test("a bad interval still gives a threshold", () => {
    expect(getNetworkControllerStaleAfterMinutes(NaN)).toBe(30);
    expect(getNetworkControllerStaleAfterMinutes(-5)).toBe(30);
  });
});

describe("which statuses ask someone to act", () => {
  test("failing, stale and partial do; the rest do not", () => {
    expect(
      Object.values(NetworkControllerConnectionStatus).filter(
        (status: NetworkControllerConnectionStatus) => {
          return isNetworkControllerStatusAProblem(status);
        },
      ),
    ).toEqual([
      NetworkControllerConnectionStatus.Partial,
      NetworkControllerConnectionStatus.Failing,
      NetworkControllerConnectionStatus.Stale,
    ]);
  });
});
