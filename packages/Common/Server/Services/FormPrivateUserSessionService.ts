import PrivateUserSessionServiceBase from "./PrivateUserSessionServiceBase";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken, {
  FormPrivateUserSessionClaims,
} from "../Utils/JsonWebToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Form from "../../Models/DatabaseModels/Form";
import FormOIDC from "../../Models/DatabaseModels/FormOidc";
import FormPrivateUser from "../../Models/DatabaseModels/FormPrivateUser";
import Model from "../../Models/DatabaseModels/FormPrivateUserSession";
import FormSSO from "../../Models/DatabaseModels/FormSso";
import ObjectID from "../../Types/ObjectID";

/*
 * What a public form route hands FormService of its visitor (#10249): a way
 * to read the session one of the form's private users holds on it - from
 * the form's own cookie, and nothing else of the request. The service is
 * never told who is calling: not a OneUptime session, nor anything a
 * visitor sent but that cookie.
 */
export type FormSessionReader = (form: {
  formId: ObjectID;
  requireSsoForLogin: boolean | undefined;
  // The private user's address too, for the page that says who is signed in.
  withEmail?: boolean | undefined;
}) => Promise<Model | null>;

/*
 * The sessions of a form's private users (#10249): the shared rules of
 * PrivateUserSessionServiceBase, over FormPrivateUserSession's own
 * columns, and the one place a browser's form session is read from its
 * cookie (findSignedInSessionOnRequest), which every public form route
 * hands FormService as its reader (getSessionReader) before the form is
 * shown or taken.
 */
export class Service extends PrivateUserSessionServiceBase<Model> {
  public constructor() {
    super(Model, {
      name: "form",
      columns: {
        resource: "formId",
        privateUser: "formPrivateUserId",
        privateUserRelation: "formPrivateUser",
        sso: "formSsoId",
        oidc: "formOidcId",
      },
      resourceModel: Form,
      ssoModel: FormSSO,
      oidcModel: FormOIDC,
      privateUserModel: FormPrivateUser,
    });
  }

  /*
   * The live session of one of this form's private users this request
   * carries, or null: the form's own access-token cookie, a token
   * OneUptime signed for a form private user's session
   * (JsonWebTokenPurpose.FormPrivateUserSession) and for THIS
   * form, and the session it names read live (findSignedInSession):
   * not ended, its private user still the form's, its sign-in still
   * counting under the form's Require SSO to Sign In. A token of
   * another form, one that ran out, or one whose session ended reads
   * as no session at all - the visitor is asked to sign in.
   */
  @CaptureSpan()
  public async findSignedInSessionOnRequest(data: {
    req: ExpressRequest;
    formId: ObjectID;
    requireSsoForLogin: boolean | undefined;
    // The private user's address too, for the page that says who is signed in.
    withEmail?: boolean | undefined;
  }): Promise<Model | null> {
    const token: string | undefined =
      CookieUtil.getFormPrivateUserTokenFromExpressRequest(
        data.req,
        data.formId,
      );

    if (!token) {
      return null;
    }

    let claims: FormPrivateUserSessionClaims;

    try {
      claims = JSONWebToken.decodeFormPrivateUserSession(token);
    } catch {
      // Not a token OneUptime signed for this, or one that ran out.
      return null;
    }

    if (claims.formId.toString() !== data.formId.toString()) {
      return null;
    }

    return await this.findSignedInSession({
      resourceId: data.formId,
      sessionId: claims.sessionId,
      privateUserId: claims.userId,
      requiresSso: Boolean(data.requireSsoForLogin),
      select: data.withEmail
        ? ["session._id", "session.additionalInfo", "privateUser.email"]
        : undefined,
    });
  }

  // The visitor's form session, as a public form route hands it on (FormSessionReader).
  public getSessionReader(req: ExpressRequest): FormSessionReader {
    return async (form: {
      formId: ObjectID;
      requireSsoForLogin: boolean | undefined;
      withEmail?: boolean | undefined;
    }): Promise<Model | null> => {
      return await this.findSignedInSessionOnRequest({
        req: req,
        formId: form.formId,
        requireSsoForLogin: form.requireSsoForLogin,
        withEmail: form.withEmail,
      });
    };
  }
}

export default new Service();
