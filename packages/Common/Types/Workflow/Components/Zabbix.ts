import IconProp from "../../Icon/IconProp";
import { JSONObject, JSONValue } from "../../JSON";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * UPDATE ZABBIX PROBLEM.
 *
 * The templates that write back to Zabbix - acknowledge or close a problem
 * when its incident or alert is acknowledged or resolved, add a private
 * note to it as a message - each called Zabbix's JSON-RPC API through two
 * API steps, with a script between them that read the problem and chose
 * what to send, a script after them that read Zabbix's answer (Zabbix
 * answers a refused request with HTTP 200 and the reason in its body), two
 * If / Elses and a Log on every way out: sixteen steps. This is all of that
 * as one step.
 *
 * Asked to acknowledge or to close, it reads the problem first, and leaves
 * one Zabbix already resolved, or already acknowledged, as it is - which is
 * also what settles the echo of a change that came from Zabbix. A problem
 * whose trigger does not allow closing problems by hand is acknowledged
 * instead, and its message says it stays open until Zabbix sees it
 * recover: Zabbix refuses to close one, and nothing would reach Zabbix at
 * all. Asked to add a message, it adds it.
 */

// The step category it belongs to, and its group in the Add Component panel.
export const ZABBIX_COMPONENT_CATEGORY: string = "Zabbix";

/*
 * The flags of event.acknowledge's action, a bitmask: the step closes,
 * acknowledges and adds a message.
 */
export const ZABBIX_ACTION_CLOSE: number = 1;
export const ZABBIX_ACTION_ACKNOWLEDGE: number = 2;
export const ZABBIX_ACTION_MESSAGE: number = 4;

/** The longest message Zabbix keeps on a problem: its column holds 2,048 characters. */
export const ZABBIX_MESSAGE_MAX_LENGTH: number = 2048;

// Zabbix numbers its events: what an event ID is.
const ZABBIX_EVENT_ID_PATTERN: RegExp = /^[0-9]{1,20}$/;

// What the step can be asked to do to a problem.
export enum ZabbixProblemUpdate {
  Acknowledge = "acknowledge",
  Close = "close",
  Message = "message",
}

// Added to the message of a problem acknowledged because it cannot be closed.
export const ZABBIX_CANNOT_CLOSE_SENTENCE: string =
  "Its trigger does not allow closing problems by hand, so the problem stays open until Zabbix sees it recover.";

export const ZABBIX_UPDATE_PORT_IDS: {
  readonly updated: string;
  readonly unchanged: string;
  readonly error: string;
} = {
  updated: "updated",
  unchanged: "unchanged",
  error: "error",
};

export const ZABBIX_UPDATE_ARGUMENT_IDS: {
  readonly zabbixUrl: string;
  readonly apiToken: string;
  readonly eventId: string;
  readonly whatToDo: string;
  readonly message: string;
  readonly zabbix60: string;
} = {
  zabbixUrl: "zabbix-url",
  apiToken: "api-token",
  eventId: "event-id",
  whatToDo: "what-to-do",
  message: "message",
  zabbix60: "zabbix-6-0",
};

export type ReadZabbixProblemUpdateFunction = (
  value: unknown,
) => ZabbixProblemUpdate | null;

// What the step was asked to do, or null when it was asked nothing it does.
export const readZabbixProblemUpdate: ReadZabbixProblemUpdateFunction = (
  value: unknown,
): ZabbixProblemUpdate | null => {
  const word: string =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  if (word === "acknowledge" || word === "acknowledged" || word === "ack") {
    return ZabbixProblemUpdate.Acknowledge;
  }

  if (word === "close" || word === "closed" || word === "resolve") {
    return ZabbixProblemUpdate.Close;
  }

  if (word === "message" || word === "note" || word === "comment") {
    return ZabbixProblemUpdate.Message;
  }

  return null;
};

export type IsZabbixEventIdFunction = (value: string) => boolean;

export const isZabbixEventId: IsZabbixEventIdFunction = (
  value: string,
): boolean => {
  return ZABBIX_EVENT_ID_PATTERN.test(value);
};

export type ZabbixApiUrlFunction = (zabbixUrl: string) => string;

/*
 * Where every request goes: Zabbix's one JSON-RPC endpoint, under the
 * address people open Zabbix at, without the slash it may end with.
 */
export const getZabbixApiUrl: ZabbixApiUrlFunction = (
  zabbixUrl: string,
): string => {
  let end: number = zabbixUrl.length;

  while (end > 0 && zabbixUrl.charAt(end - 1) === "/") {
    end--;
  }

  return `${zabbixUrl.slice(0, end)}/api_jsonrpc.php`;
};

export type ZabbixRequestBodyFunction = (
  method: string,
  params: JSONObject,
  auth?: string | undefined,
) => JSONObject;

/*
 * A JSON-RPC 2.0 request, as Zabbix's API takes one. Zabbix 6.0 reads the
 * API token from the request's auth member, right after jsonrpc; 6.4 and
 * later read it from the Authorization header, and 7.2 refuses auth.
 */
export const getZabbixRequestBody: ZabbixRequestBodyFunction = (
  method: string,
  params: JSONObject,
  auth?: string | undefined,
): JSONObject => {
  if (auth) {
    return {
      jsonrpc: "2.0",
      auth: auth,
      method: method,
      params: params,
      id: 1,
    };
  }

  return { jsonrpc: "2.0", method: method, params: params, id: 1 };
};

const asText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
};

// A line of Zabbix's own text, for a sentence: on one line, and not too long.
const oneLine: (value: unknown) => string = (value: unknown): string => {
  let text: string = "";
  let lastWasSpace: boolean = false;

  for (const character of asText(value)) {
    const isSpace: boolean =
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t";

    if (isSpace) {
      lastWasSpace = text.length > 0;
      continue;
    }

    if (lastWasSpace) {
      text += " ";
      lastWasSpace = false;
    }

    text += character;

    if (text.length >= 500) {
      return text + "…";
    }
  }

  return text;
};

export type ZabbixAnswer =
  | { result: JSONValue; error?: undefined }
  | { result?: undefined; error: string };

export type ReadZabbixAnswerFunction = (body: unknown) => ZabbixAnswer;

/*
 * Zabbix's API answers with HTTP 200 even when it refuses a request, and
 * says why in the body: its result, or why there is none.
 */
export const readZabbixAnswer: ReadZabbixAnswerFunction = (
  body: unknown,
): ZabbixAnswer => {
  let answer: unknown = body;

  if (typeof answer === "string") {
    try {
      answer = JSON.parse(answer);
    } catch {
      answer = null;
    }
  }

  if (
    !answer ||
    typeof answer !== "object" ||
    Array.isArray(answer) ||
    (!("result" in answer) && !(answer as JSONObject)["error"])
  ) {
    return {
      error:
        "The answer did not come from Zabbix's API. Check that the Zabbix URL is the address you open Zabbix at.",
    };
  }

  const error: unknown = (answer as JSONObject)["error"];

  if (error) {
    const parts: Array<string> = [
      oneLine((error as JSONObject)["message"]),
      oneLine((error as JSONObject)["data"]),
    ].filter((part: string): boolean => {
      return part !== "";
    });

    return {
      error: `Zabbix said: ${parts.join(" ") || "an error with no message"}`,
    };
  }

  return { result: (answer as JSONObject)["result"] as JSONValue };
};

export type ZabbixUpdateChoice =
  | { send: false; reason: string }
  | {
      send: true;
      action: number;
      message: string;
      summary: string;
    };

const limit: (value: string, max: number) => string = (
  value: string,
  max: number,
): string => {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
};

export type ChooseZabbixUpdateFunction = (data: {
  wanted: ZabbixProblemUpdate.Acknowledge | ZabbixProblemUpdate.Close;
  eventId: string;
  message: string;
  // event.get's result for the event.
  events: JSONValue;
}) => ZabbixUpdateChoice;

/*
 * What to send for an acknowledge or a close, now that the problem has been
 * read: nothing for a problem Zabbix already resolved, or already
 * acknowledged when that is all that was asked; an acknowledgement in place
 * of a close Zabbix would refuse.
 */
export const chooseZabbixUpdate: ChooseZabbixUpdateFunction = (data: {
  wanted: ZabbixProblemUpdate.Acknowledge | ZabbixProblemUpdate.Close;
  eventId: string;
  message: string;
  events: JSONValue;
}): ZabbixUpdateChoice => {
  const events: Array<JSONValue> = Array.isArray(data.events)
    ? data.events
    : [];
  const problem: JSONObject | undefined = events.find(
    (candidate: JSONValue): boolean => {
      return (
        Boolean(candidate) &&
        typeof candidate === "object" &&
        asText((candidate as JSONObject)["eventid"]) === data.eventId
      );
    },
  ) as JSONObject | undefined;

  if (!problem) {
    return {
      send: false,
      reason: `Zabbix has no problem with event ID ${data.eventId}, or the API token's user cannot see it, so Zabbix was not updated.`,
    };
  }

  const recoveryEventId: string = asText(problem["r_eventid"]);
  const isResolved: boolean =
    isZabbixEventId(recoveryEventId) && recoveryEventId !== "0";
  const isAcknowledged: boolean = asText(problem["acknowledged"]) === "1";
  const trigger: JSONObject =
    problem["relatedObject"] && typeof problem["relatedObject"] === "object"
      ? (problem["relatedObject"] as JSONObject)
      : {};
  const canClose: boolean = asText(trigger["manual_close"]) === "1";

  if (isResolved) {
    return {
      send: false,
      reason: `Zabbix problem ${data.eventId} is already resolved in Zabbix, so it was left as it is.`,
    };
  }

  if (data.wanted === ZabbixProblemUpdate.Acknowledge) {
    if (isAcknowledged) {
      return {
        send: false,
        reason: `Zabbix problem ${data.eventId} is already acknowledged in Zabbix, so it was left as it is.`,
      };
    }

    return {
      send: true,
      action: ZABBIX_ACTION_ACKNOWLEDGE + ZABBIX_ACTION_MESSAGE,
      message: limit(data.message, ZABBIX_MESSAGE_MAX_LENGTH),
      summary: `Acknowledged Zabbix problem ${data.eventId}.`,
    };
  }

  if (canClose) {
    return {
      send: true,
      action:
        ZABBIX_ACTION_CLOSE + ZABBIX_ACTION_ACKNOWLEDGE + ZABBIX_ACTION_MESSAGE,
      message: limit(data.message, ZABBIX_MESSAGE_MAX_LENGTH),
      summary: `Closed Zabbix problem ${data.eventId}.`,
    };
  }

  return {
    send: true,
    action: ZABBIX_ACTION_ACKNOWLEDGE + ZABBIX_ACTION_MESSAGE,
    message: limit(
      data.message
        ? `${data.message} ${ZABBIX_CANNOT_CLOSE_SENTENCE}`
        : ZABBIX_CANNOT_CLOSE_SENTENCE,
      ZABBIX_MESSAGE_MAX_LENGTH,
    ),
    summary: `Acknowledged Zabbix problem ${data.eventId}: its trigger does not allow closing problems by hand.`,
  };
};

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.ZabbixUpdateProblem,
    title: "Update Zabbix Problem",
    category: ZABBIX_COMPONENT_CATEGORY,
    description:
      "Acknowledge or close a problem in Zabbix, or add a message to it, through Zabbix's API.",
    iconProp: IconProp.ServerStack,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.zabbixUrl,
        name: "Zabbix URL",
        description:
          "The address you open Zabbix at, such as https://zabbix.example.com.",
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://zabbix.example.com",
      },
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.apiToken,
        name: "API Token",
        description:
          "A Zabbix API token of a user who may acknowledge, comment on and close problems. Keep it in a secret variable.",
        type: ComponentInputType.Text,
        required: true,
        isSensitive: true,
      },
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.eventId,
        name: "Event ID",
        description:
          "The problem's event ID in Zabbix, usually from an earlier step.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "40312",
      },
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.whatToDo,
        name: "What To Do",
        description:
          "acknowledge, close or message. Empty, Zabbix is not updated.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "close",
      },
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.message,
        name: "Message",
        description: `The message Zabbix keeps on the problem, at most ${ZABBIX_MESSAGE_MAX_LENGTH} characters.`,
        type: ComponentInputType.LongText,
        required: false,
      },
      {
        id: ZABBIX_UPDATE_ARGUMENT_IDS.zabbix60,
        name: "Zabbix 6.0",
        description:
          "On for Zabbix 6.0, which reads the API token from the request body. Zabbix 6.4 and later read it from a header.",
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
    ],
    returnValues: [
      {
        id: "summary",
        name: "Summary",
        description: "What the step did, in a sentence.",
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: "In",
        description: "Connect the step that runs before this one.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Updated",
        description: "Runs next when Zabbix took the update.",
        id: ZABBIX_UPDATE_PORT_IDS.updated,
      },
      {
        title: "Unchanged",
        description:
          "Runs next when there was nothing to send: the problem is already resolved or acknowledged, or not found.",
        id: ZABBIX_UPDATE_PORT_IDS.unchanged,
      },
      {
        title: "Error",
        description:
          "Runs next when Zabbix could not be reached, or refused the update.",
        id: ZABBIX_UPDATE_PORT_IDS.error,
      },
    ],
  },
];

export default components;
