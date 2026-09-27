import Response from "../../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Response.sendJsonStringResponse sends a body that is already serialized
 * JSON — the Topology maps hand out their cached payload this way — exactly
 * as given: the right content type, never cached by the browser or a proxy,
 * and never copied into the audit log.
 */

interface FakeResponse {
  headers: Record<string, string>;
  status: number | null;
  body: string | null;
  logBody: unknown;
}

function fakeResponse(): { res: ExpressResponse; state: FakeResponse } {
  const state: FakeResponse = {
    headers: {},
    status: null,
    body: null,
    logBody: undefined,
  };
  const res: Record<string, unknown> = {
    setHeader: jest.fn((name: string, value: string): void => {
      state.headers[name.toLowerCase()] = value;
    }),
    writeHead: jest.fn(
      (status: number, headers: Record<string, string>): void => {
        state.status = status;
        for (const [name, value] of Object.entries(headers)) {
          state.headers[name.toLowerCase()] = value;
        }
      },
    ),
    end: jest.fn((body: string): void => {
      state.body = body;
    }),
    send: jest.fn(() => {
      throw new Error("send() would re-process the body");
    }),
  };
  Object.defineProperty(res, "logBody", {
    set: (value: unknown): void => {
      state.logBody = value;
    },
    get: (): unknown => {
      return state.logBody;
    },
  });
  return { res: res as unknown as ExpressResponse, state };
}

describe("Response.sendJsonStringResponse", () => {
  test("sends the string as is, as JSON, with no-store headers", () => {
    const { res, state } = fakeResponse();
    const json: string = JSON.stringify({ nodes: [{ key: "a" }], ok: true });

    Response.sendJsonStringResponse({} as ExpressRequest, res, json);

    expect(state.status).toBe(200);
    expect(state.body).toBe(json);
    expect(state.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(state.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(state.headers["pragma"]).toBe("no-cache");
    expect(state.headers["expires"]).toBe("0");
  });

  test("the audit log gets the size, never the payload", () => {
    const { res, state } = fakeResponse();
    const json: string = JSON.stringify({ secret: "inventory" });

    Response.sendJsonStringResponse({} as ExpressRequest, res, json);

    expect(state.logBody).toEqual({
      contentType: "application/json",
      characters: json.length,
    });
    expect(JSON.stringify(state.logBody)).not.toContain("inventory");
  });
});
