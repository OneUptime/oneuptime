import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import {
  GoogleSecOpsRunResult,
  GoogleSecOpsRunType,
  GoogleSecOpsDetectionSample,
} from "Common/Types/SecurityEvent/GoogleSecOpsDiagnostics";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

export const googleSecOpsRunLabels: Record<GoogleSecOpsRunType, string> = {
  test: "Test connection",
  poll: "Poll",
  preview: "Preview",
  backfill: "Historical import",
};

export function readGoogleSecOpsResult(
  value: JSONObject | undefined,
): GoogleSecOpsRunResult | null {
  if (!value || !value["status"] || !value["type"]) {
    return null;
  }

  return value as unknown as GoogleSecOpsRunResult;
}

export function formatGoogleSecOpsDate(
  value: string | Date | undefined,
): string {
  if (!value) {
    return "Never";
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

export function googleSecOpsNextPoll(
  connection: GoogleSecOpsConnection,
): Date | null {
  if (!connection.isEnabled || !connection.lastPolledAt) {
    return null;
  }

  return new Date(
    new Date(connection.lastPolledAt).getTime() +
      Math.max(1, connection.pollIntervalInMinutes || 5) * 60_000,
  );
}

export function googleSecOpsHealth(
  connection: GoogleSecOpsConnection,
  now: number = Date.now(),
): string {
  if (!connection.isEnabled) {
    return "Schedule paused";
  }

  const due: Date | null = googleSecOpsNextPoll(connection);
  // The scheduler ticks once a minute; allow two ticks before calling it overdue.
  if (
    (due && now > due.getTime() + 120_000) ||
    (!connection.lastPolledAt &&
      connection.createdAt &&
      now > new Date(connection.createdAt).getTime() + 120_000)
  ) {
    return "Poll overdue";
  }

  const result: GoogleSecOpsRunResult | null = readGoogleSecOpsResult(
    connection.lastPollResult,
  );

  if (result?.status === "partial") {
    return "Partial import";
  }
  if (result?.status === "failed" || connection.lastError) {
    return "Last poll failed";
  }
  if (
    result?.complete &&
    new Date(result.startedAt).getTime() -
      new Date(result.windowEnd).getTime() >
      (Math.max(1, connection.pollIntervalInMinutes || 5) + 2) * 60_000
  ) {
    return "Catching up";
  }
  if (result?.status === "empty") {
    return "No detections returned";
  }
  if (result?.status === "success") {
    return "Last poll succeeded";
  }
  return connection.lastPolledAt
    ? "Details unavailable"
    : "Waiting for first poll";
}

export function validateGoogleSecOpsRange(
  startTime: string,
  endTime: string,
  now: number = Date.now(),
): string | null {
  const start: number = new Date(startTime).getTime();
  const end: number = new Date(endTime).getTime();

  if (
    !startTime ||
    !endTime ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return "Choose a valid start and end time.";
  }
  if (start >= end) {
    return "The start time must be before the end time.";
  }
  if (end > now) {
    return "The end time must not be in the future.";
  }
  if (end - start > 7 * 24 * 60 * 60_000) {
    return "Choose a time range of 7 days or less.";
  }
  return null;
}

export function googleSecOpsEventsRoute(
  result: GoogleSecOpsRunResult,
  connectionId?: string,
): Route {
  const sampleTimes: Array<number> = result.samples
    .map((sample: GoogleSecOpsDetectionSample): number => {
      return new Date(
        sample.detectionTime || sample.createdTime || "",
      ).getTime();
    })
    .filter(Number.isFinite);
  const start: Date = new Date(
    result.eventTimeStart ||
      (sampleTimes.length ? Math.min(...sampleTimes) : result.windowStart),
  );
  const end: Date = new Date(
    result.eventTimeEnd ||
      (sampleTimes.length ? Math.max(...sampleTimes) : result.windowEnd),
  );

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS] as Route,
  ).addQueryParams(
    TableFilterUrlState.getLinkQueryParams("security-events-table", {
      filter: {
        time: new InBetween(
          new Date(start.getTime() - 1000),
          new Date(end.getTime() + 1000),
        ),
        className: "Detection Finding",
        ...(connectionId && result.ingestedCount > 0
          ? {
              attributes: {
                "oneuptime.google_secops.connection_id": connectionId,
              },
            }
          : {}),
      },
    }),
  );
}
