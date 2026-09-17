import GitHubAPI from "../../../Server/API/GitHubAPI";
import GitHubWebhookHandler from "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { JSONObject } from "../../../Types/JSON";
import * as crypto from "crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /github/webhook — signature verification against the bytes GitHub
 * actually sent.
 *
 * The handler used to verify `JSON.stringify(req.body)`: the parsed body,
 * re-serialized by V8. That is not a forgery hole — the HMAC is still keyed on
 * the webhook secret — but it is wrong in a way that fails CLOSED and silently.
 * Verification only succeeds when GitHub's payload happens to be a fixed point
 * of parse-then-stringify, and a payload that is not one is rejected as
 * "Invalid webhook signature" with nothing to distinguish it from an attack.
 * Real payloads that are not fixed points are ordinary: a \uXXXX escape in an
 * issue title, a renormalized number, a numeric-looking object key that V8
 * reorders, any whitespace at all.
 *
 * It is also the parser-differential pattern that signature checks exist to
 * avoid — verifying a canonicalized re-serialization rather than the signed
 * bytes means two different byte strings can both "verify".
 *
 * Express already captures the true body for exactly this purpose (the
 * `verify` hook on jsonBodyParserOptions in StartServer). These tests pin that
 * the route reads it, and that a request without it is refused rather than
 * guessed at.
 */

/*
 * The secret is inlined in the factory rather than referenced from a const.
 * jest hoists jest.mock() above every import and every declaration, so a
 * factory that closes over a module-level binding reads it in its temporal
 * dead zone and the whole suite fails to load.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppName: "oneuptime-test-app",
    GitHubAppWebhookSecret: "test-webhook-secret",
  };
});

const WEBHOOK_SECRET: string = "test-webhook-secret";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const WEBHOOK_ROUTE: string = "/github/webhook";

function sign(rawBody: string): string {
  return `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")}`;
}

function errorMessage(): string | undefined {
  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  if (sendErrorResponse.mock.calls.length === 0) {
    return undefined;
  }

  return (sendErrorResponse.mock.calls[0]![2] as Error).message;
}

function successBody(): JSONObject | undefined {
  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  if (sendJsonObjectResponse.mock.calls.length === 0) {
    return undefined;
  }

  return sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

async function callWebhook(data: {
  rawBody: string | undefined;
  parsedBody: JSONObject;
  signature?: string | undefined;
  event?: string | undefined;
  deliveryId?: string | undefined;
}): Promise<void> {
  const headers: Record<string, string> = {};

  if (data.signature !== undefined) {
    headers["x-hub-signature-256"] = data.signature;
  }

  if (data.event !== undefined) {
    headers["x-github-event"] = data.event;
  }

  if (data.deliveryId !== undefined) {
    headers["x-github-delivery"] = data.deliveryId;
  }

  const req: ExpressRequest = {
    params: {},
    query: {},
    body: data.parsedBody,
    rawBody: data.rawBody,
    headers: headers,
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", WEBHOOK_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);
}

describe("POST /github/webhook signature verification", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new GitHubAPI().getRouter();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * The interactive handler has its own test file. Here it is stubbed so
     * these cases are about the signature gate alone — and so that reaching
     * the handler at all is itself an assertable outcome.
     */
    jest
      .spyOn(GitHubWebhookHandler, "handleEvent")
      .mockResolvedValue({ handled: false, outcome: "stubbed" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a payload whose signature covers the raw bytes", async () => {
    const rawBody: string = '{"action":"created","zen":"Keep it simple."}';

    await callWebhook({
      rawBody: rawBody,
      parsedBody: JSON.parse(rawBody) as JSONObject,
      signature: sign(rawBody),
      event: "ping",
    });

    expect(errorMessage()).toBeUndefined();
    expect(successBody()?.["success"]).toBe(true);
  });

  /*
   * The regression this file exists for. Both payloads below are legitimate
   * GitHub deliveries whose bytes do NOT survive parse-then-stringify, so the
   * old implementation rejected them outright — the integration simply stopped
   * working for anyone whose issue title contained an escaped character.
   */
  describe("payloads that are not JSON.stringify fixed points", () => {
    test.each([
      [
        "a unicode escape in a title",
        '{"action":"opened","issue":{"title":"caf\\u00e9 crash"}}',
      ],
      ["whitespace between tokens", '{"action": "opened", "number": 7}'],
      ["a renormalizable number", '{"action":"opened","number":1.0}'],
      [
        "numeric-looking object keys V8 would reorder",
        '{"action":"opened","counts":{"2":"b","1":"a"}}',
      ],
      ["a forward slash GitHub does not escape", '{"repository":"a/b"}'],
    ])("accepts %s", async (_name: string, rawBody: string) => {
      await callWebhook({
        rawBody: rawBody,
        parsedBody: JSON.parse(rawBody) as JSONObject,
        signature: sign(rawBody),
        event: "issues",
      });

      expect(errorMessage()).toBeUndefined();
      expect(successBody()?.["success"]).toBe(true);
    });

    test("would have been rejected when verifying the re-serialized body", () => {
      /*
       * Not a test of the route — a test of the PREMISE. If these payloads
       * were fixed points, every case above would pass either way and this
       * file would be pinning nothing.
       */
      const rawBodies: Array<string> = [
        '{"action":"opened","issue":{"title":"caf\\u00e9 crash"}}',
        '{"action": "opened", "number": 7}',
        '{"action":"opened","number":1.0}',
        '{"action":"opened","counts":{"2":"b","1":"a"}}',
      ];

      for (const rawBody of rawBodies) {
        expect(JSON.stringify(JSON.parse(rawBody))).not.toEqual(rawBody);
      }
    });
  });

  test("rejects a signature computed over different bytes", async () => {
    const rawBody: string = '{"action":"opened"}';

    await callWebhook({
      rawBody: rawBody,
      parsedBody: JSON.parse(rawBody) as JSONObject,
      signature: sign('{"action":"closed"}'),
      event: "issues",
    });

    expect(errorMessage()).toBe("Invalid webhook signature");
    expect(GitHubWebhookHandler.handleEvent).not.toHaveBeenCalled();
  });

  /*
   * The parser-differential the old implementation allowed: a captured
   * delivery replayed with cosmetically different bytes. Verifying the real
   * bytes means the replay's signature no longer matches them.
   */
  test("rejects a replay of a valid payload with cosmetically different bytes", async () => {
    const originalBody: string = '{"action":"opened","number":7}';
    const replayedBody: string = '{"action":"opened", "number":7}';

    await callWebhook({
      rawBody: replayedBody,
      parsedBody: JSON.parse(replayedBody) as JSONObject,
      signature: sign(originalBody),
      event: "issues",
    });

    expect(errorMessage()).toBe("Invalid webhook signature");
    expect(GitHubWebhookHandler.handleEvent).not.toHaveBeenCalled();
  });

  test("rejects a request with no signature header", async () => {
    await callWebhook({
      rawBody: "{}",
      parsedBody: {},
      event: "issues",
    });

    expect(errorMessage()).toBe("Missing webhook signature");
    expect(GitHubWebhookHandler.handleEvent).not.toHaveBeenCalled();
  });

  /*
   * A missing rawBody means the route was mounted without the json parser that
   * captures it. Verifying a body we did not capture is not something to guess
   * at, so it fails closed — and says something an operator can act on rather
   * than "invalid signature", which would send them hunting for the wrong bug.
   */
  test("refuses when the raw body was never captured", async () => {
    const rawBody: string = '{"action":"opened"}';

    await callWebhook({
      rawBody: undefined,
      parsedBody: JSON.parse(rawBody) as JSONObject,
      signature: sign(rawBody),
      event: "issues",
    });

    expect(errorMessage()).toBe("Could not verify webhook signature");
    expect(GitHubWebhookHandler.handleEvent).not.toHaveBeenCalled();
  });

  test("passes the event name and delivery id to the interactive handler", async () => {
    const rawBody: string = '{"action":"created"}';

    await callWebhook({
      rawBody: rawBody,
      parsedBody: JSON.parse(rawBody) as JSONObject,
      signature: sign(rawBody),
      event: "issue_comment",
      deliveryId: "delivery-abc-123",
    });

    expect(GitHubWebhookHandler.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "issue_comment",
        deliveryId: "delivery-abc-123",
      }),
    );
  });

  /*
   * GitHub redelivers anything that did not answer 2xx, which is WHY
   * GitHubWebhookHandler.handleEvent swallows its own errors rather than
   * letting them reach here — an escaping exception would turn one bad payload
   * into an endless redelivery loop of that exact payload.
   *
   * This pins the backstop for the day one escapes anyway: the route's own
   * catch answers, so express never sees an unhandled rejection and the
   * installation bookkeeping that already ran is not undone. GitHub will still
   * retry that delivery, and that is the correct behaviour for a request the
   * server genuinely failed to process.
   */
  test("answers rather than throwing when the interactive handler fails", async () => {
    (
      GitHubWebhookHandler.handleEvent as unknown as jest.Mock
    ).mockRejectedValue(new Error("boom"));

    const rawBody: string = '{"action":"created"}';

    await callWebhook({
      rawBody: rawBody,
      parsedBody: JSON.parse(rawBody) as JSONObject,
      signature: sign(rawBody),
      event: "issue_comment",
    });

    /*
     * The route's own catch answers an error response rather than throwing out
     * of express — GitHub sees a response either way, which is what stops the
     * redelivery loop.
     */
    expect(errorMessage()).toBe("boom");
  });
});
