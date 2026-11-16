import WebhookVerification, {
  CLOUD_EVENTS_ALLOWED_ORIGIN_HEADER,
  CLOUD_EVENTS_ALLOWED_RATE_HEADER,
  MAX_VERIFICATION_ORIGIN_LENGTH,
  MAX_VERIFICATION_TOKEN_LENGTH,
  VERIFIED_ENDPOINT_METHODS,
  WebhookVerificationAnswer,
  WebhookVerificationProvider,
  WebhookVerificationRequest,
} from "../../../Server/Utils/WebhookVerification";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { eventGridValidation } from "../../Utils/Monitor/SubscriptionConfirmationFixtures";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

/*
 * THE VERIFICATION HANDSHAKES AN INCOMING REQUEST MONITOR'S URL AND A
 * WORKFLOW'S WEBHOOK TRIGGER ANSWER.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * Azure Event Grid, Slack, Microsoft Graph, Okta and CloudEvents senders
 * deliver nothing to an endpoint that does not answer their check in the
 * way their protocol sets. These hold the recognizer to each protocol's
 * exact shape, as the services' own documentation shows it, and to its one
 * rule: the answer echoes the code, challenge, token or origin the protocol
 * defines - only one a service would mint, never anything else the request
 * carried.
 */

const EVENT_GRID_CODE: string = "512d38b6-c7b8-40c8-89fe-f46f9e9622b6";
const SLACK_CHALLENGE: string =
  "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P";
const SLACK_TOKEN: string = "Jhj5dZrVaK7ZwHHjRyZWjbDl";
const GRAPH_TOKEN: string =
  "Validation: Testing client application reachability for subscription Request-Id: 2c4a4c6c-2fd7-4cfb-9a4b-7cd9b4c5e3f1";
const OKTA_CHALLENGE: string = "6NWv4uK3PE5xL3xPf7JpQ1SxRyUuN0bjEfVYRzWK";
const EVENT_GRID_ORIGIN: string = "eventgrid.azure.net";

function request(
  overrides: Partial<WebhookVerificationRequest>,
): WebhookVerificationRequest {
  return {
    method: "POST",
    headers: {},
    query: {},
    body: {},
    ...overrides,
  };
}

// Event Grid's validation, as it posts it.
function eventGrid(
  overrides: Partial<WebhookVerificationRequest> = {},
): WebhookVerificationRequest {
  return request({
    headers: {
      "aeg-event-type": "SubscriptionValidation",
      "content-type": "application/json",
    },
    body: eventGridValidation({ validationCode: EVENT_GRID_CODE }),
    ...overrides,
  });
}

// Slack's url_verification, as it posts it.
function slack(
  body: JSONObject = {
    token: SLACK_TOKEN,
    challenge: SLACK_CHALLENGE,
    type: "url_verification",
  },
): WebhookVerificationRequest {
  return request({
    headers: { "content-type": "application/json" },
    body: body,
  });
}

// Microsoft Graph's validation: a POST with the token in the query, no body.
function graph(
  query: unknown = { validationToken: GRAPH_TOKEN },
  body: unknown = {},
): WebhookVerificationRequest {
  return request({
    headers: { "content-type": "text/plain; charset=utf-8" },
    query: query,
    body: body,
  });
}

// Okta's one-time verification: a GET with the challenge in a header.
function okta(challenge: string | Array<string>): WebhookVerificationRequest {
  return request({
    method: "GET",
    headers: { "x-okta-verification-challenge": challenge as string },
    body: {},
  });
}

// A CloudEvents validation, as Azure Event Grid sends it.
function cloudEvents(
  headers: Record<string, string> = {
    "webhook-request-origin": EVENT_GRID_ORIGIN,
  },
): WebhookVerificationRequest {
  return request({ method: "OPTIONS", headers: headers, body: {} });
}

function answerOf(
  verification: WebhookVerificationRequest,
): WebhookVerificationAnswer | null {
  return WebhookVerification.recognize(verification);
}

describe("Azure Event Grid, Event Grid schema", () => {
  test("its subscription validation is answered with the validation code", () => {
    expect(answerOf(eventGrid())).toEqual({
      provider: WebhookVerificationProvider.AzureEventGrid,
      json: { validationResponse: EVENT_GRID_CODE },
      headers: {},
    });
  });

  test("the answer holds the code and nothing else the event carried", () => {
    const answer: WebhookVerificationAnswer | null = answerOf(eventGrid());

    expect(JSON.stringify(answer)).not.toContain("validationUrl");
    expect(JSON.stringify(answer)).not.toContain("eventgrid.azure.net");
    expect(JSON.stringify(answer)).not.toContain("storageAccounts");
  });

  test("the header's name is read in any case", () => {
    expect(
      answerOf(
        eventGrid({
          headers: { "Aeg-Event-Type": "SubscriptionValidation" },
        }),
      )?.provider,
    ).toBe(WebhookVerificationProvider.AzureEventGrid);
  });

  test.each([
    ["without aeg-event-type", {}],
    ["for a delivered event", { "aeg-event-type": "Notification" }],
    [
      "with the value in another case",
      { "aeg-event-type": "subscriptionvalidation" },
    ],
  ])("is not a validation %s", (_label: string, headers: JSONObject) => {
    expect(answerOf(eventGrid({ headers: headers as never }))).toBeNull();
  });

  test("an event of another type is not a validation", () => {
    const body: JSONArray = eventGridValidation({
      validationCode: EVENT_GRID_CODE,
    });
    (body[0] as JSONObject)["eventType"] = "Microsoft.Storage.BlobCreated";

    expect(answerOf(eventGrid({ body: body }))).toBeNull();
  });

  test("two events are not a validation: Event Grid sends one", () => {
    const one: JSONObject = eventGridValidation({
      validationCode: EVENT_GRID_CODE,
    })[0] as JSONObject;

    expect(answerOf(eventGrid({ body: [one, one] }))).toBeNull();
    expect(answerOf(eventGrid({ body: [] }))).toBeNull();
  });

  test.each([
    ["an object, not the array Event Grid posts", { eventType: "x" }],
    ["a text", "[]"],
    ["nothing", undefined],
  ])(
    "a body that is %s is not a validation",
    (_label: string, body: unknown) => {
      expect(answerOf(eventGrid({ body: body }))).toBeNull();
    },
  );

  test("a validation without data, or without a code, is not answered", () => {
    expect(
      answerOf(
        eventGrid({
          body: [
            {
              eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      answerOf(
        eventGrid({
          body: [
            {
              eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
              data: { validationUrl: "https://example.com" },
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test.each([
    ["markup", "<script>alert(1)</script>"],
    ["a quote", 'abc"def'],
    ["a line break", "abc\r\nSet-Cookie: a=b"],
    ["a space", "abc def"],
    ["a number, not text", 42],
    ["nothing", ""],
    [
      "text longer than any code",
      "a".repeat(MAX_VERIFICATION_TOKEN_LENGTH + 1),
    ],
  ])("a code holding %s is never echoed", (_label: string, code: unknown) => {
    expect(
      answerOf(
        eventGrid({
          body: eventGridValidation({ validationCode: code as string }),
        }),
      ),
    ).toBeNull();
  });

  test("a code of the longest length is echoed", () => {
    const code: string = "a".repeat(MAX_VERIFICATION_TOKEN_LENGTH);

    expect(
      answerOf(
        eventGrid({ body: eventGridValidation({ validationCode: code }) }),
      )?.json,
    ).toEqual({ validationResponse: code });
  });

  test("a GET is not a validation", () => {
    expect(answerOf(eventGrid({ method: "GET" }))).toBeNull();
  });
});

describe("Slack's Events API", () => {
  test("its URL verification is answered with the challenge", () => {
    expect(answerOf(slack())).toEqual({
      provider: WebhookVerificationProvider.Slack,
      json: { challenge: SLACK_CHALLENGE },
      headers: {},
    });
  });

  test("the answer never holds the verification token Slack sent beside it", () => {
    expect(JSON.stringify(answerOf(slack()))).not.toContain(SLACK_TOKEN);
  });

  test("an event callback is not a verification", () => {
    expect(
      answerOf(
        slack({
          token: SLACK_TOKEN,
          type: "event_callback",
          challenge: SLACK_CHALLENGE,
          event: { type: "message", text: "hello" },
        }),
      ),
    ).toBeNull();
  });

  test.each([
    ["markup", "<img src=x onerror=alert(1)>"],
    ["a line break", "abc\ndef"],
    ["a backslash", "abc\\u003c"],
    ["an object", { a: 1 }],
    ["nothing", ""],
    [
      "text longer than any challenge",
      "b".repeat(MAX_VERIFICATION_TOKEN_LENGTH + 1),
    ],
  ])(
    "a challenge holding %s is never echoed",
    (_label: string, challenge: unknown) => {
      expect(
        answerOf(
          slack({
            token: SLACK_TOKEN,
            type: "url_verification",
            challenge: challenge as string,
          }),
        ),
      ).toBeNull();
    },
  );

  test("a verification without a challenge is not answered", () => {
    expect(answerOf(slack({ type: "url_verification" }))).toBeNull();
  });

  test("a GET is not a verification", () => {
    expect(answerOf({ ...slack(), method: "GET" })).toBeNull();
  });
});

describe("Microsoft Graph change notifications", () => {
  test("its validation is answered with the token, as text", () => {
    expect(answerOf(graph())).toEqual({
      provider: WebhookVerificationProvider.MicrosoftGraph,
      text: GRAPH_TOKEN,
      headers: {},
    });
  });

  test.each([
    ["no body", undefined],
    ["an empty text", ""],
    ["an empty object", {}],
    ["no bytes", Buffer.alloc(0)],
  ])("with %s is answered", (_label: string, body: unknown) => {
    expect(
      answerOf(graph({ validationToken: GRAPH_TOKEN }, body))?.provider,
    ).toBe(WebhookVerificationProvider.MicrosoftGraph);
  });

  test("a notification, which has a body, is not a validation", () => {
    expect(
      answerOf(
        graph(
          { validationToken: GRAPH_TOKEN },
          { value: [{ subscriptionId: "x", changeType: "created" }] },
        ),
      ),
    ).toBeNull();
  });

  test.each([
    ["markup", "<script>alert(1)</script>"],
    ["an ampersand", "a&b"],
    ["a quote", "a'b"],
    ["a line break", "Validation:\r\nSet-Cookie: a=b"],
    ["a leading space", " Validation"],
    ["a character outside ASCII", "Validação"],
    ["nothing", ""],
    [
      "text longer than any token",
      "c".repeat(MAX_VERIFICATION_TOKEN_LENGTH + 1),
    ],
  ])("a token holding %s is never echoed", (_label: string, token: string) => {
    expect(answerOf(graph({ validationToken: token }))).toBeNull();
  });

  test("a token given twice is no token", () => {
    expect(
      answerOf(graph({ validationToken: [GRAPH_TOKEN, GRAPH_TOKEN] })),
    ).toBeNull();
  });

  test("a token given as an object is no token", () => {
    expect(answerOf(graph({ validationToken: { a: GRAPH_TOKEN } }))).toBeNull();
  });

  test("a request with no query is not a validation", () => {
    expect(answerOf({ ...graph(), query: undefined })).toBeNull();
    expect(answerOf({ ...graph(), query: null })).toBeNull();
    expect(answerOf(graph({}))).toBeNull();
  });

  test("a GET is not a validation", () => {
    expect(answerOf({ ...graph(), method: "GET" })).toBeNull();
  });
});

describe("Okta event hooks", () => {
  test("its one-time verification is answered with the challenge", () => {
    expect(answerOf(okta(OKTA_CHALLENGE))).toEqual({
      provider: WebhookVerificationProvider.Okta,
      json: { verification: OKTA_CHALLENGE },
      headers: {},
    });
  });

  test("the header's name is read in any case", () => {
    expect(
      answerOf(
        request({
          method: "GET",
          headers: { "X-Okta-Verification-Challenge": OKTA_CHALLENGE },
        }),
      )?.json,
    ).toEqual({ verification: OKTA_CHALLENGE });
  });

  test.each([
    ["markup", "<b>x</b>"],
    ["a quote", 'a"b'],
    ["a space", "a b"],
    ["two values joined", `${OKTA_CHALLENGE}, ${OKTA_CHALLENGE}`],
    [
      "text longer than any challenge",
      "d".repeat(MAX_VERIFICATION_TOKEN_LENGTH + 1),
    ],
  ])(
    "a challenge holding %s is never echoed",
    (_label: string, challenge: string) => {
      expect(answerOf(okta(challenge))).toBeNull();
    },
  );

  test("a challenge sent as a list is never echoed", () => {
    expect(answerOf(okta([OKTA_CHALLENGE, OKTA_CHALLENGE]))).toBeNull();
  });

  test("a POST, which delivers events, is not the verification", () => {
    expect(answerOf({ ...okta(OKTA_CHALLENGE), method: "POST" })).toBeNull();
  });

  test("a HEAD is not the verification", () => {
    expect(answerOf({ ...okta(OKTA_CHALLENGE), method: "HEAD" })).toBeNull();
  });

  test("a GET without the header is any GET", () => {
    expect(answerOf(request({ method: "GET" }))).toBeNull();
  });
});

describe("the CloudEvents webhook validation", () => {
  test("Azure Event Grid's is answered with its origin and any rate", () => {
    expect(answerOf(cloudEvents())).toEqual({
      provider: WebhookVerificationProvider.CloudEvents,
      headers: {
        [CLOUD_EVENTS_ALLOWED_ORIGIN_HEADER]: EVENT_GRID_ORIGIN,
        [CLOUD_EVENTS_ALLOWED_RATE_HEADER]: "*",
        Allow: VERIFIED_ENDPOINT_METHODS,
      },
    });
  });

  test("another sender's is answered with its own origin", () => {
    expect(
      answerOf(cloudEvents({ "WebHook-Request-Origin": "events.example.com" }))
        ?.headers[CLOUD_EVENTS_ALLOWED_ORIGIN_HEADER],
    ).toBe("events.example.com");
  });

  test("the rate it asked for is granted, as any rate", () => {
    expect(
      answerOf(
        cloudEvents({
          "webhook-request-origin": EVENT_GRID_ORIGIN,
          "webhook-request-rate": "120",
        }),
      )?.headers[CLOUD_EVENTS_ALLOWED_RATE_HEADER],
    ).toBe("*");
  });

  test.each([
    [
      "a line break, to split the answer",
      "eventgrid.azure.net\r\nSet-Cookie: a=b",
    ],
    ["a space", "eventgrid azure net"],
    ["a port", "eventgrid.azure.net:443"],
    ["a scheme", "https://eventgrid.azure.net"],
    ["an asterisk", "*"],
    ["two origins", "eventgrid.azure.net, example.com"],
    ["markup", "<script>"],
    ["a label too long", `${"a".repeat(64)}.example.com`],
    ["a name too long", `${"a.".repeat(MAX_VERIFICATION_ORIGIN_LENGTH)}com`],
    ["a hyphen at the end of a label", "eventgrid-.azure.net"],
  ])(
    "an origin holding %s is never named back",
    (_label: string, origin: string) => {
      expect(
        answerOf(cloudEvents({ "webhook-request-origin": origin })),
      ).toBeNull();
    },
  );

  test("a browser's CORS preflight is never a validation", () => {
    const preflight: WebhookVerificationRequest = cloudEvents({
      "webhook-request-origin": EVENT_GRID_ORIGIN,
      origin: "https://shop.example.com",
      "access-control-request-method": "POST",
    });

    expect(answerOf(preflight)).toBeNull();
    expect(WebhookVerification.isCloudEventsValidation(preflight)).toBe(false);
  });

  test("an OPTIONS request that names no origin is no validation", () => {
    expect(answerOf(cloudEvents({}))).toBeNull();
    expect(WebhookVerification.isCloudEventsValidation(cloudEvents({}))).toBe(
      false,
    );
  });

  test("the origin header on a POST is no validation", () => {
    expect(
      answerOf(
        request({
          method: "POST",
          headers: { "webhook-request-origin": EVENT_GRID_ORIGIN },
        }),
      ),
    ).toBeNull();
    expect(
      WebhookVerification.isCloudEventsValidation({
        method: "POST",
        headers: { "webhook-request-origin": EVENT_GRID_ORIGIN },
      }),
    ).toBe(false);
  });

  test("is told from a preflight before the origin is checked, so the CORS middleware lets it through", () => {
    expect(WebhookVerification.isCloudEventsValidation(cloudEvents())).toBe(
      true,
    );
    expect(
      WebhookVerification.isCloudEventsValidation({
        method: "options",
        headers: { "WebHook-Request-Origin": "not a host" },
      }),
    ).toBe(true);
  });
});

describe("any other request", () => {
  test.each([
    ["a heartbeat", request({ method: "GET" })],
    ["a JSON status", request({ body: { status: "ok" } })],
    ["an alert", request({ body: { alerts: [{ status: "firing" }] } })],
    [
      "an Amazon SNS confirmation, which is confirmed by its link",
      request({
        headers: { "x-amz-sns-message-type": "SubscriptionConfirmation" },
        body: { Type: "SubscriptionConfirmation", Token: "abc" },
      }),
    ],
    [
      "a PUT",
      request({
        method: "PUT",
        body: { type: "url_verification", challenge: "abc" },
      }),
    ],
    ["no method", request({ method: "" })],
  ])(
    "%s is no verification",
    (_label: string, other: WebhookVerificationRequest) => {
      expect(answerOf(other)).toBeNull();
    },
  );

  test("with no headers at all is no verification", () => {
    expect(
      answerOf({
        method: "GET",
        headers: undefined,
        query: undefined,
        body: undefined,
      }),
    ).toBeNull();
  });
});

describe("the answer, over HTTP", () => {
  let server: http.Server;
  let port: number = 0;
  let toSend: WebhookVerificationAnswer;

  interface Answer {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }

  function fetchAnswer(answer: WebhookVerificationAnswer): Promise<Answer> {
    toSend = answer;

    return new Promise(
      (resolve: (value: Answer) => void, reject: (err: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          { host: "127.0.0.1", port: port, method: "POST", path: "/" },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                statusCode: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      },
    );
  }

  beforeAll(async () => {
    server = http.createServer(
      (_req: http.IncomingMessage, res: http.ServerResponse) => {
        WebhookVerification.send(res as never, toSend);
      },
    );
    server.listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      server.once("listening", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      server.close(resolve);
    });
  });

  test("a JSON answer is 200, application/json, nosniff and never cached", async () => {
    const answer: Answer = await fetchAnswer(answerOf(slack())!);

    expect(answer.statusCode).toBe(200);
    expect(answer.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(answer.body)).toEqual({ challenge: SLACK_CHALLENGE });
    expect(answer.headers["content-length"]).toBe(
      String(Buffer.byteLength(answer.body)),
    );
  });

  test("Microsoft Graph's answer is the token as text/plain, exactly", async () => {
    const answer: Answer = await fetchAnswer(answerOf(graph())!);

    expect(answer.statusCode).toBe(200);
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.body).toBe(GRAPH_TOKEN);
  });

  test("the CloudEvents answer grants the origin in its headers, with no body", async () => {
    const answer: Answer = await fetchAnswer(answerOf(cloudEvents())!);

    expect(answer.statusCode).toBe(200);
    expect(answer.headers["webhook-allowed-origin"]).toBe(EVENT_GRID_ORIGIN);
    expect(answer.headers["webhook-allowed-rate"]).toBe("*");
    expect(answer.headers["allow"]).toBe(VERIFIED_ENDPOINT_METHODS);
    expect(answer.headers["content-type"]).toBeUndefined();
    expect(answer.headers["content-length"]).toBe("0");
    expect(answer.body).toBe("");
  });

  test("Event Grid's and Okta's answers are their JSON", async () => {
    expect(
      JSON.parse((await fetchAnswer(answerOf(eventGrid())!)).body),
    ).toEqual({ validationResponse: EVENT_GRID_CODE });
    expect(
      JSON.parse((await fetchAnswer(answerOf(okta(OKTA_CHALLENGE))!)).body),
    ).toEqual({ verification: OKTA_CHALLENGE });
  });
});
