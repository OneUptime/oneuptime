import ClusterKeyAuthorization from "../../../Middleware/ClusterKeyAuthorization";
import WorkflowService from "../../../Services/WorkflowService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Utils/Express";
import logger, { LogAttributes } from "../../../Utils/Logger";
import { redactMonitorSecret } from "../../../Utils/Monitor/MonitorPayloadRedaction";
import Response from "../../../Utils/Response";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { RunOptions, RunReturnType } from "../ComponentCode";
import TriggerCode, { ExecuteWorkflowType, InitProps } from "../TriggerCode";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import IncomingEmailComponents from "../../../../Types/Workflow/Components/IncomingEmail";
import IncomingEmailTrigger, {
  INCOMING_EMAIL_TRIGGER_DELIVERY_PATH,
  IncomingEmailTriggerDeliveryStatus,
  IncomingEmailTriggerEmail,
} from "../../../../Types/Workflow/IncomingEmailTrigger";

export type ExecuteWorkflowFunction = (
  executeWorkflow: ExecuteWorkflowType,
) => Promise<void>;

/*
 * The Incoming Email trigger: each email sent to a workflow's own address
 * (workflow-{incomingEmailSecretKey}@{inbound domain}) starts one run of it.
 *
 * Mail reaches OneUptime through the inbound email webhook Incoming Email
 * monitors use (Telemetry's POST /incoming-email/<provider>/<secret>), which
 * queues it. The queue worker hands each email for a workflow address to the
 * route registered here, with the cluster key; this is where it becomes a run,
 * or does not:
 *
 *   - the workflow is found by the key in the address and nothing else, so a
 *     key starts the one workflow it belongs to, in that workflow's project -
 *     whatever the email itself says;
 *   - a workflow whose trigger is no longer Incoming Email, or that is off,
 *     starts nothing (the Webhook trigger refuses a call to a workflow that is
 *     off the same way);
 *   - the address is a credential, so the key is masked everywhere in what
 *     the run is handed - To, Cc, Delivered-To and the rest - before any of
 *     it is stored in the run's log, which read-only roles can open.
 */
export default class IncomingEmailWorkflowTrigger extends TriggerCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined =
      IncomingEmailComponents.find((i: ComponentMetadata) => {
        return i.id === ComponentID.IncomingEmail;
      });

    if (!component) {
      throw new BadDataException("Incoming Email trigger not found.");
    }

    this.setMetadata(component);
  }

  /*
   * Hands the next step every value the trigger promises, whatever the run
   * started from: a delivered email, or the sender, subject and body typed
   * into Run Workflow to try the workflow out.
   */
  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const outPort: Port | undefined = this.getMetadata().outPorts.find(
      (port: Port) => {
        return port.id === "out";
      },
    );

    if (!outPort) {
      throw options.onError(new BadDataException("Out port not found"));
    }

    return {
      returnValues: IncomingEmailTrigger.normalizeReturnValues(args),
      executePort: outPort,
    };
  }

  @CaptureSpan()
  public override async init(props: InitProps): Promise<void> {
    props.router.post(
      INCOMING_EMAIL_TRIGGER_DELIVERY_PATH,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const status: IncomingEmailTriggerDeliveryStatus =
            await this.deliverEmail({
              secretKey: req.body?.["secretKey"],
              email: req.body?.["email"],
              executeWorkflow: props.executeWorkflow,
            });

          Response.sendJsonObjectResponse(req, res, { status: status });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Starts the run one email asks for, or says why it does not. The key is
   * never logged: it is the address, and logs travel further than the
   * workflow's own permissions.
   */
  @CaptureSpan()
  public async deliverEmail(data: {
    secretKey: unknown;
    email: unknown;
    executeWorkflow: ExecuteWorkflowFunction;
  }): Promise<IncomingEmailTriggerDeliveryStatus> {
    const secretKey: string =
      typeof data.secretKey === "string"
        ? data.secretKey.trim().toLowerCase()
        : "";

    if (!ObjectID.isValidUUID(secretKey)) {
      return IncomingEmailTriggerDeliveryStatus.NoWorkflow;
    }

    if (
      !data.email ||
      typeof data.email !== "object" ||
      Array.isArray(data.email)
    ) {
      throw new BadDataException("The email to deliver is missing.");
    }

    const workflow: Workflow | null = await WorkflowService.findOneBy({
      query: {
        incomingEmailSecretKey: new ObjectID(secretKey),
      },
      select: {
        _id: true,
        projectId: true,
        triggerId: true,
        isEnabled: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!workflow || !workflow._id) {
      logger.debug(
        "Incoming email for a workflow address that no workflow has. Ignoring.",
      );
      return IncomingEmailTriggerDeliveryStatus.NoWorkflow;
    }

    const logAttributes: LogAttributes = {
      projectId: workflow.projectId?.toString(),
      workflowId: workflow._id.toString(),
    };

    if (workflow.triggerId !== ComponentID.IncomingEmail) {
      logger.debug(
        "Incoming email for a workflow whose trigger is no longer Incoming Email. Ignoring.",
        logAttributes,
      );
      return IncomingEmailTriggerDeliveryStatus.NotIncomingEmailTrigger;
    }

    if (!workflow.isEnabled) {
      logger.debug(
        "Incoming email for a workflow that is turned off. Ignoring.",
        logAttributes,
      );
      return IncomingEmailTriggerDeliveryStatus.WorkflowDisabled;
    }

    const returnValues: JSONObject = redactMonitorSecret(
      IncomingEmailTrigger.getReturnValues(
        data.email as IncomingEmailTriggerEmail,
      ),
      secretKey,
    );

    await data.executeWorkflow({
      workflowId: new ObjectID(workflow._id.toString()),
      returnValues: returnValues,
    });

    return IncomingEmailTriggerDeliveryStatus.Scheduled;
  }
}
