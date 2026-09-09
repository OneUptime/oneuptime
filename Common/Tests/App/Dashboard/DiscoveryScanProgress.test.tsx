import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import DiscoveryScanProgress, {
  formatDiscoveryDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanProgress";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";

function scan(
  overrides: Partial<NetworkDeviceDiscoveryScan> = {},
): NetworkDeviceDiscoveryScan {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      name: "Core switches",
      cidr: "10.240-249.0-255.220-225",
      status: "In Progress",
      startedAt: new Date("2026-09-09T12:00:00Z"),
      scannedHostCount: 1024,
      respondedHostCount: 0,
    },
    overrides,
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-09-09T12:02:10Z"));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Discovery scan progress", () => {
  test("shows completed addresses even when no host has responded", () => {
    render(<DiscoveryScanProgress scan={scan()} />);
    const bar: HTMLElement = screen.getByRole("progressbar", {
      name: /Core switches .*address sweep progress/,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "6");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(
      screen.getByText("1,024 of 15,360 addresses swept"),
    ).toBeInTheDocument();
    expect(screen.getByText("Running for 2m 10s")).toBeInTheDocument();
  });

  test("elapsed time keeps moving between progress reports and stops when complete", () => {
    const { rerender } = render(<DiscoveryScanProgress scan={scan()} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Running for 2m 15s")).toBeInTheDocument();
    rerender(
      <DiscoveryScanProgress
        scan={scan({
          status: "Completed",
          completedAt: new Date("2026-09-09T12:02:14Z"),
        })}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(screen.getByText("Finished in 2m 14s")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  test("a just-started or older probe gets an indeterminate bar, not invented progress", () => {
    render(
      <DiscoveryScanProgress
        scan={scan({
          scannedHostCount: undefined,
          respondedHostCount: undefined,
        })}
      />,
    );
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(
      screen.getByText("Waiting for the first progress update"),
    ).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  test("a newly claimed recurrence waits for this run's progress instead of showing old 100% coverage", () => {
    const { rerender } = render(
      <DiscoveryScanProgress
        scan={scan({
          scannedHostCount: 15360,
          statusMessage: "Scan started. Waiting for the first progress update.",
        })}
      />,
    );
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.queryByText("Final checks")).not.toBeInTheDocument();
    rerender(
      <DiscoveryScanProgress
        scan={scan({
          scannedHostCount: 256,
          statusMessage: "Scan in progress: checking ping reachability.",
        })}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  test("zero reported addresses is real zero progress", () => {
    render(<DiscoveryScanProgress scan={scan({ scannedHostCount: 0 })} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByText("0 of 15,360 addresses swept")).toBeInTheDocument();
  });

  test.each([15360, 20000])(
    "reaching %s addresses keeps final checks visibly running",
    (count: number) => {
      render(
        <DiscoveryScanProgress scan={scan({ scannedHostCount: count })} />,
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "100",
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuetext",
        expect.stringContaining("Final checks are still running"),
      );
      expect(screen.getByText("Final checks")).toBeInTheDocument();
      expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    },
  );

  test.each([
    undefined,
    null,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1024",
  ])(
    "invalid or missing count %s never becomes a percentage",
    (count: unknown) => {
      render(
        <DiscoveryScanProgress
          scan={scan({
            scannedHostCount: count,
          } as Partial<NetworkDeviceDiscoveryScan>)}
        />,
      );
      expect(screen.getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
      );
      expect(
        screen.queryByText(/NaN|Infinity|undefined|null/),
      ).not.toBeInTheDocument();
    },
  );

  test("an unknown target still reports a known address count without a denominator", () => {
    render(<DiscoveryScanProgress scan={scan({ cidr: "not-a-target" })} />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.getByText("1,024 addresses swept")).toBeInTheDocument();
  });

  test("CIDR totals use the same usable-address rules as the scanner", () => {
    render(
      <DiscoveryScanProgress
        scan={scan({ cidr: "10.0.0.0/24", scannedHostCount: 127 })}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByText("127 of 254 addresses swept")).toBeInTheDocument();
  });

  test("a queued recurrence never shows the preceding run's counts or duration", () => {
    render(
      <DiscoveryScanProgress
        scan={scan({
          status: "Pending",
          completedAt: new Date("2026-09-09T12:01:00Z"),
          scannedHostCount: 15360,
        })}
      />,
    );
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("15,360 addresses queued")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Running for|Finished in|addresses swept/),
    ).not.toBeInTheDocument();
  });

  test("failure preserves partial coverage and a stopped duration without implying completion", () => {
    render(
      <DiscoveryScanProgress
        scan={scan({
          status: "Failed",
          completedAt: new Date("2026-09-09T12:01:45Z"),
        })}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText("1,024 of 15,360 addresses swept"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stopped after 1m 45s")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  test.each([undefined, new Date("invalid"), new Date("2026-09-09T13:00:00Z")])(
    "missing, invalid and future start dates never invent an elapsed duration",
    (startedAt: Date | undefined) => {
      render(<DiscoveryScanProgress scan={scan({ startedAt })} />);
      expect(screen.queryByText(/Running for/)).not.toBeInTheDocument();
    },
  );

  test("an old completed row needs no timestamps or progress fields to render", () => {
    render(
      <DiscoveryScanProgress
        scan={scan({
          status: "Completed",
          startedAt: undefined,
          scannedHostCount: undefined,
        })}
      />,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(
      screen.queryByText(/Waiting for|Finished in/),
    ).not.toBeInTheDocument();
  });

  test.each([
    [0, "0s"],
    [59000, "59s"],
    [61000, "1m 1s"],
    [7200000, "2h 0m"],
    [90061000, "25h 1m"],
  ])(
    "formats %s milliseconds as %s",
    (milliseconds: number | string, expected: number | string) => {
      expect(formatDiscoveryDuration(Number(milliseconds))).toBe(expected);
    },
  );
});
