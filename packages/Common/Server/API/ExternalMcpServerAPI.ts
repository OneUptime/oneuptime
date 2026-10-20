import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import BaseAPI from "./BaseAPI";
import ExternalMcpServerService, {
  Service as ExternalMcpServerServiceType,
} from "../Services/ExternalMcpServerService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ExternalMcpServerCheck from "../Utils/AI/Mcp/ExternalMcpServerCheck";
import { EXTERNAL_MCP_SERVER_CONNECTION_SELECT } from "../Utils/AI/Mcp/ExternalMcpServerConnection";
import ExternalMcpServer from "../../Models/DatabaseModels/ExternalMcpServer";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { PermissionHelper } from "../../Types/Permission";
import { ExternalMcpServerConnectionCheck } from "../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";

/*
 * External MCP servers: their CRUD, plus "Test connection".
 *
 * Test connects to a saved server with its saved sign-in, reads its tools,
 * closes the session and says what it found - kept on the server's record
 * too, so the list says how each server is doing. It calls no tool, so it
 * changes nothing on the server; but it reaches a system outside OneUptime
 * with the project's credential, so it is for the people who set servers
 * up: whoever may change the server, in its project (its update rule, a
 * team's block counted, on a credential that may make changes and on the
 * plan that sells servers - findOneUpdatableById). Who the caller is comes
 * first, before any read, so a caller learns nothing about a server they
 * may not test; a server of another project and one that does not exist
 * are answered alike.
 *
 * A server that cannot be reached is the test's answer, not a failed
 * request: it is sent back like any other result (isConnected false).
 */

export const EXTERNAL_MCP_SERVER_NOT_FOUND_MESSAGE: string =
  "MCP server not found, or you do not have access to it.";

export const EXTERNAL_MCP_SERVER_ID_REQUIRED_MESSAGE: string =
  "externalMcpServerId is required";

export const EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE: string =
  "You do not have permission to test this MCP server.";

export function getExternalMcpServerTestRefusal(): string {
  const titles: Array<string> = PermissionHelper.getPermissionTitles(
    new ExternalMcpServer().getUpdatePermissions(),
  );

  return `${EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE} You need one of these permissions: ${titles.join(", ")}.`;
}

/*
 * The id the request names. Not an id at all is answered like one that
 * names no server: the id column is a uuid.
 */
function toServerId(value: unknown): ObjectID {
  if (value === undefined || value === null || value === "") {
    throw new BadDataException(EXTERNAL_MCP_SERVER_ID_REQUIRED_MESSAGE);
  }

  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(EXTERNAL_MCP_SERVER_NOT_FOUND_MESSAGE);
  }

  return new ObjectID(value);
}

/*
 * The server to test - its settings and secrets, read as OneUptime - once
 * the caller may test it. Throws what to tell them otherwise.
 */
export async function getExternalMcpServerToTest(data: {
  props: DatabaseCommonInteractionProps;
  externalMcpServerId: unknown;
}): Promise<ExternalMcpServer> {
  const id: ObjectID = toServerId(data.externalMcpServerId);

  if (!data.props.isMasterAdmin) {
    // A signed-in member of the project the request names, or its API key.
    CommonAPI.assertAuthenticatedProjectPrincipal(data.props);

    CommonAPI.assertPermittedInProject({
      databaseProps: data.props,
      allowedPermissions: new ExternalMcpServer().getUpdatePermissions(),
      errorMessage: getExternalMcpServerTestRefusal(),
    });
  }

  const server: ExternalMcpServer | null =
    await ExternalMcpServerService.findOneUpdatableById({
      id: id,
      select: EXTERNAL_MCP_SERVER_CONNECTION_SELECT,
      props: data.props,
    });

  if (!server) {
    throw new BadDataException(EXTERNAL_MCP_SERVER_NOT_FOUND_MESSAGE);
  }

  return server;
}

export default class ExternalMcpServerAPI extends BaseAPI<
  ExternalMcpServer,
  ExternalMcpServerServiceType
> {
  public constructor() {
    super(ExternalMcpServer, ExternalMcpServerService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject =
            req.body && typeof req.body === "object" ? req.body : {};

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          let server: ExternalMcpServer;

          try {
            server = await getExternalMcpServerToTest({
              props,
              externalMcpServerId: body["externalMcpServerId"],
            });
          } catch (error) {
            if (error instanceof Exception) {
              return Response.sendErrorResponse(req, res, error);
            }

            throw error;
          }

          const check: ExternalMcpServerConnectionCheck =
            await ExternalMcpServerCheck.run({ server });

          await ExternalMcpServerCheck.recordConnection({
            serverId: server.id!,
            check,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            check as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
