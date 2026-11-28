import {
  XAPI_MAX_OPEN_MESSAGE_CHECKS,
  findClearedXapiMessages,
} from "../../../Utils/XcpNg/XapiCollector";
import XapiClient, { XapiError } from "../../../Utils/XcpNg/XapiClient";
import {
  XcpNgHttpRequest,
  XcpNgHttpResponse,
} from "../../../Utils/XcpNg/XcpNgHttp";
import { describe, expect, test } from "@jest/globals";

/*
 * Which messages with an open alert XAPI no longer lists (#10997): asked by
 * uuid over JSON-RPC, as message.get_by_uuid answers - a ref while XAPI
 * keeps the message, UUID_INVALID once someone dismissed it or XAPI let it
 * go. Anything else proves nothing, and the rest wait for the next time.
 */

interface Asked {
  method: string;
  params: Array<unknown>;
}

function xapi(answer: (uuid: string) => unknown): {
  client: XapiClient;
  asked: Array<Asked>;
} {
  const asked: Array<Asked> = [];
  const client: XapiClient = new XapiClient(
    async (request: XcpNgHttpRequest): Promise<XcpNgHttpResponse> => {
      const body: { id: number; method: string; params: Array<unknown> } =
        JSON.parse(request.body || "{}");
      asked.push({ method: body.method, params: body.params });
      const result: unknown = answer(String(body.params[1]));
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          result instanceof Error
            ? { jsonrpc: "2.0", id: body.id, error: result.message.split(",") }
            : { jsonrpc: "2.0", id: body.id, result: result },
        ),
      };
    },
  );
  return { client: client, asked: asked };
}

const KEPT: string = "11111111-0000-4000-8000-000000000020";
const GONE: string = "11111111-0000-4000-8000-000000000010";
const ALSO_GONE: string = "11111111-0000-4000-8000-000000000011";

describe("findClearedXapiMessages", () => {
  test("the ones XAPI answers UUID_INVALID for, by message.get_by_uuid with the session", async () => {
    const { client, asked } = xapi((uuid: string): unknown => {
      return uuid === KEPT
        ? "OpaqueRef:5a1f"
        : new Error(`UUID_INVALID,message,${uuid}`);
    });

    const cleared: Array<string> = await findClearedXapiMessages({
      client: client,
      session: "OpaqueRef:session",
      openMessageIds: [GONE, KEPT, ALSO_GONE],
    });

    expect(cleared).toEqual([GONE, ALSO_GONE]);
    expect(asked).toEqual([
      { method: "message.get_by_uuid", params: ["OpaqueRef:session", GONE] },
      { method: "message.get_by_uuid", params: ["OpaqueRef:session", KEPT] },
      {
        method: "message.get_by_uuid",
        params: ["OpaqueRef:session", ALSO_GONE],
      },
    ]);
  });

  test("any other failure proves nothing: it and the ones after it stay open", async () => {
    const { client, asked } = xapi((uuid: string): unknown => {
      if (uuid === GONE) {
        return new Error(`UUID_INVALID,message,${uuid}`);
      }
      return new Error("SESSION_INVALID,OpaqueRef:session");
    });

    expect(
      await findClearedXapiMessages({
        client: client,
        session: "OpaqueRef:session",
        openMessageIds: [GONE, KEPT, ALSO_GONE],
      }),
    ).toEqual([GONE]);
    // Stopped at the first that proved nothing.
    expect(asked).toHaveLength(2);
  });

  test("nothing open, nothing asked; each id once; at most so many a collection", async () => {
    const none: { client: XapiClient; asked: Array<Asked> } = xapi(
      (): unknown => {
        return "OpaqueRef:x";
      },
    );
    expect(
      await findClearedXapiMessages({
        client: none.client,
        session: "s",
        openMessageIds: [],
      }),
    ).toEqual([]);
    expect(none.asked).toEqual([]);

    const many: { client: XapiClient; asked: Array<Asked> } = xapi(
      (uuid: string): unknown => {
        return new Error(`UUID_INVALID,message,${uuid}`);
      },
    );
    const ids: Array<string> = Array.from(
      { length: XAPI_MAX_OPEN_MESSAGE_CHECKS + 10 },
      (_value: unknown, index: number): string => {
        return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );
    const cleared: Array<string> = await findClearedXapiMessages({
      client: many.client,
      session: "s",
      openMessageIds: [ids[0] as string, ...ids],
    });
    expect(cleared).toHaveLength(XAPI_MAX_OPEN_MESSAGE_CHECKS);
    expect(many.asked).toHaveLength(XAPI_MAX_OPEN_MESSAGE_CHECKS);
  });

  test("XAPI's error is the one the client raises", () => {
    // The shape findClearedXapiMessages reads: the code alone.
    const error: XapiError = new XapiError({
      code: "UUID_INVALID",
      params: ["message", GONE],
      method: "message.get_by_uuid",
    });
    expect(error.code).toBe("UUID_INVALID");
  });
});
