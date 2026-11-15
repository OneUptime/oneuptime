import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * Subscription confirmations as Amazon SNS and Azure Event Grid send them to
 * an HTTPS endpoint, shaped after the services' own documentation:
 *
 *   - https://docs.aws.amazon.com/sns/latest/dg/http-subscription-confirmation-json.html
 *   - https://docs.aws.amazon.com/sns/latest/dg/http-unsubscribe-confirmation-json.html
 *   - https://docs.aws.amazon.com/sns/latest/dg/http-notification-json.html
 *   - https://learn.microsoft.com/en-us/azure/event-grid/end-point-validation-event-grid-events-schema
 *
 * Shared by the suites that read them: the detector, the copies the server
 * cuts, the endpoint and the Dashboard's notice (#7723).
 */

export const SNS_TOKEN: string =
  "2336412f37fb687f5d51e6e241d09c805a5a57b30d712f794cc5f6a988666d92768dd60a747ba6f3beb71854e285d6ad02428b09ceece29417f1f02d609c582afbacc99c583a916b9981dd2728f4ae6fdb82efd087cc3b7849e05798d2d2785c03b0879594eeac82c01f235d0e717736";

export const SNS_TOPIC_ARN: string =
  "arn:aws:sns:eu-west-1:123456789012:oneuptime-alerts";

export const SNS_SENT_AT: string = "2026-11-13T15:59:14.732Z";

export const SNS_SIGNATURE: string =
  "EXAMPLEpH+DcEwjAPg8O9mY8dReBSwksfg2S7WKQcikcNKWLQjwu6A4VbeS0QHVCkhRS7fUQvi2egU3N858fiTDN6bkkOxYDVrY0Ad8L10Hs3zH81mtnPk5uvvolIC1CXGu43obcgFxeL3khZl8IKvO61GWB6jI9b5+gLPoBc1Q=";

export const SNS_SUBSCRIBE_URL: string = `https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${SNS_TOKEN}`;

export function snsSubscriptionConfirmation(
  overrides: JSONObject = {},
): JSONObject {
  return {
    Type: "SubscriptionConfirmation",
    MessageId: "165545c9-2a5c-472c-8df2-7ff2be2b3b1b",
    Token: SNS_TOKEN,
    TopicArn: SNS_TOPIC_ARN,
    Message: `You have chosen to subscribe to the topic ${SNS_TOPIC_ARN}.\nTo confirm the subscription, visit the SubscribeURL included in this message.`,
    SubscribeURL: SNS_SUBSCRIBE_URL,
    Timestamp: SNS_SENT_AT,
    SignatureVersion: "1",
    Signature: SNS_SIGNATURE,
    SigningCertURL:
      "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem",
    ...overrides,
  };
}

export function snsUnsubscribeConfirmation(
  overrides: JSONObject = {},
): JSONObject {
  return snsSubscriptionConfirmation({
    Type: "UnsubscribeConfirmation",
    MessageId: "47138184-6831-46b8-8f7c-afc488602d7d",
    Message: `You have chosen to deactivate subscription ${SNS_TOPIC_ARN}:2bcfbf39-05c3-41de-beaa-fcfcc21c8f55.\nTo cancel this operation and restore the subscription, visit the SubscribeURL included in this message.`,
    ...overrides,
  });
}

// What SNS sends once the subscription is confirmed: no Token, no SubscribeURL.
export function snsNotification(overrides: JSONObject = {}): JSONObject {
  return {
    Type: "Notification",
    MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
    TopicArn: SNS_TOPIC_ARN,
    Subject: "ALARM: High error rate",
    Message: '{"AlarmName":"HighErrorRate","NewStateValue":"ALARM"}',
    Timestamp: "2026-11-13T16:10:00.000Z",
    SignatureVersion: "1",
    Signature: SNS_SIGNATURE,
    SigningCertURL:
      "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem",
    UnsubscribeURL: `https://sns.eu-west-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=${SNS_TOPIC_ARN}:2bcfbf39-05c3-41de-beaa-fcfcc21c8f55`,
    ...overrides,
  };
}

// The headers SNS sends with a confirmation (the body is JSON, as text/plain).
export const SNS_CONFIRMATION_HEADERS: Dictionary<string> = {
  "x-amz-sns-message-type": "SubscriptionConfirmation",
  "x-amz-sns-message-id": "165545c9-2a5c-472c-8df2-7ff2be2b3b1b",
  "x-amz-sns-topic-arn": SNS_TOPIC_ARN,
  "content-type": "text/plain; charset=UTF-8",
  "user-agent": "Amazon Simple Notification Service Agent",
};

export const EVENT_GRID_TOKEN: string = "8YjnTyV4W2qHMLC7uYkZ0Q";

export const EVENT_GRID_TOPIC: string =
  "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/ops/providers/Microsoft.Storage/storageAccounts/acmeprod";

export const EVENT_GRID_SENT_AT: string = "2026-11-13T15:59:14.000Z";

export const EVENT_GRID_VALIDATION_URL: string = `https://rp-eastus2.eventgrid.azure.net:553/eventsubscriptions/oneuptime-heartbeat/validate?id=512d38b6-c7b8-40c8-89fe-f46f9e9622b6&t=2026-11-13T15:59:14.4538837Z&apiVersion=2018-05-01-preview&token=${EVENT_GRID_TOKEN}`;

export function eventGridValidation(data: JSONObject = {}): JSONArray {
  return [
    {
      id: "2d1781af-3a4c-4d7c-bd0c-e34b19da4e66",
      topic: EVENT_GRID_TOPIC,
      subject: "",
      data: {
        validationCode: "512d38b6-c7b8-40c8-89fe-f46f9e9622b6",
        validationUrl: EVENT_GRID_VALIDATION_URL,
        ...data,
      },
      eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
      eventTime: EVENT_GRID_SENT_AT,
      metadataVersion: "1",
      dataVersion: "1",
    },
  ];
}
