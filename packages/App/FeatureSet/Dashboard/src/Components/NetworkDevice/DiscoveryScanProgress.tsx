import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveryScanStatus,
  DISCOVERY_SCAN_STARTED_MESSAGE,
} from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface ComponentProps {
  scan: NetworkDeviceDiscoveryScan;
}

/**
 * A recurring scan retains the preceding result until its first report.
 * The claim marker separates that snapshot from this run's real progress.
 */
export function isWaitingForDiscoveryProgress(
  scan: NetworkDeviceDiscoveryScan | null,
): boolean {
  return (
    scan?.status === DiscoveryScanStatus.InProgress &&
    scan.statusMessage === DISCOVERY_SCAN_STARTED_MESSAGE
  );
}

function timestamp(value: Date | undefined): number | null {
  if (!value) {
    return null;
  }

  const milliseconds: number = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function formatDiscoveryDuration(milliseconds: number): string {
  const seconds: number = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const DiscoveryScanProgress: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const scan: NetworkDeviceDiscoveryScan = props.scan;
  const [now, setNow] = useState<number>(Date.now());
  const isRunning: boolean = scan.status === DiscoveryScanStatus.InProgress;
  const isPending: boolean =
    !scan.status || scan.status === DiscoveryScanStatus.Pending;
  const isCompleted: boolean = scan.status === DiscoveryScanStatus.Completed;
  const isFailed: boolean = scan.status === DiscoveryScanStatus.Failed;

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    setNow(Date.now());
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [isRunning, scan.startedAt]);

  const total: number = ScanTargetUtil.countHosts(scan.cidr || "");
  const hasCount: boolean =
    !isPending &&
    !isWaitingForDiscoveryProgress(scan) &&
    typeof scan.scannedHostCount === "number" &&
    Number.isFinite(scan.scannedHostCount) &&
    scan.scannedHostCount >= 0;
  const covered: number = hasCount ? Math.floor(scan.scannedHostCount!) : 0;
  const percentage: number | undefined =
    hasCount && total > 0
      ? Math.min(100, Math.floor((covered / total) * 100))
      : undefined;
  const isFinalizing: boolean = isRunning && percentage === 100;
  const label: string = isPending
    ? "Queued"
    : isFinalizing
      ? "Final checks"
      : isRunning
        ? "Scanning"
        : scan.status || "Unknown";
  const colors: string = isRunning
    ? "bg-blue-50 text-blue-700 ring-blue-200"
    : isCompleted
      ? "bg-green-50 text-green-700 ring-green-200"
      : isFailed
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-gray-50 text-gray-700 ring-gray-200";
  const countLabel: string = hasCount
    ? total > 0
      ? `${covered.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} addresses swept`
      : `${covered.toLocaleString("en-US")} addresses swept`
    : isPending
      ? total > 0
        ? `${total.toLocaleString("en-US")} addresses queued`
        : "Waiting for the probe"
      : "Waiting for the first progress update";
  const startedAt: number | null = timestamp(scan.startedAt);
  const completedAt: number | null = timestamp(scan.completedAt);
  const end: number | null = isRunning ? now : completedAt;
  const duration: string | null =
    !isPending && startedAt !== null && end !== null && end >= startedAt
      ? `${isRunning ? "Running for" : isFailed ? "Stopped after" : "Finished in"} ${formatDiscoveryDuration(end - startedAt)}`
      : null;

  return (
    <div className="min-w-52 max-w-xs space-y-2 whitespace-normal">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${colors}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-blue-500 motion-safe:animate-pulse" : isCompleted ? "bg-green-500" : isFailed ? "bg-red-500" : "bg-gray-400"}`}
          />
          {label}
        </span>
        {isRunning && percentage !== undefined && (
          <span className="text-xs font-medium tabular-nums text-blue-700">
            {percentage}%
          </span>
        )}
      </div>
      {isRunning && (
        <div
          role="progressbar"
          aria-label={`${ScanNameUtil.getScanLabel(scan) || "Discovery scan"} address sweep progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          aria-valuetext={
            isFinalizing
              ? `${countLabel}. Final checks are still running.`
              : countLabel
          }
          className="h-1.5 overflow-hidden rounded-full bg-blue-100"
        >
          <div
            className={`h-full rounded-full bg-blue-600 ${percentage === undefined ? "motion-safe:animate-pulse" : "motion-safe:transition-all"}`}
            style={{
              width: percentage === undefined ? "33%" : `${percentage}%`,
            }}
          />
        </div>
      )}
      {(hasCount || isRunning || isPending) && (
        <p className="text-xs leading-5 text-gray-600 tabular-nums">
          {countLabel}
        </p>
      )}
      {isPending && total > 0 && (
        <p className="text-xs text-gray-500">Waiting for the probe to start.</p>
      )}
      {isFinalizing && (
        <p className="text-xs text-blue-700">
          Address sweep complete. Finishing discovery checks.
        </p>
      )}
      {duration && (
        <p
          className="text-xs text-gray-500 tabular-nums"
          title={
            startedAt !== null
              ? `Started ${new Date(startedAt).toLocaleString()}`
              : undefined
          }
        >
          {duration}
        </p>
      )}
      {isFailed && hasCount && (
        <p className="text-xs text-red-700">
          This run stopped before discovery completed.
        </p>
      )}
    </div>
  );
};

export default DiscoveryScanProgress;
