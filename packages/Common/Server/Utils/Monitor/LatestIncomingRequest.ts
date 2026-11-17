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
 * A server older than 14.0.106 wrote the readers' copy alone, and as it
 * came. None runs beside a server of 16 or later: a major is upgraded to
 * from the one before it, and every server since 14.0.106 writes both. So
 * the heartbeat reads the request as it came alone, and splits nothing
 * (#8906). A request kept once that is not split yet is split by the
 * Workers data migration RedactLatestIncomingRequests, or when its switch
 * is changed: both take the readers' copy for the request as it came while
 * nothing is kept beside it (getAsReceived).
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
   * The latest request as it came, which a rewrite of the two copies starts
   * from: the request kept beside the readers' copy, or - while nothing is
   * kept beside it - the readers' copy itself. Only a server older than
   * 14.0.106 left a request so, kept once and as it came:
   * RedactLatestIncomingRequests splits each such monitor through this
   * fallback, which stays for as long as that migration is registered (the
   * two go together). Every server since cuts the readers' copy as it writes
   * the request beside it, so that copy is never taken over the request,
   * whatever time it says it came at; the heartbeat reads the request as it
   * came alone (CheckHeartbeat, #8906).
   */
  public static getAsReceived(
    monitor: LatestIncomingRequestCopies,
  ): IncomingMonitorRequest | undefined {
    return (
      monitor.incomingMonitorRequestAsReceived ||
      monitor.incomingMonitorRequest ||
      undefined
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
