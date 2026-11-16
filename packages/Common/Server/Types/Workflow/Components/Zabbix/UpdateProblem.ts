import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import { API_COMPONENT_TARGET_VALIDATION } from "../API/Utils";
import SafeWebhookRequest, {
  WebhookAnswerTooLargeException,
  WebhookTarget,
} from "../../../../Utils/SafeWebhookRequest";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ZabbixComponents, {
  ZABBIX_ACTION_MESSAGE,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_UPDATE_ARGUMENT_IDS,
  ZABBIX_UPDATE_PORT_IDS,
  ZabbixAnswer,
  ZabbixProblemUpdate,
  ZabbixUpdateChoice,
  chooseZabbixUpdate,
  getZabbixApiUrl,
  getZabbixRequestBody,
  isZabbixEventId,
  readZabbixAnswer,
  readZabbixProblemUpdate,
} from "../../../../../Types/Workflow/Components/Zabbix";

/*
 * The most of an answer the step reads from Zabbix. It asks for one event's
 * id, state and trigger, and then for that one event to be updated: Zabbix
 * answers either in a few hundred bytes. A larger answer is not Zabbix's,
 * and is not read (issue #8875).
 */
export const ZABBIX_MAX_RESPONSE_BYTES: number = 1024 * 1024;

/*
 * Update Zabbix Problem (Types/Workflow/Components/Zabbix): reads the
 * problem, chooses what to send, sends it, and reads Zabbix's answer - one
 * request or two to Zabbix's JSON-RPC endpoint, each held to the address
 * rules of the API steps, with redirects off. The address is checked once,
 * and both requests dial what that check approved (SafeWebhookRequest).
 */
export default class ZabbixUpdateProblem extends ComponentCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined = ZabbixComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.ZabbixUpdateProblem;
      },
    );

    if (!component) {
      throw new BadDataException("Update Zabbix Problem component not found.");
    }

    this.setMetadata(component);
  }

  private getPort(id: string): Port {
    const port: Port | undefined = this.getMetadata().outPorts.find(
      (candidate: Port) => {
        return candidate.id === id;
      },
    );

    if (!port) {
      throw new BadDataException(`${id} port not found`);
    }

    return port;
  }

  private finish(
    portId: string,
    summary: string,
    options: RunOptions,
  ): RunReturnType {
    options.log(summary);

    return {
      returnValues: { summary: summary },
      executePort: this.getPort(portId),
      executePortReason: summary,
    };
  }

  /*
   * One JSON-RPC request: Zabbix's result, or why there is none - a request
   * that got no answer, an HTTP error, an answer too large to read, or
   * Zabbix saying no.
   */
  private async call(data: {
    target: WebhookTarget;
    token: string;
    tokenInBody: boolean;
    method: string;
    params: JSONObject;
  }): Promise<ZabbixAnswer> {
    let answer: HTTPResponse<JSONObject> | HTTPErrorResponse;

    try {
      // Zabbix 6.0 reads the token from the body; 6.4 and later from the header.
      answer = await SafeWebhookRequest.send<JSONObject>(data.target, {
        data: getZabbixRequestBody(
          data.method,
          data.params,
          data.tokenInBody ? data.token : undefined,
        ),
        headers: data.tokenInBody
          ? {}
          : { Authorization: `Bearer ${data.token}` },
        maxContentLength: ZABBIX_MAX_RESPONSE_BYTES,
      });
    } catch (err: unknown) {
      // Zabbix was reached: say what it answered, not that it could not be.
      if (err instanceof WebhookAnswerTooLargeException) {
        return { error: err.describe("Zabbix's answer") };
      }

      throw err;
    }

    if (answer instanceof HTTPErrorResponse) {
      return {
        error: `Zabbix answered ${answer.statusCode}: ${answer.message || "an error"}`,
      };
    }

    return readZabbixAnswer(answer.jsonData);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const ids: typeof ZABBIX_UPDATE_ARGUMENT_IDS = ZABBIX_UPDATE_ARGUMENT_IDS;
    const fail: (reason: string) => RunReturnType = (
      reason: string,
    ): RunReturnType => {
      return this.finish(ZABBIX_UPDATE_PORT_IDS.error, reason, options);
    };

    const wanted: ZabbixProblemUpdate | null = readZabbixProblemUpdate(
      args[ids.whatToDo],
    );
    const given: string =
      typeof args[ids.whatToDo] === "string"
        ? (args[ids.whatToDo] as string).trim()
        : "";

    if (!wanted) {
      return this.finish(
        ZABBIX_UPDATE_PORT_IDS.unchanged,
        given
          ? "What To Do is not acknowledge, close or message, so Zabbix was not updated."
          : "What To Do is empty, so Zabbix was not updated.",
        options,
      );
    }

    const eventId: JSONValue | undefined = args[ids.eventId];
    const eventIdText: string =
      typeof eventId === "number"
        ? String(eventId)
        : typeof eventId === "string"
          ? eventId.trim()
          : "";

    if (!isZabbixEventId(eventIdText)) {
      return fail(
        "Event ID must be a Zabbix event ID, a number, so Zabbix was not updated.",
      );
    }

    const token: string =
      typeof args[ids.apiToken] === "string"
        ? (args[ids.apiToken] as string).trim()
        : "";

    if (!token) {
      return fail("API Token is empty, so Zabbix was not updated.");
    }

    const zabbixUrl: string =
      typeof args[ids.zabbixUrl] === "string"
        ? (args[ids.zabbixUrl] as string).trim()
        : "";

    if (!zabbixUrl) {
      return fail("Zabbix URL is empty, so Zabbix was not updated.");
    }

    const message: string =
      typeof args[ids.message] === "string"
        ? (args[ids.message] as string).trim()
        : "";

    const apiUrl: string = getZabbixApiUrl(zabbixUrl);
    const tokenInBody: boolean =
      args[ids.zabbix60] === true || args[ids.zabbix60] === "true";

    /*
     * The address is held to the API steps' rules: checked as it was typed,
     * before anything is sent (ApiComponentUtils.sanitizeArgs says why), and
     * every request then dials an address the check approved.
     */
    let target: WebhookTarget;

    try {
      target = await SafeWebhookRequest.resolveTarget(
        apiUrl,
        API_COMPONENT_TARGET_VALIDATION,
      );
    } catch (err: unknown) {
      return fail(
        err instanceof Exception
          ? err.message
          : "Zabbix URL points to an address that is not allowed.",
      );
    }

    try {
      let action: number;
      let sentMessage: string;
      let summary: string;

      if (wanted === ZabbixProblemUpdate.Message) {
        if (!message) {
          return this.finish(
            ZABBIX_UPDATE_PORT_IDS.unchanged,
            "Message is empty, so Zabbix was not updated.",
            options,
          );
        }

        action = ZABBIX_ACTION_MESSAGE;
        sentMessage =
          message.length > ZABBIX_MESSAGE_MAX_LENGTH
            ? message.slice(0, ZABBIX_MESSAGE_MAX_LENGTH - 1) + "…"
            : message;
        summary = `Added the message to Zabbix problem ${eventIdText}.`;
      } else {
        const read: ZabbixAnswer = await this.call({
          target: target,
          token: token,
          tokenInBody: tokenInBody,
          method: "event.get",
          params: {
            eventids: [eventIdText],
            output: ["eventid", "r_eventid", "acknowledged"],
            selectRelatedObject: ["triggerid", "manual_close"],
          },
        });

        if (read.error !== undefined) {
          return fail(
            `Could not read Zabbix problem ${eventIdText}: ${read.error}`,
          );
        }

        const choice: ZabbixUpdateChoice = chooseZabbixUpdate({
          wanted: wanted,
          eventId: eventIdText,
          message: message,
          events: read.result,
        });

        if (!choice.send) {
          return this.finish(
            ZABBIX_UPDATE_PORT_IDS.unchanged,
            choice.reason,
            options,
          );
        }

        action = choice.action;
        sentMessage = choice.message;
        summary = choice.summary;
      }

      const params: JSONObject = {
        eventids: [eventIdText],
        action: action,
      };

      if (sentMessage) {
        params["message"] = sentMessage;
      }

      const sent: ZabbixAnswer = await this.call({
        target: target,
        token: token,
        tokenInBody: tokenInBody,
        method: "event.acknowledge",
        params: params,
      });

      if (sent.error !== undefined) {
        return fail(
          `Zabbix did not update problem ${eventIdText}: ${sent.error}`,
        );
      }

      const updated: unknown =
        sent.result && typeof sent.result === "object"
          ? (sent.result as JSONObject)["eventids"]
          : null;

      if (!Array.isArray(updated) || updated.length === 0) {
        return fail(
          `Zabbix answered, but did not say it updated problem ${eventIdText}.`,
        );
      }

      return this.finish(ZABBIX_UPDATE_PORT_IDS.updated, summary, options);
    } catch (err: unknown) {
      return fail(
        `Could not reach Zabbix: ${
          err instanceof Error && err.message ? err.message : String(err)
        }`,
      );
    }
  }
}
