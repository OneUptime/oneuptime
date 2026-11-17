import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../../../Utils/Express";
import Response from "../../../Utils/Response";
import WebhookVerification, {
  WebhookVerificationAnswer,
} from "../../../Utils/WebhookVerification";
import ClusterKeyAuthorization from "../../../Middleware/ClusterKeyAuthorization";
import WebhookRequestBody from "../../../Middleware/WebhookRequestBody";
import { RunOptions, RunReturnType } from "../ComponentCode";
import TriggerCode, { ExecuteWorkflowType, InitProps } from "../TriggerCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import WebhookComponents from "../../../../Types/Workflow/Components/Webhook";
import { WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE } from "../../../../Types/Workflow/WorkflowArchive";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "../../../../Types/Workflow/WorkflowEnabled";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import WorkflowService from "../../../Services/WorkflowService";
import Workflow from "../../../../Models/DatabaseModels/Workflow";

/*
 * A workflow whose trigger checks the signature of every request (the
 * Huntress trigger) is only ever started through its own URL, which checks
 * it. Its webhook secret key is the last part of that URL too, so this
 * route, which checks no signature, refuses it.
 */
export const SIGNED_WEBHOOK_TRIGGER_IDS: Array<string> = [
  ComponentID.HuntressIncidentReport,
];

export const SIGNED_WEBHOOK_WORKFLOW_MESSAGE: string =
  "This workflow starts from Huntress, which signs its requests. Send them to the URL its Huntress trigger shows.";

/*
 * The largest text/plain or +json body read: the JSON parser's own limit
 * (StartServer's jsonBodyParserOptions).
 */
export const WEBHOOK_TEXT_BODY_LIMIT: string = "50mb";

export default class WebhookTrigger extends TriggerCode {
  public constructor() {
    super();
    const WebhookComponent: ComponentMetadata | undefined =
      WebhookComponents.find((i: ComponentMetadata) => {
        return i.id === ComponentID.Webhook;
      });

    if (!WebhookComponent) {
      throw new BadDataException("Webhook trigger not found.");
    }
    this.setMetadata(WebhookComponent);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "out";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Out port not found"));
    }

    return {
      returnValues: {
        ...args,
      },
      executePort: successPort,
    };
  }

  @CaptureSpan()
  public override async init(props: InitProps): Promise<void> {
    /*
     * JSON sent as text/plain - how Amazon SNS posts every message - is
     * read as the JSON it is, so the next block can read its fields (#7723);
     * any other text as the text it is (#8430); a +json body, such as Azure
     * Event Grid's CloudEvents, as its JSON (WebhookRequestBody).
     */
    const readTextBody: RequestHandler = WebhookRequestBody.getReader(
      WEBHOOK_TEXT_BODY_LIMIT,
    );

    props.router.get(
      `/trigger/:secretkey`,
      readTextBody,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.initTrigger(req, res, props);
        } catch (e) {
          return next(e);
        }
      },
    );

    props.router.post(
      `/trigger/:secretkey`,
      readTextBody,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.initTrigger(req, res, props);
        } catch (e) {
          return next(e);
        }
      },
    );

    /*
     * Only a CloudEvents validation reaches this: StartServer's CORS
     * middleware answers every other OPTIONS request itself.
     */
    props.router.options(
      `/trigger/:secretkey`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.initTrigger(req, res, props);
        } catch (e) {
          return next(e);
        }
      },
    );
  }

  @CaptureSpan()
  public async initTrigger(
    req: ExpressRequest,
    res: ExpressResponse,
    props: InitProps,
  ): Promise<void> {
    const secretKey: string = req.params["secretkey"] as string;

    if (!secretKey) {
      throw new BadDataException("Secret key is required to trigger workflow.");
    }

    /*
     * Look up the workflow by webhook secret key: by its lookup hash, as the
     * key is kept encrypted (#9012).
     */
    const workflow: Workflow | null =
      await WorkflowService.findOneByPresentedKey({
        column: "webhookSecretKey",
        presentedKey: secretKey,
        select: {
          _id: true,
          triggerId: true,
          isEnabled: true,
          isArchived: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workflow || !workflow._id) {
      throw new BadDataException(
        "Workflow not found for the provided secret key.",
      );
    }

    if (
      workflow.triggerId &&
      SIGNED_WEBHOOK_TRIGGER_IDS.includes(workflow.triggerId)
    ) {
      throw new BadDataException(SIGNED_WEBHOOK_WORKFLOW_MESSAGE);
    }

    /*
     * A service checking the URL before it delivers to it - Azure Event
     * Grid, Slack, Microsoft Graph, Okta, a CloudEvents sender - gets the
     * answer its protocol expects (WebhookVerification, issue #8429), and
     * starts nothing: the check is no event for the workflow to act on. It
     * is refused as a call would be while the workflow is archived or off,
     * with why, so the service is never told to deliver to a workflow that
     * would refuse every delivery.
     */
    const verification: WebhookVerificationAnswer | null =
      WebhookVerification.recognize(WebhookVerification.readRequest(req));

    if (verification) {
      if (workflow.isArchived) {
        throw new BadDataException(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);
      }

      if (!workflow.isEnabled) {
        throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE);
      }

      WebhookVerification.send(res, verification);
      return;
    }

    // An OPTIONS request that is no CloudEvents validation starts nothing.
    if (req.method === "OPTIONS") {
      Response.sendEmptySuccessResponse(req, res);
      return;
    }

    const executeWorkflow: ExecuteWorkflowType = {
      workflowId: new ObjectID(workflow._id),
      returnValues: {
        /*
         * Every header the caller sent but the two OneUptime's own services
         * prove themselves with: a run's values are the project's to read.
         */
        "request-headers": ClusterKeyAuthorization.withoutClusterKeyHeaders(
          req.headers,
        ),
        "request-params": req.query,
        "request-body": req.body,
      },
    };

    await props.executeWorkflow(executeWorkflow);

    Response.sendJsonObjectResponse(req, res, { status: "Scheduled" });
  }
}
