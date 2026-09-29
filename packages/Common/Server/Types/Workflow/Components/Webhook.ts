import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Utils/Express";
import Response from "../../../Utils/Response";
import { RunOptions, RunReturnType } from "../ComponentCode";
import TriggerCode, { ExecuteWorkflowType, InitProps } from "../TriggerCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import WebhookComponents from "../../../../Types/Workflow/Components/Webhook";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import WorkflowService from "../../../Services/WorkflowService";
import Workflow from "../../../../Models/DatabaseModels/Workflow";

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
    props.router.get(
      `/trigger/:secretkey`,
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

    // Look up the workflow by webhook secret key.
    const workflow: Workflow | null = await WorkflowService.findOneBy({
      query: {
        webhookSecretKey: secretKey,
      },
      select: {
        _id: true,
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

    const executeWorkflow: ExecuteWorkflowType = {
      workflowId: new ObjectID(workflow._id),
      returnValues: {
        "request-headers": req.headers,
        "request-params": req.query,
        "request-body": req.body,
      },
    };

    await props.executeWorkflow(executeWorkflow);

    Response.sendJsonObjectResponse(req, res, { status: "Scheduled" });
  }
}
