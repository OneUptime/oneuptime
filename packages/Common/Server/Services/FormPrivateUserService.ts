import PrivateUserServiceBase, {
  PrivateUserResource,
} from "./PrivateUserServiceBase";
import FormPrivateUserSessionService from "./FormPrivateUserSessionService";
import FormService from "./FormService";
import MailService from "./MailService";
import Form from "../../Models/DatabaseModels/Form";
import Model from "../../Models/DatabaseModels/FormPrivateUser";
import { FORM_RESET_PASSWORD_PARAMETER } from "../../Types/Form/FormPrivateUserSignIn";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import ObjectID from "../../Types/ObjectID";

/*
 * The private users of a form (#10249): the people who may open its
 * public link once it asks its visitors to sign in. The lifecycle every
 * private user has (PrivateUserServiceBase): the password rule, one per
 * address and form, an invitation whose link sets their first
 * password, links that end with a new password or address, and every
 * session ended with a new password or when they are removed.
 */
export const FORM_PRIVATE_USER_ALREADY_INVITED_MESSAGE: string =
  "This person is already a private user of this form.";

/*
 * Where a private user chooses a password, on the form's own public link:
 * its custom domain, or /accounts/form/<share key> on OneUptime's address
 * (FormService.getPublicFormUrl) - with the token in its address
 * (FORM_RESET_PASSWORD_PARAMETER), since a form's custom domain answers its
 * root alone.
 */
export const getFormResetPasswordUrl: (data: {
  resourceUrl: string;
  token: string;
}) => string = (data: { resourceUrl: string; token: string }): string => {
  const separator: string = data.resourceUrl.includes("?") ? "&" : "?";

  return `${data.resourceUrl}${separator}${FORM_RESET_PASSWORD_PARAMETER}=${encodeURIComponent(
    data.token,
  )}`;
};

export class Service extends PrivateUserServiceBase<Model> {
  public constructor() {
    super(Model, {
      name: "form",
      resourceKeys: ["formId", "form"],
      resourceLabel: "Form",
      alreadyInvitedMessage: FORM_PRIVATE_USER_ALREADY_INVITED_MESSAGE,
      getResource: async (
        formId: ObjectID,
      ): Promise<PrivateUserResource | null> => {
        return await Service.getFormForMail(formId);
      },
      getResetPasswordUrl: getFormResetPasswordUrl,
      sendInvitation: async (data: {
        resource: PrivateUserResource;
        toEmail: Email;
        tokenVerifyUrl: string;
      }): Promise<void> => {
        await MailService.sendMail(
          {
            toEmail: data.toEmail,
            subject: "You have been invited to " + data.resource.name,
            isSubjectLiteral: true,
            templateType: EmailTemplateType.PrivateUserInvitation,
            vars: {
              resourceName: data.resource.name,
              homeURL: data.resource.url,
              tokenVerifyUrl: data.tokenVerifyUrl,
            },
          },
          {
            projectId: data.resource.projectId,
          },
        );
      },
      revokeAllSessions: async (
        privateUserId: ObjectID,
        options: { reason: string },
      ): Promise<void> => {
        await FormPrivateUserSessionService.revokeAllSessionsByPrivateUserId(
          privateUserId,
          options,
        );
      },
    });
  }

  /*
   * The form as its private users' emails name it: its name, and its public
   * link - a custom domain first. Null for a form that is gone.
   */
  public static async getFormForMail(
    formId: ObjectID,
  ): Promise<PrivateUserResource | null> {
    const form: Form | null = await FormService.findOneById({
      id: formId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        requireSsoForLogin: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!form || !form.projectId) {
      return null;
    }

    return {
      projectId: form.projectId,
      name: form.name || "Form",
      requireSsoForLogin: Boolean(form.requireSsoForLogin),
      url: await FormService.getPublicFormUrl(formId),
    };
  }
}

export default new Service();
