import CloudCost from "../../Models/AnalyticsModels/CloudCost";
import CloudCostReport from "../../Models/DatabaseModels/CloudCostReport";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudCostReportContent } from "../../Types/Cloud/CloudCostReport";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudCostReportService, {
  Service as CloudCostReportServiceType,
} from "../Services/CloudCostReportService";
import CloudCostReportSender from "../Utils/CloudCost/CloudCostReportSender";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Scheduled cloud cost reports (#11009): the CRUD routes, and
 *
 *   POST /cloud-cost-report/:reportId/preview
 *     What the report says now - its last period, as the next send would
 *     have it - read as the caller may read the costs: what the Reports
 *     page shows before it is sent (CloudCostReportContent).
 *
 *   POST /cloud-cost-report/:reportId/send-copy
 *     Sends the caller a copy now, as they may read it, to the address
 *     they sign in with - the email and its CSV everyone it names gets.
 *
 * Both need a person who may read the report and the costs: a report's
 * figures are never read for someone who may not read them.
 */
export default class CloudCostReportAPI extends BaseAPI<
  CloudCostReport,
  CloudCostReportServiceType
> {
  public constructor() {
    super(CloudCostReport, CloudCostReportService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.post(
      `${path}/:reportId/preview`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.preview(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/:reportId/send-copy`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.sendCopy(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // The caller, the report they may read, and their project.
  private async getCaller(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    reportId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectPrincipal(props);
    const id: string = String(req.params["reportId"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("The report's ID is not valid.");
    }

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new CloudCost().getReadPermissions(),
      errorMessage:
        "You need a role that may read cloud costs, such as Cloud Viewer or Read Cloud Resource.",
    });

    // The report, as the caller may read it: one they may not read is not found.
    const report: CloudCostReport | null =
      await CloudCostReportService.findOneBy({
        query: { _id: new ObjectID(id), projectId },
        select: { _id: true },
        props,
      });

    if (!report?.id) {
      throw new NotFoundException(
        "This report was not found. It may have been deleted, or you may not have access to it.",
      );
    }

    return { projectId, props, reportId: report.id };
  }

  private async preview(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const caller: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      reportId: ObjectID;
    } = await this.getCaller(req);

    const content: CloudCostReportContent = await CloudCostReportSender.readFor(
      {
        reportId: caller.reportId,
        props: caller.props,
        projectId: caller.projectId,
        at: new Date(),
      },
    );

    return Response.sendJsonObjectResponse(
      req,
      res,
      content as unknown as JSONObject,
    );
  }

  private async sendCopy(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const caller: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      reportId: ObjectID;
    } = await this.getCaller(req);

    if (!caller.props.userId) {
      throw new BadDataException(
        "A copy is sent to the person asking for it: sign in to OneUptime to send yourself one.",
      );
    }

    const sent: { email: string } = await CloudCostReportSender.sendCopy({
      reportId: caller.reportId,
      userId: caller.props.userId,
      props: caller.props,
      projectId: caller.projectId,
      at: new Date(),
    });

    return Response.sendJsonObjectResponse(req, res, { sentTo: sent.email });
  }
}
