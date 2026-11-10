import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { toStorableJson } from "../Database/PostgresStorableValue";
import MonitorRecordEvidence from "./MonitorRecordEvidence";

/*
 * AN INCOMING REQUEST MONITOR'S LATEST REQUEST, KEPT TWICE.
 *
 *   - Monitor.incomingMonitorRequestAsReceived: the request as it came -
 *     only the monitor's own key masked, at ingest - which the heartbeat job
 *     judges again (CheckHeartbeat): a filter on the body or on a header
 *     needs what the sender sent. No role reads it.
 *   - Monitor.incomingMonitorRequest: the copy everyone who can read the
 *     monitor reads - the overview, the API, MCP, Terraform, workflow and
 *     runbook steps - cut as the monitor's logs are, by its Keep request
 *     content switch (MonitorRecordEvidence.toStoredLatestRequest).
 *
 * Both are written in one statement for every request (toColumns), and the
 * readers' copy again when the switch is changed, or when the request was
 * kept once only, before the two were split (getReadersCopyRewrite).
 *
 * A server from before the split writes the readers' copy alone, and as it
 * came. One may still be serving while an upgrade runs, so the request to
 * judge is the newer of the two (getAsReceived), and a readers' copy with no
 * request beside it is a request as it came.
 * https://github.com/OneUptime/oneuptime/issues/6402
 */

// The two copies, as a monitor read with them holds them.
export type LatestIncomingRequestCopies = Pick<
  Monitor,
  "incomingMonitorRequest" | "incomingMonitorRequestAsReceived"
>;

export interface LatestIncomingRequestColumns {
  incomingMonitorRequest: IncomingMonitorRequest;
  incomingMonitorRequestAsReceived: IncomingMonitorRequest;
}

export interface ReadersCopyRewrite {
  data: LatestIncomingRequestColumns;
  // What the monitor held when it was read: it is written only if it still does.
  expectedData: {
    keepResponseContent: boolean;
    incomingMonitorRequest: IncomingMonitorRequest | null;
    incomingMonitorRequestAsReceived: IncomingMonitorRequest | null;
  };
}

type ToTimeFunction = (value: unknown) => number | null;

// A stored time - a date, or the text a jsonb copy keeps it as - in ms.
const toTime: ToTimeFunction = (value: unknown): number | null => {
  const time: number =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;

  return Number.isFinite(time) ? time : null;
};

export default class LatestIncomingRequest {
  /*
   * The columns a request that just came in is written to: storable copies,
   * as the live request is still being evaluated.
   */
  public static toColumns(input: {
    request: IncomingMonitorRequest;
    keepResponseContent: boolean;
  }): LatestIncomingRequestColumns {
    return {
      incomingMonitorRequest: MonitorRecordEvidence.toStoredLatestRequest({
        request: input.request,
        keepResponseContent: input.keepResponseContent,
      }),
      incomingMonitorRequestAsReceived: toStorableJson(
        input.request,
      ) as unknown as IncomingMonitorRequest,
    };
  }

  /*
   * The latest request as it came: the one the heartbeat judges. That is the
   * readers' copy when no request is kept beside it, or when it is the newer
   * of the two - a server from before the split wrote both of those.
   */
  public static getAsReceived(
    monitor: LatestIncomingRequestCopies,
  ): IncomingMonitorRequest | undefined {
    const asReceived: IncomingMonitorRequest | undefined =
      monitor.incomingMonitorRequestAsReceived || undefined;
    const readersCopy: IncomingMonitorRequest | undefined =
      monitor.incomingMonitorRequest || undefined;

    if (!readersCopy) {
      return asReceived;
    }

    if (!asReceived) {
      return readersCopy;
    }

    const readersCopyCheckedAt: number | null = toTime(readersCopy.checkedAt);
    const asReceivedCheckedAt: number | null = toTime(asReceived.checkedAt);

    if (
      readersCopyCheckedAt !== null &&
      asReceivedCheckedAt !== null &&
      readersCopyCheckedAt > asReceivedCheckedAt
    ) {
      return readersCopy;
    }

    return asReceived;
  }

  /*
   * Is the readers' copy the request as it came? It is while the request is
   * kept once only: written by a server from before the split, or not split
   * yet. The heartbeat job splits such a monitor (CheckHeartbeat).
   */
  public static isReadersCopyAsItCame(
    monitor: LatestIncomingRequestCopies,
  ): boolean {
    return (
      Boolean(monitor.incomingMonitorRequest) &&
      LatestIncomingRequest.getAsReceived(monitor) ===
        monitor.incomingMonitorRequest
    );
  }

  /*
   * Both columns written again from the request as it came, by the
   * monitor's switch as it was read: after the switch was changed, and for a
   * monitor whose request was kept once only. Null when there is no request
   * to write, or when the monitor was read without its switch.
   */
  public static getReadersCopyRewrite(
    monitor: LatestIncomingRequestCopies & Pick<Monitor, "keepResponseContent">,
  ): ReadersCopyRewrite | null {
    if (typeof monitor.keepResponseContent !== "boolean") {
      return null;
    }

    const request: IncomingMonitorRequest | undefined =
      LatestIncomingRequest.getAsReceived(monitor);

    if (!request) {
      return null;
    }

    return {
      data: LatestIncomingRequest.toColumns({
        request: request,
        keepResponseContent: monitor.keepResponseContent,
      }),
      expectedData: {
        keepResponseContent: monitor.keepResponseContent,
        incomingMonitorRequest: monitor.incomingMonitorRequest || null,
        incomingMonitorRequestAsReceived:
          monitor.incomingMonitorRequestAsReceived || null,
      },
    };
  }
}
