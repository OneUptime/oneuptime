import FormService, {
  FORM_NOT_AVAILABLE_MESSAGE,
} from "Common/Server/Services/FormService";
import { resolveClientIp } from "Common/Server/Utils/ClientIp";
import { ExpressRequest } from "Common/Server/Utils/Express";
import Form from "Common/Models/DatabaseModels/Form";
import { FORM_SIGN_IN_NOT_ASKED_MESSAGE } from "Common/Types/Form/FormPrivateUserSignIn";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE FORM A SIGN-IN IS FOR (#10249), as its public link answers this
 * visitor - the same checks every public form route makes
 * (FormService.getFormForSignIn), before any private user is looked at or
 * made:
 *
 *   - a form that is off, below its plan or missing reads as not available;
 *   - a visitor its IP allowlist refuses gets the allowlist's refusal;
 *   - a form that does not ask its visitors to sign in signs nobody in.
 *
 * The password routes (API/FormPrivateUserAuthentication) and both single
 * sign-on routes (API/FormSSO, API/FormOIDC) ask it, so a form switched
 * back to Anyone with the link makes no private user and no session. As a
 * dashboard's (Utils/DashboardSignIn) is.
 */
export default class FormSignIn {
  // A value that is no id is no form.
  public static readFormId(value: unknown): ObjectID {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE);
    }

    return new ObjectID(value);
  }

  public static async getFormForSignIn(data: {
    req: ExpressRequest;
    formId: ObjectID;
  }): Promise<Form> {
    return await FormService.getFormForSignIn({
      formId: data.formId,
      clientIp: resolveClientIp(data.req),
      notAskedMessage: FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    });
  }

  // The name a visitor knows the form by, in its emails.
  public static getFormName(form: Form): string {
    return form.name || "Form";
  }
}
