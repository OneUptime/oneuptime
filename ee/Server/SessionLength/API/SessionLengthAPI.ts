import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import UserSessionService, {
  SessionLengthsImpact,
} from "Common/Server/Services/UserSessionService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  getSessionLengthProblem,
  readSessionLengths,
  SESSION_LENGTH_COLUMNS,
  SessionLengthColumn,
  SessionLengths,
} from "Common/Types/UserSession/SessionLength";

/*
 * What a change to the session lengths would do to the people signed in
 * now, asked before it is saved (Admin Dashboard > Settings > Session
 * Length). Mounted under "/api":
 *
 *   POST /session-length/preview    master admins: the lengths the change
 *                                   would leave, as GlobalConfig's four
 *                                   columns (null or left out for the
 *                                   default) -> how many people it signs
 *                                   out at once, and whether the asker is
 *                                   one of them.
 *
 * Nothing is changed. The answer is what UserSessionService.
 * endSessionsPastLengths would end if the change were saved now, counted
 * the way it ends them, by the database's clock.
 *
 * A router of routes only, no router.use() (see EnterpriseArea).
 */

export const SESSION_LENGTH_PREVIEW_ROUTE: string = "/session-length/preview";

export interface SessionLengthPreview {
  // How many people the change signs out at once.
  peopleSignedOut: number;
  // Whether the master admin asking is one of them.
  includesYou: boolean;
}

export interface SessionLengthRouterDependencies {
  countPeoplePastLengths: (data: {
    lengths: SessionLengths;
    sessionId?: ObjectID | undefined;
  }) => Promise<SessionLengthsImpact>;
  readRequestSession: (req: ExpressRequest) => Promise<RequestSession>;
}

const getDefaultDependencies: () => SessionLengthRouterDependencies =
  (): SessionLengthRouterDependencies => {
    return {
      countPeoplePastLengths: (data: {
        lengths: SessionLengths;
        sessionId?: ObjectID | undefined;
      }): Promise<SessionLengthsImpact> => {
        return UserSessionService.countPeoplePastLengths(data);
      },
      readRequestSession: (req: ExpressRequest): Promise<RequestSession> => {
        return UserMiddleware.readRequestSession(req);
      },
    };
  };

/*
 * The lengths a preview asks about, from its body: each column's value as
 * GlobalConfigService would take it - refused with the same words when it
 * would be refused there.
 */
export const parseSessionLengthPreview: (body: unknown) => SessionLengths = (
  body: unknown,
): SessionLengths => {
  const values: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};

  const row: Partial<Record<SessionLengthColumn, unknown>> = {};

  for (const column of SESSION_LENGTH_COLUMNS) {
    const value: unknown = values[column];
    const problem: string | null = getSessionLengthProblem(column, value);

    if (problem) {
      throw new BadDataException(problem);
    }

    row[column] = value;
  }

  return readSessionLengths(row);
};

export const createSessionLengthRouter: (
  dependencies?: Partial<SessionLengthRouterDependencies>,
) => ExpressRouter = (
  dependencies?: Partial<SessionLengthRouterDependencies>,
): ExpressRouter => {
  const deps: SessionLengthRouterDependencies = {
    ...getDefaultDependencies(),
    ...(dependencies || {}),
  };

  const router: ExpressRouter = Express.getRouter();

  router.post(
    SESSION_LENGTH_PREVIEW_ROUTE,
    MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      try {
        const lengths: SessionLengths = parseSessionLengthPreview(req.body);

        // The asker's own session, read as the gate above read it.
        const requestSession: RequestSession =
          await deps.readRequestSession(req);

        const sessionId: ObjectID | undefined =
          requestSession.kind === "user"
            ? requestSession.session.sessionId
            : undefined;

        const impact: SessionLengthsImpact = await deps.countPeoplePastLengths(
          {
            lengths,
            sessionId,
          },
        );

        const preview: SessionLengthPreview = {
          peopleSignedOut: impact.peopleCount,
          includesYou: impact.includesSession,
        };

        return Response.sendJsonObjectResponse(
          req,
          res,
          preview as unknown as JSONObject,
        );
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};

export default createSessionLengthRouter;
