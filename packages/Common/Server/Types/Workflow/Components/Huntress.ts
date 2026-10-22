import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import HuntressSeverity from "../../../../Types/Huntress/HuntressSeverity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import HuntressComponents from "../../../../Types/Workflow/Components/Huntress";
import {
  HUNTRESS_INCIDENT_SEVERITY_RANK,
  HUNTRESS_INCIDENT_SEVERITY_SETTINGS,
  HUNTRESS_TRIGGER_PATH,
  HuntressRunEvent,
  HuntressTriggerValue,
  getHuntressOrganizationLabelName,
  getHuntressTriggerValues,
  readHuntressRunEvent,
} from "../../../../Types/Workflow/HuntressTrigger";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import LabelService from "../../../Services/LabelService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Utils/Express";
import HuntressWebhookHandler, {
  HuntressWebhookAnswer,
} from "../../../Utils/Huntress/HuntressWebhookHandler";
import logger from "../../../Utils/Logger";
import Response from "../../../Utils/Response";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { RunOptions, RunReturnType } from "../ComponentCode";
import TriggerCode, { InitProps } from "../TriggerCode";

/*
 * The Huntress Incident Report trigger.
 *
 * Its URL (POST <workflow service>/huntress/<the workflow's webhook secret
 * key>) is where Huntress sends every event about an incident report.
 * HuntressWebhookHandler checks the request's signature with the
 * workflow's signing secret, reads the report, and starts one run for each
 * event - or says why it did not.
 *
 * The run starts here: the report's fields are read again into the
 * trigger's values (Types/Workflow/HuntressTrigger), with ready-made text
 * for an incident and its notes, and two values worked out from the
 * project's records:
 *
 *   - Incident Severity ID: the severity the trigger's setting picks for
 *     the report's Huntress severity, while the project still has it, or
 *     else the project's severities in rank order (critical the most
 *     severe, high the next, low the one after).
 *   - Organization Label ID: the project's label named after the report's
 *     organization, made the first time it is needed - as labels are made
 *     from telemetry (LabelService.findOrCreateLabelsByNames) - so incident
 *     rules can tell one organization's incidents from another's.
 *
 * Neither stops the run when it cannot be worked out: it is left empty,
 * the run log says why, and the step that needed it says the rest.
 *
 * Run Workflow starts it the same way, with an Event, a Report ID and the
 * few fields typed in to try the workflow without Huntress.
 */
export default class HuntressWorkflowTrigger extends TriggerCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined = HuntressComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.HuntressIncidentReport;
      },
    );

    if (!component) {
      throw new BadDataException("Huntress Incident Report trigger not found.");
    }

    this.setMetadata(component);
  }

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

    const read: HuntressRunEvent = readHuntressRunEvent(
      args,
      OneUptimeDate.getCurrentDate(),
    );

    if (!read.isValid) {
      throw options.onError(new BadDataException(read.problem));
    }

    const returnValues: JSONObject = getHuntressTriggerValues({
      event: read.event,
      triggerEvent: read.triggerEvent,
      severity: read.severity,
      receivedAt: read.receivedAt,
    });

    returnValues[HuntressTriggerValue.IncidentSeverityId] =
      await HuntressWorkflowTrigger.getIncidentSeverityId({
        projectId: options.projectId,
        severity: read.severity,
        settings: args,
        log: options.log,
      });

    returnValues[HuntressTriggerValue.OrganizationLabelId] =
      await HuntressWorkflowTrigger.getOrganizationLabelId({
        projectId: options.projectId,
        labelName: getHuntressOrganizationLabelName(read.event),
        log: options.log,
      });

    options.log(
      `Huntress incident report ${read.event.reportId}: ${read.triggerEvent}.`,
    );

    return {
      returnValues: returnValues,
      executePort: outPort,
    };
  }

  /*
   * The incident severity a report of `severity` opens at: the one the
   * trigger's setting picks, while the project still has it; otherwise
   * the project's severities in rank order. Empty, and said in the run's
   * log, when the project has none.
   */
  public static async getIncidentSeverityId(data: {
    projectId: ObjectID;
    severity: HuntressSeverity;
    // The trigger's settings: its arguments, as the run hands them over.
    settings: JSONObject;
    log: RunOptions["log"];
  }): Promise<string> {
    let severities: Array<IncidentSeverity> = [];

    try {
      severities = await IncidentSeverityService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          order: true,
          isArchived: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(err);
      data.log(
        "Could not read this project's incident severities, so Incident Severity ID is empty.",
      );

      return "";
    }

    if (severities.length === 0) {
      data.log(
        "This project has no incident severities, so Incident Severity ID is empty. Add one under Incidents > Settings > Incident Severity.",
      );

      return "";
    }

    const setting: unknown =
      data.settings[HUNTRESS_INCIDENT_SEVERITY_SETTINGS[data.severity]];
    const picked: string = typeof setting === "string" ? setting.trim() : "";

    if (picked) {
      const stillThere: IncidentSeverity | undefined = severities.find(
        (severity: IncidentSeverity): boolean => {
          return severity.id?.toString() === picked;
        },
      );

      if (stillThere?.id) {
        return stillThere.id.toString();
      }

      data.log(
        "The incident severity picked for this report's severity is gone, so the project's severities decide it in rank order.",
      );
    }

    /*
     * The trigger's own pick above is kept even if it has been archived
     * since - a workflow runs as it was built - but the rank picks only
     * among the severities that are not archived.
     */
    const liveSeverities: Array<IncidentSeverity> = severities.filter(
      (severity: IncidentSeverity): boolean => {
        return severity.isArchived !== true;
      },
    );

    if (liveSeverities.length === 0) {
      return "";
    }

    const rank: number = Math.min(
      HUNTRESS_INCIDENT_SEVERITY_RANK[data.severity],
      liveSeverities.length - 1,
    );

    return liveSeverities[rank]?.id?.toString() || "";
  }

  /*
   * The project's label named after the report's organization, made when
   * there is none yet. Empty, and said in the run's log, when it could not
   * be found or made.
   */
  public static async getOrganizationLabelId(data: {
    projectId: ObjectID;
    labelName: string;
    log: RunOptions["log"];
  }): Promise<string> {
    try {
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames: [data.labelName],
        });

      if (labelIds[0]) {
        return labelIds[0].toString();
      }
    } catch (err) {
      logger.error(err);
    }

    data.log(
      `Could not find or make the label ${data.labelName}, so Organization Label ID is empty.`,
    );

    return "";
  }

  @CaptureSpan()
  public override async init(props: InitProps): Promise<void> {
    props.router.post(
      `${HUNTRESS_TRIGGER_PATH}/:secretkey`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const result: HuntressWebhookAnswer =
            await HuntressWebhookHandler.handle({
              secretKey: req.params["secretkey"],
              headers: req.headers,
              rawBody: (req as OneUptimeRequest).rawBody,
              executeWorkflow: props.executeWorkflow,
            });

          return Response.sendCustomResponse(
            req,
            res,
            result.statusCode,
            result.body,
            {},
          );
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
