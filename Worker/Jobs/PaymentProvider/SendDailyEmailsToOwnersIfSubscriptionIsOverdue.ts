import RunCron from "../../Utils/Cron";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import MailService from "Common/Server/Services/MailService";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";

RunCron(
  "PaymentProvider:SendDailyEmailsToOwnersIfSubscriptionIsOverdue",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    // get all projects.
    if (!IsBillingEnabled) {
      return;
    }

    const merteredSubscriptionPastdue: Array<Project> =
      await ProjectService.findBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        },
        select: {
          _id: true,
          paymentProviderSubscriptionId: true,
          paymentProviderMeteredSubscriptionId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    const subscriptionPastdue: Array<Project> = await ProjectService.findBy({
      query: {
        paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
      },
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const allPastDueProjects: Array<Project> = [
      ...merteredSubscriptionPastdue,
      ...subscriptionPastdue,
    ];

    for (const project of allPastDueProjects) {
      try {
        const projectOwners: Array<User> = await ProjectService.getOwners(
          project.id!,
        );

        if (!projectOwners || projectOwners.length === 0) {
          logger.info({
            message: "No project owners found for past due subscription.",
            projectId: project.id?.toString(),
          });
          continue;
        }
        for (const owner of projectOwners) {
          if (!owner.email) {
            logger.info({
              message: "Project owner does not have an email.",
              projectId: project.id?.toString(),
              ownerId: owner.id?.toString(),
            });
            continue;
          }
          // send email to project owner.
          MailService.sendMail(
            {
              toEmail: owner.email,
              templateType: EmailTemplateType.ProjectSubscriptionOverdue,
              vars: {
                projectName: project.name || "Project",
                projectId: project.id?.toString() || "",
                dashboardLink: (
                  await ProjectService.getProjectLinkInDashboard(project.id!)
                ).toString(),
              },
              subject: "[Action Required] OneUptime subscription is past due.",
            },
            {
              projectId: project.id!,
              userId: owner.id!,
            },
          ).catch((err: Error) => {
            logger.error(err);
          });
        }
      } catch (error) {
        logger.error({
          message:
            "Error while sending email to project owner for past due subscription.",
          error,
          projectId: project.id?.toString(),
        });
      }
    }
  },
);
