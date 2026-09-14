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
     *   { connectionId, region?, instanceResourceName?,
     *     includeNonAlertingDetections? } — a saved connection (credentials
     *     read with root props here, never returned). The optional settings
     *     are the edit form's unsaved values: they replace the stored ones
     *     for this test only, while the stored key is always used, because
     *     the key can never be read back into the form. Or
     *   { region, instanceResourceName, serviceAccountJson,
     *     includeNonAlertingDetections } — settings that were never saved,
     *     so the create form can test before storing anything.
     * Nothing is persisted except a run-history row for a saved connection
     * tested exactly as stored: a row describing settings that were never
     * saved would misstate that connection's history.
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
          let recordRun: boolean = false;

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

            const overlaid: boolean =
              GoogleSecOpsConnectionAPI.overlayEditedSettings({
                connection: loaded,
                body,
              });

            connection = loaded;
            recordRun = !overlaid;
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
            await GoogleSecOpsConnectionTester.test({ connection, recordRun });

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

  /*
   * Applies the edit form's unsaved region, instance resource name and
   * Detections selection to a loaded connection, validated with the same
   * rules create and update apply (review finding
   * edit-form-test-ignores-edited-settings: the stored values used to be
   * tested and the edits silently ignored). Absent or null values keep the
   * stored setting; the stored key is never replaced here.
   *
   * Returns true when any value differs from the stored one. A value equal
   * to the stored one tests exactly what is saved, so it is not an overlay
   * and the run can still be recorded against the connection.
   */
  private static overlayEditedSettings(data: {
    connection: GoogleSecOpsConnection;
    body: JSONObject;
  }): boolean {
    const regionValue: JSONValue | undefined = data.body["region"];
    const instanceValue: JSONValue | undefined =
      data.body["instanceResourceName"];
    const includeValue: JSONValue | undefined =
      data.body["includeNonAlertingDetections"];

    const region: string | undefined =
      regionValue === undefined || regionValue === null
        ? undefined
        : GoogleSecOpsConnectionAPI.readString(regionValue);
    const instanceResourceName: string | undefined =
      instanceValue === undefined || instanceValue === null
        ? undefined
        : GoogleSecOpsConnectionAPI.readString(instanceValue);
    const includeNonAlertingDetections: boolean | undefined =
      includeValue === undefined || includeValue === null
        ? undefined
        : (includeValue as boolean);

    /*
     * An empty region or instance is validated rather than ignored: the
     * person cleared the field, and testing the stored value instead is the
     * defect this overlay exists to remove.
     */
    GoogleSecOpsConnectionServiceType.validateSettings({
      region,
      instanceResourceName,
      includeNonAlertingDetections,
    });

    let overlaid: boolean = false;

    if (region !== undefined && region !== data.connection.region) {
      data.connection.region = region;
      overlaid = true;
    }

    if (
      instanceResourceName !== undefined &&
      instanceResourceName !== data.connection.instanceResourceName
    ) {
      data.connection.instanceResourceName = instanceResourceName;
      overlaid = true;
    }

    if (
      includeNonAlertingDetections !== undefined &&
      includeNonAlertingDetections !==
        (data.connection.includeNonAlertingDetections === true)
    ) {
      data.connection.includeNonAlertingDetections =
        includeNonAlertingDetections;
      overlaid = true;
    }

    return overlaid;
  }

  private static readString(value: JSONValue | undefined): string {
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "string" ? value.trim() : String(value).trim();
  }
}
