import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { jest } from "@jest/globals";

/*
 * How the incident and episode subscriber jobs send, as their tests see it.
 *
 * A job claims a Pending notification (SubscriberNotificationClaim: one
 * compareAndSetColumnsByIdWithoutHooks call moving it to InProgress), awaits
 * every message, and settles it through the service's updateOneById. These
 * helpers read those writes back in the order they were made, and stand in
 * for the ways a channel's sender reports a failure.
 */

function asMock(fn: unknown): jest.Mock {
  return fn as jest.Mock;
}

export interface StatusWrite {
  // "claim" for the Pending to InProgress claim, "update" for updateOneById.
  via: "claim" | "update";
  id: string;
  data: JSONObject;
  expectedData?: JSONObject | undefined;
}

/*
 * Every write the job made to its rows' status, claims included, in the order
 * it made them. `statusColumn` keeps only the writes that set it.
 */
export function statusWritesInOrder(data: {
  claim: unknown;
  update: unknown;
  statusColumn?: string | undefined;
  id?: ObjectID | string | undefined;
}): Array<StatusWrite> {
  const writes: Array<{ order: number; write: StatusWrite }> = [];

  const claim: jest.Mock = asMock(data.claim);
  claim.mock.calls.forEach((call: Array<unknown>, index: number): void => {
    const input: JSONObject = call[0] as JSONObject;
    writes.push({
      order: claim.mock.invocationCallOrder[index]!,
      write: {
        via: "claim",
        id: (input["id"] as ObjectID).toString(),
        data: input["data"] as JSONObject,
        expectedData: input["expectedData"] as JSONObject,
      },
    });
  });

  const update: jest.Mock = asMock(data.update);
  update.mock.calls.forEach((call: Array<unknown>, index: number): void => {
    const input: JSONObject = call[0] as JSONObject;
    writes.push({
      order: update.mock.invocationCallOrder[index]!,
      write: {
        via: "update",
        id: (input["id"] as ObjectID).toString(),
        data: input["data"] as JSONObject,
      },
    });
  });

  return writes
    .sort(
      (
        a: { order: number; write: StatusWrite },
        b: { order: number; write: StatusWrite },
      ): number => {
        return a.order - b.order;
      },
    )
    .map((entry: { order: number; write: StatusWrite }): StatusWrite => {
      return entry.write;
    })
    .filter((write: StatusWrite): boolean => {
      if (data.id && write.id !== data.id.toString()) {
        return false;
      }

      return !data.statusColumn || data.statusColumn in write.data;
    });
}

// The statuses a row went through, claims included, in order.
export function statusesInOrder(data: {
  claim: unknown;
  update: unknown;
  statusColumn: string;
  id?: ObjectID | string | undefined;
}): Array<StatusPageSubscriberNotificationStatus> {
  return statusWritesInOrder(data).map(
    (write: StatusWrite): StatusPageSubscriberNotificationStatus => {
      return write.data[
        data.statusColumn
      ] as StatusPageSubscriberNotificationStatus;
    },
  );
}

// The last write that set the status column: what the notification settled on.
export function settledWrite(data: {
  claim: unknown;
  update: unknown;
  statusColumn: string;
  id?: ObjectID | string | undefined;
}): JSONObject {
  const writes: Array<StatusWrite> = statusWritesInOrder(data);

  return writes[writes.length - 1]?.data || {};
}

// What a sender returns when the far end answers with an error.
export function httpError(
  statusCode: number = 500,
  message: string = "Internal Server Error",
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
}

/*
 * The ways a send fails. It throws an error (an unreachable host, a URL the
 * sender refuses); it answers with an HTTPErrorResponse (the Notification
 * service's email and SMS endpoints, and the Slack and webhook senders, do
 * that rather than throw); or it throws the HTTPErrorResponse itself (the
 * Microsoft Teams sender does).
 */
export type SendFailureKind =
  | "thrown error"
  | "returned HTTPErrorResponse"
  | "thrown HTTPErrorResponse";

export const SEND_FAILURE_KINDS: Array<SendFailureKind> = [
  "thrown error",
  "returned HTTPErrorResponse",
  "thrown HTTPErrorResponse",
];

// Make a mocked sender fail, the given way, on every call.
export function failSends(sender: unknown, kind: SendFailureKind): void {
  if (kind === "thrown error") {
    asMock(sender).mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.1:443") as never,
    );
    return;
  }

  if (kind === "thrown HTTPErrorResponse") {
    asMock(sender).mockRejectedValue(httpError(400, "Bad Request") as never);
    return;
  }

  asMock(sender).mockResolvedValue(httpError(502, "Bad Gateway") as never);
}

/*
 * A getSubscribersByStatusPage that pages as the real one does: rows in _id
 * order, after options.afterId, at most options.limit of them.
 */
export function pagedSubscribersFake(
  subscribers: () => Array<StatusPageSubscriber>,
): (
  statusPageId: unknown,
  props: unknown,
  options?: { afterId?: ObjectID | undefined; limit?: number | undefined },
) => Promise<Array<StatusPageSubscriber>> {
  return async (
    _statusPageId: unknown,
    _props: unknown,
    options?: { afterId?: ObjectID | undefined; limit?: number | undefined },
  ): Promise<Array<StatusPageSubscriber>> => {
    const sorted: Array<StatusPageSubscriber> = [...subscribers()].sort(
      (a: StatusPageSubscriber, b: StatusPageSubscriber): number => {
        return a._id! < b._id! ? -1 : a._id! > b._id! ? 1 : 0;
      },
    );

    const after: Array<StatusPageSubscriber> = options?.afterId
      ? sorted.filter((row: StatusPageSubscriber): boolean => {
          return row._id! > options.afterId!.toString();
        })
      : sorted;

    return after.slice(0, options?.limit ?? after.length);
  };
}

// A subscriber id that sorts by its number: 00000000-0000-4000-8000-00000000000n.
export function orderedSubscriberId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

/*
 * A clock for the send window and the run clock (both read Date.now()):
 * starts now, and moves only when told to. restore() puts Date.now back.
 */
export class TestClock {
  private nowInMs: number = Date.now();
  // Structurally typed: @jest/globals and @types/jest disagree on spy types.
  private readonly spy: { mockRestore: () => void };

  public constructor() {
    this.spy = jest.spyOn(Date, "now").mockImplementation((): number => {
      return this.nowInMs;
    });
  }

  public advanceBy(ms: number): void {
    this.nowInMs += ms;
  }

  public restore(): void {
    this.spy.mockRestore();
  }
}
