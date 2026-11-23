import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import SecurityBlockCloudWaf from "../../Models/DatabaseModels/SecurityBlockCloudWaf";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  AWS_WAF_WEB_ACL_RESOURCE_TYPE,
  AwsWafScope,
} from "../../Types/CloudConnection/AwsWafBlocklist";
import {
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
} from "../../Types/CloudConnection/AzureWafBlocklist";
import { CLOUD_ARMOR_POLICY_ASSET_TYPE } from "../../Types/CloudConnection/CloudArmorBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  isCloudConnectionWafBlocklistOn,
} from "../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { SecurityBlockCloudWafLeftItem } from "../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { getSecurityBlockCloudWafClientAddresses } from "../../Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import { toSecurityBlockReasonJson } from "../../Types/SecurityBlocklist/SecurityBlockReason";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService from "../Services/CloudConnectionService";
import CloudResourceService from "../Services/CloudResourceService";
import SecurityBlockCloudWafService, {
  ResolvedWebAcl,
  SecurityBlockCloudWafRefusal,
  Service as SecurityBlockCloudWafServiceType,
  readInventoryWaf,
} from "../Services/SecurityBlockCloudWafService";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityBlockCloudWafs, {
  SecurityBlockCloudWafAccess,
  SecurityBlockCloudWafRemoval,
} from "../Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * The cloud WAFs that enforce a project's blocklist (#10344, #10348,
 * #10349): their CRUD - a WAF added with POST, where it reads the client's
 * address changed with PUT - and
 *
 *   POST /security-block-cloud-waf/candidates
 *     -> { candidates, connections }: the WAFs of the project's inventory a
 *        person may pick - AWS WAF web ACLs, Azure Application Gateway and
 *        Front Door WAF policies, Cloud Armor security policies - each with
 *        its connection, whether that connection's blocking setting is on,
 *        whether OneUptime can read it whole, whether it is picked already
 *        and the client addresses it can read; and the cloud connections,
 *        so the page can say which to turn the setting on for.
 *   POST /security-block-cloud-waf/check-access { cloudResourceId }
 *     -> { checks, isGranted, command, shell }: for an Azure WAF or Cloud
 *        Armor policy, whether the connection may read and write it, asked
 *        of the cloud without writing anything, and the exact lines that
 *        grant it, for the person to run in Cloud Shell.
 *   POST /security-block-cloud-waf/:cloudWafId/check
 *     -> { cloudWaf }: the WAF set up and read now (Check Again, and as
 *        soon as one is added), where it stands recorded.
 *   POST /security-block-cloud-waf/:cloudWafId/put-back
 *     -> { cloudWaf }: OneUptime's rules someone turned off, changed or
 *        deleted by hand written again (Azure WAF, Cloud Armor).
 *   POST /security-block-cloud-waf/:cloudWafId/remove { keepInCloud? }
 *     -> { leftInCloud }: OneUptime's rules taken out of the WAF and what it
 *        shares with the project's other WAFs deleted once nothing uses it,
 *        then the row; with keepInCloud, the row alone. leftInCloud names
 *        what stays in the cloud for the person to delete, each { kind,
 *        name, webAcl?, priority? }, worded by the page in the reader's
 *        language.
 *
 * Each takes the role that adds a WAF (Project Owner, Project Admin,
 * Security Admin): it writes the customer's cloud. A plain DELETE is
 * refused (SecurityBlockCloudWafService): Remove is the way.
 */

export const SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE: string =
  "/security-block-cloud-waf/candidates";

export const SECURITY_BLOCK_CLOUD_WAF_CHECK_ACCESS_ROUTE: string =
  "/security-block-cloud-waf/check-access";

export const CLOUD_WAF_REFUSED_MESSAGE: string =
  "Adding, checking and removing a WAF takes a role that can change where the blocklist is enforced: Project Owner, Project Admin or Security Admin.";

// The most WAFs the candidates list reads.
export const CLOUD_WAF_CANDIDATES_LIMIT: number = 500;

// The inventory types a WAF is listed as, by cloud.
export const CLOUD_WAF_RESOURCE_TYPES: ReadonlyArray<string> = [
  AWS_WAF_WEB_ACL_RESOURCE_TYPE,
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
  CLOUD_ARMOR_POLICY_ASSET_TYPE,
];

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
      SECURITY_BLOCK_CLOUD_WAF_CHECK_ACCESS_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertCanWrite(req);
          const body: JSONObject = this.readBody(req);
          const cloudResourceId: unknown = body["cloudResourceId"];

          if (
            typeof cloudResourceId !== "string" ||
            !ObjectID.isValidUUID(cloudResourceId)
          ) {
            throw new BadDataException("Pick the policy to check.");
          }

          const access: SecurityBlockCloudWafAccess =
            await SecurityBlockCloudWafs.checkAccess({
              projectId,
              cloudResourceId: new ObjectID(cloudResourceId),
            });

          return Response.sendJsonObjectResponse(req, res, {
            checks: access.checks.map(
              (check: { permission: string; isGranted: boolean }) => {
                return {
                  permission: check.permission,
                  isGranted: check.isGranted,
                };
              },
            ),
            isGranted: access.isGranted,
            command: access.command,
            shell: access.shell,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    for (const [action, run] of [
      [
        "check",
        async (data: {
          projectId: ObjectID;
          cloudWafId: ObjectID;
        }): Promise<SecurityBlockCloudWaf> => {
          return await SecurityBlockCloudWafs.check(data);
        },
      ],
      [
        "put-back",
        async (data: {
          projectId: ObjectID;
          cloudWafId: ObjectID;
        }): Promise<SecurityBlockCloudWaf> => {
          return await SecurityBlockCloudWafs.putBack(data);
        },
      ],
    ] as Array<
      [
        string,
        (data: {
          projectId: ObjectID;
          cloudWafId: ObjectID;
        }) => Promise<SecurityBlockCloudWaf>,
      ]
    >) {
      this.router.post(
        `${basePath}/:cloudWafId/${action}`,
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
        ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            const projectId: ObjectID = await this.assertCanWrite(req);
            const checked: SecurityBlockCloudWaf = await run({
              projectId,
              cloudWafId: this.readCloudWafId(req),
            });

            return Response.sendJsonObjectResponse(req, res, {
              cloudWaf: {
                _id: checked.id?.toString() || null,
                status: checked.status || null,
                statusMessage: checked.statusMessage || null,
                statusReason: checked.statusReason || null,
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
    }

    this.router.post(
      `${basePath}/:cloudWafId/remove`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = await this.assertCanWrite(req);
          const body: JSONObject = this.readBody(req);
          const removal: SecurityBlockCloudWafRemoval =
            await SecurityBlockCloudWafs.remove({
              projectId,
              cloudWafId: this.readCloudWafId(req),
              keepInCloud: body["keepInCloud"] === true,
            });

          return Response.sendJsonObjectResponse(req, res, {
            removed: true,
            leftInCloud: removal.leftInCloud.map(
              (item: SecurityBlockCloudWafLeftItem): JSONObject => {
                return {
                  kind: item.kind,
                  name: item.name,
                  ...(item.webAcl ? { webAcl: item.webAcl } : {}),
                  ...(item.priority !== undefined
                    ? { priority: item.priority }
                    : {}),
                };
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private readBody(req: ExpressRequest): JSONObject {
    return req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as JSONObject)
      : {};
  }

  // The caller's project, once they may add a WAF there.
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
      throw new BadDataException("A valid WAF ID is required.");
    }

    return new ObjectID(id);
  }

  /*
   * The WAFs a person may pick, read as OneUptime from the project's own
   * inventory: names, places and accounts, which say nothing a person who
   * may add a WAF may not know.
   */
  private async readCandidates(projectId: ObjectID): Promise<JSONObject> {
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: {
          projectId,
          provider: QueryHelper.any([
            CloudProvider.AWS,
            CloudProvider.Azure,
            CloudProvider.GCP,
          ]),
        },
        select: { _id: true, name: true, provider: true, config: true },
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
        cloudResourceType: QueryHelper.any([...CLOUD_WAF_RESOURCE_TYPES]),
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
        cloudProvider: true,
        cloudResourceType: true,
        cloudRegion: true,
        cloudAccountId: true,
        cloudProperties: true,
        providerResourceId: true,
        cloudConnectionId: true,
      },
      skip: 0,
      limit: CLOUD_WAF_CANDIDATES_LIMIT,
      props: { isRoot: true },
    });
    const picked: Set<string> = new Set(
      (await SecurityBlockCloudWafService.findForProject(projectId)).map(
        (row: SecurityBlockCloudWaf): string => {
          return (row.wafId || "").toLowerCase();
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
        let waf: Omit<ResolvedWebAcl, "cloudConnectionId"> | null = null;
        let refusal: string = "";
        let refusalReason: JSONObject | null = null;

        try {
          waf = readInventoryWaf(resource);
        } catch (error) {
          refusal = error instanceof Error ? error.message : "";
          refusalReason =
            error instanceof SecurityBlockCloudWafRefusal
              ? toSecurityBlockReasonJson(error.reason)
              : null;
        }

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
          cloudProvider: resource.cloudProvider || "",
          kind: waf?.kind || null,
          name:
            waf?.name ||
            (typeof properties["Name"] === "string"
              ? (properties["Name"] as string)
              : resource.name || ""),
          region: resource.cloudRegion || "",
          accountId: resource.cloudAccountId || "",
          isCloudFront: properties["Scope"] === AwsWafScope.CloudFront,
          cloudArmorPolicyType: waf?.cloudArmorPolicyType || null,
          clientAddresses: [
            ...getSecurityBlockCloudWafClientAddresses({
              kind: waf?.kind || null,
              cloudArmorPolicyType: waf?.cloudArmorPolicyType,
            }),
          ],
          connectionId: connection?.id?.toString() || "",
          connectionName: connection?.name || "",
          isBlockingOn: isOn(connection),
          isListed: Boolean(waf),
          // Why it cannot be picked, when it cannot: a network edge policy.
          refusal: waf ? "" : refusal,
          refusalReason: waf ? null : refusalReason,
          isPicked: Boolean(waf && picked.has(waf.wafId.toLowerCase())),
        };
      }),
      connections: connections.map((connection: CloudConnection) => {
        return {
          _id: connection.id?.toString() || "",
          name: connection.name || "",
          provider: connection.provider || "",
          isBlockingOn: isOn(connection),
        };
      }),
    };
  }
}
