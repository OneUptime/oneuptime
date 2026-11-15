import { REDACTED } from "../../../Server/Utils/LogRedaction";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import IncomingRequestSubscriptionConfirmationUtil, {
  EVENT_GRID_VALIDATION_VALID_FOR_MS,
  IncomingRequestSubscriptionConfirmation,
  MASKED_VALUE,
  SNS_CONFIRMATION_VALID_FOR_MS,
  SubscriptionConfirmationAction,
  SubscriptionConfirmationProvider,
} from "../../../Utils/Monitor/IncomingRequestSubscriptionConfirmation";
import {
  EVENT_GRID_SENT_AT,
  EVENT_GRID_TOKEN,
  EVENT_GRID_TOPIC,
  EVENT_GRID_VALIDATION_URL,
  SNS_SENT_AT,
  SNS_SUBSCRIBE_URL,
  SNS_TOKEN,
  SNS_TOPIC_ARN,
  eventGridValidation,
  snsNotification,
  snsSubscriptionConfirmation,
  snsUnsubscribeConfirmation,
} from "./SubscriptionConfirmationFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH REQUESTS ARE A SUBSCRIPTION CONFIRMATION, AND WHICH LINK IS THEIRS.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Amazon SNS confirms an HTTPS subscription, and Azure Event Grid validates
 * a webhook, only once the endpoint's owner opens the link the service
 * sent. The copies people read keep that link, and the monitor's summary
 * offers it as a button - so it must be exactly the service's own link:
 * anyone who knows a monitor's URL can send it any body, and a "Confirm
 * Subscription" button must never lead to another page, or to another
 * action on the service's.
 */

const find: (
  body: unknown,
) => IncomingRequestSubscriptionConfirmation | null = (
  body: unknown,
): IncomingRequestSubscriptionConfirmation | null => {
  return IncomingRequestSubscriptionConfirmationUtil.find(body);
};

function snsWithUrl(subscribeUrl: string, body: JSONObject = {}): JSONObject {
  return snsSubscriptionConfirmation({ SubscribeURL: subscribeUrl, ...body });
}

function snsUrl(query: string, origin?: string): string {
  return `${origin || "https://sns.eu-west-1.amazonaws.com/"}?${query}`;
}

const SNS_QUERY: string = `Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${SNS_TOKEN}`;

describe("an Amazon SNS SubscriptionConfirmation", () => {
  test("is found, with its link, its topic and when it stops working", () => {
    expect(find(snsSubscriptionConfirmation())).toEqual({
      provider: SubscriptionConfirmationProvider.AmazonSns,
      action: SubscriptionConfirmationAction.ConfirmSubscription,
      url: SNS_SUBSCRIBE_URL,
      topic: SNS_TOPIC_ARN,
      sentAt: new Date(SNS_SENT_AT),
      expiresAt: new Date(
        new Date(SNS_SENT_AT).getTime() + SNS_CONFIRMATION_VALID_FOR_MS,
      ),
    });
  });

  test("its link works for two days, as SNS documents its tokens", () => {
    expect(SNS_CONFIRMATION_VALID_FOR_MS).toBe(48 * 60 * 60 * 1000);
  });

  test("keeps its link and its token, each where it sits in the body", () => {
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(
        snsSubscriptionConfirmation(),
      ),
    ).toEqual([
      { path: ["SubscribeURL"], value: SNS_SUBSCRIBE_URL },
      { path: ["Token"], value: SNS_TOKEN },
    ]);
  });

  test("with no Token field keeps its link alone", () => {
    const body: JSONObject = snsSubscriptionConfirmation();
    delete body["Token"];

    expect(find(body)?.url).toBe(SNS_SUBSCRIBE_URL);
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(body),
    ).toEqual([{ path: ["SubscribeURL"], value: SNS_SUBSCRIBE_URL }]);
  });

  test("from China and GovCloud regions, and to a FIFO topic, is found", () => {
    const chinaArn: string = "arn:aws-cn:sns:cn-north-1:123456789012:alerts";
    const govArn: string =
      "arn:aws-us-gov:sns:us-gov-west-1:123456789012:alerts.fifo";

    expect(
      find(
        snsWithUrl(
          snsUrl(
            `Action=ConfirmSubscription&TopicArn=${chinaArn}&Token=${SNS_TOKEN}`,
            "https://sns.cn-north-1.amazonaws.com.cn/",
          ),
          { TopicArn: chinaArn },
        ),
      )?.topic,
    ).toBe(chinaArn);
    expect(
      find(
        snsWithUrl(
          snsUrl(
            `Action=ConfirmSubscription&TopicArn=${govArn}&Token=${SNS_TOKEN}`,
            "https://sns.us-gov-west-1.amazonaws.com/",
          ),
          { TopicArn: govArn },
        ),
      )?.topic,
    ).toBe(govArn);
  });

  test("whose host is written in capitals is read as the browser reads it", () => {
    const confirmation: IncomingRequestSubscriptionConfirmation | null = find(
      snsWithUrl(snsUrl(SNS_QUERY, "https://SNS.EU-WEST-1.AMAZONAWS.COM/")),
    );

    expect(confirmation?.url).toBe(SNS_SUBSCRIBE_URL);
  });

  test("with a token a query reads a space into is still its own", () => {
    const token: string = "abc+def/ghi=";

    expect(
      find(
        snsWithUrl(
          snsUrl(
            `Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${token}`,
          ),
          { Token: token },
        ),
      )?.url,
    ).not.toBeNull();
  });

  test("with no time it was sent is offered with no end to its window", () => {
    const confirmation: IncomingRequestSubscriptionConfirmation | null = find(
      snsSubscriptionConfirmation({ Timestamp: "not a time" }),
    );

    expect(confirmation?.sentAt).toBeNull();
    expect(confirmation?.expiresAt).toBeNull();
    expect(
      IncomingRequestSubscriptionConfirmationUtil.hasExpired(
        confirmation!,
        new Date("2099-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("an Amazon SNS UnsubscribeConfirmation", () => {
  test("is found, its link restoring the subscription", () => {
    const confirmation: IncomingRequestSubscriptionConfirmation | null = find(
      snsUnsubscribeConfirmation(),
    );

    expect(confirmation?.provider).toBe(
      SubscriptionConfirmationProvider.AmazonSns,
    );
    expect(confirmation?.action).toBe(
      SubscriptionConfirmationAction.RestoreSubscription,
    );
    expect(confirmation?.url).toBe(SNS_SUBSCRIBE_URL);
  });
});

describe("a copy cut before the link was kept", () => {
  /*
   * The readers' copy, a monitoring log's row and an incident's summary of
   * a confirmation that came before #7723 hold the link as the rules left
   * it: ...&Token=[REDACTED]. It is still a confirmation - the notice says
   * how to get a new one - but there is no link to open.
   */
  test("is found, with no link", () => {
    const masked: JSONObject = snsWithUrl(
      snsUrl(
        `Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${MASKED_VALUE}`,
      ),
      { Token: MASKED_VALUE },
    );

    const confirmation: IncomingRequestSubscriptionConfirmation | null =
      find(masked);

    expect(confirmation?.action).toBe(
      SubscriptionConfirmationAction.ConfirmSubscription,
    );
    expect(confirmation?.url).toBeNull();
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(masked),
    ).toEqual([]);
  });

  test("masks with the mask the credential rules write", () => {
    expect(MASKED_VALUE).toBe(REDACTED);
  });

  test("of Event Grid's link is found, with no link", () => {
    const masked: JSONArray = eventGridValidation({
      validationUrl: EVENT_GRID_VALIDATION_URL.replace(
        `token=${EVENT_GRID_TOKEN}`,
        `token=${MASKED_VALUE}`,
      ),
    });

    expect(find(masked)?.url).toBeNull();
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(masked),
    ).toEqual([]);
  });
});

describe("a link that is not exactly the one SNS sends is never offered", () => {
  test.each([
    [
      "over plain http",
      snsUrl(SNS_QUERY, "http://sns.eu-west-1.amazonaws.com/"),
    ],
    [
      "on a host that only starts like SNS's",
      snsUrl(SNS_QUERY, "https://sns.eu-west-1.amazonaws.com.evil.example/"),
    ],
    [
      "on a host that only ends like SNS's",
      snsUrl(SNS_QUERY, "https://evilsns.eu-west-1.amazonaws.com/"),
    ],
    ["on another host", snsUrl(SNS_QUERY, "https://evil.example/")],
    [
      "on SNS's global name, which sends no confirmations",
      snsUrl(SNS_QUERY, "https://sns.amazonaws.com/"),
    ],
    [
      "with a user name and password",
      snsUrl(SNS_QUERY, "https://user:pass@sns.eu-west-1.amazonaws.com/"),
    ],
    [
      "on another port",
      snsUrl(SNS_QUERY, "https://sns.eu-west-1.amazonaws.com:8443/"),
    ],
    [
      "to another path",
      snsUrl(SNS_QUERY, "https://sns.eu-west-1.amazonaws.com/redirect"),
    ],
    ["with a fragment", `${SNS_SUBSCRIBE_URL}#next`],
    [
      "to another action",
      snsUrl(`Action=Unsubscribe&TopicArn=${SNS_TOPIC_ARN}&Token=${SNS_TOKEN}`),
    ],
    ["naming its action twice", `${SNS_SUBSCRIBE_URL}&Action=Unsubscribe`],
    [
      "with a parameter SNS never sends",
      `${SNS_SUBSCRIBE_URL}&SubscriptionArn=${SNS_TOPIC_ARN}:2bcfbf39`,
    ],
    [
      "without its token",
      snsUrl(`Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}`),
    ],
    [
      "with an empty token",
      snsUrl(`Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=`),
    ],
    [
      "for something that is not an SNS topic",
      snsUrl(
        `Action=ConfirmSubscription&TopicArn=arn:aws:s3:::acme-bucket&Token=${SNS_TOKEN}`,
      ),
    ],
    [
      "with a token holding a control character",
      snsUrl(
        `Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=abc%0Adef`,
      ),
    ],
    ["that is not a URL", "sns.eu-west-1.amazonaws.com/?Action=Confirm"],
    [
      "longer than any link SNS sends",
      snsUrl(
        `Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${"a".repeat(5000)}`,
      ),
    ],
  ])("%s", (_label: string, subscribeUrl: string) => {
    const body: JSONObject = snsWithUrl(subscribeUrl);
    delete body["Token"];

    expect(find(body)).toBeNull();
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(body),
    ).toEqual([]);
  });

  test("for another topic than the message names", () => {
    expect(
      find(
        snsSubscriptionConfirmation({
          TopicArn: "arn:aws:sns:eu-west-1:123456789012:another-topic",
        }),
      ),
    ).toBeNull();
  });

  test("with another token than the message carries", () => {
    expect(
      find(snsSubscriptionConfirmation({ Token: "a-different-token" })),
    ).toBeNull();
  });

  test("whose token field is not text", () => {
    expect(find(snsSubscriptionConfirmation({ Token: 12345 }))).toBeNull();
  });

  test("whose SubscribeURL is not text", () => {
    expect(
      find(snsSubscriptionConfirmation({ SubscribeURL: { href: "x" } })),
    ).toBeNull();
  });
});

describe("what is not a subscription confirmation", () => {
  test.each([
    ["an SNS notification", snsNotification()],
    [
      "a body that only names the type",
      { Type: "SubscriptionConfirmation" } as JSONObject,
    ],
    [
      "another type with a SubscribeURL",
      snsSubscriptionConfirmation({ Type: "Notification" }),
    ],
    ["a heartbeat", { status: "up", version: "1.2.3" } as JSONObject],
    ["an empty body", {} as JSONObject],
  ])("%s", (_label: string, body: JSONObject) => {
    expect(find(body)).toBeNull();
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(body),
    ).toEqual([]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    [
      "a text, even one that holds a confirmation",
      JSON.stringify(snsSubscriptionConfirmation()),
    ],
    ["a number", 42],
    ["an empty list", []],
  ])("%s", (_label: string, body: unknown) => {
    expect(find(body)).toBeNull();
  });
});

describe("an Azure Event Grid SubscriptionValidationEvent", () => {
  test("is found, with its link, its topic and when it stops working", () => {
    expect(find(eventGridValidation())).toEqual({
      provider: SubscriptionConfirmationProvider.AzureEventGrid,
      action: SubscriptionConfirmationAction.ValidateSubscription,
      url: EVENT_GRID_VALIDATION_URL,
      topic: EVENT_GRID_TOPIC,
      sentAt: new Date(EVENT_GRID_SENT_AT),
      expiresAt: new Date(
        new Date(EVENT_GRID_SENT_AT).getTime() +
          EVENT_GRID_VALIDATION_VALID_FOR_MS,
      ),
    });
  });

  test("its link works for 10 minutes, as Event Grid documents it", () => {
    expect(EVENT_GRID_VALIDATION_VALID_FOR_MS).toBe(10 * 60 * 1000);
  });

  test("keeps its link and its code, each where it sits in the body", () => {
    expect(
      IncomingRequestSubscriptionConfirmationUtil.getFieldsToKeep(
        eventGridValidation(),
      ),
    ).toEqual([
      {
        path: [0, "data", "validationUrl"],
        value: EVENT_GRID_VALIDATION_URL,
      },
      {
        path: [0, "data", "validationCode"],
        value: "512d38b6-c7b8-40c8-89fe-f46f9e9622b6",
      },
    ]);
  });

  test("from Azure Government and Azure China is found", () => {
    for (const host of [
      "rp-usgovvirginia.eventgrid.azure.us",
      "rp-chinaeast2.eventgrid.chinacloudapi.cn",
    ]) {
      expect(
        find(
          eventGridValidation({
            validationUrl: EVENT_GRID_VALIDATION_URL.replace(
              "rp-eastus2.eventgrid.azure.net",
              host,
            ),
          }),
        )?.url,
      ).toContain(host);
    }
  });

  test.each([
    [
      "over plain http",
      EVENT_GRID_VALIDATION_URL.replace("https://", "http://"),
    ],
    [
      "on another host",
      EVENT_GRID_VALIDATION_URL.replace(
        "rp-eastus2.eventgrid.azure.net",
        "evil.example",
      ),
    ],
    [
      "on a host that only starts like Event Grid's",
      EVENT_GRID_VALIDATION_URL.replace(
        "rp-eastus2.eventgrid.azure.net",
        "rp-eastus2.eventgrid.azure.net.evil.example",
      ),
    ],
    [
      "to another path",
      EVENT_GRID_VALIDATION_URL.replace("/validate?", "/delete?"),
    ],
    [
      "without its token",
      EVENT_GRID_VALIDATION_URL.replace(`&token=${EVENT_GRID_TOKEN}`, ""),
    ],
    ["naming its token twice", `${EVENT_GRID_VALIDATION_URL}&token=another`],
    [
      "with a user name",
      EVENT_GRID_VALIDATION_URL.replace("https://", "https://user@"),
    ],
  ])("is not offered with a link %s", (_label: string, url: string) => {
    expect(find(eventGridValidation({ validationUrl: url }))).toBeNull();
  });

  test("of another event type is not one", () => {
    const body: JSONArray = eventGridValidation();
    (body[0] as JSONObject)["eventType"] = "Microsoft.Storage.BlobCreated";

    expect(find(body)).toBeNull();
  });

  test("that is not the first event of what Event Grid posted is not one", () => {
    const body: JSONArray = [
      { eventType: "Microsoft.Storage.BlobCreated", data: {} },
      ...eventGridValidation(),
    ];

    expect(find(body)).toBeNull();
  });

  test("without its data is not one", () => {
    const body: JSONArray = eventGridValidation();
    delete (body[0] as JSONObject)["data"];

    expect(find(body)).toBeNull();
  });
});

describe("whether a link has stopped working", () => {
  const confirmation: IncomingRequestSubscriptionConfirmation = find(
    snsSubscriptionConfirmation(),
  )!;
  const expiresAt: number = confirmation.expiresAt!.getTime();

  test("it works until its window closes", () => {
    expect(
      IncomingRequestSubscriptionConfirmationUtil.hasExpired(
        confirmation,
        new Date(expiresAt - 1),
      ),
    ).toBe(false);
  });

  test("it does not from the moment its window closes", () => {
    expect(
      IncomingRequestSubscriptionConfirmationUtil.hasExpired(
        confirmation,
        new Date(expiresAt),
      ),
    ).toBe(true);
  });
});
