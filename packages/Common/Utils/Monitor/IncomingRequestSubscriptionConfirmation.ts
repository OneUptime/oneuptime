import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";

/*
 * A SUBSCRIPTION CONFIRMATION SENT TO AN INCOMING REQUEST MONITOR.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Two cloud services deliver to an HTTPS endpoint only once its owner has
 * confirmed that they want the deliveries, and both ask by sending the
 * endpoint a link to open:
 *
 *   - Amazon SNS, for an HTTPS subscription to a topic: a
 *     SubscriptionConfirmation whose SubscribeURL confirms the subscription
 *     (and an UnsubscribeConfirmation, when the subscription is deleted,
 *     whose SubscribeURL restores it). Its Token - which the link carries
 *     too - is valid for two days, and nothing is delivered until then.
 *   - Azure Event Grid, for a webhook event subscription: a
 *     SubscriptionValidationEvent whose validationUrl validates the
 *     subscription, for 10 minutes. OneUptime answers every request with
 *     an empty 200 and so cannot echo the validationCode back, which leaves
 *     the link as the only way to validate.
 *
 * The copies of a request people read are cut by the credential rules
 * (MonitorRecordEvidence), and those read "Token" - the field, and token=
 * inside a URL - as a credential, so the very link the owner had to open
 * reached them as ...&Token=[REDACTED]. The link is not a credential: all
 * it can do is start deliveries to this monitor from the topic that asked,
 * which whoever set up that subscription can already send here. So the
 * copies keep it, and the monitor's summary offers it as a button.
 *
 * Only a link that is exactly what the service sends counts: https, on the
 * service's own host, to its confirm (or validate) endpoint, with nothing
 * else in its query. Anyone who knows the monitor's URL can send it
 * anything, and a button reading "Confirm Subscription" must never lead
 * anywhere else - an Unsubscribe link of another subscription, say, or a
 * page off AWS.
 *
 * Shared by the server, which keeps the link when it cuts a copy, and the
 * Dashboard, which finds it in the copy it reads: one set of rules for both.
 */

export enum SubscriptionConfirmationProvider {
  AmazonSns = "Amazon SNS",
  AzureEventGrid = "Azure Event Grid",
}

export enum SubscriptionConfirmationAction {
  // Amazon SNS SubscriptionConfirmation: the link confirms a new subscription.
  ConfirmSubscription = "ConfirmSubscription",
  // Amazon SNS UnsubscribeConfirmation: the link restores a deleted one.
  RestoreSubscription = "RestoreSubscription",
  // Azure Event Grid SubscriptionValidationEvent.
  ValidateSubscription = "ValidateSubscription",
}

export interface IncomingRequestSubscriptionConfirmation {
  provider: SubscriptionConfirmationProvider;
  action: SubscriptionConfirmationAction;
  /*
   * The link to open, as the browser will read it. Null when the copy it was
   * read from had its token masked: a copy cut before the link was kept.
   */
  url: string | null;
  // The topic, as the service names it: an SNS topic ARN, an Event Grid topic.
  topic: string | null;
  // When the service sent it, when the message says.
  sentAt: Date | null;
  // When the link stops working: sentAt and the service's documented window.
  expiresAt: Date | null;
}

// What each field of a confirmation the copies keep, and where it sits.
export interface SubscriptionConfirmationField {
  path: Array<string | number>;
  value: string;
}

/*
 * The mask the credential rules write (LogRedaction.REDACTED). Written out
 * here rather than imported, because this file is shared with the
 * Dashboard and LogRedaction is server code; a test holds the two equal.
 */
export const MASKED_VALUE: string = "[REDACTED]";

// Amazon SNS: confirmation tokens are valid for two days.
export const SNS_CONFIRMATION_VALID_FOR_MS: number = 2 * 24 * 60 * 60 * 1000;

// Azure Event Grid: the validation URL is valid for 10 minutes.
export const EVENT_GRID_VALIDATION_VALID_FOR_MS: number = 10 * 60 * 1000;

const SNS_SUBSCRIPTION_CONFIRMATION: string = "SubscriptionConfirmation";
const SNS_UNSUBSCRIBE_CONFIRMATION: string = "UnsubscribeConfirmation";

const EVENT_GRID_VALIDATION_EVENT_TYPE: string =
  "Microsoft.EventGrid.SubscriptionValidationEvent";

/*
 * SNS's regional endpoints, sns.<region>.amazonaws.com, and in China
 * sns.<region>.amazonaws.com.cn.
 */
const SNS_HOST: RegExp = /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/;

// arn:<partition>:sns:<region>:<account>:<topic>, a FIFO topic's .fifo included.
const SNS_TOPIC_ARN: RegExp =
  /^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]{1,256}$/;

// The parameters an SNS SubscribeURL holds: these, once each, and no other.
const SNS_SUBSCRIBE_URL_PARAMETERS: ReadonlyArray<string> = [
  "Action",
  "TopicArn",
  "Token",
];

const SNS_CONFIRM_ACTION: string = "ConfirmSubscription";

/*
 * Event Grid's regional endpoints, rp-<region>.eventgrid.azure.net, and
 * their Azure Government and Azure China counterparts.
 */
const EVENT_GRID_HOST: RegExp =
  /^[a-z0-9-]+\.eventgrid\.(?:azure\.net|azure\.us|chinacloudapi\.cn)$/;

// /eventsubscriptions/<name>/validate
const EVENT_GRID_VALIDATE_PATH: RegExp =
  /^\/eventsubscriptions\/[^/]+\/validate$/i;

const EVENT_GRID_TOKEN_PARAMETER: string = "token";

/*
 * A token as a service writes it: text of a bounded length, with no
 * control character in it. A link's own shape (its host, its endpoint, its
 * query) is what decides whether it is the service's; this only turns away
 * a value no service would mint. A space is allowed: a query reads a "+"
 * as one.
 */
// eslint-disable-next-line no-control-regex
const TOKEN_TEXT: RegExp = /^[^\u0000-\u001f\u007f]{1,4096}$/;

// Longer than any link either service sends: anything longer is not one.
const MAX_URL_LENGTH: number = 4096;

type ParseUrlFunction = (text: string) => globalThis.URL | null;

const parseUrl: ParseUrlFunction = (text: string): globalThis.URL | null => {
  if (!text || text.length > MAX_URL_LENGTH) {
    return null;
  }

  try {
    return new globalThis.URL(text);
  } catch {
    return null;
  }
};

/*
 * https, no user name or password, the default port and no fragment: the
 * shape of every link both services send.
 */
type IsPlainHttpsUrlFunction = (url: globalThis.URL) => boolean;

const isPlainHttpsUrl: IsPlainHttpsUrlFunction = (
  url: globalThis.URL,
): boolean => {
  return (
    url.protocol === "https:" && !url.username && !url.password && !url.hash
  );
};

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
};

type IsMaskedFunction = (text: string) => boolean;

const isMasked: IsMaskedFunction = (text: string): boolean => {
  return text.indexOf(MASKED_VALUE) !== -1;
};

type ToDateFunction = (value: unknown) => Date | null;

const toDate: ToDateFunction = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? new Date(time) : null;
};

type AddMsFunction = (date: Date | null, ms: number) => Date | null;

const addMs: AddMsFunction = (date: Date | null, ms: number): Date | null => {
  return date ? new Date(date.getTime() + ms) : null;
};

// One value of a query parameter, or null when it is missing or repeated.
type SingleParameterFunction = (
  url: globalThis.URL,
  name: string,
) => string | null;

const singleParameter: SingleParameterFunction = (
  url: globalThis.URL,
  name: string,
): string | null => {
  const values: Array<string> = url.searchParams.getAll(name);

  return values.length === 1 ? (values[0] as string) : null;
};

interface Recognized {
  confirmation: IncomingRequestSubscriptionConfirmation;
  // The fields the copies keep, read from the body that was handed in.
  fields: Array<SubscriptionConfirmationField>;
}

export default class IncomingRequestSubscriptionConfirmationUtil {
  /*
   * The subscription confirmation a request's body is, or null when it is
   * not one. The body is the request's parsed body - an object or an
   * array, as the endpoint keeps it - from any copy: the request as it
   * came, the copy people read, a monitoring log's row or an incident's
   * summary.
   */
  public static find(
    requestBody: unknown,
  ): IncomingRequestSubscriptionConfirmation | null {
    return (
      IncomingRequestSubscriptionConfirmationUtil.recognize(requestBody)
        ?.confirmation || null
    );
  }

  /*
   * The fields of a confirmation a copy keeps as they came - the link, and
   * the token the link carries - each with where it sits in the body. Empty
   * when the body is not a confirmation, or when its link cannot be opened
   * (its token was masked before it got here).
   */
  public static getFieldsToKeep(
    requestBody: unknown,
  ): Array<SubscriptionConfirmationField> {
    const recognized: Recognized | null =
      IncomingRequestSubscriptionConfirmationUtil.recognize(requestBody);

    if (!recognized || !recognized.confirmation.url) {
      return [];
    }

    return recognized.fields;
  }

  /*
   * Has the link stopped working? Only when the message says when it was
   * sent: a link with no known send time is offered.
   */
  public static hasExpired(
    confirmation: IncomingRequestSubscriptionConfirmation,
    now: Date,
  ): boolean {
    return Boolean(
      confirmation.expiresAt &&
        now.getTime() >= confirmation.expiresAt.getTime(),
    );
  }

  private static recognize(requestBody: unknown): Recognized | null {
    if (isPlainObject(requestBody)) {
      return IncomingRequestSubscriptionConfirmationUtil.recognizeSns(
        requestBody,
      );
    }

    if (Array.isArray(requestBody)) {
      return IncomingRequestSubscriptionConfirmationUtil.recognizeEventGrid(
        requestBody as JSONArray,
      );
    }

    return null;
  }

  /*
   * An Amazon SNS SubscriptionConfirmation or UnsubscribeConfirmation:
   *
   *   { "Type": "SubscriptionConfirmation", "Token": "2336412f37...",
   *     "TopicArn": "arn:aws:sns:us-west-2:123456789012:MyTopic",
   *     "SubscribeURL": "https://sns.us-west-2.amazonaws.com/
   *       ?Action=ConfirmSubscription&TopicArn=arn:aws:sns:...&Token=2336412f37...",
   *     "Timestamp": "2012-04-26T20:45:04.751Z", ... }
   *
   * Its SubscribeURL must be SNS's ConfirmSubscription call on an SNS
   * endpoint, for the topic the message names, with the token the message
   * carries - unless the copy masked that token, which the link then has
   * masked too.
   */
  private static recognizeSns(body: JSONObject): Recognized | null {
    const type: JSONValue | undefined = body["Type"];

    if (
      type !== SNS_SUBSCRIPTION_CONFIRMATION &&
      type !== SNS_UNSUBSCRIBE_CONFIRMATION
    ) {
      return null;
    }

    const subscribeUrl: JSONValue | undefined = body["SubscribeURL"];

    if (typeof subscribeUrl !== "string") {
      return null;
    }

    const url: globalThis.URL | null = parseUrl(subscribeUrl);

    if (
      !url ||
      !isPlainHttpsUrl(url) ||
      url.port ||
      !SNS_HOST.test(url.hostname) ||
      url.pathname !== "/"
    ) {
      return null;
    }

    const parameterNames: Array<string> = Array.from(url.searchParams.keys());

    if (
      parameterNames.length !== SNS_SUBSCRIBE_URL_PARAMETERS.length ||
      SNS_SUBSCRIBE_URL_PARAMETERS.some((name: string): boolean => {
        return singleParameter(url, name) === null;
      })
    ) {
      return null;
    }

    const action: string | null = singleParameter(url, "Action");
    const topicArn: string | null = singleParameter(url, "TopicArn");
    const urlToken: string | null = singleParameter(url, "Token");

    if (
      action !== SNS_CONFIRM_ACTION ||
      !topicArn ||
      !SNS_TOPIC_ARN.test(topicArn) ||
      !urlToken
    ) {
      return null;
    }

    // The topic the message names is the one the link confirms.
    const bodyTopicArn: JSONValue | undefined = body["TopicArn"];

    if (bodyTopicArn !== undefined && bodyTopicArn !== topicArn) {
      return null;
    }

    const bodyToken: JSONValue | undefined = body["Token"];

    if (bodyToken !== undefined && typeof bodyToken !== "string") {
      return null;
    }

    const isLinkMasked: boolean = isMasked(urlToken);

    if (!isLinkMasked) {
      if (!TOKEN_TEXT.test(urlToken)) {
        return null;
      }

      /*
       * The token the message carries is the one in its link. A query reads
       * "+" as a space, so a token with one compares as the link reads it.
       */
      if (
        typeof bodyToken === "string" &&
        !isMasked(bodyToken) &&
        bodyToken !== urlToken &&
        bodyToken.split("+").join(" ") !== urlToken
      ) {
        return null;
      }
    }

    const sentAt: Date | null = toDate(body["Timestamp"]);

    const fields: Array<SubscriptionConfirmationField> = [
      { path: ["SubscribeURL"], value: subscribeUrl },
    ];

    if (typeof bodyToken === "string") {
      fields.push({ path: ["Token"], value: bodyToken });
    }

    return {
      confirmation: {
        provider: SubscriptionConfirmationProvider.AmazonSns,
        action:
          type === SNS_SUBSCRIPTION_CONFIRMATION
            ? SubscriptionConfirmationAction.ConfirmSubscription
            : SubscriptionConfirmationAction.RestoreSubscription,
        url: isLinkMasked ? null : url.toString(),
        topic: topicArn,
        sentAt: sentAt,
        expiresAt: addMs(sentAt, SNS_CONFIRMATION_VALID_FOR_MS),
      },
      fields: fields,
    };
  }

  /*
   * An Azure Event Grid SubscriptionValidationEvent, the one event of the
   * array Event Grid posts:
   *
   *   [{ "eventType": "Microsoft.EventGrid.SubscriptionValidationEvent",
   *      "topic": "/subscriptions/...", "eventTime": "...",
   *      "data": { "validationCode": "512d38b6-...",
   *        "validationUrl": "https://rp-eastus2.eventgrid.azure.net:553/
   *          eventsubscriptions/mysub/validate?id=...&t=...&apiVersion=...&token=..." } }]
   *
   * Its validationUrl must be Event Grid's validate endpoint, on an Event
   * Grid host (port 553, as Event Grid sends it, is allowed).
   */
  private static recognizeEventGrid(body: JSONArray): Recognized | null {
    const event: JSONValue | undefined = body[0];

    if (
      !isPlainObject(event) ||
      event["eventType"] !== EVENT_GRID_VALIDATION_EVENT_TYPE
    ) {
      return null;
    }

    const data: JSONValue | undefined = event["data"];

    if (!isPlainObject(data)) {
      return null;
    }

    const validationUrl: JSONValue | undefined = data["validationUrl"];

    if (typeof validationUrl !== "string") {
      return null;
    }

    const url: globalThis.URL | null = parseUrl(validationUrl);

    if (
      !url ||
      !isPlainHttpsUrl(url) ||
      !EVENT_GRID_HOST.test(url.hostname) ||
      !EVENT_GRID_VALIDATE_PATH.test(url.pathname)
    ) {
      return null;
    }

    const token: string | null = singleParameter(
      url,
      EVENT_GRID_TOKEN_PARAMETER,
    );

    if (!token) {
      return null;
    }

    const isLinkMasked: boolean = isMasked(token);

    if (!isLinkMasked && !TOKEN_TEXT.test(token)) {
      return null;
    }

    const topic: JSONValue | undefined = event["topic"];
    const sentAt: Date | null = toDate(event["eventTime"]);

    const fields: Array<SubscriptionConfirmationField> = [
      { path: [0, "data", "validationUrl"], value: validationUrl },
    ];

    const validationCode: JSONValue | undefined = data["validationCode"];

    if (typeof validationCode === "string") {
      fields.push({
        path: [0, "data", "validationCode"],
        value: validationCode,
      });
    }

    return {
      confirmation: {
        provider: SubscriptionConfirmationProvider.AzureEventGrid,
        action: SubscriptionConfirmationAction.ValidateSubscription,
        url: isLinkMasked ? null : url.toString(),
        topic: typeof topic === "string" && topic ? topic : null,
        sentAt: sentAt,
        expiresAt: addMs(sentAt, EVENT_GRID_VALIDATION_VALID_FOR_MS),
      },
      fields: fields,
    };
  }
}
