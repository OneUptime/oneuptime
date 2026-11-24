import PrivateUserSessionServiceBase from "./PrivateUserSessionServiceBase";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken, {
  DashboardPrivateUserSessionClaims,
} from "../Utils/JsonWebToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardOIDC from "../../Models/DatabaseModels/DashboardOidc";
import DashboardPrivateUser from "../../Models/DatabaseModels/DashboardPrivateUser";
import Model from "../../Models/DatabaseModels/DashboardPrivateUserSession";
import DashboardSSO from "../../Models/DatabaseModels/DashboardSso";
import ObjectID from "../../Types/ObjectID";

/*
 * The sessions of a dashboard's private users (#10250): the shared rules of
 * PrivateUserSessionServiceBase, over DashboardPrivateUserSession's own
 * columns, and the one place a browser's dashboard session is read from its
 * cookie (findSignedInSessionOnRequest), which every public dashboard route
 * asks through DashboardService.hasReadAccess.
 */
export class Service extends PrivateUserSessionServiceBase<Model> {
  public constructor() {
    super(Model, {
      name: "dashboard",
      columns: {
        resource: "dashboardId",
        privateUser: "dashboardPrivateUserId",
        privateUserRelation: "dashboardPrivateUser",
        sso: "dashboardSsoId",
        oidc: "dashboardOidcId",
      },
      resourceModel: Dashboard,
      ssoModel: DashboardSSO,
      oidcModel: DashboardOIDC,
      privateUserModel: DashboardPrivateUser,
    });
  }

  /*
   * The live session of one of this dashboard's private users this request
   * carries, or null: the dashboard's own access-token cookie, a token
   * OneUptime signed for a dashboard private user's session
   * (JsonWebTokenPurpose.DashboardPrivateUserSession) and for THIS
   * dashboard, and the session it names read live (findSignedInSession):
   * not ended, its private user still the dashboard's, its sign-in still
   * counting under the dashboard's Require SSO to Sign In. A token of
   * another dashboard, one that ran out, or one whose session ended reads
   * as no session at all - the visitor is asked to sign in.
   */
  @CaptureSpan()
  public async findSignedInSessionOnRequest(data: {
    req: ExpressRequest;
    dashboardId: ObjectID;
    requireSsoForLogin: boolean | undefined;
    // The private user's address too, for the page that says who is signed in.
    withEmail?: boolean | undefined;
  }): Promise<Model | null> {
    const token: string | undefined =
      CookieUtil.getDashboardPrivateUserTokenFromExpressRequest(
        data.req,
        data.dashboardId,
      );

    if (!token) {
      return null;
    }

    let claims: DashboardPrivateUserSessionClaims;

    try {
      claims = JSONWebToken.decodeDashboardPrivateUserSession(token);
    } catch {
      // Not a token OneUptime signed for this, or one that ran out.
      return null;
    }

    if (claims.dashboardId.toString() !== data.dashboardId.toString()) {
      return null;
    }

    return await this.findSignedInSession({
      resourceId: data.dashboardId,
      sessionId: claims.sessionId,
      privateUserId: claims.userId,
      requiresSso: Boolean(data.requireSsoForLogin),
      select: data.withEmail
        ? ["session._id", "session.additionalInfo", "privateUser.email"]
        : undefined,
    });
  }
}

export default new Service();
