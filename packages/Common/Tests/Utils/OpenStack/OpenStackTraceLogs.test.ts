import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  OpenStackTraceLogRow,
  OpenStackTraceRequest,
  OpenStackTraceRequestMatch,
  OpenStackTraceSpanForLogs,
  joinOpenStackTraceToRequests,
} from "../../../Utils/OpenStack/OpenStackTraceLogs";

/*
 * From a trace to the logs of its requests. Neither holds the other's ID, so what matters is
 * that each answer says how sure it is, and that a quiet guess never outranks a sure one. The
 * lines here are written by hand from what oslo.log writes, to pin each rule on its own.
 * OpenStackTracesRecordings.test.ts holds this to a real boot, whose request ID Nova's
 * instance actions say.
 */

const INSTANCE: string = "5f2a3a1c-7c11-4a55-9b1e-0a7a7d3f9c11";

function span(
  values: Partial<OpenStackTraceSpanForLogs>,
): OpenStackTraceSpanForLogs {
  return {
    service: "nova-api",
    method: "",
    path: "",
    startAt: new Date("2026-11-04T10:00:00.000Z"),
    endAt: new Date("2026-11-04T10:00:02.000Z"),
    attributes: {},
    ...values,
  };
}

function line(data: {
  root: string;
  service?: string;
  instance?: string;
  body?: string;
  time?: string;
}): OpenStackTraceLogRow {
  const attributes: JSONObject = {
    "openstack.request_root_id": data.root,
    "openstack.service": data.service || "nova-api",
  };

  if (data.instance) {
    attributes["openstack.instance_id"] = data.instance;
  }

  return {
    time: data.time || "2026-11-04T10:00:01.000Z",
    body: data.body || "",
    attributes: attributes,
  };
}

function rootsOf(
  requests: Array<OpenStackTraceRequest>,
): Array<[string, OpenStackTraceRequestMatch]> {
  return requests.map(
    (request: OpenStackTraceRequest): [string, OpenStackTraceRequestMatch] => {
      return [request.rootId, request.match];
    },
  );
}

describe("what a trace's requests are, and how sure that is", () => {
  test("a line naming an instance the trace touched is as good as an ID", () => {
    expect(
      rootsOf(
        joinOpenStackTraceToRequests({
          spans: [span({ attributes: { "openstack.instance_id": INSTANCE } })],
          logs: [
            line({
              root: "req-build",
              service: "nova-compute",
              instance: INSTANCE,
            }),
          ],
        }),
      ),
    ).toEqual([["req-build", OpenStackTraceRequestMatch.NamesInstance]]);
  });

  test("an API's own line for the same call", () => {
    expect(
      rootsOf(
        joinOpenStackTraceToRequests({
          spans: [
            span({
              service: "nova-api",
              method: "POST",
              path: "/compute/v2.1/servers",
            }),
          ],
          logs: [
            line({
              root: "req-post",
              body: '10.1.0.4 "POST /compute/v2.1/servers" status: 202 len: 480 microversion: 2.1 time: 0.54',
            }),
          ],
        }),
      ),
    ).toEqual([["req-post", OpenStackTraceRequestMatch.SameCall]]);
  });

  test("the same service in the same moments is only ever a guess", () => {
    expect(
      rootsOf(
        joinOpenStackTraceToRequests({
          spans: [span({ service: "nova-api" })],
          logs: [line({ root: "req-other", service: "nova-api" })],
        }),
      ),
    ).toEqual([["req-other", OpenStackTraceRequestMatch.SameMoment]]);
  });

  test("a service the trace never crossed is someone else's", () => {
    expect(
      joinOpenStackTraceToRequests({
        spans: [span({ service: "nova-api" })],
        logs: [line({ root: "req-other", service: "glance-api" })],
      }),
    ).toEqual([]);
  });

  test("a line of the same call long after the trace is another call's", () => {
    expect(
      rootsOf(
        joinOpenStackTraceToRequests({
          spans: [
            span({
              service: "nova-api",
              method: "GET",
              path: "/v2.1/servers",
            }),
          ],
          logs: [
            line({
              root: "req-later",
              body: '"GET /v2.1/servers" status: 200',
              time: "2026-11-04T11:00:00.000Z",
            }),
          ],
        }),
      ),
    ).toEqual([["req-later", OpenStackTraceRequestMatch.SameMoment]]);
  });

  test("the sure answers come first, whatever order the lines came in", () => {
    const requests: Array<OpenStackTraceRequest> = joinOpenStackTraceToRequests(
      {
        spans: [
          span({
            service: "nova-api",
            method: "POST",
            path: "/v2.1/servers",
            attributes: { "openstack.instance_id": INSTANCE },
          }),
        ],
        logs: [
          line({ root: "req-guess", time: "2026-11-04T10:00:00.100Z" }),
          line({
            root: "req-call",
            body: '"POST /v2.1/servers" status: 202',
            time: "2026-11-04T10:00:00.200Z",
          }),
          line({
            root: "req-instance",
            service: "nova-compute",
            instance: INSTANCE,
            time: "2026-11-04T10:00:00.300Z",
          }),
        ],
      },
    );

    expect(rootsOf(requests)).toEqual([
      ["req-instance", OpenStackTraceRequestMatch.NamesInstance],
      ["req-call", OpenStackTraceRequestMatch.SameCall],
      ["req-guess", OpenStackTraceRequestMatch.SameMoment],
    ]);
  });

  test("a request read several ways keeps the surest, and every service it holds", () => {
    const requests: Array<OpenStackTraceRequest> = joinOpenStackTraceToRequests(
      {
        spans: [
          span({
            service: "nova-api",
            attributes: { "openstack.instance_id": INSTANCE },
          }),
          span({ service: "nova-compute" }),
        ],
        logs: [
          line({
            root: "req-build",
            service: "nova-api",
            time: "2026-11-04T10:00:00.500Z",
          }),
          line({
            root: "req-build",
            service: "nova-compute",
            instance: INSTANCE,
            time: "2026-11-04T10:00:01.500Z",
          }),
        ],
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.match).toBe(OpenStackTraceRequestMatch.NamesInstance);
    expect(requests[0]!.services).toEqual(["nova-api", "nova-compute"]);
    expect(requests[0]!.at?.toISOString()).toBe("2026-11-04T10:00:00.500Z");
  });

  test("a busy cloud's guesses stop at a few", () => {
    const logs: Array<OpenStackTraceLogRow> = Array.from({ length: 50 }).map(
      (_value: unknown, index: number): OpenStackTraceLogRow => {
        return line({ root: `req-${index}` });
      },
    );

    expect(
      joinOpenStackTraceToRequests({ spans: [span({})], logs }).length,
    ).toBeLessThanOrEqual(8);
  });

  test("a line with no request is no answer, and a row that says little costs nothing", () => {
    expect(
      joinOpenStackTraceToRequests({
        spans: [span({})],
        logs: [
          { time: "2026-11-04T10:00:01.000Z", attributes: {} },
          { time: null, attributes: null },
          { attributes: { "openstack.request_root_id": 12 } as JSONObject },
        ],
      }),
    ).toEqual([]);
  });

  test("a body too long to read costs a moment", () => {
    const started: number = Date.now();

    joinOpenStackTraceToRequests({
      spans: [span({ method: "GET", path: "/v2.1/servers" })],
      logs: [line({ root: "req-long", body: "x".repeat(1024 * 1024) })],
    });

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
