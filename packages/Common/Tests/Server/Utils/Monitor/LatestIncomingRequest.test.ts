import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
  ReadersCopyRewrite,
} from "../../../../Server/Utils/Monitor/LatestIncomingRequest";
import MonitorRecordEvidence from "../../../../Server/Utils/Monitor/MonitorRecordEvidence";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * AN INCOMING REQUEST MONITOR'S LATEST REQUEST, KEPT TWICE (#6402).
 *
 * The heartbeat job judges the latest request again, so it is kept as it
 * came (Monitor.incomingMonitorRequestAsReceived), where no role reads it.
 * Everyone who can read the monitor - Viewer included - reads the copy
 * beside it (Monitor.incomingMonitorRequest), cut as the monitor's logs are,
 * by its Keep request content switch. The rules themselves are pinned with
 * every other copy of a check in MonitorCheckCopiesRedaction.test.ts; here,
 * which copy is which, and which request a rewrite of the two starts from.
 * The heartbeat reads the request as it came alone (#8906), which App's
 * CheckHeartbeat.test.ts pins.
 */

const REDACTED: string = "[REDACTED]";

const PROJECT_ID: ObjectID = new ObjectID(
  "6402aaaa-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "6402aaaa-0000-4000-8000-000000000002",
);

const RECEIVED_AT: string = "2026-11-10T08:00:00.000Z";
const CHECKED_AT: string = "2026-11-10T08:00:01.000Z";

// A deploy hook, as an Incoming Request monitor receives it.
function deployHook(
  extra: Partial<IncomingMonitorRequest> = {},
): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestMethod: "POST",
    requestHeaders: {
      "content-type": "application/json",
      authorization: "Bearer example-live-token-7f3a9c2b",
      "x-request-id": "req-7f3a",
    },
    requestBody: {
      status: "deployed",
      service: "checkout",
      deployer: { name: "Jane Doe", email: "jane@acme.example" },
      apiKey: "ak_live_88c1",
    },
    incomingRequestReceivedAt: new Date(RECEIVED_AT),
    checkedAt: new Date(CHECKED_AT),
    onlyCheckForIncomingRequestReceivedAt: false,
    ...extra,
  } as unknown as IncomingMonitorRequest;
}

// A request as a jsonb column hands it back: ids and times as JSON writes them.
function stored(request: IncomingMonitorRequest): IncomingMonitorRequest {
  return JSON.parse(JSON.stringify(request)) as IncomingMonitorRequest;
}

function asJson(value: unknown): JSONObject {
  return value as JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LatestIncomingRequest.toColumns: the two copies a request is written to", () => {
  test("the request as it came keeps every header and the whole body: the heartbeat judges them", () => {
    const columns: LatestIncomingRequestColumns =
      LatestIncomingRequest.toColumns({
        request: deployHook(),
        keepResponseContent: true,
      });

    expect(columns.incomingMonitorRequestAsReceived).toEqual(
      stored(deployHook()),
    );
  });

  test("the copy people read is cut as the monitor's logs are: a credential's header and fields masked", () => {
    const readers: JSONObject = asJson(
      LatestIncomingRequest.toColumns({
        request: deployHook(),
        keepResponseContent: true,
      }).incomingMonitorRequest,
    );

    expect(readers["requestHeaders"]).toEqual({
      "content-type": "application/json",
      authorization: REDACTED,
      "x-request-id": "req-7f3a",
    });
    expect(readers["requestBody"]).toEqual({
      status: "deployed",
      service: "checkout",
      deployer: { name: "Jane Doe", email: REDACTED },
      apiKey: REDACTED,
    });
    expect(readers["isResponseContentOmitted"]).toBeUndefined();

    const text: string = JSON.stringify(readers);

    expect(text).not.toContain("example-live-token-7f3a9c2b");
    expect(text).not.toContain("ak_live_88c1");
    expect(text).not.toContain("jane@acme.example");
  });

  test("the copy people read keeps when, how and from whom the request came", () => {
    const readers: JSONObject = asJson(
      LatestIncomingRequest.toColumns({
        request: deployHook(),
        keepResponseContent: false,
      }).incomingMonitorRequest,
    );

    expect(readers["incomingRequestReceivedAt"]).toBe(RECEIVED_AT);
    expect(readers["checkedAt"]).toBe(CHECKED_AT);
    expect(readers["requestMethod"]).toBe("POST");
    expect(readers["monitorId"]).toEqual({
      _type: "ObjectID",
      value: MONITOR_ID.toString(),
    });
    expect(readers["projectId"]).toEqual({
      _type: "ObjectID",
      value: PROJECT_ID.toString(),
    });
  });

  test("a monitor that keeps no request content: the copy people read has no headers and no body, and says so; the request as it came keeps both", () => {
    const columns: LatestIncomingRequestColumns =
      LatestIncomingRequest.toColumns({
        request: deployHook(),
        keepResponseContent: false,
      });
    const readers: JSONObject = asJson(columns.incomingMonitorRequest);

    expect(readers["requestHeaders"]).toBeUndefined();
    expect(readers["requestBody"]).toBeUndefined();
    expect(readers["isResponseContentOmitted"]).toBe(true);

    expect(columns.incomingMonitorRequestAsReceived.requestHeaders).toEqual(
      deployHook().requestHeaders,
    );
    expect(columns.incomingMonitorRequestAsReceived.requestBody).toEqual(
      deployHook().requestBody,
    );
    expect(
      columns.incomingMonitorRequestAsReceived.isResponseContentOmitted,
    ).toBeUndefined();
  });

  test("the copy people read goes through the one redaction every copy of a check goes through", () => {
    const redactCheck: SpyInstance<typeof MonitorRecordEvidence.redactCheck> =
      jest.spyOn(MonitorRecordEvidence, "redactCheck");

    const request: IncomingMonitorRequest = deployHook();

    LatestIncomingRequest.toColumns({
      request: request,
      keepResponseContent: false,
    });

    expect(redactCheck).toHaveBeenCalledTimes(1);
    expect(redactCheck).toHaveBeenCalledWith({
      check: request,
      keepResponseContent: false,
      monitorStep: undefined,
    });
  });

  test("both copies are storable: a NUL in the body becomes U+FFFD in each, so Postgres takes the write", () => {
    const columns: LatestIncomingRequestColumns =
      LatestIncomingRequest.toColumns({
        request: deployHook({ requestBody: "PK\u0003\u0004\u0000\u0000 ok" }),
        keepResponseContent: true,
      });

    expect(columns.incomingMonitorRequestAsReceived.requestBody).toBe(
      "PK\u0003\u0004�� ok",
    );
    expect(asJson(columns.incomingMonitorRequest)["requestBody"]).toBe(
      "PK\u0003\u0004�� ok",
    );
  });

  test("never changes the request it was handed: the evaluator is still reading it", () => {
    const request: IncomingMonitorRequest = deployHook();
    const before: string = JSON.stringify(request);

    LatestIncomingRequest.toColumns({
      request: request,
      keepResponseContent: false,
    });

    expect(JSON.stringify(request)).toBe(before);
    expect(request.isResponseContentOmitted).toBeUndefined();
  });
});

/*
 * The request a rewrite of the two copies starts from: the switch's, and
 * RedactLatestIncomingRequests' split of a request a server older than
 * 14.0.106 kept once, in the copy people read, as it came. That fallback
 * stays while the migration is registered (App's
 * RedactLatestIncomingRequests.test.ts holds the two together). The
 * heartbeat no longer asks: it reads the request as it came alone (#8906).
 */
describe("LatestIncomingRequest.getAsReceived: the request a rewrite starts from", () => {
  const asReceived: IncomingMonitorRequest = stored(deployHook());

  // The copy people read, as the same request wrote it.
  const readersCopy: IncomingMonitorRequest = LatestIncomingRequest.toColumns({
    request: deployHook(),
    keepResponseContent: false,
  }).incomingMonitorRequest;

  test("a split request: the one as it came, never the copy people read", () => {
    expect(
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequest: readersCopy,
        incomingMonitorRequestAsReceived: asReceived,
      }),
    ).toBe(asReceived);
  });

  test("a request kept once, before the split: the copy, which is the request as it came", () => {
    const keptOnce: IncomingMonitorRequest = stored(deployHook());

    expect(
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequest: keptOnce,
      }),
    ).toBe(keptOnce);
  });

  test("a request kept once, read as Postgres hands back the column that holds nothing beside it: the copy", () => {
    const keptOnce: IncomingMonitorRequest = stored(deployHook());

    expect(
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequest: keptOnce,
        incomingMonitorRequestAsReceived:
          null as unknown as IncomingMonitorRequest,
      }),
    ).toBe(keptOnce);
  });

  /*
   * Every server since 14.0.106 writes both copies in one statement, so a
   * copy no longer comes later than the request beside it; and a copy that
   * says so is cut, so it is never taken for the request as it came.
   */
  test("a copy that says it came later than the request beside it is not taken: the request is", () => {
    const saysLater: IncomingMonitorRequest = stored(
      deployHook({
        checkedAt: new Date("2026-11-10T08:05:00.000Z"),
        incomingRequestReceivedAt: new Date("2026-11-10T08:04:59.000Z"),
        requestBody: { status: "failed" },
      }),
    );

    expect(
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequest: saysLater,
        incomingMonitorRequestAsReceived: asReceived,
      }),
    ).toBe(asReceived);
  });

  test.each([
    ["later, as a date", new Date("2026-11-10T09:00:00.000Z")],
    ["later, as the text jsonb keeps", "2026-11-10T09:00:00.000Z"],
    ["earlier", "2026-11-10T07:00:00.000Z"],
    ["unreadable", "not a time"],
    ["missing", undefined],
  ])(
    "whatever time the copy says - %s - the request as it came",
    (_which: string, copyTime: unknown) => {
      const copy: IncomingMonitorRequest = {
        ...stored(deployHook()),
        checkedAt: copyTime as Date,
      };

      expect(
        LatestIncomingRequest.getAsReceived({
          incomingMonitorRequest: copy,
          incomingMonitorRequestAsReceived: asReceived,
        }),
      ).toBe(asReceived);
    },
  );

  test("no request yet: none, so a rewrite writes nothing", () => {
    expect(LatestIncomingRequest.getAsReceived({})).toBeUndefined();
    expect(
      // As Postgres hands back a column that holds nothing.
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequest: null as unknown as IncomingMonitorRequest,
        incomingMonitorRequestAsReceived:
          null as unknown as IncomingMonitorRequest,
      }),
    ).toBeUndefined();
  });

  test("the request as it came alone: that one", () => {
    expect(
      LatestIncomingRequest.getAsReceived({
        incomingMonitorRequestAsReceived: asReceived,
      }),
    ).toBe(asReceived);
  });
});

describe("LatestIncomingRequest.getReadersCopyRewrite: both copies written again, by the switch as read", () => {
  function monitorWith(
    values: Partial<
      Pick<
        Monitor,
        | "keepResponseContent"
        | "incomingMonitorRequest"
        | "incomingMonitorRequestAsReceived"
      >
    >,
  ): Monitor {
    const monitor: Monitor = new Monitor();
    Object.assign(monitor, values);
    return monitor;
  }

  test("switched off: the copy people read loses the headers and the body, the request as it came keeps them", () => {
    const asReceived: IncomingMonitorRequest = stored(deployHook());
    const readersCopy: IncomingMonitorRequest = LatestIncomingRequest.toColumns(
      { request: deployHook(), keepResponseContent: true },
    ).incomingMonitorRequest;

    const rewrite: ReadersCopyRewrite | null =
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({
          keepResponseContent: false,
          incomingMonitorRequest: readersCopy,
          incomingMonitorRequestAsReceived: asReceived,
        }),
      );

    expect(rewrite).not.toBeNull();
    expect(asJson(rewrite!.data.incomingMonitorRequest)).toEqual({
      ...asJson(readersCopy),
      requestHeaders: undefined,
      requestBody: undefined,
      isResponseContentOmitted: true,
    });
    expect(rewrite!.data.incomingMonitorRequestAsReceived).toEqual(asReceived);
  });

  test("switched back on: the content comes back, masked, from the request as it came", () => {
    const asReceived: IncomingMonitorRequest = stored(deployHook());
    const omitted: IncomingMonitorRequest = LatestIncomingRequest.toColumns({
      request: deployHook(),
      keepResponseContent: false,
    }).incomingMonitorRequest;

    const rewrite: ReadersCopyRewrite | null =
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({
          keepResponseContent: true,
          incomingMonitorRequest: omitted,
          incomingMonitorRequestAsReceived: asReceived,
        }),
      );

    const readers: JSONObject = asJson(rewrite!.data.incomingMonitorRequest);

    expect(readers["isResponseContentOmitted"]).toBeUndefined();
    expect(readers["requestHeaders"]).toEqual({
      "content-type": "application/json",
      authorization: REDACTED,
      "x-request-id": "req-7f3a",
    });
    expect(asJson(readers["requestBody"])["status"]).toBe("deployed");
    expect(asJson(readers["requestBody"])["apiKey"]).toBe(REDACTED);
  });

  test("written only while the monitor holds what was read: its switch and both copies", () => {
    const asReceived: IncomingMonitorRequest = stored(deployHook());
    const readersCopy: IncomingMonitorRequest = LatestIncomingRequest.toColumns(
      { request: deployHook(), keepResponseContent: true },
    ).incomingMonitorRequest;

    const rewrite: ReadersCopyRewrite | null =
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({
          keepResponseContent: false,
          incomingMonitorRequest: readersCopy,
          incomingMonitorRequestAsReceived: asReceived,
        }),
      );

    expect(rewrite!.expectedData).toEqual({
      keepResponseContent: false,
      incomingMonitorRequest: readersCopy,
      incomingMonitorRequestAsReceived: asReceived,
    });
  });

  test("a request kept once, as it came: it moves beside the copy, and the copy is cut", () => {
    const keptOnce: IncomingMonitorRequest = stored(deployHook());

    const rewrite: ReadersCopyRewrite | null =
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({
          keepResponseContent: true,
          incomingMonitorRequest: keptOnce,
        }),
      );

    expect(rewrite!.data.incomingMonitorRequestAsReceived).toEqual(keptOnce);
    expect(
      asJson(asJson(rewrite!.data.incomingMonitorRequest)["requestHeaders"])[
        "authorization"
      ],
    ).toBe(REDACTED);
    // Expected as read: no request beside it yet.
    expect(rewrite!.expectedData.incomingMonitorRequestAsReceived).toBeNull();
    expect(rewrite!.expectedData.incomingMonitorRequest).toBe(keptOnce);
  });

  /*
   * No server writes the copy alone any more, so a copy is never the
   * request to keep while one is kept beside it: a copy that says it came
   * later is written again from the request, as every other copy is.
   */
  test("a copy that says it came later than the request beside it: the request is the one kept, and the copy is cut again from it", () => {
    const request: IncomingMonitorRequest = stored(deployHook());
    const saysLater: IncomingMonitorRequest = stored(
      deployHook({
        checkedAt: new Date("2026-11-10T08:30:00.000Z"),
        requestBody: { status: "failed", token: "tok_live_1" },
      }),
    );

    const rewrite: ReadersCopyRewrite | null =
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({
          keepResponseContent: true,
          incomingMonitorRequest: saysLater,
          incomingMonitorRequestAsReceived: request,
        }),
      );

    expect(rewrite!.data.incomingMonitorRequestAsReceived).toEqual(request);
    expect(asJson(rewrite!.data.incomingMonitorRequest)["requestBody"]).toEqual(
      {
        status: "deployed",
        service: "checkout",
        deployer: { name: "Jane Doe", email: REDACTED },
        apiKey: REDACTED,
      },
    );
    // Written only while the monitor still holds the copy it was read with.
    expect(rewrite!.expectedData.incomingMonitorRequest).toBe(saysLater);
  });

  test("a monitor read without its switch writes nothing: the switch is unknown", () => {
    expect(
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({ incomingMonitorRequest: stored(deployHook()) }),
      ),
    ).toBeNull();
  });

  test("a monitor no request reached writes nothing", () => {
    expect(
      LatestIncomingRequest.getReadersCopyRewrite(
        monitorWith({ keepResponseContent: false }),
      ),
    ).toBeNull();
  });
});
