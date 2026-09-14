import GoogleSecOpsConnection from "../../Models/DatabaseModels/GoogleSecOpsConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import UserMiddleware from "../Middleware/UserAuthorization";
import GoogleSecOpsConnectionService, {
  Service as GoogleSecOpsConnectionServiceType,
} from "../Services/GoogleSecOpsConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import GoogleSecOpsConnectionTester from "../Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsConnectionTester";
import GoogleSecOpsRunExecutor from "../Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

export default class GoogleSecOpsConnectionAPI extends BaseAPI<
  GoogleSecOpsConnection,
  GoogleSecOpsConnectionServiceType
> {
  public constructor() {
    super(GoogleSecOpsConnection, GoogleSecOpsConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/:connectionId/run`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const connectionId: string | undefined = req.params["connectionId"];
          if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
            throw new BadDataException("A valid connection ID is required.");
          }

          /*
           * Authorize against the caller's tenant before any root read or work
           * is queued. Credentials are only read by the worker.
           */
          const connection: GoogleSecOpsConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          const runId: ObjectID = await GoogleSecOpsRunExecutor.enqueue({
            projectId,
            connectionId: new ObjectID(connectionId),
            options: GoogleSecOpsRunExecutor.validateOptions(req.body),
            requestedByUserId: props.userId,
          });
          return Response.sendJsonObjectResponse(req, res, {
            runId: runId.toString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Synchronous connection test, run in this process rather than through
     * the Worker queue so it can report "no worker is consuming the queue"
     * instead of sitting in "queued". Body is either
     *   { connectionId } — a saved connection (credentials read with root
     *     props here, never returned), or
     *   { region, instanceResourceName, serviceAccountJson,
     *     includeNonAlertingDetections } — settings that were never saved,
     *     so the create form can test before storing anything.
     * Nothing is persisted except a run-history row for a saved connection.
     */
    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const connectionIdValue: JSONValue | undefined = body["connectionId"];
          let connection: GoogleSecOpsConnection;

          if (connectionIdValue !== undefined && connectionIdValue !== null) {
            const connectionId: string = String(connectionIdValue);

            if (!ObjectID.isValidUUID(connectionId)) {
              throw new BadDataException("A valid connection ID is required.");
            }

            const accessible: GoogleSecOpsConnection | null =
              await this.service.findOneBy({
                query: { _id: connectionId, projectId },
                select: { _id: true, projectId: true },
                props,
              });
            CommonAPI.assertResourceBelongsToProject({
              resourceProjectId: accessible?.projectId,
              projectId,
            });

            const loaded: GoogleSecOpsConnection | null =
              await this.service.findOneById({
                id: new ObjectID(connectionId),
                select: {
                  _id: true,
                  projectId: true,
                  name: true,
                  region: true,
                  instanceResourceName: true,
                  serviceAccountJson: true,
                  includeNonAlertingDetections: true,
                  isEnabled: true,
                  pollIntervalInMinutes: true,
                  createdAt: true,
                  lastPolledAt: true,
                  lastSuccessfulPollAt: true,
                  lastEventIngestedAt: true,
                  lastError: true,
                },
                props: { isRoot: true },
              });

            if (!loaded) {
              throw new BadDataException("The connection no longer exists.");
            }

            connection = loaded;
          } else {
            const region: string = GoogleSecOpsConnectionAPI.readString(
              body["region"],
            );
            const instanceResourceName: string =
              GoogleSecOpsConnectionAPI.readString(
                body["instanceResourceName"],
              );
            const serviceAccountJson: string =
              GoogleSecOpsConnectionAPI.readString(body["serviceAccountJson"]);

            if (!region || !instanceResourceName || !serviceAccountJson) {
              throw new BadDataException(
                "Provide a connectionId, or region, instanceResourceName and serviceAccountJson to test unsaved settings.",
              );
            }

            const includeNonAlertingDetections: JSONValue | undefined =
              body["includeNonAlertingDetections"];

            // The same rules create and update apply, without a row.
            GoogleSecOpsConnectionServiceType.validateSettings({
              region,
              instanceResourceName,
              serviceAccountJson,
              includeNonAlertingDetections:
                includeNonAlertingDetections === undefined ||
                includeNonAlertingDetections === null
                  ? undefined
                  : (includeNonAlertingDetections as boolean),
            });

            /*
             * A transient row with no id: the tester treats it as unsaved
             * (no schedule check, no run-history row) and nothing here
             * writes it.
             */
            connection = new GoogleSecOpsConnection();
            connection.projectId = projectId;
            connection.region = region;
            connection.instanceResourceName = instanceResourceName;
            connection.serviceAccountJson = serviceAccountJson;
            connection.includeNonAlertingDetections =
              includeNonAlertingDetections === true;
          }

          const report: SecurityConnectorTestReport =
            await GoogleSecOpsConnectionTester.test({ connection });

          return Response.sendJsonObjectResponse(
            req,
            res,
            report as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private assertCanOperate(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new GoogleSecOpsConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners, project administrators, and security administrators can run connection diagnostics.",
    });
  }

  private static readString(value: JSONValue | undefined): string {
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "string" ? value.trim() : String(value).trim();
  }
}
