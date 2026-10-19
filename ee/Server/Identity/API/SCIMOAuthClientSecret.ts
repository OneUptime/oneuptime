import { SCIM_TOKEN_ROUTE } from "./SCIMOAuthToken";
import {
  generateScimClientSecret,
  getScimClientSecretExpiry,
  hashScimClientSecret,
  ScimConnectionType,
} from "../Utils/SCIMOAuth";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { IdentityRoute } from "Common/ServiceRoute";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * A SCIM CONNECTION'S OAUTH 2.0 CLIENT SECRETS, FROM THE DASHBOARD.
 *
 *   POST   /<connection>/:id/oauth-client-secret           make a secret
 *   DELETE /<connection>/:id/oauth-client-secret/previous  delete the one before
 *
 * for project-scim and status-page-scim connections, under /api.
 *
 * The secret is made here, from crypto.randomBytes, answered once, and kept
 * only as its hash (Utils/SCIMOAuth.ts). Making one replaces the current
 * secret, which keeps working, as the previous one, until it expires or is
 * deleted - so the identity provider can be given the new one with no gap
 * in provisioning (Microsoft Entra ID's gallery requires rotation with
 * several live secrets).
 *
 * WHO MAY. The caller must be signed in to the project (or hold its API key)
 * before anything about the connection is read, and a connection of another
 * project is refused exactly as one that does not exist, so these routes
 * cannot be used to learn which ids exist. The write then goes through the
 * connection's own service with the caller's permissions
 * (CommonAPI.getDatabaseCommonInteractionProps): the columns' access control
 * (a project owner for a project connection, whoever may edit the status
 * page's single sign-on for a status page's), the plan the table needs, the
 * Enterprise Edition, the tenant, and what saving a connection takes
 * (SsoProviderTeamGrant) - every check a save through the API makes. A write
 * that matched no row is refused, and no secret is answered: a secret is
 * only ever shown once it is stored.
 * ---------------------------------------------------------------------------
 */

export const SCIM_CLIENT_SECRET_ROUTE_SUFFIX: string = "oauth-client-secret";

interface ConnectionKind {
  type: ScimConnectionType;
  // The connection's CRUD path, which these routes sit under.
  path: string;
  idParameter: string;
  findSecrets: (id: ObjectID) => Promise<ProjectSCIM | StatusPageSCIM | null>;
  update: (data: {
    id: ObjectID;
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
  }) => Promise<number>;
}

const SECRETS_SELECT: {
  _id: true;
  projectId: true;
  oauthClientSecretHash: true;
  oauthClientSecretExpiresAt: true;
} = {
  _id: true,
  projectId: true,
  oauthClientSecretHash: true,
  oauthClientSecretExpiresAt: true,
};

const CONNECTION_KINDS: ReadonlyArray<ConnectionKind> = [
  {
    type: "project",
    path: "/project-scim",
    idParameter: "projectScimId",
    findSecrets: (id: ObjectID): Promise<ProjectSCIM | null> => {
      return ProjectSCIMService.findOneBy({
        query: { _id: id },
        select: SECRETS_SELECT,
        props: { isRoot: true },
      });
    },
    update: (data: {
      id: ObjectID;
      data: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      return ProjectSCIMService.updateOneById({
        id: data.id,
        data: data.data as any,
        props: data.props,
      });
    },
  },
  {
    type: "status-page",
    path: "/status-page-scim",
    idParameter: "statusPageScimId",
    findSecrets: (id: ObjectID): Promise<StatusPageSCIM | null> => {
      return StatusPageSCIMService.findOneBy({
        query: { _id: id },
        select: SECRETS_SELECT,
        props: { isRoot: true },
      });
    },
    update: (data: {
      id: ObjectID;
      data: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      return StatusPageSCIMService.updateOneById({
        id: data.id,
        data: data.data as any,
        props: data.props,
      });
    },
  },
];

// The token endpoint, as an identity provider is configured with it.
export const getScimTokenEndpoint: () => string = (): string => {
  return `${HttpProtocol.toString()}${Host}${IdentityRoute.toString()}${SCIM_TOKEN_ROUTE}`;
};

const NOT_FOUND_MESSAGE: string =
  "SCIM connection not found, or you may not change its client secrets.";

/*
 * The caller's props and the connection the path names, read as root only
 * once the caller is known to belong to a project, and only if it is that
 * project's: a connection of another project, a missing one and a malformed
 * id from an authenticated caller are refused alike
 * (CommonAPI.assertResourceBelongsToProject).
 */
const getAuthorizedConnection: (
  req: ExpressRequest,
  kind: ConnectionKind,
) => Promise<{
  props: DatabaseCommonInteractionProps;
  id: ObjectID;
  connection: ProjectSCIM | StatusPageSCIM;
}> = async (
  req: ExpressRequest,
  kind: ConnectionKind,
): Promise<{
  props: DatabaseCommonInteractionProps;
  id: ObjectID;
  connection: ProjectSCIM | StatusPageSCIM;
}> => {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);
  const projectId: ObjectID =
    CommonAPI.assertAuthenticatedProjectPrincipal(props);

  const idParameter: string = (req.params[kind.idParameter] as string) || "";
  const id: ObjectID | null = ObjectID.isValidUUID(idParameter)
    ? new ObjectID(idParameter)
    : null;

  const connection: ProjectSCIM | StatusPageSCIM | null = id
    ? await kind.findSecrets(id)
    : null;

  CommonAPI.assertResourceBelongsToProject({
    resourceProjectId: connection?.projectId,
    projectId: projectId,
  });

  return { props: props, id: id!, connection: connection! };
};

const router: ExpressRouter = Express.getRouter();

for (const kind of CONNECTION_KINDS) {
  router.post(
    `${kind.path}/:${kind.idParameter}/${SCIM_CLIENT_SECRET_ROUTE_SUFFIX}`,
    UserMiddleware.getUserMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        // Read as root to move the current secret aside: its hash is never answered.
        const {
          props,
          id,
          connection,
        }: {
          props: DatabaseCommonInteractionProps;
          id: ObjectID;
          connection: ProjectSCIM | StatusPageSCIM;
        } = await getAuthorizedConnection(req, kind);

        const now: Date = OneUptimeDate.getCurrentDate();
        const secret: string = generateScimClientSecret();
        const expiresAt: Date = getScimClientSecretExpiry(now);

        const currentIsLive: boolean =
          Boolean(connection.oauthClientSecretHash) &&
          Boolean(connection.oauthClientSecretExpiresAt) &&
          new Date(connection.oauthClientSecretExpiresAt!).getTime() >
            now.getTime();

        const updated: number = await kind.update({
          id: id,
          data: {
            oauthClientSecretHash: hashScimClientSecret(secret),
            oauthClientSecretExpiresAt: expiresAt,
            oauthPreviousClientSecretHash: currentIsLive
              ? connection.oauthClientSecretHash!
              : null,
            oauthPreviousClientSecretExpiresAt: currentIsLive
              ? connection.oauthClientSecretExpiresAt!
              : null,
          } as JSONObject,
          props: props,
        });

        if (updated === 0) {
          throw new NotFoundException(NOT_FOUND_MESSAGE);
        }

        return Response.sendJsonObjectResponse(req, res, {
          clientId: id.toString(),
          clientSecret: secret,
          clientSecretExpiresAt: expiresAt.toISOString(),
          previousClientSecretExpiresAt: currentIsLive
            ? new Date(connection.oauthClientSecretExpiresAt!).toISOString()
            : null,
          tokenEndpoint: getScimTokenEndpoint(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    `${kind.path}/:${kind.idParameter}/${SCIM_CLIENT_SECRET_ROUTE_SUFFIX}/previous`,
    UserMiddleware.getUserMiddleware,
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const {
          props,
          id,
        }: {
          props: DatabaseCommonInteractionProps;
          id: ObjectID;
          connection: ProjectSCIM | StatusPageSCIM;
        } = await getAuthorizedConnection(req, kind);

        const updated: number = await kind.update({
          id: id,
          data: {
            oauthPreviousClientSecretHash: null,
            oauthPreviousClientSecretExpiresAt: null,
          } as JSONObject,
          props: props,
        });

        if (updated === 0) {
          throw new NotFoundException(NOT_FOUND_MESSAGE);
        }

        return Response.sendJsonObjectResponse(req, res, {
          clientId: id.toString(),
          previousClientSecretExpiresAt: null,
        });
      } catch (err) {
        next(err);
      }
    },
  );
}

export default router;
