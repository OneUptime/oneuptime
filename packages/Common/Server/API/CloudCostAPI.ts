import CloudCost from "../../Models/AnalyticsModels/CloudCost";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudCostAllocationWindow,
  toCloudCostAllocationWindow,
} from "../../Types/Cloud/CloudCostAllocation";
import { CLOUD_COST_FOCUS_VERSION } from "../../Types/Cloud/CloudCostFocus";
import { getCloudCostFileName } from "../../Types/Cloud/CloudCostCsv";
import { toCloudCostReportDays } from "../../Types/Cloud/CloudCostReport";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudCostServiceInstance, {
  CloudCostService,
} from "../Services/CloudCostService";
import CloudCostFocusExport from "../Utils/CloudCost/CloudCostFocusExport";
import {
  CloudCostBreakdownAnswer,
  CloudCostBreakdownPeriod,
  CloudCostBreakdownRequest,
  answerCloudCostBreakdown,
  getCloudCostBreakdownPeriodWindow,
  readCloudCostBreakdownBody,
  toCloudCostBreakdownAnswerCsv,
} from "../Utils/CloudCost/CloudCostBreakdownAnswer";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAnalyticsAPI from "./BaseAnalyticsAPI";
import CommonAPI from "./CommonAPI";

/*
 * Cloud costs: the analytics model's CRUD and aggregate reads
 * (BaseAnalyticsAPI), and two of their own (#11009).
 *
 *   POST /cloud-cost/breakdown
 *     { by, tagKey?, cloudCostViewId?, period? | startDate + endDate,
 *       cloudAccountIds?, currency?, basis?, compareWithPrevious?, format? }
 *     The period's spend by service, Region, account, resource, App
 *     Platforms environment or app, a tag's value or a cost view's groups,
 *     with the period before - what Costs' "Where the money goes" shows,
 *     worked out by the same code (CloudCostBreakdownAnswer). format "csv"
 *     answers the page's Download CSV.
 *
 *   POST /cloud-cost/export
 *     { period? | startDate + endDate, cloudAccountIds? }
 *     Every cost of the period as a FOCUS 1.2 file (CloudCostFocusExport),
 *     streamed as it is read.
 *
 * Both read as the caller may read the costs - a project API key included,
 * so finance can pull the month's chargeback from a script or the CLI.
 */
export default class CloudCostAPI extends BaseAnalyticsAPI<
  CloudCost,
  CloudCostService
> {
  public constructor(service: CloudCostService = CloudCostServiceInstance) {
    super(CloudCost, service);

    const path: string = new CloudCost().crudApiPath!.toString();

    this.router.post(
      `${path}/breakdown`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readBreakdown(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/export`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.exportFocus(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getCaller(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = props.isMasterAdmin
      ? CommonAPI.assertTenantScoped(props)
      : CommonAPI.assertAuthenticatedProjectPrincipal(props);

    /*
     * Who may not read the costs is refused before ClickHouse is asked; who
     * may read some accounts only reads those (the read's own check).
     */
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new CloudCost().getReadPermissions(),
      errorMessage:
        "You need a role that may read cloud costs, such as Cloud Viewer or Read Cloud Resource.",
    });

    return { projectId, props };
  }

  private async readBreakdown(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const caller: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = await this.getCaller(req);
    const now: Date = new Date();
    const request: CloudCostBreakdownRequest = readCloudCostBreakdownBody(
      req.body,
      now,
    );
    const answer: CloudCostBreakdownAnswer = await answerCloudCostBreakdown({
      projectId: caller.projectId,
      props: caller.props,
      request,
      now,
    });

    if (request.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        Response.getContentDisposition(
          "attachment",
          getCloudCostFileName({
            what: "cloud-costs",
            dimension: answer.by,
            tagKey: answer.tagKey,
            viewName: answer.viewName,
            basis: answer.basis,
            start: answer.start,
            lastDay: answer.lastDay,
          }),
        ),
      );
      Response.setNoCacheHeaders(res);
      res.status(200).send(toCloudCostBreakdownAnswerCsv(answer));
      return;
    }

    return Response.sendJsonObjectResponse(
      req,
      res,
      answer as unknown as JSONObject,
    );
  }

  private async exportFocus(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const caller: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = await this.getCaller(req);
    const window: CloudCostAllocationWindow = readExportWindow(
      req.body,
      new Date(),
    );
    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};
    const accounts: unknown = body["cloudAccountIds"];

    if (
      accounts !== undefined &&
      accounts !== null &&
      !Array.isArray(accounts)
    ) {
      throw new BadDataException("Send cloudAccountIds as a list of IDs.");
    }

    const cloudAccountIds: Array<ObjectID> | undefined = Array.isArray(accounts)
      ? accounts.map((id: unknown): ObjectID => {
          const text: string = String(id || "").trim();

          if (!ObjectID.isValidUUID(text)) {
            throw new BadDataException(
              "Send each of cloudAccountIds as an ID.",
            );
          }

          return new ObjectID(text);
        })
      : undefined;

    const days: { start: string; lastDay: string } =
      toCloudCostReportDays(window);
    let isStarted: boolean = false;

    const start: () => void = (): void => {
      if (isStarted) {
        return;
      }

      isStarted = true;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        Response.getContentDisposition(
          "attachment",
          getCloudCostFileName({
            what: `cloud-costs-focus-${CLOUD_COST_FOCUS_VERSION}`,
            start: days.start,
            lastDay: days.lastDay,
          }),
        ),
      );
      res.setHeader("X-FOCUS-Version", CLOUD_COST_FOCUS_VERSION);
      Response.setNoCacheHeaders(res);
      res.status(200);
    };

    try {
      await CloudCostFocusExport.write({
        projectId: caller.projectId,
        props: caller.props,
        window,
        cloudAccountIds,
        write: (chunk: string): void => {
          start();
          res.write(chunk);
        },
      });
    } catch (error) {
      if (!isStarted) {
        throw error;
      }

      // The file is half written: end it, so the download is not passed off as whole.
      res.destroy(error as Error);
      return;
    }

    start();
    res.end();
  }
}

// An export's days: a period, or a start and an end date.
export function readExportWindow(
  body: unknown,
  now: Date,
): CloudCostAllocationWindow {
  const data: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};

  if (data["startDate"] !== undefined || data["endDate"] !== undefined) {
    const startDate: Date = new Date(String(data["startDate"] ?? ""));
    const endDate: Date = new Date(String(data["endDate"] ?? ""));

    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime())
    ) {
      throw new BadDataException(
        "Send startDate and endDate as dates, such as 2026-11-01 and 2026-11-30.",
      );
    }

    return toCloudCostAllocationWindow({ startDate, endDate });
  }

  const period: string = String(data["period"] ?? "last-month")
    .trim()
    .toLowerCase();
  const known: Array<string> = Object.values(CloudCostBreakdownPeriod);

  if (!known.includes(period) && period !== "month-to-date") {
    throw new BadDataException(
      "Send period as this-month, last-month, last-week or last-30-days, or send startDate and endDate.",
    );
  }

  return getCloudCostBreakdownPeriodWindow({
    period:
      period === "month-to-date"
        ? CloudCostBreakdownPeriod.ThisMonth
        : (period as CloudCostBreakdownPeriod),
    now,
  });
}
