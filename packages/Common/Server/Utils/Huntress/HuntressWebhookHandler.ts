import Workflow from "../../../Models/DatabaseModels/Workflow";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import {
  isHuntressOrganizationWatched,
  parseHuntressOrganizationFilter,
} from "../../../Types/Huntress/HuntressOrganizationFilter";
import {
  HuntressIncidentReportEvent,
  ParsedHuntressWebhook,
  parseHuntressWebhook,
} from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  getHuntressDeliveryValues,
  getHuntressTriggerEvent,
} from "../../../Types/Workflow/HuntressTrigger";
import GlobalCache from "../../Infrastructure/GlobalCache";
import WorkflowService from "../../Services/WorkflowService";
import { ExecuteWorkflowType } from "../../Types/Workflow/TriggerCode";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import StandardWebhookSignature, {
  StandardWebhookVerification,
} from "../Webhook/StandardWebhookSignature";

/*
 * One request to a Huntress workflow's URL - POST
 * <workflow service>/huntress/<key>, or, for a Huntress connection made
 * before Huntress became a workflow trigger, POST /api/huntress/webhook/<key>
 * - answered the way Svix, which delivers Huntress's webhooks, reads
 * answers: a 2xx is delivered, anything else is sent again - in 5 seconds,
 * 5 minutes, 30 minutes, then hours apart, for about a day.
 *
 *   404  no workflow with a Huntress trigger has this address
 *   401  no signing secret is saved yet, or the signature does not verify;
 *        a request refused before the secret is saved goes through on a
 *        retry once it is
 *   400  the body is not a Huntress event
 *   413  the body is larger than any Huntress event
 *   503  the workflow is off (Huntress sends the event again, and it gets
 *        through once the workflow is on), or OneUptime cannot accept
 *        events right now
 *   403  the project is blocked
 *   500  the run could not be started: retried
 *   200  the run is started, or nothing is to be done: an event that is not
 *        about an incident report (escalations, platform actions, account
 *        notices), a report from an organization the workflow leaves out,
 *        or an event that already started the workflow
 *
 * Only the bytes that were signed are acted on: the body is parsed from the
 * raw request text the signature covers, never from what the JSON parser in
 * front of the route made of it.
 *
 * Each event starts one run. Svix sends an event again when it was not
 * answered in time, and Huntress can resend one by hand: the event's id
 * (svix-id) is remembered for a week, so a second delivery of it starts
 * nothing more.
 *
 * What the last request did is kept on the workflow - when one was last
 * accepted, and why one was refused (at most once a minute for the same
 * reason, so a stream of bad requests cannot keep the row busy) - so the
 * trigger's settings in the Builder can say whether Huntress reaches it.
 */

export const HUNTRESS_MAX_BODY_LENGTH: number = 5 * 1024 * 1024;
export const HUNTRESS_ERROR_RECORD_INTERVAL_MS: number = 60 * 1000;
export const HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS: number =
  OneUptimeDate.getSecondsInDays(7);
export const HUNTRESS_DELIVERY_CACHE_NAMESPACE: string =
  "huntress-workflow-delivery";

// The longest key looked up: a webhook secret key is a uuid.
const MAX_KEY_LENGTH: number = 500;

export const HUNTRESS_NO_WORKFLOW_MESSAGE: string =
  "No Huntress workflow has this address.";

export const HUNTRESS_NO_SIGNING_SECRET_MESSAGE: string =
  "A request arrived but was refused, because no signing secret is saved for this workflow yet. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and save it in the workflow's Huntress trigger. Huntress sends the refused request again.";

export const HUNTRESS_WORKFLOW_OFF_MESSAGE: string =
  "A request arrived while this workflow is off, so it started nothing. Turn the workflow on: Huntress sends the request again.";

export const HUNTRESS_NO_BODY_MESSAGE: string =
  "The request has no JSON body. Huntress sends every event as JSON.";

export const HUNTRESS_BODY_TOO_LARGE_MESSAGE: string =
  "The request body is larger than any Huntress event, so it was refused.";

export const HUNTRESS_INVALID_JSON_MESSAGE: string =
  "The request body is not valid JSON.";

export const HUNTRESS_NOT_AN_INCIDENT_REPORT_MESSAGE: string =
  "Received. Only incident report events start this workflow, so this event changes nothing.";

export const HUNTRESS_ORGANIZATION_NOT_WATCHED_MESSAGE: string =
  "Received. The report's organization is not in this workflow's Only These Organizations, so it started nothing.";

export const HUNTRESS_DUPLICATE_MESSAGE: string =
  "Received before. This event already started the workflow, so it starts nothing more.";

// Said in the installation's own name (ProductBrandingText), as everything the server writes.
export function getHuntressUnavailableMessage(): string {
  return `${ProductBrandingText.getProductName()} cannot take Huntress events right now. Huntress sends this one again.`;
}

export const HUNTRESS_NOT_STARTED_MESSAGE: string =
  "The workflow could not be started. Huntress sends the event again.";

type HeaderValue = string | Array<string> | undefined;

export type ExecuteHuntressWorkflowFunction = (
  executeWorkflow: ExecuteWorkflowType,
) => Promise<void>;

export interface HuntressWebhookRequest {
  // The last part of the URL: the workflow's webhook secret key.
  secretKey: string | undefined;
  headers: Record<string, HeaderValue>;
  // The request body exactly as it was sent.
  rawBody: string | undefined;
  // Starts the run: the workflow service's queue.
  executeWorkflow: ExecuteHuntressWorkflowFunction;
  now?: Date | undefined;
}

export interface HuntressWebhookAnswer {
  statusCode: number;
  body: JSONObject;
}

function answer(statusCode: number, body: JSONObject): HuntressWebhookAnswer {
  return { statusCode, body };
}

/*
 * The workflow as the handler reads it: its id and project, whether it
 * runs, its trigger and that trigger's settings, its signing secret
 * (decrypted) and what the last request left on it.
 */
const WORKFLOW_SELECT: Record<string, boolean> = {
  _id: true,
  projectId: true,
  isEnabled: true,
  isArchived: true,
  triggerId: true,
  triggerArguments: true,
  webhookSigningSecret: true,
  lastWebhookError: true,
  lastWebhookErrorAt: true,
};

export default class HuntressWebhookHandler {
  public static async handle(
    request: HuntressWebhookRequest,
  ): Promise<HuntressWebhookAnswer> {
    const now: Date = request.now || OneUptimeDate.getCurrentDate();
    const secretKey: string = (request.secretKey || "").trim();

    if (!secretKey || secretKey.length > MAX_KEY_LENGTH) {
      return answer(404, { message: HUNTRESS_NO_WORKFLOW_MESSAGE });
    }

    const workflow: Workflow | null = await WorkflowService.findOneBy({
      query: {
        webhookSecretKey: secretKey,
      },
      select: WORKFLOW_SELECT as never,
      props: {
        isRoot: true,
      },
    });

    if (
      !workflow ||
      !workflow.id ||
      !workflow.projectId ||
      workflow.isArchived ||
      workflow.triggerId !== ComponentID.HuntressIncidentReport
    ) {
      return answer(404, { message: HUNTRESS_NO_WORKFLOW_MESSAGE });
    }

    if (!workflow.webhookSigningSecret) {
      return await this.refuse(
        workflow,
        401,
        HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
        now,
      );
    }

    const rawBody: string | undefined = request.rawBody;

    if (!rawBody) {
      return await this.refuse(workflow, 400, HUNTRESS_NO_BODY_MESSAGE, now);
    }

    if (rawBody.length > HUNTRESS_MAX_BODY_LENGTH) {
      return await this.refuse(
        workflow,
        413,
        HUNTRESS_BODY_TOO_LARGE_MESSAGE,
        now,
      );
    }

    const verification: StandardWebhookVerification =
      StandardWebhookSignature.verify({
        secret: workflow.webhookSigningSecret,
        headers: StandardWebhookSignature.readHeaders(request.headers),
        body: rawBody,
        now,
      });

    if (!verification.verified) {
      return await this.refuse(workflow, 401, verification.message, now);
    }

    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return await this.refuse(
        workflow,
        400,
        HUNTRESS_INVALID_JSON_MESSAGE,
        now,
      );
    }

    const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

    if (parsed.kind === "invalid") {
      return await this.refuse(workflow, 400, parsed.reason, now);
    }

    if (parsed.kind === "not-an-incident-report") {
      await this.recordAccepted(workflow, now);

      return answer(200, {
        received: true,
        eventType: parsed.eventType,
        message: HUNTRESS_NOT_AN_INCIDENT_REPORT_MESSAGE,
      });
    }

    const event: HuntressIncidentReportEvent = parsed.event;
    const triggerEvent: HuntressTriggerEvent = getHuntressTriggerEvent(event);

    if (!this.isOrganizationWatched(workflow, event)) {
      await this.recordAccepted(workflow, now);

      return answer(200, {
        received: true,
        event: triggerEvent,
        reportId: event.reportId,
        skipped: true,
        message: HUNTRESS_ORGANIZATION_NOT_WATCHED_MESSAGE,
      });
    }

    /*
     * Off pauses the trigger: the event is refused, so Huntress sends it
     * again, and it gets through once the workflow is turned on. Checked
     * after the signature, so a request that is not Huntress's learns
     * nothing about the workflow.
     */
    if (!workflow.isEnabled) {
      return await this.refuse(
        workflow,
        503,
        HUNTRESS_WORKFLOW_OFF_MESSAGE,
        now,
      );
    }

    const deliveryKey: string = `${workflow.id.toString()}:${verification.messageId}`;
    let isFirstDelivery: boolean;

    try {
      isFirstDelivery = await GlobalCache.setStringIfNotExists(
        HUNTRESS_DELIVERY_CACHE_NAMESPACE,
        deliveryKey,
        now.toISOString(),
        { expiresInSeconds: HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS },
      );
    } catch (err) {
      logger.error(
        `HuntressWebhookHandler: could not check whether workflow ${workflow.id.toString()} already received event ${verification.messageId}: ${err}`,
      );

      return answer(503, { message: getHuntressUnavailableMessage() });
    }

    if (!isFirstDelivery) {
      await this.recordAccepted(workflow, now);

      return answer(200, {
        received: true,
        event: triggerEvent,
        reportId: event.reportId,
        duplicate: true,
        message: HUNTRESS_DUPLICATE_MESSAGE,
      });
    }

    try {
      await request.executeWorkflow({
        workflowId: new ObjectID(workflow.id.toString()),
        returnValues: getHuntressDeliveryValues({ event, receivedAt: now }),
      });
    } catch (err) {
      // Not started: the next delivery of this event must be able to start it.
      await this.forgetDelivery(deliveryKey);

      if (err instanceof ProjectBlockedException) {
        return answer(403, { message: err.message });
      }

      logger.error(
        `HuntressWebhookHandler: could not start workflow ${workflow.id.toString()} for incident report ${event.reportId}:`,
      );
      logger.error(err);

      const message: string =
        err instanceof BadDataException
          ? err.message
          : HUNTRESS_NOT_STARTED_MESSAGE;

      return await this.refuse(workflow, 500, message, now);
    }

    await this.recordAccepted(workflow, now);

    return answer(200, {
      received: true,
      event: triggerEvent,
      reportId: event.reportId,
      status: "Scheduled",
    });
  }

  /*
   * Whether the trigger's Only These Organizations lets the report through.
   * Empty lets every organization's reports through.
   */
  public static isOrganizationWatched(
    workflow: Pick<Workflow, "triggerArguments">,
    event: HuntressIncidentReportEvent,
  ): boolean {
    const setting: unknown =
      workflow.triggerArguments?.[HuntressTriggerSetting.Organizations];

    return isHuntressOrganizationWatched({
      filter: parseHuntressOrganizationFilter(
        typeof setting === "string" ? setting : "",
      ),
      organization: event.organization,
    });
  }

  private static async forgetDelivery(deliveryKey: string): Promise<void> {
    try {
      await GlobalCache.deleteKey(
        HUNTRESS_DELIVERY_CACHE_NAMESPACE,
        deliveryKey,
      );
    } catch (err) {
      logger.error(
        `HuntressWebhookHandler: could not forget a delivery that started nothing: ${err}`,
      );
    }
  }

  // Refuse the request, and say why on the workflow.
  private static async refuse(
    workflow: Workflow,
    statusCode: number,
    message: string,
    now: Date,
  ): Promise<HuntressWebhookAnswer> {
    await this.recordError(workflow, message, now);

    return answer(statusCode, { message });
  }

  // A request that verified: when, and nothing wrong any more.
  private static async recordAccepted(
    workflow: Workflow,
    now: Date,
  ): Promise<void> {
    try {
      await WorkflowService.updateColumnsByIdWithoutHooks({
        id: workflow.id!,
        data: {
          lastWebhookRequestAt: now,
          lastWebhookError: null,
          lastWebhookErrorAt: null,
        } as never,
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      // The event was handled; failing to note when is not worth a retry.
      logger.error(
        `HuntressWebhookHandler: could not record the last request of workflow ${workflow.id?.toString()}: ${err}`,
      );
    }
  }

  /*
   * Why a request was refused. The same reason is written at most once a
   * minute.
   */
  private static async recordError(
    workflow: Workflow,
    message: string,
    now: Date,
  ): Promise<void> {
    const lastErrorAt: Date | undefined = workflow.lastWebhookErrorAt
      ? new Date(workflow.lastWebhookErrorAt)
      : undefined;

    if (
      workflow.lastWebhookError === message &&
      lastErrorAt &&
      now.getTime() - lastErrorAt.getTime() < HUNTRESS_ERROR_RECORD_INTERVAL_MS
    ) {
      return;
    }

    try {
      await WorkflowService.updateColumnsByIdWithoutHooks({
        id: workflow.id!,
        data: {
          lastWebhookError: message,
          lastWebhookErrorAt: now,
        } as never,
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.error(
        `HuntressWebhookHandler: could not record an error on workflow ${workflow.id?.toString()}: ${err}`,
      );
    }
  }
}
