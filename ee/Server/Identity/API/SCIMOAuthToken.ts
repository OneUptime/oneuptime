import LicensedFeatureGate from "../Middleware/LicensedFeatureGate";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../Utils/SCIMLogger";
import {
  matchScimClientSecret,
  SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  ScimConnectionType,
  signScimAccessToken,
} from "../Utils/SCIMOAuth";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";

/*
 * ---------------------------------------------------------------------------
 * POST /scim/oauth/token - THE TOKEN ENDPOINT OF SCIM'S OAUTH 2.0 CLIENT
 * CREDENTIALS (RFC 6749, section 4.4).
 *
 * One endpoint for every connection, project or status page: the client ID
 * is the connection's id, and the client secret one of the secrets
 * OneUptime made for it (Utils/SCIMOAuth.ts). The client authenticates with
 * HTTP Basic - its id and secret form-urlencoded, then base64-encoded
 * (section 2.3.1), as Microsoft Entra ID sends them by default - or with
 * client_id and client_secret in the form body, never both. The answer is an
 * access token for an hour, which the SCIM routes take as a bearer token.
 *
 * An expired secret, a deleted one, or anything else that is not one of the
 * connection's secrets is invalid_client (401), and the answer never says
 * which. Below the plan SCIM needs, tokens are still issued: a connection
 * there still takes access away, and needs a token to (Utils/SCIMBelowPlan).
 *
 * Gated like every SCIM route (LicensedFeatureGate): without a license that
 * covers SCIM, no token.
 * ---------------------------------------------------------------------------
 */

export const SCIM_TOKEN_ROUTE: string = "/scim/oauth/token";

const GRANT_TYPE_CLIENT_CREDENTIALS: string = "client_credentials";

// RFC 6749, section 5.2.
type TokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "unsupported_grant_type";

class TokenRequestError extends Error {
  public readonly code: TokenErrorCode;
  public readonly statusCode: number;

  public constructor(code: TokenErrorCode, description: string) {
    super(description);
    this.code = code;
    this.statusCode = code === "invalid_client" ? 401 : 400;
  }
}

// One description for every client that is not one: it tells a guesser nothing.
const INVALID_CLIENT_DESCRIPTION: string =
  "The client ID is not a SCIM connection's, or the client secret is not one of its secrets, or that secret has expired.";

const sendTokenResponse: (
  res: ExpressResponse,
  statusCode: number,
  body: JSONObject,
) => void = (
  res: ExpressResponse,
  statusCode: number,
  body: JSONObject,
): void => {
  // RFC 6749, section 5.1: a token, or the error in place of one, is never cached.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  (res as OneUptimeResponse).logBody = body["access_token"]
    ? { token_type: body["token_type"], expires_in: body["expires_in"] }
    : body;
  res.status(statusCode).json(body);
};

const getParameter: (body: unknown, name: string) => string | undefined = (
  body: unknown,
  name: string,
): string | undefined => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value: unknown = (body as JSONObject)[name];

  return typeof value === "string" ? value : undefined;
};

// application/x-www-form-urlencoded decoding: "+" is a space.
const formDecode: (value: string) => string = (value: string): string => {
  return decodeURIComponent(value.replace(/\+/g, " "));
};

/*
 * The client's id and secret, from HTTP Basic or the form body - one, not
 * both (RFC 6749, section 2.3).
 */
const getClientCredentials: (req: ExpressRequest) => {
  clientId: string;
  clientSecret: string;
  viaBasic: boolean;
} = (
  req: ExpressRequest,
): { clientId: string; clientSecret: string; viaBasic: boolean } => {
  const authorization: unknown = req.headers?.["authorization"];
  const bodyClientId: string | undefined = getParameter(req.body, "client_id");
  const bodyClientSecret: string | undefined = getParameter(
    req.body,
    "client_secret",
  );

  if (
    typeof authorization === "string" &&
    authorization.substring(0, 6).toLowerCase() === "basic "
  ) {
    if (bodyClientSecret !== undefined) {
      throw new TokenRequestError(
        "invalid_request",
        "Authenticate the client with HTTP Basic or with client_id and client_secret in the body, not both.",
      );
    }

    let decoded: string;

    try {
      decoded = Buffer.from(
        authorization.substring(6).trim(),
        "base64",
      ).toString("utf8");
    } catch {
      throw new TokenRequestError("invalid_client", INVALID_CLIENT_DESCRIPTION);
    }

    const separator: number = decoded.indexOf(":");

    if (separator < 0) {
      throw new TokenRequestError("invalid_client", INVALID_CLIENT_DESCRIPTION);
    }

    let clientId: string;
    let clientSecret: string;

    try {
      clientId = formDecode(decoded.substring(0, separator));
      clientSecret = formDecode(decoded.substring(separator + 1));
    } catch {
      throw new TokenRequestError("invalid_client", INVALID_CLIENT_DESCRIPTION);
    }

    if (bodyClientId !== undefined && bodyClientId !== clientId) {
      throw new TokenRequestError(
        "invalid_request",
        "The client_id in the body is not the one HTTP Basic names.",
      );
    }

    return { clientId, clientSecret, viaBasic: true };
  }

  if (bodyClientId === undefined || bodyClientSecret === undefined) {
    throw new TokenRequestError(
      "invalid_client",
      "Authenticate the client: HTTP Basic with the client ID and secret, or client_id and client_secret in the body.",
    );
  }

  return {
    clientId: bodyClientId,
    clientSecret: bodyClientSecret,
    viaBasic: false,
  };
};

const SECRETS_SELECT: {
  _id: true;
  projectId: true;
  oauthClientSecretHash: true;
  oauthClientSecretExpiresAt: true;
  oauthPreviousClientSecretHash: true;
  oauthPreviousClientSecretExpiresAt: true;
} = {
  _id: true,
  projectId: true,
  oauthClientSecretHash: true,
  oauthClientSecretExpiresAt: true,
  oauthPreviousClientSecretHash: true,
  oauthPreviousClientSecretExpiresAt: true,
};

interface ScimClient {
  type: ScimConnectionType;
  connection: ProjectSCIM | StatusPageSCIM;
}

// The connection a client ID names - project SCIM first, as the routes look - or null.
const findClient: (clientId: string) => Promise<ScimClient | null> = async (
  clientId: string,
): Promise<ScimClient | null> => {
  if (!ObjectID.isValidUUID(clientId)) {
    return null;
  }

  const project: ProjectSCIM | null = await ProjectSCIMService.findOneBy({
    query: { _id: new ObjectID(clientId) },
    select: SECRETS_SELECT,
    props: { isRoot: true },
  });

  if (project) {
    return { type: "project", connection: project };
  }

  const statusPage: StatusPageSCIM | null =
    await StatusPageSCIMService.findOneBy({
      query: { _id: new ObjectID(clientId) },
      select: { ...SECRETS_SELECT, statusPageId: true },
      props: { isRoot: true },
    });

  return statusPage ? { type: "status-page", connection: statusPage } : null;
};

// The connection's SCIM log: who asked for a token, and what came of it.
const logTokenRequest: (data: {
  req: ExpressRequest;
  client: ScimClient;
  issued: boolean;
  statusCode: number;
  message: string;
}) => void = (data: {
  req: ExpressRequest;
  client: ScimClient;
  issued: boolean;
  statusCode: number;
  message: string;
}): void => {
  const entry: {
    operationType: string;
    status: SCIMLogStatus;
    statusMessage: string;
    httpMethod: string;
    requestPath: string;
    httpStatusCode: number;
    steps: Array<string>;
  } = {
    operationType: "IssueAccessToken",
    status: data.issued ? SCIMLogStatus.Success : SCIMLogStatus.Error,
    statusMessage: data.message,
    httpMethod: "POST",
    requestPath: data.req.path,
    httpStatusCode: data.statusCode,
    steps: [data.message],
  };

  if (data.client.type === "project") {
    void createProjectSCIMLog({
      ...entry,
      projectId: data.client.connection.projectId!,
      projectScimId: data.client.connection.id!,
    });
    return;
  }

  const statusPageConnection: StatusPageSCIM = data.client
    .connection as StatusPageSCIM;

  void createStatusPageSCIMLog({
    ...entry,
    projectId: statusPageConnection.projectId!,
    statusPageId: statusPageConnection.statusPageId!,
    statusPageScimId: statusPageConnection.id!,
  });
};

const router: ExpressRouter = Express.getRouter();

router.post(
  SCIM_TOKEN_ROUTE,
  LicensedFeatureGate.forScim,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    let client: ScimClient | null = null;
    let viaBasic: boolean = false;

    try {
      const grantType: string | undefined = getParameter(
        req.body,
        "grant_type",
      );

      if (!grantType) {
        throw new TokenRequestError(
          "invalid_request",
          "grant_type is required: client_credentials.",
        );
      }

      if (grantType !== GRANT_TYPE_CLIENT_CREDENTIALS) {
        throw new TokenRequestError(
          "unsupported_grant_type",
          "SCIM connections take the client_credentials grant only.",
        );
      }

      const credentials: {
        clientId: string;
        clientSecret: string;
        viaBasic: boolean;
      } = getClientCredentials(req);
      viaBasic = credentials.viaBasic;

      client = await findClient(credentials.clientId);

      const secretHash: string | null = client
        ? matchScimClientSecret({
            secret: credentials.clientSecret,
            connection: client.connection,
            now: OneUptimeDate.getCurrentDate(),
          })
        : null;

      if (!client || !secretHash) {
        throw new TokenRequestError(
          "invalid_client",
          INVALID_CLIENT_DESCRIPTION,
        );
      }

      const accessToken: string = signScimAccessToken({
        connectionId: client.connection.id!.toString(),
        connectionType: client.type,
        secretHash: secretHash,
      });

      logTokenRequest({
        req: req,
        client: client,
        issued: true,
        statusCode: 200,
        message: `Issued an access token for ${SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS / 60} minutes`,
      });

      return sendTokenResponse(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      });
    } catch (err) {
      if (!(err instanceof TokenRequestError)) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));

        return sendTokenResponse(res, 500, {
          error: "server_error",
          error_description:
            "OneUptime could not issue an access token. Try again.",
        });
      }

      // A known connection whose secret was refused: its admins see why.
      if (client) {
        logTokenRequest({
          req: req,
          client: client,
          issued: false,
          statusCode: err.statusCode,
          message: `Refused: ${err.message}`,
        });
      }

      if (err.statusCode === 401 && viaBasic) {
        // RFC 6749, section 5.2: answer the scheme the client used.
        res.setHeader("WWW-Authenticate", 'Basic realm="OneUptime SCIM"');
      }

      return sendTokenResponse(res, err.statusCode, {
        error: err.code,
        error_description: err.message,
      });
    }
  },
);

export default router;
