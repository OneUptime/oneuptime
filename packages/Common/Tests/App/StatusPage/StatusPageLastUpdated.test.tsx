import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * react-i18next is not initialized in the test environment. Echo the default
 * value and interpolate, so the assertions below are about the sentence the
 * component builds rather than about a translation file.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (
          key: string,
          opts?: { defaultValue?: string } & Record<string, unknown>,
        ): string => {
          let out: string = opts?.defaultValue ?? key;

          for (const name of Object.keys(opts || {})) {
            out = out
              .split(`{{${name}}}`)
              .join(String((opts as Record<string, unknown>)[name]));
          }

          return out;
        },
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

import LastUpdated from "../../../../App/FeatureSet/StatusPage/src/Components/LiveStatus/LastUpdated";

/*
 * Contract under test - the line that says how old the page is.
 *
 * A status page is read during an outage, often from a tab that has been open
 * a while. Without this line there is no way to tell a page that says
 * "operational" because everything recovered from one that says it because it
 * was loaded before anything broke. So: the sentence has to age on its own
 * while the page sits still, the refresh control has to be honest about
 * whether it is working, and a refresh that failed has to say so instead of
 * silently leaving stale data behind a confident timestamp.
 */

function text(): string {
  return screen.getByTestId("status-page-last-updated-text").textContent || "";
}

describe("LastUpdated", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-03T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a page just loaded says it is current", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T12:00:00.000Z")}
        isRefreshing={false}
        onRefreshClick={() => {}}
      />,
    );

    expect(text()).toBe("Updated now");
  });

  test("an older page says how old it is", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T11:58:00.000Z")}
        isRefreshing={false}
        onRefreshClick={() => {}}
      />,
    );

    expect(text()).toBe("Updated 2 minutes ago");
  });

  /*
   * The whole point. A page nobody touches has to get visibly older, or the
   * timestamp is just as misleading as no timestamp.
   */
  test("the sentence ages while the page sits still", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T12:00:00.000Z")}
        isRefreshing={false}
        onRefreshClick={() => {}}
      />,
    );

    expect(text()).toBe("Updated now");

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(text()).toBe("Updated 1 minute ago");

    act(() => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(text()).toBe("Updated 1 hour ago");
  });

  test("its timer is cleaned up when it goes away", () => {
    const { unmount } = render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T12:00:00.000Z")}
        isRefreshing={false}
        onRefreshClick={() => {}}
      />,
    );

    expect(jest.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });

  /*
   * Deliberately not a live region: it changes every ten seconds, and a
   * screen reader reading the age of the page over and over would make the
   * page unusable. The status itself is the live region.
   */
  test("the timestamp does not announce itself over and over", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T12:00:00.000Z")}
        isRefreshing={false}
        onRefreshClick={() => {}}
      />,
    );

    const container: HTMLElement = screen.getByTestId(
      "status-page-last-updated",
    );

    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});

describe("LastUpdated - the refresh control", () => {
  test("pressing it asks for a refresh", () => {
    const onRefreshClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <LastUpdated
        lastRefreshedAt={new Date()}
        isRefreshing={false}
        onRefreshClick={onRefreshClick}
      />,
    );

    fireEvent.click(screen.getByTestId("status-page-refresh-button"));

    expect(onRefreshClick).toHaveBeenCalledTimes(1);
  });

  test("it says so, and locks, while a refresh is in flight", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date()}
        isRefreshing={true}
        onRefreshClick={() => {}}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      "status-page-refresh-button",
    );

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Refreshing");
  });

  test("a locked control cannot fire a second request", () => {
    const onRefreshClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <LastUpdated
        lastRefreshedAt={new Date()}
        isRefreshing={true}
        onRefreshClick={onRefreshClick}
      />,
    );

    fireEvent.click(screen.getByTestId("status-page-refresh-button"));

    expect(onRefreshClick).not.toHaveBeenCalled();
  });
});

describe("LastUpdated - a refresh that failed", () => {
  /*
   * The failure mode this guards against is the quiet one: a background
   * refresh fails, the page keeps showing a confident timestamp, and the
   * visitor believes a status that is now half an hour old.
   */
  test("says the page is stale rather than showing a confident timestamp", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date("2026-03-03T11:00:00.000Z")}
        isRefreshing={false}
        refreshError="Network request failed"
        onRefreshClick={() => {}}
      />,
    );

    expect(text()).toBe("Could not refresh. Showing the last known status.");
    expect(text()).not.toContain("Updated");
  });

  test("the refresh control is still offered so the visitor can retry", () => {
    const onRefreshClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <LastUpdated
        lastRefreshedAt={new Date()}
        isRefreshing={false}
        refreshError="Network request failed"
        onRefreshClick={onRefreshClick}
      />,
    );

    fireEvent.click(screen.getByTestId("status-page-refresh-button"));

    expect(onRefreshClick).toHaveBeenCalledTimes(1);
  });

  test("an empty error is not an error", () => {
    render(
      <LastUpdated
        lastRefreshedAt={new Date()}
        isRefreshing={false}
        refreshError={null}
        onRefreshClick={() => {}}
      />,
    );

    expect(text()).toContain("Updated");
  });
});
