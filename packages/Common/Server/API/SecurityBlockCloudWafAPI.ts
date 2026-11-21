import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import SecurityBlockCloudWaf from "../../Models/DatabaseModels/SecurityBlockCloudWaf";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  AWS_WAF_WEB_ACL_RESOURCE_TYPE,
  AwsWafScope,
  buildAwsWafWebAclArn,
} from "../../Types/CloudConnection/AwsWafBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  isCloudConnectionWafBlocklistOn,
} from "../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService from "../Services/CloudConnectionService";
import CloudResourceService from "../Services/CloudResourceService";
import SecurityBlockCloudWafService, {
  Service as SecurityBlockCloudWafServiceType,
} from "../Services/SecurityBlockCloudWafService";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityBlockCloudWafs, {
  SecurityBlockCloudWafRemoval,
} from "../Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * The cloud WAFs that enforce a project's blocklist (#10344): their CRUD -
 * a web ACL added with POST, where it reads the client's address changed
 * with PUT - and
 *
 *   POST /security-block-cloud-waf/candidates
 *     -> { candidates, connections }: the AWS WAF web ACLs of the project's
 *        inventory a person may pick - each with its connection, whether
 *        that connection's Block addresses in AWS WAF is on, whether
 *        OneUptime has listed it (its ARN is known) and whether it is
 *        picked already - and the AWS connections, so the page can say
 *        which to turn the setting on for.
 *   POST /security-block-cloud-waf/:cloudWafId/check
 *     -> { cloudWaf }: the web ACL set up and read now (Check Again, and as
 *        soon as one is added): OneUptime's IP sets made, its rule placed
 *        or looked for, where it stands recorded.
 *   POST /security-block-cloud-waf/:cloudWafId/remove { keepInCloud? }
 *     -> { leftInCloud }: OneUptime's rule taken out of the web ACL and its
 *        IP sets deleted once nothing uses them, then the row; with
 *        keepInCloud, the row alone. leftInCloud names what stays in AWS
 *        WAF for the person to delete, each { kind: "rule" | "ipSet",
 *        name, webAcl? }, worded by the page in the reader's language.
 *
 * Each takes the role that adds a web ACL (Project Owner, Project Admin,
 * Security Admin): it writes the customer's cloud. A plain DELETE is
 * refused (SecurityBlockCloudWafService): Remove is the way.
 */

export const SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE: string =
  "/security-block-cloud-waf/candidates";

export const CLOUD_WAF_REFUSED_MESSAGE: string =
  "Adding, checking and removing a web ACL takes a role that can change where the blocklist is enforced: Project Owner, Project Admin or Security Admin.";

// The most web ACLs the candidates list reads.
export const CLOUD_WAF_CANDIDATES_LIMIT: number = 500;

export default class SecurityBlockCloudWafAPI extends BaseAPI<
  SecurityBlockCloudWaf,
  SecurityBlockCloudWafServiceType
> {
  public constructor() {
    super(SecurityBlockCloudWaf, SecurityBlockCloudWafService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertCanWrite(req);

          return Response.sendJsonObjectResponse(
            req,
            res,
            await this.readCandidates(projectId),
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:cloudWafId/check`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertCanWrite(req);
          const checked: SecurityBlockCloudWaf =
            await SecurityBlockCloudWafs.check({
              projectId,
              cloudWafId: this.readCloudWafId(req),
            });

          return Response.sendJsonObjectResponse(req, res, {
            cloudWaf: {
              _id: checked.id?.toString() || null,
              status: checked.status || null,
              statusMessage: checked.statusMessage || null,
              ruleDetails: checked.ruleDetails || null,
              checkedAt: checked.checkedAt
                ? new Date(checked.checkedAt).toISOString()
                : null,
            },
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/:cloudWafId/remove`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertCanWrite(req);
          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};
          const removal: SecurityBlockCloudWafRemoval =
            await SecurityBlockCloudWafs.remove({
              projectId,
              cloudWafId: this.readCloudWafId(req),
              keepInCloud: body["keepInCloud"] === true,
            });

          return Response.sendJsonObjectResponse(req, res, {
            removed: true,
            leftInCloud: removal.leftInCloud,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  // The caller's project, once they may add a web ACL there.
  private async assertCanWrite(req: ExpressRequest): Promise<ObjectID> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectPrincipal(props);

    CommonAPI.assertCanCreateTable({
      modelType: SecurityBlockCloudWaf,
      props,
      errorMessage: CLOUD_WAF_REFUSED_MESSAGE,
    });

    return projectId;
  }

  private readCloudWafId(req: ExpressRequest): ObjectID {
    const id: string | undefined = req.params["cloudWafId"];

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException("A valid web ACL ID is required.");
    }

    return new ObjectID(id);
  }

  /*
   * The web ACLs a person may pick, read as OneUptime from the project's
   * own inventory: names, Regions and accounts, which say nothing a
   * person who may add a web ACL may not know.
   */
  private async readCandidates(projectId: ObjectID): Promise<JSONObject> {
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: { projectId, provider: CloudProvider.AWS },
        select: { _id: true, name: true, config: true },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      });

    if (connections.length === 0) {
      return { candidates: [], connections: [] };
    }

    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId,
        isArchived: false,
        cloudResourceType: AWS_WAF_WEB_ACL_RESOURCE_TYPE,
        cloudConnectionId: QueryHelper.any(
          connections
            .map((connection: CloudConnection): ObjectID | undefined => {
              return connection.id || undefined;
            })
            .filter((id: ObjectID | undefined): id is ObjectID => {
              return Boolean(id);
            }),
        ),
      },
      select: {
        _id: true,
        name: true,
        cloudRegion: true,
        cloudAccountId: true,
        cloudProperties: true,
        cloudConnectionId: true,
      },
      skip: 0,
      limit: CLOUD_WAF_CANDIDATES_LIMIT,
      props: { isRoot: true },
    });
    const picked: Set<string> = new Set(
      (await SecurityBlockCloudWafService.findForProject(projectId)).map(
        (row: SecurityBlockCloudWaf): string => {
          return row.wafId || "";
        },
      ),
    );
    const isOn: (connection: CloudConnection | undefined) => boolean = (
      connection: CloudConnection | undefined,
    ): boolean => {
      return isCloudConnectionWafBlocklistOn(
        (connection?.config || {})[WAF_BLOCKLIST_FIELD_KEY],
      );
    };

    return {
      candidates: resources.map((resource: CloudResource): JSONObject => {
        const properties: JSONObject = resource.cloudProperties || {};
        const name: string =
          typeof properties["Name"] === "string"
            ? (properties["Name"] as string)
            : resource.name || "";
        const arn: string | null = buildAwsWafWebAclArn({
          region: resource.cloudRegion,
          accountId: resource.cloudAccountId,
          scope: properties["Scope"],
          name,
          id: properties["Id"],
        });
        const connection: CloudConnection | undefined = connections.find(
          (candidate: CloudConnection): boolean => {
            return (
              candidate.id?.toString() ===
              resource.cloudConnectionId?.toString()
            );
          },
        );

        return {
          cloudResourceId: resource.id?.toString() || "",
          name,
          region: resource.cloudRegion || "",
          accountId: resource.cloudAccountId || "",
          isCloudFront: properties["Scope"] === AwsWafScope.CloudFront,
          connectionId: connection?.id?.toString() || "",
          connectionName: connection?.name || "",
          isBlockingOn: isOn(connection),
          isListed: Boolean(arn),
          isPicked: Boolean(arn && picked.has(arn)),
        };
      }),
      connections: connections.map((connection: CloudConnection) => {
        return {
          _id: connection.id?.toString() || "",
          name: connection.name || "",
          isBlockingOn: isOn(connection),
        };
      }),
    };
  }
}
