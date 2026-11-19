import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import { CloudPublishedMetricsListing } from "../../Types/Cloud/CloudPublishedMetrics";
import { CloudUnreportedKeyMetricReport } from "../../Types/Cloud/CloudUnreportedKeyMetrics";
import CloudResourceMetrics from "../Utils/CloudConnection/CloudResourceMetrics";
import { CloudConnectionAwsRoleSetup } from "../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionTestResult } from "../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService, {
  Service as CloudConnectionServiceClass,
} from "../Services/CloudConnectionService";
import AwsServerIdentity from "../Utils/CloudConnection/Aws/AwsServerIdentity";
import CloudConnectionScheduler from "../Utils/CloudConnection/CloudConnectionScheduler";
import CloudConnectorRegistry from "../Utils/CloudConnection/CloudConnectorRegistry";
import {
  CloudConnectionSettings,
  getCloudSecretValues,
} from "../Utils/CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../Utils/DataSource/HttpFetch";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import LlmProviderError from "../Utils/LlmObservability/LlmProviderError";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";

/*
 * Cloud connections: the CRUD routes, plus
 *
 *   POST /cloud-connection/test
 *     { connectionId, config?, secrets? }   a saved connection, with the
 *                                           edit form's unsaved values over
 *                                           it (a secret left empty keeps
 *                                           the stored one), or
 *     { provider, config, secrets }         settings never saved, so the
 *                                           form can test before a save.
 *     -> CloudConnectionTestResult. Signs in and counts a little of what a
 *        read would find; stores nothing.
 *
 *   POST /cloud-connection/:connectionId/read-now
 *     -> queues a read of the connection now.
 *
 *   GET /cloud-connection/aws-role-setup
 *     -> CloudConnectionAwsRoleSetup: whether this OneUptime can sign in to
 *        an AWS role, the principal a role must trust, and the project's
 *        external id - what the IAM role command is written from.
 *
 *   POST /cloud-connection/:connectionId/stream-key
 *     -> { streamKey, createdAt, previousKeyWorksUntil, pushServiceAccount }:
 *        a new key an AWS connection's Firehose streams, or a Google Cloud
 *        connection's Pub/Sub pushes, send its telemetry with
 *        (CloudStream). Answered this once: only its SHA-256 is kept. The
 *        key it replaces keeps working for a day. For Google Cloud, the push
 *        service account its pushes must be signed for.
 *
 *   POST /cloud-connection/:connectionId/start-streaming
 *     { hostSubscriptionId }
 *     -> { startedAt }: an Azure connection's event hubs, in that
 *        subscription, are read every minute from now on (CloudStreamAzure).
 *
 *   POST /cloud-connection/:connectionId/stop-streaming
 *     -> every stream key of the connection stops working, and an Azure
 *        connection's event hubs are read no more.
 *
 *   POST /cloud-connection/resource-metrics/:cloudResourceId/published
 *     -> CloudPublishedMetricsListing: what the resource publishes, asked
 *        of its cloud now, and what an addition would cost.
 *   POST /cloud-connection/resource-metrics/:cloudResourceId/add
 *     { name, namespace?, scope: "resource" | "type", aggregation? }
 *     -> { added, addedMetrics }: the connection reads it from its next read.
 *   POST /cloud-connection/resource-metrics/:cloudResourceId/remove { key }
 *     -> { addedMetrics }
 *   POST /cloud-connection/resource-metrics/:cloudResourceId/unreported
 *     { keys } -> { metrics: CloudUnreportedKeyMetricReport[] }: when each
 *        key metric the resource did not report last did, and why.
 *
 *   The resource-metrics routes list and explain for whoever may read the
 *   resource; Add and Remove are for whoever may edit connections.
 *
 * All of them are for whoever may edit connections (project owners and
 * admins): a test signs in to a cloud account with its credential, a read
 * imports, the role setup is the first step of making one, and a stream
 * key writes into the project.
 */
/*
 * A connection a streaming route acts on: the caller's project's, of a cloud
 * the route is for - and who the caller is, whose change it is.
 */
interface StreamConnectionTarget {
  connectionId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export default class CloudConnectionAPI extends BaseAPI<
  CloudConnection,
  CloudConnectionServiceClass
> {
  public constructor() {
    super(CloudConnection, CloudConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
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

          let settings: CloudConnectionSettings;

          try {
            settings = await this.readSettingsToTest({
              body,
              projectId,
              props,
            });
          } catch (error) {
            /*
             * Settings the form could still fix (a role ARN of the wrong
             * shape, a tenant that is not a GUID) are the test's answer,
             * shown next to the field, not a failed request.
             */
            if (!(error instanceof BadDataException)) {
              throw error;
            }

            const result: CloudConnectionTestResult = {
              provider: String(body["provider"] || ""),
              status: "fail",
              message: error.message,
              failureKind:
                "settings" as CloudConnectionTestResult["failureKind"],
              durationMs: 0,
            };

            return Response.sendJsonObjectResponse(
              req,
              res,
              result as unknown as JSONObject,
            );
          }

          const result: CloudConnectionTestResult =
            await CloudConnectorRegistry.getConnector(settings.provider)
              .testConnection(settings, {
                transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
              })
              .catch((error: unknown): CloudConnectionTestResult => {
                // testConnection never throws; this is the belt to its braces.
                const failure: LlmProviderError = LlmProviderError.from({
                  error,
                  step: "test",
                  providerTitle: settings.provider,
                  secretValues: getCloudSecretValues(settings),
                });

                return {
                  provider: settings.provider,
                  status: "fail",
                  message: failure.message,
                  failureKind: failure.kind,
                  durationMs: 0,
                };
              });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:connectionId/read-now`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
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

          const connection: CloudConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true, isEnabled: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          if (!connection?.isEnabled) {
            throw new BadDataException(
              "This connection is turned off. Turn it on to read it.",
            );
          }

          await CloudConnectionScheduler.enqueue(
            new ObjectID(connectionId),
            new Date(),
          );

          return Response.sendJsonObjectResponse(req, res, { queued: true });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:connectionId/stream-key`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const target: StreamConnectionTarget =
            await this.readStreamConnection(req, [
              CloudProvider.AWS,
              CloudProvider.GCP,
            ]);

          const created: {
            streamKey: string;
            createdAt: Date;
            previousKeyWorksUntil: Date | null;
            pushServiceAccount: string | null;
          } = await CloudConnectionService.createStreamKey({
            connectionId: target.connectionId,
            now: new Date(),
            props: target.props,
          });

          return Response.sendJsonObjectResponse(req, res, {
            streamKey: created.streamKey,
            createdAt: created.createdAt.toISOString(),
            previousKeyWorksUntil: created.previousKeyWorksUntil
              ? created.previousKeyWorksUntil.toISOString()
              : null,
            pushServiceAccount: created.pushServiceAccount,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:connectionId/start-streaming`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const target: StreamConnectionTarget =
            await this.readStreamConnection(req, [CloudProvider.Azure]);
          const hostSubscriptionId: unknown = (
            req.body as JSONObject | undefined
          )?.["hostSubscriptionId"];

          if (typeof hostSubscriptionId !== "string") {
            throw new BadDataException(
              "Give the subscription the event hubs are in, as its ID.",
            );
          }

          const started: { startedAt: Date } =
            await CloudConnectionService.startStreaming({
              connectionId: target.connectionId,
              hostSubscriptionId,
              now: new Date(),
              props: target.props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            startedAt: started.startedAt.toISOString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:connectionId/stop-streaming`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const target: StreamConnectionTarget =
            await this.readStreamConnection(req, [
              CloudProvider.AWS,
              CloudProvider.Azure,
              CloudProvider.GCP,
            ]);

          await CloudConnectionService.stopStreaming(
            target.connectionId,
            target.props,
          );

          return Response.sendJsonObjectResponse(req, res, { stopped: true });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * A cloud resource's metrics beyond its key metrics (#9563), and why it
     * did not report some of its key metrics (#9569): see
     * CloudResourceMetrics. Listing and the reasons are for whoever may
     * read the resource; adding and removing change what the connection
     * reads, and what the account is billed, so they are for whoever may
     * edit connections.
     */
    this.router.post(
      `${basePath}/resource-metrics/:cloudResourceId/published`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const listing: CloudPublishedMetricsListing =
            await CloudResourceMetrics.listPublished({
              projectId,
              cloudResourceId: this.readCloudResourceId(req),
              props,
              canEdit: this.canOperate(props),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            listing as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/resource-metrics/:cloudResourceId/add`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanChangeReads(props);

          const body: JSONObject = this.readBody(req);
          const name: JSONValue | undefined = body["name"];
          const scope: JSONValue | undefined = body["scope"];

          if (typeof name !== "string" || !name.trim()) {
            throw new BadDataException("Name the metric to add.");
          }

          if (
            scope !== CloudAddedMetricScope.Resource &&
            scope !== CloudAddedMetricScope.Type
          ) {
            throw new BadDataException(
              "Say whether to read the metric for this resource or for every resource of its type.",
            );
          }

          const added: {
            added: CloudAddedMetric;
            addedMetrics: Array<CloudAddedMetric>;
          } = await CloudResourceMetrics.add({
            projectId,
            cloudResourceId: this.readCloudResourceId(req),
            props,
            name,
            scope,
            namespace:
              typeof body["namespace"] === "string"
                ? body["namespace"]
                : undefined,
            aggregation:
              typeof body["aggregation"] === "string"
                ? body["aggregation"]
                : undefined,
            userId: props.userId,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            added as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/resource-metrics/:cloudResourceId/remove`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanChangeReads(props);

          const key: JSONValue | undefined = this.readBody(req)["key"];

          if (typeof key !== "string" || !key) {
            throw new BadDataException("Say which added metric to remove.");
          }

          const removed: { addedMetrics: Array<CloudAddedMetric> } =
            await CloudResourceMetrics.remove({
              projectId,
              cloudResourceId: this.readCloudResourceId(req),
              props,
              key,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            removed as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/resource-metrics/:cloudResourceId/unreported`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          const keys: JSONValue | undefined = this.readBody(req)["keys"];

          if (!Array.isArray(keys)) {
            throw new BadDataException(
              "Name the key metrics to explain, by their keys.",
            );
          }

          const metrics: Array<CloudUnreportedKeyMetricReport> =
            await CloudResourceMetrics.explainUnreported({
              projectId,
              cloudResourceId: this.readCloudResourceId(req),
              props,
              keys: (keys as Array<unknown>).filter(
                (key: unknown): key is string => {
                  return typeof key === "string";
                },
              ),
            });

          return Response.sendJsonObjectResponse(req, res, {
            metrics: metrics as unknown as Array<JSONObject>,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.get(
      `${basePath}/aws-role-setup`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const setup: CloudConnectionAwsRoleSetup =
            await AwsServerIdentity.getRoleSetup({
              projectId: projectId.toString(),
              transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            setup as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * The connection a stream route is for: the project's own, never one the
   * body names, and of a cloud the route is for.
   */
  private async readStreamConnection(
    req: ExpressRequest,
    providers: Array<CloudProvider>,
  ): Promise<StreamConnectionTarget> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);
    this.assertCanOperate(props);

    const connectionId: string | undefined = req.params["connectionId"];

    if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    const connection: CloudConnection | null = await this.service.findOneBy({
      query: { _id: connectionId, projectId },
      select: { _id: true, projectId: true, provider: true },
      props,
    });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: connection?.projectId,
      projectId,
    });

    if (!providers.includes((connection?.provider || "") as CloudProvider)) {
      throw new BadDataException(
        providers.length === 1 && providers[0] === CloudProvider.Azure
          ? "Only Azure connections are read from their event hubs."
          : "Only AWS, Azure and Google Cloud connections stream, and only AWS and Google Cloud with a stream key.",
      );
    }

    return { connectionId: new ObjectID(connectionId), projectId, props };
  }

  // The cloud resource a resource-metrics route is for, by its id.
  private readCloudResourceId(req: ExpressRequest): ObjectID {
    const cloudResourceId: string | undefined = req.params["cloudResourceId"];

    if (!cloudResourceId || !ObjectID.isValidUUID(cloudResourceId)) {
      throw new BadDataException("A valid cloud resource ID is required.");
    }

    return new ObjectID(cloudResourceId);
  }

  private readBody(req: ExpressRequest): JSONObject {
    return req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as JSONObject)
      : {};
  }

  // Whether the caller may change what a connection reads.
  private canOperate(props: DatabaseCommonInteractionProps): boolean {
    try {
      this.assertCanChangeReads(props);
      return true;
    } catch {
      return false;
    }
  }

  private assertCanChangeReads(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new CloudConnection().getUpdatePermissions(),
      errorMessage:
        "Project Owners and Project Admins can change what a cloud connection reads.",
    });
  }

  private assertCanOperate(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new CloudConnection().getUpdatePermissions(),
      errorMessage:
        "Project Owners and Project Admins can connect, test and read cloud accounts.",
    });
  }

  /*
   * The settings a test reads with: a saved connection's, with the form's
   * unsaved values merged over them by the rule a save applies, or settings
   * that were never saved. Validated either way, so a test never sends a
   * request a save would refuse.
   */
  private async readSettingsToTest(data: {
    body: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CloudConnectionSettings> {
    const connectionIdValue: JSONValue | undefined = data.body["connectionId"];

    if (connectionIdValue === undefined || connectionIdValue === null) {
      return CloudConnectionServiceClass.validateSettings({
        provider: data.body["provider"],
        projectId: data.projectId,
        config: CloudConnectionServiceClass.parseJsonObject(
          data.body["config"],
          "Settings",
        ),
        secrets: CloudConnectionServiceClass.parseJsonObject(
          data.body["secrets"],
          "Credentials",
        ),
        requireRequiredSecrets: true,
      });
    }

    const connectionId: string = String(connectionIdValue);

    if (!ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException("A valid connection ID is required.");
    }

    const accessible: CloudConnection | null = await this.service.findOneBy({
      query: { _id: connectionId, projectId: data.projectId },
      select: { _id: true, projectId: true },
      props: data.props,
    });
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: accessible?.projectId,
      projectId: data.projectId,
    });

    const stored: CloudConnectionSettings =
      await this.service.getConnectorSettings(
        (() => {
          const connection: CloudConnection = new CloudConnection();
          connection.id = new ObjectID(connectionId);
          return connection;
        })(),
      );

    return CloudConnectionServiceClass.validateSettings({
      provider: stored.provider,
      // Always the connection's own project, never one the body names.
      projectId: stored.projectId,
      config:
        data.body["config"] !== undefined
          ? CloudConnectionServiceClass.parseJsonObject(
              data.body["config"],
              "Settings",
            )
          : stored.config,
      secrets: CloudConnectionServiceClass.mergeSecrets({
        definition: CloudConnectionServiceClass.getDefinitionOrThrow(
          stored.provider,
        ),
        stored: stored.secrets,
        provided:
          data.body["secrets"] !== undefined
            ? CloudConnectionServiceClass.parseJsonObject(
                data.body["secrets"],
                "Credentials",
              )
            : {},
      }),
      requireRequiredSecrets: true,
    });
  }
}
