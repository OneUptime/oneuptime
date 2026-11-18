import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import CustomDomainServerReadiness from "../../../Server/Utils/CustomDomain/CustomDomainServerReadiness";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { mockRouter } from "./Helpers";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Mock } from "jest-mock";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * GET /status-page-api/custom-domain-readiness/:proof - what `npm run
 * doctor` and diagnose.sh ask HOST for, through whatever stands in front of
 * OneUptime (#7050, #7051). A proof only this installation made opens it;
 * the answer says how that request reached the app, so the tools can tell
 * whether a proxy passed on the host name and the scheme the browser used.
 * Anything else is refused, and says nothing of how it arrived.
 */

const READINESS_ROUTE: string = "/status-page/custom-domain-readiness/:proof";

interface Answer {
  sent: JSONObject | undefined;
  refused: unknown;
}

async function ask(data: {
  proof: string;
  headers: Record<string, string>;
  secure?: boolean;
}): Promise<Answer> {
  const sendJson: Mock = Response.sendJsonObjectResponse as unknown as Mock;
  const sendError: Mock = Response.sendErrorResponse as unknown as Mock;
  const jsonBefore: number = sendJson.mock.calls.length;
  const errorsBefore: number = sendError.mock.calls.length;

  await mockRouter.match("get", READINESS_ROUTE).handlerFunction(
    {
      params: { proof: data.proof },
      headers: data.headers,
      secure: data.secure === true,
      query: {},
      body: {},
    } as unknown as ExpressRequest,
    {
      send: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );

  const sent: Array<unknown> | undefined = sendJson.mock.calls[jsonBefore];
  const refused: Array<unknown> | undefined =
    sendError.mock.calls[errorsBefore];

  return {
    sent: sent ? (sent[2] as JSONObject) : undefined,
    refused: refused ? refused[2] : undefined,
  };
}

describe("the custom domain readiness route", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is open to anyone: a proof is what lets a request through", () => {
    expect(mockRouter.match("get", READINESS_ROUTE).middlewares).toEqual([]);
  });

  it("answers a proof this installation made with the proof and how the request arrived, never kept by a cache", async () => {
    const proof: string = CustomDomainServerReadiness.createProof();
    const answer: Answer = await ask({
      proof: proof,
      headers: { host: "oneuptime.example.com" },
      secure: true,
    });

    expect(answer.refused).toBeUndefined();
    expect(answer.sent).toEqual({
      proof: proof,
      request: { host: "oneuptime.example.com", isHttps: true },
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  it("names the host a proxy rewrote the request to, and plain HTTP when the scheme was not passed on", async () => {
    const proof: string = CustomDomainServerReadiness.createProof();
    const answer: Answer = await ask({
      proof: proof,
      headers: {
        host: "127.0.0.1:8080",
        "x-forwarded-host": "oneuptime.example.com",
      },
    });

    expect(answer.sent).toEqual({
      proof: proof,
      request: { host: "127.0.0.1", isHttps: false },
    });
  });

  it.each([
    ["a forged proof", `${"a".repeat(32)}.${"b".repeat(64)}`],
    ["no proof", ""],
    ["a proof cut short", "0123abcd.signature"],
  ])(
    "refuses %s, and says nothing of how the request arrived",
    async (_label: string, proof: string) => {
      const answer: Answer = await ask({
        proof: proof,
        headers: { host: "oneuptime.example.com" },
        secure: true,
      });

      expect(answer.sent).toBeUndefined();
      expect(answer.refused).toEqual(new BadDataException("Invalid proof."));
    },
  );
});
