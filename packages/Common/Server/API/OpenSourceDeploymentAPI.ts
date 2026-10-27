import OpenSourceDeployment from "../../Models/DatabaseModels/OpenSourceDeployment";
import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import API from "../../Utils/API";
import OpenSourceDeploymentService, {
  Service as OpenSourceDeploymentServiceType,
} from "../Services/OpenSourceDeploymentService";
import { OpenSourceDeploymentWebhookUrl } from "../EnvironmentConfig";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";

export default class OpenSourceDeploymentAPI extends BaseAPI<
  OpenSourceDeployment,
  OpenSourceDeploymentServiceType
> {
  public constructor() {
    super(OpenSourceDeployment, OpenSourceDeploymentService);

    const path: string = `${new this.entityType().getCrudApiPath()?.toString()}`;

    this.router.post(
      `${path}/register`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          const deployment: OpenSourceDeployment = new OpenSourceDeployment();

          deployment.email = (body["email"] as string) || "";
          deployment.name = (body["name"] as string) || "";
          deployment.companyName = (body["companyName"] as string) || "";
          deployment.companyPhoneNumber =
            (body["companyPhoneNumber"] as string) || "";
          deployment.oneuptimeVersion =
            (body["oneuptimeVersion"] as string) || "unknown";
          deployment.instanceUrl = (body["instanceUrl"] as string) || "";

          /*
           * Skip instances nobody else can reach: localhost, loopback and test
           * hosts - default/unconfigured deployments and developer machines.
           */
          if (!OpenSourceDeploymentService.isInstallUrl(deployment.instanceUrl)) {
            return Response.sendEmptySuccessResponse(req, res);
          }

          /*
           * Skip sign-ups on names reserved for testing (example.com, .test,
           * .invalid and the like): nobody has a mailbox there, so these are
           * CI and end-to-end test runs, not installs.
           */
          if (Email.isOnReservedDomain(deployment.email)) {
            return Response.sendEmptySuccessResponse(req, res);
          }

          await OpenSourceDeploymentService.recordInstance(deployment);

          if (OpenSourceDeploymentWebhookUrl) {
            API.post({
              url: URL.fromString(OpenSourceDeploymentWebhookUrl),
              data: {
                email: deployment.email?.toString() || "",
                name: deployment.name?.toString() || "",
                companyName: deployment.companyName?.toString() || "",
                companyPhoneNumber:
                  deployment.companyPhoneNumber?.toString() || "",
                oneuptimeVersion: deployment.oneuptimeVersion?.toString() || "",
                instanceUrl: deployment.instanceUrl?.toString() || "",
              },
            }).catch((err: Error) => {
              logger.error(err, getLogAttributesFromRequest(req as any));
            });
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Every self-hosted install's daily check-in: its URL and the version it
     * runs, and nothing about anyone. It keeps the instance's record current,
     * or starts one, so this table says which installs still run and on which
     * release. Not passed to the webhook, which would hear from every install
     * every day.
     */
    this.router.post(
      `${path}/check-in`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          const deployment: OpenSourceDeployment = new OpenSourceDeployment();

          deployment.oneuptimeVersion =
            (body["oneuptimeVersion"] as string) || "unknown";
          deployment.instanceUrl = (body["instanceUrl"] as string) || "";

          if (OpenSourceDeploymentService.isInstallUrl(deployment.instanceUrl)) {
            await OpenSourceDeploymentService.recordInstance(deployment);
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
