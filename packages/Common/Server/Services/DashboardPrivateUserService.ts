import PrivateUserServiceBase, {
  PrivateUserResource,
} from "./PrivateUserServiceBase";
import DashboardPrivateUserSessionService from "./DashboardPrivateUserSessionService";
import DashboardService from "./DashboardService";
import MailService from "./MailService";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import Model from "../../Models/DatabaseModels/DashboardPrivateUser";
import URL from "../../Types/API/URL";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import ObjectID from "../../Types/ObjectID";

/*
 * The private users of a dashboard (#10250): the people who may open its
 * public link once it asks its visitors to sign in. The lifecycle every
 * private user has (PrivateUserServiceBase): the password rule, one per
 * address and dashboard, an invitation whose link sets their first
 * password, links that end with a new password or address, and every
 * session ended with a new password or when they are removed.
 */
export const DASHBOARD_PRIVATE_USER_ALREADY_INVITED_MESSAGE: string =
  "This person is already a private user of this dashboard.";

/*
 * Where a private user chooses a password, on the dashboard's own public
 * link: its custom domain, or /public-dashboard/<id> on OneUptime's
 * address.
 */
export const getDashboardResetPasswordUrl: (data: {
  resourceUrl: string;
  token: string;
}) => string = (data: { resourceUrl: string; token: string }): string => {
  return URL.fromString(data.resourceUrl)
    .addRoute(`/reset-password/${data.token}`)
    .toString();
};

export class Service extends PrivateUserServiceBase<Model> {
  public constructor() {
    super(Model, {
      name: "dashboard",
      resourceKeys: ["dashboardId", "dashboard"],
      resourceLabel: "Dashboard",
      alreadyInvitedMessage: DASHBOARD_PRIVATE_USER_ALREADY_INVITED_MESSAGE,
      getResource: async (
        dashboardId: ObjectID,
      ): Promise<PrivateUserResource | null> => {
        return await Service.getDashboardForMail(dashboardId);
      },
      getResetPasswordUrl: getDashboardResetPasswordUrl,
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
        await DashboardPrivateUserSessionService.revokeAllSessionsByPrivateUserId(
          privateUserId,
          options,
        );
      },
    });
  }

  /*
   * The dashboard as its private users' emails name it: its page title,
   * else its name, and its public link - a custom domain first. Null for a
   * dashboard that is gone.
   */
  public static async getDashboardForMail(
    dashboardId: ObjectID,
  ): Promise<PrivateUserResource | null> {
    const dashboard: Dashboard | null = await DashboardService.findOneById({
      id: dashboardId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        pageTitle: true,
        requireSsoForLogin: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!dashboard || !dashboard.projectId) {
      return null;
    }

    return {
      projectId: dashboard.projectId,
      name: dashboard.pageTitle || dashboard.name || "Dashboard",
      requireSsoForLogin: Boolean(dashboard.requireSsoForLogin),
      url: await DashboardService.getPublicDashboardUrl(dashboardId),
    };
  }
}

export default new Service();
